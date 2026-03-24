# cc2cc Enhancement Roadmap

## Communication & Protocol

### 1. `wait_for_reply(message_id, timeout)` MCP Tool
Block until a reply arrives for a specific message. Right now agents must poll `get_messages` and filter manually. A blocking wait-for-reply would simplify request/response patterns dramatically.

### 2. Formal Task Lifecycle
Extend `MessageType` with `task:accepted`, `task:progress`, `task:failed` — or use `metadata` conventions. Allows orchestrators to track multi-step work without custom logic per agent.

### 3. Message Expiry / TTL
Allow `send_message` to set a TTL on queued messages. If the recipient doesn't pull within N seconds, the message is dropped. Useful for time-sensitive delegation where a stale result has no value.

---

## Hub Enhancements

### 4. Message History Store
Persist the last N messages per instance/topic in Redis as a circular buffer. Enables `GET /api/messages/:id` (currently a 404 stub) and replay on reconnect. Unblocks tools #10 and #11.

### 5. Dead Letter Queue
Messages that fail delivery after the instance disconnects permanently go to a DLQ visible in the dashboard, instead of silently aging out. Useful for diagnosing lost tasks.

### 6. Webhook Outbound
Register HTTP endpoints that the hub POSTs to on message events. Enables integrating cc2cc with external systems — Slack notifications, logging pipelines, CI triggers, etc.

### 7. Prometheus Metrics Endpoint
`GET /metrics` exposing queue depths, message rates, connected instance counts, topic counts. Pairs with any Grafana/alerting stack for production observability.

---

## Security & Auth

### 8. Per-Instance API Keys
Each registered instance gets a unique key instead of the shared `CC2CC_HUB_API_KEY`. Enables revocation of individual instances, per-identity audit trails, and per-instance rate limits.

### 9. Instance Allowlist
Optional hub config: only pre-registered `instanceId` patterns can connect. Prevents rogue or misconfigured agents from joining the hub on a shared network.

---

## Plugin / MCP Tools

### 10. `get_topic_messages(topic, limit)` Tool
Retrieve recent persistent topic messages. Currently agents can only pull from their own queue — there is no way to catch up on topic history after joining late.

### 11. `search_messages(query, limit)` Tool
Full-text search over the agent's message history (requires history store from #4). Critical for long-running orchestrations where agents need to find prior context.

### 12. `get_instance_info(id)` Tool
Richer per-instance details: role, subscribed topics, queue depth, online/offline status, last-seen timestamp. Right now `list_instances` returns the full list but no deep-dive per instance.

---

## Dashboard

### 13. Network Graph Visualization
D3 or vis-network graph of who is talking to whom — nodes are instances, edges are message flows with edge thickness proportional to volume. Invaluable for debugging complex orchestrations.

### 14. Message Search
Full-text search across the dashboard's local feed cache. Currently there is a type/instance filter but no content search, making it hard to find specific messages in a busy hub.

### 15. Instance Detail Drawer
Click any instance in the sidebar → slide-in panel with its role, subscribed topics, queue depth, message history, and a "send to this instance" shortcut. Removes friction in targeted debugging.

### 16. Export Conversation
Export a thread or topic history as Markdown or JSON. Useful for post-mortems, feeding context into a new session, or generating documentation from an agent collaboration run.

---

## Orchestration

### 17. Agent Groups / Role-Based Routing
`send_message(to: "role:reviewer")` fans out to all instances with that role. Right now you must call `list_instances`, filter by role, and send N messages manually — this makes it a first-class primitive.

### 18. Leader Election
`elect_leader(topic)` — instances compete via a Redis atomic operation; one wins and receives a `leader:elected` message. Useful for coordinator patterns where only one agent should act on a shared task.

---

## Priority Summary

| Priority | # | Feature | Rationale |
|----------|---|---------|-----------|
| High | 1 | `wait_for_reply` tool | Eliminates the most common boilerplate in agent code |
| High | 4 | Message History Store | Unlocks the stub endpoint, topic catchup, and tools #10/#11 |
| High | 13 | Network Graph Dashboard | Best observability win for complex orchestrations |
| Medium | 8 | Per-Instance API Keys | Real security improvement for multi-team or multi-project use |
| Medium | 17 | Role-Based Routing | Dramatically simplifies orchestrator logic |
| Medium | 2 | Formal Task Lifecycle | Enables structured multi-step workflows without custom conventions |
| Low | 7 | Prometheus Metrics | Production observability — low urgency for LAN-only use |
| Low | 18 | Leader Election | Niche but powerful for competitive coordinator patterns |
| Low | 6 | Webhook Outbound | Integration use case — useful when connecting to external tooling |
