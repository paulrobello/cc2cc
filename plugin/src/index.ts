// plugin/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { HubConnection } from "./connection.js";
import { emitChannelNotification } from "./channel.js";
import { createTools } from "./tools.js";
import { watchSession } from "./session-watcher.js";
import type { Message } from "@cc2cc/shared";
import {
  MessageType,
  SendMessageInputSchema,
  BroadcastInputSchema,
  GetMessagesInputSchema,
  SetRoleInputSchema,
  SubscribeTopicInputSchema,
  UnsubscribeTopicInputSchema,
  PublishTopicInputSchema,
  CreateScheduleInputSchema,
  UpdateScheduleInputSchema,
} from "@cc2cc/shared";

// ── Main ─────────────────────────────────────────────────────────────────────
// All top-level awaits are moved inside main() so that loadConfig() is called
// within the function body, not at module evaluation time (ARC-014).
// Graceful-shutdown handlers are set up inside main() as well, with module-level
// closures so SIGINT/SIGTERM can reference the live conn/unwatchSession values.

// These are initialised inside main() and referenced by the signal handlers below.
let _conn: HubConnection | undefined;
let _unwatchSession: (() => void) | undefined;

function shutdown(): never {
  _unwatchSession?.();
  _conn?.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main(): Promise<void> {
  // ── Boot ──────────────────────────────────────────────────────────────────
  const config = await loadConfig();

  // ── MCP Server ────────────────────────────────────────────────────────────

  const mcp = new Server(
    { name: "cc2cc", version: "0.1.0" },
    {
      capabilities: {
        /**
         * claude/channel: Claude Code-specific capability.
         * Enables notifications/claude/channel push, rendered as <channel> XML tags.
         * Requires Claude Code v2.1.80+ and --dangerously-load-development-channels.
         */
        experimental: { "claude/channel": {} },
        /** tools: standard MCP capability for outbound tool calls */
        tools: {},
      },
      instructions: `
You are connected to the cc2cc hub as instance ${config.instanceId}.
(Note: this instance ID may change during the session if /clear is invoked.)

Messages from other Claude instances arrive as <channel> tags with attributes:
  source="cc2cc"  from="<instanceId>"  type="<task|result|question|ack|ping>"
  message_id="<uuid>"  reply_to="<uuid or empty>"

Refer to the cc2cc skill for the full collaboration protocol.
Always check reply_to when receiving results to match them to outstanding tasks.
      `.trim(),
    },
  );

  // ── Hub Connection ─────────────────────────────────────────────────────────

  let conn = new HubConnection(config.wsUrl);
  let tools = createTools(config, conn);

  /** Wire message and error handlers onto a HubConnection instance. */
  function wireConnHandlers(c: HubConnection): void {
    // Auto-subscribe to the project topic on every connect (idempotent — hub also
    // does this server-side, but sending the frame ourselves ensures the subscription
    // is confirmed without requiring the agent to call subscribe_topic manually).
    c.on("open", () => {
      c.request("subscribe_topic", { topic: config.project }).catch((err: Error) => {
        process.stderr.write(`[cc2cc] auto-subscribe to project topic failed: ${err.message}\n`);
      });
    });

    // Route inbound hub WS messages to channel notifications
    c.on("message", async (data: unknown) => {
      try {
        // Only forward message envelopes (hub also sends ack frames for tool requests)
        const frame = data as { messageId?: string } & Message;
        if (frame.messageId && frame.from && frame.content) {
          await emitChannelNotification(mcp, frame as Message);
        }
      } catch (err) {
        process.stderr.write(
          `[cc2cc] channel notification error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });

    c.on("error", (err: Error) => {
      // Log to stderr — never to stdout (stdio is the MCP transport)
      process.stderr.write(`[cc2cc] hub connection error: ${err.message}\n`);
    });
  }

  wireConnHandlers(conn);

  // ── Session File Watcher ──────────────────────────────────────────────────

  // Extracted to session-watcher.ts — watches for /clear events and migrates the session.
  const state = { conn, tools };
  const unwatchSession = watchSession(config, state, {
    onReconnect: (newState, _oldConn) => {
      // After session-watcher replaces conn/tools, re-wire handlers on the new conn
      wireConnHandlers(newState.conn);
      // Keep module-level references in sync
      conn = newState.conn;
      tools = newState.tools;
      // Keep shutdown handler references in sync
      _conn = newState.conn;
    },
  });

  // Expose to shutdown handlers
  _conn = conn;
  _unwatchSession = unwatchSession;

  // ── Tool Definitions (ListTools) ───────────────────────────────────────────

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_instances",
        description:
          "List all cc2cc instances (online and offline) with their status and queue depth.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "send_message",
        description:
          "Send a typed message to a specific Claude instance. " +
          "If the target is offline the message is queued and warning is set.",
        inputSchema: {
          type: "object",
          required: ["to", "type", "content"],
          properties: {
            to: { type: "string", description: "Target instance ID" },
            type: {
              type: "string",
              enum: Object.values(MessageType),
              description: "Message type",
            },
            content: { type: "string", description: "Message content" },
            replyToMessageId: {
              type: "string",
              description: "messageId this reply correlates to",
              nullable: true,
            },
            metadata: {
              type: "object",
              description: "Optional metadata key-value pairs",
              nullable: true,
            },
          },
        },
      },
      {
        name: "broadcast",
        description:
          "Fire-and-forget broadcast to all online instances except self. " +
          "Rate-limited to one per 5 seconds. Returns delivered count.",
        inputSchema: {
          type: "object",
          required: ["type", "content"],
          properties: {
            type: { type: "string", enum: Object.values(MessageType) },
            content: { type: "string" },
            metadata: { type: "object", nullable: true },
          },
        },
      },
      {
        name: "get_messages",
        description:
          "Destructive pull: LPOP up to `limit` messages from own queue (default 10). " +
          "Use as polling fallback only — live delivery is via channel notifications.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Max messages to return (1–100)",
              default: 10,
            },
          },
          required: [],
        },
      },
      {
        name: "ping",
        description: "Check liveness of a target instance. Returns { online, latency? }.",
        inputSchema: {
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string", description: "Target instance ID to ping" },
          },
        },
      },
      {
        name: "set_role",
        description:
          "Declare your role on the team (e.g. 'cc2cc/backend-reviewer'). Call early in session. Re-call if focus shifts.",
        inputSchema: {
          type: "object",
          required: ["role"],
          properties: {
            role: { type: "string", description: "Role label for this instance" },
          },
        },
      },
      {
        name: "subscribe_topic",
        description:
          "Subscribe to a named pub/sub topic. You cannot unsubscribe from your auto-joined project topic.",
        inputSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string", description: "Topic name to subscribe to" },
          },
        },
      },
      {
        name: "unsubscribe_topic",
        description: "Unsubscribe from a topic. Will fail if it's your auto-joined project topic.",
        inputSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string", description: "Topic name to unsubscribe from" },
          },
        },
      },
      {
        name: "list_topics",
        description: "List all available topics with subscriber counts.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "publish_topic",
        description:
          "Publish a message to a topic. Set persistent=true for task assignments so offline subscribers receive it.",
        inputSchema: {
          type: "object",
          required: ["topic", "type", "content"],
          properties: {
            topic: { type: "string", description: "Topic name to publish to" },
            type: {
              type: "string",
              enum: Object.values(MessageType),
              description: "Message type",
            },
            content: { type: "string", description: "Message content" },
            persistent: {
              type: "boolean",
              description: "Queue for offline subscribers (default false)",
              default: false,
            },
            metadata: {
              type: "object",
              description: "Optional metadata key-value pairs",
              nullable: true,
            },
          },
        },
      },
      {
        name: "create_schedule",
        description:
          "Create a scheduled message delivery. The expression field supports cron syntax " +
          "(e.g. '*/5 * * * *') and simple interval syntax (e.g. '30s', '5m', '2h'). " +
          "The target can be an instanceId, 'broadcast', or 'topic:<name>'.",
        inputSchema: {
          type: "object",
          required: ["name", "expression", "target", "messageType", "content"],
          properties: {
            name: { type: "string", description: "Human-readable schedule name" },
            expression: {
              type: "string",
              description: "Cron expression (e.g. '0 9 * * 1') or interval (e.g. '5m', '1h')",
            },
            target: {
              type: "string",
              description: "Delivery target: instanceId, 'broadcast', or 'topic:<name>'",
            },
            messageType: {
              type: "string",
              enum: Object.values(MessageType),
              description: "Message type for the scheduled delivery",
            },
            content: { type: "string", description: "Message content to deliver" },
            persistent: {
              type: "boolean",
              description: "Queue for offline targets (default false)",
              default: false,
            },
            metadata: {
              type: "object",
              description: "Optional metadata key-value pairs",
              nullable: true,
            },
            maxFireCount: {
              type: "number",
              description: "Maximum number of times to fire before auto-disabling",
              nullable: true,
            },
            expiresAt: {
              type: "string",
              description: "ISO 8601 datetime after which the schedule auto-disables",
              nullable: true,
            },
          },
        },
      },
      {
        name: "list_schedules",
        description: "List all active schedules.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_schedule",
        description: "Retrieve a schedule by its ID.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: {
            scheduleId: { type: "string", description: "UUID of the schedule to retrieve" },
          },
        },
      },
      {
        name: "update_schedule",
        description: "Update fields on an existing schedule. Only provided fields are changed.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: {
            scheduleId: { type: "string", description: "UUID of the schedule to update" },
            name: { type: "string", description: "New schedule name", nullable: true },
            expression: {
              type: "string",
              description: "New cron or interval expression",
              nullable: true,
            },
            target: { type: "string", description: "New delivery target", nullable: true },
            messageType: {
              type: "string",
              enum: Object.values(MessageType),
              description: "New message type",
              nullable: true,
            },
            content: { type: "string", description: "New message content", nullable: true },
            persistent: { type: "boolean", description: "Update persistence flag", nullable: true },
            metadata: { type: "object", description: "New metadata", nullable: true },
            maxFireCount: {
              type: "number",
              description: "New max fire count (null to clear)",
              nullable: true,
            },
            expiresAt: {
              type: "string",
              description: "New expiry datetime (null to clear)",
              nullable: true,
            },
            enabled: {
              type: "boolean",
              description: "Enable or disable the schedule",
              nullable: true,
            },
          },
        },
      },
      {
        name: "delete_schedule",
        description: "Permanently delete a schedule by its ID.",
        inputSchema: {
          type: "object",
          required: ["scheduleId"],
          properties: {
            scheduleId: { type: "string", description: "UUID of the schedule to delete" },
          },
        },
      },
    ],
  }));

  // ── Tool Dispatch (CallTool) ────────────────────────────────────────────────

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      switch (name) {
        case "list_instances": {
          const instances = await tools.list_instances({});
          return {
            content: [{ type: "text", text: JSON.stringify(instances, null, 2) }],
          };
        }

        case "send_message": {
          const input = SendMessageInputSchema.parse(args);

          const result = await tools.send_message(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "broadcast": {
          const input = BroadcastInputSchema.parse(args);

          const result = await tools.broadcast(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_messages": {
          const input = GetMessagesInputSchema.parse(args);

          const messages = await tools.get_messages(input);
          return {
            content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
          };
        }

        case "ping": {
          const input = z.object({ to: z.string() }).parse(args);
          const result = await tools.ping(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "set_role": {
          const input = SetRoleInputSchema.parse(args);
          const result = await tools.set_role(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "subscribe_topic": {
          const input = SubscribeTopicInputSchema.parse(args);
          const result = await tools.subscribe_topic(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "unsubscribe_topic": {
          const input = UnsubscribeTopicInputSchema.parse(args);
          const result = await tools.unsubscribe_topic(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "list_topics": {
          const topics = await tools.list_topics({});
          return {
            content: [{ type: "text", text: JSON.stringify(topics, null, 2) }],
          };
        }

        case "publish_topic": {
          const input = PublishTopicInputSchema.parse(args);
          const result = await tools.publish_topic(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "create_schedule": {
          const input = CreateScheduleInputSchema.parse(args);
          const result = await tools.create_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_schedules": {
          const result = await tools.list_schedules({});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_schedule": {
          const input = z.object({ scheduleId: z.string() }).parse(args);
          const result = await tools.get_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_schedule": {
          const input = z
            .object({ scheduleId: z.string() })
            .and(UpdateScheduleInputSchema)
            .parse(args);
          const result = await tools.update_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_schedule": {
          const input = z.object({ scheduleId: z.string() }).parse(args);
          const result = await tools.delete_schedule(input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  // ── Connect and Start ───────────────────────────────────────────────────────

  conn.connect();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[cc2cc] fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
