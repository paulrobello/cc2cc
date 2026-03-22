// packages/shared/tests/types.test.ts
import { describe, it, expect } from "bun:test";
import type { Message, InstanceInfo } from "../src/types.js";
import { MessageType } from "../src/types.js";

describe("MessageType enum", () => {
	it("has the required values", () => {
		expect(MessageType.task as string).toBe("task");
		expect(MessageType.result as string).toBe("result");
		expect(MessageType.question as string).toBe("question");
		expect(MessageType.ack as string).toBe("ack");
		expect(MessageType.ping as string).toBe("ping");
	});

	it("does not include broadcast as a type value", () => {
		expect(
			(MessageType as Record<string, string>)["broadcast"],
		).toBeUndefined();
	});
});

describe("Message interface", () => {
	it("accepts a valid full message", () => {
		const msg: Message = {
			messageId: "550e8400-e29b-41d4-a716-446655440000",
			from: "paul@macbook:cc2cc/abc123",
			to: "alice@server:api/def456",
			type: MessageType.task,
			content: "Review the auth module",
			replyToMessageId: undefined,
			metadata: { priority: "high" },
			timestamp: new Date().toISOString(),
		};
		expect(msg.type as string).toBe("task");
		expect(msg.replyToMessageId).toBeUndefined();
	});

	it("accepts broadcast routing in the to field", () => {
		const msg: Message = {
			messageId: "550e8400-e29b-41d4-a716-446655440001",
			from: "paul@macbook:cc2cc/abc123",
			to: "broadcast",
			type: MessageType.task,
			content: "Starting auth refactor — avoid src/auth/",
			timestamp: new Date().toISOString(),
		};
		expect(msg.to).toBe("broadcast");
	});
});

describe("InstanceInfo interface", () => {
	it("accepts a valid instance", () => {
		const inst: InstanceInfo = {
			instanceId: "paul@macbook:cc2cc/abc123",
			project: "cc2cc",
			status: "online",
			connectedAt: new Date().toISOString(),
			queueDepth: 0,
		};
		expect(inst.status).toBe("online");
	});
});
