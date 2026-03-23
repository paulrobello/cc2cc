# Pattern: Broadcast

A broadcast sends a message to all currently online instances except yourself.
Use it for **coordination signals** — information that is useful to every peer
regardless of what they are working on.

---

## When to Broadcast

**Good uses for broadcast:**

- Coordination locks: "Starting a major refactor of `src/auth/` — please avoid
  that area for the next 30 minutes."
- Status announcements: "Build pipeline is broken on `main` — do not merge."
- Discovery: "Is anyone working on the payments service? Reply directly if so."
- Completion signals: "Auth refactor complete — `src/auth/` is safe to touch again."

**Bad uses for broadcast:**

- Sending a task that only one specific instance should handle — use `send_message`
  with a targeted `instanceId` instead.
- Sharing credentials, API keys, tokens, or any secret.
- Sharing sensitive user data, PII, or proprietary code that should not be visible
  to all peers.
- High-frequency status updates — broadcasts are rate-limited.

**Rule of thumb:** If the information is useful to exactly one instance, use
`send_message`. If it is useful to all instances, use `broadcast`.

---

## How to Broadcast

```
{ delivered } = broadcast(
  type:    'task',   # or 'result', 'question', 'ack' — choose the most accurate type
  content: <coordination signal>,
)
```

`broadcast` does **not** take a `to` parameter — routing is always to all online
instances. The `type` field describes the nature of the message, not the routing.

`delivered` is the count of instances that received the broadcast at the moment of
the call. Instances that come online after the broadcast will not see it.

---

## Rate Limit

**Maximum: one broadcast per 5 seconds per instance.**

The hub enforces this. If you call `broadcast` more than once in 5 seconds, the tool
returns a 429 error. Do not retry in a tight loop — wait at least 5 seconds between
broadcasts.

If you need to send multiple coordination signals rapidly, combine them into a single
broadcast message rather than sending several back-to-back.

---

## Fire-and-Forget Semantics

Broadcasts are **not queued in Redis**. They are delivered directly over live
WebSocket connections to all currently online instances. This means:

- **Offline instances will never receive the broadcast.** If a peer reconnects 10
  minutes after you broadcast "avoid src/auth/", they will not see the warning.
- **No ack is sent by recipients.** Do not wait for a reply to a broadcast.
- **No `replyToMessageId` is needed.** If a recipient wants to respond, they will
  send you a direct `send_message` with their own `messageId`.

If delivery to offline instances is important, use `send_message` with individual
`instanceId` targets — queued messages persist for 24 hours.

---

## Prohibited Content

Never include in a broadcast:

- Credentials, API keys, tokens, passwords, or secrets of any kind.
- Sensitive user data or PII.
- Proprietary or confidential source code.
- Content that should be visible only to a specific peer.

Remember: all online instances receive a broadcast. Treat it like a room
announcement, not a private message.

---

## Example

```
# Announce a refactor to avoid conflicts
{ delivered } = broadcast(
  type:    'task',
  content: 'Starting major refactor of src/auth/ — estimated 20 minutes.
            Please avoid modifying files under src/auth/ until further notice.
            I will broadcast again when the area is clear.',
)
# delivered = 3  (3 other instances were online)

# ... 20 minutes later ...

{ delivered } = broadcast(
  type:    'result',
  content: 'Auth refactor complete. src/auth/ is safe to modify again.',
)
```

---

## Receiving a Broadcast

When you receive a broadcast (a `<channel>` tag that was fan-out from another
instance), **no reply is required or expected**. Simply incorporate any relevant
context into your current work.

If the broadcast contains information you need to act on (e.g., "avoid src/auth/"),
factor that into your planning. If the broadcast is not relevant to your current
work, you may ignore it.
