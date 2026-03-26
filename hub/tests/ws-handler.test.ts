// hub/tests/ws-handler.test.ts
//
// Unit tests for ws-handler.ts routing logic.
// Each handler is tested in isolation by mocking Redis, registry, queue,
// broadcast, and topicManager dependencies.
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Message } from "@cc2cc/shared";
import { MessageType } from "@cc2cc/shared";

// ── Redis mock ────────────────────────────────────────────────────────────────

const redisMock = {
  set: mock(async () => "OK"),
  del: mock(async () => 1),
  get: mock(async () => null as string | null),
  exists: mock(async () => 0),
  keys: mock(async () => [] as string[]),
  rpush: mock(async () => 1),
  expire: mock(async () => 1),
  lpop: mock(async () => null),
  llen: mock(async () => 0),
  rpoplpush: mock(async () => null as string | null),
  lrem: mock(async () => 1),
  incr: mock(async () => 1),
  expireat: mock(async () => 1),
  rename: mock(async () => "OK"),
  lrange: mock(async () => [] as string[]),
  smembers: mock(async () => [] as string[]),
  sadd: mock(async () => 1),
  srem: mock(async () => 1),
  sunionstore: mock(async () => 1),
  hgetall: mock(async () => null as Record<string, string> | null),
  hset: mock(async () => 1),
  pipeline: mock(() => ({
    hset: mock(() => ({ exec: mock(async () => []) })),
    sadd: mock(() => ({ exec: mock(async () => []) })),
    llen: mock(() => ({ exec: mock(async () => []) })),
    exec: mock(async () => []),
  })),
  ping: mock(async () => "PONG"),
  on: mock(() => {}),
};

mock.module("../src/redis.js", () => ({
  redis: redisMock,
  checkRedisHealth: mock(async () => true),
}));

// ── Config mock ───────────────────────────────────────────────────────────────
// Mock config.js to avoid cross-test contamination from cached module state.
// process.env would only work if config.ts is loaded fresh (Bun caches modules
// across test files in the same worker, so later files see the first loader's snapshot).

mock.module("../src/config.js", () => ({
  config: {
    apiKey: "test-api-key",
    port: 13101,
    redisUrl: "redis://localhost:6379",
    dashboardOrigin: "http://localhost:8029",
  },
  REDIS_TTL_SECONDS: 86400,
  validateConfig: () => {},
  ConfigurationError: class ConfigurationError extends Error {},
}));

// ── Registry mock ─────────────────────────────────────────────────────────────

const registryEntries = new Map<
  string,
  {
    instanceId: string;
    project: string;
    status: string;
    role?: string;
    wsRef?: unknown;
    queueDepth: number;
    connectedAt: string;
  }
>();

const registryMock = {
  register: mock(async (instanceId: string, project: string) => {
    const entry = {
      instanceId,
      project,
      status: "online",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
    };
    registryEntries.set(instanceId, entry);
    return entry;
  }),
  markOffline: mock((instanceId: string) => {
    const e = registryEntries.get(instanceId);
    if (e) e.status = "offline";
  }),
  setWsRef: mock((instanceId: string, ws: unknown) => {
    const e = registryEntries.get(instanceId);
    if (e) e.wsRef = ws ?? undefined;
  }),
  getWsRef: mock((instanceId: string) => registryEntries.get(instanceId)?.wsRef),
  get: mock((instanceId: string) => registryEntries.get(instanceId)),
  getAll: mock(() => Array.from(registryEntries.values())),
  getOnline: mock(() => Array.from(registryEntries.values()).filter((e) => e.status === "online")),
  getOnlineWsRefs: mock(() => new Map<string, { readyState: number; send(d: string): void }>()),
  setQueueDepth: mock((instanceId: string, depth: number) => {
    const e = registryEntries.get(instanceId);
    if (e) e.queueDepth = depth;
  }),
  setRole: mock(async (instanceId: string, role: string) => {
    const e = registryEntries.get(instanceId);
    if (!e) throw new Error(`instance not found: ${instanceId}`);
    e.role = role;
    return e;
  }),
  resolvePartial: mock((partial: string) => {
    const prefix = `${partial}/`;
    const matches = Array.from(registryEntries.values()).filter(
      (e) => e.instanceId.startsWith(prefix) && e.status === "online",
    );
    if (matches.length === 1) return { instanceId: matches[0].instanceId };
    if (matches.length > 1) return { error: "ambiguous address" };
    return { error: "no instance found matching partial address" };
  }),
  getByRole: mock((role: string) =>
    Array.from(registryEntries.values()).filter((e) => e.role === role),
  ),
  deregister: mock(async (instanceId: string) => {
    registryEntries.delete(instanceId);
  }),
  clear: mock(() => registryEntries.clear()),
};

mock.module("../src/registry.js", () => ({ registry: registryMock }));

// ── Queue mock ────────────────────────────────────────────────────────────────

const queueMessages = new Map<string, Message[]>();

const queueMock = {
  pushMessage: mock(async (recipientId: string, message: Message) => {
    const q = queueMessages.get(recipientId) ?? [];
    q.push(message);
    queueMessages.set(recipientId, q);
    return q.length;
  }),
  atomicFlushOne: mock(async (instanceId: string) => {
    const q = queueMessages.get(instanceId);
    if (!q || q.length === 0) return null;
    const message = q.pop()!;
    const raw = JSON.stringify(message);
    return { message, raw };
  }),
  ackProcessed: mock(async () => {}),
  getQueueDepth: mock(async (instanceId: string) => queueMessages.get(instanceId)?.length ?? 0),
  migrateQueue: mock(async (_oldId: string, _newId: string) => 0),
  flushQueue: mock(async () => {}),
  getTotalQueued: mock(async () => 0),
  getMessagesTodayCount: mock(async () => 0),
  replayProcessing: mock(async () => 0),
};

mock.module("../src/queue.js", () => queueMock);

// ── BroadcastManager mock ─────────────────────────────────────────────────────

const broadcastManagerMock = {
  addPluginWs: mock(() => {}),
  removePluginWs: mock(() => {}),
  broadcast: mock(() => ({ delivered: 2, rateLimited: false })),
};

mock.module("../src/broadcast.js", () => ({
  BroadcastManager: mock(() => broadcastManagerMock),
}));

// ── Event bus mock ────────────────────────────────────────────────────────────
// event-bus.ts holds the shared dashboardClients Set, emitToDashboards helper,
// and the broadcastManager singleton. We mock it here so the test controls all
// three rather than relying on the real module (which would instantiate its own
// BroadcastManager before the broadcast.js mock is registered).

const eventBusDashboardClients = new Set<{ readyState: number; send: (d: string) => void }>();
const eventBusEmitMock = mock((event: unknown) => {
  const payload = JSON.stringify(event);
  for (const ws of eventBusDashboardClients) {
    if (ws.readyState === 1) ws.send(payload);
  }
});

mock.module("../src/event-bus.js", () => ({
  dashboardClients: eventBusDashboardClients,
  emitToDashboards: eventBusEmitMock,
  broadcastManager: broadcastManagerMock,
}));

// ── TopicManager mock ─────────────────────────────────────────────────────────

const topicManagerMock = {
  createTopic: mock(async (name: string, createdBy: string) => ({
    name,
    createdAt: new Date().toISOString(),
    createdBy,
    subscriberCount: 0,
  })),
  deleteTopic: mock(async () => {}),
  subscribe: mock(async () => {}),
  unsubscribe: mock(async () => {}),
  getSubscribers: mock(async () => [] as string[]),
  getTopicsForInstance: mock(async () => [] as string[]),
  listTopics: mock(async () => []),
  topicExists: mock(async () => false),
  publishToTopic: mock(async () => ({ delivered: 0, queued: 0 })),
  migrateSubscriptions: mock(async () => {}),
};

const parseProjectMock = mock((instanceId: string): string => {
  const colonPart = instanceId.split(":")[1] ?? "";
  return colonPart.split("/")[0] ?? instanceId;
});

mock.module("../src/topic-manager.js", () => ({
  topicManager: topicManagerMock,
  parseProject: parseProjectMock,
  validateTopicName: mock((name: unknown) => (typeof name !== "string" ? "must be string" : null)),
}));

// ── Auth mock ─────────────────────────────────────────────────────────────────

mock.module("../src/auth.js", () => ({
  keysEqual: mock((a: string, b: string) => a === b),
}));

// ── Import ws-handler AFTER all mocks ─────────────────────────────────────────

const {
  validateWsKey,
  extractInstanceId,
  emitToDashboards,
  onPluginOpen,
  onPluginClose,
  onPluginMessage,
  onDashboardOpen,
  onDashboardClose,
  dashboardClients,
  broadcastManager,
} = await import("../src/ws-handler.js");

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWs(
  instanceId?: string,
  opts: { readyState?: number; send?: () => void } = {},
): {
  data: { type: "plugin" | "dashboard"; instanceId?: string };
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
} {
  return {
    data: {
      type: instanceId !== undefined ? "plugin" : "dashboard",
      instanceId,
    },
    readyState: opts.readyState ?? 1, // WS_OPEN
    send: mock(opts.send ?? (() => {})),
    close: mock(() => {}),
  };
}

function parseLastSend(ws: ReturnType<typeof makeWs>): unknown {
  const calls = ws.send.mock.calls;
  if (calls.length === 0) throw new Error("No send call recorded");
  const lastCall = calls[calls.length - 1];
  return JSON.parse(lastCall[0] as string);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("validateWsKey", () => {
  it("returns true for the correct API key", () => {
    expect(validateWsKey("ws://hub:3100/ws/plugin?key=test-api-key")).toBe(true);
  });

  it("returns false for a wrong key", () => {
    expect(validateWsKey("ws://hub:3100/ws/plugin?key=wrong-key")).toBe(false);
  });

  it("returns false when key param is missing", () => {
    expect(validateWsKey("ws://hub:3100/ws/plugin")).toBe(false);
  });
});

describe("extractInstanceId", () => {
  it("extracts instanceId from query string", () => {
    const id = extractInstanceId("ws://hub:3100/ws/plugin?key=k&instanceId=alice%40host:proj/abc");
    expect(id).toBe("alice@host:proj/abc");
  });

  it("returns null when instanceId is absent", () => {
    expect(extractInstanceId("ws://hub:3100/ws/plugin?key=k")).toBeNull();
  });
});

describe("emitToDashboards", () => {
  beforeEach(() => {
    dashboardClients.clear();
  });

  it("sends to all open dashboard WS connections", () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    dashboardClients.add(ws1 as never);
    dashboardClients.add(ws2 as never);

    emitToDashboards({
      event: "instance:joined",
      instanceId: "alice@host:proj/abc",
      timestamp: new Date().toISOString(),
    });

    expect(ws1.send.mock.calls.length).toBe(1);
    expect(ws2.send.mock.calls.length).toBe(1);
    const parsed = JSON.parse(ws1.send.mock.calls[0][0] as string);
    expect(parsed.event).toBe("instance:joined");
  });

  it("skips closed connections (readyState !== 1)", () => {
    const open = makeWs();
    const closed = makeWs(undefined, { readyState: 3 });
    dashboardClients.add(open as never);
    dashboardClients.add(closed as never);

    emitToDashboards({
      event: "instance:left",
      instanceId: "alice@host:proj/abc",
      timestamp: new Date().toISOString(),
    });

    expect(open.send.mock.calls.length).toBe(1);
    expect(closed.send.mock.calls.length).toBe(0);
  });
});

describe("onDashboardOpen / onDashboardClose", () => {
  beforeEach(() => {
    dashboardClients.clear();
  });

  it("adds the WS to dashboardClients on open", () => {
    const ws = makeWs();
    onDashboardOpen(ws as never);
    expect(dashboardClients.has(ws as never)).toBe(true);
  });

  it("removes the WS from dashboardClients on close", () => {
    const ws = makeWs();
    onDashboardOpen(ws as never);
    onDashboardClose(ws as never);
    expect(dashboardClients.has(ws as never)).toBe(false);
  });
});

describe("onPluginOpen", () => {
  beforeEach(() => {
    dashboardClients.clear();
    registryEntries.clear();
    queueMessages.clear();
    for (const m of Object.values(registryMock)) m.mockClear?.();
    for (const m of Object.values(topicManagerMock)) m.mockClear?.();
    for (const m of Object.values(broadcastManagerMock)) m.mockClear?.();
    queueMock.atomicFlushOne.mockImplementation(async () => null);
  });

  it("closes the connection when instanceId is missing", async () => {
    const ws = makeWs(undefined);
    ws.data.type = "plugin";
    await onPluginOpen(ws as never);
    expect(ws.close.mock.calls.length).toBe(1);
    expect(ws.close.mock.calls[0][0]).toBe(1008);
  });

  it("registers the instance and emits instance:joined to dashboards", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs("alice@host:proj/abc");
    await onPluginOpen(ws as never);

    expect(registryMock.register.mock.calls.length).toBeGreaterThan(0);
    expect(registryMock.register.mock.calls[0][0]).toBe("alice@host:proj/abc");

    // Should emit instance:joined
    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const joinedEvent = events.find((e) => e.event === "instance:joined");
    expect(joinedEvent).toBeDefined();
    expect(joinedEvent.instanceId).toBe("alice@host:proj/abc");
  });

  it("sends subscriptions:sync to the connecting plugin", async () => {
    topicManagerMock.getTopicsForInstance.mockImplementation(async () => ["proj", "other-topic"]);
    const ws = makeWs("alice@host:proj/abc");
    await onPluginOpen(ws as never);

    const syncFrame = ws.send.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((f) => f.action === "subscriptions:sync");
    expect(syncFrame).toBeDefined();
    expect(Array.isArray(syncFrame.topics)).toBe(true);
  });
});

describe("onPluginClose", () => {
  beforeEach(() => {
    dashboardClients.clear();
    registryEntries.clear();
    for (const m of Object.values(registryMock)) m.mockClear?.();
    for (const m of Object.values(broadcastManagerMock)) m.mockClear?.();
  });

  it("marks the instance offline and emits instance:left", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);
    registryEntries.set("alice@host:proj/abc", {
      instanceId: "alice@host:proj/abc",
      project: "proj",
      status: "online",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
    });

    const ws = makeWs("alice@host:proj/abc");
    await onPluginClose(ws as never);

    expect(registryMock.markOffline.mock.calls[0][0]).toBe("alice@host:proj/abc");
    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const leftEvent = events.find((e) => e.event === "instance:left");
    expect(leftEvent).toBeDefined();
    expect(leftEvent.instanceId).toBe("alice@host:proj/abc");
  });

  it("does nothing when instanceId is missing", async () => {
    const ws = makeWs(undefined);
    ws.data.type = "plugin";
    await onPluginClose(ws as never);
    expect(registryMock.markOffline.mock.calls.length).toBe(0);
  });
});

describe("onPluginMessage — rate limiting", () => {
  it("rejects the 61st message within the 10s window", async () => {
    const ws = makeWs("ratelimit@host:proj/abc");
    // Flood 60 messages (all unknown action → wsError, but counted)
    for (let i = 0; i < 60; i++) {
      await onPluginMessage(ws as never, JSON.stringify({ action: "unknown_action_x" }));
    }
    ws.send.mockClear();
    // 61st should be rate-limited
    await onPluginMessage(ws as never, JSON.stringify({ action: "ping" }));
    const resp = parseLastSend(ws) as { code: number };
    expect(resp.code).toBe(429);
  });
});

describe("onPluginMessage — invalid input", () => {
  beforeEach(() => {
    registryEntries.clear();
  });

  it("returns error on invalid JSON", async () => {
    const ws = makeWs("alice@host:proj/abc");
    await onPluginMessage(ws as never, "not json{{{");
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Invalid JSON/i);
  });

  it("returns error on non-object payload", async () => {
    const ws = makeWs("alice@host:proj/abc");
    await onPluginMessage(ws as never, JSON.stringify([1, 2, 3]));
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/JSON object/i);
  });

  it("returns error for unknown action", async () => {
    const ws = makeWs("alice@host:proj/n-e-w/abc");
    await onPluginMessage(ws as never, JSON.stringify({ action: "fly_to_moon" }));
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Unknown action/i);
  });
});

describe("onPluginMessage — send_message (direct)", () => {
  const FROM = "alice@host:proj/sender";
  const TO = "bob@host:proj/receiver";

  beforeEach(() => {
    registryEntries.clear();
    queueMessages.clear();
    dashboardClients.clear();
    for (const m of Object.values(queueMock)) m.mockClear?.();
    for (const m of Object.values(registryMock)) m.mockClear?.();
    // Register recipient as offline (no WS ref)
    registryEntries.set(TO, {
      instanceId: TO,
      project: "proj",
      status: "offline",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
    });
  });

  it("pushes message to queue and acks sender", async () => {
    const ws = makeWs(FROM);
    const reqId = "req-001";
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "send_message",
        to: TO,
        type: MessageType.task,
        content: "hello",
        requestId: reqId,
      }),
    );

    expect(queueMock.pushMessage.mock.calls.length).toBe(1);
    const queuedTo = queueMock.pushMessage.mock.calls[0][0] as string;
    expect(queuedTo).toBe(TO);

    const ack = parseLastSend(ws) as { requestId: string; queued: boolean };
    expect(ack.requestId).toBe(reqId);
    expect(ack.queued).toBe(true);
  });

  it("delivers live when recipient is online", async () => {
    const recipientWs = makeWs(TO);
    registryEntries.set(TO, {
      instanceId: TO,
      project: "proj",
      status: "online",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
      wsRef: recipientWs,
    });
    registryMock.getWsRef.mockImplementation((id: string) => (id === TO ? recipientWs : undefined));

    const senderWs = makeWs(FROM);
    await onPluginMessage(
      senderWs as never,
      JSON.stringify({
        action: "send_message",
        to: TO,
        type: MessageType.task,
        content: "live delivery",
      }),
    );

    expect(recipientWs.send.mock.calls.length).toBe(1);
    const ack = parseLastSend(senderWs) as { queued: boolean };
    expect(ack.queued).toBe(false);
  });

  it("rejects invalid payload (missing type)", async () => {
    const ws = makeWs(FROM);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "send_message", to: TO, content: "oops" }),
    );
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Invalid send_message/i);
  });
});

describe("onPluginMessage — send_message (role routing)", () => {
  const FROM = "alice@host:proj/sender";

  beforeEach(() => {
    registryEntries.clear();
    queueMessages.clear();
    for (const m of Object.values(queueMock)) m.mockClear?.();
    for (const m of Object.values(registryMock)) m.mockClear?.();
  });

  it("fans out to all instances with matching role", async () => {
    const targets = ["b1@host:proj/1", "b2@host:proj/2"];
    for (const id of targets) {
      registryEntries.set(id, {
        instanceId: id,
        project: "proj",
        status: "online",
        queueDepth: 0,
        connectedAt: new Date().toISOString(),
        role: "backend",
      });
    }
    registryMock.getByRole.mockImplementation((role: string) =>
      Array.from(registryEntries.values()).filter((e) => e.role === role),
    );

    const ws = makeWs(FROM);
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "send_message",
        to: "role:backend",
        type: MessageType.task,
        content: "hey backends",
      }),
    );

    expect(queueMock.pushMessage.mock.calls.length).toBe(2);
    const resp = parseLastSend(ws) as { role: string; recipients: string[] };
    expect(resp.role).toBe("backend");
    expect(resp.recipients).toHaveLength(2);
  });

  it("returns error when no instances have the role", async () => {
    registryMock.getByRole.mockImplementation(() => []);
    const ws = makeWs(FROM);
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "send_message",
        to: "role:nonexistent",
        type: MessageType.task,
        content: "nobody",
      }),
    );
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/no instances found/i);
  });
});

describe("onPluginMessage — broadcast", () => {
  const FROM = "alice@host:proj/sender";

  beforeEach(() => {
    dashboardClients.clear();
    for (const m of Object.values(broadcastManagerMock)) m.mockClear?.();
  });

  it("broadcasts and returns delivered count", async () => {
    broadcastManagerMock.broadcast.mockImplementation(() => ({ delivered: 3, rateLimited: false }));
    const ws = makeWs(FROM);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "broadcast", type: MessageType.task, content: "hi all" }),
    );
    const resp = parseLastSend(ws) as { delivered: number };
    expect(resp.delivered).toBe(3);
  });

  it("returns 429 when rate limited", async () => {
    broadcastManagerMock.broadcast.mockImplementation(() => ({ delivered: 0, rateLimited: true }));
    const ws = makeWs(FROM);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "broadcast", type: MessageType.task, content: "flood" }),
    );
    const resp = parseLastSend(ws) as { code: number };
    expect(resp.code).toBe(429);
  });
});

describe("onPluginMessage — get_messages", () => {
  const INSTANCE = "alice@host:proj/abc";

  beforeEach(() => {
    queueMessages.clear();
    queueMock.atomicFlushOne.mockClear();
    queueMock.ackProcessed.mockClear();
  });

  it("returns empty array when queue is empty", async () => {
    queueMock.atomicFlushOne.mockImplementation(async () => null);
    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "get_messages", limit: 5, requestId: "r1" }),
    );
    const resp = parseLastSend(ws) as { messages: Message[]; requestId: string };
    expect(resp.messages).toHaveLength(0);
    expect(resp.requestId).toBe("r1");
  });

  it("returns up to limit messages", async () => {
    let callCount = 0;
    const msg: Message = {
      messageId: "00000000-0000-0000-0000-000000000001",
      from: "x@y:p/1",
      to: INSTANCE,
      type: MessageType.task,
      content: "test",
      timestamp: new Date().toISOString(),
    };
    queueMock.atomicFlushOne.mockImplementation(async () => {
      if (callCount++ < 2) return { message: msg, raw: JSON.stringify(msg) };
      return null;
    });

    const ws = makeWs(INSTANCE);
    await onPluginMessage(ws as never, JSON.stringify({ action: "get_messages", limit: 5 }));
    const resp = parseLastSend(ws) as { messages: Message[] };
    expect(resp.messages).toHaveLength(2);
  });
});

describe("onPluginMessage — session_update", () => {
  const OLD_ID = "alice@host:proj/old-uuid-0001-000000000000";
  const NEW_ID = "alice@host:proj/new-uuid-0001-000000000000";

  beforeEach(() => {
    dashboardClients.clear();
    registryEntries.clear();
    queueMessages.clear();
    for (const m of Object.values(registryMock)) m.mockClear?.();
    for (const m of Object.values(topicManagerMock)) m.mockClear?.();
    for (const m of Object.values(queueMock)) m.mockClear?.();
    registryEntries.set(OLD_ID, {
      instanceId: OLD_ID,
      project: "proj",
      status: "online",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
    });
    queueMock.migrateQueue.mockImplementation(async () => 3);
    topicManagerMock.getTopicsForInstance.mockImplementation(async () => ["proj"]);
    topicManagerMock.migrateSubscriptions.mockImplementation(async () => {});
  });

  it("rejects invalid newInstanceId format", async () => {
    const ws = makeWs(OLD_ID);
    const reqId = "00000000-0000-0000-0000-000000000099";
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "session_update",
        newInstanceId: "bad format!!!",
        requestId: reqId,
      }),
    );
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Invalid/i);
  });

  it("migrates queue and emits instance:session_updated", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(OLD_ID);
    const reqId = "00000000-0000-0000-0000-000000000088";
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "session_update",
        newInstanceId: NEW_ID,
        requestId: reqId,
      }),
    );

    expect(queueMock.migrateQueue.mock.calls.length).toBe(1);
    expect(queueMock.migrateQueue.mock.calls[0]).toEqual([OLD_ID, NEW_ID]);

    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const sessionUpdated = events.find((e) => e.event === "instance:session_updated");
    expect(sessionUpdated).toBeDefined();
    expect(sessionUpdated.oldInstanceId).toBe(OLD_ID);
    expect(sessionUpdated.newInstanceId).toBe(NEW_ID);
    expect(sessionUpdated.migrated).toBe(3);
  });

  it("acks back to the plugin with migrated count", async () => {
    const ws = makeWs(OLD_ID);
    const reqId = "00000000-0000-0000-0000-000000000077";
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "session_update",
        newInstanceId: NEW_ID,
        requestId: reqId,
      }),
    );
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const ack = frames.find((f) => f.migrated !== undefined && f.requestId === reqId);
    expect(ack).toBeDefined();
    expect(ack.migrated).toBe(3);
  });
});

describe("onPluginMessage — set_role", () => {
  const INSTANCE = "alice@host:proj/abc";

  beforeEach(() => {
    dashboardClients.clear();
    registryEntries.set(INSTANCE, {
      instanceId: INSTANCE,
      project: "proj",
      status: "online",
      queueDepth: 0,
      connectedAt: new Date().toISOString(),
    });
    for (const m of Object.values(registryMock)) m.mockClear?.();
  });

  it("sets role and emits instance:role_updated", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(INSTANCE);
    await onPluginMessage(ws as never, JSON.stringify({ action: "set_role", role: "reviewer" }));

    expect(registryMock.setRole.mock.calls[0][1]).toBe("reviewer");
    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const roleEvent = events.find((e) => e.event === "instance:role_updated");
    expect(roleEvent).toBeDefined();
    expect(roleEvent.instanceId).toBe(INSTANCE);
  });

  it("rejects empty role string", async () => {
    const ws = makeWs(INSTANCE);
    await onPluginMessage(ws as never, JSON.stringify({ action: "set_role", role: "" }));
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Invalid set_role/i);
  });
});

describe("onPluginMessage — subscribe_topic", () => {
  const INSTANCE = "alice@host:proj/abc";

  beforeEach(() => {
    dashboardClients.clear();
    for (const m of Object.values(topicManagerMock)) m.mockClear?.();
  });

  it("subscribes and emits topic:subscribed", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "subscribe_topic", topic: "my-topic" }),
    );

    expect(topicManagerMock.subscribe.mock.calls[0] as unknown[]).toEqual(["my-topic", INSTANCE]);
    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const subEvent = events.find((e) => e.event === "topic:subscribed");
    expect(subEvent).toBeDefined();
    expect(subEvent.name).toBe("my-topic");
  });

  it("rejects invalid topic payload", async () => {
    const ws = makeWs(INSTANCE);
    await onPluginMessage(ws as never, JSON.stringify({ action: "subscribe_topic" }));
    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/Invalid subscribe_topic/i);
  });
});

describe("onPluginMessage — unsubscribe_topic", () => {
  const INSTANCE = "alice@host:proj/abc";

  beforeEach(() => {
    dashboardClients.clear();
    for (const m of Object.values(topicManagerMock)) m.mockClear?.();
  });

  it("unsubscribes and emits topic:unsubscribed", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "unsubscribe_topic", topic: "my-topic" }),
    );

    expect(topicManagerMock.unsubscribe.mock.calls[0] as unknown[]).toEqual(["my-topic", INSTANCE]);
    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const unsubEvent = events.find((e) => e.event === "topic:unsubscribed");
    expect(unsubEvent).toBeDefined();
  });

  it("sends error frame (no HubEvent) when topicManager throws", async () => {
    topicManagerMock.unsubscribe.mockImplementation(async () => {
      throw new Error("cannot unsubscribe from auto-joined project topic");
    });
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({ action: "unsubscribe_topic", topic: "proj" }),
    );

    const resp = parseLastSend(ws) as { error: string };
    expect(resp.error).toMatch(/auto-joined/i);
    // Dashboard must NOT receive topic:unsubscribed on error
    const dashEvents = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(dashEvents.find((e) => e.event === "topic:unsubscribed")).toBeUndefined();
  });
});

describe("onPluginMessage — publish_topic", () => {
  const INSTANCE = "alice@host:proj/abc";

  beforeEach(() => {
    dashboardClients.clear();
    for (const m of Object.values(topicManagerMock)) m.mockClear?.();
    topicManagerMock.publishToTopic.mockImplementation(async () => ({ delivered: 2, queued: 1 }));
  });

  it("publishes and returns delivered/queued counts", async () => {
    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "publish_topic",
        topic: "my-topic",
        type: MessageType.task,
        content: "announcement",
        persistent: true,
      }),
    );

    expect(topicManagerMock.publishToTopic.mock.calls.length).toBe(1);
    const resp = parseLastSend(ws) as { delivered: number; queued: number };
    expect(resp.delivered).toBe(2);
    expect(resp.queued).toBe(1);
  });

  it("emits topic:message to dashboards", async () => {
    const dashboard = makeWs();
    dashboardClients.add(dashboard as never);

    const ws = makeWs(INSTANCE);
    await onPluginMessage(
      ws as never,
      JSON.stringify({
        action: "publish_topic",
        topic: "my-topic",
        type: MessageType.task,
        content: "announcement",
      }),
    );

    const events = dashboard.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const topicMsg = events.find((e) => e.event === "topic:message");
    expect(topicMsg).toBeDefined();
    expect(topicMsg.name).toBe("my-topic");
  });
});
