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

### Fixed
- `dashboard/.env.local.example` variable names corrected (was `NEXT_PUBLIC_HUB_WS_URL`, now `NEXT_PUBLIC_CC2CC_HUB_WS_URL`)
- `topicManager` public methods documented with JSDoc; `unsubscribe()` `force` parameter now discoverable
- Misleading "Dashboard clients are receive-only in v1" comment updated in `ws-handler.ts`

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
