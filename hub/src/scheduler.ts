// hub/src/scheduler.ts
import { parseExpression } from "cron-parser";
import { randomUUID } from "node:crypto";
import { MessageType, SYSTEM_SENDER_ID } from "@cc2cc/shared";
import type { HubEvent, Schedule } from "@cc2cc/shared";
import type Redis from "ioredis";

// ── Simple interval parser ──────────────────────────────────────────────────

const SIMPLE_RE = /^every\s+(\d+)(m|h|d)(?:\s+at\s+(\d{2}):(\d{2}))?$/i;

/**
 * Convert a simple interval expression to a standard cron expression.
 * Returns null if the input is not a recognized simple interval format.
 *
 * Supported formats:
 *   "every 5m"           -> cron every 5 minutes
 *   "every 2h"           -> cron every 2 hours
 *   "every 1d"           -> cron daily at midnight
 *   "every 1d at 09:00"  -> cron daily at 09:00
 */
export function parseSimpleInterval(expr: string): string | null {
  const match = expr.match(SIMPLE_RE);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const atHour = match[3] ? parseInt(match[3], 10) : undefined;
  const atMinute = match[4] ? parseInt(match[4], 10) : undefined;

  switch (unit) {
    case "m":
      if (value < 1 || value > 59) return null;
      return `*/${value} * * * *`;
    case "h":
      if (value < 1 || value > 23) return null;
      return `0 */${value} * * *`;
    case "d":
      if (atHour !== undefined && atMinute !== undefined) {
        return `${atMinute} ${atHour} * * *`;
      }
      return `0 0 * * *`;
    default:
      return null;
  }
}

/**
 * Compute the next fire time for a cron expression.
 * Returns an ISO 8601 string, or null if the expression is invalid.
 */
export function computeNextFire(expression: string, from?: Date): string | null {
  try {
    const interval = parseExpression(expression, {
      currentDate: from ?? new Date(),
      utc: true,
    });
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

/**
 * Validate that a cron expression has at least a 1-minute interval.
 * Computes the first two fire times and checks the gap >= 60s.
 */
export function validateMinInterval(expression: string): boolean {
  try {
    const now = new Date();
    const interval = parseExpression(expression, { currentDate: now, utc: true });
    const first = interval.next().getTime();
    const second = interval.next().getTime();
    return (second - first) >= 60_000; // 1 minute minimum
  } catch {
    return false;
  }
}

/**
 * Normalize an expression: if it's a simple interval, convert to cron.
 * Returns { cron, error } — error is set if parsing fails or interval is sub-minute.
 */
export function normalizeExpression(expr: string): { cron: string | null; error: string | null } {
  const simple = parseSimpleInterval(expr);
  const cron = simple ?? expr;

  // Validate it's parseable
  if (computeNextFire(cron) === null) {
    return { cron: null, error: `Invalid expression: ${expr}` };
  }

  // Validate minimum interval
  if (!validateMinInterval(cron)) {
    return { cron: null, error: "Schedule interval must be at least 1 minute" };
  }

  return { cron, error: null };
}

// ── Redis key helpers ───────────────────────────────────────────────────────

const SCHEDULE_KEY = (id: string) => `schedule:${id}`;
const SCHEDULES_INDEX = "schedules:index";
const SCHEDULES_PENDING = "schedules:pending";

// ── Schedule from Redis hash ────────────────────────────────────────────────

function scheduleFromHash(hash: Record<string, string>): Schedule | null {
  if (!hash.scheduleId) return null;
  return {
    scheduleId: hash.scheduleId,
    name: hash.name,
    expression: hash.expression,
    target: hash.target,
    messageType: hash.messageType as MessageType,
    content: hash.content,
    metadata: hash.metadata ? JSON.parse(hash.metadata) : undefined,
    persistent: hash.persistent === "true",
    createdBy: hash.createdBy,
    createdAt: hash.createdAt,
    nextFireAt: hash.nextFireAt,
    lastFiredAt: hash.lastFiredAt || undefined,
    fireCount: parseInt(hash.fireCount ?? "0", 10),
    maxFireCount: hash.maxFireCount ? parseInt(hash.maxFireCount, 10) : undefined,
    expiresAt: hash.expiresAt || undefined,
    enabled: hash.enabled !== "false",
  };
}

function scheduleToHash(s: Schedule): string[] {
  const fields: string[] = [
    "scheduleId", s.scheduleId,
    "name", s.name,
    "expression", s.expression,
    "target", s.target,
    "messageType", s.messageType,
    "content", s.content,
    "persistent", String(s.persistent),
    "createdBy", s.createdBy,
    "createdAt", s.createdAt,
    "nextFireAt", s.nextFireAt,
    "fireCount", String(s.fireCount),
    "enabled", String(s.enabled),
  ];
  if (s.metadata) fields.push("metadata", JSON.stringify(s.metadata));
  if (s.lastFiredAt) fields.push("lastFiredAt", s.lastFiredAt);
  if (s.maxFireCount !== undefined) fields.push("maxFireCount", String(s.maxFireCount));
  if (s.expiresAt) fields.push("expiresAt", s.expiresAt);
  return fields;
}

// ── Scheduler options ───────────────────────────────────────────────────────

export interface SchedulerOptions {
  redis: Redis;
  pollIntervalMs?: number;
  /** Callback to route a fired message through existing hub infrastructure. */
  routeMessage: (
    target: string,
    type: MessageType,
    content: string,
    metadata: Record<string, unknown>,
    persistent: boolean,
  ) => Promise<void>;
  emitToDashboards: (event: HubEvent) => void;
}

// ── Scheduler class ─────────────────────────────────────────────────────────

export class Scheduler {
  private readonly redis: Redis;
  private readonly pollIntervalMs: number;
  private readonly routeMessage: SchedulerOptions["routeMessage"];
  private readonly emitToDashboards: SchedulerOptions["emitToDashboards"];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SchedulerOptions) {
    this.redis = opts.redis;
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000;
    this.routeMessage = opts.routeMessage;
    this.emitToDashboards = opts.emitToDashboards;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[scheduler] poll error:", err instanceof Error ? err.message : String(err));
      });
    }, this.pollIntervalMs);
    console.log(`[scheduler] started (poll every ${this.pollIntervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[scheduler] stopped");
    }
  }

  /** Single poll cycle — public so tests can call it directly. */
  async poll(): Promise<void> {
    const now = Date.now();
    const dueIds = await this.redis.zrangebyscore(SCHEDULES_PENDING, "-inf", String(now));
    if (dueIds.length === 0) return;

    for (const id of dueIds) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const schedule = scheduleFromHash(hash);
      if (!schedule) {
        // Stale ZSET entry — clean up
        await this.redis.zrem(SCHEDULES_PENDING, id);
        continue;
      }

      if (!schedule.enabled) {
        // Shouldn't be in ZSET, but defensive — remove it
        await this.redis.zrem(SCHEDULES_PENDING, id);
        continue;
      }

      // Fire the message
      const metadata: Record<string, unknown> = {
        ...(schedule.metadata ?? {}),
        scheduleId: schedule.scheduleId,
        scheduleName: schedule.name,
      };

      try {
        await this.routeMessage(
          schedule.target,
          schedule.messageType,
          schedule.content,
          metadata,
          schedule.persistent,
        );
      } catch (err) {
        console.error(
          `[scheduler] failed to fire schedule ${id}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Don't advance — will retry next poll
        continue;
      }

      // Update schedule state
      const newFireCount = schedule.fireCount + 1;
      const nowIso = new Date().toISOString();

      // Check if schedule should be deleted
      const maxReached = schedule.maxFireCount !== undefined && newFireCount >= schedule.maxFireCount;
      const expired = schedule.expiresAt !== undefined && now >= new Date(schedule.expiresAt).getTime();

      if (maxReached || expired) {
        // Delete the schedule
        await this.redis.del(SCHEDULE_KEY(id));
        await this.redis.srem(SCHEDULES_INDEX, id);
        await this.redis.zrem(SCHEDULES_PENDING, id);

        const reason = maxReached ? "max_fires_reached" : "expired";
        this.emitToDashboards({
          event: "schedule:deleted",
          scheduleId: id,
          reason,
          timestamp: nowIso,
        });
      } else {
        // Advance to next fire time
        const nextFire = computeNextFire(schedule.expression);
        if (!nextFire) {
          // Expression no longer valid — shouldn't happen but clean up
          await this.redis.del(SCHEDULE_KEY(id));
          await this.redis.srem(SCHEDULES_INDEX, id);
          await this.redis.zrem(SCHEDULES_PENDING, id);
          continue;
        }

        await this.redis.hset(
          SCHEDULE_KEY(id),
          "fireCount", String(newFireCount),
          "lastFiredAt", nowIso,
          "nextFireAt", nextFire,
        );
        await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), id);
      }

      // Emit fired event
      const nextFireForEvent = computeNextFire(schedule.expression) ?? nowIso;
      this.emitToDashboards({
        event: "schedule:fired",
        scheduleId: id,
        scheduleName: schedule.name,
        fireCount: newFireCount,
        nextFireAt: nextFireForEvent,
        timestamp: nowIso,
      });
    }
  }

  // ── CRUD operations ─────────────────────────────────────────────────────────

  async createSchedule(input: {
    name: string;
    expression: string;
    target: string;
    messageType: MessageType;
    content: string;
    persistent?: boolean;
    metadata?: Record<string, unknown>;
    maxFireCount?: number;
    expiresAt?: string;
  }, createdBy: string): Promise<Schedule> {
    const { cron, error } = normalizeExpression(input.expression);
    if (error || !cron) throw new Error(error ?? "Invalid expression");

    const nextFire = computeNextFire(cron);
    if (!nextFire) throw new Error("Cannot compute next fire time");

    const schedule: Schedule = {
      scheduleId: randomUUID(),
      name: input.name,
      expression: cron,
      target: input.target,
      messageType: input.messageType,
      content: input.content,
      metadata: input.metadata,
      persistent: input.persistent ?? false,
      createdBy,
      createdAt: new Date().toISOString(),
      nextFireAt: nextFire,
      fireCount: 0,
      maxFireCount: input.maxFireCount,
      expiresAt: input.expiresAt,
      enabled: true,
    };

    await this.redis.hset(SCHEDULE_KEY(schedule.scheduleId), ...scheduleToHash(schedule));
    await this.redis.sadd(SCHEDULES_INDEX, schedule.scheduleId);
    await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), schedule.scheduleId);

    this.emitToDashboards({
      event: "schedule:created",
      schedule,
      timestamp: new Date().toISOString(),
    });

    return schedule;
  }

  async listSchedules(): Promise<Schedule[]> {
    const ids = await this.redis.smembers(SCHEDULES_INDEX);
    const schedules: Schedule[] = [];
    for (const id of ids) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const s = scheduleFromHash(hash);
      if (s) schedules.push(s);
    }
    return schedules;
  }

  async getSchedule(scheduleId: string): Promise<Schedule | null> {
    const hash = await this.redis.hgetall(SCHEDULE_KEY(scheduleId));
    return scheduleFromHash(hash);
  }

  async updateSchedule(scheduleId: string, updates: Record<string, unknown>): Promise<Schedule> {
    const hash = await this.redis.hgetall(SCHEDULE_KEY(scheduleId));
    const existing = scheduleFromHash(hash);
    if (!existing) throw new Error("Schedule not found");

    // Apply updates
    if (updates.name !== undefined) existing.name = updates.name as string;
    if (updates.content !== undefined) existing.content = updates.content as string;
    if (updates.target !== undefined) existing.target = updates.target as string;
    if (updates.messageType !== undefined) existing.messageType = updates.messageType as MessageType;
    if (updates.persistent !== undefined) existing.persistent = updates.persistent as boolean;
    if (updates.metadata !== undefined) existing.metadata = updates.metadata as Record<string, unknown>;
    if (updates.maxFireCount !== undefined) {
      existing.maxFireCount = updates.maxFireCount === null ? undefined : updates.maxFireCount as number;
    }
    if (updates.expiresAt !== undefined) {
      existing.expiresAt = updates.expiresAt === null ? undefined : updates.expiresAt as string;
    }

    // Handle expression change
    if (updates.expression !== undefined) {
      const { cron, error } = normalizeExpression(updates.expression as string);
      if (error || !cron) throw new Error(error ?? "Invalid expression");
      existing.expression = cron;
      const nextFire = computeNextFire(cron);
      if (!nextFire) throw new Error("Cannot compute next fire time");
      existing.nextFireAt = nextFire;
    }

    // Handle enabled toggle
    if (updates.enabled !== undefined) {
      existing.enabled = updates.enabled as boolean;
      if (existing.enabled) {
        await this.redis.zadd(SCHEDULES_PENDING, new Date(existing.nextFireAt).getTime(), scheduleId);
      } else {
        await this.redis.zrem(SCHEDULES_PENDING, scheduleId);
      }
    }

    await this.redis.hset(SCHEDULE_KEY(scheduleId), ...scheduleToHash(existing));

    // If expression changed, update ZSET score
    if (updates.expression !== undefined && existing.enabled) {
      await this.redis.zadd(SCHEDULES_PENDING, new Date(existing.nextFireAt).getTime(), scheduleId);
    }

    this.emitToDashboards({
      event: "schedule:updated",
      schedule: existing,
      timestamp: new Date().toISOString(),
    });

    return existing;
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.redis.del(SCHEDULE_KEY(scheduleId));
    await this.redis.srem(SCHEDULES_INDEX, scheduleId);
    await this.redis.zrem(SCHEDULES_PENDING, scheduleId);

    this.emitToDashboards({
      event: "schedule:deleted",
      scheduleId,
      timestamp: new Date().toISOString(),
    });
  }

  /** Startup recovery: recompute nextFireAt for all schedules and repopulate ZSET. */
  async recover(): Promise<number> {
    const ids = await this.redis.smembers(SCHEDULES_INDEX);
    let recovered = 0;

    for (const id of ids) {
      const hash = await this.redis.hgetall(SCHEDULE_KEY(id));
      const schedule = scheduleFromHash(hash);
      if (!schedule) {
        await this.redis.srem(SCHEDULES_INDEX, id);
        continue;
      }

      if (!schedule.enabled) continue;

      // Recompute nextFireAt from now
      const nextFire = computeNextFire(schedule.expression);
      if (!nextFire) {
        // Expression invalid — remove schedule
        await this.redis.del(SCHEDULE_KEY(id));
        await this.redis.srem(SCHEDULES_INDEX, id);
        continue;
      }

      await this.redis.hset(SCHEDULE_KEY(id), "nextFireAt", nextFire);
      await this.redis.zadd(SCHEDULES_PENDING, new Date(nextFire).getTime(), id);
      recovered++;
    }

    return recovered;
  }
}
