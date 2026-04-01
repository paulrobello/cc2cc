# cc2cc Architecture

Comprehensive technical reference for the cc2cc hub-and-spoke communication system — covering workspace layout, component responsibilities, message flow, protocol details, and key design invariants.

## Table of Contents

- [Overview](#overview)
- [Workspace Layout](#workspace-layout)
- [System Diagram](#system-diagram)
- [Components](#components)
  - [packages/shared](#packagesshared)
  - [hub](#hub)
  - [plugin](#plugin)
  - [dashboard](#dashboard)
  - [skill](#skill)
- [Message Flow](#message-flow)
- [WebSocket Protocol](#websocket-protocol)
  - [Plugin WebSocket Actions](#plugin-websocket-actions)
  - [Dashboard WebSocket Events](#dashboard-websocket-events)
- [REST API](#rest-api)
- [Queue Architecture](#queue-architecture)
- [Design Invariants](#design-invariants)
- [Related Documentation](#related-documentation)

---

## Overview

cc2cc is a hub-and-spoke messaging system. A central hub server accepts WebSocket connections from two client types — *plugins* (one per Claude Code session) and *dashboards* — and routes typed messages between them through per-instance Redis queues.

The system is designed for trusted LAN environments where multiple Claude Code instances collaborate on shared work. It is **not** an encrypted messaging system and assumes physical network trust.

---

## Workspace Layout

```mermaid
graph LR
    SHARED["packages/shared\n@cc2cc/shared — types, Zod schemas, HubEvent shapes"]
    HUB["hub\nBun + Hono server — port 3100"]
    PLUGIN["plugin\nMCP stdio server (one per Claude Code session)"]
    DASH["dashboard\nNext.js monitoring UI — port 8029"]
    SKILL["skill\nCollaboration protocol + plugin manifest"]
    DOCS["docs\nArchitecture, API, guides"]

    SHARED --> HUB
    SHARED --> PLUGIN
    SHARED --> DASH

    style SHARED fill:#37474f,stroke:#78909c,stroke-width:2px,color:#ffffff
    style HUB fill:#e65100,stroke:#ff9800,stroke-width:3px,color:#ffffff
    style PLUGIN fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style DASH fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    style SKILL fill:#0d47a1,stroke:#2196f3,stroke-width:2px,color:#ffffff
    style DOCS fill:#37474f,stroke:#78909c,stroke-width:1px,color:#ffffff
```

---

## System Diagram

```mermaid
graph TD
    subgraph "LAN"
        C1[Claude Code Instance A]
        C2[Claude Code Instance B]
        C3[Claude Code Instance C]
        DB[Dashboard - port 8029]
    end

    subgraph "Hub Services"
        HUB[Hub Server - port 3100]
        REDIS[Redis Queue]
    end

    C1 -->|ws/plugin| HUB
    C2 -->|ws/plugin| HUB
    C3 -->|ws/plugin| HUB
    DB -->|ws/dashboard + ws/plugin| HUB
    HUB -->|queue:instanceId| REDIS
    REDIS -->|flush on connect| HUB

    style HUB fill:#e65100,stroke:#ff9800,stroke-width:3px,color:#ffffff
    style REDIS fill:#0d47a1,stroke:#2196f3,stroke-width:2px,color:#ffffff
    style C1 fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style C2 fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style C3 fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style DB fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
```

---

## Components

### packages/shared

**Purpose:** Central source of truth for all types and validation schemas, shared by every other workspace.

No build step — all other workspaces import directly from TypeScript source via the `@cc2cc/shared` path alias.

| Module | Contents |
|--------|----------|
| `src/types.ts` | `MessageType` enum, `Message` interface, `InstanceInfo` interface (with optional `role` field), `TopicInfo` interface (with optional `autoExpire` field), `Schedule` interface, `SYSTEM_SENDER_ID` constant, `parseProject()` helper, `toHttpUrl()` helper |
| `src/schema.ts` | Zod schemas for all message shapes, MCP tool inputs, and `ScheduleSchema`; uses `z.nativeEnum(MessageType)` for enum alignment; exports `INSTANCE_ID_RE` canonical regex |
| `src/events.ts` | `HubEvent` discriminated union — 17 event types emitted to dashboard clients, including topic, role, and schedule events (`schedule:created`, `schedule:updated`, `schedule:deleted`, `schedule:fired`) |
| `src/index.ts` | Barrel re-export of all types, schemas, and events |

> **Note:** Zod version is pinned to `^3`. Do not upgrade to v4 — it is incompatible with the shared schemas.

---

### hub

**Purpose:** Central routing server. Accepts plugin and dashboard WebSocket connections, routes messages through Redis queues, and fans out HubEvents to all dashboard clients.

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Entry point; Bun + Hono server setup, WS upgrade routing for `/ws/plugin` and `/ws/dashboard`, CORS, security headers, graceful shutdown, startup registry re-hydration from Redis |
| `config.ts` | Environment: `CC2CC_HUB_PORT` (3100), `CC2CC_HUB_API_KEY` (required), `CC2CC_REDIS_URL`, `CC2CC_DASHBOARD_ORIGIN`; deferred validation via `validateConfig()` |
| `auth.ts` | Timing-safe API key comparison via `keysEqual()` to prevent timing attacks |
| `registry.ts` | In-memory `Map` of live connections + Redis presence TTLs (24 h); partial address resolution; role-based lookup via `getByRole()`; startup re-hydration via `hydrateOffline()` |
| `queue.ts` | RPOPLPUSH-based at-least-once delivery; max 1000 msgs/queue; daily stats counter (`stats:messages:today`) with EXPIREAT midnight UTC; queue migration for session updates |
| `broadcast.ts` | `BroadcastManager` class: in-memory fan-out + per-instance 5 s rate limiter |
| `topic-manager.ts` | Pub/sub topic lifecycle (create, delete, subscribe, unsubscribe, publish); persistent topic messages queued to offline subscribers; project topic auto-joined on connect; subscription migration for session updates |
| `scheduler.ts` | Cron-based scheduled message delivery; `Scheduler` class manages `Schedule` records in Redis; supports simple interval expressions (`every 5m`) and standard cron; fires messages through existing routing (direct, broadcast, topic, role); auto-deletes schedules that reach `maxFireCount` or `expiresAt` |
| `ws-handler.ts` | Plugin/dashboard WS lifecycle; message routing including role-based fan-out (`to: "role:<name>"`); per-connection rate limiting (60 msg / 10 s); role nudge on connect; handles 13 WS action types (8 original + 5 schedule actions) |
| `event-bus.ts` | Shared event infrastructure: `dashboardClients` set, `emitToDashboards()` helper, `broadcastManager` singleton; extracted to break circular dependency between `api.ts` and `ws-handler.ts` |
| `api.ts` | REST handlers; `GET /health` is the only unauthenticated endpoint; all others require `Authorization: Bearer <key>` header (preferred) or `?key=` query param (fallback) |
| `redis.ts` | Redis client setup (ioredis) with exponential backoff reconnect and health check helper |
| `utils.ts` | Standalone `parseProject()` helper for extracting the project segment from an instance ID; `sanitizeProjectTopic()` for converting project names into valid topic names |
| `constants.ts` | `WS_OPEN` constant (WebSocket readyState = 1) used across hub modules |
| `validation.ts` | Re-exports `INSTANCE_ID_RE` from `@cc2cc/shared` (single source of truth) |

---

### plugin

**Purpose:** MCP stdio server that connects to the hub and exposes 15 Claude Code tools. One instance runs per Claude Code session.

| Module | Responsibility |
|--------|---------------|
| `config.ts` | Assembles `instanceId` from env vars; polls for Claude session ID from `.claude/.cc2cc-session-id` (written by `SessionStart` hook), falling back to random UUIDv4 |
| `connection.ts` | `HubConnection`: WS client using the `ws` package; exponential backoff (1 s → ×2 → 30 s max); `request()` method with 10 s timeout |
| `channel.ts` | Converts hub `message:sent` events into `notifications/claude/channel` MCP notifications with `source: "cc2cc"` in meta |
| `session-watcher.ts` | Watches `.claude/.cc2cc-session-id` via `fs.watchFile` (poll-based, 2 s interval) for session changes (e.g. `/clear`); triggers `session_update` on the hub, replaces connection and tools with new identity; **disabled** when `CC2CC_SESSION_ID` is set (team mode) |
| `tools.ts` | 15 MCP tools — `list_instances`, `send_message`, `broadcast`, `get_messages`, `ping`, `set_role`, `subscribe_topic`, `unsubscribe_topic`, `list_topics`, `publish_topic`, `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule` |

**Instance ID format:**

```
username@host:project/sessionId
```

The `sessionId` is the Claude Code session ID — stable within a session, updated automatically on `/clear`. The plugin detects the new ID via a `SessionStart` hook and migrates queued messages to the new identity.

**Multi-Instance / Team Mode:**

When multiple Claude Code instances share the same project directory (e.g. team mode via `cctmux team`), the shared `.claude/.cc2cc-session-id` file creates a race condition — all instances would poll the same file and potentially adopt each other's session IDs.

The `CC2CC_SESSION_ID` environment variable bypasses this. When set, `config.ts` uses its value directly as the session ID instead of reading from the file. Each instance receives a unique value from the launcher, producing distinct instance IDs even though they share the same `username@host:project` prefix.

---

### dashboard

**Purpose:** Real-time monitoring UI. A full participant in the cc2cc network with its own registered plugin identity.

```mermaid
graph LR
    BROWSER[Browser]

    subgraph "Dashboard WS Connections"
        DWS[/ws/dashboard — receive-only hub events/]
        PWS[/ws/plugin — registered identity, send + receive/]
    end

    HUB[Hub]

    BROWSER --> DWS
    BROWSER --> PWS
    DWS --> HUB
    PWS --> HUB

    style BROWSER fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    style DWS fill:#37474f,stroke:#78909c,stroke-width:2px,color:#ffffff
    style PWS fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style HUB fill:#e65100,stroke:#ff9800,stroke-width:3px,color:#ffffff
```

The dashboard registers under:

```
dashboard@<hostname>:dashboard/<uuid>
```

The UUID is generated once per browser session (stored in `sessionStorage`) and is stable across page re-renders but fresh on each new tab.

`sendMessage` and `sendBroadcast` go through the plugin WS connection. `sendPublishTopic` goes through REST (`POST /api/topics/:name/publish`) to avoid requiring the dashboard's plugin WS identity for topic operations.

| Module | Responsibility |
|--------|---------------|
| `src/components/ws-provider/` | Single context providing both WS connections; accumulates `instances` Map, `topics` Map, `feed[]` (capped at 500), counters; dispatches all `HubEvent` types |
| `src/app/page.tsx` | Command Center: stats bar, instance sidebar, feed filter bar, live message feed, manual send bar |
| `src/app/topics/page.tsx` | Topics management: topic list + create/delete, subscriber list + subscribe/unsubscribe, publish panel |
| `src/app/analytics/page.tsx` | Stats bar + activity timeline |
| `src/app/conversations/page.tsx` | Thread-grouped conversation view + message inspector |
| `src/app/graph/page.tsx` | Network Graph: force-directed canvas visualization of instances, roles, and message traffic |
| `src/app/schedules/page.tsx` | Schedules management: view, create, update, and delete scheduled message deliveries |
| `src/lib/api.ts` | Typed fetch wrappers for hub REST; `AbortSignal.timeout(10_000)` on all calls; topic wrappers: `fetchTopics`, `createTopic`, `deleteTopic`, `subscribeToTopic`, `unsubscribeFromTopic` |

---

### skill

**Purpose:** Claude Code plugin providing the collaboration protocol and MCP tool access.

Install via: `claude plugin add ./skill`

The skill includes:
- `skills/cc2cc/SKILL.md` — collaboration protocol documentation loaded into Claude Code context
- `.claude-plugin/plugin.json` — plugin manifest with metadata, required/optional env vars
- `.mcp.json` — MCP server definition pointing to `plugin/src/index.ts`
- `skills/cc2cc/patterns/` — reusable patterns: task delegation, broadcast, result aggregation, and topics
- `hooks/hooks.json` — hook manifest declaring the `SessionStart` event
- `hooks/scripts/` — hook scripts; `SessionStart` writes the Claude session ID to `.claude/.cc2cc-session-id` for stable instance identity

---

## Message Flow

The following diagram traces a message from Plugin A to Plugin B, showing how the hub, Redis, and dashboard interact at each step.

```mermaid
sequenceDiagram
    participant PA as Plugin A
    participant HUB as Hub
    participant REDIS as Redis
    participant PB as Plugin B
    participant DB as Dashboard WS

    PA->>HUB: WS action: send_message {to: B, type: task, content}
    HUB->>REDIS: RPUSH queue:B message
    HUB-->>DB: HubEvent message:sent (fan-out to all dashboard clients)

    alt Plugin B is online
        HUB->>PB: WS send (live delivery alongside queue)
        HUB-->>PA: WS ack {messageId, queued: false}
    else Plugin B is offline — message waits in Redis
        HUB-->>PA: WS ack {messageId, queued: true}
        Note over REDIS: message held in queue:B
        Note over PB,HUB: Plugin B reconnects
        HUB->>REDIS: RPOPLPUSH queue:B processing:B
        REDIS-->>HUB: message
        HUB->>PB: WS send (flushed on reconnect)
        HUB->>REDIS: LREM processing:B message
    end
```

---

## WebSocket Protocol

All WebSocket connections authenticate via query parameter: `?key=<CC2CC_HUB_API_KEY>` (Bun WS upgrade does not support Authorization headers). REST endpoints accept both `Authorization: Bearer <key>` header (preferred) and `?key=` query param (fallback).

### Plugin WebSocket Actions

Plugins connect to `/ws/plugin?key=<KEY>&instanceId=<ID>`.

All frames are JSON objects with an `action` field. Every request frame carries a `requestId` that the hub echoes in the ack — the plugin's `conn.request()` method uses this to match responses.

| Action | Payload | Ack |
|--------|---------|-----|
| `send_message` | `{ to, type, content, replyToMessageId?, metadata?, requestId }` | Direct: `{ requestId, messageId, queued, warning? }` — Role (`to: "role:<name>"`): `{ requestId, role, recipients, delivered, queued }` |
| `broadcast` | `{ type, content, metadata?, requestId }` | `{ requestId, delivered }` |
| `get_messages` | `{ limit?, requestId }` | `{ requestId, messages[] }` |
| `session_update` | `{ newInstanceId, requestId }` | `{ requestId, migrated }` |
| `set_role` | `{ role, requestId }` | `{ requestId, instanceId, role }` |
| `subscribe_topic` | `{ topic, requestId }` | `{ requestId, topic, subscribed: true }` |
| `unsubscribe_topic` | `{ topic, requestId }` | `{ requestId, topic, unsubscribed: true }` or `{ requestId, error }` |
| `publish_topic` | `{ topic, type, content, persistent?, metadata?, requestId }` | `{ requestId, delivered, queued }` |
| `create_schedule` | `{ name, expression, target, messageType, content, persistent?, metadata?, maxFireCount?, expiresAt?, requestId }` | Full `Schedule` object |
| `list_schedules` | `{ requestId }` | `{ requestId, schedules[] }` |
| `get_schedule` | `{ scheduleId, requestId }` | Full `Schedule` object |
| `update_schedule` | `{ scheduleId, ...updatable fields, requestId }` | Updated `Schedule` object |
| `delete_schedule` | `{ scheduleId, requestId }` | `{ requestId, deleted: true, scheduleId }` |

Inbound messages from the hub arrive as MCP `notifications/claude/channel` notifications:

```xml
<channel source="cc2cc" from="alice@server:api/uuid" type="task" message_id="abc123" reply_to="" topic="">
  Message body here
</channel>
```

The `topic` attribute is present only when the message was delivered via a topic.

### Dashboard WebSocket Events

Dashboards connect to `/ws/dashboard?key=<KEY>` and receive a stream of `HubEvent` objects. All events include a `timestamp` (ISO 8601) field.

| Event | Payload | Trigger |
|-------|---------|---------|
| `instance:joined` | `{ instanceId, timestamp }` | Plugin connects |
| `instance:left` | `{ instanceId, timestamp }` | Plugin disconnects |
| `instance:removed` | `{ instanceId, timestamp }` | Instance deleted via `DELETE /api/instances/:id` |
| `instance:session_updated` | `{ oldInstanceId, newInstanceId, migrated, timestamp }` | Plugin session ID changes (e.g. `/clear`) |
| `instance:role_updated` | `{ instanceId, role, timestamp }` | Instance calls `set_role` |
| `message:sent` | `{ message, timestamp }` | Direct message routed by the hub |
| `broadcast:sent` | `{ from, content, type?, timestamp }` | Broadcast sent to all online instances |
| `queue:stats` | `{ instanceId, depth, timestamp }` | Queue depth change for an instance |
| `topic:created` | `{ name, createdBy, timestamp }` | New topic created |
| `topic:deleted` | `{ name, timestamp }` | Topic deleted |
| `topic:subscribed` | `{ name, instanceId, timestamp }` | Instance subscribes to a topic |
| `topic:unsubscribed` | `{ name, instanceId, timestamp }` | Instance unsubscribes from a topic |
| `topic:message` | `{ name, message, persistent, delivered, queued, timestamp }` | Message published to a topic |
| `schedule:created` | `{ schedule, timestamp }` | New schedule created |
| `schedule:updated` | `{ schedule, timestamp }` | Schedule modified |
| `schedule:deleted` | `{ scheduleId, reason?, timestamp }` | Schedule deleted |
| `schedule:fired` | `{ scheduleId, scheduleName, fireCount, nextFireAt, timestamp }` | Schedule fired a message |

---

## REST API

The hub exposes a REST API on port 3100. All endpoints except `GET /health` require authentication via `Authorization: Bearer <CC2CC_HUB_API_KEY>` header (preferred) or `?key=<CC2CC_HUB_API_KEY>` query param (fallback).

Endpoint groups:

- **Health:** `GET /health` — no auth required
- **Instances:** list, ping, and remove registered instances
- **Stats:** message counts and queue depths
- **Queue:** flush an instance's queue (admin)
- **Topics:** create, delete, subscribe, unsubscribe, list subscribers, and publish
- **Schedules:** CRUD operations on scheduled message deliveries (`/api/schedules`)

> **Note:** There are no REST endpoints for `send_message` or `broadcast`. All direct message delivery goes through the plugin WebSocket connection.

For the full endpoint reference with request/response shapes and examples, see [REST_API.md](REST_API.md).

---

## Queue Architecture

Each instance has two Redis keys:

| Key | Purpose |
|-----|---------|
| `queue:{instanceId}` | Pending messages waiting for delivery |
| `processing:{instanceId}` | In-flight messages being delivered (RPOPLPUSH target) |

**Delivery flow:**

1. Sender submits `send_message` → hub `RPUSH queue:B message`
2. If B is online, hub also delivers the message live over WS (message remains in queue)
3. On reconnect, hub flushes the queue: `RPOPLPUSH queue:B processing:B`, sends over WS, then `LREM processing:B message`
4. On hub crash/restart, `replayProcessing` moves `processing:B` back to `queue:B`

**Startup recovery:**

On hub startup, two Redis scans run in parallel before any WS connections are accepted:

1. **Registry re-hydration** — SCAN for `instance:*` keys and populate the in-memory map with offline entries so `GET /api/instances` is immediately accurate
2. **Processing replay** — SCAN for `processing:*` keys and RPOPLPUSH each entry back to its `queue:*` key, restoring the at-least-once delivery guarantee after a hub crash

**Limits:**

- Max 1 000 messages per queue
- Queue TTL: 24 h
- Broadcast is fire-and-forget — offline instances do not receive broadcast messages
- Broadcast rate limit: 1 per source instance per 5 seconds

---

## Design Invariants

These invariants hold across the entire system. Violating any of them will break routing, delivery, or security guarantees.

**Instance IDs are ephemeral.**
Each plugin start generates a new session-based ID. Never cache full instance IDs across sessions — always call `list_instances()` to get current IDs before sending.

**`from` is server-stamped.**
The hub ignores any `from` field in client frames and stamps it from the sender's registered identity. Clients cannot spoof each other's identity.

**`broadcast` is routing, not a message type.**
`MessageType` enum values are `task | result | question | ack | ping`. Broadcast fan-out is triggered when `message.to === 'broadcast'`, not by a dedicated type.

**WebSocket auth is query-param only.**
Both `/ws/plugin` and `/ws/dashboard` authenticate via `?key=<CC2CC_HUB_API_KEY>`. REST endpoints additionally accept `Authorization: Bearer <key>` header (preferred), falling back to the `?key=` query param.

**Plugin connections are rate-limited.**
Each plugin WebSocket connection is limited to 60 messages per 10-second sliding window. Excess frames receive a 429 error response. The rate-limiter map is bounded to 10 000 entries with stale-entry eviction to prevent memory growth.

**Queue delivery is at-least-once.**
The RPOPLPUSH pattern ensures a message is never lost between "popped from queue" and "acked by recipient". Crash recovery replays the `processing:` key.

**Broadcast is fire-and-forget.**
Messages sent to `to: 'broadcast'` fan out over live WS connections only — not queued. Offline instances will not receive them.

**`role:<name>` is fan-out routing.**
When `send_message` receives `to: "role:<name>"`, the hub fans out to every instance whose role matches, excluding the sender. Each recipient gets its own envelope with a unique `messageId`. Returns `{ role, recipients, delivered, queued }`.

**Hub nudges role-less instances on connect.**
When a plugin connects and has no role set in the registry, the hub sends a system `ping` message (from a synthetic `system@hub:cc2cc/<uuid>` identity) prompting the agent to call `set_role` if it has been assigned a role. This nudge ensures agents with system-prompt-assigned roles announce themselves immediately without waiting for a user message.

**All message delivery is WebSocket-only.**
There are no REST endpoints for `send_message` or `broadcast`. The hub's REST API is for metadata (instance list, stats, ping, remove), topic management, and topic publishing only.

---

## Related Documentation

- [README.md](../README.md) — Quick start, configuration, and installation
- [Documentation Style Guide](DOCUMENTATION_STYLE_GUIDE.md) — Standards for all project documentation
- [cc2cc Skill](../skill/skills/cc2cc/SKILL.md) — Full collaboration protocol for Claude Code instances
- [Task Delegation Pattern](../skill/skills/cc2cc/patterns/task-delegation.md) — How to delegate work to peer instances
- [Broadcast Pattern](../skill/skills/cc2cc/patterns/broadcast.md) — When and how to use broadcast messaging
- [Result Aggregation Pattern](../skill/skills/cc2cc/patterns/result-aggregation.md) — Collecting results from multiple peers
- [Topics Pattern](../skill/skills/cc2cc/patterns/topics.md) — Pub/sub topic messaging between instances
