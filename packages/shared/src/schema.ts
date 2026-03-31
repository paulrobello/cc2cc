// packages/shared/src/schema.ts
import { z } from "zod";
import { MessageType } from "./types.js";

/** Internal schema for validating MessageType enum values via Zod. */
const MessageTypeSchema = z.nativeEnum(MessageType);

/** Zod schema for a full Message envelope as stored in Redis and sent over WebSocket. */
export const MessageSchema = z.object({
	messageId: z.string().uuid(),
	from: z.string().min(1).max(256),
	to: z.string().min(1).max(256), // instanceId, 'broadcast', or 'topic:<name>'
	type: MessageTypeSchema,
	content: z.string().min(1),
	topicName: z.string().max(64).optional(),
	replyToMessageId: z.string().uuid().optional(),
	metadata: z.record(z.unknown()).optional(),
	timestamp: z.string().datetime(),
});

/** Zod schema for an InstanceInfo record returned by the registry and list_instances tool. */
export const InstanceInfoSchema = z.object({
	instanceId: z.string().min(1),
	project: z.string().min(1),
	status: z.enum(["online", "offline"]),
	connectedAt: z.string().datetime(),
	queueDepth: z.number().int().min(0),
	role: z.string().optional(),
});

/**
 * Maximum content size for messages: 64 KiB.
 * Prevents oversized payloads from overwhelming Redis queues and WS frames.
 */
const MAX_CONTENT_BYTES = 65536;

/**
 * Shared metadata schema: limits keys to 32, values must be primitives only,
 * and total JSON representation must not exceed 4 KiB.
 */
const MetadataSchema = z
	.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
	.refine((v) => Object.keys(v).length <= 32, {
		message: "metadata must have at most 32 keys",
	})
	.refine((v) => JSON.stringify(v).length <= 4096, {
		message: "metadata must not exceed 4096 bytes when serialized",
	})
	.optional();

/** Input schema for the send_message MCP tool */
export const SendMessageInputSchema = z.object({
	to: z.string().min(1).max(256),
	type: MessageTypeSchema,
	content: z.string().min(1).max(MAX_CONTENT_BYTES),
	replyToMessageId: z.string().uuid().optional(),
	metadata: MetadataSchema,
});

/** Input schema for the broadcast MCP tool */
export const BroadcastInputSchema = z.object({
	type: MessageTypeSchema,
	content: z.string().min(1).max(MAX_CONTENT_BYTES),
	metadata: MetadataSchema,
});

/** Input schema for the get_messages MCP tool */
export const GetMessagesInputSchema = z.object({
	limit: z.number().int().min(1).max(100).default(10),
});

/**
 * Instance ID format: username@host:project/session
 * Allows alphanumeric, dots, underscores, hyphens. Project ≤64 chars, session ≤64 chars.
 *
 * Exported so hub/src/validation.ts and any other consumer can import the
 * single canonical pattern instead of maintaining independent copies.
 */
export const INSTANCE_ID_RE =
	/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]{1,64}\/[a-zA-Z0-9-]{1,64}$/;

/** @deprecated Use INSTANCE_ID_RE — kept as an internal alias so the Zod schema below compiles unchanged. */
const INSTANCE_ID_PATTERN = INSTANCE_ID_RE;

/** Schema for the WS action frame the plugin sends to the hub when the session ID changes */
export const SessionUpdateActionSchema = z.object({
	action: z.literal("session_update"),
	newInstanceId: z
		.string()
		.min(1)
		.regex(
			INSTANCE_ID_PATTERN,
			"newInstanceId must match format: username@host:project/session (alphanumeric, dots, underscores, hyphens; project and session ≤64 chars)",
		),
	requestId: z.string().uuid(),
});

/** Zod schema for a TopicInfo record returned by list_topics. */
export const TopicInfoSchema = z.object({
	name: z.string().min(1).max(64),
	createdAt: z.string().datetime(),
	createdBy: z.string().min(1).max(256),
	subscriberCount: z.number().int().min(0),
	autoExpire: z.boolean().optional(),
});

/** Input schema for the set_role MCP tool. */
export const SetRoleInputSchema = z.object({
	role: z.string().min(1).max(64),
});

/** Input schema for the subscribe_topic MCP tool. */
export const SubscribeTopicInputSchema = z.object({
	topic: z.string().min(1).max(64),
});

/** Input schema for the unsubscribe_topic MCP tool. */
export const UnsubscribeTopicInputSchema = z.object({
	topic: z.string().min(1).max(64),
});

/** Input schema for the publish_topic MCP tool. */
export const PublishTopicInputSchema = z.object({
	topic: z.string().min(1).max(64),
	type: MessageTypeSchema,
	content: z.string().min(1).max(MAX_CONTENT_BYTES),
	persistent: z.boolean().default(false),
	metadata: MetadataSchema,
});

/** Zod schema for a full Schedule object. */
export const ScheduleSchema = z.object({
	scheduleId: z.string().uuid(),
	name: z.string().min(1).max(100),
	expression: z.string().min(1).max(128),
	target: z.string().min(1).max(256),
	messageType: MessageTypeSchema,
	content: z.string().min(1).max(MAX_CONTENT_BYTES),
	metadata: MetadataSchema,
	persistent: z.boolean(),
	createdBy: z.string().min(1).max(256),
	createdAt: z.string().datetime(),
	nextFireAt: z.string().datetime(),
	lastFiredAt: z.string().datetime().optional(),
	fireCount: z.number().int().min(0),
	maxFireCount: z.number().int().min(1).optional(),
	expiresAt: z.string().datetime().optional(),
	enabled: z.boolean(),
});

/** Input schema for creating a new schedule. */
export const CreateScheduleInputSchema = z.object({
	name: z.string().min(1).max(100),
	expression: z.string().min(1).max(128),
	target: z.string().min(1).max(256),
	messageType: MessageTypeSchema,
	content: z.string().min(1).max(MAX_CONTENT_BYTES),
	persistent: z.boolean().default(false),
	metadata: MetadataSchema,
	maxFireCount: z.number().int().min(1).optional(),
	expiresAt: z.string().datetime().optional(),
});

/** Input schema for updating an existing schedule (all fields optional). */
export const UpdateScheduleInputSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	expression: z.string().min(1).max(128).optional(),
	target: z.string().min(1).max(256).optional(),
	messageType: MessageTypeSchema.optional(),
	content: z.string().min(1).max(MAX_CONTENT_BYTES).optional(),
	persistent: z.boolean().optional(),
	metadata: MetadataSchema,
	maxFireCount: z.number().int().min(1).nullable().optional(),
	expiresAt: z.string().datetime().nullable().optional(),
	enabled: z.boolean().optional(),
});

// Infer TypeScript types from schemas where needed
export type MessageInput = z.infer<typeof MessageSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;
export type GetMessagesInput = z.infer<typeof GetMessagesInputSchema>;
export type SessionUpdateAction = z.infer<typeof SessionUpdateActionSchema>;
export type TopicInfoInput = z.infer<typeof TopicInfoSchema>;
export type SetRoleInput = z.infer<typeof SetRoleInputSchema>;
export type SubscribeTopicInput = z.infer<typeof SubscribeTopicInputSchema>;
export type UnsubscribeTopicInput = z.infer<typeof UnsubscribeTopicInputSchema>;
export type PublishTopicInput = z.infer<typeof PublishTopicInputSchema>;
export type ScheduleData = z.infer<typeof ScheduleSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
