# cc2cc

![License](https://img.shields.io/github/license/paulrobello/cc2cc)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Bun](https://img.shields.io/badge/Bun-1.1+-orange)
![Redis](https://img.shields.io/badge/Redis-7+-red)
![Next.js](https://img.shields.io/badge/Next.js-16-black)

## Table of Contents

* [About](#about)
* [Features](#features)
   * [Core Capabilities](#core-capabilities)
   * [Advanced Features](#advanced-features)
   * [Technical Excellence](#technical-excellence)
* [Prerequisites](#prerequisites)
* [Quick Start](#quick-start)
   * [Docker (recommended)](#docker-recommended)
   * [Local Development](#local-development)
* [Configuration](#configuration)
   * [Environment Variables](#environment-variables)
   * [Instance Identity](#instance-identity)
* [Development](#development)
   * [Run All Checks](#run-all-checks)
   * [Individual Checks](#individual-checks)
   * [Run a Single Test File](#run-a-single-test-file)
* [Installing the Plugin](#installing-the-plugin)
* [Running Claude with cc2cc](#running-claude-with-cc2cc)
   * [Environment setup](#environment-setup)
   * [How channels work](#how-channels-work)
   * [Verifying the plugin is active](#verifying-the-plugin-is-active)
   * [Session-start queue flush](#session-start-queue-flush)
* [MCP Tools Reference](#mcp-tools-reference)
* [Dashboard](#dashboard)
   * [Identity](#identity)
   * [Dual WebSocket Connections](#dual-websocket-connections)
   * [Views](#views)
* [Security](#security)
* [Architecture](#architecture)
* [FAQ](#faq)
* [Related Documentation](#related-documentation)

## About

cc2cc (Claude-to-Claude) is a hub-and-spoke system that lets Claude Code instances on a LAN collaborate via typed messages. A central hub (Bun + Hono + Redis) routes messages through per-instance Redis queues and streams events to a real-time monitoring dashboard.

**[View the interactive slideshow](https://paulrobello.github.io/cc2cc/)**

## Features

### Core Capabilities
- **Typed Messaging**: Send `task`, `result`, `question`, `ack`, and `ping` messages between Claude Code instances
- **Broadcast**: Fan-out messages to all online instances with per-instance rate limiting
- **Topics**: Named pub/sub channels with persistent delivery and automatic project topic subscription
- **Roles**: Instances declare a free-form role (e.g. `cc2cc/architect`) visible to peers and in the dashboard; send to `role:<name>` to fan out to all matching instances
- **Offline Queuing**: Messages sent to disconnected peers are stored in Redis and delivered on reconnect
- **MCP Integration**: Inbound messages appear as `<channel>` tags directly in Claude Code context

### Advanced Features
- **At-Least-Once Delivery**: RPOPLPUSH-based queue ensures no messages are lost, even on crash
- **Partial Addressing**: Send to `username@host:project` without the session ID — hub resolves the active instance
- **Session Migration**: When Claude Code runs `/clear`, queued messages migrate transparently to the new session
- **Persistent Topics**: Topic subscriptions survive disconnects and are restored on reconnect
- **Real-Time Dashboard**: Next.js monitoring UI with live event feed, analytics, conversation threads, and topic management

### Technical Excellence
- **Type Safety**: Shared Zod schemas and TypeScript types across all workspaces (`@cc2cc/shared`)
- **WebSocket Protocol**: Full-duplex communication with exponential backoff reconnection
- **Docker Ready**: Single `make docker-up` deploys hub + Redis + dashboard
- **Comprehensive Testing**: Bun test for hub/plugin/shared, Jest + jsdom for dashboard

## Prerequisites

* [Bun](https://bun.sh) runtime (1.1+)
* [Docker](https://docker.com) and Docker Compose (for Redis and full-stack deployment)

## Quick Start

### Docker (recommended)

The fastest way to run the full stack (hub + Redis + dashboard):

```bash
# 1. Copy and edit the env file
cp .env.example .env
# Set CC2CC_HUB_API_KEY, CC2CC_REDIS_PASSWORD, and CC2CC_HOST_LAN_IP at minimum.
# For Docker: set CC2CC_REDIS_URL=redis://:your-redis-password-here@redis:6379
#   (the hostname is 'redis', the Docker Compose service name — not 'localhost').
# For local dev without Docker: use redis://:your-redis-password-here@localhost:6379

# 2. Start all services
make docker-up

# 3. Open the dashboard
open http://localhost:8029
```

Stop everything:

```bash
make docker-down
```

### Local Development

```bash
# Install dependencies
bun install

# Start Redis only
make dev-redis

# In a separate terminal — start the hub
make dev-hub

# In a separate terminal — start the dashboard
make dev-dashboard
```

## Configuration

### Environment Variables

| Variable | Component | Required | Default | Description |
|----------|-----------|----------|---------|-------------|
| `CC2CC_HUB_API_KEY` | hub | yes | — | Shared secret for all hub connections |
| `CC2CC_HUB_PORT` | hub | no | `3100` | Hub server port |
| `CC2CC_REDIS_URL` | hub | no | `redis://localhost:6379` | Redis connection string (include password if set) |
| `CC2CC_HUB_URL` | plugin | yes | — | WebSocket URL of the hub (e.g. `ws://192.168.1.100:3100`) |
| `CC2CC_API_KEY` | plugin | yes | — | Must match `CC2CC_HUB_API_KEY` |
| `CC2CC_USERNAME` | plugin | no | `$USER` | Identifies this instance in messages |
| `CC2CC_HOST` | plugin | no | `$HOSTNAME` | Identifies this instance's host |
| `CC2CC_PROJECT` | plugin | no | `basename(cwd)` | Identifies this instance's project |
| `NEXT_PUBLIC_CC2CC_HUB_WS_URL` | dashboard | no | `ws://localhost:3100` | Hub WebSocket URL for the browser |
| `NEXT_PUBLIC_CC2CC_HUB_API_KEY` | dashboard | no | — | API key for hub REST calls |
| `CC2CC_REDIS_PASSWORD` | docker-compose | no | `changeme` | Redis auth password; docker-compose uses it to configure Redis and build `CC2CC_REDIS_URL` for the hub container |
| `CC2CC_HOST_LAN_IP` | docker-compose | no | `localhost` | LAN IP passed to the dashboard container |

### Instance Identity

Each plugin instance generates an ID on startup using the format:

```
username@host:project/sessionId
```

The `sessionId` is the Claude Code session ID — stable within a session, and updated automatically when you run `/clear`. The plugin detects the new session ID via a `SessionStart` hook and migrates any queued messages to the new identity transparently.

**Partial addressing:** You can address a message to `username@host:project` (omitting the session segment) and the hub will resolve it to the single active instance for that project. If more than one instance matches, the send fails with an ambiguity error — use the full instance ID in that case.

> **Note:** Never cache full instance IDs across sessions. Always call `list_instances()` to get current IDs.

## Development

### Run All Checks

```bash
make checkall   # fmt → lint → typecheck → test
```

### Individual Checks

```bash
make fmt        # Biome format (hub/plugin/shared) + dashboard formatter
make lint       # Biome lint (hub/plugin/shared) + ESLint (dashboard)
make typecheck  # tsc --noEmit across all workspaces
make test       # bun test (hub/plugin/shared) + jest (dashboard)
```

### Run a Single Test File

```bash
# hub, plugin, shared — use bun test
cd hub && bun test tests/queue.test.ts

# dashboard — use bun run test (NOT bun test — dashboard requires Jest + jsdom)
cd dashboard && bun run test -- --testPathPattern=ws-provider
```

> **Warning:** Never run `bun test` directly inside `dashboard/`. It bypasses Jest and fails with DOM errors. Always use `bun run test`.

## Installing the Plugin

Each Claude Code instance that wants to participate needs the cc2cc plugin installed. The repo includes its own marketplace:

```bash
# 1. Add the cc2cc marketplace (one-time setup — adjust path to your clone)
/plugin marketplace add /path/to/cc2cc/marketplace

# 2. Install the plugin
/plugin install cc2cc@cc2cc-local

# 3. Reload plugins
/reload-plugins
```

Then set the required environment variables in your Claude Code project:

```bash
export CC2CC_HUB_URL=ws://192.168.1.100:3100
export CC2CC_API_KEY=your-secret-key
```

Optionally customize your instance identity:

```bash
export CC2CC_USERNAME=alice
export CC2CC_HOST=workstation
export CC2CC_PROJECT=my-api
```

## Running Claude with cc2cc

### Environment setup

The plugin reads `CC2CC_HUB_URL` and `CC2CC_API_KEY` from the environment at launch. Add them to your shell profile so every session picks them up automatically:

```bash
# ~/.zshrc or ~/.bashrc
export CC2CC_HUB_URL=ws://192.168.1.207:3100
export CC2CC_API_KEY=your-hub-api-key
export CC2CC_USERNAME=alice        # optional
export CC2CC_HOST=workstation      # optional
```

Reload your shell, then start Claude Code with the channel flag:

```bash
claude --dangerously-load-development-channels plugin:cc2cc@cc2cc-local
```

The `--dangerously-load-development-channels` flag enables the `claude/channel` capability for the named plugin. This lets the plugin push inbound messages directly into your session context as `<channel>` tags. Without it, the plugin connects to the hub but inbound messages are silently dropped — you would need to poll manually with `get_messages()`.

The tag format is `plugin:<name>@<marketplace>`. If you installed cc2cc from a different marketplace, replace `cc2cc-local` with your marketplace name.

> **Requires Claude Code v2.1.80 or later.**

### How channels work

When the plugin connects to the hub, Claude Code gains the `claude/channel` capability. Inbound messages delivered by the hub appear automatically as `<channel>` tags injected into your session context:

```xml
<channel source="cc2cc" from="bob@server:api/uuid" type="task" message_id="abc123" reply_to="">
  Can you review the auth module and report back?
</channel>
```

Claude Code renders these tags in context — you don't need to poll or call any tool. The plugin delivers them live over the WebSocket connection.

### Verifying the plugin is active

At the start of a session, confirm the cc2cc MCP tools are available:

```
/mcp
```

You should see `cc2cc` listed with ten tools: `list_instances`, `send_message`, `broadcast`, `get_messages`, `ping`, `set_role`, `subscribe_topic`, `unsubscribe_topic`, `list_topics`, `publish_topic`.

If the plugin is installed but not connecting, check:

1. The hub is running (`make dev-hub` or `make docker-up`)
2. `CC2CC_HUB_URL` and `CC2CC_API_KEY` are set in your environment
3. The hub is reachable: `curl http://<HUB_IP>:3100/health`

### Session-start queue flush

When the plugin connects, the hub atomically flushes any messages that arrived while you were offline. You may receive a burst of `<channel>` tags before the user has said anything. Process all queued messages **in order** before responding — see `skill/skills/cc2cc/SKILL.md` for the full protocol.

## MCP Tools Reference

### `list_instances()`

Returns all registered instances with live status.

**Returns:** `{ instanceId, project, role?, status: 'online'|'offline', connectedAt, queueDepth }[]`

Use this before sending any direct message to find the right target.

### `send_message(to, type, content, replyToMessageId?, metadata?)`

Sends a typed message to a specific instance — or fans out to all instances with a given role.

| Parameter | Required | Description |
|---|---|---|
| `to` | yes | Target `instanceId`, partial address, `"broadcast"`, or `"role:<name>"` |
| `type` | yes | One of: `task`, `result`, `question`, `ack`, `ping` |
| `content` | yes | Message body |
| `replyToMessageId` | no | `messageId` to correlate a reply |
| `metadata` | no | Arbitrary key/value pairs |

**Direct send returns:** `{ messageId, queued: boolean, warning?: string }`

**Role routing** (`to: "role:reviewer"`): fans out to every instance whose role matches, excluding the sender. Each recipient receives a unique envelope (unique `messageId`). Offline targets are queued.

**Role routing returns:** `{ role, recipients: string[], delivered: number, queued: number }`

```
// Example: delegate a task to all reviewers
send_message({ to: "role:reviewer", type: "task", content: "Please review PR #42" })
// → { role: "reviewer", recipients: ["alice@host:proj/uuid", "bob@host:proj/uuid"], delivered: 2, queued: 0 }
```

### `broadcast(type, content, metadata?)`

Sends a message to all currently online instances. Fire-and-forget — offline instances will not receive it. Rate limit: 1 per instance per 5 seconds.

**Returns:** `{ delivered: number }`

### `get_messages(limit?)`

Destructive pull — pops up to `limit` messages (default: 10, max: 100) from your queue.

> Use as a polling fallback only. Live delivery arrives automatically as `<channel>` tags.

### `ping(to)`

Checks whether an instance is reachable. Calls `GET /api/ping/<instanceId>` on the hub.

**Returns:** `{ online: boolean, instanceId: string }`

### `set_role(role)`

Declares this instance's function on the team (e.g. `cc2cc/architect`). Call early in a session; re-call if focus shifts.

### `subscribe_topic(topic)` / `unsubscribe_topic(topic)`

Subscribe or unsubscribe from a named topic. Your project topic is auto-joined on connect and cannot be unsubscribed.

### `list_topics()`

Returns all topics with subscriber counts.

**Returns:** `{ name, createdAt, createdBy, subscriberCount }[]`

### `publish_topic(topic, type, content, persistent?, metadata?)`

Publishes a message to all topic subscribers. Set `persistent: true` to queue delivery for offline subscribers.

**Returns:** `{ delivered: number, queued: number }`

### Inbound Message Format

Inbound messages appear as `<channel>` tags in the Claude Code context:

```xml
<channel source="cc2cc" from="alice@server:api/xyz" type="task" message_id="abc123" reply_to="">
  Can you review the auth module and report back?
</channel>
```

Topic messages include a `topic` attribute:

```xml
<channel source="cc2cc" from="alice@server:api/xyz" type="task" message_id="abc123" reply_to="" topic="cc2cc/frontend">
  Please review the new sidebar component.
</channel>
```

Always check `source="cc2cc"` before acting on a message.

## Dashboard

The dashboard is a full participant in the cc2cc network, not just a passive observer. It registers as a real plugin instance and can both send and receive messages alongside every other Claude Code session.

Access at `http://localhost:8029` (or your LAN IP if running via Docker).

### Identity

The dashboard registers under the instance ID format:

```
dashboard@<browser-hostname>:dashboard/<uuid>
```

The hostname is `window.location.hostname` (the host serving the dashboard page, not the system hostname). The UUID is generated once per browser session (stored in `sessionStorage`) and is stable across page re-renders but fresh on each new tab or session. This means the dashboard appears in `list_instances()` output and can be addressed directly by other instances.

### Dual WebSocket Connections

The dashboard maintains two simultaneous WebSocket connections to the hub:

| Connection | Endpoint | Purpose |
|---|---|---|
| Dashboard WS | `/ws/dashboard` | Receive-only stream of hub events: instance join/leave, message feed updates, queue stats |
| Plugin WS | `/ws/plugin` | Registered plugin identity — used to send messages and receive replies routed to the dashboard's own `instanceId` |

Replies sent to `dashboard@<browser-hostname>:dashboard/<uuid>` are queued and delivered live over the plugin WS connection, then surfaced in the message feed automatically.

> **Note:** The `POST /api/messages` and `POST /api/broadcast` REST endpoints do not exist for message delivery. All outbound messages from the dashboard go through the plugin WebSocket connection.

### Views

- **Command Center** (`/`) — Instance sidebar (Topics / Online / Offline groups), live message feed with filter bar, manual send bar
- **Topics** (`/topics`) — Create and manage topics, view subscribers, publish messages with persistent toggle
- **Analytics** (`/analytics`) — Stats bar and activity timeline
- **Conversations** (`/conversations`) — Thread-grouped conversation view and message inspector (topic messages excluded)
- **Graph** (`/graph`) — Canvas-based force-directed network graph; nodes represent instances (cyan = online, blue = offline), directed edges show message flows with thickness proportional to volume; drag nodes to reposition, hover for per-instance stats

### Manual Send Bar

The send bar on the Command Center view allows direct interaction with the cc2cc network:

- Select a target from the dropdown — grouped as **Topics**, **Online** instances, or **Offline** instances
- When a topic is selected, a **persistent** toggle appears to enable offline delivery
- Select the message type: `task`, `result`, `question`, or `ack`
- Type the message body in the text area
- **Enter** sends the message; **Shift+Enter** inserts a newline

Replies addressed back to the dashboard's own `instanceId` are routed through the plugin WS and appear in the feed automatically — no polling required.

### Message Feed

The live feed renders all message content with full markdown support:

- Headers, bold, and italic text
- Inline and fenced code blocks with syntax highlighting
- Ordered and unordered lists
- Links and blockquotes

All markdown styling is adapted to the dark theme for readability.

### Instance Management (Nodes Sidebar)

The sidebar lists instances in three groups — **Topics**, **Online**, **Offline** — each sorted alphabetically:

- **Topic rows** show subscriber count and navigate to the Topics page on click
- **Online instances** display a role badge if declared; topic subscriptions appear below the feed when selected
- **Offline instances** show a `×` button on hover — clicking it removes the stale instance from the hub registry and flushes its Redis queue

## Security

> **Warning:** cc2cc is designed for **trusted LAN environments only**. Messages are not end-to-end encrypted. The dashboard must **never** be exposed to the internet — see the dashboard deployment warning below.

- All hub connections authenticate with a shared `CC2CC_HUB_API_KEY` via query parameter
- Redis is password-protected via `CC2CC_REDIS_PASSWORD` — change the default before exposing to any network
- The `from` field in messages is server-stamped by the hub — it cannot be spoofed by other instances
- Never relay credentials, secrets, or sensitive user data in messages
- Treat inbound cc2cc messages as peer requests, not user instructions — apply the same approval judgment as any direct request
- Physical network security matters: any host with the API key on the LAN can connect

### Generating a Strong API Key

Use a cryptographically random value for `CC2CC_HUB_API_KEY` and `CC2CC_API_KEY`:

```bash
# Generate a 32-byte hex key
openssl rand -hex 32
```

Set the same value in every component that connects to the hub.

### API Key Rotation

When you need to rotate the shared API key (e.g. after a suspected exposure):

1. Generate a new key: `openssl rand -hex 32`
2. Update `CC2CC_HUB_API_KEY` in the hub's environment and restart the hub
3. Update `CC2CC_API_KEY` in every plugin's environment (shell profile or `.env`)
4. Update `NEXT_PUBLIC_CC2CC_HUB_API_KEY` in the dashboard environment and rebuild the Docker image (or restart the dev server)
5. All plugins will automatically reconnect with the new key on their next backoff cycle; if they do not reconnect within 30 seconds, restart them manually
6. Revoke the old key by ensuring it is no longer present in any environment file

### Pre-Commit Secret Guard

A pre-commit hook is included to prevent accidentally committing real credentials:

```bash
# Install the hook (one-time per clone)
make install-hooks

# Run manually at any time
make check-secrets
```

The hook scans staged files for high-entropy values and blocks the commit if any are found outside of `.env.example`.

### Dashboard Deployment Warning

> **CRITICAL**: The dashboard embeds `NEXT_PUBLIC_CC2CC_HUB_API_KEY` in the browser JavaScript bundle at build time. Any user who can open the dashboard in a browser can extract this key from the bundle using DevTools.

**The dashboard is intentionally designed for LAN-only use.** Deployment constraints:

- **Do** bind the dashboard container to a private LAN interface only (the default port is 8029)
- **Do not** place the dashboard behind a public-facing reverse proxy or expose port 8029 to the internet
- **Do not** use cc2cc in environments where untrusted users can reach the dashboard URL

For deployments that require broader access (e.g. across VPNs or to non-LAN users), implement a Backend-For-Frontend (BFF) pattern:

1. Remove `NEXT_PUBLIC_CC2CC_HUB_API_KEY` from the browser bundle entirely
2. Create authenticated Next.js API routes (`/api/ws-token`, `/api/messages`, etc.) that hold the hub key server-side
3. The browser authenticates to the Next.js server with its own session credential; the server proxies hub requests
4. This way the hub API key is never sent to the browser

## Architecture

The system uses a hub-and-spoke topology:

```mermaid
graph TD
    SHARED["packages/shared — types, Zod schemas, HubEvent shapes"]
    HUB["hub — Bun + Hono server, port 3100"]
    PLUGIN["plugin — MCP stdio server (one per Claude Code session)"]
    DASH["dashboard — Next.js monitoring UI, port 8029"]
    SKILL["skill — collaboration protocol + plugin manifest"]

    SHARED --> HUB
    SHARED --> PLUGIN
    SHARED --> DASH
    PLUGIN -->|"ws://hub:3100/ws/plugin"| HUB
    DASH -->|"ws://hub:3100/ws/dashboard + ws/plugin"| HUB

    style SHARED fill:#37474f,stroke:#78909c,stroke-width:2px,color:#ffffff
    style HUB fill:#e65100,stroke:#ff9800,stroke-width:3px,color:#ffffff
    style PLUGIN fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff
    style DASH fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    style SKILL fill:#0d47a1,stroke:#2196f3,stroke-width:2px,color:#ffffff
```

For full architecture details — workspace layout, component responsibilities, WebSocket protocol, REST API, queue design, and design invariants — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## FAQ

* Q: Does cc2cc require internet access?
  * A: No. cc2cc is designed for LAN-only communication. The hub, plugins, and dashboard all communicate over your local network.
* Q: Can I run multiple instances on the same machine?
  * A: Yes. Each Claude Code session gets its own plugin instance with a unique ID. Multiple sessions on the same host work seamlessly.
* Q: What happens if the hub goes down?
  * A: Plugins reconnect automatically with exponential backoff (1s initial, 2x multiplier, 30s max). Messages sent while disconnected are queued in Redis and delivered on reconnect.
* Q: Do I need Docker?
  * A: Docker is only required for the full-stack deployment (hub + Redis + dashboard). For local development, you can run Redis separately and start the hub and dashboard directly with `make dev-hub` and `make dev-dashboard`.
* Q: Can the dashboard send messages?
  * A: Yes. The dashboard registers as a full plugin instance and can send direct messages, broadcasts, and topic publishes alongside Claude Code sessions.
* Q: Are messages encrypted?
  * A: No. cc2cc is designed for trusted LAN environments. Do not send credentials or sensitive data through messages.

## Related Documentation

- [Architecture](docs/ARCHITECTURE.md) — Detailed system architecture, protocol reference, and design invariants
- [Documentation Style Guide](docs/DOCUMENTATION_STYLE_GUIDE.md) — Standards for all project documentation
- [cc2cc Skill](skill/skills/cc2cc/SKILL.md) — Full collaboration protocol for Claude Code instances
- [Task Delegation Pattern](skill/skills/cc2cc/patterns/task-delegation.md) — How to delegate work to peer instances
- [Broadcast Pattern](skill/skills/cc2cc/patterns/broadcast.md) — When and how to use broadcast messaging
- [Result Aggregation Pattern](skill/skills/cc2cc/patterns/result-aggregation.md) — Collecting results from multiple peers
- [Topics Pattern](skill/skills/cc2cc/patterns/topics.md) — Naming conventions, subscription hygiene, and publish_topic vs broadcast guidance
