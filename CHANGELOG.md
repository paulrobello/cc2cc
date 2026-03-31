# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Table of Contents

- [Version Note](#version-note)
- [0.3.0 — hub/plugin/dashboard](#030--hubplugindashboard)
- [0.2.5 — hub](#025--hub)
- [0.2.4 — plugin/dashboard](#024--plugindashboard)
- [0.2.3 — skill/plugin](#023--skillplugin)
- [Unreleased](#unreleased)
- [0.2.2 — skill](#022--skill)
- [0.2.1 — hub/plugin/dashboard](#021--hubplugindashboard)
- [0.1.0 — monorepo](#010--monorepo)

---

## Version Note

The project maintains two version numbers that serve different purposes:

- **`skill/.claude-plugin/plugin.json` version** (`0.2.4`) — the Claude Code plugin
  version. This is the version users install via `claude plugin add`. It must be bumped
  after every change to the `skill/` directory because the plugin system caches by
  version number.

- **`package.json` (root) version** (`0.3.0`) — the monorepo/release version. This
  tracks overall hub + plugin + dashboard releases intended for Docker deployment.

The two versions are intentionally separate and will diverge over time. The skill
version advances more frequently (each skill or pattern change requires a bump);
the monorepo version advances with hub/plugin/dashboard releases.

---

## [0.3.0] — hub/plugin/dashboard

### Added
- **Scheduled messages:** hub-managed scheduler that fires messages to instances, topics, broadcasts, and roles on cron-like intervals. Supports standard 5-field cron expressions and simple interval syntax (`every 5m`, `every 1d at 09:00`). Minimum interval: 1 minute. Schedules persist in Redis, survive hub restarts, and auto-expire via `maxFireCount` or `expiresAt`.
  - New `Scheduler` class in `hub/src/scheduler.ts` — Redis ZSET polling (30s), `cron-parser`-based fire time computation, startup recovery
  - 5 REST endpoints: `POST/GET/GET/:id/PATCH/:id/DELETE/:id` at `/api/schedules`
  - 5 WS frame actions: `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule`
  - 5 MCP plugin tools: `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule`
  - 4 HubEvent types: `schedule:created`, `schedule:updated`, `schedule:deleted`, `schedule:fired`
  - `Schedule` interface, `SYSTEM_SENDER_ID` constant, and 3 Zod schemas in `@cc2cc/shared`
- **Empty topic auto-expiry:** topics with `autoExpire: true` (default) are auto-deleted after `CC2CC_TOPIC_EMPTY_TTL` seconds (default 3600) when their last subscriber leaves. Project topics default to `autoExpire: false`. Pending deletions cancelled when a new subscriber joins. Recovery on hub restart re-schedules deletions for any empty topics.
- **Dashboard /schedules page:** 3-panel layout — schedule list with create form, detail/edit panel, fire history timeline
- **Send bar "Schedule this" toggle:** expand inline schedule form from the manual send bar on the Command Center page
- **Dashboard Schedules nav tab** with Clock icon

### Fixed
- **Queue flush timing:** deferred queue flush 5s on plugin connect to wait for Claude Code MCP transport initialization — previously queued messages were drained from Redis but silently dropped because channel notifications arrived before Claude Code was ready
- **Command page sidebar scroll:** ScrollArea root now has `overflow-hidden` so the instance list scrolls within its flex container

### Changed
- **Offline instance TTL reduced from 24h to 1h:** `registry.markOffline()` now async, shortens Redis key TTL to `OFFLINE_TTL_SECONDS` (3600). Online instances retain 24h TTL. Reconnecting restores full TTL.
- Plugin now exposes 15 MCP tools (was 10)
- `@cc2cc/shared` HubEvent union expanded with 4 schedule event types

### Dependencies
- Added `cron-parser@4` to hub

---

## [0.2.5] — hub/dashboard

### Added
- **Role nudge on connect:** hub sends a `ping`-type nudge to newly connected
  instances after a 5 s delay, prompting them to declare a role via `set_role`.
  A second wake-up nudge is always sent on plugin connect regardless of role state.
- **Activity grid enhancements:** dots colored by message type, color legend in
  header, instance labels stacked above grid and grouped by project, configurable
  time span selector (1 h / 6 h / 24 h / 7 d) with persistence via `sessionStorage`.
- **Sender role badge in message feed:** feed entries now show the sender's role
  badge inline.

### Fixed
- **Project topic auto-join crash:** plugins whose project name contained characters
  outside the topic regex (e.g. `.claude`) crashed on connect because the raw project
  name was passed directly to `createTopic`. Added `sanitizeProjectTopic()` in
  `hub/src/utils.ts` — strips leading dots/non-alphanumeric chars, replaces invalid
  chars with hyphens, and falls back to `"default"`. Applied in `onPluginOpen`,
  `syncTopicsAfterSession`, and the `unsubscribe` project-topic guard.
- **Topic cleanup on instance removal:** removing an offline instance now
  unsubscribes it from all topics and cleans up related dashboard state.
- **Dashboard hydration mismatch:** persisted time interval selector no longer
  causes React hydration errors on page load.
- **Activity timeline drift:** dots now use smooth continuous positioning instead
  of snapping to discrete grid cells.
- **Dashboard layout fixes:** message feed constrained to scroll within its
  container; recent transmissions panel no longer collapses to zero height;
  analytics message panel height restored; signals sidebar widened with role
  badges visible.

### Documentation
- Synced all docs to implementation (`a6d1701`)

### Tests
- Added unit tests for `parseProject` and `sanitizeProjectTopic` (`hub/tests/utils.test.ts`)

---

## [0.2.4] — plugin/dashboard

### Fixed
- **Team mode session collision:** session file watcher now disabled when
  `CC2CC_SESSION_ID` is set — previously all team instances in the same project
  directory watched the shared `.cc2cc-session-id` file and converged to a single
  identity, causing the dashboard to show only 1 of N instances.
- **Activity grid visibility:** cells with events now have a visible highlighted
  background and border instead of near-invisible styling; dots enlarged with glow
  effect; tooltip shows all events in the bucket (not just the first 3).

---

## [0.2.3] — skill/plugin

### Added
- `CC2CC_SESSION_ID` environment variable support in plugin — allows pre-assigning
  a stable session ID per instance, bypassing the shared session file. Enables
  team mode with multiple Claude instances in the same project directory.

---

## [Unreleased]

### Added
- Role-based routing: `send_message({ to: "role:<name>", ... })` fans out to all instances with that role — each recipient gets a unique envelope, offline instances are queued, returns `{ role, recipients, delivered, queued }`
- Network Graph dashboard page (`/graph`): canvas-based force-directed visualization of instance message flows — nodes colored by online/offline status, edge thickness proportional to message count, directional arrowheads, drag-to-pin, hover tooltips with per-instance sent/recv counts

### Changed
- Dashboard nav: added **Graph** tab with Network icon
- `send_message` result type is now a discriminated union (`SendMessageDirectResult | SendMessageRoleResult`) to accommodate role fan-out responses

### Security
- **BFF proxy pattern**: Dashboard API calls now route through Next.js server-side proxy routes — API key no longer embedded in browser bundle or exposed as `NEXT_PUBLIC_` env var
- Constrained all Zod schema input lengths: role/topic max 64, message `to`/`from` max 256, `topicName` max 64
- CORS default changed from `*` to `http://localhost:8029`; `unsafe-eval` gated behind dev mode
- Pinned Docker base images to `oven/bun:1.1.38`; added `Permissions-Policy` and `Strict-Transport-Security` headers
- `keysEqual` now pads buffers before `timingSafeEqual` to eliminate length oracle
- Rate limiter map bounded to 10K entries with stale eviction
- Dashboard WS logs frame byte-length only (no raw content); `/health` returns minimal `{ status: "ok" }`
- Redis password in docker-compose now requires explicit `CC2CC_REDIS_PASSWORD` env var
- Installed `check-secrets.sh` as pre-commit hook

### Fixed
- Extracted `event-bus.ts` to break circular import between `api.ts` and `ws-handler.ts`
- Consolidated `WS_OPEN` constant into `hub/src/constants.ts` (was duplicated in 3 files)
- Consolidated `INSTANCE_ID_RE` regex into `@cc2cc/shared` (was duplicated in shared + hub)
- Replaced N+1 Redis queries in `listTopics` with pipelined batch; added combined `GET /api/topics?includeSubscribers=true` endpoint to eliminate N+1 HTTP from dashboard
- `config.ts` throws `ConfigurationError` instead of calling `process.exit(1)` at import time
- Replaced 13 unsafe `(err as Error).message` casts with `instanceof` guards
- Plugin fetch calls now include `AbortSignal.timeout(10_000)`
- Exported `parseProject` and `toHttpUrl` from `@cc2cc/shared` — eliminated duplicate implementations
- Session migration uses `topicManager.migrateSubscriptions()` instead of direct Redis calls
- Fixed stale closure in `useReconnectingWs` via `optsRef`; removed non-null canvas assertion in graph page
- `BroadcastSentEventSchema.type` now uses `z.nativeEnum(MessageType)` instead of loose `z.string()`
- Batched Redis INCR + EXPIREAT in `pushMessage` into pipeline

### Documentation
- Added `CC2CC_DASHBOARD_ORIGIN` to README env table
- Created `docs/README.md` documentation index
- Added JSDoc to ws-handler exports, shared schemas, shared types, session-watcher module
- Fixed CONTRIBUTING.md cross-references and link paths
- Replaced duplicate REST API table in ARCHITECTURE.md with summary + link
- Assigned orphaned CHANGELOG entries to v0.2.1; removed planning doc from changelog
- Marked shipped items in ENHANCEMENTS.md; added Roadmap link in README
- Stripped version numbers from README badges; added CI placeholder badge

### Tests
- Added 38 unit tests for `ws-handler.ts` covering all action handlers, auth, rate limiting, and lifecycle events

---

## [0.2.1] — hub/plugin/dashboard

### Added
- Topics pub/sub system: named channels with persistent delivery and auto-joined project topics
- `publish_topic` MCP tool and REST endpoint
- `subscribe_topic` / `unsubscribe_topic` MCP tools
- `list_topics` MCP tool
- `set_role` MCP tool — declare instance function visible to peers and dashboard
- Dashboard Topics page: create/delete topics, manage subscriptions, publish panel
- Dashboard Conversations page: thread-grouped message view
- Dashboard Analytics page: stats bar and activity timeline
- Session migration: queued messages follow instance across `/clear` boundaries
- Interactive project slideshow (`index.html`) — deployable to GitHub Pages
- `docs/` directory with architecture reference, API reference, and guides
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`

### Changed
- Workspace layout diagram converted from ASCII art to Mermaid in `README.md` and `docs/ARCHITECTURE.md`
- Screenshots placeholder section removed from `README.md`
- `docs/DOCUMENTATION_STYLE_GUIDE.md` project name corrected to cc2cc
- `skill/.claude-plugin/plugin.json` — added `CC2CC_PROJECT` to `optionalEnv`

### Security
- Pre-commit secret guard (`scripts/check-secrets.sh`) — blocks commits containing real API keys
- `.env.example` uses clearly fake placeholder values; inline comments distinguish Docker vs local-dev Redis URLs
- LAN-only deployment warning added to `dashboard/Dockerfile` and `README.md`; BFF pattern documented
- Zod `safeParse` applied to four previously bypassed WS action handlers (`handleSetRole`, `handleSubscribeTopic`, `handleUnsubscribeTopic`, `handlePublishTopic`)
- Topic name character-set validation (`/^[a-z0-9][a-z0-9_-]{0,63}$/`) applied before all Redis key construction
- `INSTANCE_ID_RE` tightened; same pattern applied in `SessionUpdateActionSchema`
- `CC2CC_DASHBOARD_ORIGIN` env var added to restrict CORS from wildcard to dashboard URL
- 64 KB content limit (`content.max(65536)`) and `MetadataSchema` limits added to message schemas
- REST publish endpoint now server-stamps `from` (ignores client-supplied value)
- `Authorization: Bearer` header support added alongside `?key=` fallback in hub REST and dashboard fetch calls
- Per-connection WS rate limiting (60 msg / 10 s) added to hub
- Session update race condition fixed — new identity registered before old identity deregistered
- Security headers added to hub responses (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)
- CSP and security headers added to dashboard via `next.config.ts`

### Fixed
- `replayProcessing()` now called on hub startup — at-least-once delivery guarantee restored
- `GET /api/ping/:id` implemented — `ping` MCP tool no longer returns 404
- `instance:session_updated` dashboard handler added — stale offline duplicates no longer linger after `/clear`
- `parseProject` deduplicated to `hub/src/utils.ts`; `keysEqual` extracted to `hub/src/auth.ts`
- `redis.keys("topic:*")` replaced with `topics:index` Redis Set (`SMEMBERS`) — non-blocking O(1) lookup
- In-memory registry re-hydrated from Redis on startup — `/api/instances` correct immediately after restart
- `InstanceRoleUpdatedEventSchema` changed from `.min(1)` to `.string()` — role-cleared events no longer silently dropped
- Redundant `parseProject` call removed from `handleSessionUpdate`
- `AbortSignal.timeout(10_000)` added to all `dashboard/src/lib/api.ts` topic functions and `sendPublishTopic`
- `SIGTERM`/`SIGINT` graceful shutdown handler added to hub (`server.stop()` + `redis.quit()`)
- WS error response shape standardized via `wsError()` helper in `ws-handler.ts`
- Unused `_apiKey` parameter removed from `HubConnection` constructor
- Dead `sendMessage`/`sendBroadcast` REST functions removed from `dashboard/src/lib/api.ts`
- `getOnlineWsRefs()` added to registry — per-publish `Map` rebuild eliminated
- `WS_OPEN = 1` constant replaces magic literal in `ws-handler.ts`, `broadcast.ts`, `topic-manager.ts`
- Top-level `await` in `plugin/src/index.ts` wrapped in `main()` with `.catch()` for clean error reporting
- Inline Zod schemas in `plugin/src/index.ts` replaced with `@cc2cc/shared` imports
- `dashboard/.env.local.example` variable names corrected (was `NEXT_PUBLIC_HUB_WS_URL`, now `NEXT_PUBLIC_CC2CC_HUB_WS_URL`)
- `topicManager` public methods documented with JSDoc; `unsubscribe()` `force` parameter now discoverable
- Misleading "Dashboard clients are receive-only in v1" comment updated in `ws-handler.ts`
- Warning logged when malformed topic hash is filtered in `listTopics`
- `@cc2cc/shared` dependency in `dashboard/package.json` changed from `"*"` to `"workspace:*"`
- Root `typescript` pinned to `^5.9.3` (was `"latest"`)
- Docker Compose Redis healthcheck added; hub uses `service_healthy` dependency condition
- `reddit-release.md` moved to `docs/internal/`
- `SKILL.md` version aligned to `0.2.2` matching `plugin.json`; `role?` field added to `list_instances()` return docs
- Session watcher extracted from `plugin/src/index.ts` to `plugin/src/session-watcher.ts`
- `useReconnectingWs` and `usePluginWs` hooks wired into `WsProvider` — reconnect logic no longer duplicated

---

## [0.2.2] — skill

### Changed
- Updated `SKILL.md` collaboration protocol
- Added topic workflow patterns (`patterns/topics.md`)
- Updated `patterns/task-delegation.md` with topic-aware guidance
- Skill version bump required for plugin cache invalidation

---

## [0.1.0] — monorepo

### Added
- Initial hub server: Bun + Hono + Redis, port 3100
- WebSocket plugin connections with RPOPLPUSH at-least-once delivery
- WebSocket dashboard event stream
- Per-instance Redis queues; max 1000 messages; daily stats counter
- `BroadcastManager`: fan-out to all online instances with per-instance 5 s rate limit
- `@cc2cc/shared` package: `MessageType` enum, `Message` / `InstanceInfo` / `TopicInfo` types, Zod schemas, `HubEvent` discriminated union
- MCP stdio plugin with 10 tools: `list_instances`, `send_message`, `broadcast`, `get_messages`, `ping`, `set_role`, `subscribe_topic`, `unsubscribe_topic`, `list_topics`, `publish_topic`
- Next.js 16 dashboard: Command Center, instance sidebar, live feed
- Docker Compose stack: hub + Redis + dashboard
- Claude Code skill (`skill/`) installable via `claude plugin add ./skill`
- `SessionStart` hook writes Claude session ID to `.claude/.cc2cc-session-id` for stable instance identity
- Partial addressing: send to `username@host:project` without session segment

[Unreleased]: https://github.com/paulrobello/cc2cc/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/paulrobello/cc2cc/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/paulrobello/cc2cc/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/paulrobello/cc2cc/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/paulrobello/cc2cc/compare/skill-v0.2.2...v0.2.3
[0.2.2]: https://github.com/paulrobello/cc2cc/releases/tag/skill-v0.2.2
[0.2.1]: https://github.com/paulrobello/cc2cc/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/paulrobello/cc2cc/releases/tag/v0.1.0
