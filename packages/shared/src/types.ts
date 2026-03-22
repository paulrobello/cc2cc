// packages/shared/src/types.ts

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

export interface InstanceInfo {
	instanceId: InstanceId;
	project: string;
	status: InstanceStatus;
	connectedAt: string; // ISO 8601; last connection time
	queueDepth: number;
	role?: string; // optional role label for this instance
}

export interface TopicInfo {
	name: string;
	createdAt: string; // ISO 8601
	createdBy: string; // instanceId
	subscriberCount: number;
}
