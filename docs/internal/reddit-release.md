# cc2cc - letting Claude Code instances talk to each other

I've been working on a system that lets multiple Claude Code instances coordinate over a LAN. It uses the new **channels** feature introduced in Claude Code v2.1.80 — plugins can now push messages directly into a session's context without the user having to poll or call a tool. cc2cc builds on this: you run a hub server on your network, each Claude Code session connects as a plugin, and they can send typed messages back and forth — delegate tasks, ask questions, report results — all showing up in context automatically.

## Why I built this

I kept running into situations where I wanted one Claude Code session focused on backend work and another on frontend, but there was no way for them to coordinate beyond me copy-pasting context between terminals. cc2cc fixes that. Each instance connects to a shared hub and messages show up directly in the Claude Code context as `<channel>` tags — no polling, no manual relay. This is powered by the `claude/channel` capability that landed in v2.1.80. You launch Claude Code with `--dangerously-load-development-channels` to enable it, and from there the plugin handles everything.

## How it works

- **Hub** (Bun + Hono + Redis) runs on your LAN, handles routing and message queuing
- **Plugin** is an MCP stdio server that each Claude Code session loads — gives it 10 tools for messaging, broadcasting, topics, etc.
- **Dashboard** (Next.js) shows what's happening in real time — who's connected, message feed, analytics, topic management
- Messages are typed: `task`, `result`, `question`, `ack`, `ping`
- Redis-backed queues with RPOPLPUSH for at-least-once delivery — if an instance is offline, messages queue up and flush on reconnect
- Topics for pub/sub — instances auto-join their project's topic, so all sessions working on the same codebase can coordinate without manual setup

## The interesting bits

**Partial addressing** — you can send to `alice@workstation:myproject` without knowing the full session UUID. The hub resolves it.

**Session migration** — when Claude Code runs `/clear`, the plugin detects the new session ID and migrates queued messages to the new identity. No messages lost.

**The dashboard is a full participant** — it registers as a plugin instance and can send/receive messages alongside Claude Code sessions. Not just a passive monitor.

**Broadcast is deliberately fire-and-forget** — no Redis queuing, just fan-out to whoever is online. Keeps it simple for announcements without queue bloat.

## Stack

TypeScript everywhere. Bun for runtime, Hono for the HTTP/WS server, Redis for queuing and presence, Next.js 16 for the dashboard. Shared Zod schemas across all workspaces so the types stay honest.

## Try it

```bash
git clone https://github.com/paulrobello/cc2cc
cd cc2cc
cp .env.example .env
# edit .env with your API key
make docker-up
```

Dashboard at localhost:8029. Install the plugin in your Claude Code sessions and they can start talking.

There's also an [interactive slideshow](https://paulrobello.github.io/cc2cc/) that walks through the architecture and shows a simulated collaboration between two instances.

GitHub: https://github.com/paulrobello/cc2cc

**Requires Claude Code v2.1.80+** for the channels feature.

Happy to answer questions or hear feedback. This started as a weekend experiment and grew into something I actually use daily.
