// packages/shared/tests/schedule-schema.test.ts
import { describe, it, expect } from "bun:test";
import {
	ScheduleSchema,
	CreateScheduleInputSchema,
	UpdateScheduleInputSchema,
} from "../src/schema.js";
import { MessageType } from "../src/types.js";

describe("CreateScheduleInputSchema", () => {
	it("parses valid create input with cron expression", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "Daily standup nudge",
			expression: "0 9 * * *",
			target: "topic:team",
			messageType: "task",
			content: "Time for standup!",
		});
		expect(result.success).toBe(true);
	});

	it("parses valid create input with simple interval", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "Periodic ping",
			expression: "every 5m",
			target: "broadcast",
			messageType: "ping",
			content: "heartbeat",
		});
		expect(result.success).toBe(true);
	});

	it("parses valid create input with all optional fields", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "Limited nudge",
			expression: "every 1h",
			target: "role:reviewer",
			messageType: "task",
			content: "Check PRs",
			persistent: true,
			maxFireCount: 10,
			expiresAt: "2026-12-31T23:59:59.000Z",
			metadata: { priority: "high" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing required fields", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "Missing stuff",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty name", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "",
			expression: "every 5m",
			target: "broadcast",
			messageType: "task",
			content: "test",
		});
		expect(result.success).toBe(false);
	});

	it("rejects name over 100 chars", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "a".repeat(101),
			expression: "every 5m",
			target: "broadcast",
			messageType: "task",
			content: "test",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid message type", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "Bad type",
			expression: "every 5m",
			target: "broadcast",
			messageType: "invalid",
			content: "test",
		});
		expect(result.success).toBe(false);
	});

	it("accepts metadata within limits", () => {
		const result = CreateScheduleInputSchema.safeParse({
			name: "With meta",
			expression: "every 5m",
			target: "broadcast",
			messageType: "task",
			content: "test",
			metadata: { key1: "value1", key2: 42, key3: true },
		});
		expect(result.success).toBe(true);
	});
});

describe("UpdateScheduleInputSchema", () => {
	it("parses partial update with name only", () => {
		const result = UpdateScheduleInputSchema.safeParse({
			name: "Updated name",
		});
		expect(result.success).toBe(true);
	});

	it("parses partial update with enabled toggle", () => {
		const result = UpdateScheduleInputSchema.safeParse({
			enabled: false,
		});
		expect(result.success).toBe(true);
	});

	it("parses empty object (no-op update)", () => {
		const result = UpdateScheduleInputSchema.safeParse({});
		expect(result.success).toBe(true);
	});
});

describe("ScheduleSchema", () => {
	it("parses a full schedule object", () => {
		const result = ScheduleSchema.safeParse({
			scheduleId: "550e8400-e29b-41d4-a716-446655440000",
			name: "Test schedule",
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
		});
		expect(result.success).toBe(true);
	});

	it("parses schedule with optional fields", () => {
		const result = ScheduleSchema.safeParse({
			scheduleId: "550e8400-e29b-41d4-a716-446655440000",
			name: "Expiring schedule",
			expression: "0 9 * * *",
			target: "topic:team",
			messageType: "ping",
			content: "Wake up",
			persistent: true,
			createdBy: "paul@mac:cc2cc/abc",
			createdAt: new Date().toISOString(),
			nextFireAt: new Date().toISOString(),
			lastFiredAt: new Date().toISOString(),
			fireCount: 5,
			maxFireCount: 10,
			expiresAt: "2026-12-31T23:59:59.000Z",
			enabled: true,
			metadata: { source: "test" },
		});
		expect(result.success).toBe(true);
	});
});
