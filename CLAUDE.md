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
├── packages/shared/   @cc2cc/shared — types, Zod schemas, HubEvent shapes (no build step)
├── hub/               Bun + Hono server, port 3100
├── plugin/            MCP stdio server — one per Claude Code session
├── dashboard/         Next.js 16 monitoring UI, port 8029
└── skill/             Markdown collaboration skill + plugin.json manifest
```

### Message Flow

1. **Plugin connects** to hub at `ws://hub:3100/ws/plugin?key=<API_KEY>&instanceId=<id>`
2. **Hub flushes** queued messages (deferred 5s to wait for Claude Code MCP init)
3. **Plugin calls** MCP tools → hub WS actions or REST endpoints
4. **Hub routes** the message: queues in Redis, delivers live over WS if recipient connected, emits `HubEvent` to dashboards
5. **Inbound messages** arrive as `notifications/claude/channel` — rendered as `<channel source="cc2cc" ...>` XML tags

### Key Design Invariants

- **Instance ID format:** `username@host:project/uuidv4` — fresh each plugin start. Never cache; call `list_instances()`.
- **`from` is server-stamped.** Hub ignores client-supplied `from` and stamps from WS identity.
- **`broadcast` is routing, not a type.** `MessageType` = `task | result | question | ack | ping`. Broadcast triggered by `to === 'broadcast'`.
- **WebSocket auth is query-param only.** `?key=<CC2CC_HUB_API_KEY>` on both `/ws/plugin` and `/ws/dashboard`.
- **Queue delivery is at-least-once.** RPOPLPUSH atomicity + crash recovery via `replayProcessing`.
- **Broadcast is fire-and-forget.** Live WS only, not queued. Rate limit: 1/instance/5s.
- **Topics are global and persistent.** Auto-join project topic on connect. Subscriptions survive disconnects. `persistent: true` queues for offline subscribers.
- **`Message.to` accepts topic sentinels.** Guard with `msg.to.startsWith("topic:")` alongside `"broadcast"` check.
- **Scheduled messages use system sender.** `SYSTEM_SENDER_ID` stamped on all scheduler-fired messages. Identify via `metadata.scheduleId`.
- **Minimum schedule interval: 1 minute.** Scheduler polls Redis every 30s. Missed fires on restart are skipped, not retroactively sent.
- **Offline instances expire after 1 hour.** Online = 24h TTL. Reconnect restores full TTL.
- **Queue flush deferred 5s on connect.** MCP notifications sent before Claude Code init are silently dropped.

### Zod

**Pinned to `^3`.** Do not upgrade to v4 — incompatible with shared schemas.

### skill/

Install via: `claude plugin add ./skill`

Required env: `CC2CC_HUB_URL`, `CC2CC_API_KEY`
Optional env: `CC2CC_USERNAME`, `CC2CC_HOST`, `CC2CC_PROJECT`

**IMPORTANT:** Bump `skill/.claude-plugin/plugin.json` `version` after every change to `skill/`. The plugin system caches by version — without a bump, reinstall silently skips the update. After bumping, also update `sync-plugin-cache.sh` to point at the new version directory, then run `bash sync-plugin-cache.sh`.

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
