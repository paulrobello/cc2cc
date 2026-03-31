// hub/src/topic-manager.ts
import type { Message, TopicInfo } from "@cc2cc/shared";
import { redis } from "./redis.js";
import { pushMessage } from "./queue.js";
import { parseProject, sanitizeProjectTopic } from "./utils.js";
import { WS_OPEN } from "./constants.js";
import { TOPIC_EMPTY_TTL_SECONDS } from "./config.js";

/** In-memory map of pending auto-deletion timers for empty topics. */
const _pendingDeletions = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Validate topic name format: lowercase alphanumeric, hyphens, underscores.
 * Must start with alphanumeric. Max 64 chars.
 * Returns an error string if invalid, or null if valid.
 */
export function validateTopicName(name: unknown): string | null {
  if (typeof name !== "string") return "topic name must be a string";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    return "topic name must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (lowercase alphanumeric, hyphens, underscores; max 64 chars)";
  }
  return null;
}

/** WS-ref shape needed for live delivery in publishToTopic */
interface WsRef {
  readyState: number;
  send(data: string): void;
}

function _scheduleEmptyTopicDeletion(name: string): void {
  // Don't double-schedule
  if (_pendingDeletions.has(name)) return;

  const timer = setTimeout(async () => {
    _pendingDeletions.delete(name);
    // Re-check subscriber count — someone may have joined during the TTL window
    const count = await redis.scard(`topic:${name}:subscribers`);
    if (count > 0) return;
    // Re-check autoExpire flag
    const hash = await redis.hgetall(`topic:${name}`);
    if (hash?.autoExpire === "false") return;

    await topicManager.deleteTopic(name);
    console.log(`[topic-manager] auto-deleted empty topic "${name}" after ${TOPIC_EMPTY_TTL_SECONDS}s TTL`);
  }, TOPIC_EMPTY_TTL_SECONDS * 1000);

  _pendingDeletions.set(name, timer);
}

export const topicManager = {
  /**
   * Create a topic. Idempotent — returns existing topic info if the topic already exists.
   *
   * @param name - Validated topic name (must pass `validateTopicName`; throws on invalid input).
   * @param createdBy - Identity of the creator (instanceId or "dashboard").
   * @returns The topic metadata including current subscriber count.
   * @throws {Error} If `name` fails `validateTopicName` validation.
   */
  async createTopic(name: string, createdBy: string, autoExpire = true): Promise<TopicInfo> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    const existing = await redis.hgetall(`topic:${name}`);
    if (existing?.name) {
      // Self-heal: ensure the index entry exists even if it was lost
      await redis.sadd("topics:index", name);
      const subscribers = await redis.smembers(`topic:${name}:subscribers`);
      return {
        name: existing.name,
        createdAt: existing.createdAt ?? new Date().toISOString(),
        createdBy: existing.createdBy ?? createdBy,
        subscriberCount: subscribers.length,
        autoExpire: existing.autoExpire !== "false", // Redis stores strings
      };
    }
    const now = new Date().toISOString();
    // Atomically create topic hash and add to topics:index Set
    const pipeline = redis.pipeline();
    pipeline.hset(`topic:${name}`, { name, createdAt: now, createdBy, autoExpire: String(autoExpire) });
    pipeline.sadd("topics:index", name);
    await pipeline.exec();
    return { name, createdAt: now, createdBy, subscriberCount: 0, autoExpire };
  },

  /**
   * Delete a topic and remove all subscriber associations.
   *
   * Removes the topic hash, its subscriber set, and cleans up reverse-index entries
   * on each subscriber's `instance:{id}:topics` set. Also removes the topic from the
   * `topics:index` Set. Online subscribers are not notified — callers must emit a
   * `topic:deleted` HubEvent separately.
   *
   * @param name - Name of the topic to delete.
   * @throws {Error} If `name` fails `validateTopicName` validation.
   */
  async deleteTopic(name: string): Promise<void> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    const members = await redis.smembers(`topic:${name}:subscribers`);
    await Promise.all(members.map((id) => redis.srem(`instance:${id}:topics`, name)));
    // Atomically delete topic hash, subscribers set, and topics:index entry
    const pipeline = redis.pipeline();
    pipeline.del(`topic:${name}:subscribers`);
    pipeline.del(`topic:${name}`);
    pipeline.srem("topics:index", name);
    await pipeline.exec();
  },

  /**
   * Subscribe an instance to a topic.
   *
   * Adds the instance to `topic:{name}:subscribers` and records the reverse-index
   * entry in `instance:{instanceId}:topics`. Both sets are persistent — subscriptions
   * survive disconnects and hub restarts.
   *
   * @param name - Topic name.
   * @param instanceId - Instance to subscribe.
   * @throws {Error} If `name` fails `validateTopicName` validation.
   */
  async subscribe(name: string, instanceId: string): Promise<void> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    await redis.sadd(`topic:${name}:subscribers`, instanceId);
    await redis.sadd(`instance:${instanceId}:topics`, name);

    // Cancel any pending auto-deletion since topic now has a subscriber
    const pending = _pendingDeletions.get(name);
    if (pending) {
      clearTimeout(pending);
      _pendingDeletions.delete(name);
    }
  },

  /**
   * Unsubscribe an instance from a topic.
   *
   * By default, an instance cannot unsubscribe from its auto-joined project topic
   * (the topic whose name matches the project segment of the instance ID). Pass
   * `force = true` to bypass this guard — used internally during session migration
   * and offline instance cleanup performed by REST callers.
   *
   * @param name - Topic name.
   * @param instanceId - Instance to unsubscribe.
   * @param force - When `true`, skips the auto-joined project topic guard. Default: `false`.
   * @throws {Error} If `name` fails `validateTopicName` validation.
   * @throws {Error} If `force` is `false` and `name` matches the instance's auto-joined project topic.
   */
  async unsubscribe(name: string, instanceId: string, force = false): Promise<void> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    if (!force && name === sanitizeProjectTopic(parseProject(instanceId))) {
      throw new Error("cannot unsubscribe from auto-joined project topic");
    }
    await redis.srem(`topic:${name}:subscribers`, instanceId);
    await redis.srem(`instance:${instanceId}:topics`, name);

    // Check if topic is now empty and should auto-expire
    if (TOPIC_EMPTY_TTL_SECONDS > 0) {
      const remaining = await redis.scard(`topic:${name}:subscribers`);
      if (remaining === 0) {
        const hash = await redis.hgetall(`topic:${name}`);
        if (hash?.autoExpire !== "false") {
          _scheduleEmptyTopicDeletion(name);
        }
      }
    }
  },

  /**
   * Return all current subscribers of a topic.
   *
   * @param name - Topic name.
   * @returns Array of instanceId strings currently subscribed.
   * @throws {Error} If `name` fails `validateTopicName` validation.
   */
  async getSubscribers(name: string): Promise<string[]> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    return redis.smembers(`topic:${name}:subscribers`);
  },

  /**
   * Return all topics an instance is currently subscribed to.
   *
   * @param instanceId - The instance to query.
   * @returns Array of topic name strings.
   */
  async getTopicsForInstance(instanceId: string): Promise<string[]> {
    return redis.smembers(`instance:${instanceId}:topics`);
  },

  /**
   * List all topics with their metadata and current subscriber counts.
   *
   * Uses the `topics:index` Redis Set (maintained by `createTopic`/`deleteTopic`)
   * to avoid a blocking `KEYS` scan. Malformed or incomplete Redis hashes are
   * silently filtered and logged as warnings.
   *
   * @returns Array of `TopicInfo` objects for all known topics.
   */
  async listTopics(): Promise<TopicInfo[]> {
    // Use topics:index Set instead of blocking KEYS scan
    const names = await redis.smembers("topics:index");
    if (names.length === 0) return [];

    // Batch all HGETALL and SMEMBERS into a single pipeline round-trip (ARC-007).
    // Pipeline layout: even indices = HGETALL results, odd indices = SMEMBERS results.
    const pipeline = redis.pipeline();
    for (const name of names) {
      pipeline.hgetall(`topic:${name}`);
      pipeline.smembers(`topic:${name}:subscribers`);
    }
    const pipelineResults = (await pipeline.exec()) ?? [];

    const results: TopicInfo[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const data = (pipelineResults[i * 2]?.[1] ?? null) as Record<string, string> | null;
      const subscribers = (pipelineResults[i * 2 + 1]?.[1] ?? null) as string[] | null;
      if (!data || !data.name) {
        console.warn(
          `[topic-manager] listTopics: malformed or missing hash for topic "${name}" — skipping`,
        );
        continue;
      }
      results.push({
        name: data.name,
        createdAt: data.createdAt ?? "",
        createdBy: data.createdBy ?? "",
        subscriberCount: (subscribers ?? []).length,
        autoExpire: data.autoExpire !== "false",
      });
    }
    return results;
  },

  /**
   * Return topics with their subscriber arrays in a single batch (ARC-008).
   *
   * Accepts the output of `listTopics()` (already pipelined) and issues a second
   * pipeline round-trip only for the SMEMBERS calls that are not already included
   * in the `listTopics` pipeline. Because `listTopics` already fetches SMEMBERS
   * data, this method reuses the same pipeline approach to avoid redundant I/O.
   *
   * @param topics - Output from `listTopics()`.
   * @returns Each topic extended with a `subscribers` string array.
   */
  async listTopicsWithSubscribers(
    topics: TopicInfo[],
  ): Promise<(TopicInfo & { subscribers: string[] })[]> {
    if (topics.length === 0) return [];
    // Batch all SMEMBERS in one pipeline round-trip
    const pipeline = redis.pipeline();
    for (const t of topics) {
      pipeline.smembers(`topic:${t.name}:subscribers`);
    }
    const results = (await pipeline.exec()) ?? [];
    return topics.map((t, i) => ({
      ...t,
      subscribers: ((results[i]?.[1] ?? null) as string[] | null) ?? [],
    }));
  },

  /**
   * Check whether a topic exists in Redis.
   *
   * @param name - Topic name to check.
   * @returns `true` if the topic hash exists and has a `name` field; `false` otherwise.
   *   Also returns `false` for invalid topic names (no throw).
   */
  async topicExists(name: string): Promise<boolean> {
    const nameErr = validateTopicName(name);
    if (nameErr) return false;
    const data = await redis.hgetall(`topic:${name}`);
    return data !== null && !!data.name;
  },

  /**
   * Publish a message to all subscribers of a topic, excluding the sender.
   *
   * Delivery behavior depends on subscriber online status and the `persistent` flag:
   * - **Online + persistent**: live WS delivery AND queued in Redis for durability.
   * - **Online + non-persistent**: live WS delivery only.
   * - **Offline + persistent**: queued in Redis; delivered on reconnect.
   * - **Offline + non-persistent**: message is dropped for that subscriber.
   *
   * The daily stats counter (`stats:messages:today`) is incremented only for
   * non-persistent publishes; persistent messages are counted via `pushMessage`.
   *
   * @param name - Topic name. Must exist — callers should verify with `topicExists` first.
   * @param message - The fully constructed `Message` object to deliver.
   * @param persistent - Whether to queue the message for offline subscribers.
   * @param senderInstanceId - The sender's instance ID, excluded from delivery.
   * @param wsRefs - Map from instanceId to live WebSocket reference. Instances absent
   *   from this map are treated as offline regardless of registry status.
   * @returns `{ delivered, queued }` — count of live deliveries and Redis queue insertions.
   */
  async publishToTopic(
    name: string,
    message: Message,
    persistent: boolean,
    senderInstanceId: string,
    wsRefs: Map<string, WsRef>,
  ): Promise<{ delivered: number; queued: number }> {
    const subscribers = await redis.smembers(`topic:${name}:subscribers`);
    const recipients = subscribers.filter((id) => id !== senderInstanceId);

    let delivered = 0;
    let queued = 0;

    for (const id of recipients) {
      const ws = wsRefs.get(id);
      const isOnline = ws !== undefined && ws.readyState === WS_OPEN;

      if (isOnline) {
        ws.send(JSON.stringify(message));
        delivered++;
        if (persistent) {
          await pushMessage(id, message);
          queued++;
        }
      } else if (persistent) {
        // Offline subscriber — queue for later delivery
        await pushMessage(id, message);
        queued++;
      }
      // Offline + !persistent: skip (no delivery)
    }

    // Non-persistent path: increment daily stat directly
    if (!persistent) {
      await redis.incr("stats:messages:today");
    }

    return { delivered, queued };
  },

  /**
   * Migrate all topic subscriptions from one instance ID to another.
   *
   * Used during session updates (/clear) to atomically transfer every topic
   * membership from the old session identity to the new one. The operation is
   * idempotent — any subscriptions the new ID already holds are preserved via
   * SUNIONSTORE.
   *
   * After migration the old instance's reverse-index key is deleted and each
   * topic's subscriber set is updated in a single pipeline round-trip.
   *
   * @param oldInstanceId - The instance ID being replaced.
   * @param newInstanceId - The new instance ID to receive the subscriptions.
   * @returns The list of topic names that were migrated.
   */
  /** Cancel a pending empty-topic deletion (e.g. on hub shutdown). */
  cancelPendingDeletion(name: string): void {
    const timer = _pendingDeletions.get(name);
    if (timer) {
      clearTimeout(timer);
      _pendingDeletions.delete(name);
    }
  },

  /** Cancel all pending deletions (used during shutdown). */
  cancelAllPendingDeletions(): void {
    for (const timer of _pendingDeletions.values()) {
      clearTimeout(timer);
    }
    _pendingDeletions.clear();
  },

  /** Check if a topic has a pending deletion scheduled. For testing. */
  hasPendingDeletion(name: string): boolean {
    return _pendingDeletions.has(name);
  },

  /**
   * Startup recovery: scan all topics and schedule deletion for empty ones
   * with autoExpire enabled. Called once during hub initialization.
   */
  async recoverEmptyTopics(): Promise<number> {
    if (TOPIC_EMPTY_TTL_SECONDS <= 0) return 0;
    const names = await redis.smembers("topics:index");
    let scheduled = 0;
    for (const name of names) {
      const count = await redis.scard(`topic:${name}:subscribers`);
      if (count > 0) continue;
      const hash = await redis.hgetall(`topic:${name}`);
      if (!hash?.name) continue;
      if (hash.autoExpire === "false") continue;
      _scheduleEmptyTopicDeletion(name);
      scheduled++;
    }
    return scheduled;
  },

  async migrateSubscriptions(oldInstanceId: string, newInstanceId: string): Promise<string[]> {
    const topicNames = await redis.smembers(`instance:${oldInstanceId}:topics`);
    if (topicNames.length === 0) return [];

    // Build a pipeline: for each topic, swap oldInstanceId for newInstanceId in the subscriber set.
    const pipeline = redis.pipeline();
    for (const name of topicNames) {
      pipeline.srem(`topic:${name}:subscribers`, oldInstanceId);
      pipeline.sadd(`topic:${name}:subscribers`, newInstanceId);
    }
    // Merge old topics into the new instance's reverse index (preserving any existing ones)
    pipeline.sunionstore(
      `instance:${newInstanceId}:topics`,
      `instance:${newInstanceId}:topics`,
      `instance:${oldInstanceId}:topics`,
    );
    // Remove the old reverse index
    pipeline.del(`instance:${oldInstanceId}:topics`);
    await pipeline.exec();

    return topicNames;
  },
};
