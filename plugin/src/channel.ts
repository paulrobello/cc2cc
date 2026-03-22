// plugin/src/channel.ts
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Message } from "@cc2cc/shared";

/**
 * Emit a notifications/claude/channel notification to Claude Code.
 *
 * Claude Code renders this as:
 *   <channel source="cc2cc" from="..." type="..." message_id="..." reply_to="...">
 *     {message.content}
 *   </channel>
 *
 * Meta key naming rules (from the MCP channels reference):
 *   - Keys must be valid identifiers — no hyphens
 *   - Use snake_case: message_id, reply_to
 *
 * @param mcp    - The MCP Server instance used to emit the notification
 * @param message - The inbound message received from the hub over WebSocket
 */
export async function emitChannelNotification(
  mcp: Pick<Server, "notification">,
  message: Message,
): Promise<void> {
  await mcp.notification({
    method: "notifications/claude/channel",
    params: {
      content: message.content,
      meta: {
        source: "cc2cc",
        from: message.from,
        type: message.type,
        message_id: message.messageId,
        reply_to: message.replyToMessageId ?? "",
      },
    },
  });
}
