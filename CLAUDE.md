# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

cc2cc (Claude-to-Claude) is a hub-and-spoke system that lets Claude Code instances on a LAN communicate via typed messages. A central hub (Bun + Hono + Redis) receives WebSocket connections from plugin instances, routes messages through per-instance Redis queues, and streams events to a monitoring dashboard.

## Commands

```bash
# Run all checks (format → lint → typecheck → test) — required before committing
make checkall

# Individual checks
make fmt        # biome format (hub/plugin/shared) + biome via dashboard
make lint       # biome lint (hub/plugin/shared) + eslint (dashboard)
make typecheck  # tsc --noEmit across all workspaces
make test       # bun test (hub/plugin/shared) + jest (dashboard)

# Dev workflow
make dev-redis      # start Redis only (docker)
make dev-hub        # bun --watch hub/src/index.ts
make dev-dashboard  # next dev -p 8029 --webpack

# Docker (hub + redis + dashboard)
make docker-up
make docker-down
```

**Running a single test file:**
```bash
# hub, plugin, shared — bun test
cd hub && bun test tests/queue.test.ts

# dashboard — jest (NOT bun test — dashboard uses jsdom via Jest)
cd dashboard && bun run test -- --testPathPattern=ws-provider
```

**Important:** The dashboard uses Jest + jsdom for tests. Never run `bun test` inside `dashboard/` — it bypasses Jest and fails with DOM errors. Always use `bun run test` (which calls the `jest` script).

**Next.js must use `--webpack` flag.** Turbopack (the default in Next.js 16) doesn't resolve `@cc2cc/shared`'s ESM `.js` imports to `.ts` source files. All `next` commands already include `--webpack`.

## Architecture

```
cc2cc/
├── packages/shared/   @cc2cc/shared — types, Zod schemas, HubEvent shapes
├── hub/               Bun + Hono server, port 3100
├── plugin/            MCP stdio server — one per Claude Code session
├── dashboard/         Next.js 16 monitoring UI, port 8029
└── skill/             Markdown collaboration skill + plugin.json manifest
```

### Message Flow

1. **Plugin connects** to hub at `ws://hub:3100/ws/plugin?key=<API_KEY>&instanceId=<id>`
2. **Hub flushes** any queued messages atomically via RPOPLPUSH before entering live mode
3. **Plugin calls** MCP tools → hub REST endpoints (`/api/messages`, `/api/broadcast`, etc.)
4. **Hub routes** the message: queues it in Redis for the recipient (`queue:{instanceId}`), delivers live over WS if recipient is connected, and emits a `HubEvent` to all dashboard clients
5. **Inbound messages** arrive at the plugin as `notifications/claude/channel` — rendered by Claude Code as `<channel source="cc2cc" ...>` XML tags in context

### Key Design Invariants

**Instance ID format:** `username@host:project/uuidv4` — generated fresh on each plugin start. Never cache across sessions; always call `list_instances()` for current IDs.

**`from` is server-stamped.** The hub ignores any `from` field in client frames and stamps it from the sender's registered identity.

**`broadcast` is routing, not a type.** `MessageType` enum values are `task | result | question | ack | ping`. Broadcast fan-out is triggered by `message.to === 'broadcast'`.

**WebSocket auth is query-param only.** Both `/ws/plugin` and `/ws/dashboard` authenticate via `?key=<CC2CC_HUB_API_KEY>`. Authorization headers are not used (Bun WS upgrade doesn't support them).

**Queue delivery is at-least-once.** The hub uses RPOPLPUSH to atomically move messages to a `processing:{id}` key before delivery; on crash recovery, `replayProcessing` re-queues unacked entries.

**Broadcast is fire-and-forget.** Messages sent to `to: 'broadcast'` are fanned out over live WS connections only — not queued in Redis. Offline instances will not receive them. Rate limit: 1 per instance per 5 seconds.

**Topics are global and persistent.** Each instance auto-joins its project topic on connect (e.g. `cc2cc` for `username@host:cc2cc/uuid`). Topic subscriptions survive disconnects and are migrated to the new instanceId on `/clear`. `publish_topic` with `persistent: true` queues for offline subscribers; `persistent: false` is live-only. An instance cannot unsubscribe from its auto-joined project topic.

**`Message.to` accepts a topic sentinel.** The `to` field can be `InstanceId | "broadcast" | \`topic:\${string}\``. Consumers branching on `msg.to` must guard with `msg.to.startsWith("topic:")` alongside the `"broadcast"` check.

**`subscriptions:sync` is a hub push frame.** After connect (and after session migration), the hub sends `{ action: "subscriptions:sync", topics: string[] }` with no `requestId`. The plugin intercepts this before the request/reply correlator; the dashboard WS handler returns early on it.

**Scheduled messages use a fixed system sender.** `SYSTEM_SENDER_ID` (`system@hub:scheduler/00000000-0000-0000-0000-000000000000`) is stamped on all scheduler-fired messages. Recipients identify scheduled messages via this sender and `metadata.scheduleId`.

**Minimum schedule interval is 1 minute.** Enforced at creation time by computing the gap between the next two cron fires. The scheduler polls Redis every 30 seconds.

**Missed schedule fires are skipped.** On hub restart, schedules advance to the next future fire time — past fires are not retroactively sent.

**Offline instances expire from Redis after 1 hour.** Online instances retain a 24h TTL; when a plugin disconnects, the TTL is shortened to 1h (`OFFLINE_TTL_SECONDS`). Reconnecting restores the full 24h TTL. Manual removal via `DELETE /api/instances/:id` is immediate.

**Queue flush is deferred 5s on connect.** Channel notifications sent before Claude Code finishes initializing are silently dropped. The queue flush and wake-up nudge are both delayed 5 seconds after plugin connect to ensure the MCP transport is ready.

### packages/shared

No build step — imported directly as TypeScript source by all other workspaces. Central source of truth for:
- `MessageType` enum and `Message` / `InstanceInfo` / `TopicInfo` interfaces (`types.ts`)
- Zod schemas for all message shapes and tool inputs (`schema.ts`) — uses `z.nativeEnum(MessageType)` for enum alignment
- `HubEvent` discriminated union for dashboard WebSocket events (`events.ts`) — includes 6 topic/role events and 4 schedule events: `schedule:created`, `schedule:updated`, `schedule:deleted`, `schedule:fired`

**Zod version is pinned to `^3`.** Do not upgrade to v4 — it is incompatible with the shared schemas.

### hub/

- `config.ts` — env: `CC2CC_HUB_PORT` (3100), `CC2CC_HUB_API_KEY` (required), `CC2CC_REDIS_URL`
- `registry.ts` — in-memory `Map` of live connections + Redis presence TTLs (24h online, 1h offline via `OFFLINE_TTL_SECONDS`); `role?: string` stored per entry; `setRole()` re-writes Redis with EX 86400
- `queue.ts` — RPOPLPUSH-based at-least-once delivery; max 1000 msgs/queue; daily stats counter (`stats:messages:today`) with EXPIREAT midnight UTC
- `broadcast.ts` — `BroadcastManager`: in-memory fan-out + per-instance 5s rate limiter
- `topic-manager.ts` — all topic Redis operations; exports `topicManager` singleton and `parseProject(instanceId)` helper; Redis keys: `topic:{name}` (hash), `topic:{name}:subscribers` (Set), `instance:{id}:topics` (Set reverse index)
- `scheduler.ts` — `Scheduler` class: Redis ZSET polling (30s), cron-parser-based scheduling, CRUD operations, startup recovery; system sender: `SYSTEM_SENDER_ID`; supports simple interval syntax (`every 5m`) and standard 5-field cron
- `ws-handler.ts` — plugin/dashboard WS lifecycle; message routing; emits `HubEvent` to `dashboardClients` set; handles WS frame actions: `send`, `broadcast`, `get_messages`, `ping`, `session_update`, `set_role`, `subscribe_topic`, `unsubscribe_topic`, `publish_topic`, `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule`
- `api.ts` — REST handlers; `GET /health` is the only unauthenticated endpoint; all others require `?key=`; includes schedule CRUD at `/api/schedules`

### plugin/

- `config.ts` — assembles `instanceId` from env vars; generates fresh UUIDv4 each start
- `connection.ts` — `HubConnection`: WS client using `ws` package; exponential backoff (1s/×2/30s max); `request()` method with 10s timeout; intercepts `subscriptions:sync` push frames before the request/reply correlator
- `channel.ts` — converts hub `message:sent` events to `notifications/claude/channel` MCP notifications; adds `topic` attribute when `message.topicName` is set
- `tools.ts` — 15 MCP tools: `list_instances`, `send_message`, `broadcast`, `get_messages`, `ping`, `set_role`, `subscribe_topic`, `unsubscribe_topic`, `list_topics`, `publish_topic`, `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule`

### dashboard/

- `WsProvider` (`components/ws-provider/`) — TWO WebSocket connections:
  - `/ws/dashboard` — receive-only hub event stream; accumulates `instances` Map, `topics` Map, `feed[]` (capped at 500); dispatches all `HubEvent` types including 6 new topic/role events
  - `/ws/plugin` — registered as `dashboard@<hostname>:dashboard/<uuid>`; used for `sendMessage`/`sendBroadcast`; `sendPublishTopic` goes via REST (`POST /api/topics/:name/publish`)
- Dashboard instanceId generated once per browser session from `sessionStorage`; stable across re-renders, fresh per tab
- `app/page.tsx` — Command Center: 3-group sidebar (Topics/Online/Offline), feed filter bar, instance subscriptions panel, manual send bar
- `app/topics/page.tsx` — 3-panel Topics page: topic list + create/delete, subscriber list + subscribe/unsubscribe, publish panel
- `app/analytics/page.tsx` — Stats bar + activity timeline
- `app/conversations/page.tsx` — Thread-grouped view; topic messages are excluded from thread grouping
- `app/schedules/page.tsx` — 3-panel Schedules page: schedule list + create, detail/edit panel, fire history
- `lib/api.ts` — typed fetch wrappers; `hubUrl(path)` helper constructs all URLs; topic wrappers: `fetchTopics`, `createTopic`, `deleteTopic`, `subscribeToTopic`, `unsubscribeFromTopic`; schedule wrappers: `fetchSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`
- Instance sidebar: sorted Topics → Online → Offline alphabetically within each group; role badge shown on online instances

### skill/

Install via: `claude plugin add ./skill`

Required env: `CC2CC_HUB_URL`, `CC2CC_API_KEY`
Optional env: `CC2CC_USERNAME`, `CC2CC_HOST`, `CC2CC_PROJECT`

**IMPORTANT:** Bump `skill/.claude-plugin/plugin.json` `version` after every change to `skill/`. The plugin system caches by version — without a bump, reinstall silently skips the update. After bumping, also update `sync-plugin-cache.sh` to point at the new version directory (`~/.claude/plugins/cache/probello-local/cc2cc/<version>/`), then run `bash sync-plugin-cache.sh` to push the change into the active cache immediately.

## Environment Variables

| Variable | Component | Required | Default |
|----------|-----------|----------|---------|
| `CC2CC_HUB_API_KEY` | hub | yes | — |
| `CC2CC_HUB_PORT` | hub | no | 3100 |
| `CC2CC_REDIS_URL` | hub | no | `redis://localhost:6379` |
| `CC2CC_HUB_URL` | plugin | yes | — |
| `CC2CC_API_KEY` | plugin | yes | — |
| `CC2CC_USERNAME` | plugin | no | `$USER` |
| `CC2CC_HOST` | plugin | no | `$HOSTNAME` |
| `CC2CC_PROJECT` | plugin | no | `basename(cwd)` |
| `CC2CC_SESSION_ID` | plugin | no | polls `.claude/.cc2cc-session-id`, then UUIDv4 |
| `NEXT_PUBLIC_CC2CC_HUB_WS_URL` | dashboard | no | `ws://localhost:3100` |
| `NEXT_PUBLIC_CC2CC_HUB_API_KEY` | dashboard | no | — |
| `CC2CC_HOST_LAN_IP` | docker-compose | no | `localhost` |
