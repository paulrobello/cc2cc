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
- On connect, the hub auto-upserts a topic named after the connecting instance's bare `project` segment (e.g. for `alice@server:cc2cc/abc123` the project topic is `cc2cc`) and auto-subscribes the instance
- On connect (and on session update — see below), the hub sends a `subscriptions:sync` push frame listing all current topic subscriptions
- Instances cannot unsubscribe from their auto-joined project topic (hub rejects with a defined error)

### Publishing
- `publish_topic` is distinct from `broadcast` — broadcast targets all online instances, publish targets a named topic's subscriber set
- `persistent: boolean` (default `false`) — delivery matrix:

  | Subscriber state | `persistent: false` | `persistent: true` |
  |---|---|---|
  | Online | Live WS delivery only | Live WS delivery **and** push to `queue:{id}` |
  | Offline | Skipped (fire-and-forget) | Push to `queue:{id}` only |

- Sender is excluded from delivery (same convention as broadcast)
- Topic messages carry a `topicName` field on the `Message` object (see type changes below)
- Non-persistent topic publishes increment `stats:messages:today` via a direct `INCR` call (once per publish, not per subscriber). Persistent publishes already increment via the existing `pushMessage()` path.

### Dashboard
- New `/topics` page: topic list, subscriber panel, publish panel
- Instance sidebar sorted: Topics → Active instances → Inactive instances (alphabetical within each group)
- Feed filter bar: All / Direct / Topic (dropdown) / Broadcast
- Recipient dropdown (above chat input): Topics → Active → Inactive; selecting a topic routes through `publish_topic` with inline `persistent` toggle
- Instance chat area: "Subscriptions" section listing the instance's topics as clickable chips
- Instance sidebar rows: role badge displayed next to instanceId; topic chips shown on hover/expand
- Topic messages are **not** grouped as conversation threads in `/conversations` — they appear in the feed only

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
  subscriberCount: number;  // point-in-time snapshot from Redis; use topic:subscribed/unsubscribed HubEvents to keep dashboard count live
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

### `Message` type update (shared)

```typescript
export interface Message {
  messageId: string;
  from: InstanceId;
  to: InstanceId | "broadcast" | `topic:${string}`;  // NEW: topic routing sentinel
  type: MessageType;
  content: string;
  replyToMessageId?: string;
  topicName?: string;    // NEW: set when message was routed via a topic; absent for direct messages
  metadata?: Record<string, unknown>;
  timestamp: string;
}
```

All consumers that branch on `msg.to` must add a `topic:` prefix guard (`msg.to.startsWith("topic:")`) alongside the existing `"broadcast"` check.

### `MessageSchema` update (shared)

`schema.ts` must add `topicName: z.string().optional()` to `MessageSchema`. Without this, Zod's default `.strip()` behavior will silently remove `topicName` from any validated message (including messages embedded in `topic:message` HubEvents consumed by the dashboard).

---

## Hub Layer

### New file: `hub/src/topic-manager.ts`

Owns all topic operations, backed by Redis:

```typescript
createTopic(name: string, createdBy: string): Promise<TopicInfo>   // upsert, idempotent
deleteTopic(name: string): Promise<void>
  // Note: no guard against deleting the project topic — re-upsert on next connect is the recovery path
  // 1. Fetch all members of topic:{name}:subscribers
  // 2. For each member: SREM instance:{memberId}:topics name
  // 3. DEL topic:{name}:subscribers
  // 4. DEL topic:{name}
subscribe(name: string, instanceId: string): Promise<void>
  // SADD topic:{name}:subscribers instanceId
  // SADD instance:{instanceId}:topics name
unsubscribe(name: string, instanceId: string): Promise<void>
  // Reject if name === parseProject(instanceId):
  //   throw new Error("cannot unsubscribe from auto-joined project topic")
  // SREM topic:{name}:subscribers instanceId
  // SREM instance:{instanceId}:topics name
getSubscribers(name: string): Promise<string[]>
getTopicsForInstance(instanceId: string): Promise<string[]>
listTopics(): Promise<TopicInfo[]>
publishToTopic(
  name: string,
  message: Message,         // already has to="topic:{name}", topicName=name
  persistent: boolean,
  senderInstanceId: string
): Promise<{ delivered: number; queued: number }>
```

`publishToTopic` logic (see delivery matrix above):
1. Fetch subscribers from `topic:{name}:subscribers`
2. Exclude `senderInstanceId`
3. For each remaining subscriber, apply the delivery matrix
4. If `persistent: false`: call `redis.incr("stats:messages:today")` once (live-only path has no `pushMessage` call)
5. Emit `topic:message` HubEvent to all dashboard clients
6. Return `{ delivered: onlineSentCount, queued: queuedCount }`

### Changes to `registry.ts`

- `RegistryEntry` gains `role?: string`
- `register()` accepts optional `role?: string`; stores in Redis JSON blob with existing `EX 86400` TTL (unchanged)
- New method:
  ```typescript
  async setRole(instanceId: string, role: string): Promise<RegistryEntry>
  // Updates _map entry
  // Re-serializes and re-writes instance:{instanceId} with EX 86400 (resets TTL)
  // Returns updated entry
  ```

### Changes to `ws-handler.ts`

**On plugin connect** (after existing queue flush):
1. `topicManager.createTopic(project, instanceId)` — upsert
2. `topicManager.subscribe(project, instanceId)`
3. Fetch `topicManager.getTopicsForInstance(instanceId)` → `topics: string[]`
4. Send `subscriptions:sync` push frame to the connecting instance

**On session update (`handleSessionUpdate`)** — after existing queue migration:
1. Fetch `topicManager.getTopicsForInstance(oldInstanceId)` → `topicNames: string[]`
2. For each topic: `SREM topic:{name}:subscribers oldInstanceId`, `SADD topic:{name}:subscribers newInstanceId`
3. Copy Redis Set: `SUNIONSTORE instance:{newId}:topics instance:{newId}:topics instance:{oldId}:topics`
   (union of both sources handles the unlikely case where `newId` already has subscriptions; safe no-op if destination is empty)
4. `DEL instance:{oldId}:topics`
5. Re-run connect-time auto-join for the project topic (idempotent `createTopic` + `subscribe`)
6. Send `subscriptions:sync` push frame to `newInstanceId`'s WS connection

**`subscriptions:sync` push frame shape:**
```json
{ "action": "subscriptions:sync", "topics": ["cc2cc", "cc2cc/frontend"] }
```
This is an unsolicited hub→plugin push (no `requestId`). It uses `action` as discriminator in the hub→plugin direction — a new convention introduced by this feature, distinct from the `requestId`-keyed reply correlator. The plugin handler must check `action === "subscriptions:sync"` before passing any frame to the request/reply correlator.

**New WS frame handlers** — all use `action` as the discriminator key, consistent with existing plugin→hub dispatch:

| Frame `action` | Handler | Reply shape | HubEvent emitted |
|---|---|---|---|
| `set_role` | `registry.setRole(instanceId, role)` | `{ requestId, instanceId, role }` | `instance:role_updated` |
| `subscribe_topic` | `topicManager.subscribe(topic, instanceId)` | `{ requestId, topic, subscribed: true }` | `topic:subscribed` |
| `unsubscribe_topic` | `topicManager.unsubscribe(topic, instanceId)` | `{ requestId, topic, unsubscribed: true }` on success; `{ requestId, error: "cannot unsubscribe from auto-joined project topic" }` on rejection | `topic:unsubscribed` **(success only — not emitted on error)** |
| `publish_topic` | `topicManager.publishToTopic(...)` | `{ requestId, delivered, queued }` | `topic:message` |

### New REST endpoints in `api.ts`

All require `?key=<CC2CC_HUB_API_KEY>`:

```
GET    /api/topics
  → TopicInfo[]
  subscriberCount is a point-in-time snapshot

GET    /api/topics/:name/subscribers
  → string[] (instanceIds)
  404 if topic does not exist

POST   /api/topics
  body: { name: string }
  → TopicInfo (created or existing)

DELETE /api/topics/:name
  → { deleted: true, name: string }   ← field is `name`, not `instanceId`
  409 if topic has subscribers (server enforces; UI delete button is also hidden as secondary guard)
  404 if topic does not exist
  Note: no server-side guard against deleting a project topic — re-upsert on next connect is the recovery path

POST   /api/topics/:name/subscribe
  body: { instanceId: string }
  → { subscribed: true, topic: string }
  404 if topic does not exist or instanceId is not in registry
  (idempotent — re-subscribing returns success)

POST   /api/topics/:name/unsubscribe
  body: { instanceId: string }
  → { unsubscribed: true, topic: string }
  400 if instanceId's auto-joined project topic matches name
  404 if topic does not exist

POST   /api/topics/:name/publish
  body: { content: string, type: MessageType, persistent?: boolean, from?: string, metadata?: Record<string, unknown> }
  → { delivered: number, queued: number }
  `from` identifies the sender for exclusion from delivery (caller-supplied, unvalidated)
  Security note: any authenticated caller can pass any `from` value to exclude an arbitrary instance from delivery;
  this is acceptable given topics have no access control (see Out of Scope)
  if `from` is absent or not found in registry, no sender is excluded
  404 if topic does not exist
```

---

## New HubEvents (`packages/shared/src/events.ts`)

Added to `HubEventSchema` discriminated union:

| Event | Fields |
|---|---|
| `topic:created` | `name`, `createdBy`, `timestamp` |
| `topic:deleted` | `name`, `timestamp` |
| `topic:subscribed` | `name`, `instanceId`, `timestamp` |
| `topic:unsubscribed` | `name`, `instanceId`, `timestamp` (success only) |
| `topic:message` | `name`, `message: Message`, `persistent: boolean`, `delivered: number`, `queued: number`, `timestamp` |
| `instance:role_updated` | `instanceId`, `role: string`, `timestamp` |

---

## Plugin Layer

### `connection.ts` / message handler

The plugin's inbound WS message handler must branch **before** the existing request/reply correlator:

```
if msg.action === "subscriptions:sync"
  → store topics list internally; do not pass to request/reply correlator
else if msg has requestId matching a pending request
  → resolve the pending request (existing behavior)
else
  → treat as inbound Message delivery (existing channel.ts path)
```

### `channel.ts`

`emitChannelNotification()` conditionally adds `topic` to the `<channel>` tag when `message.topicName` is set:

```xml
<!-- Direct message — no topic attribute -->
<channel source="cc2cc" from="alice@server:myapp/xyz"
         type="task" message_id="abc123" reply_to="">
  Can you review the auth module?
</channel>

<!-- Topic message — topic attribute present -->
<channel source="cc2cc" from="alice@server:myapp/xyz"
         type="task" message_id="abc456" reply_to=""
         topic="myapp/frontend">
  Can you review the new button component?
</channel>
```

### `tools.ts` — five new tools added to `createTools()`

`list_topics` uses REST (no side effects; no identity stamping required). All other new tools use WS so the hub can stamp `from` from the WS identity — consistent with the existing `send_message`/`broadcast`/`get_messages` pattern.

**`set_role(role: string)`** — WS `action: "set_role"`.
Returns: `{ instanceId: string; role: string }`

**`subscribe_topic(topic: string)`** — WS `action: "subscribe_topic"`. Idempotent.
Returns: `{ topic: string; subscribed: true }`

**`unsubscribe_topic(topic: string)`** — WS `action: "unsubscribe_topic"`.
Returns: `{ topic: string; unsubscribed: true }` or throws `"cannot unsubscribe from auto-joined project topic"`.

**`list_topics()`** — REST `GET /api/topics`. No side effects.
Returns: `TopicInfo[]` — `{ name: string; createdAt: string; createdBy: string; subscriberCount: number }[]`

**`publish_topic(topic, type, content, persistent?, metadata?)`** — WS `action: "publish_topic"`. `persistent` defaults to `false`.
Returns: `{ delivered: number; queued: number }`

---

## Skill Updates (`skill/skills/cc2cc/`)

### `SKILL.md` additions

**Roles section:**
- Call `set_role()` early in a session once you know your function
- Use `{project}/{function}` for specificity (e.g. `cc2cc/backend-reviewer`)
- Re-call `set_role()` if your focus shifts mid-session

**Topics section:**
- Project topic (e.g. `cc2cc`) is auto-joined — never call `unsubscribe_topic` on it
- Call `list_topics()` at session start; review subscriptions from `subscriptions:sync`
- Unsubscribe from topics no longer relevant; ask user if unsure
- Prefix generic topic names with project (e.g. `cc2cc/frontend`, not just `frontend`)
- Use `publish_topic` for team-wide signals; `send_message` for direct peer requests
- Use `persistent: true` for work handoffs and task assignments; `persistent: false` for status signals

### New file: `patterns/topics.md`
- Topic naming conventions and examples
- Decision tree: `publish_topic` vs `broadcast` vs `send_message`
- Subscription hygiene guidance
- When to create a new topic vs reuse an existing one

---

## Dashboard Layer

### `WsProvider` (`components/ws-provider/`)

**New state:**
```typescript
topics: Map<string, TopicInfo & { subscribers: string[] }>
```

**`WsContextValue` type additions:**
```typescript
topics: Map<string, TopicInfo & { subscribers: string[] }>
sendPublishTopic(topic: string, type: MessageType, content: string, persistent: boolean, metadata?: Record<string, unknown>): Promise<void>
```
The `WsContext` default value must be updated with empty/no-op stubs for these fields.

Note: `sendPublishTopic` is implemented via REST (`POST /api/topics/:name/publish`) rather than the plugin WS. The dashboard sends `from: dashboardInstanceId` explicitly in the request body. This is consistent with the REST endpoint's `from` semantics (see Hub Layer section).

**New HubEvent handlers:**
- `topic:created` → add entry to `topics` Map
- `topic:deleted` → remove entry from `topics` Map; prune that topic name from all instance subscription chip lists in local state
- `topic:subscribed` → increment `subscriberCount` on affected topic; add topic to instance's local subscription list; add instanceId to topic's local subscribers list
- `topic:unsubscribed` → decrement `subscriberCount`; remove topic from instance's subscription list; remove instanceId from topic's subscribers list
- `topic:message` → append to `feed[]` (existing 500-item cap), tagged with `name` for filter
- `instance:role_updated` → update `role` on affected entry in `instances` Map

**Dashboard plugin WS `subscriptions:sync` handling:**
The dashboard's plugin WS connection will receive `subscriptions:sync` push frames. The `onmessage` handler must detect `msg.action === "subscriptions:sync"` before the `requestId` correlator branch and update the dashboard's own subscription state (e.g., which topics the dashboard instanceId belongs to). These frames must not fall through to the inbound-message path.

### New page: `app/topics/page.tsx`

Three-panel layout:

**Left — Topic List**
- All topics from `GET /api/topics`: name, subscriber count (live-updated via HubEvents), createdBy
- "New Topic" button → inline name input → `POST /api/topics`
- Selected topic drives center and right panels
- Delete button on hover — only shown when subscriber count is 0 (server also enforces 409 on non-empty topics)

**Center — Subscriber Panel**
- `GET /api/topics/:name/subscribers` with role and online status for each
- Subscribe/Unsubscribe buttons for the dashboard's own instanceId (via `POST /api/topics/:name/subscribe`)
- Each subscriber row links to that instance in the conversation view

**Right — Publish Panel**
- `type` selector, `content` textarea, `persistent` toggle, optional `metadata` key-value editor
- "Publish" → `POST /api/topics/:name/publish` with `{ content, type, persistent, metadata, from: dashboardInstanceId }`
- Shows last result: `{ delivered, queued }`

### Nav bar

Add "Topics" link between "Dashboard" and "Analytics".

### Instance Sidebar (`app/page.tsx`)

**Sort order** (three visually separated groups with section headers):
1. **Topics** — alphabetical, section header "Topics"
2. **Online** — alphabetical by instanceId, with role badge, section header "Online"
3. **Offline** — alphabetical by instanceId, muted, `×` remove button on hover, section header "Offline"

Role badge displayed inline next to instanceId. Topic chip list shown on hover/expand.

### Feed Filter Bar (`app/page.tsx`)

Above the message feed:
```
[ All ] [ Direct ] [ Topic ▾ ] [ Broadcast ]
```
"Topic ▾" opens a dropdown of all known topics; selecting one filters feed to `topic:message` events for that topic. Filter state is local component state.

### Recipient Dropdown (above chat input, `app/page.tsx`)

Three-group sort order:
1. **Topics** (alphabetical, section header) — sends via `POST /api/topics/:name/publish`; selecting a topic reveals a `persistent` toggle inline next to the send button
2. **Active instances** (alphabetical, section header) — sends via existing `send_message`
3. **Inactive instances** (alphabetical, muted, section header) — sends via `send_message` (queued)

### Instance Chat Area / Detail Panel

**Subscriptions section** added to the instance detail view:
- Heading "Subscriptions"
- Each topic shown as a clickable chip → navigates to `/topics` with that topic selected

### `/conversations` page

Topic messages (`message.topicName` is set or `message.to.startsWith("topic:")`) are **excluded** from conversation thread grouping. They appear only in the main feed with the topic filter.

---

## Implementation Sequence

1. `packages/shared` — update `Message` interface (add `topicName?`, extend `to` type); update `MessageSchema` (add `topicName: z.string().optional()`); add `TopicInfo`; update `InstanceInfo` (add `role?`); update `InstanceInfoSchema` (add `role: z.string().optional()` — same Zod-stripping risk as `topicName` on `MessageSchema`); extend `HubEventSchema` with six new events
2. `hub/src/topic-manager.ts` — new file
3. `hub/src/registry.ts` — add `role` field and `setRole()`
4. `hub/src/ws-handler.ts` — connect-time topic auto-join + `subscriptions:sync` push; session-update topic migration; new frame action handlers
5. `hub/src/api.ts` — new topic REST endpoints
6. `plugin/src/connection.ts` — intercept `subscriptions:sync` push frames before request/reply correlator
7. `plugin/src/channel.ts` — add `topic` attribute to `<channel>` tag when `message.topicName` is set
8. `plugin/src/tools.ts` — five new MCP tools
9. `skill/` — update `SKILL.md`, add `patterns/topics.md`
10a. `dashboard/components/ws-provider/` — new state, `WsContextValue` type additions, new HubEvent handlers, `subscriptions:sync` handling (prerequisite for all subsequent dashboard steps)
10b. `dashboard/app/page.tsx` — sidebar sort + section headers + role badge; feed filter bar; recipient dropdown with topic group
10c. Instance chat area — Subscriptions section with topic chips
10d. `dashboard/app/topics/page.tsx` — new Topics page (topic list, subscriber panel, publish panel)

---

## Out of Scope

- Topic-level access control (any authenticated instance can pub/sub any topic)
- Topic `from` field in REST publish is caller-supplied and unvalidated — acceptable given no ACL
- Topic message history / replay (future — can layer on top via Redis Streams)
- Enforced topic naming (skill guidance only, not hub-validated)
- Maximum subscriber limits per topic
- Rate limiting on `publish_topic` (current broadcast rate limit does not apply to topic publishes)
- Server-side guard on deleting project topics — re-upsert on next connect is the recovery path
