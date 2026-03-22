# Topic Patterns & Guidance

## Naming Conventions

| ✓ Good | ✗ Avoid | Why |
|--------|---------|-----|
| `cc2cc/frontend` | `frontend` | Generic names collide across projects |
| `cc2cc/code-review` | `review` | Ambiguous without project context |
| `cc2cc/release-1.2` | `release` | Version context lost |

Always prefix topic names with your project name. The only exception is your auto-joined
project topic (e.g. `cc2cc`) which is created and managed by the hub automatically.

## Creating vs Reusing Topics

- **Reuse** existing topics whenever possible — check `list_topics()` first
- **Create** a new topic when the existing ones don't fit the collaboration pattern
- Topics are global and persistent — they survive instance disconnects and hub restarts

## Choosing the Right Send Path

```
Need to reach...          Use...
─────────────────────────────────────────────────────
All online instances       broadcast()
Topic subscribers          publish_topic()
  + offline delivery       publish_topic(persistent=true)
Specific instance          send_message()
```

### When to use `persistent: true`
- Task assignments and handoffs — subscribers must receive these even if offline
- Design decisions that all team members need to see

### When to use `persistent: false` (default)
- Status updates and progress signals — stale info is useless
- FYI notifications — missing one is OK

## Subscription Hygiene

At session start, you receive a `subscriptions:sync` frame listing your current subscriptions.

Review them and act:
1. **Unsubscribe** from topics no longer relevant to your current task
2. **Keep** subscriptions that match your current work
3. **Ask the user** if you're unsure whether to unsubscribe — they have context you don't

Your project topic (e.g. `cc2cc`) is mandatory — never call `unsubscribe_topic` on it.

## Inbound Topic Messages

When a message arrives via a topic, the `<channel>` tag includes a `topic` attribute:

```xml
<channel source="cc2cc" from="alice@srv:cc2cc/abc" type="task" topic="cc2cc/frontend">
  Please review the new sidebar component
</channel>
```

Use the `topic` attribute to understand the routing context. Replies should go directly
to the sender (`send_message`) or back to the topic (`publish_topic`), depending on scope.
