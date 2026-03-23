// hub/tests/integration.test.ts
// Integration tests: start a real Hono server (no WS) and test REST + auth.
// Full WS integration requires a live Redis and is covered by manual/E2E testing.
import { describe, it, expect, mock } from "bun:test";

// Mock all Redis calls so integration tests run without a live Redis
const redisMockInt = {
  set: mock(async () => "OK"),
  del: mock(async () => 1),
  exists: mock(async () => 0),
  keys: mock(async () => [] as string[]),
  rpush: mock(async () => 1),
  expire: mock(async () => 1),
  lpop: mock(async () => null),
  llen: mock(async () => 0),
  rpoplpush: mock(async () => null),
  lrem: mock(async () => 1),
  incr: mock(async () => 1),
  expireat: mock(async () => 1),
  get: mock(async () => "0"),
  lrange: mock(async () => [] as string[]),
  pipeline: mock(() => ({
    llen: mock(() => ({ exec: mock(async () => [] as unknown[]) })),
    exec: mock(async () => [] as unknown[]),
  })),
  ping: mock(async () => "PONG"),
  on: mock(() => {}),
};

mock.module("../src/redis.js", () => ({
  redis: redisMockInt,
  checkRedisHealth: mock(async () => true),
}));

// Set required env before config is loaded
process.env.CC2CC_HUB_API_KEY = "integration-test-key";
process.env.CC2CC_HUB_PORT = "13100";
process.env.CC2CC_REDIS_URL = "redis://localhost:6379";

const { Hono } = await import("hono");
const { buildApiRoutes } = await import("../src/api.js");

const app = new Hono();
buildApiRoutes(app);

const VALID_KEY = "integration-test-key";

describe("REST auth enforcement", () => {
  it("GET /health — 200 without key — publicly accessible per spec", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("GET /health — 200 with wrong key — no auth required", async () => {
    const res = await app.request("/health?key=wrong");
    expect(res.status).toBe(200);
  });

  it("GET /api/instances — 401 without key", async () => {
    const res = await app.request("/api/instances");
    expect(res.status).toBe(401);
  });

  it("GET /api/stats — 401 without key", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(401);
  });

  it("DELETE /api/queue/:id — 401 without key", async () => {
    const res = await app.request("/api/queue/some-instance", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("REST endpoints with valid auth", () => {
  it("GET /health returns { status, connectedInstances, redisOk, uptime }", async () => {
    const res = await app.request(`/health?key=${VALID_KEY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("connectedInstances");
    expect(body).toHaveProperty("redisOk");
    expect(body).toHaveProperty("uptime");
  });

  it("GET /api/instances returns an array", async () => {
    const res = await app.request(`/api/instances?key=${VALID_KEY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/stats returns { messagesToday, activeInstances, queuedTotal }", async () => {
    const res = await app.request(`/api/stats?key=${VALID_KEY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("messagesToday");
    expect(body).toHaveProperty("activeInstances");
    expect(body).toHaveProperty("queuedTotal");
  });

  it("GET /api/messages/:id returns 404 with explanation", async () => {
    const res = await app.request(`/api/messages/some-uuid?key=${VALID_KEY}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("DELETE /api/queue/:id returns 200 with { flushed: true, instanceId }", async () => {
    const encoded = encodeURIComponent("alice@srv:api/a");
    const res = await app.request(`/api/queue/${encoded}?key=${VALID_KEY}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flushed).toBe(true);
    expect(body.instanceId).toBe("alice@srv:api/a");
  });
});
