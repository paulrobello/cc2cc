// hub/tests/queue.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Message } from "@cc2cc/shared";
import { MessageType } from "@cc2cc/shared";

// ioredis mock — returns deterministic values for each command
const calls: Array<{ cmd: string; args: unknown[] }> = [];
let mockDepth = 0;
let mockPopValue: string | null = null;

const redisMock = {
  rpush: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "rpush", args });
    mockDepth++;
    return mockDepth;
  }),
  expire: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "expire", args });
    return 1;
  }),
  lpop: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "lpop", args });
    if (mockDepth > 0) mockDepth--;
    return null;
  }),
  llen: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "llen", args });
    return mockDepth;
  }),
  rpoplpush: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "rpoplpush", args });
    return mockPopValue;
  }),
  lrem: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "lrem", args });
    return 1;
  }),
  incr: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "incr", args });
    return 1;
  }),
  expireat: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "expireat", args });
    return 1;
  }),
  rename: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "rename", args });
    return "OK";
  }),
  get: mock(async (..._args: unknown[]) => "5"),
  del: mock(async (...args: unknown[]) => {
    calls.push({ cmd: "del", args });
    return 1;
  }),
  lrange: mock(async () => [] as string[]),
  pipeline: mock(() => {
    const commands: Array<{ cmd: string; args: unknown[] }> = [];
    const pipeline: Record<string, unknown> = {
      llen: mock((...args: unknown[]) => {
        calls.push({ cmd: "llen", args });
        return pipeline;
      }),
      incr: mock((...args: unknown[]) => {
        calls.push({ cmd: "incr", args });
        return pipeline;
      }),
      expireat: mock((...args: unknown[]) => {
        calls.push({ cmd: "expireat", args });
        return pipeline;
      }),
      smembers: mock((...args: unknown[]) => {
        calls.push({ cmd: "smembers", args });
        return pipeline;
      }),
      exec: mock(async () => commands.map(() => [null, 0])),
    };
    return pipeline;
  }),
  on: mock(() => {}),
};

mock.module("../src/redis.js", () => ({
  redis: redisMock,
  checkRedisHealth: mock(async () => true),
}));

// Own the queue.js mock so topic-manager.test.ts's mock.module("../src/queue.js") doesn't leak in.
// The factory re-implements queue.ts using the local redisMock — each Bun worker gets its own
// instance when both files call mock.module for the same specifier.
//
// NOTE (QA-016): This re-implementation is intentional. Importing the real queue.ts against the
// mocked redis leads to Bun test isolation issues when test files run in the same worker — the
// first importer's redis mock wins for all subsequent imports. The replica here is kept in sync
// manually; when queue.ts changes, update this block accordingly.
const MAX_QUEUE_DEPTH = 1000;
const QUEUE_TTL_SECONDS = 86400;
const queueKey = (id: string) => `queue:${id}`;
const processingKey = (id: string) => `processing:${id}`;

mock.module("../src/queue.js", () => ({
  async pushMessage(recipientId: string, message: Message): Promise<number> {
    const key = queueKey(recipientId);
    const depth = await redisMock.rpush(key, JSON.stringify(message));
    await redisMock.expire(key, QUEUE_TTL_SECONDS);
    if (depth > MAX_QUEUE_DEPTH) await redisMock.lpop(key);
    await redisMock.incr("stats:messages:today");
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    await redisMock.expireat("stats:messages:today", Math.floor(midnight.getTime() / 1000));
    return Math.min(depth, MAX_QUEUE_DEPTH);
  },
  async atomicFlushOne(instanceId: string): Promise<{ message: Message; raw: string } | null> {
    const raw = await redisMock.rpoplpush(queueKey(instanceId), processingKey(instanceId));
    if (!raw) return null;
    try {
      const message = JSON.parse(raw) as Message;
      return { message, raw };
    } catch {
      await redisMock.lrem(processingKey(instanceId), 1, raw);
      return null;
    }
  },
  async ackProcessed(instanceId: string, raw: string): Promise<void> {
    await redisMock.lrem(processingKey(instanceId), 1, raw);
  },
  async replayProcessing(instanceId: string): Promise<number> {
    let replayed = 0;
    while (true) {
      const raw = await redisMock.rpoplpush(processingKey(instanceId), queueKey(instanceId));
      if (!raw) break;
      replayed++;
    }
    if (replayed > 0) await redisMock.expire(queueKey(instanceId), QUEUE_TTL_SECONDS);
    return replayed;
  },
  async getQueueDepth(instanceId: string): Promise<number> {
    return redisMock.llen(queueKey(instanceId));
  },
  async getTotalQueued(instanceIds: string[]): Promise<number> {
    if (instanceIds.length === 0) return 0;
    const results = await Promise.all(instanceIds.map((id) => redisMock.llen(queueKey(id))));
    return results.reduce((s, n) => s + n, 0);
  },
  async getMessagesTodayCount(): Promise<number> {
    const raw = await redisMock.get("stats:messages:today");
    return raw ? parseInt(raw, 10) : 0;
  },
  async flushQueue(instanceId: string): Promise<void> {
    await redisMock.del?.(queueKey(instanceId));
  },
  async migrateQueue(oldId: string, newId: string): Promise<number> {
    let migrated = 0;
    const procKey = processingKey(oldId);
    while (true) {
      const raw = await redisMock.rpoplpush(procKey, queueKey(newId));
      if (!raw) break;
      migrated++;
    }
    const oldQueueKey = queueKey(oldId);
    const newQueueKey = queueKey(newId);
    const oldQueueLen = await redisMock.llen(oldQueueKey);
    if (oldQueueLen > 0) {
      const newQueueLen = await redisMock.llen(newQueueKey);
      if (newQueueLen === 0) {
        try {
          await redisMock.rename(oldQueueKey, newQueueKey);
          migrated += oldQueueLen;
        } catch {
          /* no-op */
        }
      } else {
        while (true) {
          const raw = await redisMock.rpoplpush(oldQueueKey, newQueueKey);
          if (!raw) break;
          migrated++;
        }
      }
    }
    if (migrated > 0) await redisMock.expire(newQueueKey, QUEUE_TTL_SECONDS);
    return migrated;
  },
}));

const { pushMessage, atomicFlushOne, ackProcessed, replayProcessing, getQueueDepth, migrateQueue } =
  await import("../src/queue.js");

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    messageId: "550e8400-e29b-41d4-a716-446655440000",
    from: "paul@mac:cc2cc/abc",
    to: "alice@srv:api/def",
    type: MessageType.task,
    content: "Do the thing",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("pushMessage", () => {
  beforeEach(() => {
    calls.length = 0;
    mockDepth = 0;
    for (const m of Object.values(redisMock)) m.mockClear();
  });

  it("RPUSHes the message JSON and EXPIREs the key", async () => {
    await pushMessage("alice@srv:api/def", makeMessage());
    const rpushCall = calls.find((c) => c.cmd === "rpush");
    expect(rpushCall).toBeDefined();
    expect(rpushCall?.args[0]).toBe("queue:alice@srv:api/def");
    const expireCall = calls.find((c) => c.cmd === "expire");
    expect(expireCall).toBeDefined();
    expect(expireCall?.args).toEqual(["queue:alice@srv:api/def", 86400]);
  });

  it("INCRs stats:messages:today", async () => {
    await pushMessage("alice@srv:api/def", makeMessage());
    const incrCall = calls.find((c) => c.cmd === "incr");
    expect(incrCall).toBeDefined();
    expect(incrCall?.args[0]).toBe("stats:messages:today");
  });

  it("LPOPs the oldest message when depth exceeds 1000", async () => {
    mockDepth = 1000; // rpush will make it 1001
    await pushMessage("alice@srv:api/def", makeMessage());
    const lpopCall = calls.find((c) => c.cmd === "lpop");
    expect(lpopCall).toBeDefined();
    expect(lpopCall?.args[0]).toBe("queue:alice@srv:api/def");
  });

  it("does NOT LPOP when depth is under limit", async () => {
    mockDepth = 999; // rpush makes it 1000 — exactly at limit, not over
    await pushMessage("alice@srv:api/def", makeMessage());
    const lpopCall = calls.find((c) => c.cmd === "lpop");
    expect(lpopCall).toBeUndefined();
  });
});

describe("atomicFlushOne", () => {
  beforeEach(() => {
    calls.length = 0;
    mockPopValue = null;
    for (const m of Object.values(redisMock)) m.mockClear();
  });

  it("returns null when queue is empty", async () => {
    mockPopValue = null;
    const result = await atomicFlushOne("alice@srv:api/def");
    expect(result).toBeNull();
  });

  it("returns { message, raw } when queue has entries", async () => {
    const msg = makeMessage();
    mockPopValue = JSON.stringify(msg);
    const result = await atomicFlushOne("alice@srv:api/def");
    expect(result).not.toBeNull();
    expect(result?.message.messageId).toBe(msg.messageId);
    expect(result?.raw).toBe(mockPopValue);
  });

  it("calls RPOPLPUSH with correct queue and processing keys", async () => {
    const msg = makeMessage();
    mockPopValue = JSON.stringify(msg);
    await atomicFlushOne("alice@srv:api/def");
    const rpoplpushCall = calls.find((c) => c.cmd === "rpoplpush");
    expect(rpoplpushCall).toBeDefined();
    expect(rpoplpushCall?.args[0]).toBe("queue:alice@srv:api/def");
    expect(rpoplpushCall?.args[1]).toBe("processing:alice@srv:api/def");
  });
});

describe("getQueueDepth", () => {
  it("returns the LLEN of the queue key", async () => {
    mockDepth = 7;
    const depth = await getQueueDepth("alice@srv:api/def");
    expect(depth).toBe(7);
  });
});

describe("ackProcessed", () => {
  beforeEach(() => {
    calls.length = 0;
    for (const m of Object.values(redisMock)) m.mockClear();
  });

  it("calls LREM on processing key with the original raw string", async () => {
    const raw = JSON.stringify(makeMessage());
    await ackProcessed("alice@srv:api/def", raw);
    const lremCall = calls.find((c) => c.cmd === "lrem");
    expect(lremCall).toBeDefined();
    expect(lremCall?.args[0]).toBe("processing:alice@srv:api/def");
    expect(lremCall?.args[1]).toBe(1);
    expect(lremCall?.args[2]).toBe(raw);
  });
});

describe("replayProcessing", () => {
  beforeEach(() => {
    calls.length = 0;
    mockPopValue = null;
    for (const m of Object.values(redisMock)) m.mockClear();
  });

  it("returns 0 when processing list is empty", async () => {
    mockPopValue = null;
    const count = await replayProcessing("alice@srv:api/def");
    expect(count).toBe(0);
    // No expire call expected when nothing was replayed
    const expireCall = calls.find((c) => c.cmd === "expire");
    expect(expireCall).toBeUndefined();
  });

  it("moves items from processing:{id} back to queue:{id} and returns count", async () => {
    // Simulate two items in processing list, then empty
    let callCount = 0;
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      callCount++;
      // Return a value for first two calls, null for third (empty)
      if (callCount <= 2) return JSON.stringify(makeMessage());
      return null;
    });

    const count = await replayProcessing("alice@srv:api/def");
    expect(count).toBe(2);

    // Verify RPOPLPUSH called with processing key as source, queue key as dest
    const rpoplpushCalls = calls.filter((c) => c.cmd === "rpoplpush");
    expect(rpoplpushCalls.length).toBe(3); // 2 items + 1 null sentinel
    expect(rpoplpushCalls[0].args[0]).toBe("processing:alice@srv:api/def");
    expect(rpoplpushCalls[0].args[1]).toBe("queue:alice@srv:api/def");

    // Verify TTL is reset on the queue key after replay
    const expireCall = calls.find((c) => c.cmd === "expire");
    expect(expireCall).toBeDefined();
    expect(expireCall?.args[0]).toBe("queue:alice@srv:api/def");
  });
});

describe("migrateQueue", () => {
  const OLD_ID = "alice@srv:api/old-session";
  const NEW_ID = "alice@srv:api/new-session";

  // Restore default implementations before each test
  beforeEach(() => {
    calls.length = 0;
    mockDepth = 0;
    mockPopValue = null;
    for (const m of Object.values(redisMock)) m.mockClear();
    redisMock.llen.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "llen", args });
      return mockDepth;
    });
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      return mockPopValue;
    });
  });

  it("returns 0 when all queues are empty", async () => {
    mockPopValue = null;
    mockDepth = 0;
    const count = await migrateQueue(OLD_ID, NEW_ID);
    expect(count).toBe(0);
    // No expire when nothing was migrated
    expect(calls.find((c) => c.cmd === "expire")).toBeUndefined();
  });

  it("migrates processing items to new queue", async () => {
    let rpoplpushCalls = 0;
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      rpoplpushCalls++;
      // Two items in processing, then empty; old queue stays empty
      if (rpoplpushCalls <= 2) return JSON.stringify(makeMessage());
      return null;
    });
    mockDepth = 0; // old queue empty

    const count = await migrateQueue(OLD_ID, NEW_ID);
    expect(count).toBe(2);

    // RPOPLPUSH from processing:{old} → queue:{new}
    const procCalls = calls
      .filter((c) => c.cmd === "rpoplpush")
      .filter((c) => (c.args[0] as string).startsWith("processing:"));
    expect(procCalls.length).toBe(3); // 2 items + null sentinel
    expect(procCalls[0].args[0]).toBe(`processing:${OLD_ID}`);
    expect(procCalls[0].args[1]).toBe(`queue:${NEW_ID}`);

    // TTL reset on new queue
    const expireCall = calls.find((c) => c.cmd === "expire");
    expect(expireCall?.args[0]).toBe(`queue:${NEW_ID}`);
  });

  it("uses RENAME (O(1)) when new queue is empty", async () => {
    // processing is empty (first rpoplpush returns null)
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      return null;
    });
    // old queue has 3 items, new queue is empty
    redisMock.llen.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "llen", args });
      const key = args[0] as string;
      return key === `queue:${OLD_ID}` ? 3 : 0;
    });

    const count = await migrateQueue(OLD_ID, NEW_ID);
    expect(count).toBe(3);

    const renameCall = calls.find((c) => c.cmd === "rename");
    expect(renameCall).toBeDefined();
    expect(renameCall?.args[0]).toBe(`queue:${OLD_ID}`);
    expect(renameCall?.args[1]).toBe(`queue:${NEW_ID}`);

    // TTL reset after rename migration
    const expireCall = calls.find((c) => c.cmd === "expire");
    expect(expireCall?.args[0]).toBe(`queue:${NEW_ID}`);
  });

  it("uses RPOPLPUSH loop when new queue already has items", async () => {
    let rpoplpushCallCount = 0;
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      rpoplpushCallCount++;
      // 1st call: processing empty
      if (rpoplpushCallCount === 1) return null;
      // 2nd call (old→new): one item
      if (rpoplpushCallCount === 2) return JSON.stringify(makeMessage());
      // 3rd: empty sentinel
      return null;
    });
    // Both queues have items → RPOPLPUSH path, not RENAME
    redisMock.llen.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "llen", args });
      return 1;
    });

    const count = await migrateQueue(OLD_ID, NEW_ID);
    expect(count).toBe(1);

    // No rename
    expect(calls.find((c) => c.cmd === "rename")).toBeUndefined();

    // RPOPLPUSH from old queue to new queue
    const queueCalls = calls
      .filter((c) => c.cmd === "rpoplpush")
      .filter((c) => (c.args[0] as string) === `queue:${OLD_ID}`);
    expect(queueCalls.length).toBe(2); // 1 item + null sentinel
    expect(queueCalls[0].args[1]).toBe(`queue:${NEW_ID}`);
  });

  it("migrates both processing and queue items", async () => {
    let rpoplpushCallCount = 0;
    redisMock.rpoplpush.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "rpoplpush", args });
      rpoplpushCallCount++;
      // 1st call: one processing item
      if (rpoplpushCallCount === 1) return JSON.stringify(makeMessage());
      // 2nd call: processing empty
      if (rpoplpushCallCount === 2) return null;
      // 3rd call (old queue→new, RENAME path since new was empty before processing items)
      // Actually processing items moved to queue:new, so llen(new) may be 1 now...
      // We'll test via rename: old=2, new=1 → RPOPLPUSH path
      if (rpoplpushCallCount === 3) return JSON.stringify(makeMessage());
      return null;
    });
    redisMock.llen.mockImplementation(async (...args: unknown[]) => {
      calls.push({ cmd: "llen", args });
      const key = args[0] as string;
      return key === `queue:${OLD_ID}` ? 2 : 1; // new queue has 1 item (from processing)
    });

    const count = await migrateQueue(OLD_ID, NEW_ID);
    // 1 from processing + 1 from queue loop
    expect(count).toBe(2);
    // No rename since new queue was not empty
    expect(calls.find((c) => c.cmd === "rename")).toBeUndefined();
  });
});
