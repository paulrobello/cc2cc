// packages/shared/tests/schema.test.ts
import { describe, it, expect } from "bun:test";
import {
	MessageSchema,
	SendMessageInputSchema,
	BroadcastInputSchema,
	InstanceInfoSchema,
	GetMessagesInputSchema,
	SessionUpdateActionSchema,
} from "../src/schema.js";

describe("MessageSchema", () => {
	it("parses a valid message", () => {
		const result = MessageSchema.safeParse({
			messageId: "550e8400-e29b-41d4-a716-446655440000",
			from: "paul@mac:cc2cc/abc",
			to: "alice@srv:api/def",
			type: "task",
			content: "Do the thing",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("rejects an invalid message type", () => {
		const result = MessageSchema.safeParse({
			messageId: "550e8400-e29b-41d4-a716-446655440000",
			from: "paul@mac:cc2cc/abc",
			to: "alice@srv:api/def",
			type: "broadcast", // not a valid MessageType value
			content: "test",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});

	it("allows to=broadcast", () => {
		const result = MessageSchema.safeParse({
			messageId: "550e8400-e29b-41d4-a716-446655440000",
			from: "paul@mac:cc2cc/abc",
			to: "broadcast",
			type: "task",
			content: "Fan-out message",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a message missing required fields", () => {
		const result = MessageSchema.safeParse({ from: "paul@mac:cc2cc/abc" });
		expect(result.success).toBe(false);
	});
});

describe("SendMessageInputSchema", () => {
	it("parses valid send_message input", () => {
		const result = SendMessageInputSchema.safeParse({
			to: "alice@srv:api/def",
			type: "task",
			content: "Do the thing",
		});
		expect(result.success).toBe(true);
	});

	it("accepts optional replyToMessageId", () => {
		const result = SendMessageInputSchema.safeParse({
			to: "alice@srv:api/def",
			type: "result",
			content: "Done",
			replyToMessageId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.replyToMessageId).toBeDefined();
	});
});

describe("BroadcastInputSchema", () => {
	it("parses valid broadcast input", () => {
		const result = BroadcastInputSchema.safeParse({
			type: "task",
			content: "Starting refactor",
		});
		expect(result.success).toBe(true);
	});
});

describe("InstanceInfoSchema", () => {
	it("parses a valid instance", () => {
		const result = InstanceInfoSchema.safeParse({
			instanceId: "paul@mac:cc2cc/abc",
			project: "cc2cc",
			status: "online",
			connectedAt: new Date().toISOString(),
			queueDepth: 0,
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid status", () => {
		const result = InstanceInfoSchema.safeParse({
			instanceId: "paul@mac:cc2cc/abc",
			project: "cc2cc",
			status: "unknown",
			connectedAt: new Date().toISOString(),
			queueDepth: 0,
		});
		expect(result.success).toBe(false);
	});
});

describe("GetMessagesInputSchema", () => {
	it("uses default limit of 10", () => {
		const result = GetMessagesInputSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.limit).toBe(10);
	});

	it("accepts limit at boundaries", () => {
		expect(GetMessagesInputSchema.safeParse({ limit: 1 }).success).toBe(true);
		expect(GetMessagesInputSchema.safeParse({ limit: 100 }).success).toBe(true);
	});

	it("rejects out-of-range limit", () => {
		expect(GetMessagesInputSchema.safeParse({ limit: 0 }).success).toBe(false);
		expect(GetMessagesInputSchema.safeParse({ limit: 101 }).success).toBe(
			false,
		);
	});
});

describe("SessionUpdateActionSchema", () => {
	it("parses a valid session_update action", () => {
		const result = SessionUpdateActionSchema.safeParse({
			action: "session_update",
			newInstanceId: "paul@mac:cc2cc/new-session-id",
			requestId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
	});

	it("rejects wrong action literal", () => {
		const result = SessionUpdateActionSchema.safeParse({
			action: "something_else",
			newInstanceId: "paul@mac:cc2cc/new-session-id",
			requestId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty newInstanceId", () => {
		const result = SessionUpdateActionSchema.safeParse({
			action: "session_update",
			newInstanceId: "",
			requestId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-UUID requestId", () => {
		const result = SessionUpdateActionSchema.safeParse({
			action: "session_update",
			newInstanceId: "paul@mac:cc2cc/new-session-id",
			requestId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing required fields", () => {
		const result = SessionUpdateActionSchema.safeParse({
			action: "session_update",
		});
		expect(result.success).toBe(false);
	});
});
