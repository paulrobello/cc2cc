// dashboard/src/components/ws-provider/ws-provider.test.tsx
import { render, screen, act } from "@testing-library/react";
import { WsProvider } from "./ws-provider";
import { useWs } from "@/hooks/use-ws";

// Track all WebSocket instances by URL segment so tests can address each one
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;

  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];

  /** The dashboard WS is the first created (connects to /ws/dashboard) */
  static get dashboardInstance(): MockWebSocket | null {
    return MockWebSocket.instances.find((ws) => ws.url.includes("/ws/dashboard")) ?? null;
  }

  /** The plugin WS is created second (connects to /ws/plugin) */
  static get pluginInstance(): MockWebSocket | null {
    return MockWebSocket.instances.find((ws) => ws.url.includes("/ws/plugin")) ?? null;
  }

  close = jest.fn();
  send = jest.fn();

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason: "", wasClean: false } as CloseEvent);
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

// Mock the API calls to avoid real network requests
jest.mock("@/lib/api", () => ({
  fetchInstances: jest.fn().mockResolvedValue([]),
  fetchTopics: jest.fn().mockResolvedValue([]),
}));

/**
 * Create a URL-aware fetch mock.
 *
 * - /api/hub/ws-config → { wsUrl: "ws://localhost:3100", apiKey: "test-key" }
 * - Everything else    → { ok: true, json: () => [] }
 *
 * The WsProvider awaits /api/hub/ws-config before opening WebSocket
 * connections, so the mock must return the correct shape.
 */
function makeFetchMock() {
  return jest.fn((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("/api/hub/ws-config")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ wsUrl: "ws://localhost:3100", apiKey: "test-key" }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  global.fetch = makeFetchMock();
  global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  MockWebSocket.instances = [];
  jest.useFakeTimers();
  // Provide sessionStorage for dashboardInstanceId generation
  Object.defineProperty(window, "sessionStorage", {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        clear: () => { store = {}; },
      };
    })(),
    writable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

/**
 * Render WsProvider and drain the microtask queue so the async init()
 * (fetch /api/hub/ws-config + open WS connections) completes before
 * test assertions run.
 */
async function renderProvider(children: React.ReactNode) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<WsProvider>{children}</WsProvider>);
  });
  return result;
}

function TestConsumer() {
  const ctx = useWs();
  return <div data-testid="state">{ctx.connectionState}</div>;
}

describe("WsProvider", () => {
  it("starts in reconnecting state before first connection opens", async () => {
    await renderProvider(<TestConsumer />);
    // WS connections are open (CONNECTING) but not yet confirmed OPEN
    expect(screen.getByTestId("state").textContent).toBe("reconnecting");
  });

  it("transitions to online when dashboard socket opens", async () => {
    await renderProvider(<TestConsumer />);
    act(() => {
      MockWebSocket.dashboardInstance?.simulateOpen();
    });
    expect(screen.getByTestId("state").textContent).toBe("online");
  });

  it("transitions to reconnecting after dashboard socket closes", async () => {
    await renderProvider(<TestConsumer />);
    act(() => {
      MockWebSocket.dashboardInstance?.simulateOpen();
    });
    act(() => {
      MockWebSocket.dashboardInstance?.simulateClose();
    });
    expect(screen.getByTestId("state").textContent).toBe("reconnecting");
  });

  it("transitions to disconnected after 3 failed reconnect attempts", async () => {
    await renderProvider(<TestConsumer />);
    // Attempt 1
    act(() => {
      MockWebSocket.dashboardInstance?.simulateClose();
    });
    act(() => { jest.advanceTimersByTime(1100); });
    act(() => {
      MockWebSocket.dashboardInstance?.simulateClose();
    });
    act(() => { jest.advanceTimersByTime(2100); });
    act(() => {
      MockWebSocket.dashboardInstance?.simulateClose();
    });
    expect(screen.getByTestId("state").textContent).toBe("disconnected");
  });

  it("parses instance:joined event and adds to instances map", async () => {
    function InstanceConsumer() {
      const { instances } = useWs();
      return <div data-testid="count">{instances.size}</div>;
    }
    await renderProvider(<InstanceConsumer />);
    act(() => {
      MockWebSocket.dashboardInstance?.simulateOpen();
    });
    act(() => {
      MockWebSocket.dashboardInstance?.simulateMessage({
        event: "instance:joined",
        instanceId: "paul@mac:cc2cc/abc",
        timestamp: new Date().toISOString(),
      });
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("opens both a dashboard WS and a plugin WS on mount", async () => {
    await renderProvider(<TestConsumer />);
    expect(MockWebSocket.dashboardInstance).not.toBeNull();
    expect(MockWebSocket.pluginInstance).not.toBeNull();
    expect(MockWebSocket.pluginInstance?.url).toContain("/ws/plugin");
    expect(MockWebSocket.pluginInstance?.url).toContain("instanceId=dashboard%40");
  });
});
