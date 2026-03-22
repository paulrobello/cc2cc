# Pattern: Result Aggregation

Use this pattern when you have delegated multiple tasks to one or more peers and
need to combine their results into a coherent output for the user.

---

## Core Principle: Correlate Before Presenting

Never present a result to the user the moment it arrives. Always:

1. Confirm the result belongs to an outstanding task (via `reply_to`).
2. Check whether all expected results have arrived.
3. Synthesize the complete picture before presenting.

Partial information presented prematurely leads to confusion or incorrect conclusions.

---

## Tracking Outstanding Tasks

Maintain an internal map of outstanding tasks for the current session. For each
task you delegate, record:

```
outstandingTasks = {
  "<messageId>": {
    description: "Review src/auth/middleware.ts",
    to:          "alice@server:harness/xyz",
    sentAt:      "<ISO timestamp>",
    status:      "pending",   # pending | acked | complete
    result:      null,
  },
  "<messageId2>": { ... },
}
```

Update `status` to `acked` when you receive a matching `ack`, and to `complete`
when you receive a matching `result`. Store the result content for synthesis.

---

## Correlating Results to Tasks

When a `<channel source="cc2cc" type="result" reply_to="...">` arrives:

1. Look up `reply_to` in your `outstandingTasks` map.
2. **If found:** mark the task complete, store the result. Proceed with synthesis
   if all tasks are now complete, or continue waiting if others are outstanding.
3. **If not found:** do not act on the result. It may be a stale duplicate (the hub
   delivers at-least-once) or a result that belongs to a different task chain. Log
   the discrepancy.

**Idempotency note:** The hub may deliver the same result twice (at-least-once
delivery). Use the `message_id` of the result to deduplicate — if you have already
processed a result with that `message_id`, discard the duplicate.

---

## Handling Partial Results

If a result arrives but is incomplete (e.g., "I found some issues but need the
function signature to give a full assessment"), send a follow-up question:

```
send_message(
  to:                 from,            # the instanceId that sent the partial result
  type:               'question',
  content:            <specific follow-up question>,
  replyToMessageId:   originalTaskId,  # the messageId of the original task, not the result
)
```

Setting `replyToMessageId` to the original task's `messageId` — not the partial
result's `messageId` — keeps the entire conversation threaded under one root task
in the dashboard conversation view.

Update the task status back to `pending` after sending the follow-up question,
so you continue waiting for a complete result.

---

## Session-Start: Ack All Before Working

If multiple task messages arrive during the session-start queue flush, ack all of
them **before** starting work on any one of them:

```
# Burst arrives on session start:
# <channel type="task" message_id="task1"> ... </channel>
# <channel type="task" message_id="task2"> ... </channel>
# <channel type="task" message_id="task3"> ... </channel>

# Step 1: Ack all immediately
send_message(from1, ack, "accepted", replyToMessageId="task1")
send_message(from2, ack, "accepted", replyToMessageId="task2")
send_message(from3, ack, "accepted", replyToMessageId="task3")

# Step 2: Now begin work on task1, then task2, then task3
```

This prevents senders from timing out or re-sending while you are working through
earlier tasks. Acking is cheap; failing to ack causes unnecessary retries and
confusion.

---

## Synthesizing Before Presenting

Once all expected results are complete:

1. Review all results together.
2. Resolve any conflicts or inconsistencies between them.
3. Combine into a single coherent response.
4. Present to the user as a unified output — do not dump raw result messages verbatim.

**Example synthesis:**

```
# Three peers reviewed different modules. Their results arrived:
# task1 result: "auth middleware has 2 issues"
# task2 result: "payments module is clean"
# task3 result: "user model has 1 issue"

# Bad (do not do this):
"Alice found 2 issues in auth. Bob found nothing in payments. Carol found 1 issue in users."

# Good:
"Code review complete across 3 modules. Found 3 issues total:
 - src/auth/middleware.ts: [issue 1], [issue 2]
 - src/models/user.ts: [issue 3]
 - src/payments/: no issues found"
```

---

## Handling Timeouts

If a peer does not reply within a reasonable time (your judgment based on task
complexity):

1. Use `ping(instanceId)` to check if the peer is still online.
2. If offline: the peer may have crashed. Their result may arrive when they reconnect
   and flush their outbound queue — or it may never come. Decide whether to:
   - Wait longer.
   - Re-delegate the task to another instance.
   - Proceed with the results you have and note the gap to the user.
3. If still online but slow: the task may be complex. Wait longer before acting.

Do not re-delegate without telling the user — duplicate work creates confusion.

---

## Concurrent Task Tracking Example

```
# Delegated 3 tasks:
outstandingTasks = {
  "uuid-a": { description: "Review auth module",     status: "pending" },
  "uuid-b": { description: "Review payments module",  status: "pending" },
  "uuid-c": { description: "Review user model",       status: "pending" },
}

# Ack arrives for uuid-a → update to "acked"
# Result arrives for uuid-b → update to "complete", store result
# Result arrives for uuid-a → update to "complete", store result
# Result arrives for uuid-c → update to "complete", store result

# All complete → synthesize and present
```
