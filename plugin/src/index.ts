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
} from "@cc2cc/shared";

// ── Boot ────────────────────────────────────────────────────────────────────

const config = await loadConfig();

// ── MCP Server ──────────────────────────────────────────────────────────────

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

// ── Hub Connection ───────────────────────────────────────────────────────────

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
      process.stderr.write(`[cc2cc] channel notification error: ${(err as Error).message}\n`);
    }
  });

  c.on("error", (err: Error) => {
    // Log to stderr — never to stdout (stdio is the MCP transport)
    process.stderr.write(`[cc2cc] hub connection error: ${err.message}\n`);
  });
}

wireConnHandlers(conn);

// ── Session File Watcher ────────────────────────────────────────────────────

// Extracted to session-watcher.ts — watches for /clear events and migrates the session.
const state = { conn, tools };
const unwatchSession = watchSession(config, state, {
  onReconnect: (newState, _oldConn) => {
    // After session-watcher replaces conn/tools, re-wire handlers on the new conn
    wireConnHandlers(newState.conn);
    // Keep module-level references in sync
    conn = newState.conn;
    tools = newState.tools;
  },
});

// ── Tool Definitions (ListTools) ─────────────────────────────────────────────

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
  ],
}));

// ── Tool Dispatch (CallTool) ──────────────────────────────────────────────────

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

// ── Connect and Start ─────────────────────────────────────────────────────────

// Graceful shutdown — registered before connect so they fire even if connect throws
process.on("SIGINT", () => {
  unwatchSession();
  conn.destroy();
  process.exit(0);
});
process.on("SIGTERM", () => {
  unwatchSession();
  conn.destroy();
  process.exit(0);
});

async function main(): Promise<void> {
  conn.connect();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[cc2cc] fatal startup error: ${(err as Error).message}\n`);
  process.exit(1);
});
