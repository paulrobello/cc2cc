# Scheduled Messages Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Hub scheduler, REST/WS APIs, plugin MCP tools, dashboard UI

## Overview

Add a hub-managed scheduler that fires messages to instances, topics, broadcasts, and roles on cron-like intervals. Supports both recurring schedules and one-shot future-dated messages. Useful for nudges, reminders, and periodic check-ins.

## Core Design Decisions

- **Polling strategy:** Redis ZSET polling at 30-second intervals
- **Minimum interval:** 1 minute (enforced at creation time)
- **Expression formats:** Standard 5-field cron AND simple interval syntax (`every 5m`, `every 1d at 09:00`)
- **Sender identity:** Fixed system identity `system@hub:scheduler/00000000-0000-0000-0000-000000000000`
- **Persistence:** Global, Redis-backed, survives hub restarts. Auto-expires via `maxFireCount` or `expiresAt`.
- **Missed fires:** Skipped on hub restart, not retroactively sent. Schedule advances to next window.
- **New dependency:** `cron-parser` for cron expression parsing and next-fire computation

## Data Model

### Schedule Interface

```typescript
interface Schedule {
  scheduleId: string;           // UUIDv4
  name: string;                 // human-readable label, 1-100 chars
  expression: string;           // canonical cron expression (simple intervals converted to cron)
  target: InstanceId | "broadcast" | `topic:${string}` | `role:${string}`;
  messageType: MessageType;     // task | result | question | ack | ping
  content: string;              // max 64 KiB
  metadata?: Record<string, unknown>; // max 32 keys, 4 KiB serialized
  persistent: boolean;          // for topic targets: queue for offline subscribers?
  createdBy: string;            // instanceId of creator (audit trail only, not used as sender)
  createdAt: string;            // ISO 8601
  nextFireAt: string;           // ISO 8601
  lastFiredAt?: string;         // ISO 8601
  fireCount: number;            // times fired so far
  maxFireCount?: number;        // optional cap, auto-deletes when reached
  expiresAt?: string;           // optional end date, auto-deletes when passed
  enabled: boolean;             // pause/resume without deleting
}
```

### Redis Keys

| Key | Type | Description |
|-----|------|-------------|
| `schedule:{scheduleId}` | Hash | All schedule fields |
| `schedules:index` | Set | All schedule IDs |
| `schedules:pending` | Sorted Set | Score = next-fire epoch (ms), member = scheduleId. Only enabled schedules. |

### System Sender Identity

```
system@hub:scheduler/00000000-0000-0000-0000-000000000000
```

Fixed, deterministic, never changes. Recipients can identify scheduled messages by this sender and by `metadata.scheduleId`.

### Validation Constraints

- **Name:** 1-100 characters
- **Content:** max 64 KiB (same as regular messages)
- **Metadata:** max 32 keys, primitives only, max 4 KiB serialized (same as regular messages)
- **Minimum interval:** 1 minute, enforced by computing gap between next two cron fires

## Simple Interval Syntax

In addition to standard 5-field cron expressions, the system accepts a friendly shorthand:

| Input | Converted Cron | Notes |
|-------|---------------|-------|
| `every 5m` | `*/5 * * * *` | Every 5 minutes |
| `every 2h` | `0 */2 * * *` | Every 2 hours, on the hour |
| `every 1d` | `0 0 * * *` | Daily at midnight UTC |
| `every 1d at 09:00` | `0 9 * * *` | Daily at 09:00 UTC |
| `every 12h` | `0 */12 * * *` | Every 12 hours |

The `expression` field always stores the canonical cron form. Simple interval syntax is parsed and converted at creation time.

Validation rejects any expression that resolves to sub-minute intervals.

## Hub Scheduler Module

### New file: `hub/src/scheduler.ts`

Exports a `Scheduler` class:

- **Constructor:** Takes Redis client, registry, broadcastManager, topicManager references
- **`start()`:** Kicks off a 30-second `setInterval` poll loop
- **`stop()`:** Clears the interval for graceful shutdown

### Poll Cycle

1. `ZRANGEBYSCORE schedules:pending -inf <now_ms>` — fetch all due schedule IDs
2. For each due schedule:
   a. Read Hash from `schedule:{id}`
   b. Skip if `enabled === false` (shouldn't be in ZSET, but defensive check)
   c. Build message envelope with system sender, schedule's target/type/content/metadata
   d. Inject `metadata.scheduleId` and `metadata.scheduleName`
   e. Route through existing infrastructure:
      - Direct instance or `role:*` target -> `pushMessage()`
      - `broadcast` target -> `broadcastManager.broadcast()`
      - `topic:*` target -> `topicManager.publishToTopic()`
   f. Update Hash: `lastFiredAt`, increment `fireCount`, compute `nextFireAt` via cron-parser
   g. Check expiry: if `fireCount >= maxFireCount` or `now >= expiresAt`:
      - Remove from `schedules:pending` and `schedules:index`
      - Delete Hash
      - Emit `schedule:deleted` HubEvent (with reason: "expired" or "max_fires_reached")
   h. Otherwise: `ZADD schedules:pending <nextFireEpoch> <scheduleId>`
3. Emit `schedule:fired` HubEvent for each fired schedule

### Startup Recovery

On hub start, before entering the poll loop:

1. Scan `schedules:index` for all schedule IDs
2. For each schedule, read Hash and recompute `nextFireAt` if stale
3. Re-populate `schedules:pending` ZSET from enabled schedules
4. Missed fires are NOT retroactively sent — just advance to next window

## REST API

All endpoints require API key authentication (same as existing endpoints).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/schedules` | Create schedule. Returns full `Schedule` object. |
| `GET` | `/api/schedules` | List all schedules. Returns `Schedule[]`. |
| `GET` | `/api/schedules/:id` | Get single schedule. |
| `PATCH` | `/api/schedules/:id` | Update schedule fields. Returns updated `Schedule`. |
| `DELETE` | `/api/schedules/:id` | Delete schedule. Returns `{ deleted: true }`. |

### Create Schedule

Request body validated against `CreateScheduleInputSchema`:

```typescript
{
  name: string;
  expression: string;         // cron or simple interval syntax
  target: string;             // instanceId | "broadcast" | "topic:name" | "role:name"
  messageType: MessageType;
  content: string;
  persistent?: boolean;       // default false
  metadata?: Record<string, unknown>;
  maxFireCount?: number;
  expiresAt?: string;         // ISO 8601
}
```

The handler:
1. Validates and parses expression (converts simple syntax to cron)
2. Enforces minimum 1-minute interval
3. Generates scheduleId (UUIDv4)
4. Computes initial `nextFireAt`
5. Writes Hash + adds to index Set + adds to pending ZSET (if enabled)
6. Emits `schedule:created` HubEvent
7. Returns full `Schedule` object

### Update Schedule

Request body validated against `UpdateScheduleInputSchema` (all fields optional except `scheduleId` in path):

- If `expression` changes: revalidate, recompute `nextFireAt`
- If `enabled` changes to `false`: remove from `schedules:pending`
- If `enabled` changes to `true`: add to `schedules:pending` with current `nextFireAt`
- Emits `schedule:updated` HubEvent

## WebSocket Frame Actions

Added to `hub/src/ws-handler.ts`, following existing request/reply correlation pattern:

| Action | Input | Response |
|--------|-------|----------|
| `create_schedule` | Same as REST create body | Full `Schedule` object |
| `list_schedules` | (none) | `Schedule[]` |
| `get_schedule` | `{ scheduleId }` | `Schedule` |
| `update_schedule` | `{ scheduleId, ...partial }` | Updated `Schedule` |
| `delete_schedule` | `{ scheduleId }` | `{ deleted: true }` |

## Plugin MCP Tools

Added to `plugin/src/tools.ts`, each delegating to `HubConnection.request()`:

| Tool | Description |
|------|-------------|
| `create_schedule` | Create a recurring or one-shot scheduled message |
| `list_schedules` | List all active schedules |
| `get_schedule` | Get details of a specific schedule |
| `update_schedule` | Modify a schedule (pause, change expression, etc.) |
| `delete_schedule` | Remove a schedule |

Tool descriptions include examples of both cron and simple interval syntax so Claude instances can use them effectively.

## HubEvents

Added to `packages/shared/src/events.ts`:

| Event | Payload | Emitted When |
|-------|---------|--------------|
| `schedule:created` | Full `Schedule` object | Schedule created |
| `schedule:updated` | Full `Schedule` object | Schedule modified |
| `schedule:deleted` | `{ scheduleId, reason?: string }` | Schedule removed or expired |
| `schedule:fired` | `{ scheduleId, scheduleName, fireCount, nextFireAt }` | Scheduler fires a message |

## Shared Schemas

Added to `packages/shared/src/schema.ts`:

- `ScheduleSchema` — full `Schedule` object validation
- `CreateScheduleInputSchema` — creation input validation
- `UpdateScheduleInputSchema` — partial update validation

Added to `packages/shared/src/types.ts`:

- `Schedule` interface
- `CreateScheduleInput` type (inferred from schema)
- `UpdateScheduleInput` type (inferred from schema)

## Dashboard

### WsProvider Changes

- New `schedules` state: `Map<string, Schedule>`
- Event handler processes `schedule:created`, `schedule:updated`, `schedule:deleted`, `schedule:fired`
- Initial load: `GET /api/hub/schedules` on mount
- `schedule:fired` updates `lastFiredAt` and `fireCount` on the in-memory schedule

### New Page: `/schedules`

Three-panel layout consistent with `/topics` page:

1. **Left panel — Schedule list:**
   - All schedules sorted by next fire time
   - Each row: name, target badge (instance/topic/broadcast/role), human-readable expression, relative next-fire time ("in 4m"), enabled toggle, delete button
   - Visual distinction for disabled schedules (dimmed)

2. **Center panel — Schedule detail/edit:**
   - Selected schedule's full info
   - Editable fields: name, expression, target, content, messageType, persistent, maxFireCount, expiresAt, enabled
   - Save button triggers `PATCH /api/hub/schedules/:id`

3. **Right panel — Fire history:**
   - Recent `schedule:fired` events for the selected schedule
   - Shows timestamps and cumulative fire count
   - In-memory only (from event stream during this dashboard session, not persisted)

### Send Bar Enhancement

- New "Schedule this" toggle button next to the existing send button
- When activated, expands an inline form below the send bar:
  - Expression input (text field with placeholder showing syntax examples)
  - Optional name field
  - Optional maxFireCount / expiresAt fields
- Submitting creates a schedule via `POST /api/hub/schedules` using the send bar's current target, message type, and content
- Toggle deactivates after successful creation, returning to normal send mode

## Testing

### Hub: `hub/tests/scheduler.test.ts`

- Poll cycle fires due schedules and advances `nextFireAt`
- Expired schedules (maxFireCount, expiresAt) are auto-deleted
- Minimum 1-minute interval enforcement rejects sub-minute expressions
- Simple interval syntax converts to correct cron expressions
- Disabled schedules are skipped during poll
- Startup recovery recomputes stale `nextFireAt` values
- Messages routed correctly per target type (direct, broadcast, topic, role)
- System sender identity stamped on all fired messages
- `metadata.scheduleId` and `metadata.scheduleName` present on fired messages

### Hub: `hub/tests/schedule-api.test.ts`

- CRUD operations via REST endpoints
- CRUD operations via WS frame actions
- Validation rejects invalid cron expressions, missing required fields, sub-minute intervals
- Auth required on all endpoints

### Plugin: `plugin/tests/schedule-tools.test.ts`

- All 5 MCP tools delegate correctly to HubConnection
- Input validation matches shared schemas

### Dashboard: `dashboard/src/__tests__/schedule*.test.ts`

- WsProvider processes all 4 schedule event types
- Schedules page renders list, detail, and history panels
- Send bar "Schedule this" toggle creates schedule via API
- Initial load fetches schedules on mount

### Shared: `packages/shared/tests/schedule-schema.test.ts`

- Schema validation for create/update inputs
- Simple interval parsing edge cases
- Expression validation rejects sub-minute intervals

## Files Changed

| Component | Files | Nature |
|-----------|-------|--------|
| `packages/shared/src/types.ts` | Modified | Add `Schedule` interface and related types |
| `packages/shared/src/schema.ts` | Modified | Add schedule Zod schemas |
| `packages/shared/src/events.ts` | Modified | Add 4 schedule HubEvent types |
| `hub/src/scheduler.ts` | **New** | Scheduler class with poll loop and fire logic |
| `hub/src/api.ts` | Modified | Add 5 REST endpoints |
| `hub/src/ws-handler.ts` | Modified | Add 5 WS frame actions |
| `hub/src/index.ts` | Modified | Initialize and start scheduler |
| `hub/package.json` | Modified | Add `cron-parser` dependency |
| `plugin/src/tools.ts` | Modified | Add 5 MCP tools |
| `plugin/src/connection.ts` | Modified | Wire up new actions |
| `dashboard/src/components/ws-provider/` | Modified | Add schedules state, event handling, initial load |
| `dashboard/src/app/schedules/page.tsx` | **New** | Schedules management page |
| `dashboard/src/components/schedule-list/` | **New** | Schedule list panel component |
| `dashboard/src/components/schedule-detail/` | **New** | Schedule detail/edit panel component |
| `dashboard/src/components/schedule-history/` | **New** | Fire history panel component |
| `dashboard/src/components/manual-send-bar/` | Modified | Add "Schedule this" toggle |
| `dashboard/src/lib/api.ts` | Modified | Add schedule API wrappers |
| `dashboard/src/app/layout.tsx` | Modified | Add /schedules to sidebar nav |
| `skill/` | Modified | Update skill docs to mention schedule tools |
