// packages/shared/src/types.ts

/**
 * Parse the bare project segment from a cc2cc instanceId.
 * Format: `username@host:project/session_uuid`
 * Returns the `project` segment, or the full `instanceId` if it cannot be parsed.
 */
export function parseProject(instanceId: string): string {
	const colonPart = instanceId.split(":")[1] ?? "";
	return colonPart.split("/")[0] ?? instanceId;
}

/**
 * Valid message type labels.
 *
 * These are the values for `Message.type`. Note that `"broadcast"` is NOT a
 * MessageType — broadcast routing is determined by `Message.to === "broadcast"`,
 * not by a dedicated type value.
 */

/**
 * Derive the HTTP base URL from a WebSocket hub URL.
 * ws://host:port  → http://host:port
 * wss://host:port → https://host:port
 */
export function toHttpUrl(hubUrl: string): string {
	return hubUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

export enum MessageType {
	task = "task",
	result = "result",
	question = "question",
	ack = "ack",
	ping = "ping",
	// Note: 'broadcast' is NOT a MessageType value.
	// Broadcast routing is determined by to === 'broadcast' in the Message envelope.
	// The broadcast() MCP tool sends messages with a standard type (e.g. task).
}

export type InstanceStatus = "online" | "offline";

/** Fully-qualified instance identifier: username@host:project/session_uuid */
export type InstanceId = string;

/**
 * A single message envelope routed by the hub.
 *
 * `from` is always server-stamped — the hub ignores any client-supplied value.
 * `to` accepts a full instance ID, the sentinel `"broadcast"` for fan-out to
 * all online instances, or `"topic:<name>"` for topic routing.
 */
export interface Message {
	messageId: string; // UUIDv4
	from: InstanceId; // server-stamped by hub; client-supplied value ignored
	to: InstanceId | "broadcast" | `topic:${string}`; // recipient instanceId, 'broadcast' for fan-out, or 'topic:<name>' for topic routing
	type: MessageType;
	content: string;
	topicName?: string; // set when message was delivered via a topic
	replyToMessageId?: string; // correlates result/ack back to originating task/question
	metadata?: Record<string, unknown>;
	timestamp: string; // ISO 8601
}

/**
 * Snapshot of a registered plugin instance, as returned by the registry
 * and the `list_instances` MCP tool.
 *
 * `connectedAt` reflects the most recent connection time.
 * `queueDepth` is an approximate count — may lag by one flush cycle.
 */
export interface InstanceInfo {
	instanceId: InstanceId;
	project: string;
	status: InstanceStatus;
	connectedAt: string; // ISO 8601; last connection time
	queueDepth: number;
	role?: string; // optional role label for this instance
}

/**
 * Metadata for a named pub/sub topic, as returned by `list_topics`.
 */
export interface TopicInfo {
	name: string;
	createdAt: string; // ISO 8601
	createdBy: string; // instanceId
	subscriberCount: number;
}
