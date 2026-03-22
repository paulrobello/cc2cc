// dashboard/src/types/dashboard.ts
import type { Message, InstanceInfo, MessageType, TopicInfo } from "@cc2cc/shared";

/** Connection state driven by the WsProvider reconnect logic */
export type ConnectionState = "online" | "reconnecting" | "disconnected";

export interface TopicState extends TopicInfo {
  subscribers: string[];
}

/**
 * A message as it appears in the feed — enriches the base Message with
 * display metadata injected by WsProvider when the event arrives.
 */
export interface FeedMessage {
  /** Original message envelope from the hub */
  message: Message;
  /** Wall-clock time the dashboard received this event (for timeline display) */
  receivedAt: Date;
  /** True when this message was sent via the broadcast fan-out path */
  isBroadcast: boolean;
  /** Topic name if this message was delivered via a topic subscription */
  topicName?: string;
}

/** Live per-instance state maintained by WsProvider */
export interface InstanceState extends InstanceInfo {
  /** Last queue depth reported by queue:stats event */
  queueDepth: number;
}

/** Session-local counters accumulated by WsProvider for the Analytics view */
export interface SessionStats {
  /** Incremented on message:sent with type=task; decremented when matching result arrives */
  activeTasks: number;
  /** Incremented on any WebSocket connection error or 429-response event from the hub */
  errors: number;
  /** Pending task message IDs waiting for a matching result (keyed by messageId) */
  pendingTaskIds: Set<string>;
}

/** Full state shape exposed by WsContext */
export interface WsContextValue {
  connectionState: ConnectionState;
  /** All known instances (online + offline), keyed by instanceId */
  instances: Map<string, InstanceState>;
  /** Ordered list of feed messages (newest last), capped at MAX_FEED_SIZE */
  feed: FeedMessage[];
  /** Session-local counters */
  sessionStats: SessionStats;
  /** The dashboard's own registered instanceId (dashboard@host:dashboard/uuid) */
  dashboardInstanceId: string;
  /** All known topics, keyed by topic name */
  topics: Map<string, TopicState>;
  /** Send a direct message to a specific instance via the plugin WS. */
  sendMessage: (to: string, type: MessageType, content: string) => Promise<void>;
  /** Broadcast to all online instances via the plugin WS. */
  sendBroadcast: (type: MessageType, content: string) => Promise<void>;
  /** Publish a message to a topic via the hub REST API. */
  sendPublishTopic: (
    topic: string,
    type: MessageType,
    content: string,
    persistent: boolean,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
}

/** Shape returned by GET /api/stats */
export interface HubStats {
  messagesToday: number;
  activeInstances: number;
  queuedTotal: number;
}

/** Color token for each message type (Tailwind class fragments) */
export type MessageTypeColor =
  | "amber" // task
  | "green" // result
  | "blue" // question
  | "purple" // broadcast
  | "zinc"; // ack / ping (dim)
