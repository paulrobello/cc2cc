# Contributing to cc2cc

This guide covers everything you need to contribute to cc2cc: environment setup, the test and lint workflow, project-specific caveats, and the PR process.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Environment Setup](#development-environment-setup)
- [Running Checks](#running-checks)
- [Testing](#testing)
- [Branch and Commit Conventions](#branch-and-commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Project-Specific Caveats](#project-specific-caveats)
- [Related Documentation](#related-documentation)

---

## Prerequisites

- [Bun](https://bun.sh) 1.1 or later
- [Docker](https://docker.com) and Docker Compose (for integration tests and the full stack)
- Redis 7 or later (or use `make dev-redis` to start one via Docker)
- Node.js is **not** required — all runtimes use Bun

---

## Development Environment Setup

```bash
# 1. Clone the repository
git clone https://github.com/paulrobello/cc2cc.git
cd cc2cc

# 2. Install all workspace dependencies
bun install

# 3. Copy the environment file and fill in the required values
cp .env.example .env
# Edit .env — at minimum, set CC2CC_HUB_API_KEY to any strong random string.
# For local dev (not Docker): leave CC2CC_REDIS_URL as redis://localhost:6379
# For Docker: use redis://:your-password@redis:6379 (hostname is 'redis')

# 4. Start Redis
make dev-redis

# 5. Start the hub (in a separate terminal)
make dev-hub

# 6. Start the dashboard (in a separate terminal)
make dev-dashboard
```

The dashboard runs at `http://localhost:8029` and the hub at `http://localhost:3100`.

---

## Running Checks

**Always run the full check suite before committing:**

```bash
make checkall
```

This runs format → lint → typecheck → test in sequence. All four must pass before a commit lands.

Individual targets:

```bash
make fmt        # biome format (hub/plugin/shared) + biome format (dashboard)
make lint       # biome lint (hub/plugin/shared) + eslint (dashboard)
make typecheck  # tsc --noEmit across all workspaces
make test       # bun test (hub/plugin/shared) + jest (dashboard)
```

---

## Testing

### Hub, Plugin, and Shared

These workspaces use Bun's built-in test runner:

```bash
# All hub tests
cd hub && bun test

# Single test file
cd hub && bun test tests/queue.test.ts
```

### Dashboard

The dashboard uses **Jest + jsdom** — not `bun test`. Running `bun test` directly in the dashboard directory bypasses Jest and fails with DOM-related errors.

```bash
# Correct way to run dashboard tests
cd dashboard && bun run test

# Single test file pattern
cd dashboard && bun run test -- --testPathPattern=ws-provider
```

Always use `bun run test` (which calls the `jest` script) inside `dashboard/`, never `bun test`.

---

## Branch and Commit Conventions

### Branch names

```
feat/<short-description>
fix/<short-description>
docs/<short-description>
chore/<short-description>
```

### Commit message format

```
<type>(<scope>): <subject>

[optional body — explain what and why, not how]

[optional footer — Closes #123]
```

Types: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore` | `perf`

Subject: imperative mood, max 50 characters, no trailing period.

Examples:

```
feat(topics): add persistent publish for offline subscribers
fix(queue): call replayProcessing on hub startup
docs(skill): add role field to list_instances return type
```

---

## Pull Request Process

1. **Fork** the repository and create a branch from `main`.
2. Make your changes. **Commit atomically** — one logical change per commit.
3. Run `make checkall` and fix any failures before pushing.
4. Open a PR against `main`. Fill in the PR template with a summary and test plan.
5. At least one maintainer review is required before merge.
6. PRs are merged with **squash merge** to keep the main branch history clean.

---

## Project-Specific Caveats

### Skill version bump requirement

After **any** change to the `skill/` directory (SKILL.md, patterns, hooks, plugin.json), you must bump the version in `skill/.claude-plugin/plugin.json`. The Claude Code plugin system caches by version — without a bump, `claude plugin add` silently skips the update and users get stale content.

After bumping, run `bash sync-plugin-cache.sh` to push the change into the local active cache.

### Next.js must use `--webpack`

The dashboard's `next dev` and `next build` commands include the `--webpack` flag. Turbopack (the Next.js default) does not resolve `@cc2cc/shared`'s ESM `.js` imports to `.ts` source files. Do not remove `--webpack` from any `next` command in the Makefile or `package.json` scripts.

### Zod version is pinned to `^3`

`packages/shared` uses Zod 3. Do not upgrade to Zod 4 — the API changed incompatibly. If you need a Zod feature only available in v4, discuss it in an issue first.

### `from` is server-stamped on the WebSocket path

The hub ignores any `from` field in client frames sent over `/ws/plugin` and stamps it from the authenticated instance identity. Do not rely on or pass `from` when sending via the WS path. The REST publish endpoint (`POST /api/topics/:name/publish`) currently accepts `from` from the request body — see SEC-007 in AUDIT.md.

### Dashboard sends via its plugin WS, not the dashboard WS

The `/ws/dashboard` connection is a receive-only event stream. The dashboard sends messages (direct, broadcast, publish-topic) via its separate `/ws/plugin` registration. This is intentional and documented in `docs/ARCHITECTURE.md`. Keep this separation in mind when working on either the dashboard or the hub's WS handler.

### LAN-only deployment

cc2cc is designed for trusted LAN environments. The shared API key is sent as a URL query parameter and embedded in the browser bundle. Do not expose the hub or dashboard to the public internet. See `SECURITY.md` for the full threat model.

---

## Related Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — component responsibilities, message flow, design invariants
- [docs/api/REST_API.md](docs/api/REST_API.md) — REST endpoint reference
- [docs/guides/TROUBLESHOOTING.md](docs/guides/TROUBLESHOOTING.md) — common failure modes
- [SECURITY.md](SECURITY.md) — threat model and responsible disclosure
- [CHANGELOG.md](CHANGELOG.md) — version history
