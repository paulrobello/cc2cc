// plugin/src/tools.ts
import type { InstanceInfo, Message, MessageType } from "@cc2cc/shared";
import type { PluginConfig } from "./config.js";
import type { HubConnection } from "./connection.js";

// ── Tool input types ─────────────────────────────────────────────────────────

export interface SendMessageInput {
  to: string;
  type: MessageType;
  content: string;
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface BroadcastInput {
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface GetMessagesInput {
  limit?: number;
}

export interface PingInput {
  to: string;
}

// ── Tool output types ────────────────────────────────────────────────────────

export interface SendMessageResult {
  messageId: string;
  queued: boolean;
  warning?: string;
}

export interface BroadcastResult {
  delivered: number;
}

export interface PingResult {
  online: boolean;
  latency?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the HTTP base URL from a WebSocket hub URL.
 * ws://host:port  → http://host:port
 * wss://host:port → https://host:port
 */
function toHttpUrl(hubUrl: string): string {
  return hubUrl.replace(/^wss?:\/\//, (match) => (match === "wss://" ? "https://" : "http://"));
}

// ── Tool factory ─────────────────────────────────────────────────────────────

/**
 * Create the MCP tool handler functions bound to a given plugin config and WS connection.
 *
 * Identity-dependent operations (send_message, broadcast, get_messages) use the
 * WebSocket connection via `conn.request()` — the hub stamps `from` from the WS
 * identity so no explicit `from` field is needed.
 *
 * Stateless operations (list_instances, ping) use REST for simplicity.
 *
 * @param config - Plugin configuration containing hubUrl and apiKey
 * @param conn   - Live HubConnection for WS-based tool calls
 */
export function createTools(config: Pick<PluginConfig, "hubUrl" | "apiKey">, conn: HubConnection) {
  const httpHubUrl = toHttpUrl(config.hubUrl);
  const { apiKey } = config;

  return {
    /**
     * list_instances — returns all known instances (online and offline).
     * GET /api/instances?key=<apiKey>
     */
    async list_instances(_input: Record<string, never>): Promise<InstanceInfo[]> {
      const res = await fetch(`${httpHubUrl}/api/instances?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) {
        throw new Error(`list_instances failed: ${res.status} ${res.statusText}`);
      }
      return res.json() as Promise<InstanceInfo[]>;
    },

    /**
     * send_message — send a typed message to a specific instance via WS.
     * Uses conn.request("send_message", ...) so the hub stamps `from` from WS identity.
     */
    async send_message(input: SendMessageInput): Promise<SendMessageResult> {
      const payload: Record<string, unknown> = {
        to: input.to,
        type: input.type,
        content: input.content,
      };
      if (input.replyToMessageId !== undefined) {
        payload.replyToMessageId = input.replyToMessageId;
      }
      if (input.metadata !== undefined) {
        payload.metadata = input.metadata;
      }

      const response = await conn.request<SendMessageResult & { requestId: string }>(
        "send_message",
        payload,
      );
      // Strip requestId before returning to caller
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * broadcast — fire-and-forget to all online instances except self via WS.
     * Uses conn.request("broadcast", ...) so the hub stamps `from` from WS identity.
     */
    async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
      const payload: Record<string, unknown> = {
        type: input.type,
        content: input.content,
      };
      if (input.metadata !== undefined) {
        payload.metadata = input.metadata;
      }

      const response = await conn.request<BroadcastResult & { requestId: string }>(
        "broadcast",
        payload,
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * get_messages — destructive pull from own queue via WS.
     * Uses conn.request("get_messages", ...) so the hub knows which queue to pull from.
     */
    async get_messages(input: GetMessagesInput): Promise<Message[]> {
      const limit = input.limit ?? 10;
      const response = await conn.request<{ messages: Message[]; requestId: string }>(
        "get_messages",
        { limit },
      );
      return response.messages;
    },

    /**
     * ping — check liveness of a target instance.
     * GET /api/ping/<targetId>?key=<apiKey>
     */
    async ping(input: PingInput): Promise<PingResult> {
      const res = await fetch(
        `${httpHubUrl}/api/ping/${encodeURIComponent(input.to)}?key=${encodeURIComponent(apiKey)}`,
      );
      if (!res.ok) {
        throw new Error(`ping failed: ${res.status} ${res.statusText}`);
      }
      return res.json() as Promise<PingResult>;
    },
  };
}

export type PluginTools = ReturnType<typeof createTools>;
