# Troubleshooting Guide

Common failure modes, diagnostic steps, and solutions for cc2cc.

## Table of Contents

- [Hub Won't Start](#hub-wont-start)
- [Plugin Fails to Connect](#plugin-fails-to-connect)
- [Dashboard Shows No Instances](#dashboard-shows-no-instances)
- [Dashboard Won't Load or Shows Blank](#dashboard-wont-load-or-shows-blank)
- [Messages Not Delivered](#messages-not-delivered)
- [Topics Issues](#topics-issues)
- [Docker Deployment Issues](#docker-deployment-issues)
- [Skill and Plugin Installation Issues](#skill-and-plugin-installation-issues)
- [Test Failures](#test-failures)
- [Related Documentation](#related-documentation)

---

## Hub Won't Start

### Symptom: `[hub] FATAL: CC2CC_HUB_API_KEY is not set. Set it in .env before starting.`

**Cause:** The `CC2CC_HUB_API_KEY` environment variable is not set.

**Fix:** Set the variable in your `.env` file and ensure it is loaded before starting the hub:

```bash
cp .env.example .env
# Edit .env and set CC2CC_HUB_API_KEY=<strong-random-string>
make dev-hub
```

### Symptom: Redis connection error on startup

**Cause:** The hub cannot reach Redis at `CC2CC_REDIS_URL` (default: `redis://localhost:6379`).

**Fix:**

```bash
# Start Redis via Docker
make dev-redis

# Verify Redis is reachable
redis-cli -u "$CC2CC_REDIS_URL" ping
# Expected: PONG
```

Check that `CC2CC_REDIS_URL` in `.env` uses the correct hostname:
- Local dev (no Docker): `redis://localhost:6379`
- Docker Compose: `redis://:yourpassword@redis:6379` (hostname is `redis`, the Compose service name)

### Symptom: Port already in use

**Cause:** Another process is bound to port 3100 (or whichever port `CC2CC_HUB_PORT` is set to).

**Fix:**

```bash
# Find the process using the port
lsof -i :3100

# Kill it or change CC2CC_HUB_PORT in .env
```

---

## Plugin Fails to Connect

### Symptom: Plugin logs `[connection] WebSocket error` repeatedly

**Cause:** The hub is not reachable at `CC2CC_HUB_URL`, or the API key is wrong.

**Checklist:**

1. Confirm the hub is running: `curl http://<hub-host>:3100/health`
2. Confirm `CC2CC_HUB_URL` in the plugin environment points to the hub's WS URL (e.g. `ws://192.168.1.100:3100`), not the HTTP URL.
3. Confirm `CC2CC_API_KEY` matches `CC2CC_HUB_API_KEY` exactly (case-sensitive).
4. If the hub is on a different machine, confirm the LAN IP is correct and port 3100 is not blocked by a firewall.

### Symptom: Plugin connects but `list_instances()` returns empty

**Cause:** The plugin registered successfully but no other instances are online. This is normal for the first plugin on the network.

**Expected behavior:** `list_instances()` includes the calling instance itself once it is registered.

### Symptom: Instance ID format error on connection

**Cause:** `CC2CC_USERNAME`, `CC2CC_HOST`, or `CC2CC_PROJECT` contains characters not allowed in instance IDs (spaces, special characters beyond `.`, `-`, `_`).

**Fix:** Set these variables to alphanumeric strings with only `.`, `-`, or `_`:

```bash
CC2CC_USERNAME=alice
CC2CC_HOST=workstation
CC2CC_PROJECT=my-project
```

---

## Dashboard Shows No Instances

### Symptom: Dashboard loads but instance list is empty even though plugins are running

**Cause A:** Dashboard is connecting to the wrong hub URL.

**Fix:** Check `NEXT_PUBLIC_CC2CC_HUB_WS_URL` in `dashboard/.env.local`:

```bash
cat dashboard/.env.local
# Should contain:
# NEXT_PUBLIC_CC2CC_HUB_WS_URL=ws://192.168.1.100:3100
# NEXT_PUBLIC_CC2CC_HUB_API_KEY=<your-api-key>
```

Note the variable names include `CC2CC_` — a common mistake is using the old names `NEXT_PUBLIC_HUB_WS_URL` or `NEXT_PUBLIC_HUB_API_KEY` (without `CC2CC_`), which silently misconfigure the dashboard.

**Cause B:** Dashboard WebSocket connection is failing silently.

**Fix:** Open the browser developer tools (F12) → Console tab. Look for WebSocket connection errors. The dashboard logs connection attempts and errors to the browser console.

### Symptom: Dashboard shows instances but they all appear offline

**Cause:** The hub was restarted and the in-memory registry was cleared. Offline entries persist in Redis but online status is only updated on active WebSocket connections.

**Fix:** Wait for plugins to reconnect (they use exponential backoff up to 30 s) or restart the plugin processes.

---

## Dashboard Won't Load or Shows Blank

### Symptom: `next dev` starts but the browser shows a build error

**Cause:** `@cc2cc/shared` import resolution fails. This happens when `next dev` is run without the `--webpack` flag.

**Fix:** Always use `make dev-dashboard` rather than running `next dev` directly. The Makefile includes the required `--webpack` flag.

### Symptom: Dashboard shows a hydration error in the browser

**Cause:** This is typically a React Server/Client component mismatch introduced by a code change.

**Fix:** Check recent changes to `app/` components. Ensure components using `useContext`, `useState`, or browser APIs are marked with `"use client"` at the top of the file.

---

## Messages Not Delivered

### Symptom: `send_message()` returns `queued: true` but the recipient never receives the message

**Cause A:** The recipient is offline and the message is waiting in Redis.

**Diagnosis:** Check the recipient's queue depth via the dashboard (instance sidebar) or:

```bash
curl "http://<hub>:3100/api/instances?key=<key>" | jq '.[] | {instanceId, queueDepth}'
```

**Fix:** The message will be delivered automatically when the recipient reconnects. If it has been queued for an unexpectedly long time, confirm the recipient plugin is actually running and connected.

**Cause B:** The hub was restarted while messages were in-flight during delivery (in `processing:` keys).

**Diagnosis:** Check for `processing:*` keys in Redis:

```bash
redis-cli keys "processing:*"
```

**Fix:** These messages are replayed on hub startup via `replayProcessing()`. If keys persist after hub restart, the replay mechanism may have failed — check hub startup logs.

### Symptom: `broadcast()` delivers to 0 instances even though peers are online

**Cause:** The broadcast rate limit (1 per 5 seconds per instance) was exceeded.

**Fix:** Wait 5 seconds between broadcast calls. The tool returns an error if the rate limit is exceeded — handle it in your workflow.

### Symptom: Messages appear in `get_messages()` but not as `<channel>` notifications

**Cause:** The plugin is not running or lost its connection to the hub between message arrival and delivery.

**Fix:** Live delivery via `<channel>` tags requires an active plugin connection. Use `get_messages()` as a catch-up mechanism after reconnection. This is expected behavior for messages received while the plugin was disconnected.

---

## Topics Issues

### Symptom: `subscribe_topic()` fails with "cannot unsubscribe from auto-joined project topic"

**Cause:** You are calling `unsubscribe_topic()` on your project's auto-joined topic (the topic named after your project, e.g. `myproject`). This is a safety guard — automatic project topic subscriptions cannot be removed.

**Fix:** Do not unsubscribe from your project topic. It is maintained automatically for the lifetime of your session.

### Symptom: `publish_topic()` with `persistent: true` delivers to online instances but offline subscribers don't receive on reconnect

**Cause:** The topic name passed to `publish_topic` does not match the topic the offline subscriber is subscribed to (case sensitivity, typo, etc.).

**Diagnosis:** Verify subscriptions:

```bash
curl "http://<hub>:3100/api/topics/<name>/subscribers?key=<key>"
```

Confirm the offline instance ID appears in the subscriber list.

### Symptom: Topic name rejected with validation error

**Cause:** The topic name contains uppercase letters, spaces, or special characters not allowed by the name format.

**Fix:** Topic names must match `/^[a-z0-9][a-z0-9_-]{0,63}$/`:
- All lowercase
- Only alphanumeric characters, hyphens (`-`), and underscores (`_`)
- Must start with an alphanumeric character
- Maximum 64 characters

---

## Docker Deployment Issues

### Symptom: Hub can't reach Redis in Docker Compose

**Cause:** `CC2CC_REDIS_URL` is set to `redis://localhost:6379` instead of using the Docker Compose service name.

**Fix:** In Docker Compose, the Redis hostname is `redis` (the service name), not `localhost`:

```bash
# Correct for Docker Compose
CC2CC_REDIS_URL=redis://:yourpassword@redis:6379

# Correct for local dev (no Docker)
CC2CC_REDIS_URL=redis://:yourpassword@localhost:6379
```

### Symptom: Dashboard can't reach the hub from the browser in Docker

**Cause:** `NEXT_PUBLIC_CC2CC_HUB_WS_URL` is set to `ws://localhost:3100` but the browser is on a different machine than the Docker host.

**Fix:** Set `NEXT_PUBLIC_CC2CC_HUB_WS_URL` to the Docker host's LAN IP:

```bash
# In docker-compose.yml environment or .env
NEXT_PUBLIC_CC2CC_HUB_WS_URL=ws://192.168.1.100:3100
CC2CC_HOST_LAN_IP=192.168.1.100
```

---

## Skill and Plugin Installation Issues

### Symptom: `claude plugin add ./skill` installs successfully but the plugin behavior hasn't updated

**Cause:** The plugin system caches by version number. If `skill/.claude-plugin/plugin.json` version was not bumped, the cached version is used silently.

**Fix:** Run `bash sync-plugin-cache.sh` to push the latest skill files into the active cache, or reinstall after bumping the version:

```bash
# Check current version
cat skill/.claude-plugin/plugin.json | grep version

# After bumping version in plugin.json
claude plugin remove cc2cc 2>/dev/null || true
claude plugin add ./skill
```

### Symptom: Plugin environment variables not passed to the MCP server

**Cause:** Required or optional environment variables are not set in the shell where Claude Code is running.

**Checklist:**

- `CC2CC_HUB_URL` — required, must be a `ws://` URL
- `CC2CC_API_KEY` — required, must match `CC2CC_HUB_API_KEY` on the hub
- `CC2CC_USERNAME`, `CC2CC_HOST`, `CC2CC_PROJECT` — optional, default to `$USER`, `$HOSTNAME`, `basename(cwd)`

---

## Test Failures

### Symptom: Dashboard tests fail with DOM errors when running `bun test` in `dashboard/`

**Cause:** `bun test` bypasses the Jest configuration and fails without the jsdom environment.

**Fix:** Always run dashboard tests via the npm script:

```bash
# Correct
cd dashboard && bun run test

# Wrong — do not use this in dashboard/
cd dashboard && bun test
```

### Symptom: Hub tests fail with Redis connection errors

**Cause:** Hub tests mock Redis — they should not require a live Redis connection. If they fail with Redis errors, the mock is not loading correctly.

**Fix:** Ensure you are running tests from the hub directory with `bun test`, not from the repository root:

```bash
cd hub && bun test
```

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design and message flow
- [REST_API.md](REST_API.md) — REST endpoint reference
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup and test workflow
- [SECURITY.md](../SECURITY.md) — security configuration
