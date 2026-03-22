// packages/shared/src/schema.ts
import { z } from "zod";
import { MessageType } from "./types.js";

const MessageTypeSchema = z.nativeEnum(MessageType);

export const MessageSchema = z.object({
	messageId: z.string().uuid(),
	from: z.string().min(1),
	to: z.string().min(1), // instanceId or 'broadcast'
	type: MessageTypeSchema,
	content: z.string().min(1),
	replyToMessageId: z.string().uuid().optional(),
	metadata: z.record(z.unknown()).optional(),
	timestamp: z.string().datetime(),
});

export const InstanceInfoSchema = z.object({
	instanceId: z.string().min(1),
	project: z.string().min(1),
	status: z.enum(["online", "offline"]),
	connectedAt: z.string().datetime(),
	queueDepth: z.number().int().min(0),
});

/** Input schema for the send_message MCP tool */
export const SendMessageInputSchema = z.object({
	to: z.string().min(1),
	type: MessageTypeSchema,
	content: z.string().min(1),
	replyToMessageId: z.string().uuid().optional(),
	metadata: z.record(z.unknown()).optional(),
});

/** Input schema for the broadcast MCP tool */
export const BroadcastInputSchema = z.object({
	type: MessageTypeSchema,
	content: z.string().min(1),
	metadata: z.record(z.unknown()).optional(),
});

/** Input schema for the get_messages MCP tool */
export const GetMessagesInputSchema = z.object({
	limit: z.number().int().min(1).max(100).default(10),
});

/** Schema for the WS action frame the plugin sends to the hub when the session ID changes */
export const SessionUpdateActionSchema = z.object({
	action: z.literal("session_update"),
	newInstanceId: z.string().min(1),
	requestId: z.string().uuid(),
});

// Infer TypeScript types from schemas where needed
export type MessageInput = z.infer<typeof MessageSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;
export type GetMessagesInput = z.infer<typeof GetMessagesInputSchema>;
export type SessionUpdateAction = z.infer<typeof SessionUpdateActionSchema>;
