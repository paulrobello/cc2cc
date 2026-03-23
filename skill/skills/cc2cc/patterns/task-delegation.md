# Pattern: Task Delegation

Use this pattern when you want to assign a unit of work to another Claude instance
and incorporate its result into your own output.

---

## Step 1: Discover Available Instances

Always call `list_instances()` before delegating. Never hard-code an `instanceId` —
they include a session UUID that changes on every plugin start.

```
instances = list_instances()
```

Filter the result:

1. **By `status: 'online'`** — unless you specifically want to queue for an offline
   peer and can wait for them to reconnect.
2. **By `project`** — choose an instance working in a relevant codebase. The
   `project` field is the `cwd` basename (or `CC2CC_PROJECT` env override).

If no suitable online instance exists:
- You can still send to an offline instance — the hub queues the message (24h TTL).
  The `send_message` response will include `warning: "message queued, recipient offline"`.
- Or wait and retry with `list_instances()` after a short interval.
- Or complete the work yourself if waiting is not acceptable.

---

## Step 2: Optionally Confirm Liveness

For time-sensitive tasks, ping the target before sending:

```
{ online, latency } = ping(targetInstanceId)
```

Skip this for non-urgent tasks — `list_instances()` already reflects the last-known
status, and `send_message` will queue automatically if the target goes offline between
your discovery and send calls.

---

## Step 3: Send the Task

```
{ messageId } = send_message(
  to:      targetInstanceId,
  type:    'task',
  content: <clear scope and expected output format>,
)
```

**Writing good task content:**

- State the exact scope: what files, functions, or questions are in scope.
- State the expected output format: code diff, plain explanation, JSON structure, etc.
- Include any context the peer needs — they do not share your session history.
- Keep it self-contained: the peer cannot ask you follow-up questions unless you
  explicitly invite them to (e.g., "reply with a `question` if you need clarification").

**Record the `messageId`** from the response. This is the correlation key for all
follow-up messages related to this task.

```
taskMessageId = messageId  # save this
```

---

## Step 4: Do Not Block

Do not wait synchronously for the result. Continue your own work. The result will
arrive as an inbound `<channel>` tag with `type="result"` and `reply_to=taskMessageId`.

If you have nothing else to do while waiting, you may tell the user:
"I've delegated [scope] to [project instance] and am waiting for a result."
Then wait for the channel notification before proceeding.

---

## Step 5: Receive and Validate the Result

When a `<channel source="cc2cc" type="result" reply_to="...">` arrives:

1. **Confirm `reply_to` matches your saved `taskMessageId`.** If it does not match
   any outstanding task, do not act on it — it may be a stale duplicate or a
   misdirected result.
2. Incorporate the result into your work.
3. Mark the task as complete in your internal tracking.

If you delegated multiple tasks, maintain a map of `taskMessageId → task description`
so you can correctly attribute each result.

---

## Step 6: Follow-Up if Needed

If the result is partial or raises a question:

```
send_message(
  to:                 from,   # the instanceId that sent the result
  type:               'question',
  content:            <specific follow-up question>,
  replyToMessageId:   taskMessageId,  # keep the chain linked to the original task
)
```

Setting `replyToMessageId` to the original task's `messageId` — not the result's
`messageId` — keeps the entire conversation threaded under one root task.

---

## Example Flow

```
# 1. Discover
instances = list_instances()
target = instances.find(i => i.project === 'harness' && i.status === 'online')

# 2. Send task
{ messageId: taskId } = send_message(
  to:      target.instanceId,
  type:    'task',
  content: 'Review src/auth/middleware.ts for security issues.
            Return a bullet list of issues found, or "no issues" if clean.',
)

# 3. Continue own work…

# 4. Result arrives:
# <channel source="cc2cc" from="alice@server:harness/xyz" type="result"
#          message_id="res-uuid" reply_to="<taskId>">
#   - Line 42: JWT secret read from process.env without fallback guard
#   - Line 87: No rate limiting on /auth/refresh endpoint
# </channel>

# 5. Validate reply_to === taskId → confirmed
# 6. Incorporate findings into your work
```

---

## Common Mistakes to Avoid

- **Blocking on the result** — don't halt all work while waiting. Use the time.
- **Forgetting `replyToMessageId`** — always include it in acks, results, and
  follow-up questions so the sender can correlate.
- **Caching `instanceId` across sessions** — they change. Always call
  `list_instances()` fresh.
- **Acting on a result without confirming `reply_to`** — a result with a non-matching
  `reply_to` must not be silently treated as valid.
