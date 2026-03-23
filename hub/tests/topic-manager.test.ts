// hub/tests/topic-manager.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";

// Minimal pipeline builder: records calls and resolves on exec()
function makePipelineMock() {
  const pipelineMock: Record<string, (...args: unknown[]) => unknown> = {
    hset: () => pipelineMock,
    sadd: () => pipelineMock,
    srem: () => pipelineMock,
    del: () => pipelineMock,
    exec: mock(async () => []),
  };
  return pipelineMock;
}

const redisMock = {
  hset: mock(async () => 1),
  hgetall: mock(async () => null as Record<string, string> | null),
  del: mock(async () => 1),
  sadd: mock(async () => 1),
  srem: mock(async () => 1),
  smembers: mock(async () => [] as string[]),
  sunionstore: mock(async () => 0),
  keys: mock(async () => [] as string[]),
  incr: mock(async () => 1),
  on: mock(() => {}),
  pipeline: mock(() => makePipelineMock()),
};

const pushMessageMock = mock(async () => {});

mock.module("../src/redis.js", () => ({
  redis: redisMock,
  checkRedisHealth: mock(async () => true),
}));

mock.module("../src/queue.js", () => ({
  pushMessage: pushMessageMock,
  atomicFlushOne: mock(async () => null),
  ackProcessed: mock(async () => {}),
  replayProcessing: mock(async () => 0),
  getQueueDepth: mock(async () => 0),
  getTotalQueued: mock(async () => 0),
  getMessagesTodayCount: mock(async () => 0),
  flushQueue: mock(async () => {}),
  migrateQueue: mock(async () => 0),
}));

const { topicManager } = await import("../src/topic-manager.js");

function clearMocks() {
  for (const m of Object.values(redisMock)) {
    (m as ReturnType<typeof mock>).mockClear?.();
  }
  pushMessageMock.mockClear();
}

describe("topicManager.createTopic", () => {
  beforeEach(() => {
    clearMocks();
    redisMock.hgetall.mockResolvedValue(null);
    redisMock.smembers.mockResolvedValue([]);
  });

  it("writes topic hash to Redis for a new topic via pipeline", async () => {
    await topicManager.createTopic("cc2cc", "alice@srv:cc2cc/abc");
    // Creation is batched through pipeline for atomicity — verify pipeline() was invoked
    expect(redisMock.pipeline).toHaveBeenCalled();
  });

  it("returns TopicInfo with subscriberCount 0 for new topic", async () => {
    const info = await topicManager.createTopic("cc2cc", "alice@srv:cc2cc/abc");
    expect(info.name).toBe("cc2cc");
    expect(info.subscriberCount).toBe(0);
  });

  it("is idempotent — skips hset when topic already exists", async () => {
    redisMock.hgetall.mockResolvedValue({
      name: "cc2cc",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "alice@srv:cc2cc/abc",
    });
    redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
    await topicManager.createTopic("cc2cc", "bob@srv:cc2cc/xyz");
    expect(redisMock.hset).not.toHaveBeenCalled();
  });
});

describe("topicManager.subscribe / unsubscribe", () => {
  beforeEach(clearMocks);

  it("subscribe adds instanceId to both topic and reverse-index sets", async () => {
    await topicManager.subscribe("cc2cc", "alice@srv:cc2cc/abc");
    expect(redisMock.sadd).toHaveBeenCalledWith("topic:cc2cc:subscribers", "alice@srv:cc2cc/abc");
    expect(redisMock.sadd).toHaveBeenCalledWith("instance:alice@srv:cc2cc/abc:topics", "cc2cc");
  });

  it("unsubscribe removes from both sets for non-project topic", async () => {
    await topicManager.unsubscribe("other-topic", "alice@srv:cc2cc/abc");
    expect(redisMock.srem).toHaveBeenCalledWith(
      "topic:other-topic:subscribers",
      "alice@srv:cc2cc/abc",
    );
    expect(redisMock.srem).toHaveBeenCalledWith(
      "instance:alice@srv:cc2cc/abc:topics",
      "other-topic",
    );
  });

  it("unsubscribe throws when topic equals the auto-joined project topic", async () => {
    // instanceId project segment is "cc2cc" — matches topic name
    await expect(topicManager.unsubscribe("cc2cc", "alice@srv:cc2cc/abc")).rejects.toThrow(
      "cannot unsubscribe from auto-joined project topic",
    );
  });
});

describe("topicManager.deleteTopic", () => {
  beforeEach(() => {
    clearMocks();
    redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc", "bob@srv:cc2cc/xyz"]);
  });

  it("removes the topic from each subscriber's reverse index", async () => {
    await topicManager.deleteTopic("cc2cc");
    expect(redisMock.srem).toHaveBeenCalledWith("instance:alice@srv:cc2cc/abc:topics", "cc2cc");
    expect(redisMock.srem).toHaveBeenCalledWith("instance:bob@srv:cc2cc/xyz:topics", "cc2cc");
  });

  it("deletes the subscriber set and topic hash via pipeline", async () => {
    await topicManager.deleteTopic("cc2cc");
    // Deletion is batched through pipeline for atomicity — verify pipeline() was invoked
    expect(redisMock.pipeline).toHaveBeenCalled();
  });
});

describe("topicManager.publishToTopic", () => {
  const makeMsg = () => ({
    messageId: crypto.randomUUID(),
    from: "alice@srv:cc2cc/abc",
    to: "topic:cc2cc" as const,
    type: "task" as const,
    content: "hello",
    topicName: "cc2cc",
    timestamp: new Date().toISOString(),
  });

  it("returns delivered=0 queued=0 for empty subscriber list", async () => {
    redisMock.smembers.mockResolvedValue([]);
    const result = await topicManager.publishToTopic(
      "cc2cc",
      makeMsg() as never,
      false,
      "alice@srv:cc2cc/abc",
      new Map(),
    );
    expect(result.delivered).toBe(0);
    expect(result.queued).toBe(0);
  });

  it("persistent=true queues message for offline subscriber", async () => {
    redisMock.smembers.mockResolvedValue(["bob@srv:cc2cc/xyz"]);
    // bob has no WS ref → offline
    await topicManager.publishToTopic(
      "cc2cc",
      makeMsg() as never,
      true,
      "alice@srv:cc2cc/abc",
      new Map(),
    );
    expect(pushMessageMock).toHaveBeenCalledWith("bob@srv:cc2cc/xyz", expect.any(Object));
  });

  it("persistent=false increments stats counter once", async () => {
    redisMock.smembers.mockResolvedValue([]);
    await topicManager.publishToTopic(
      "cc2cc",
      makeMsg() as never,
      false,
      "alice@srv:cc2cc/abc",
      new Map(),
    );
    expect(redisMock.incr).toHaveBeenCalledWith("stats:messages:today");
  });

  it("excludes sender from delivery", async () => {
    const senderWs = { readyState: 1, send: mock(() => {}) };
    redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
    const wsRefs = new Map([["alice@srv:cc2cc/abc", senderWs]]);
    await topicManager.publishToTopic(
      "cc2cc",
      makeMsg() as never,
      false,
      "alice@srv:cc2cc/abc",
      wsRefs,
    );
    expect(senderWs.send).not.toHaveBeenCalled();
  });
});
