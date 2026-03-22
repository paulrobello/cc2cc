// hub/tests/registry.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock ioredis so tests run without a live Redis connection
const redisMock = {
  set: mock(async () => "OK"),
  del: mock(async () => 1),
  exists: mock(async () => 0),
  keys: mock(async () => [] as string[]),
  ping: mock(async () => "PONG"),
  on: mock(() => {}),
};

const checkRedisHealthMock = mock(async () => true);

// Patch before importing registry
mock.module("../src/redis.js", () => ({
  redis: redisMock,
  checkRedisHealth: checkRedisHealthMock,
}));

// Import AFTER mock is registered
const { registry } = await import("../src/registry.js");

describe("registry", () => {
  beforeEach(() => {
    registry.clear();
    redisMock.set.mockClear();
    redisMock.del.mockClear();
  });

  it("registers a new instance and marks it online", async () => {
    await registry.register("alice@srv:api/abc", "api");
    const info = registry.get("alice@srv:api/abc");
    expect(info).toBeDefined();
    expect(info?.status).toBe("online");
    expect(info?.project).toBe("api");
  });

  it("sets a Redis presence key on register", async () => {
    await registry.register("alice@srv:api/abc", "api");
    expect(redisMock.set).toHaveBeenCalledWith(
      "instance:alice@srv:api/abc",
      expect.any(String),
      "EX",
      86400,
    );
  });

  it("marks an instance offline on deregister", async () => {
    await registry.register("alice@srv:api/abc", "api");
    registry.markOffline("alice@srv:api/abc");
    const info = registry.get("alice@srv:api/abc");
    expect(info?.status).toBe("offline");
  });

  it("returns all instances including offline ones", async () => {
    await registry.register("alice@srv:api/abc", "api");
    await registry.register("bob@mac:hub/xyz", "hub");
    registry.markOffline("bob@mac:hub/xyz");
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((i) => i.instanceId === "bob@mac:hub/xyz")?.status).toBe("offline");
  });

  it("returns only online instances", async () => {
    await registry.register("alice@srv:api/abc", "api");
    await registry.register("bob@mac:hub/xyz", "hub");
    registry.markOffline("bob@mac:hub/xyz");
    const online = registry.getOnline();
    expect(online).toHaveLength(1);
    expect(online[0]?.instanceId).toBe("alice@srv:api/abc");
  });

  it("returns undefined for unknown instance", () => {
    expect(registry.get("unknown@x:y/z")).toBeUndefined();
  });
});

describe("registry.resolvePartial", () => {
  beforeEach(() => {
    registry.clear();
    redisMock.set.mockClear();
    redisMock.del.mockClear();
  });

  it("resolves to the single online instance", async () => {
    await registry.register("alice@srv:api/session1", "api");
    const result = registry.resolvePartial("alice@srv:api");
    expect("instanceId" in result).toBe(true);
    if ("instanceId" in result) {
      expect(result.instanceId).toBe("alice@srv:api/session1");
      expect(result.warning).toBeUndefined();
    }
  });

  it("returns error when 2+ online instances match", async () => {
    await registry.register("alice@srv:api/session1", "api");
    await registry.register("alice@srv:api/session2", "api");
    const result = registry.resolvePartial("alice@srv:api");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/ambiguous/);
    }
  });

  it("resolves to the single offline instance with warning", async () => {
    await registry.register("alice@srv:api/session1", "api");
    registry.markOffline("alice@srv:api/session1");
    const result = registry.resolvePartial("alice@srv:api");
    expect("instanceId" in result).toBe(true);
    if ("instanceId" in result) {
      expect(result.instanceId).toBe("alice@srv:api/session1");
      expect(result.warning).toBe("recipient offline, message queued");
    }
  });

  it("returns error when 2+ offline instances match", async () => {
    await registry.register("alice@srv:api/session1", "api");
    await registry.register("alice@srv:api/session2", "api");
    registry.markOffline("alice@srv:api/session1");
    registry.markOffline("alice@srv:api/session2");
    const result = registry.resolvePartial("alice@srv:api");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/ambiguous/);
    }
  });

  it("returns error when no instance matches", () => {
    const result = registry.resolvePartial("nobody@srv:api");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/no instance found/);
    }
  });

  it("online instance takes priority over offline with same prefix", async () => {
    await registry.register("alice@srv:api/old", "api");
    registry.markOffline("alice@srv:api/old");
    await registry.register("alice@srv:api/new", "api");
    const result = registry.resolvePartial("alice@srv:api");
    // 1 online → resolve to online, no warning
    expect("instanceId" in result).toBe(true);
    if ("instanceId" in result) {
      expect(result.instanceId).toBe("alice@srv:api/new");
      expect(result.warning).toBeUndefined();
    }
  });
});

describe("registry.deregister", () => {
  beforeEach(() => {
    registry.clear();
    redisMock.set.mockClear();
    redisMock.del.mockClear();
  });

  it("removes the instance from in-memory map", async () => {
    await registry.register("alice@srv:api/abc", "api");
    await registry.deregister("alice@srv:api/abc");
    expect(registry.get("alice@srv:api/abc")).toBeUndefined();
  });

  it("deletes the Redis presence key", async () => {
    await registry.register("alice@srv:api/abc", "api");
    await registry.deregister("alice@srv:api/abc");
    expect(redisMock.del).toHaveBeenCalledWith("instance:alice@srv:api/abc");
  });

  it("is a no-op for unknown instances", async () => {
    // Should not throw
    await expect(registry.deregister("unknown@x:y/z")).resolves.toBeUndefined();
  });
});
