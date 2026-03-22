# cc2cc: Roles & Topics Design

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Multi-instance team collaboration via free-form roles and persistent pub/sub topics

---

## Overview

Enhance cc2cc so that multiple Claude Code instances working in the same project can declare job functions (roles) and coordinate through named pub/sub channels (topics). Topics are global, persistent, and support both transient and durable message delivery. The project topic is auto-created and auto-joined on every instance connect.

---

## Requirements

### Roles
- Each instance may declare a free-form role string at any time (e.g. `"frontend-reviewer"`, `"backend"`, `"architect"`)
- Role is optional — instances without a role are fully functional
- Role is updatable after initial connect via a new MCP tool
- Role is visible in the dashboard instance list and chat area

### Topics
- Topics are global (not project-scoped) — naming conventions enforced by skill guidance
- Topics are permanent until explicitly deleted (no TTL)
- Any instance may create, subscribe to, unsubscribe from, or publish to any topic
- Subscriptions survive disconnects — they are stored in Redis, not session state
- On connect, the hub auto-upserts a topic named after the connecting instance's project and auto-subscribes the instance to it
- On connect, the hub sends the instance a `subscriptions:sync` frame listing all its current topic subscriptions
- Instances cannot unsubscribe from their auto-joined project topic (hub rejects it)

### Publishing
- `publish_topic` is distinct from `broadcast` — broadcast targets all online instances, publish targets a named topic's subscriber set
- `persistent: boolean` (default `false`):
  - `false` — live WS delivery only to online subscribers (fire-and-forget)
  - `true` — queued into each subscriber's Redis queue; offline subscribers receive on next connect
- Sender is excluded from delivery (same convention as broadcast)
- Topic messages are first-class `Message` objects delivered as `<channel>` tags with a `topic` attribute

### Dashboard
- New `/topics` page: topic list, subscriber panel, publish panel
- Instance sidebar sorted: Topics → Active instances → Inactive instances (alphabetical within each group)
- Feed filter bar: All / Direct / Topic (dropdown) / Broadcast
- Recipient dropdown (above chat input): Topics → Active → Inactive, selecting a topic routes through `publish_topic` with inline `persistent` toggle
- Instance chat area: "Subscriptions" section listing the instance's topics as clickable chips
- Instance sidebar rows: role badge displayed next to instanceId; topic chips shown on hover/expand

---

## Data Model

### Redis Keys

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `instance:{instanceId}` | JSON string | 24h | Existing — gains `role?: string` field |
| `topic:{name}` | Hash | none | Topic metadata: `name`, `createdAt`, `createdBy` |
| `topic:{name}:subscribers` | Set | none | Set of `instanceId` strings |
| `instance:{id}:topics` | Set | none | Reverse index: topics this instance subscribes to |

### `TopicInfo` type (shared)

```typescript
export interface TopicInfo {
  name: string;
  createdAt: string;   // ISO 8601
  createdBy: string;   // instanceId
  subscriberCount: number;
}
```

### `InstanceInfo` update (shared)

```typescript
export interface InstanceInfo {
  instanceId: InstanceId;
  project: string;
  role?: string;         // NEW — free-form, optional
  status: InstanceStatus;
  connectedAt: string;
  queueDepth: number;
}
```

### Topic message routing

`publish_topic` produces a standard `Message` with `to` set to `topic:{name}`. The `<channel>` tag gains a `topic` attribute when delivered via topic routing.

---

## Hub Layer

### New file: `hub/src/topic-manager.ts`

Owns all topic operations, backed by Redis:

```typescript
createTopic(name: string, createdBy: string): Promise<TopicInfo>   // upsert, idempotent
deleteTopic(name: string): Promise<void>                            // removes hash + subscriber Set
subscribe(name: string, instanceId: string): Promise<void>
unsubscribe(name: string, instanceId: string): Promise<void>        // rejects project topic
getSubscribers(name: string): Promise<string[]>
getTopicsForInstance(instanceId: string): Promise<string[]>
listTopics(): Promise<TopicInfo[]>
publishToTopic(
  name: string,
  message: Message,
  persistent: boolean,
  senderInstanceId: string
): Promise<{ delivered: number; queued: number }>
```

`publishToTopic` logic:
1. Fetch subscribers from `topic:{name}:subscribers`
2. Exclude sender
3. For each subscriber: if online → send live WS frame; if `persistent` → push to `queue:{subscriberId}` via existing queue.ts
4. Emit `topic:message` HubEvent to all dashboard clients
5. Return `{ delivered: onlineCount, queued: persistentOfflineCount }`

### Changes to `registry.ts`

- `RegistryEntry` gains `role?: string`
- `register()` accepts optional `role?: string`; stores in Redis JSON blob
- New method: `setRole(instanceId: string, role: string): Promise<RegistryEntry>`

### Changes to `ws-handler.ts`

**On plugin connect** (after existing queue flush):
1. `topicManager.createTopic(project, instanceId)` — upsert
2. `topicManager.subscribe(project, instanceId)`
3. Fetch `topicManager.getTopicsForInstance(instanceId)`
4. Send `subscriptions:sync` WS frame to the connecting instance with topic list

**New WS frame handlers:**

| Frame `type` | Action | HubEvent emitted |
|---|---|---|
| `set_role` | `registry.setRole()` | `instance:role_updated` |
| `subscribe_topic` | `topicManager.subscribe()` | `topic:subscribed` |
| `unsubscribe_topic` | `topicManager.unsubscribe()` | `topic:unsubscribed` |
| `publish_topic` | `topicManager.publishToTopic()` | `topic:message` |

### New REST endpoints in `api.ts`

All require `?key=<CC2CC_HUB_API_KEY>`:

```
GET    /api/topics                          → TopicInfo[]
GET    /api/topics/:name/subscribers        → string[] (instanceIds)
POST   /api/topics                          → { name } → TopicInfo
DELETE /api/topics/:name                    → { deleted: true }
POST   /api/topics/:name/subscribe          → { instanceId } → { subscribed: true }
POST   /api/topics/:name/unsubscribe        → { instanceId } → { unsubscribed: true }
POST   /api/topics/:name/publish            → { content, type, persistent? } → { delivered, queued }
```

---

## New HubEvents (`packages/shared/src/events.ts`)

Added to `HubEventSchema` discriminated union:

| Event | Fields |
|---|---|
| `topic:created` | `name`, `createdBy`, `timestamp` |
| `topic:deleted` | `name`, `timestamp` |
| `topic:subscribed` | `name`, `instanceId`, `timestamp` |
| `topic:unsubscribed` | `name`, `instanceId`, `timestamp` |
| `topic:message` | `name`, `message: Message`, `persistent: boolean`, `delivered: number`, `queued: number`, `timestamp` |
| `instance:role_updated` | `instanceId`, `role: string`, `timestamp` |

---

## Plugin Layer (`plugin/src/tools.ts`)

Five new tools added to `createTools()`:

### `set_role(role: string)`
WS frame `set_role`. Updates this instance's declared role.
Returns: `{ instanceId: string; role: string }`

### `subscribe_topic(topic: string)`
WS frame `subscribe_topic`. Idempotent.
Returns: `{ topic: string; subscribed: true }`

### `unsubscribe_topic(topic: string)`
WS frame `unsubscribe_topic`. Hub rejects unsubscribing from the auto-joined project topic.
Returns: `{ topic: string; unsubscribed: true }`

### `list_topics()`
REST `GET /api/topics`. No side effects.
Returns: `TopicInfo[]`

### `publish_topic(topic, type, content, persistent?, metadata?)`
WS frame `publish_topic`. `persistent` defaults to `false`.
Returns: `{ delivered: number; queued: number }`

### Inbound topic messages

Topic messages arrive as `<channel>` tags with an additional `topic` attribute:

```xml
<channel source="cc2cc" from="alice@server:myapp/xyz"
         type="task" message_id="abc123" reply_to=""
         topic="myapp/frontend">
  Can you review the new button component?
</channel>
```

`topic` is absent for direct messages. Skill guidance uses this to inform Claude of routing context.

---

## Skill Updates (`skill/skills/cc2cc/`)

### `SKILL.md` additions

**Roles section:**
- Call `set_role()` early in a session once you know your function
- Use `{project}/{function}` for specificity (e.g. `cc2cc/backend-reviewer`)
- Re-call `set_role()` if your focus shifts mid-session

**Topics section:**
- Project topic (`{project}`) is auto-joined — never call `unsubscribe_topic` on it
- Call `list_topics()` at session start; review subscriptions from `subscriptions:sync`
- Unsubscribe from topics no longer relevant; ask user if unsure
- Prefer `{project}/{function}` naming (e.g. `cc2cc/frontend`)
- Use `publish_topic` for team-wide signals; `send_message` for direct peer requests
- Use `persistent: true` for work handoffs and task assignments; `persistent: false` for status signals

### New file: `patterns/topics.md`
- Topic naming conventions and examples
- Decision tree: `publish_topic` vs `broadcast` vs `send_message`
- Subscription hygiene guidance
- When to create a new topic vs reuse an existing one

---

## Dashboard Layer

### New page: `app/topics/page.tsx`

Three-panel layout:

**Left — Topic List**
- All topics from `GET /api/topics`: name, subscriber count, createdBy
- "New Topic" button → inline name input → `POST /api/topics`
- Selected topic drives center and right panels
- Delete button on hover (only if subscriber count is 0)

**Center — Subscriber Panel**
- `GET /api/topics/:name/subscribers` with role and online status for each
- Subscribe/Unsubscribe buttons for the dashboard's own instanceId
- Each subscriber row links to that instance in the conversation view

**Right — Publish Panel**
- `type` selector, `content` textarea, `persistent` toggle
- "Publish" → `POST /api/topics/:name/publish`
- Shows last result: `{ delivered, queued }`

### Nav bar

Add "Topics" link between "Dashboard" and "Analytics".

### `WsProvider` changes (`components/ws-provider/`)

New state: `topics: Map<string, TopicInfo>`

New HubEvent handlers:
- `topic:created` / `topic:deleted` → update `topics` Map
- `topic:subscribed` / `topic:unsubscribed` → update subscriber lists
- `topic:message` → append to `feed[]` (existing 500-item cap), tagged with `topic` name
- `instance:role_updated` → update `role` on affected entry in `instances` Map

### Instance Sidebar (`app/page.tsx`)

**Sort order** (three visually separated groups with section headers):
1. **Topics** — alphabetical, distinct group header "Topics"
2. **Online** — alphabetical by instanceId, with role badge
3. **Offline** — alphabetical by instanceId, muted, `×` remove button on hover

Role badge displayed inline next to instanceId. Topic chip list shown on hover/expand.

### Feed Filter Bar (`app/page.tsx`)

Above the message feed:
```
[ All ] [ Direct ] [ Topic ▾ ] [ Broadcast ]
```
"Topic ▾" opens a dropdown of all known topics; selecting one filters feed to `topic:message` events for that topic. Filter state is local component state.

### Recipient Dropdown (above chat input, `app/page.tsx`)

Same three-group sort order as sidebar:
1. **Topics** (alphabetical) — sends via `publish_topic`; selecting a topic shows `persistent` toggle inline next to send button
2. **Active instances** (alphabetical) — sends via `send_message`
3. **Inactive instances** (alphabetical, muted) — sends via `send_message` (queued)

### Instance Chat Area / Detail Panel

**Subscriptions section** added to the instance detail view:
- Heading "Subscriptions"
- Each topic shown as a clickable chip → navigates to `/topics` with that topic selected

---

## Implementation Sequence

1. `packages/shared` — add `TopicInfo`, update `InstanceInfo`, extend `HubEventSchema`
2. `hub/src/topic-manager.ts` — new file
3. `hub/src/registry.ts` — add `role` field and `setRole()`
4. `hub/src/ws-handler.ts` — connect-time topic auto-join, new frame handlers
5. `hub/src/api.ts` — new topic REST endpoints
6. `plugin/src/tools.ts` — five new MCP tools
7. `skill/` — update `SKILL.md`, add `patterns/topics.md`
8. `dashboard/` — `WsProvider`, sidebar sort, feed filter, recipient dropdown, `/topics` page, chat area subscriptions section

---

## Out of Scope

- Topic-level access control (any authenticated instance can pub/sub any topic)
- Topic message history / replay (future — can layer on top via Redis Streams)
- Enforced topic naming (skill guidance only, not hub-validated)
- Maximum subscriber limits per topic
