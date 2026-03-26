// hub/tests/api.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { TopicInfo } from "@cc2cc/shared";

// Mock dependencies before importing api
const registryMock = {
  getAll: mock(() => [
    {
      instanceId: "alice@srv:api/a",
      project: "api",
      status: "online",
      connectedAt: new Date().toISOString(),
      queueDepth: 3,
    },
    {
      instanceId: "bob@mac:hub/b",
      project: "hub",
      status: "offline",
      connectedAt: new Date().toISOString(),
      queueDepth: 0,
    },
  ]),
  getOnline: mock(() => [
    {
      instanceId: "alice@srv:api/a",
      project: "api",
      status: "online",
      connectedAt: new Date().toISOString(),
      queueDepth: 3,
    },
  ]),
  setQueueDepth: mock(() => {}),
  get: mock(() => undefined as unknown),
  getWsRef: mock(() => undefined as unknown),
};
const queueMock = {
  getMessagesTodayCount: mock(async () => 42),
  getTotalQueued: mock(async () => 3),
  flushQueue: mock(async () => {}),
};
const redisMock = {
  checkRedisHealth: mock(async () => true),
};
const configMock = {
  config: {
    apiKey: "test-key",
    port: 3100,
    redisUrl: "redis://localhost:6379",
    dashboardOrigin: "*",
  },
  REDIS_TTL_SECONDS: 86400,
};

// Mock topicManager
const topicManagerMock = {
  listTopics: mock(async () => [] as TopicInfo[]),
  createTopic: mock(
    async () =>
      ({
        name: "cc2cc",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "test",
        subscriberCount: 0,
      }) as TopicInfo,
  ),
  deleteTopic: mock(async () => {}),
  subscribe: mock(async () => {}),
  unsubscribe: mock(async () => {}),
  getSubscribers: mock(async () => [] as string[]),
  getTopicsForInstance: mock(async () => [] as string[]),
  topicExists: mock(async () => true),
  publishToTopic: mock(async () => ({ delivered: 0, queued: 0 })),
};

mock.module("../src/registry.js", () => ({ registry: registryMock }));
mock.module("../src/queue.js", () => queueMock);
mock.module("../src/redis.js", () => redisMock);
mock.module("../src/config.js", () => configMock);
mock.module("../src/topic-manager.js", () => ({
  topicManager: topicManagerMock,
  parseProject: (id: string) => id.split(":")[1]?.split("/")[0] ?? id,
  validateTopicName: (_name: unknown) => null, // null = valid; tests don't exercise validation
}));

// Mock event-bus (api.ts imports emitToDashboards from event-bus.js after ARC-003 refactor)
// The ws-handler.js mock is removed — api.ts no longer imports from ws-handler.js.
mock.module("../src/event-bus.js", () => ({
  emitToDashboards: mock(() => {}),
  dashboardClients: new Set(),
  broadcastManager: { addPluginWs: () => {}, removePluginWs: () => {}, broadcast: () => ({}) },
}));

const { buildApiRoutes } = await import("../src/api.js");
import { Hono } from "hono";

const KEY = "test-key";

function makeApp() {
  const app = new Hono();
  buildApiRoutes(app);
  return app;
}

const app = makeApp();

beforeEach(() => {
  for (const m of Object.values(topicManagerMock)) {
    (m as ReturnType<typeof mock>).mockClear?.();
  }
});

describe("GET /health", () => {
  it("returns 200 without key — endpoint is publicly accessible per spec", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.connectedInstances).toBe("number");
    expect(typeof body.redisOk).toBe("boolean");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns 200 with correct key", async () => {
    const res = await makeApp().request("/health?key=test-key");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.connectedInstances).toBe("number");
    expect(typeof body.redisOk).toBe("boolean");
    expect(typeof body.uptime).toBe("number");
  });
});

describe("GET /api/instances", () => {
  it("returns 401 without key", async () => {
    const res = await makeApp().request("/api/instances");
    expect(res.status).toBe(401);
  });

  it("returns all instances including offline", async () => {
    const res = await makeApp().request("/api/instances?key=test-key");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
    const offline = (body as Array<Record<string, unknown>>).find((i) => i.status === "offline");
    expect(offline).toBeDefined();
    const online = (body as Array<Record<string, unknown>>).find((i) => i.status === "online");
    expect(online).toBeDefined();
  });
});

describe("GET /api/stats", () => {
  it("returns messagesToday, activeInstances, queuedTotal", async () => {
    const res = await makeApp().request("/api/stats?key=test-key");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.messagesToday).toBe(42);
    expect(body.activeInstances).toBe(1);
    expect(typeof body.queuedTotal).toBe("number");
  });
});

describe("DELETE /api/queue/:id", () => {
  it("returns 401 without key", async () => {
    const res = await makeApp().request("/api/queue/alice%40srv%3Aapi%2Fa", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 and calls flushQueue with decoded instanceId", async () => {
    const res = await makeApp().request("/api/queue/alice%40srv%3Aapi%2Fa?key=test-key", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(queueMock.flushQueue).toHaveBeenCalledWith("alice@srv:api/a");
  });
});

describe("GET /api/topics", () => {
  it("returns 200 with topic list", async () => {
    topicManagerMock.listTopics.mockResolvedValue([
      {
        name: "cc2cc",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "alice@srv:cc2cc/abc",
        subscriberCount: 1,
      },
    ]);
    const res = await app.request(`/api/topics?key=${KEY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe("GET /api/topics/:name/subscribers", () => {
  it("returns 404 when topic does not exist", async () => {
    topicManagerMock.topicExists.mockResolvedValue(false);
    const res = await app.request(`/api/topics/missing/subscribers?key=${KEY}`);
    expect(res.status).toBe(404);
  });

  it("returns subscriber list for existing topic", async () => {
    topicManagerMock.topicExists.mockResolvedValue(true);
    topicManagerMock.getSubscribers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
    const res = await app.request(`/api/topics/cc2cc/subscribers?key=${KEY}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/topics", () => {
  it("creates and returns a TopicInfo", async () => {
    const res = await app.request(`/api/topics?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "cc2cc" }),
    });
    expect(res.status).toBe(200);
    expect(topicManagerMock.createTopic).toHaveBeenCalled();
  });
});

describe("DELETE /api/topics/:name", () => {
  it("returns 404 when topic does not exist", async () => {
    topicManagerMock.topicExists.mockResolvedValue(false);
    const res = await app.request(`/api/topics/missing?key=${KEY}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("returns 409 when topic has subscribers", async () => {
    topicManagerMock.topicExists.mockResolvedValue(true);
    topicManagerMock.getSubscribers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
    const res = await app.request(`/api/topics/cc2cc?key=${KEY}`, { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("deletes and returns { deleted: true, name }", async () => {
    topicManagerMock.topicExists.mockResolvedValue(true);
    topicManagerMock.getSubscribers.mockResolvedValue([]);
    const res = await app.request(`/api/topics/cc2cc?key=${KEY}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; name: string };
    expect(body.deleted).toBe(true);
    expect(body.name).toBe("cc2cc");
  });
});

describe("POST /api/topics/:name/publish", () => {
  it("returns 404 when topic does not exist", async () => {
    topicManagerMock.topicExists.mockResolvedValue(false);
    const res = await app.request(`/api/topics/missing/publish?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi", type: "task" }),
    });
    expect(res.status).toBe(404);
  });
});
