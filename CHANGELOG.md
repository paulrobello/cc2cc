# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Table of Contents

- [Version Note](#version-note)
- [Unreleased](#unreleased)
- [0.2.2 — skill](#022--skill)
- [0.1.0 — monorepo](#010--monorepo)

---

## Version Note

The project maintains two version numbers that serve different purposes:

- **`skill/.claude-plugin/plugin.json` version** (`0.2.2`) — the Claude Code plugin
  version. This is the version users install via `claude plugin add`. It must be bumped
  after every change to the `skill/` directory because the plugin system caches by
  version number.

- **`package.json` (root) version** (`0.1.0`) — the monorepo/release version. This
  tracks overall hub + plugin + dashboard releases intended for Docker deployment.

The two versions are intentionally separate and will diverge over time. The skill
version advances more frequently (each skill or pattern change requires a bump);
the monorepo version advances with hub/plugin/dashboard releases.

---

## [Unreleased]

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

[Unreleased]: https://github.com/paulrobello/cc2cc/compare/v0.1.0...HEAD
[0.2.2]: https://github.com/paulrobello/cc2cc/releases/tag/skill-v0.2.2
[0.1.0]: https://github.com/paulrobello/cc2cc/releases/tag/v0.1.0
