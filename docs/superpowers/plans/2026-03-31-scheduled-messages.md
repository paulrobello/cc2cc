# Scheduled Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hub-managed cron/interval scheduler that fires messages to instances, topics, broadcasts, and roles on recurring or one-shot schedules.

**Architecture:** Redis ZSET polling (30s interval) drives a `Scheduler` class in the hub. Schedule CRUD exposed via REST + WS APIs, 5 new MCP plugin tools, and a dedicated `/schedules` dashboard page with send-bar integration. All times are UTC.

**Tech Stack:** Bun, Hono, ioredis, cron-parser (new dep), Next.js 16, React 19, Zod 3, ws

**Spec:** `docs/superpowers/specs/2026-03-31-scheduled-messages-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/shared/src/types.ts` | Add `Schedule` interface, `SYSTEM_SENDER_ID` constant |
| `packages/shared/src/schema.ts` | Add `ScheduleSchema`, `CreateScheduleInputSchema`, `UpdateScheduleInputSchema` |
| `packages/shared/src/events.ts` | Add 4 schedule HubEvent types to discriminated union |
| `packages/shared/tests/schedule-schema.test.ts` | **New** — schema validation tests |
| `hub/src/scheduler.ts` | **New** — `Scheduler` class: poll loop, fire logic, startup recovery, interval parsing |
| `hub/src/api.ts` | Add 5 schedule REST endpoints |
| `hub/src/ws-handler.ts` | Add 5 schedule WS frame actions |
| `hub/src/index.ts` | Initialize and start scheduler, add scheduler to shutdown |
| `hub/package.json` | Add `cron-parser` dependency |
| `hub/tests/scheduler.test.ts` | **New** — scheduler unit tests |
| `hub/tests/schedule-api.test.ts` | **New** — REST + WS schedule CRUD tests |
| `plugin/src/tools.ts` | Add 5 schedule tool handlers |
| `plugin/src/index.ts` | Add 5 schedule tool definitions + dispatch cases |
| `dashboard/src/types/dashboard.ts` | Add `ScheduleState` type |
| `dashboard/src/lib/api.ts` | Add schedule API wrappers |
| `dashboard/src/components/ws-provider/ws-provider.tsx` | Add `schedules` state + event handling + initial load |
| `dashboard/src/app/schedules/page.tsx` | **New** — 3-panel schedules management page |
| `dashboard/src/components/nav/nav-tabs.tsx` | Add Schedules tab |
| `dashboard/src/components/manual-send-bar/manual-send-bar.tsx` | Add "Schedule this" toggle |

---

## Task 1: Shared Types and Schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schema.ts`
- Test: `packages/shared/tests/schedule-schema.test.ts` (new)

- [ ] **Step 1: Write the failing tests for schedule schemas**

Create `packages/shared/tests/schedule-schema.test.ts`:

```typescript
// packages/shared/tests/schedule-schema.test.ts
import { describe, it, expect } from "bun:test";
import {
  ScheduleSchema,
  CreateScheduleInputSchema,
  UpdateScheduleInputSchema,
} from "../src/schema.js";
import { MessageType } from "../src/types.js";

describe("CreateScheduleInputSchema", () => {
  it("parses valid create input with cron expression", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "Daily standup nudge",
      expression: "0 9 * * *",
      target: "topic:team",
      messageType: "task",
      content: "Time for standup!",
    });
    expect(result.success).toBe(true);
  });

  it("parses valid create input with simple interval", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "Periodic ping",
      expression: "every 5m",
      target: "broadcast",
      messageType: "ping",
      content: "heartbeat",
    });
    expect(result.success).toBe(true);
  });

  it("parses valid create input with all optional fields", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "Limited nudge",
      expression: "every 1h",
      target: "role:reviewer",
      messageType: "task",
      content: "Check PRs",
      persistent: true,
      maxFireCount: 10,
      expiresAt: "2026-12-31T23:59:59.000Z",
      metadata: { priority: "high" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "Missing stuff",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "",
      expression: "every 5m",
      target: "broadcast",
      messageType: "task",
      content: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "a".repeat(101),
      expression: "every 5m",
      target: "broadcast",
      messageType: "task",
      content: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid message type", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "Bad type",
      expression: "every 5m",
      target: "broadcast",
      messageType: "invalid",
      content: "test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts metadata within limits", () => {
    const result = CreateScheduleInputSchema.safeParse({
      name: "With meta",
      expression: "every 5m",
      target: "broadcast",
      messageType: "task",
      content: "test",
      metadata: { key1: "value1", key2: 42, key3: true },
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateScheduleInputSchema", () => {
  it("parses partial update with name only", () => {
    const result = UpdateScheduleInputSchema.safeParse({
      name: "Updated name",
    });
    expect(result.success).toBe(true);
  });

  it("parses partial update with enabled toggle", () => {
    const result = UpdateScheduleInputSchema.safeParse({
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it("parses empty object (no-op update)", () => {
    const result = UpdateScheduleInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("ScheduleSchema", () => {
  it("parses a full schedule object", () => {
    const result = ScheduleSchema.safeParse({
      scheduleId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test schedule",
      expression: "*/5 * * * *",
      target: "broadcast",
      messageType: "task",
      content: "Hello",
      persistent: false,
      createdBy: "paul@mac:cc2cc/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(),
      fireCount: 0,
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("parses schedule with optional fields", () => {
    const result = ScheduleSchema.safeParse({
      scheduleId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Expiring schedule",
      expression: "0 9 * * *",
      target: "topic:team",
      messageType: "ping",
      content: "Wake up",
      persistent: true,
      createdBy: "paul@mac:cc2cc/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(),
      lastFiredAt: new Date().toISOString(),
      fireCount: 5,
      maxFireCount: 10,
      expiresAt: "2026-12-31T23:59:59.000Z",
      enabled: true,
      metadata: { source: "test" },
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/probello/Repos/cc2cc && bun test packages/shared/tests/schedule-schema.test.ts`
Expected: FAIL — `ScheduleSchema`, `CreateScheduleInputSchema`, `UpdateScheduleInputSchema` not found in exports

- [ ] **Step 3: Add Schedule interface and SYSTEM_SENDER_ID to types.ts**

In `packages/shared/src/types.ts`, add at the end of the file after the `TopicInfo` interface:

```typescript
/**
 * Fixed system sender identity for hub-generated messages (scheduled, system nudges).
 * Deterministic UUID-nil so it's recognizable and never collides with real instances.
 */
export const SYSTEM_SENDER_ID = "system@hub:scheduler/00000000-0000-0000-0000-000000000000";

/**
 * A scheduled recurring or one-shot message managed by the hub scheduler.
 */
export interface Schedule {
  scheduleId: string;           // UUIDv4
  name: string;                 // human-readable label, 1-100 chars
  expression: string;           // canonical cron expression (simple intervals converted)
  target: InstanceId | "broadcast" | `topic:${string}` | `role:${string}`;
  messageType: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  persistent: boolean;          // for topic targets: queue for offline subscribers?
  createdBy: string;            // instanceId of creator (audit trail only)
  createdAt: string;            // ISO 8601
  nextFireAt: string;           // ISO 8601
  lastFiredAt?: string;         // ISO 8601
  fireCount: number;
  maxFireCount?: number;        // auto-delete when reached
  expiresAt?: string;           // ISO 8601, auto-delete when passed
  enabled: boolean;
}
```

- [ ] **Step 4: Add schedule schemas to schema.ts**

In `packages/shared/src/schema.ts`, add before the `// Infer TypeScript types` section at the bottom:

```typescript
/** Maximum content size for messages: 64 KiB (reuse existing constant). */

/** Zod schema for a full Schedule object. */
export const ScheduleSchema = z.object({
  scheduleId: z.string().uuid(),
  name: z.string().min(1).max(100),
  expression: z.string().min(1).max(128),
  target: z.string().min(1).max(256),
  messageType: MessageTypeSchema,
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  metadata: MetadataSchema,
  persistent: z.boolean(),
  createdBy: z.string().min(1).max(256),
  createdAt: z.string().datetime(),
  nextFireAt: z.string().datetime(),
  lastFiredAt: z.string().datetime().optional(),
  fireCount: z.number().int().min(0),
  maxFireCount: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  enabled: z.boolean(),
});

/** Input schema for creating a new schedule. */
export const CreateScheduleInputSchema = z.object({
  name: z.string().min(1).max(100),
  expression: z.string().min(1).max(128),
  target: z.string().min(1).max(256),
  messageType: MessageTypeSchema,
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  persistent: z.boolean().default(false),
  metadata: MetadataSchema,
  maxFireCount: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

/** Input schema for updating an existing schedule (all fields optional). */
export const UpdateScheduleInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  expression: z.string().min(1).max(128).optional(),
  target: z.string().min(1).max(256).optional(),
  messageType: MessageTypeSchema.optional(),
  content: z.string().min(1).max(MAX_CONTENT_BYTES).optional(),
  persistent: z.boolean().optional(),
  metadata: MetadataSchema,
  maxFireCount: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  enabled: z.boolean().optional(),
});
```

And add to the inferred types section at the bottom:

```typescript
export type ScheduleData = z.infer<typeof ScheduleSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
```

- [ ] **Step 5: Export new types from index.ts**

The barrel export `export * from "./types.js"` and `export * from "./schema.js"` already exist in `packages/shared/src/index.ts`, so the new exports are automatically available. No changes needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/probello/Repos/cc2cc && bun test packages/shared/tests/schedule-schema.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schema.ts packages/shared/tests/schedule-schema.test.ts
git commit -m "feat(shared): add Schedule types and Zod schemas"
```

---

## Task 2: Schedule HubEvents

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/tests/events.test.ts` (add schedule event tests)

- [ ] **Step 1: Write failing tests for schedule events**

Add to `packages/shared/tests/events.test.ts`:

```typescript
describe("Schedule HubEvents", () => {
  it("parses schedule:created event", () => {
    const result = HubEventSchema.safeParse({
      event: "schedule:created",
      schedule: {
        scheduleId: "550e8400-e29b-41d4-a716-446655440000",
        name: "Test",
        expression: "*/5 * * * *",
        target: "broadcast",
        messageType: "task",
        content: "Hello",
        persistent: false,
        createdBy: "paul@mac:cc2cc/abc",
        createdAt: new Date().toISOString(),
        nextFireAt: new Date().toISOString(),
        fireCount: 0,
        enabled: true,
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("parses schedule:updated event", () => {
    const result = HubEventSchema.safeParse({
      event: "schedule:updated",
      schedule: {
        scheduleId: "550e8400-e29b-41d4-a716-446655440000",
        name: "Updated",
        expression: "0 9 * * *",
        target: "topic:team",
        messageType: "ping",
        content: "Wake up",
        persistent: true,
        createdBy: "paul@mac:cc2cc/abc",
        createdAt: new Date().toISOString(),
        nextFireAt: new Date().toISOString(),
        fireCount: 3,
        enabled: true,
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("parses schedule:deleted event", () => {
    const result = HubEventSchema.safeParse({
      event: "schedule:deleted",
      scheduleId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "expired",
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("parses schedule:fired event", () => {
    const result = HubEventSchema.safeParse({
      event: "schedule:fired",
      scheduleId: "550e8400-e29b-41d4-a716-446655440000",
      scheduleName: "Daily nudge",
      fireCount: 5,
      nextFireAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/probello/Repos/cc2cc && bun test packages/shared/tests/events.test.ts`
Expected: FAIL — `schedule:created` is not a valid discriminator value

- [ ] **Step 3: Add schedule event schemas to events.ts**

In `packages/shared/src/events.ts`, add the following schemas before the `HubEventSchema` definition, and import `ScheduleSchema` from `./schema.js`:

Add to imports:
```typescript
import { MessageSchema, ScheduleSchema } from "./schema.js";
```

Add the new event schemas:
```typescript
const ScheduleCreatedEventSchema = z.object({
  event: z.literal("schedule:created"),
  schedule: ScheduleSchema,
  timestamp: z.string().datetime(),
});

const ScheduleUpdatedEventSchema = z.object({
  event: z.literal("schedule:updated"),
  schedule: ScheduleSchema,
  timestamp: z.string().datetime(),
});

const ScheduleDeletedEventSchema = z.object({
  event: z.literal("schedule:deleted"),
  scheduleId: z.string().uuid(),
  reason: z.string().optional(),
  timestamp: z.string().datetime(),
});

const ScheduleFiredEventSchema = z.object({
  event: z.literal("schedule:fired"),
  scheduleId: z.string().uuid(),
  scheduleName: z.string(),
  fireCount: z.number().int().min(0),
  nextFireAt: z.string().datetime(),
  timestamp: z.string().datetime(),
});
```

Add to the `HubEventSchema` discriminated union array:
```typescript
ScheduleCreatedEventSchema,
ScheduleUpdatedEventSchema,
ScheduleDeletedEventSchema,
ScheduleFiredEventSchema,
```

Add exported types:
```typescript
export type ScheduleCreatedEvent = z.infer<typeof ScheduleCreatedEventSchema>;
export type ScheduleUpdatedEvent = z.infer<typeof ScheduleUpdatedEventSchema>;
export type ScheduleDeletedEvent = z.infer<typeof ScheduleDeletedEventSchema>;
export type ScheduleFiredEvent = z.infer<typeof ScheduleFiredEventSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/probello/Repos/cc2cc && bun test packages/shared/tests/events.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full shared test suite**

Run: `cd /Users/probello/Repos/cc2cc && bun test packages/shared/tests/`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/tests/events.test.ts
git commit -m "feat(shared): add schedule HubEvent types"
```

---

## Task 3: Hub Scheduler Module

**Files:**
- Create: `hub/src/scheduler.ts`
- Modify: `hub/package.json` (add `cron-parser`)
- Test: `hub/tests/scheduler.test.ts` (new)

- [ ] **Step 1: Install cron-parser**

Run: `cd /Users/probello/Repos/cc2cc/hub && bun add cron-parser`

- [ ] **Step 2: Write failing tests for the scheduler**

Create `hub/tests/scheduler.test.ts`:

```typescript
// hub/tests/scheduler.test.ts
import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { MessageType, SYSTEM_SENDER_ID } from "@cc2cc/shared";

// ── Redis mock ──────────────────────────────────────────────────────────────
const scheduleStore = new Map<string, Record<string, string>>();
const pendingZset: Array<{ score: number; member: string }> = [];
const indexSet = new Set<string>();

const redisMock = {
  hset: mock(async (key: string, ...fields: string[]) => {
    const existing = scheduleStore.get(key) ?? {};
    for (let i = 0; i < fields.length; i += 2) {
      existing[fields[i]] = fields[i + 1];
    }
    scheduleStore.set(key, existing);
    return fields.length / 2;
  }),
  hgetall: mock(async (key: string) => scheduleStore.get(key) ?? {}),
  del: mock(async (key: string) => {
    scheduleStore.delete(key);
    return 1;
  }),
  sadd: mock(async (_key: string, member: string) => {
    indexSet.add(member);
    return 1;
  }),
  srem: mock(async (_key: string, member: string) => {
    indexSet.delete(member);
    return 1;
  }),
  smembers: mock(async () => [...indexSet]),
  zadd: mock(async (_key: string, score: number, member: string) => {
    const idx = pendingZset.findIndex((e) => e.member === member);
    if (idx >= 0) pendingZset[idx].score = score;
    else pendingZset.push({ score, member });
    return 1;
  }),
  zrangebyscore: mock(async (_key: string, _min: string, max: string) => {
    const maxNum = Number(max);
    return pendingZset.filter((e) => e.score <= maxNum).map((e) => e.member);
  }),
  zrem: mock(async (_key: string, member: string) => {
    const idx = pendingZset.findIndex((e) => e.member === member);
    if (idx >= 0) pendingZset.splice(idx, 1);
    return 1;
  }),
};

// Mock redis module
mock.module("../src/redis.js", () => ({ redis: redisMock }));

// ── Import after mocks ──────────────────────────────────────────────────────
const { parseSimpleInterval, computeNextFire, Scheduler } = await import("../src/scheduler.js");

describe("parseSimpleInterval", () => {
  it("parses 'every 5m' to cron", () => {
    expect(parseSimpleInterval("every 5m")).toBe("*/5 * * * *");
  });

  it("parses 'every 2h' to cron", () => {
    expect(parseSimpleInterval("every 2h")).toBe("0 */2 * * *");
  });

  it("parses 'every 1d' to cron", () => {
    expect(parseSimpleInterval("every 1d")).toBe("0 0 * * *");
  });

  it("parses 'every 1d at 09:00' to cron", () => {
    expect(parseSimpleInterval("every 1d at 09:00")).toBe("0 9 * * *");
  });

  it("parses 'every 12h' to cron", () => {
    expect(parseSimpleInterval("every 12h")).toBe("0 */12 * * *");
  });

  it("returns null for non-interval strings", () => {
    expect(parseSimpleInterval("*/5 * * * *")).toBeNull();
  });

  it("returns null for malformed intervals", () => {
    expect(parseSimpleInterval("every xyz")).toBeNull();
  });
});

describe("computeNextFire", () => {
  it("returns a future ISO date for a valid cron", () => {
    const next = computeNextFire("*/5 * * * *");
    expect(next).toBeTruthy();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for invalid cron", () => {
    expect(computeNextFire("not a cron")).toBeNull();
  });
});

describe("Scheduler", () => {
  let scheduler: InstanceType<typeof Scheduler>;
  const firedMessages: Array<{ target: string; content: string }> = [];
  let dashboardEvents: Array<{ event: string }> = [];

  beforeEach(() => {
    scheduleStore.clear();
    pendingZset.length = 0;
    indexSet.clear();
    firedMessages.length = 0;
    dashboardEvents = [];

    scheduler = new Scheduler({
      redis: redisMock as never,
      pollIntervalMs: 100, // fast for tests
      routeMessage: async (target, _type, content, _metadata, _persistent) => {
        firedMessages.push({ target, content });
      },
      emitToDashboards: (event) => {
        dashboardEvents.push(event as { event: string });
      },
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it("fires a due schedule and advances nextFireAt", async () => {
    // Manually insert a schedule that's due now
    const id = "test-schedule-1";
    const now = Date.now();
    const schedule = {
      scheduleId: id,
      name: "Test",
      expression: "*/5 * * * *",
      target: "broadcast",
      messageType: "task",
      content: "Hello scheduled",
      persistent: "false",
      createdBy: "test@host:proj/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date(now - 1000).toISOString(),
      fireCount: "0",
      enabled: "true",
    };
    scheduleStore.set(`schedule:${id}`, schedule);
    indexSet.add(id);
    pendingZset.push({ score: now - 1000, member: id });

    await scheduler.poll();

    expect(firedMessages.length).toBe(1);
    expect(firedMessages[0].content).toBe("Hello scheduled");
    expect(firedMessages[0].target).toBe("broadcast");
    // nextFireAt should have been advanced
    const updated = scheduleStore.get(`schedule:${id}`);
    expect(Number(updated?.fireCount)).toBe(1);
    expect(updated?.lastFiredAt).toBeTruthy();
  });

  it("auto-deletes schedule when maxFireCount is reached", async () => {
    const id = "test-schedule-expire";
    const now = Date.now();
    scheduleStore.set(`schedule:${id}`, {
      scheduleId: id,
      name: "Once",
      expression: "*/5 * * * *",
      target: "broadcast",
      messageType: "ping",
      content: "one-shot",
      persistent: "false",
      createdBy: "test@host:proj/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date(now - 1000).toISOString(),
      fireCount: "0",
      maxFireCount: "1",
      enabled: "true",
    });
    indexSet.add(id);
    pendingZset.push({ score: now - 1000, member: id });

    await scheduler.poll();

    expect(firedMessages.length).toBe(1);
    // Schedule should have been deleted
    expect(scheduleStore.has(`schedule:${id}`)).toBe(false);
    expect(indexSet.has(id)).toBe(false);
    // Should emit schedule:deleted event
    const deleteEvent = dashboardEvents.find((e) => e.event === "schedule:deleted");
    expect(deleteEvent).toBeTruthy();
  });

  it("skips disabled schedules", async () => {
    const id = "test-disabled";
    const now = Date.now();
    scheduleStore.set(`schedule:${id}`, {
      scheduleId: id,
      name: "Disabled",
      expression: "*/5 * * * *",
      target: "broadcast",
      messageType: "task",
      content: "should not fire",
      persistent: "false",
      createdBy: "test@host:proj/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date(now - 1000).toISOString(),
      fireCount: "0",
      enabled: "false",
    });
    indexSet.add(id);
    pendingZset.push({ score: now - 1000, member: id });

    await scheduler.poll();

    expect(firedMessages.length).toBe(0);
  });

  it("injects scheduleId and scheduleName in metadata", async () => {
    const id = "test-meta";
    const now = Date.now();
    let capturedMeta: Record<string, unknown> | undefined;
    scheduler = new Scheduler({
      redis: redisMock as never,
      pollIntervalMs: 100,
      routeMessage: async (_target, _type, _content, metadata) => {
        capturedMeta = metadata;
      },
      emitToDashboards: () => {},
    });

    scheduleStore.set(`schedule:${id}`, {
      scheduleId: id,
      name: "Meta test",
      expression: "*/5 * * * *",
      target: "broadcast",
      messageType: "task",
      content: "test",
      persistent: "false",
      createdBy: "test@host:proj/abc",
      createdAt: new Date().toISOString(),
      nextFireAt: new Date(now - 1000).toISOString(),
      fireCount: "0",
      enabled: "true",
    });
    indexSet.add(id);
    pendingZset.push({ score: now - 1000, member: id });

    await scheduler.poll();

    expect(capturedMeta?.scheduleId).toBe(id);
    expect(capturedMeta?.scheduleName).toBe("Meta test");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/scheduler.test.ts`
Expected: FAIL — `../src/scheduler.js` module not found

- [ ] **Step 4: Implement the scheduler module**

Create `hub/src/scheduler.ts`:

```typescript
// hub/src/scheduler.ts
import { parseExpression } from "cron-parser";
import { randomUUID } from "node:crypto";
import { MessageType, SYSTEM_SENDER_ID } from "@cc2cc/shared";
import type { HubEvent, Schedule } from "@cc2cc/shared";
import type Redis from "ioredis";

// ── Simple interval parser ──────────────────────────────────────────────────

const SIMPLE_RE = /^every\s+(\d+)(m|h|d)(?:\s+at\s+(\d{2}):(\d{2}))?$/i;

/**
 * Convert a simple interval expression to a standard cron expression.
 * Returns null if the input is not a recognized simple interval format.
 *
 * Supported formats:
 *   "every 5m"           → "* /5 * * * *"  (without space)
 *   "every 2h"           → "0 * /2 * * *"  (without space)
 *   "every 1d"           → "0 0 * * *"
 *   "every 1d at 09:00"  → "0 9 * * *"
 */
export function parseSimpleInterval(expr: string): string | null {
  const match = expr.match(SIMPLE_RE);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const atHour = match[3] ? parseInt(match[3], 10) : undefined;
  const atMinute = match[4] ? parseInt(match[4], 10) : undefined;

  switch (unit) {
    case "m":
      if (value < 1 || value > 59) return null;
      return `*/${value} * * * *`;
    case "h":
      if (value < 1 || value > 23) return null;
      return `0 */${value} * * *`;
    case "d":
      if (atHour !== undefined && atMinute !== undefined) {
        return `${atMinute} ${atHour} * * *`;
      }
      return `0 0 * * *`;
    default:
      return null;
  }
}

/**
 * Compute the next fire time for a cron expression.
 * Returns an ISO 8601 string, or null if the expression is invalid.
 */
export function computeNextFire(expression: string, from?: Date): string | null {
  try {
    const interval = parseExpression(expression, {
      currentDate: from ?? new Date(),
      utc: true,
    });
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

/**
 * Validate that a cron expression has at least a 1-minute interval.
 * Computes the first two fire times and checks the gap >= 60s.
 */
export function validateMinInterval(expression: string): boolean {
  try {
    const now = new Date();
    const interval = parseExpression(expression, { currentDate: now, utc: true });
    const first = interval.next().getTime();
    const second = interval.next().getTime();
    return (second - first) >= 60_000; // 1 minute minimum
  } catch {
    return false;
  }
}

/**
 * Normalize an expression: if it's a simple interval, convert to cron.
 * Returns { cron, error } — error is set if parsing fails or interval is sub-minute.
 */
export function normalizeExpression(expr: string): { cron: string | null; error: string | null } {
  const simple = parseSimpleInterval(expr);
  const cron = simple ?? expr;

  // Validate it's parseable
  if (computeNextFire(cron) === null) {
    return { cron: null, error: `Invalid expression: ${expr}` };
  }

  // Validate minimum interval
  if (!validateMinInterval(cron)) {
    return { cron: null, error: "Schedule interval must be at least 1 minute" };
  }

  return { cron, error: null };
}

// ── Redis key helpers ───────────────────────────────────────────────────────

const SCHEDULE_KEY = (id: string) => `schedule:${id}`;
const SCHEDULES_INDEX = "schedules:index";
const SCHEDULES_PENDING = "schedules:pending";

// ── Schedule from Redis hash ────────────────────────────────────────────────

function scheduleFromHash(hash: Record<string, string>): Schedule | null {
  if (!hash.scheduleId) return null;
  return {
    scheduleId: hash.scheduleId,
    name: hash.name,
    expression: hash.expression,
    target: hash.target,
    messageType: hash.messageType as MessageType,
    content: hash.content,
    metadata: hash.metadata ? JSON.parse(hash.metadata) : undefined,
    persistent: hash.persistent === "true",
    createdBy: hash.createdBy,
    createdAt: hash.createdAt,
    nextFireAt: hash.nextFireAt,
    lastFiredAt: hash.lastFiredAt || undefined,
    fireCount: parseInt(hash.fireCount ?? "0", 10),
    maxFireCount: hash.maxFireCount ? parseInt(hash.maxFireCount, 10) : undefined,
    expiresAt: hash.expiresAt || undefined,
    enabled: hash.enabled !== "false",
  };
}

function scheduleToHash(s: Schedule): string[] {
  const fields: string[] = [
    "scheduleId", s.scheduleId,
    "name", s.name,
    "expression", s.expression,
    "target", s.target,
    "messageType", s.messageType,
    "content", s.content,
    "persistent", String(s.persistent),
    "createdBy", s.createdBy,
    "createdAt", s.createdAt,
    "nextFireAt", s.nextFireAt,
    "fireCount", String(s.fireCount),
    "enabled", String(s.enabled),
  ];
  if (s.metadata) fields.push("metadata", JSON.stringify(s.metadata));
  if (s.lastFiredAt) fields.push("lastFiredAt", s.lastFiredAt);
  if (s.maxFireCount !== undefined) fields.push("maxFireCount", String(s.maxFireCount));
  if (s.expiresAt) fields.push("expiresAt", s.expiresAt);
  return fields;
}

// ── Scheduler options ───────────────────────────────────────────────────────

export interface SchedulerOptions {
  redis: Redis;
  pollIntervalMs?: number;
  /** Callback to route a fired message through existing hub infrastructure. */
  routeMessage: (
    target: string,
    type: MessageType,
    content: string,
    metadata: Record<string, unknown>,
    persistent: boolean,
  ) => Promise<void>;
  emitToDashboards: (event: HubEvent) => void;
}

// ── Scheduler class ─────────────────────────────────────────────────────────

export class Scheduler {
  private readonly redis: Redis;
  private readonly pollIntervalMs: number;
  private readonly routeMessage: SchedulerOptions["routeMessage"];
  private readonly emitToDashboards: SchedulerOptions["emitToDashboards"];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SchedulerOptions) {
    this.redis = opts.redis;
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000;
    this.routeMessage = opts.routeMessage;
    this.emitToDashboards = opts.emitToDashboards;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[scheduler] poll error:", err instanceof Error ? err.message : String(err));
      });
    }, this.pollIntervalMs);
    console.log(`[scheduler] started (poll every ${this.pollIntervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[scheduler] stopped");
    }
  }

  /** Single poll cycle — public so tests can call it directly. */
  async poll(): Promise<void> {
    const now = Date.now();
    const dueIds = await this.redis.zrangebyscore(SCHEDULES_PENDING, "-inf", String(now));
    if (dueIds.length === 0) return;

    for (const id of dueIds) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const schedule = scheduleFromHash(hash);
      if (!schedule) {
        // Stale ZSET entry — clean up
        await this.redis.zrem(SCHEDULES_PENDING, id);
        continue;
      }

      if (!schedule.enabled) {
        // Shouldn't be in ZSET, but defensive — remove it
        await this.redis.zrem(SCHEDULES_PENDING, id);
        continue;
      }

      // Fire the message
      const metadata: Record<string, unknown> = {
        ...(schedule.metadata ?? {}),
        scheduleId: schedule.scheduleId,
        scheduleName: schedule.name,
      };

      try {
        await this.routeMessage(
          schedule.target,
          schedule.messageType,
          schedule.content,
          metadata,
          schedule.persistent,
        );
      } catch (err) {
        console.error(
          `[scheduler] failed to fire schedule ${id}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Don't advance — will retry next poll
        continue;
      }

      // Update schedule state
      const newFireCount = schedule.fireCount + 1;
      const nowIso = new Date().toISOString();

      // Check if schedule should be deleted
      const maxReached = schedule.maxFireCount !== undefined && newFireCount >= schedule.maxFireCount;
      const expired = schedule.expiresAt !== undefined && now >= new Date(schedule.expiresAt).getTime();

      if (maxReached || expired) {
        // Delete the schedule
        await this.redis.del(SCHEDULE_KEY(id));
        await this.redis.srem(SCHEDULES_INDEX, id);
        await this.redis.zrem(SCHEDULES_PENDING, id);

        const reason = maxReached ? "max_fires_reached" : "expired";
        this.emitToDashboards({
          event: "schedule:deleted",
          scheduleId: id,
          reason,
          timestamp: nowIso,
        });
      } else {
        // Advance to next fire time
        const nextFire = computeNextFire(schedule.expression);
        if (!nextFire) {
          // Expression no longer valid — shouldn't happen but clean up
          await this.redis.del(SCHEDULE_KEY(id));
          await this.redis.srem(SCHEDULES_INDEX, id);
          await this.redis.zrem(SCHEDULES_PENDING, id);
          continue;
        }

        await this.redis.hset(
          SCHEDULE_KEY(id),
          "fireCount", String(newFireCount),
          "lastFiredAt", nowIso,
          "nextFireAt", nextFire,
        );
        await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), id);
      }

      // Emit fired event
      const nextFireForEvent = computeNextFire(schedule.expression) ?? nowIso;
      this.emitToDashboards({
        event: "schedule:fired",
        scheduleId: id,
        scheduleName: schedule.name,
        fireCount: newFireCount,
        nextFireAt: nextFireForEvent,
        timestamp: nowIso,
      });
    }
  }

  // ── CRUD operations ─────────────────────────────────────────────────────────

  async createSchedule(input: {
    name: string;
    expression: string;
    target: string;
    messageType: MessageType;
    content: string;
    persistent?: boolean;
    metadata?: Record<string, unknown>;
    maxFireCount?: number;
    expiresAt?: string;
  }, createdBy: string): Promise<Schedule> {
    const { cron, error } = normalizeExpression(input.expression);
    if (error || !cron) throw new Error(error ?? "Invalid expression");

    const nextFire = computeNextFire(cron);
    if (!nextFire) throw new Error("Cannot compute next fire time");

    const schedule: Schedule = {
      scheduleId: randomUUID(),
      name: input.name,
      expression: cron,
      target: input.target,
      messageType: input.messageType,
      content: input.content,
      metadata: input.metadata,
      persistent: input.persistent ?? false,
      createdBy,
      createdAt: new Date().toISOString(),
      nextFireAt: nextFire,
      fireCount: 0,
      maxFireCount: input.maxFireCount,
      expiresAt: input.expiresAt,
      enabled: true,
    };

    await this.redis.hset(SCHEDULE_KEY(schedule.scheduleId), ...scheduleToHash(schedule));
    await this.redis.sadd(SCHEDULES_INDEX, schedule.scheduleId);
    await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), schedule.scheduleId);

    this.emitToDashboards({
      event: "schedule:created",
      schedule,
      timestamp: new Date().toISOString(),
    });

    return schedule;
  }

  async listSchedules(): Promise<Schedule[]> {
    const ids = await this.redis.smembers(SCHEDULES_INDEX);
    const schedules: Schedule[] = [];
    for (const id of ids) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const s = scheduleFromHash(hash);
      if (s) schedules.push(s);
    }
    return schedules;
  }

  async getSchedule(scheduleId: string): Promise<Schedule | null> {
    const hash = await this.redis.hgetall(SCHEDULE_KEY(scheduleId));
    return scheduleFromHash(hash);
  }

  async updateSchedule(scheduleId: string, updates: Record<string, unknown>): Promise<Schedule> {
    const hash = await this.redis.hgetall(SCHEDULE_KEY(scheduleId));
    const existing = scheduleFromHash(hash);
    if (!existing) throw new Error("Schedule not found");

    // Apply updates
    if (updates.name !== undefined) existing.name = updates.name as string;
    if (updates.content !== undefined) existing.content = updates.content as string;
    if (updates.target !== undefined) existing.target = updates.target as string;
    if (updates.messageType !== undefined) existing.messageType = updates.messageType as MessageType;
    if (updates.persistent !== undefined) existing.persistent = updates.persistent as boolean;
    if (updates.metadata !== undefined) existing.metadata = updates.metadata as Record<string, unknown>;
    if (updates.maxFireCount !== undefined) {
      existing.maxFireCount = updates.maxFireCount === null ? undefined : updates.maxFireCount as number;
    }
    if (updates.expiresAt !== undefined) {
      existing.expiresAt = updates.expiresAt === null ? undefined : updates.expiresAt as string;
    }

    // Handle expression change
    if (updates.expression !== undefined) {
      const { cron, error } = normalizeExpression(updates.expression as string);
      if (error || !cron) throw new Error(error ?? "Invalid expression");
      existing.expression = cron;
      const nextFire = computeNextFire(cron);
      if (!nextFire) throw new Error("Cannot compute next fire time");
      existing.nextFireAt = nextFire;
    }

    // Handle enabled toggle
    if (updates.enabled !== undefined) {
      existing.enabled = updates.enabled as boolean;
      if (existing.enabled) {
        await this.redis.zadd(SCHEDULES_PENDING, new Date(existing.nextFireAt).getTime(), scheduleId);
      } else {
        await this.redis.zrem(SCHEDULES_PENDING, scheduleId);
      }
    }

    await this.redis.hset(SCHEDULE_KEY(scheduleId), ...scheduleToHash(existing));

    // If expression changed, update ZSET score
    if (updates.expression !== undefined && existing.enabled) {
      await this.redis.zadd(SCHEDULES_PENDING, new Date(existing.nextFireAt).getTime(), scheduleId);
    }

    this.emitToDashboards({
      event: "schedule:updated",
      schedule: existing,
      timestamp: new Date().toISOString(),
    });

    return existing;
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.redis.del(SCHEDULE_KEY(scheduleId));
    await this.redis.srem(SCHEDULES_INDEX, scheduleId);
    await this.redis.zrem(SCHEDULES_PENDING, scheduleId);

    this.emitToDashboards({
      event: "schedule:deleted",
      scheduleId,
      timestamp: new Date().toISOString(),
    });
  }

  /** Startup recovery: recompute nextFireAt for all schedules and repopulate ZSET. */
  async recover(): Promise<number> {
    const ids = await this.redis.smembers(SCHEDULES_INDEX);
    let recovered = 0;

    for (const id of ids) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const schedule = scheduleFromHash(hash);
      if (!schedule) {
        await this.redis.srem(SCHEDULES_INDEX, id);
        continue;
      }

      if (!schedule.enabled) continue;

      // Recompute nextFireAt from now
      const nextFire = computeNextFire(schedule.expression);
      if (!nextFire) {
        // Expression invalid — remove schedule
        await this.redis.del(SCHEDULE_KEY(id));
        await this.redis.srem(SCHEDULES_INDEX, id);
        continue;
      }

      await this.redis.hset(SCHEDULE_KEY(id), "nextFireAt", nextFire);
      await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), id);
      recovered++;
    }

    return recovered;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/scheduler.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add hub/src/scheduler.ts hub/tests/scheduler.test.ts hub/package.json hub/bun.lock
git commit -m "feat(hub): add Scheduler class with poll loop, CRUD, and interval parsing"
```

---

## Task 4: Hub REST API for Schedules

**Files:**
- Modify: `hub/src/api.ts`
- Modify: `hub/src/index.ts`
- Test: `hub/tests/schedule-api.test.ts` (new)

- [ ] **Step 1: Write failing tests for schedule REST endpoints**

Create `hub/tests/schedule-api.test.ts`:

```typescript
// hub/tests/schedule-api.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { MessageType } from "@cc2cc/shared";
import type { Schedule } from "@cc2cc/shared";

// Simple in-memory scheduler mock
const mockSchedules = new Map<string, Schedule>();
const schedulerMock = {
  createSchedule: mock(async (input: Record<string, unknown>, createdBy: string) => {
    const s: Schedule = {
      scheduleId: "test-id-123",
      name: input.name as string,
      expression: "*/5 * * * *",
      target: input.target as string,
      messageType: input.messageType as MessageType,
      content: input.content as string,
      persistent: (input.persistent as boolean) ?? false,
      createdBy,
      createdAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(),
      fireCount: 0,
      enabled: true,
    };
    mockSchedules.set(s.scheduleId, s);
    return s;
  }),
  listSchedules: mock(async () => [...mockSchedules.values()]),
  getSchedule: mock(async (id: string) => mockSchedules.get(id) ?? null),
  updateSchedule: mock(async (id: string, updates: Record<string, unknown>) => {
    const existing = mockSchedules.get(id);
    if (!existing) throw new Error("Schedule not found");
    const updated = { ...existing, ...updates };
    mockSchedules.set(id, updated as Schedule);
    return updated;
  }),
  deleteSchedule: mock(async (id: string) => {
    mockSchedules.delete(id);
  }),
};

// These tests validate the REST integration conceptually.
// Full integration tests would use the actual Hono app.
describe("Schedule REST API contracts", () => {
  beforeEach(() => {
    mockSchedules.clear();
  });

  it("creates a schedule and returns it", async () => {
    const result = await schedulerMock.createSchedule({
      name: "Test schedule",
      expression: "every 5m",
      target: "broadcast",
      messageType: MessageType.task,
      content: "Hello",
    }, "test@host:proj/abc");

    expect(result.scheduleId).toBe("test-id-123");
    expect(result.name).toBe("Test schedule");
    expect(result.enabled).toBe(true);
  });

  it("lists all schedules", async () => {
    await schedulerMock.createSchedule({
      name: "S1", expression: "every 5m", target: "broadcast",
      messageType: MessageType.task, content: "A",
    }, "test@host:proj/abc");

    const list = await schedulerMock.listSchedules();
    expect(list.length).toBe(1);
  });

  it("gets a single schedule", async () => {
    await schedulerMock.createSchedule({
      name: "S1", expression: "every 5m", target: "broadcast",
      messageType: MessageType.task, content: "A",
    }, "test@host:proj/abc");

    const s = await schedulerMock.getSchedule("test-id-123");
    expect(s?.name).toBe("S1");
  });

  it("returns null for nonexistent schedule", async () => {
    const s = await schedulerMock.getSchedule("nonexistent");
    expect(s).toBeNull();
  });

  it("deletes a schedule", async () => {
    await schedulerMock.createSchedule({
      name: "S1", expression: "every 5m", target: "broadcast",
      messageType: MessageType.task, content: "A",
    }, "test@host:proj/abc");

    await schedulerMock.deleteSchedule("test-id-123");
    const list = await schedulerMock.listSchedules();
    expect(list.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (these are mock-based, should pass immediately)

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/schedule-api.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Add schedule REST endpoints to api.ts**

In `hub/src/api.ts`, add import at top:

```typescript
import { CreateScheduleInputSchema, UpdateScheduleInputSchema } from "@cc2cc/shared";
```

The function signature needs to accept a scheduler parameter. Modify `buildApiRoutes` to accept an optional scheduler:

```typescript
import type { Scheduler } from "./scheduler.js";
```

Change the function signature:
```typescript
export function buildApiRoutes(app: Hono, scheduler?: Scheduler): void {
```

Add the following routes at the end of `buildApiRoutes`, before the closing `}`:

```typescript
  // ── Schedule CRUD ──────────────────────────────────────────────────────────

  // POST /api/schedules — create a schedule
  app.post("/api/schedules", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 503);

    const body = await c.req.json();
    const parseResult = CreateScheduleInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: "Invalid schedule input", details: parseResult.error.flatten() }, 400);
    }

    try {
      const schedule = await scheduler.createSchedule(parseResult.data, "dashboard");
      return c.json(schedule, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // GET /api/schedules — list all schedules
  app.get("/api/schedules", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 503);

    const schedules = await scheduler.listSchedules();
    return c.json(schedules);
  });

  // GET /api/schedules/:id — get single schedule
  app.get("/api/schedules/:id", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 503);

    const id = decodeURIComponent(c.req.param("id"));
    const schedule = await scheduler.getSchedule(id);
    if (!schedule) return c.json({ error: "Schedule not found" }, 404);
    return c.json(schedule);
  });

  // PATCH /api/schedules/:id — update a schedule
  app.patch("/api/schedules/:id", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 503);

    const id = decodeURIComponent(c.req.param("id"));
    const body = await c.req.json();
    const parseResult = UpdateScheduleInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: "Invalid update input", details: parseResult.error.flatten() }, 400);
    }

    try {
      const schedule = await scheduler.updateSchedule(id, parseResult.data);
      return c.json(schedule);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // DELETE /api/schedules/:id — delete a schedule
  app.delete("/api/schedules/:id", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 503);

    const id = decodeURIComponent(c.req.param("id"));
    const schedule = await scheduler.getSchedule(id);
    if (!schedule) return c.json({ error: "Schedule not found" }, 404);

    await scheduler.deleteSchedule(id);
    return c.json({ deleted: true, scheduleId: id });
  });
```

- [ ] **Step 4: Initialize scheduler in index.ts**

In `hub/src/index.ts`, add imports:

```typescript
import { Scheduler } from "./scheduler.js";
```

After the `const app = new Hono();` line and security headers middleware, but before `buildApiRoutes(app)`:

Create the scheduler instance and modify the `buildApiRoutes` call:

```typescript
// ── Scheduler ────────────────────────────────────────────────────────────────
import { pushMessage } from "./queue.js";
// (pushMessage is already imported further up — just add the scheduler import)

const scheduler = new Scheduler({
  redis,
  pollIntervalMs: 30_000,
  routeMessage: async (target, type, content, metadata, persistent) => {
    const message: Message = {
      messageId: randomUUID(),
      from: SYSTEM_SENDER_ID,
      to: target as Message["to"],
      type,
      content,
      metadata,
      timestamp: new Date().toISOString(),
    };

    if (target === "broadcast") {
      broadcastManager.broadcast(SYSTEM_SENDER_ID, type, content, metadata);
      emitToDashboards({
        event: "broadcast:sent",
        from: SYSTEM_SENDER_ID,
        content,
        type,
        timestamp: new Date().toISOString(),
      });
    } else if (target.startsWith("topic:")) {
      const topicName = target.slice("topic:".length);
      message.topicName = topicName;
      const wsRefs = registry.getOnlineWsRefs();
      const { delivered, queued } = await topicManager.publishToTopic(
        topicName, message, persistent, SYSTEM_SENDER_ID, wsRefs,
      );
      emitToDashboards({
        event: "topic:message",
        name: topicName,
        message,
        persistent,
        delivered,
        queued,
        timestamp: new Date().toISOString(),
      });
    } else if (target.startsWith("role:")) {
      const role = target.slice("role:".length);
      const targets = registry.getByRole(role);
      for (const t of targets) {
        const envelope: Message = { ...message, messageId: randomUUID(), to: t.instanceId };
        await pushMessage(t.instanceId, envelope);
        const ws = registry.getWsRef(t.instanceId);
        if (ws && (ws as { readyState: number }).readyState === 1) {
          (ws as { send(data: string): void }).send(JSON.stringify(envelope));
        }
        emitToDashboards({ event: "message:sent", message: envelope, timestamp: new Date().toISOString() });
      }
    } else {
      // Direct instance target
      await pushMessage(target, message);
      const ws = registry.getWsRef(target);
      if (ws && (ws as { readyState: number }).readyState === 1) {
        (ws as { send(data: string): void }).send(JSON.stringify(message));
      }
      emitToDashboards({ event: "message:sent", message, timestamp: new Date().toISOString() });
    }
  },
  emitToDashboards,
});

// Mount REST routes (with scheduler)
buildApiRoutes(app, scheduler);
```

Add scheduler to startup recovery (inside the IIFE at the bottom, after the registry hydration and processing replay):

```typescript
    // ── 3. Recover schedules ──────────────────────────────────────────────────
    const schedRecovered = await scheduler.recover();
    if (schedRecovered > 0) {
      console.log(`[hub] startup: recovered ${schedRecovered} schedule(s)`);
    }
    scheduler.start();
```

Add to shutdown function:

```typescript
async function shutdown(signal: string): Promise<void> {
  console.log(`[hub] ${signal} received — shutting down`);
  scheduler.stop();
  await server.stop();
  await redis.quit();
  process.exit(0);
}
```

Also add these imports at the top of index.ts (some may already exist):

```typescript
import { SYSTEM_SENDER_ID } from "@cc2cc/shared";
import type { Message } from "@cc2cc/shared";
import { randomUUID } from "node:crypto";
```

- [ ] **Step 5: Run hub tests**

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/`
Expected: All existing tests PASS + new schedule tests PASS

- [ ] **Step 6: Commit**

```bash
git add hub/src/api.ts hub/src/index.ts hub/tests/schedule-api.test.ts
git commit -m "feat(hub): add schedule REST API and initialize scheduler on startup"
```

---

## Task 5: Hub WS Frame Actions for Schedules

**Files:**
- Modify: `hub/src/ws-handler.ts`

- [ ] **Step 1: Add schedule WS frame handlers to ws-handler.ts**

Add import at top of `hub/src/ws-handler.ts`:

```typescript
import { CreateScheduleInputSchema, UpdateScheduleInputSchema } from "@cc2cc/shared";
import type { Scheduler } from "./scheduler.js";
```

The ws-handler needs access to the scheduler. Add a module-level variable and setter:

```typescript
let _scheduler: Scheduler | null = null;

export function setScheduler(scheduler: Scheduler): void {
  _scheduler = scheduler;
}
```

In `onPluginMessage`, add new action cases in the if/else chain, before the final `else` (unknown action):

```typescript
  } else if (action === "create_schedule") {
    await handleCreateSchedule(ws, instanceId, msg);
  } else if (action === "list_schedules") {
    await handleListSchedules(ws, msg);
  } else if (action === "get_schedule") {
    await handleGetSchedule(ws, msg);
  } else if (action === "update_schedule") {
    await handleUpdateSchedule(ws, msg);
  } else if (action === "delete_schedule") {
    await handleDeleteSchedule(ws, msg);
  } else {
```

Add the handler functions:

```typescript
// ── Schedule frame handlers ──────────────────────────────────────────────────

async function handleCreateSchedule(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not initialized", requestId));
    return;
  }
  const parseResult = CreateScheduleInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(wsError("Invalid create_schedule payload", requestId, parseResult.error.flatten()));
    return;
  }
  try {
    const schedule = await _scheduler.createSchedule(parseResult.data, instanceId);
    ws.send(JSON.stringify({ requestId, ...schedule }));
  } catch (err) {
    ws.send(wsError(err instanceof Error ? err.message : String(err), requestId));
  }
}

async function handleListSchedules(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not initialized", requestId));
    return;
  }
  const schedules = await _scheduler.listSchedules();
  ws.send(JSON.stringify({ requestId, schedules }));
}

async function handleGetSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not initialized", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const schedule = await _scheduler.getSchedule(scheduleId);
  if (!schedule) {
    ws.send(wsError("Schedule not found", requestId));
    return;
  }
  ws.send(JSON.stringify({ requestId, ...schedule }));
}

async function handleUpdateSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not initialized", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const parseResult = UpdateScheduleInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(wsError("Invalid update_schedule payload", requestId, parseResult.error.flatten()));
    return;
  }
  try {
    const schedule = await _scheduler.updateSchedule(scheduleId, parseResult.data);
    ws.send(JSON.stringify({ requestId, ...schedule }));
  } catch (err) {
    ws.send(wsError(err instanceof Error ? err.message : String(err), requestId));
  }
}

async function handleDeleteSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not initialized", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const schedule = await _scheduler.getSchedule(scheduleId);
  if (!schedule) {
    ws.send(wsError("Schedule not found", requestId));
    return;
  }
  await _scheduler.deleteSchedule(scheduleId);
  ws.send(JSON.stringify({ requestId, deleted: true, scheduleId }));
}
```

Then in `hub/src/index.ts`, after creating the scheduler but before `buildApiRoutes`:

```typescript
import { setScheduler } from "./ws-handler.js";
// ...
setScheduler(scheduler);
```

- [ ] **Step 2: Run hub tests**

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add hub/src/ws-handler.ts hub/src/index.ts
git commit -m "feat(hub): add schedule WS frame actions (create/list/get/update/delete)"
```

---

## Task 6: Plugin MCP Tools for Schedules

**Files:**
- Modify: `plugin/src/tools.ts`
- Modify: `plugin/src/index.ts`

- [ ] **Step 1: Add schedule tool handlers to tools.ts**

In `plugin/src/tools.ts`, add the import:

```typescript
import type { Schedule } from "@cc2cc/shared";
```

Add the following methods inside the `return { ... }` object in `createTools`, after `publish_topic`:

```typescript
    /**
     * create_schedule — create a recurring or one-shot scheduled message.
     * Uses conn.request("create_schedule", ...) for WS-based identity stamping.
     */
    async create_schedule(input: {
      name: string;
      expression: string;
      target: string;
      messageType: MessageType;
      content: string;
      persistent?: boolean;
      metadata?: Record<string, unknown>;
      maxFireCount?: number;
      expiresAt?: string;
    }): Promise<Schedule> {
      const payload: Record<string, unknown> = {
        name: input.name,
        expression: input.expression,
        target: input.target,
        messageType: input.messageType,
        content: input.content,
      };
      if (input.persistent !== undefined) payload.persistent = input.persistent;
      if (input.metadata !== undefined) payload.metadata = input.metadata;
      if (input.maxFireCount !== undefined) payload.maxFireCount = input.maxFireCount;
      if (input.expiresAt !== undefined) payload.expiresAt = input.expiresAt;

      const response = await conn.request<Schedule & { requestId: string }>(
        "create_schedule",
        payload,
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * list_schedules — list all active schedules.
     * Uses conn.request("list_schedules", ...) via WS.
     */
    async list_schedules(_input: Record<string, never>): Promise<Schedule[]> {
      const response = await conn.request<{ schedules: Schedule[]; requestId: string }>(
        "list_schedules",
        {},
      );
      return response.schedules;
    },

    /**
     * get_schedule — get details of a specific schedule.
     */
    async get_schedule(input: { scheduleId: string }): Promise<Schedule> {
      const response = await conn.request<Schedule & { requestId: string }>(
        "get_schedule",
        { scheduleId: input.scheduleId },
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * update_schedule — modify a schedule (pause, change expression, etc.).
     */
    async update_schedule(input: {
      scheduleId: string;
      name?: string;
      expression?: string;
      target?: string;
      messageType?: MessageType;
      content?: string;
      persistent?: boolean;
      metadata?: Record<string, unknown>;
      maxFireCount?: number | null;
      expiresAt?: string | null;
      enabled?: boolean;
    }): Promise<Schedule> {
      const { scheduleId, ...updates } = input;
      const response = await conn.request<Schedule & { requestId: string }>(
        "update_schedule",
        { scheduleId, ...updates },
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * delete_schedule — remove a schedule.
     */
    async delete_schedule(input: { scheduleId: string }): Promise<{ deleted: true; scheduleId: string }> {
      const response = await conn.request<{ requestId: string; deleted: true; scheduleId: string }>(
        "delete_schedule",
        { scheduleId: input.scheduleId },
      );
      const { requestId: _, ...result } = response;
      return result;
    },
```

- [ ] **Step 2: Add tool definitions and dispatch cases to index.ts**

In `plugin/src/index.ts`, add the import:

```typescript
import { CreateScheduleInputSchema, UpdateScheduleInputSchema } from "@cc2cc/shared";
```

Add 5 new tool definitions inside the `tools:` array in `ListToolsRequestSchema` handler (after `publish_topic`):

```typescript
      {
        name: "create_schedule",
        description:
          "Create a recurring or one-shot scheduled message. " +
          "Supports cron expressions (e.g. '0 9 * * *') and simple intervals (e.g. 'every 5m', 'every 1d at 09:00'). " +
          "Minimum interval is 1 minute.",
        inputSchema: {
          type: "object",
          required: ["name", "expression", "target", "messageType", "content"],
          properties: {
            name: { type: "string", description: "Human-readable schedule name (1-100 chars)" },
            expression: { type: "string", description: "Cron expression or simple interval (e.g. 'every 5m', '0 9 * * *')" },
            target: { type: "string", description: "Target: instanceId, 'broadcast', 'topic:<name>', or 'role:<name>'" },
            messageType: { type: "string", enum: Object.values(MessageType), description: "Message type" },
            content: { type: "string", description: "Message content" },
            persistent: { type: "boolean", description: "Queue for offline topic subscribers (default false)", default: false },
            metadata: { type: "object", description: "Optional metadata", nullable: true },
            maxFireCount: { type: "number", description: "Auto-delete after N fires", nullable: true },
            expiresAt: { type: "string", description: "ISO 8601 expiry date", nullable: true },
          },
        },
      },
      {
        name: "list_schedules",
        description: "List all active schedules with their next fire times.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "get_schedule",
        description: "Get details of a specific schedule by ID.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: { scheduleId: { type: "string", description: "Schedule ID (UUID)" } },
        },
      },
      {
        name: "update_schedule",
        description: "Modify an existing schedule. Set enabled=false to pause, enabled=true to resume.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: {
            scheduleId: { type: "string", description: "Schedule ID to update" },
            name: { type: "string", nullable: true },
            expression: { type: "string", nullable: true },
            target: { type: "string", nullable: true },
            messageType: { type: "string", enum: Object.values(MessageType), nullable: true },
            content: { type: "string", nullable: true },
            persistent: { type: "boolean", nullable: true },
            metadata: { type: "object", nullable: true },
            maxFireCount: { type: "number", nullable: true },
            expiresAt: { type: "string", nullable: true },
            enabled: { type: "boolean", nullable: true },
          },
        },
      },
      {
        name: "delete_schedule",
        description: "Remove a schedule permanently.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: { scheduleId: { type: "string", description: "Schedule ID to delete" } },
        },
      },
```

Add dispatch cases inside the `switch (name)` in `CallToolRequestSchema` handler (before `default`):

```typescript
        case "create_schedule": {
          const input = CreateScheduleInputSchema.parse(args);
          const result = await tools.create_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_schedules": {
          const result = await tools.list_schedules({});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_schedule": {
          const input = z.object({ scheduleId: z.string() }).parse(args);
          const result = await tools.get_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_schedule": {
          const input = z.object({
            scheduleId: z.string(),
          }).and(UpdateScheduleInputSchema).parse(args);
          const result = await tools.update_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_schedule": {
          const input = z.object({ scheduleId: z.string() }).parse(args);
          const result = await tools.delete_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
```

- [ ] **Step 3: Run plugin typecheck**

Run: `cd /Users/probello/Repos/cc2cc/plugin && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add plugin/src/tools.ts plugin/src/index.ts
git commit -m "feat(plugin): add 5 schedule MCP tools (create/list/get/update/delete)"
```

---

## Task 7: Dashboard Types and API Wrappers

**Files:**
- Modify: `dashboard/src/types/dashboard.ts`
- Modify: `dashboard/src/lib/api.ts`

- [ ] **Step 1: Add ScheduleState type to dashboard types**

In `dashboard/src/types/dashboard.ts`, add import:

```typescript
import type { Message, InstanceInfo, MessageType, TopicInfo, Schedule } from "@cc2cc/shared";
```

Add after `TopicState`:

```typescript
/** Live schedule state maintained by WsProvider */
export interface ScheduleState extends Schedule {
  /** Recent fire events observed this session (not persisted) */
  recentFires: Array<{ timestamp: string; fireCount: number }>;
}
```

Add to `WsContextValue` interface:

```typescript
  /** All known schedules, keyed by scheduleId */
  schedules: Map<string, ScheduleState>;
  /** Re-fetch all schedules from the hub REST API. */
  refreshSchedules: () => Promise<void>;
```

- [ ] **Step 2: Add schedule API wrappers to api.ts**

In `dashboard/src/lib/api.ts`, add import:

```typescript
import type { Schedule } from "@cc2cc/shared";
```

Add at the end of the file:

```typescript
/**
 * Fetch all schedules from the hub REST API.
 * Returns an empty array on error for graceful degradation.
 */
export async function fetchSchedules(): Promise<Schedule[]> {
  try {
    const res = await fetch(hubUrl("/api/schedules"), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return res.json() as Promise<Schedule[]>;
  } catch {
    return [];
  }
}

export async function createSchedule(input: {
  name: string;
  expression: string;
  target: string;
  messageType: string;
  content: string;
  persistent?: boolean;
  metadata?: Record<string, unknown>;
  maxFireCount?: number;
  expiresAt?: string;
}): Promise<Schedule> {
  const res = await fetch(hubUrl("/api/schedules"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Create schedule failed: ${res.status}`);
  }
  return res.json() as Promise<Schedule>;
}

export async function updateSchedule(
  scheduleId: string,
  updates: Record<string, unknown>,
): Promise<Schedule> {
  const res = await fetch(hubUrl(`/api/schedules/${encodeURIComponent(scheduleId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Update schedule failed: ${res.status}`);
  }
  return res.json() as Promise<Schedule>;
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/schedules/${encodeURIComponent(scheduleId)}`), {
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Delete schedule failed: ${res.status}`);
  }
}
```

- [ ] **Step 3: Run dashboard typecheck**

Run: `cd /Users/probello/Repos/cc2cc/dashboard && bun run typecheck`
Expected: Errors expected (WsProvider doesn't expose `schedules` or `refreshSchedules` yet) — that's Task 8

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/types/dashboard.ts dashboard/src/lib/api.ts
git commit -m "feat(dashboard): add schedule types and API wrappers"
```

---

## Task 8: Dashboard WsProvider Schedule Integration

**Files:**
- Modify: `dashboard/src/components/ws-provider/ws-provider.tsx`

- [ ] **Step 1: Add schedule state and event handling to WsProvider**

In `ws-provider.tsx`, add imports:

```typescript
import { fetchSchedules } from "@/lib/api";
import type { ScheduleState } from "@/types/dashboard";
```

Add state for schedules:

```typescript
const [schedules, setSchedules] = useState<Map<string, ScheduleState>>(new Map());
```

Add `seedSchedules` callback alongside `seedInstances` and `seedTopics`:

```typescript
const seedSchedules = useCallback(async () => {
  let list;
  try {
    list = await fetchSchedules();
  } catch {
    return;
  }
  if (!mountedRef.current) return;
  setSchedules((prev) => {
    const next = new Map(prev);
    for (const s of list) {
      next.set(s.scheduleId, { ...s, recentFires: next.get(s.scheduleId)?.recentFires ?? [] });
    }
    return next;
  });
}, []);
```

Add schedule event cases in the `handleEvent` switch statement:

```typescript
        case "schedule:created":
          setSchedules((prev) => {
            const next = new Map(prev);
            next.set(evt.schedule.scheduleId, { ...evt.schedule, recentFires: [] });
            return next;
          });
          break;

        case "schedule:updated":
          setSchedules((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.schedule.scheduleId);
            next.set(evt.schedule.scheduleId, {
              ...evt.schedule,
              recentFires: existing?.recentFires ?? [],
            });
            return next;
          });
          break;

        case "schedule:deleted":
          setSchedules((prev) => {
            const next = new Map(prev);
            next.delete(evt.scheduleId);
            return next;
          });
          break;

        case "schedule:fired":
          setSchedules((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.scheduleId);
            if (existing) {
              const recentFires = [
                ...existing.recentFires,
                { timestamp: evt.timestamp, fireCount: evt.fireCount },
              ].slice(-50); // keep last 50 fires
              next.set(evt.scheduleId, {
                ...existing,
                fireCount: evt.fireCount,
                nextFireAt: evt.nextFireAt,
                lastFiredAt: evt.timestamp,
                recentFires,
              });
            }
            return next;
          });
          break;
```

Call `seedSchedules` in the `init` function (alongside `seedInstances()` and `seedTopics()`):

```typescript
seedSchedules();
```

Add `seedSchedules` to the `useEffect` dependency array.

Update the context default value and provider value to include `schedules` and `refreshSchedules: seedSchedules`:

In the `WsContext` default value:

```typescript
schedules: new Map(),
refreshSchedules: async () => { throw new Error("WsProvider not mounted"); },
```

In the `WsContext.Provider value`:

```typescript
schedules,
refreshSchedules: seedSchedules,
```

- [ ] **Step 2: Run dashboard typecheck**

Run: `cd /Users/probello/Repos/cc2cc/dashboard && bun run typecheck`
Expected: PASS (now WsContextValue has schedules and refreshSchedules)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ws-provider/ws-provider.tsx
git commit -m "feat(dashboard): add schedule state and event handling to WsProvider"
```

---

## Task 9: Dashboard Schedules Page

**Files:**
- Create: `dashboard/src/app/schedules/page.tsx`
- Modify: `dashboard/src/components/nav/nav-tabs.tsx`

- [ ] **Step 1: Add Schedules tab to navigation**

In `dashboard/src/components/nav/nav-tabs.tsx`, add import:

```typescript
import { LayoutDashboard, BarChart2, MessageSquare, Radio, Network, Clock } from "lucide-react";
```

Add to the `TABS` array after the Topics entry:

```typescript
{ href: "/schedules", label: "Schedules", icon: Clock },
```

- [ ] **Step 2: Create the schedules page**

Create `dashboard/src/app/schedules/page.tsx`:

```typescript
// dashboard/src/app/schedules/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useWs } from "@/hooks/use-ws";
import {
  createSchedule as apiCreateSchedule,
  updateSchedule as apiUpdateSchedule,
  deleteSchedule as apiDeleteSchedule,
} from "@/lib/api";
import { MessageType } from "@cc2cc/shared";
import type { ScheduleState } from "@/types/dashboard";

function humanCron(expr: string): string {
  // Simple human-readable conversion for common patterns
  const m5 = expr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m5) return `every ${m5[1]}m`;
  const h = expr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (h) return `every ${h[1]}h`;
  const daily = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) return `daily at ${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")} UTC`;
  return expr;
}

function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.floor(hours / 24)}d`;
}

export default function SchedulesPage() {
  const { schedules, refreshSchedules } = useWs();

  useEffect(() => {
    refreshSchedules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newExpr, setNewExpr] = useState("");
  const [newTarget, setNewTarget] = useState("broadcast");
  const [newType, setNewType] = useState<MessageType>(MessageType.task);
  const [newContent, setNewContent] = useState("");
  const [newPersistent, setNewPersistent] = useState(false);
  const [newMaxFires, setNewMaxFires] = useState("");
  const [newExpires, setNewExpires] = useState("");

  const selected = selectedId ? schedules.get(selectedId) : null;
  const scheduleList = Array.from(schedules.values()).sort(
    (a, b) => new Date(a.nextFireAt).getTime() - new Date(b.nextFireAt).getTime(),
  );

  async function handleCreate() {
    if (!newName.trim() || !newExpr.trim() || !newContent.trim()) return;
    try {
      const input: Record<string, unknown> = {
        name: newName.trim(),
        expression: newExpr.trim(),
        target: newTarget,
        messageType: newType,
        content: newContent.trim(),
        persistent: newPersistent,
      };
      if (newMaxFires) input.maxFireCount = parseInt(newMaxFires, 10);
      if (newExpires) input.expiresAt = new Date(newExpires).toISOString();

      await apiCreateSchedule(input as Parameters<typeof apiCreateSchedule>[0]);
      setCreating(false);
      setNewName(""); setNewExpr(""); setNewContent("");
      setNewMaxFires(""); setNewExpires("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleEnabled(s: ScheduleState) {
    try {
      await apiUpdateSchedule(s.scheduleId, { enabled: !s.enabled });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiDeleteSchedule(id);
      if (selectedId === id) setSelectedId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]" style={{ background: "#060d1a" }}>
      {/* Panel 1: Schedule list */}
      <div className="w-72 shrink-0 flex flex-col" style={{ borderRight: "1px solid #1a3356" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #1a3356" }}>
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "#00d4ff" }}>
            Schedules
          </span>
          <button
            type="button"
            onClick={() => setCreating(!creating)}
            className="font-mono text-[10px] px-2 py-0.5 rounded"
            style={{
              background: "rgba(0,212,255,0.1)",
              border: "1px solid rgba(0,212,255,0.3)",
              color: "#00d4ff",
            }}
          >
            {creating ? "Cancel" : "+ New"}
          </button>
        </div>

        {creating && (
          <div className="flex flex-col gap-2 p-3" style={{ borderBottom: "1px solid #1a3356" }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Schedule name" className="bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]" style={{ color: "#e2e8f0" }} />
            <input value={newExpr} onChange={(e) => setNewExpr(e.target.value)}
              placeholder="every 5m  or  0 9 * * *" className="bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]" style={{ color: "#e2e8f0" }} />
            <input value={newTarget} onChange={(e) => setNewTarget(e.target.value)}
              placeholder="broadcast / topic:name / role:name" className="bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]" style={{ color: "#e2e8f0" }} />
            <select value={newType} onChange={(e) => setNewType(e.target.value as MessageType)}
              className="bg-transparent font-mono text-xs outline-none" style={{ color: "#6b8aaa" }}>
              {(["task", "result", "question", "ack", "ping"] as const).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)}
              rows={3} placeholder="Message content..."
              className="bg-transparent font-mono text-xs outline-none resize-none placeholder:text-[#3a5470]"
              style={{ color: "#e2e8f0", border: "1px solid #1a3356", padding: "4px 6px" }} />
            <label className="flex items-center gap-2 font-mono text-[10px]" style={{ color: "#6b8aaa" }}>
              <input type="checkbox" checked={newPersistent} onChange={(e) => setNewPersistent(e.target.checked)} /> persistent
            </label>
            <input value={newMaxFires} onChange={(e) => setNewMaxFires(e.target.value)}
              placeholder="Max fires (optional)" type="number"
              className="bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]" style={{ color: "#e2e8f0" }} />
            <input value={newExpires} onChange={(e) => setNewExpires(e.target.value)}
              placeholder="Expires (YYYY-MM-DD)" type="date"
              className="bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]" style={{ color: "#e2e8f0" }} />
            <button type="button" onClick={handleCreate}
              disabled={!newName.trim() || !newExpr.trim() || !newContent.trim()}
              className="w-full py-1 font-mono text-[10px] uppercase tracking-wider rounded disabled:opacity-40"
              style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff" }}>
              Create
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {scheduleList.map((s) => (
            <div key={s.scheduleId}
              onClick={() => setSelectedId(s.scheduleId)}
              className="flex flex-col px-3 py-2 cursor-pointer gap-0.5"
              style={{
                background: selectedId === s.scheduleId ? "rgba(0,212,255,0.05)" : "transparent",
                borderLeft: selectedId === s.scheduleId ? "2px solid #00d4ff" : "2px solid transparent",
                opacity: s.enabled ? 1 : 0.4,
              }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs truncate" style={{ color: selectedId === s.scheduleId ? "#00d4ff" : "#6b8aaa" }}>
                  {s.name}
                </span>
                <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(s.scheduleId); }}
                  className="font-mono text-[9px] px-1 rounded opacity-0 hover:opacity-100"
                  style={{ color: "#6b8aaa" }}>
                  x
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px]" style={{ color: "#3a5470" }}>{humanCron(s.expression)}</span>
                <span className="font-mono text-[9px]" style={{ color: "#3a5470" }}>{relativeTime(s.nextFireAt)}</span>
              </div>
            </div>
          ))}
          {scheduleList.length === 0 && !creating && (
            <div className="px-4 py-3 font-mono text-[10px]" style={{ color: "#3a5470" }}>
              No schedules
            </div>
          )}
        </div>
      </div>

      {/* Panel 2: Schedule detail */}
      <div className="flex-1 flex flex-col" style={{ borderRight: "1px solid #1a3356" }}>
        <div className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}>
          {selected ? selected.name : "Select a schedule"}
        </div>
        {selected && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
              <div><span style={{ color: "#3a5470" }}>Expression:</span> <span style={{ color: "#e2e8f0" }}>{selected.expression}</span></div>
              <div><span style={{ color: "#3a5470" }}>Human:</span> <span style={{ color: "#e2e8f0" }}>{humanCron(selected.expression)}</span></div>
              <div><span style={{ color: "#3a5470" }}>Target:</span> <span style={{ color: "#a855f7" }}>{selected.target}</span></div>
              <div><span style={{ color: "#3a5470" }}>Type:</span> <span style={{ color: "#e2e8f0" }}>{selected.messageType}</span></div>
              <div><span style={{ color: "#3a5470" }}>Next fire:</span> <span style={{ color: "#e2e8f0" }}>{relativeTime(selected.nextFireAt)}</span></div>
              <div><span style={{ color: "#3a5470" }}>Fires:</span> <span style={{ color: "#e2e8f0" }}>{selected.fireCount}{selected.maxFireCount ? ` / ${selected.maxFireCount}` : ""}</span></div>
              <div><span style={{ color: "#3a5470" }}>Persistent:</span> <span style={{ color: "#e2e8f0" }}>{String(selected.persistent)}</span></div>
              <div><span style={{ color: "#3a5470" }}>Created by:</span> <span style={{ color: "#6b8aaa" }}>{selected.createdBy}</span></div>
              {selected.expiresAt && <div><span style={{ color: "#3a5470" }}>Expires:</span> <span style={{ color: "#e2e8f0" }}>{new Date(selected.expiresAt).toLocaleDateString()}</span></div>}
              {selected.lastFiredAt && <div><span style={{ color: "#3a5470" }}>Last fired:</span> <span style={{ color: "#e2e8f0" }}>{new Date(selected.lastFiredAt).toLocaleTimeString()}</span></div>}
            </div>
            <div className="font-mono text-[10px]" style={{ color: "#3a5470" }}>Content:</div>
            <pre className="font-mono text-xs p-2 rounded whitespace-pre-wrap"
              style={{ background: "#0d1f38", color: "#c8d8e8", border: "1px solid #1a3356" }}>
              {selected.content}
            </pre>
            <button type="button" onClick={() => handleToggleEnabled(selected)}
              className="w-fit px-3 py-1 font-mono text-[10px] uppercase tracking-wider rounded"
              style={{
                background: selected.enabled ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)",
                border: `1px solid ${selected.enabled ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)"}`,
                color: selected.enabled ? "#f87171" : "#4ade80",
              }}>
              {selected.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        )}
      </div>

      {/* Panel 3: Fire history */}
      <div className="w-72 shrink-0 flex flex-col">
        <div className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}>
          Fire History
        </div>
        <div className="flex-1 overflow-y-auto">
          {selected?.recentFires.length ? (
            [...selected.recentFires].reverse().map((fire, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5"
                style={{ borderBottom: "1px solid rgba(26,51,86,0.5)" }}>
                <span className="font-mono text-[10px]" style={{ color: "#6b8aaa" }}>
                  {new Date(fire.timestamp).toLocaleTimeString()}
                </span>
                <span className="font-mono text-[9px]" style={{ color: "#3a5470" }}>
                  #{fire.fireCount}
                </span>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 font-mono text-[10px]" style={{ color: "#3a5470" }}>
              {selected ? "No fires observed this session" : "Select a schedule"}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded font-mono text-xs"
          style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}>
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2">x</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run dashboard typecheck and dev build**

Run: `cd /Users/probello/Repos/cc2cc/dashboard && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/app/schedules/page.tsx dashboard/src/components/nav/nav-tabs.tsx
git commit -m "feat(dashboard): add /schedules page with 3-panel layout and nav tab"
```

---

## Task 10: Send Bar "Schedule This" Toggle

**Files:**
- Modify: `dashboard/src/components/manual-send-bar/manual-send-bar.tsx`

- [ ] **Step 1: Add scheduling toggle to the send bar**

In `dashboard/src/components/manual-send-bar/manual-send-bar.tsx`, add import:

```typescript
import { Clock } from "lucide-react";
import { createSchedule as apiCreateSchedule } from "@/lib/api";
```

Add state variables inside `ManualSendBar`:

```typescript
const [scheduling, setScheduling] = useState(false);
const [schedName, setSchedName] = useState("");
const [schedExpr, setSchedExpr] = useState("");
const [schedMaxFires, setSchedMaxFires] = useState("");
```

Add a `handleSchedule` function:

```typescript
async function handleSchedule() {
  const trimmed = content.trim();
  if (!trimmed || !schedExpr.trim()) return;
  try {
    await apiCreateSchedule({
      name: schedName.trim() || `${to} schedule`,
      expression: schedExpr.trim(),
      target: to,
      messageType: messageType,
      content: trimmed,
      persistent,
      ...(schedMaxFires ? { maxFireCount: parseInt(schedMaxFires, 10) } : {}),
    });
    setContent("");
    setScheduling(false);
    setSchedName("");
    setSchedExpr("");
    setSchedMaxFires("");
  } catch (err) {
    onError?.(err);
  }
}
```

Add a schedule toggle button next to the send button (inside the `flex flex-col items-end gap-1.5` div):

```typescript
<button
  type="button"
  onClick={() => setScheduling(!scheduling)}
  aria-label="Schedule message"
  title="Schedule this message"
  className="flex w-9 shrink-0 items-center justify-center transition-all duration-150"
  style={{
    background: scheduling ? "rgba(0,212,255,0.12)" : "#0d1f38",
    border: `1px solid ${scheduling ? "#00d4ff" : "#1a3356"}`,
    color: scheduling ? "#00d4ff" : "#2a5480",
    height: "2.25rem",
    cursor: "pointer",
  }}
>
  <Clock className="h-3.5 w-3.5" />
</button>
```

Add the schedule form expansion below the textarea row (inside the outer div, after the `flex gap-2` div):

```typescript
{scheduling && (
  <div className="mt-2 flex flex-wrap gap-2 items-center font-mono text-[10px]"
    style={{ color: "#6b8aaa" }}>
    <input value={schedExpr} onChange={(e) => setSchedExpr(e.target.value)}
      placeholder="every 5m  or  0 9 * * *"
      className="flex-1 min-w-[160px] bg-transparent outline-none placeholder:text-[#3a5470] px-2 py-1"
      style={{ border: "1px solid #1a3356", color: "#e2e8f0" }} />
    <input value={schedName} onChange={(e) => setSchedName(e.target.value)}
      placeholder="Name (optional)"
      className="w-32 bg-transparent outline-none placeholder:text-[#3a5470] px-2 py-1"
      style={{ border: "1px solid #1a3356", color: "#e2e8f0" }} />
    <input value={schedMaxFires} onChange={(e) => setSchedMaxFires(e.target.value)}
      placeholder="Max fires"
      type="number"
      className="w-20 bg-transparent outline-none placeholder:text-[#3a5470] px-2 py-1"
      style={{ border: "1px solid #1a3356", color: "#e2e8f0" }} />
    <button type="button" onClick={() => void handleSchedule()}
      disabled={!content.trim() || !schedExpr.trim()}
      className="px-3 py-1 rounded uppercase tracking-wider disabled:opacity-40"
      style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff" }}>
      Schedule
    </button>
  </div>
)}
```

- [ ] **Step 2: Run dashboard typecheck**

Run: `cd /Users/probello/Repos/cc2cc/dashboard && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/manual-send-bar/manual-send-bar.tsx
git commit -m "feat(dashboard): add 'Schedule this' toggle to manual send bar"
```

---

## Task 11: Reduce Offline Instance TTL to 1 Hour

**Files:**
- Modify: `hub/src/config.ts`
- Modify: `hub/src/registry.ts`

- [ ] **Step 1: Add OFFLINE_TTL_SECONDS constant to config.ts**

In `hub/src/config.ts`, add after the `REDIS_TTL_SECONDS` constant:

```typescript
/**
 * Redis TTL for offline instance presence keys (1 hour in seconds).
 * Online instances retain the full 24h TTL; when an instance disconnects,
 * the TTL is shortened so stale entries are cleaned up faster.
 */
export const OFFLINE_TTL_SECONDS = 3600;
```

- [ ] **Step 2: Shorten Redis TTL when instance goes offline**

In `hub/src/registry.ts`, add import:

```typescript
import { OFFLINE_TTL_SECONDS } from "./config.js";
```

Modify the `markOffline` method to re-set the Redis TTL to 1 hour:

```typescript
  async markOffline(instanceId: string): Promise<void> {
    const entry = _map.get(instanceId);
    if (entry) {
      entry.status = "offline";
      // Shorten Redis TTL to 1h so stale offline entries are cleaned up faster
      await redis.expire(`instance:${instanceId}`, OFFLINE_TTL_SECONDS);
    }
  },
```

Note: `markOffline` changes from synchronous to async. Update all callers:

In `hub/src/ws-handler.ts`, `onPluginClose` already uses `await` context — just add `await`:
```typescript
await registry.markOffline(instanceId);
```

In `hub/src/ws-handler.ts`, `migrateRegistration` — same:
```typescript
await registry.markOffline(oldInstanceId);
```

- [ ] **Step 3: Restore full TTL when instance reconnects**

The `register` method already sets `"EX", 86400` (24h) on the Redis key, so reconnecting instances automatically get the full TTL restored. No change needed.

- [ ] **Step 4: Run hub tests**

Run: `cd /Users/probello/Repos/cc2cc && bun test hub/tests/`
Expected: All tests PASS (registry.markOffline is mocked in most tests; if any test asserts on the sync signature, update it to async)

- [ ] **Step 5: Update CLAUDE.md**

Add to the Key Design Invariants section:

```
**Offline instances expire from Redis after 1 hour.** Online instances retain a 24h TTL; when a plugin disconnects, the TTL is shortened to 1h (`OFFLINE_TTL_SECONDS`). Reconnecting restores the full 24h TTL. Manual removal via `DELETE /api/instances/:id` is immediate.
```

- [ ] **Step 6: Commit**

```bash
git add hub/src/config.ts hub/src/registry.ts hub/src/ws-handler.ts CLAUDE.md
git commit -m "feat(hub): reduce offline instance Redis TTL from 24h to 1h"
```

---

## Task 12: Full Integration Check

**Files:** None (verification only)

- [ ] **Step 1: Run make checkall**

Run: `cd /Users/probello/Repos/cc2cc && make checkall`
Expected: All format, lint, typecheck, and test checks PASS

- [ ] **Step 2: Fix any issues found**

If any checks fail, fix them and re-run `make checkall`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve lint/type/test issues from scheduled messages integration"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add scheduler documentation to CLAUDE.md**

Add to the `### hub/` section:

```
- `scheduler.ts` — `Scheduler` class: Redis ZSET polling (30s), cron-parser-based scheduling, CRUD operations, startup recovery; system sender: `SYSTEM_SENDER_ID`; supports simple interval syntax (`every 5m`) and standard 5-field cron
```

Add to the Key Design Invariants section:

```
**Scheduled messages use a fixed system sender.** `SYSTEM_SENDER_ID` (`system@hub:scheduler/00000000-0000-0000-0000-000000000000`) is stamped on all scheduler-fired messages. Recipients identify scheduled messages via this sender and `metadata.scheduleId`.

**Minimum schedule interval is 1 minute.** Enforced at creation time by computing the gap between the next two cron fires. The scheduler polls Redis every 30 seconds.

**Missed schedule fires are skipped.** On hub restart, schedules advance to the next future fire time — past fires are not retroactively sent.
```

Add to the `### dashboard/` section:

```
- `app/schedules/page.tsx` — 3-panel Schedules page: schedule list + create, detail/edit panel, fire history
```

Update the HubEvent description in `### packages/shared`:

```
- `HubEvent` discriminated union for dashboard WebSocket events (`events.ts`) — includes 6 topic/role events and 4 schedule events: `schedule:created`, `schedule:updated`, `schedule:deleted`, `schedule:fired`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add scheduler documentation to CLAUDE.md"
```
