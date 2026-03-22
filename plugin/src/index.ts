// plugin/src/index.ts
import fs from "node:fs";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { buildInstanceId, buildWsUrl, loadConfig } from "./config.js";
import { HubConnection } from "./connection.js";
import { emitChannelNotification } from "./channel.js";
import { createTools } from "./tools.js";
import type { Message } from "@cc2cc/shared";
import {
  MessageType,
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

let conn = new HubConnection(config.wsUrl, config.apiKey);
let tools = createTools(config, conn);

/** Wire message and error handlers onto a HubConnection instance. */
function wireConnHandlers(c: HubConnection): void {
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

let currentSessionId = config.sessionId;

const sessionFile = path.join(process.cwd(), ".claude", ".cc2cc-session-id");

// Watch for session ID changes (fires on /clear in Claude Code)
// fs.watchFile uses polling and tolerates non-existent files, so the watcher
// is always active even when the session file doesn't exist at startup.
let sessionWatcherActive = false;
fs.watchFile(sessionFile, { interval: 2000, persistent: false }, async () => {
  if (sessionWatcherActive) return; // debounce
  sessionWatcherActive = true;
  try {
    const newSessionId = fs.readFileSync(sessionFile, "utf-8").trim();
    if (!newSessionId || newSessionId === currentSessionId) return;

    const newInstanceId = buildInstanceId(config, newSessionId);

    // Notify hub: migrate queue and re-register
    await conn.request("session_update", { newInstanceId });

    // Update config in-place so tools use the new identity
    const oldInstanceId = config.instanceId;
    config.instanceId = newInstanceId;
    config.wsUrl = buildWsUrl(config.hubUrl, config.apiKey, newInstanceId);
    config.sessionId = newSessionId;
    currentSessionId = newSessionId;

    process.stderr.write(`[cc2cc] session updated: ${oldInstanceId} → ${newInstanceId}\n`);

    // Reconnect with new identity
    const oldConn = conn;
    conn = new HubConnection(config.wsUrl, config.apiKey);
    wireConnHandlers(conn);
    tools = createTools(config, conn);
    conn.connect();
    oldConn.destroy();
  } catch (err) {
    process.stderr.write(`[cc2cc] session update error: ${(err as Error).message}\n`);
  } finally {
    sessionWatcherActive = false;
  }
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
        const input = z
          .object({
            to: z.string(),
            type: z.nativeEnum(MessageType),
            content: z.string(),
            replyToMessageId: z.string().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(args);

        const result = await tools.send_message(input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "broadcast": {
        const input = z
          .object({
            type: z.nativeEnum(MessageType),
            content: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(args);

        const result = await tools.broadcast(input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_messages": {
        const input = z
          .object({
            limit: z.number().int().min(1).max(100).default(10),
          })
          .parse(args);

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

conn.connect();

const transport = new StdioServerTransport();
await mcp.connect(transport);

// Graceful shutdown
process.on("SIGINT", () => {
  conn.destroy();
  process.exit(0);
});
process.on("SIGTERM", () => {
  conn.destroy();
  process.exit(0);
});
