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
