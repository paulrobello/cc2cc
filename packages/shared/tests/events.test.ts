// packages/shared/tests/events.test.ts
import { describe, it, expect } from "bun:test";
import { HubEventSchema } from "../src/events.js";

describe("HubEventSchema", () => {
	it("parses instance:joined event", () => {
		const result = HubEventSchema.safeParse({
			event: "instance:joined",
			instanceId: "paul@mac:cc2cc/abc",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses instance:left event", () => {
		const result = HubEventSchema.safeParse({
			event: "instance:left",
			instanceId: "paul@mac:cc2cc/abc",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses message:sent event", () => {
		const result = HubEventSchema.safeParse({
			event: "message:sent",
			message: {
				messageId: "550e8400-e29b-41d4-a716-446655440000",
				from: "paul@mac:cc2cc/abc",
				to: "alice@srv:api/def",
				type: "task",
				content: "Do the thing",
				timestamp: new Date().toISOString(),
			},
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses broadcast:sent event", () => {
		const result = HubEventSchema.safeParse({
			event: "broadcast:sent",
			from: "paul@mac:cc2cc/abc",
			content: "Starting refactor",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses queue:stats event", () => {
		const result = HubEventSchema.safeParse({
			event: "queue:stats",
			instanceId: "paul@mac:cc2cc/abc",
			depth: 5,
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses instance:session_updated event", () => {
		const result = HubEventSchema.safeParse({
			event: "instance:session_updated",
			oldInstanceId: "paul@mac:cc2cc/old-session",
			newInstanceId: "paul@mac:cc2cc/new-session",
			migrated: 3,
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("rejects instance:session_updated with empty instanceId", () => {
		const result = HubEventSchema.safeParse({
			event: "instance:session_updated",
			oldInstanceId: "",
			newInstanceId: "paul@mac:cc2cc/new-session",
			migrated: 0,
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});

	it("rejects instance:session_updated with negative migrated count", () => {
		const result = HubEventSchema.safeParse({
			event: "instance:session_updated",
			oldInstanceId: "paul@mac:cc2cc/old-session",
			newInstanceId: "paul@mac:cc2cc/new-session",
			migrated: -1,
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});

	it("rejects unknown event type", () => {
		const result = HubEventSchema.safeParse({
			event: "unknown:event",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});
});

describe("Schedule HubEvents", () => {
	it("parses schedule:created event", () => {
		const result = HubEventSchema.safeParse({
			event: "schedule:created",
			schedule: {
				scheduleId: "550e8400-e29b-41d4-a716-446655440000",
				name: "Test",
				expression: "*/5 * * * *",
				target: "broadcast",
				messageType: "task",
				content: "Hello",
				persistent: false,
				createdBy: "paul@mac:cc2cc/abc",
				createdAt: new Date().toISOString(),
				nextFireAt: new Date().toISOString(),
				fireCount: 0,
				enabled: true,
			},
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses schedule:updated event", () => {
		const result = HubEventSchema.safeParse({
			event: "schedule:updated",
			schedule: {
				scheduleId: "550e8400-e29b-41d4-a716-446655440000",
				name: "Updated",
				expression: "0 9 * * *",
				target: "topic:team",
				messageType: "ping",
				content: "Wake up",
				persistent: true,
				createdBy: "paul@mac:cc2cc/abc",
				createdAt: new Date().toISOString(),
				nextFireAt: new Date().toISOString(),
				fireCount: 3,
				enabled: true,
			},
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses schedule:deleted event", () => {
		const result = HubEventSchema.safeParse({
			event: "schedule:deleted",
			scheduleId: "550e8400-e29b-41d4-a716-446655440000",
			reason: "expired",
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("parses schedule:fired event", () => {
		const result = HubEventSchema.safeParse({
			event: "schedule:fired",
			scheduleId: "550e8400-e29b-41d4-a716-446655440000",
			scheduleName: "Daily nudge",
			fireCount: 5,
			nextFireAt: new Date().toISOString(),
			timestamp: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});
});
