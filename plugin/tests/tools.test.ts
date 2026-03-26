// plugin/tests/tools.test.ts
import { describe, it, expect, mock, afterEach } from "bun:test";
import { MessageType } from "@cc2cc/shared";
import type { InstanceInfo } from "@cc2cc/shared";
import type { HubConnection } from "../src/connection.ts";

// ── Mock config ──────────────────────────────────────────────────────────────

const mockConfig = {
  hubUrl: "ws://127.0.0.1:3100",
  apiKey: "test-api-key",
};

// Derived HTTP URL that tools.ts computes internally
const httpBase = "http://127.0.0.1:3100";
const key = encodeURIComponent("test-api-key");

// ── Mock HubConnection ──────────────────────────────────────────────────────

function createMockConn(requestResponse: unknown): HubConnection {
  return {
    request: mock(async (_action: string, _payload: Record<string, unknown>) => requestResponse),
  } as unknown as HubConnection;
}

// ── Fetch mock helper ────────────────────────────────────────────────────────

function mockFetch(responseBody: unknown, status = 200) {
  const fetchMock = mock(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => responseBody,
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("listInstances", () => {
  it("calls GET /api/instances and returns InstanceInfo array", async () => {
    const { createTools } = await import("../src/tools.ts");

    const mockInstances: InstanceInfo[] = [
      {
        instanceId: "alice@server:api/abc",
        project: "api",
        status: "online",
        connectedAt: new Date().toISOString(),
        queueDepth: 0,
      },
    ];

    const fetchMock = mockFetch(mockInstances);
    const mockConn = createMockConn(null);
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.list_instances({});
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].instanceId).toBe("alice@server:api/abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe(`${httpBase}/api/instances?key=${key}`);
    // A 10-second AbortSignal timeout is added for safety — init must include signal
    expect(init).toBeDefined();
    expect((init as RequestInit & { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("sendMessage", () => {
  it("calls conn.request('send_message') with required fields and returns messageId", async () => {
    const { createTools } = await import("../src/tools.ts");

    const messageId = "550e8400-e29b-41d4-a716-446655440000";
    const mockConn = createMockConn({
      messageId,
      queued: false,
      requestId: "req-123",
    });
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.send_message({
      to: "alice@server:api/abc",
      type: MessageType.task,
      content: "Please review auth module",
    });

    expect(result.messageId).toBe(messageId);
    expect(result.queued).toBe(false);
    // requestId should be stripped
    expect((result as Record<string, unknown>).requestId).toBeUndefined();

    expect(mockConn.request).toHaveBeenCalledTimes(1);
    const [action, payload] = (mockConn.request as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("send_message");
    expect(payload.to).toBe("alice@server:api/abc");
    expect(payload.type).toBe("task");
    expect(payload.content).toBe("Please review auth module");
  });

  it("includes replyToMessageId when provided", async () => {
    const { createTools } = await import("../src/tools.ts");

    const mockConn = createMockConn({
      messageId: "550e8400-e29b-41d4-a716-446655440001",
      queued: true,
      warning: "message queued, recipient offline",
      requestId: "req-456",
    });
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.send_message({
      to: "alice@server:api/abc",
      type: MessageType.result,
      content: "Done",
      replyToMessageId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.queued).toBe(true);
    expect(result.warning).toBe("message queued, recipient offline");

    const [, payload] = (mockConn.request as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.replyToMessageId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("broadcast", () => {
  it("calls conn.request('broadcast') and returns delivered count", async () => {
    const { createTools } = await import("../src/tools.ts");

    const mockConn = createMockConn({ delivered: 3, requestId: "req-789" });
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.broadcast({
      type: MessageType.task,
      content: "Starting auth refactor — avoid src/auth/",
    });

    expect(result.delivered).toBe(3);
    // requestId should be stripped
    expect((result as Record<string, unknown>).requestId).toBeUndefined();

    expect(mockConn.request).toHaveBeenCalledTimes(1);
    const [action, payload] = (mockConn.request as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("broadcast");
    expect(payload.type).toBe("task");
    expect(payload.content).toBe("Starting auth refactor — avoid src/auth/");
  });
});

describe("getMessages", () => {
  it("calls conn.request('get_messages') with default limit of 10", async () => {
    const { createTools } = await import("../src/tools.ts");

    const fakeMessages = [
      {
        messageId: "550e8400-e29b-41d4-a716-446655440002",
        from: "alice@server:api/abc",
        to: "bob@laptop:cc2cc/def",
        type: "task",
        content: "Review the handler",
        timestamp: new Date().toISOString(),
      },
    ];

    const mockConn = createMockConn({ messages: fakeMessages, requestId: "req-abc" });
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.get_messages({});
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].messageId).toBe("550e8400-e29b-41d4-a716-446655440002");

    const [action, payload] = (mockConn.request as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("get_messages");
    expect(payload.limit).toBe(10);
  });

  it("respects a custom limit", async () => {
    const { createTools } = await import("../src/tools.ts");

    const mockConn = createMockConn({ messages: [], requestId: "req-def" });
    const tools = createTools(mockConfig, mockConn);

    await tools.get_messages({ limit: 5 });

    const [, payload] = (mockConn.request as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.limit).toBe(5);
  });
});

describe("ping", () => {
  it("returns online: true with latency when hub confirms online", async () => {
    const { createTools } = await import("../src/tools.ts");

    const fetchMock = mockFetch({ online: true, latency: 12 });
    const mockConn = createMockConn(null);
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.ping({ to: "alice@server:api/abc" });
    expect(result.online).toBe(true);
    expect(typeof result.latency).toBe("number");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/ping/");
    expect(url).toContain(`key=${key}`);
  });

  it("returns online: false when target is offline", async () => {
    const { createTools } = await import("../src/tools.ts");

    mockFetch({ online: false });
    const mockConn = createMockConn(null);
    const tools = createTools(mockConfig, mockConn);

    const result = await tools.ping({ to: "ghost@server:api/xyz" });
    expect(result.online).toBe(false);
    expect(result.latency).toBeUndefined();
  });
});
