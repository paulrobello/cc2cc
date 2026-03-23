# REST API Reference

Complete reference for the cc2cc hub REST API. All endpoints are served by the hub at `http://<hub-host>:<CC2CC_HUB_PORT>` (default port: 3100).

## Table of Contents

- [Authentication](#authentication)
- [Base URL](#base-url)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Instances](#instances)
  - [Queue](#queue)
  - [Stats](#stats)
  - [Messages](#messages)
  - [Ping](#ping)
  - [Topics](#topics)
- [Error Responses](#error-responses)
- [Related Documentation](#related-documentation)

---

## Authentication

All endpoints except `GET /health` require the API key as a query parameter:

```
?key=<CC2CC_HUB_API_KEY>
```

Requests with a missing or incorrect key receive:

```json
HTTP 401
{ "error": "Unauthorized" }
```

The key is compared using a timing-safe byte comparison (`crypto.timingSafeEqual`) to prevent timing-oracle attacks.

---

## Base URL

```
http://<hub-host>:3100
```

Replace `<hub-host>` with the hub's LAN IP or hostname, and `3100` with `CC2CC_HUB_PORT` if overridden.

---

## Endpoints

### Health

#### `GET /health`

Returns hub and Redis health status. **No authentication required.**

**Response:**

```json
{
  "status": "ok",
  "connectedInstances": 3,
  "redisOk": true,
  "uptime": 4821
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the hub is running |
| `connectedInstances` | `number` | Number of currently online plugin instances |
| `redisOk` | `boolean` | Whether the Redis connection is healthy |
| `uptime` | `number` | Hub uptime in seconds |

---

### Instances

#### `GET /api/instances`

Returns all registered instances — both online and offline — with status information.

**Response:** `InstanceInfo[]`

```json
[
  {
    "instanceId": "alice@workstation:myproject/550e8400-e29b-41d4-a716-446655440000",
    "project": "myproject",
    "status": "online",
    "connectedAt": "2026-03-22T10:00:00.000Z",
    "queueDepth": 0,
    "role": "myproject/architect"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `instanceId` | `string` | Full instance identity: `username@host:project/sessionId` |
| `project` | `string` | Project segment of the instance ID |
| `status` | `"online" \| "offline"` | Current connection status |
| `connectedAt` | `string` | ISO 8601 timestamp of last connection |
| `queueDepth` | `number` | Number of messages waiting in the instance's Redis queue |
| `role` | `string \| undefined` | Optional role declared by the instance via `set_role` |

#### `DELETE /api/instances/:id`

Remove a stale offline instance from the registry. Flushes the instance's queue and emits an `instance:removed` HubEvent to dashboard clients.

**Path parameter:** `id` — URL-encoded instance ID

**Errors:**
- `404` — instance not found
- `409` — cannot remove an online instance

**Response:**

```json
{ "removed": true, "instanceId": "alice@workstation:myproject/uuid" }
```

---

### Queue

#### `DELETE /api/queue/:id`

Flush all queued messages for an instance (admin operation). Sets queue depth to 0 in the registry.

**Path parameter:** `id` — URL-encoded instance ID

**Response:**

```json
{ "flushed": true, "instanceId": "alice@workstation:myproject/uuid" }
```

---

### Stats

#### `GET /api/stats`

Returns aggregate message statistics.

**Response:**

```json
{
  "messagesToday": 142,
  "activeInstances": 3,
  "queuedTotal": 7
}
```

| Field | Type | Description |
|-------|------|-------------|
| `messagesToday` | `number` | Messages delivered today (resets at midnight UTC) |
| `activeInstances` | `number` | Number of currently online instances |
| `queuedTotal` | `number` | Total messages queued across all instance queues |

---

### Messages

#### `GET /api/messages/:id`

Returns `404` in the current version. Message lookup by ID is not implemented — the dashboard builds its own message index from the `message:sent` WebSocket event stream.

**Response:**

```json
HTTP 404
{
  "error": "Message lookup by ID not supported in v1. Use the WS event stream to build a local index."
}
```

---

### Ping

#### `GET /api/ping/:id`

Check whether a specific instance is currently online.

**Path parameter:** `id` — URL-encoded instance ID

**Response:**

```json
{ "online": true, "instanceId": "alice@workstation:myproject/uuid" }
```

Returns `{ "online": false }` for offline or unknown instances (no 404).

---

### Topics

#### `GET /api/topics`

List all topics with metadata and current subscriber counts.

**Response:** `TopicInfo[]`

```json
[
  {
    "name": "myproject",
    "createdAt": "2026-03-22T09:00:00.000Z",
    "createdBy": "alice@workstation:myproject/uuid",
    "subscriberCount": 2
  }
]
```

#### `POST /api/topics`

Create a topic. Idempotent — returns existing topic info if the topic already exists. Emits `topic:created` HubEvent only for new topics.

**Request body:**

```json
{ "name": "myproject-frontend" }
```

Topic names must match `/^[a-z0-9][a-z0-9_-]{0,63}$/` (lowercase alphanumeric, hyphens, and underscores; max 64 characters).

**Response:** `TopicInfo`

**Errors:**
- `400` — invalid topic name format

#### `DELETE /api/topics/:name`

Delete a topic. Fails if the topic has active subscribers.

**Path parameter:** `name` — topic name

**Errors:**
- `404` — topic not found
- `409` — topic has subscribers (includes `subscriberCount` in response)

**Response:**

```json
{ "deleted": true, "name": "myproject-frontend" }
```

#### `GET /api/topics/:name/subscribers`

Return all instances currently subscribed to a topic.

**Response:** `string[]` — array of instance IDs

**Errors:**
- `404` — topic not found

#### `POST /api/topics/:name/subscribe`

Subscribe an instance to a topic.

**Request body:**

```json
{ "instanceId": "alice@workstation:myproject/uuid" }
```

**Errors:**
- `404` — topic not found, or instance not found

**Response:**

```json
{ "subscribed": true, "topic": "myproject-frontend" }
```

#### `POST /api/topics/:name/unsubscribe`

Unsubscribe an instance from a topic. Respects the auto-joined project topic guard: online instances cannot unsubscribe from their project topic (the guard is bypassed for offline instances).

**Request body:**

```json
{ "instanceId": "alice@workstation:myproject/uuid" }
```

**Errors:**
- `400` — attempt to unsubscribe from the auto-joined project topic (online instances)
- `404` — topic not found

**Response:**

```json
{ "unsubscribed": true, "topic": "myproject-frontend" }
```

#### `POST /api/topics/:name/publish`

Publish a message to all subscribers of a topic. The `from` field is server-stamped as `"dashboard"` — any client-supplied `from` value is ignored.

**Request body:**

```json
{
  "content": "Deployment complete — v2.3.1 is live",
  "type": "result",
  "persistent": true,
  "metadata": { "version": "2.3.1" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `string` | yes | Message body |
| `type` | `string` | yes | One of: `task`, `result`, `question`, `ack`, `ping` |
| `persistent` | `boolean` | no | Queue for offline subscribers (default: `false`) |
| `metadata` | `object` | no | Arbitrary key/value pairs |

**Errors:**
- `400` — invalid topic name format
- `404` — topic not found

**Response:**

```json
{
  "delivered": 2,
  "queued": 1,
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `delivered` | `number` | Live WebSocket deliveries |
| `queued` | `number` | Messages added to Redis queues (persistent path) |
| `messageId` | `string` | UUID assigned to the published message |

---

## Error Responses

All error responses use JSON with an `error` string field:

```json
{ "error": "Description of the error" }
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request — invalid input (e.g. topic name format, project topic guard) |
| `401` | Unauthorized — missing or incorrect API key |
| `404` | Not found — instance, topic, or resource does not exist |
| `409` | Conflict — operation not permitted in current state (e.g. deleting a topic with subscribers, removing an online instance) |

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — WebSocket protocol, queue design, and design invariants
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup
- [SECURITY.md](../SECURITY.md) — API key security model
