# Security Policy

cc2cc is designed for trusted local area network (LAN) environments. This document describes the threat model, known limitations, deployment constraints, and how to report security issues.

## Table of Contents

- [Intended Deployment Boundary](#intended-deployment-boundary)
- [Threat Model](#threat-model)
- [Known Limitations](#known-limitations)
- [Secure Configuration Checklist](#secure-configuration-checklist)
- [Responsible Disclosure](#responsible-disclosure)
- [Related Documentation](#related-documentation)

---

## Intended Deployment Boundary

cc2cc is a **LAN-only tool**. The hub, plugin instances, and dashboard are designed to run on a trusted private network (home lab, office LAN, VPN) where all participants are under the control of a single operator.

**Do not expose the hub or dashboard to the public internet.** The security model assumes physical network trust — it does not provide the authentication or encryption layers required for internet-facing deployment.

---

## Threat Model

### In-scope (LAN deployment)

- **Legitimate use:** Claude Code instances on the same LAN collaborating via typed messages through a single shared hub.
- **Operator:** The person who runs the hub controls the API key and has physical access to all machines on the LAN.

### Out-of-scope

- Public internet exposure
- Untrusted network participants
- Multi-tenant deployments where different users share a hub and must be isolated from each other

---

## Known Limitations

### Shared API key

A single `CC2CC_HUB_API_KEY` grants full hub access: enumerate all instances, read queued messages, publish to any topic, and impersonate any identity via the REST publish endpoint. There is no per-user or per-instance access control.

**Mitigation:** Rotate the API key if you suspect it has been compromised. Update the key in `.env`, `dashboard/.env.local`, and any plugin `.env` files, then restart all components.

### API key in URL query parameters

Both `/ws/plugin` and `/ws/dashboard` authenticate via `?key=<API_KEY>` in the URL. This means the key appears in:

- Server access logs
- Browser history
- Proxy logs
- Network captures

**Mitigation:** Keep the hub on a private LAN segment not traversed by untrusted proxies or logging infrastructure.

### API key in browser bundle

`NEXT_PUBLIC_CC2CC_HUB_API_KEY` is embedded in the Next.js static bundle at build time. Any user who can load the dashboard page can extract the API key from the JavaScript bundle using browser developer tools.

**Mitigation:** Restrict dashboard access to trusted LAN users only. Do not host the dashboard on any network reachable by untrusted parties.

### No end-to-end encryption / TLS requirement for non-LAN deployments

All communication between plugins, the hub, and the dashboard uses unencrypted WebSocket (`ws://`) and HTTP (`http://`). A passive observer on the same LAN segment can read all message content.

**Mitigation for LAN use:** Run cc2cc on an isolated VLAN or over a VPN tunnel that provides transport encryption (WireGuard, etc.).

**If you must expose cc2cc beyond a trusted LAN**, you MUST terminate TLS in front of both the hub (port 3100) and the dashboard (port 8029). A reverse proxy such as Caddy, nginx, or a cloud load-balancer should handle TLS termination:

```
# Example Caddy configuration
hub.example.com {
    reverse_proxy localhost:3100
}

dash.example.com {
    reverse_proxy localhost:8029
}
```

Without TLS over untrusted networks:
- The API key is visible in cleartext in HTTP headers and WebSocket handshake URLs.
- All message content (including the `content` field) is readable by any network observer.
- The API key embedded in the dashboard bundle can be intercepted by a MITM attacker.

### Fire-and-forget broadcast

Messages sent with `to: "broadcast"` are delivered to currently connected instances only. There is no queue backing for broadcast — offline instances will not receive them regardless of the `persistent` flag.

**Mitigation:** Use `publish_topic` with `persistent: true` when you need reliable delivery to all relevant instances, including those currently offline.

### No message size limit enforcement at the transport layer

The hub validates message content at the Zod schema level, but does not enforce hard limits at the WebSocket frame level. A malformed or malicious client that bypasses schema validation could send very large payloads.

**Mitigation:** Run the hub on a machine with sufficient memory for the expected workload. The queue hard cap (1000 messages per instance) provides an upper bound on Redis memory usage under normal operation.

### Topic name injection (fixed in v0.2.1)

Versions prior to v0.2.1 allowed arbitrary topic names to be used as Redis key segments, enabling key namespace collisions. As of v0.2.1, `validateTopicName` in `topic-manager.ts` restricts topic names to `[a-z0-9][a-z0-9_-]{0,63}` before any Redis key construction.

---

## Secure Configuration Checklist

Before deploying cc2cc on any network:

- [ ] `CC2CC_HUB_API_KEY` is a strong random string (at minimum 32 characters)
- [ ] `.env` and `dashboard/.env.local` are gitignored and never committed
- [ ] The hub is bound to a LAN IP, not `0.0.0.0` on an internet-facing interface
- [ ] The dashboard is accessible only to trusted LAN users
- [ ] Redis requires authentication — embed credentials in `CC2CC_REDIS_URL` (e.g. `redis://:yourpassword@localhost:6379`)
- [ ] Redis is not exposed beyond the hub host (bind to localhost or the Docker network)
- [ ] `CC2CC_DASHBOARD_ORIGIN` is set to your dashboard URL to restrict CORS (defaults to `*` with a warning if unset)

---

## Responsible Disclosure

If you discover a security issue in cc2cc, please report it privately rather than opening a public GitHub issue.

**Contact:** [probello@gmail.com](mailto:probello@gmail.com)

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any proof-of-concept code or configuration (if available)

You can expect an acknowledgement within 72 hours and a resolution plan within 14 days for confirmed issues.

---

## Related Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup and contribution workflow
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and trust boundaries
- [CHANGELOG.md](CHANGELOG.md) — version history including security fixes
