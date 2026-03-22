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
	to: InstanceId | "broadcast"; // recipient instanceId or 'broadcast' for fan-out
	type: MessageType;
	content: string;
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
}
