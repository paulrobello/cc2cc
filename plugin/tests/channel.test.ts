// plugin/tests/channel.test.ts
import { describe, it, expect, mock } from "bun:test";
import type { Message } from "@cc2cc/shared";
import { MessageType } from "@cc2cc/shared";

describe("emitChannelNotification", () => {
  it("calls mcp.notification with notifications/claude/channel method", async () => {
    const { emitChannelNotification } = await import("../src/channel.ts");

    const notificationSpy = mock(async (_params: unknown) => {});
    const fakeServer = { notification: notificationSpy } as any;

    const msg: Message = {
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      from: "alice@server:api/abc",
      to: "bob@laptop:cc2cc/def",
      type: MessageType.task,
      content: "Please review the auth module",
      timestamp: new Date().toISOString(),
    };

    await emitChannelNotification(fakeServer, msg);

    expect(notificationSpy).toHaveBeenCalledTimes(1);
    const call = notificationSpy.mock.calls[0][0] as any;
    expect(call.method).toBe("notifications/claude/channel");
  });

  it("sets params.content to message.content", async () => {
    const { emitChannelNotification } = await import("../src/channel.ts");

    const notificationSpy = mock(async (_params: unknown) => {});
    const fakeServer = { notification: notificationSpy } as any;

    const msg: Message = {
      messageId: "550e8400-e29b-41d4-a716-446655440001",
      from: "alice@server:api/abc",
      to: "bob@laptop:cc2cc/def",
      type: MessageType.result,
      content: "Auth module looks good",
      timestamp: new Date().toISOString(),
    };

    await emitChannelNotification(fakeServer, msg);

    const call = notificationSpy.mock.calls[0][0] as any;
    expect(call.params.content).toBe("Auth module looks good");
  });

  it("sets all required meta fields with identifier keys (no hyphens)", async () => {
    const { emitChannelNotification } = await import("../src/channel.ts");

    const notificationSpy = mock(async (_params: unknown) => {});
    const fakeServer = { notification: notificationSpy } as any;

    const msg: Message = {
      messageId: "550e8400-e29b-41d4-a716-446655440002",
      from: "alice@server:api/abc",
      to: "bob@laptop:cc2cc/def",
      type: MessageType.ack,
      content: "Accepted",
      replyToMessageId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
    };

    await emitChannelNotification(fakeServer, msg);

    const call = notificationSpy.mock.calls[0][0] as any;
    const meta = call.params.meta;

    // source must identify the plugin
    expect(meta.source).toBe("cc2cc");

    // Keys must be valid identifiers — no hyphens
    expect(meta.from).toBe("alice@server:api/abc");
    expect(meta.type).toBe("ack");
    expect(meta.message_id).toBe("550e8400-e29b-41d4-a716-446655440002");
    expect(meta.reply_to).toBe("550e8400-e29b-41d4-a716-446655440000");

    // Confirm hyphenated keys are NOT used
    expect(meta["message-id"]).toBeUndefined();
    expect(meta["reply-to"]).toBeUndefined();
  });

  it("sets reply_to to empty string when replyToMessageId is absent", async () => {
    const { emitChannelNotification } = await import("../src/channel.ts");

    const notificationSpy = mock(async (_params: unknown) => {});
    const fakeServer = { notification: notificationSpy } as any;

    const msg: Message = {
      messageId: "550e8400-e29b-41d4-a716-446655440003",
      from: "alice@server:api/abc",
      to: "bob@laptop:cc2cc/def",
      type: MessageType.question,
      content: "What is the status?",
      timestamp: new Date().toISOString(),
      // replyToMessageId intentionally omitted
    };

    await emitChannelNotification(fakeServer, msg);

    const call = notificationSpy.mock.calls[0][0] as any;
    expect(call.params.meta.reply_to).toBe("");
  });
});
