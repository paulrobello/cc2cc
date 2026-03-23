// hub/src/topic-manager.ts
import { randomUUID } from "node:crypto";
import type { Message, TopicInfo } from "@cc2cc/shared";
import { redis } from "./redis.js";
import { pushMessage } from "./queue.js";
import { parseProject } from "./utils.js";
export { parseProject } from "./utils.js";

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

/** WebSocket.OPEN numeric value. The WebSocket global is not available in Bun server context. */
const WS_OPEN = 1;

/** WS-ref shape needed for live delivery in publishToTopic */
interface WsRef {
  readyState: number;
  send(data: string): void;
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
  async createTopic(name: string, createdBy: string): Promise<TopicInfo> {
    const nameErr = validateTopicName(name);
    if (nameErr) throw new Error(nameErr);
    const existing = await redis.hgetall(`topic:${name}`);
    if (existing?.name) {
      const subscribers = await redis.smembers(`topic:${name}:subscribers`);
      return {
        name: existing.name,
        createdAt: existing.createdAt ?? new Date().toISOString(),
        createdBy: existing.createdBy ?? createdBy,
        subscriberCount: subscribers.length,
      };
    }
    const now = new Date().toISOString();
    // Atomically create topic hash and add to topics:index Set
    const pipeline = redis.pipeline();
    pipeline.hset(`topic:${name}`, { name, createdAt: now, createdBy });
    pipeline.sadd("topics:index", name);
    await pipeline.exec();
    return { name, createdAt: now, createdBy, subscriberCount: 0 };
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
    if (!force && name === parseProject(instanceId)) {
      throw new Error("cannot unsubscribe from auto-joined project topic");
    }
    await redis.srem(`topic:${name}:subscribers`, instanceId);
    await redis.srem(`instance:${instanceId}:topics`, name);
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
    const results = await Promise.all(
      names.map(async (name) => {
        const data = await redis.hgetall(`topic:${name}`);
        if (!data || !data.name) {
          console.warn(
            `[topic-manager] listTopics: malformed or missing hash for topic "${name}" — skipping`,
          );
          return null;
        }
        const subscribers = await redis.smembers(`topic:${name}:subscribers`);
        return {
          name: data.name,
          createdAt: data.createdAt ?? "",
          createdBy: data.createdBy ?? "",
          subscriberCount: subscribers.length,
        } satisfies TopicInfo;
      }),
    );
    return results.filter((t): t is TopicInfo => t !== null);
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
};
