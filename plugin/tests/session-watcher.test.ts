// plugin/tests/session-watcher.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { watchSession } from "../src/session-watcher.ts";
import type { PluginConfig } from "../src/config.ts";

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    hubUrl: "ws://localhost:3100",
    apiKey: "key",
    username: "alice",
    host: "laptop",
    project: "demo",
    sessionId: "original-session",
    instanceId: "alice@laptop:demo/original-session",
    wsUrl:
      "ws://localhost:3100/ws/plugin?key=key&instanceId=alice%40laptop%3Ademo%2Foriginal-session",
    ...overrides,
  };
}

describe("watchSession", () => {
  const savedSessionId = process.env.CC2CC_SESSION_ID;

  afterEach(() => {
    if (savedSessionId === undefined) delete process.env.CC2CC_SESSION_ID;
    else process.env.CC2CC_SESSION_ID = savedSessionId;
  });

  it("returns a no-op unwatcher when CC2CC_SESSION_ID is set", () => {
    process.env.CC2CC_SESSION_ID = "team-session-id";

    const config = makeConfig();
    const mockConn = { on: () => {}, connect: () => {}, send: () => {} } as never;
    const mockTools = {} as never;
    const state = { conn: mockConn, tools: mockTools };
    let reconnected = false;

    const unwatch = watchSession(config, state, {
      onReconnect: () => {
        reconnected = true;
      },
    });

    // Should return a function (no-op unwatcher)
    expect(typeof unwatch).toBe("function");
    // Calling it should not throw
    unwatch();
    // No reconnect should have happened
    expect(reconnected).toBe(false);
  });

  it("sets up file watcher when CC2CC_SESSION_ID is not set", () => {
    delete process.env.CC2CC_SESSION_ID;

    const config = makeConfig();
    const mockConn = { on: () => {}, connect: () => {}, send: () => {} } as never;
    const mockTools = {} as never;
    const state = { conn: mockConn, tools: mockTools };

    const unwatch = watchSession(config, state, {
      onReconnect: () => {},
    });

    // Should return a function (real unwatcher)
    expect(typeof unwatch).toBe("function");
    // Clean up the file watcher
    unwatch();
  });
});
