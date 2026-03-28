// plugin/tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Save and restore env between tests
const saved: Record<string, string | undefined> = {};
function saveEnv(...keys: string[]) {
  for (const k of keys) saved[k] = process.env[k];
}
function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

const ENV_KEYS = [
  "CC2CC_HUB_URL",
  "CC2CC_API_KEY",
  "CC2CC_USERNAME",
  "CC2CC_HOST",
  "CC2CC_PROJECT",
  "CC2CC_SESSION_ID",
];

describe("loadConfig", () => {
  beforeEach(() => saveEnv(...ENV_KEYS));
  afterEach(() => restoreEnv(...ENV_KEYS));

  it("reads explicit env vars", async () => {
    process.env.CC2CC_HUB_URL = "ws://192.168.1.10:3100";
    process.env.CC2CC_API_KEY = "secret-key";
    process.env.CC2CC_USERNAME = "alice";
    process.env.CC2CC_HOST = "workstation";
    process.env.CC2CC_PROJECT = "myproject";

    // Re-import to force fresh config load
    const { loadConfig } = await import("../src/config.ts");
    const config = await loadConfig();

    expect(config.hubUrl).toBe("ws://192.168.1.10:3100");
    expect(config.apiKey).toBe("secret-key");
    expect(config.username).toBe("alice");
    expect(config.host).toBe("workstation");
    expect(config.project).toBe("myproject");
  });

  it("falls back to $USER when CC2CC_USERNAME is absent", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";
    delete process.env.CC2CC_USERNAME;

    const { loadConfig } = await import("../src/config.ts");
    const config = await loadConfig();

    // Falls back to process.env.USER or a non-empty string
    expect(typeof config.username).toBe("string");
    expect(config.username.length).toBeGreaterThan(0);
  });

  it("falls back to cwd basename when CC2CC_PROJECT is absent", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";
    delete process.env.CC2CC_PROJECT;

    const { loadConfig } = await import("../src/config.ts");
    const config = await loadConfig();

    expect(typeof config.project).toBe("string");
    expect(config.project.length).toBeGreaterThan(0);
  });

  it("assembles instanceId as username@host:project/sessionId", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";
    process.env.CC2CC_USERNAME = "bob";
    process.env.CC2CC_HOST = "laptop";
    process.env.CC2CC_PROJECT = "demo";

    const { loadConfig } = await import("../src/config.ts");
    const config = await loadConfig();

    // Pattern: bob@laptop:demo/<session-id> (UUID when no session file exists)
    expect(config.instanceId).toMatch(/^bob@laptop:demo\/.+$/);
    // sessionId should be populated
    expect(config.sessionId.length).toBeGreaterThan(0);
    expect(config.instanceId).toBe(`bob@laptop:demo/${config.sessionId}`);
  });

  it("uses CC2CC_SESSION_ID env var when set", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";
    process.env.CC2CC_USERNAME = "bob";
    process.env.CC2CC_HOST = "laptop";
    process.env.CC2CC_PROJECT = "demo";
    process.env.CC2CC_SESSION_ID = "fixed-session-id-for-team";

    const { loadConfig } = await import("../src/config.ts");
    const config = await loadConfig();

    expect(config.sessionId).toBe("fixed-session-id-for-team");
    expect(config.instanceId).toBe("bob@laptop:demo/fixed-session-id-for-team");
  });

  it("uses CC2CC_SESSION_ID consistently across calls", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";
    process.env.CC2CC_SESSION_ID = "stable-id";

    const { loadConfig } = await import("../src/config.ts");
    const a = await loadConfig();
    const b = await loadConfig();

    expect(a.sessionId).toBe("stable-id");
    expect(b.sessionId).toBe("stable-id");
  });

  it("generates a unique instanceId each call", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    process.env.CC2CC_API_KEY = "key";

    const { loadConfig } = await import("../src/config.ts");
    const a = await loadConfig();
    const b = await loadConfig();

    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it("throws when CC2CC_HUB_URL is missing", async () => {
    delete process.env.CC2CC_HUB_URL;
    process.env.CC2CC_API_KEY = "key";

    const { loadConfig } = await import("../src/config.ts");
    await expect(loadConfig()).rejects.toThrow(/CC2CC_HUB_URL/);
  });

  it("throws when CC2CC_API_KEY is missing", async () => {
    process.env.CC2CC_HUB_URL = "ws://localhost:3100";
    delete process.env.CC2CC_API_KEY;

    const { loadConfig } = await import("../src/config.ts");
    await expect(loadConfig()).rejects.toThrow(/CC2CC_API_KEY/);
  });
});

describe("buildInstanceId", () => {
  it("assembles username@host:project/sessionId", async () => {
    const { buildInstanceId } = await import("../src/config.ts");
    const result = buildInstanceId(
      {
        hubUrl: "ws://localhost:3100",
        apiKey: "key",
        username: "alice",
        host: "server",
        project: "api",
      },
      "my-session-123",
    );
    expect(result).toBe("alice@server:api/my-session-123");
  });
});

describe("buildWsUrl", () => {
  it("builds a full WS URL with encoded params", async () => {
    const { buildWsUrl } = await import("../src/config.ts");
    const result = buildWsUrl("ws://localhost:3100", "s3cret", "alice@server:api/abc");
    expect(result).toBe(
      `ws://localhost:3100/ws/plugin?key=${encodeURIComponent("s3cret")}&instanceId=${encodeURIComponent("alice@server:api/abc")}`,
    );
  });
});
