// packages/shared/src/events.ts
import { z } from "zod";
import { MessageSchema } from "./schema.js";

const InstanceJoinedEventSchema = z.object({
	event: z.literal("instance:joined"),
	instanceId: z.string().min(1),
	timestamp: z.string().datetime(),
});

const InstanceLeftEventSchema = z.object({
	event: z.literal("instance:left"),
	instanceId: z.string().min(1),
	timestamp: z.string().datetime(),
});

const MessageSentEventSchema = z.object({
	event: z.literal("message:sent"),
	message: MessageSchema,
	timestamp: z.string().datetime(),
});

const BroadcastSentEventSchema = z.object({
	event: z.literal("broadcast:sent"),
	from: z.string().min(1),
	content: z.string().min(1),
	timestamp: z.string().datetime(),
});

const QueueStatsEventSchema = z.object({
	event: z.literal("queue:stats"),
	instanceId: z.string().min(1),
	depth: z.number().int().min(0),
	timestamp: z.string().datetime(),
});

const InstanceSessionUpdatedEventSchema = z.object({
	event: z.literal("instance:session_updated"),
	oldInstanceId: z.string().min(1),
	newInstanceId: z.string().min(1),
	migrated: z.number().int().min(0),
	timestamp: z.string().datetime(),
});

const InstanceRemovedEventSchema = z.object({
	event: z.literal("instance:removed"),
	instanceId: z.string().min(1),
	timestamp: z.string().datetime(),
});

const TopicCreatedEventSchema = z.object({
	event: z.literal("topic:created"),
	name: z.string().min(1),
	createdBy: z.string().min(1),
	timestamp: z.string().datetime(),
});

const TopicDeletedEventSchema = z.object({
	event: z.literal("topic:deleted"),
	name: z.string().min(1),
	timestamp: z.string().datetime(),
});

const TopicSubscribedEventSchema = z.object({
	event: z.literal("topic:subscribed"),
	name: z.string().min(1),
	instanceId: z.string().min(1),
	timestamp: z.string().datetime(),
});

const TopicUnsubscribedEventSchema = z.object({
	event: z.literal("topic:unsubscribed"),
	name: z.string().min(1),
	instanceId: z.string().min(1),
	timestamp: z.string().datetime(),
});

const TopicMessageEventSchema = z.object({
	event: z.literal("topic:message"),
	name: z.string().min(1),
	message: MessageSchema,
	persistent: z.boolean(),
	delivered: z.number().int().min(0),
	queued: z.number().int().min(0),
	timestamp: z.string().datetime(),
});

const InstanceRoleUpdatedEventSchema = z.object({
	event: z.literal("instance:role_updated"),
	instanceId: z.string().min(1),
	role: z.string().min(1),
	timestamp: z.string().datetime(),
});

/** Discriminated union of all events the hub emits to WebSocket clients */
export const HubEventSchema = z.discriminatedUnion("event", [
	InstanceJoinedEventSchema,
	InstanceLeftEventSchema,
	MessageSentEventSchema,
	BroadcastSentEventSchema,
	QueueStatsEventSchema,
	InstanceSessionUpdatedEventSchema,
	InstanceRemovedEventSchema,
	TopicCreatedEventSchema,
	TopicDeletedEventSchema,
	TopicSubscribedEventSchema,
	TopicUnsubscribedEventSchema,
	TopicMessageEventSchema,
	InstanceRoleUpdatedEventSchema,
]);

export type HubEvent = z.infer<typeof HubEventSchema>;
export type InstanceJoinedEvent = z.infer<typeof InstanceJoinedEventSchema>;
export type InstanceLeftEvent = z.infer<typeof InstanceLeftEventSchema>;
export type MessageSentEvent = z.infer<typeof MessageSentEventSchema>;
export type BroadcastSentEvent = z.infer<typeof BroadcastSentEventSchema>;
export type QueueStatsEvent = z.infer<typeof QueueStatsEventSchema>;
export type InstanceSessionUpdatedEvent = z.infer<
	typeof InstanceSessionUpdatedEventSchema
>;
export type InstanceRemovedEvent = z.infer<typeof InstanceRemovedEventSchema>;
export type TopicCreatedEvent = z.infer<typeof TopicCreatedEventSchema>;
export type TopicDeletedEvent = z.infer<typeof TopicDeletedEventSchema>;
export type TopicSubscribedEvent = z.infer<typeof TopicSubscribedEventSchema>;
export type TopicUnsubscribedEvent = z.infer<
	typeof TopicUnsubscribedEventSchema
>;
export type TopicMessageEvent = z.infer<typeof TopicMessageEventSchema>;
export type InstanceRoleUpdatedEvent = z.infer<
	typeof InstanceRoleUpdatedEventSchema
>;
