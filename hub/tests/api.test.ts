// hub/tests/api.test.ts
import { describe, it, expect, mock } from "bun:test";

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
  config: { apiKey: "test-key", port: 3100, redisUrl: "redis://localhost:6379" },
};

mock.module("../src/registry.js", () => ({ registry: registryMock }));
mock.module("../src/queue.js", () => queueMock);
mock.module("../src/redis.js", () => redisMock);
mock.module("../src/config.js", () => configMock);

const { buildApiRoutes } = await import("../src/api.js");
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  buildApiRoutes(app);
  return app;
}

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
