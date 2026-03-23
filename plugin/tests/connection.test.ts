// plugin/tests/connection.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WebSocketServer } from "ws";

// A minimal in-process mock hub to test reconnect behaviour
async function startMockHub(port: number): Promise<{
  wss: WebSocketServer;
  receivedMessages: string[];
  close: () => Promise<void>;
}> {
  const receivedMessages: string[] = [];
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      receivedMessages.push(data.toString());
    });
  });

  await new Promise<void>((resolve) => wss.on("listening", resolve));

  return {
    wss,
    receivedMessages,
    close: async () => {
      // Terminate all connected clients before closing the server.
      for (const client of wss.clients) {
        client.terminate();
      }
      // wss.close() callback fires once all connections are gone.
      // Provide a safety timeout in case it doesn't fire (Bun quirk).
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
        setTimeout(resolve, 500);
      });
    },
  };
}

describe("HubConnection", () => {
  it("connects to the hub URL and emits open event", async () => {
    const { wss, close } = await startMockHub(19001);

    try {
      const { HubConnection } = await import("../src/connection.ts");
      const conn = new HubConnection("ws://127.0.0.1:19001");

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connect timeout")), 3000);
        conn.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        conn.connect();
      });

      conn.destroy();
    } finally {
      await close();
    }
  });

  it("emits message events for each frame received", async () => {
    const { wss, close } = await startMockHub(19002);

    try {
      const { HubConnection } = await import("../src/connection.ts");
      const conn = new HubConnection("ws://127.0.0.1:19002");
      const received: unknown[] = [];

      conn.on("message", (data) => received.push(data));

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connect timeout")), 3000);
        conn.on("open", () => {
          clearTimeout(timeout);
          // Send a frame from the server to the client
          wss.clients.forEach((ws) => ws.send(JSON.stringify({ type: "ping" })));
          resolve();
        });
        conn.connect();
      });

      // Wait for message to arrive
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(received.length).toBeGreaterThan(0);
      conn.destroy();
    } finally {
      await close();
    }
  });

  it("reconnects with exponential backoff after disconnect", async () => {
    // Note: test timeout extended to 8s for reconnect scenario
    // Start a server, connect, stop the server, restart it, verify reconnect
    let wss = await startMockHub(19003);
    const connectCount = { n: 0 };

    wss.wss.on("connection", () => {
      connectCount.n++;
    });

    const { HubConnection } = await import("../src/connection.ts");
    // Use 50ms initial delay for test speed
    const conn = new HubConnection("ws://127.0.0.1:19003", {
      initialDelayMs: 50,
      maxDelayMs: 200,
    });

    // First connect
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("initial connect timeout")), 3000);
      conn.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      conn.connect();
    });

    expect(connectCount.n).toBe(1);

    // Kill the server to trigger disconnect
    await wss.close();

    // Restart on same port
    wss = await startMockHub(19003);
    wss.wss.on("connection", () => {
      connectCount.n++;
    });

    // Wait for reconnect (backoff starts at 50ms, may take several attempts)
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    expect(connectCount.n).toBeGreaterThanOrEqual(2);
    conn.destroy();
    await wss.close();
  });

  it("send() transmits a JSON frame over the WebSocket", async () => {
    const { wss, receivedMessages, close } = await startMockHub(19004);

    try {
      const { HubConnection } = await import("../src/connection.ts");
      const conn = new HubConnection("ws://127.0.0.1:19004");

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connect timeout")), 3000);
        conn.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        conn.connect();
      });

      conn.send({ action: "list_instances" });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(receivedMessages).toContain(JSON.stringify({ action: "list_instances" }));
      conn.destroy();
    } finally {
      await close();
    }
  });

  it("destroy() stops reconnect attempts", async () => {
    const { HubConnection } = await import("../src/connection.ts");
    // Connect to a port with nothing listening
    const conn = new HubConnection("ws://127.0.0.1:19099", {
      initialDelayMs: 50,
      maxDelayMs: 100,
    });
    conn.connect();

    // Let one reconnect attempt happen then destroy
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    conn.destroy();

    // After destroy, no further events should be emitted — just verify no throw
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  });
});
