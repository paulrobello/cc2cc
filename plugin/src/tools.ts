// plugin/src/tools.ts
import type { InstanceInfo, Message, MessageType, TopicInfo } from "@cc2cc/shared";
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

/** Result for a direct send_message (single recipient). */
export interface SendMessageDirectResult {
  messageId: string;
  queued: boolean;
  warning?: string;
}

/** Result for a role-routed send_message (to: "role:<name>"). */
export interface SendMessageRoleResult {
  role: string;
  recipients: string[];
  delivered: number;
  queued: number;
  warning?: string;
}

export type SendMessageResult = SendMessageDirectResult | SendMessageRoleResult;

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

    /**
     * set_role — declare this instance's role on the team.
     * Uses conn.request("set_role", ...) so the hub stamps identity from WS connection.
     */
    async set_role(input: { role: string }): Promise<{ instanceId: string; role: string }> {
      const response = await conn.request<{ requestId: string; instanceId: string; role: string }>(
        "set_role",
        { role: input.role },
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * subscribe_topic — subscribe to a named pub/sub topic.
     * Uses conn.request("subscribe_topic", ...) for WS-based identity.
     */
    async subscribe_topic(input: { topic: string }): Promise<{ topic: string; subscribed: true }> {
      const response = await conn.request<{ requestId: string; topic: string; subscribed: true }>(
        "subscribe_topic",
        { topic: input.topic },
      );
      const { requestId: _, ...result } = response;
      return result;
    },

    /**
     * unsubscribe_topic — unsubscribe from a topic (fails for auto-joined project topic).
     * Uses conn.request("unsubscribe_topic", ...) for WS-based identity.
     */
    async unsubscribe_topic(input: {
      topic: string;
    }): Promise<{ topic: string; unsubscribed: true }> {
      const response = await conn.request<
        | { requestId: string; topic: string; unsubscribed: true }
        | { requestId: string; error: string }
      >("unsubscribe_topic", { topic: input.topic });
      if ("error" in response) throw new Error(response.error);
      const { requestId: _, ...result } = response as {
        requestId: string;
        topic: string;
        unsubscribed: true;
      };
      return result;
    },

    /**
     * list_topics — list all available topics with subscriber counts.
     * GET /api/topics?key=<apiKey>
     */
    async list_topics(_input: Record<string, never>): Promise<TopicInfo[]> {
      const res = await fetch(`${httpHubUrl}/api/topics?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) throw new Error(`list_topics failed: ${res.status} ${res.statusText}`);
      return res.json() as Promise<TopicInfo[]>;
    },

    /**
     * publish_topic — publish a message to a topic.
     * Uses conn.request("publish_topic", ...) so the hub stamps `from` from WS identity.
     */
    async publish_topic(input: {
      topic: string;
      type: MessageType;
      content: string;
      persistent?: boolean;
      metadata?: Record<string, unknown>;
    }): Promise<{ delivered: number; queued: number }> {
      const payload: Record<string, unknown> = {
        topic: input.topic,
        type: input.type,
        content: input.content,
        persistent: input.persistent ?? false,
      };
      if (input.metadata !== undefined) payload.metadata = input.metadata;
      const response = await conn.request<{
        requestId: string;
        delivered: number;
        queued: number;
      }>("publish_topic", payload);
      const { requestId: _, ...result } = response;
      return result;
    },
  };
}

export type PluginTools = ReturnType<typeof createTools>;
