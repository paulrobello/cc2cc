// plugin/tests/integration.test.ts
import { describe, it, expect, mock } from "bun:test";
import { WebSocketServer } from "ws";
import { MessageType } from "@cc2cc/shared";
import type { Message } from "@cc2cc/shared";

const INTEGRATION_PORT = 19100;

async function startMockHub(port: number) {
  const wss = new WebSocketServer({ port });
  await new Promise<void>((resolve) => wss.on("listening", resolve));
  return {
    wss,
    close: async () => {
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

describe("Plugin integration: hub WS message → channel notification", () => {
  it("emits a channel notification when hub delivers a message", async () => {
    const { wss, close } = await startMockHub(INTEGRATION_PORT);

    try {
      const { HubConnection } = await import("../src/connection.ts");
      const { emitChannelNotification } = await import("../src/channel.ts");

      const notificationSpy = mock(async (_params: unknown) => {});
      const fakeMcp = { notification: notificationSpy } as any;

      const conn = new HubConnection(`ws://127.0.0.1:${INTEGRATION_PORT}`, "test-key");
      const receivedMessages: Message[] = [];

      // Wire connection to channel emitter — same as index.ts does
      conn.on("message", async (data: unknown) => {
        const frame = data as { messageId?: string } & Message;
        if (frame.messageId && frame.from && frame.content) {
          receivedMessages.push(frame as Message);
          await emitChannelNotification(fakeMcp, frame as Message);
        }
      });

      // Connect and wait for the WS handshake
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connect timeout")), 3000);
        conn.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        conn.connect();
      });

      // Hub pushes a message envelope to the plugin
      const inboundMessage: Message = {
        messageId: "550e8400-e29b-41d4-a716-446655440099",
        from: "alice@server:api/xyz",
        to: "bob@laptop:cc2cc/def",
        type: MessageType.task,
        content: "Please review the auth handler",
        timestamp: new Date().toISOString(),
      };

      wss.clients.forEach((ws) => ws.send(JSON.stringify(inboundMessage)));

      // Wait for async message handler to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // Verify the channel notification was emitted
      expect(notificationSpy).toHaveBeenCalledTimes(1);

      const call = notificationSpy.mock.calls[0][0] as any;
      expect(call.method).toBe("notifications/claude/channel");
      expect(call.params.content).toBe("Please review the auth handler");
      expect(call.params.meta.from).toBe("alice@server:api/xyz");
      expect(call.params.meta.type).toBe("task");
      expect(call.params.meta.message_id).toBe("550e8400-e29b-41d4-a716-446655440099");
      expect(call.params.meta.reply_to).toBe("");

      conn.destroy();
    } finally {
      await close();
    }
  });

  it("does not emit notification for hub ack frames (no messageId)", async () => {
    const { wss, close } = await startMockHub(INTEGRATION_PORT + 1);

    try {
      const { HubConnection } = await import("../src/connection.ts");
      const { emitChannelNotification } = await import("../src/channel.ts");

      const notificationSpy = mock(async (_params: unknown) => {});
      const fakeMcp = { notification: notificationSpy } as any;

      const conn = new HubConnection(`ws://127.0.0.1:${INTEGRATION_PORT + 1}`, "test-key");

      conn.on("message", async (data: unknown) => {
        const frame = data as { messageId?: string } & Message;
        if (frame.messageId && frame.from && frame.content) {
          await emitChannelNotification(fakeMcp, frame as Message);
        }
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connect timeout")), 3000);
        conn.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        conn.connect();
      });

      // Hub sends a tool-response ack frame (no messageId, from, content)
      const ackFrame = {
        requestId: "550e8400-e29b-41d4-a716-000000000001",
        instances: [],
      };
      wss.clients.forEach((ws) => ws.send(JSON.stringify(ackFrame)));

      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // Notification must NOT be emitted for non-message frames
      expect(notificationSpy).not.toHaveBeenCalled();

      conn.destroy();
    } finally {
      await close();
    }
  });
});
