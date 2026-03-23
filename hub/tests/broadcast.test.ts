// hub/tests/broadcast.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { MessageType } from "@cc2cc/shared";

// Minimal WS mock — tracks what was sent
function makeMockWs(id: string) {
  const sent: string[] = [];
  return {
    id,
    readyState: 1, // OPEN
    send: mock((data: string) => {
      sent.push(data);
    }),
    _sent: sent,
  };
}

mock.module("../src/redis.js", () => ({
  redis: { set: mock(async () => "OK"), get: mock(async () => null), on: mock(() => {}) },
  checkRedisHealth: mock(async () => true),
}));

const { BroadcastManager } = await import("../src/broadcast.js");

describe("BroadcastManager", () => {
  let manager: InstanceType<typeof BroadcastManager>;
  let ws1: ReturnType<typeof makeMockWs>;
  let ws2: ReturnType<typeof makeMockWs>;
  let ws3: ReturnType<typeof makeMockWs>;

  beforeEach(() => {
    manager = new BroadcastManager();
    ws1 = makeMockWs("alice@srv:api/a");
    ws2 = makeMockWs("bob@mac:hub/b");
    ws3 = makeMockWs("carol@pc:plugin/c");
    manager.addPluginWs("alice@srv:api/a", ws1 as never);
    manager.addPluginWs("bob@mac:hub/b", ws2 as never);
    manager.addPluginWs("carol@pc:plugin/c", ws3 as never);
  });

  it("sends to all connected clients except the sender", () => {
    manager.broadcast("alice@srv:api/a", MessageType.task, "hello world");
    expect(ws1.send).not.toHaveBeenCalled(); // sender skipped
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(ws3.send).toHaveBeenCalledTimes(1);
  });

  it("includes the correct payload in each send", () => {
    manager.broadcast("alice@srv:api/a", MessageType.task, "hello world");
    const payload = JSON.parse(ws2._sent[0] ?? "{}") as Record<string, unknown>;
    expect(payload.type).toBe("task");
    expect(payload.content).toBe("hello world");
    expect(payload.from).toBe("alice@srv:api/a");
    expect(payload.to).toBe("broadcast");
  });

  it("returns the count of recipients reached", () => {
    const { delivered } = manager.broadcast("alice@srv:api/a", MessageType.task, "hi");
    expect(delivered).toBe(2); // ws2 + ws3
  });

  it("enforces rate limit of 1 broadcast per 5 seconds", () => {
    const r1 = manager.broadcast("alice@srv:api/a", MessageType.task, "first");
    expect(r1.rateLimited).toBe(false);

    const r2 = manager.broadcast("alice@srv:api/a", MessageType.task, "second");
    expect(r2.rateLimited).toBe(true);
    expect(r2.delivered).toBe(0);
    // ws2 and ws3 should only have received the first broadcast
    expect(ws2.send).toHaveBeenCalledTimes(1);
  });

  it("allows broadcast again after the rate-limit window", async () => {
    manager = new BroadcastManager({ rateLimitMs: 10 }); // 10ms window for test
    ws1 = makeMockWs("alice@srv:api/a");
    manager.addPluginWs("alice@srv:api/a", ws1 as never);

    manager.broadcast("alice@srv:api/a", MessageType.task, "first");
    await new Promise((r) => setTimeout(r, 20));
    const r2 = manager.broadcast("alice@srv:api/a", MessageType.task, "second");
    expect(r2.rateLimited).toBe(false);
  });

  it("removes a WebSocket on removePluginWs", () => {
    manager.removePluginWs("bob@mac:hub/b");
    const { delivered } = manager.broadcast("alice@srv:api/a", MessageType.task, "hi");
    expect(delivered).toBe(1); // only ws3 remains
  });

  it("skips non-OPEN WebSockets", () => {
    ws2.readyState = 3; // CLOSED
    const { delivered } = manager.broadcast("alice@srv:api/a", MessageType.task, "hi");
    expect(delivered).toBe(1); // only ws3 (ws2 is CLOSED)
    expect(ws2.send).not.toHaveBeenCalled();
  });
});
