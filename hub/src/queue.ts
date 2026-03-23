// hub/src/queue.ts
import type { Message } from "@cc2cc/shared";
import { redis } from "./redis.js";
import { REDIS_TTL_SECONDS } from "./config.js";

const MAX_QUEUE_DEPTH = 1000;
/** Alias for clarity — queue TTL matches the instance presence TTL (24h). */
const QUEUE_TTL_SECONDS = REDIS_TTL_SECONDS;

function queueKey(instanceId: string): string {
  return `queue:${instanceId}`;
}

function processingKey(instanceId: string): string {
  return `processing:${instanceId}`;
}

/**
 * Push a message envelope to the recipient's Redis queue.
 * - RPUSH to append at the tail (FIFO when reading from head)
 * - EXPIRE to reset the 24h TTL on every push
 * - If depth > MAX_QUEUE_DEPTH, LPOP to drop the oldest message
 * - INCR stats:messages:today; set EXPIREAT to next midnight UTC
 */
export async function pushMessage(recipientId: string, message: Message): Promise<number> {
  const key = queueKey(recipientId);
  const depth = await redis.rpush(key, JSON.stringify(message));
  await redis.expire(key, QUEUE_TTL_SECONDS);

  if (depth > MAX_QUEUE_DEPTH) {
    await redis.lpop(key);
  }

  // Increment today's message counter and set it to expire at midnight UTC
  await redis.incr("stats:messages:today");
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  await redis.expireat("stats:messages:today", Math.floor(midnight.getTime() / 1000));

  return Math.min(depth, MAX_QUEUE_DEPTH);
}

/**
 * Atomically pop one message from the queue into the processing list.
 * Returns { message, raw } where raw is the original Redis string, or null if empty.
 *
 * The raw string is returned so callers can pass it unchanged to ackProcessed(),
 * avoiding lrem mismatches caused by JSON re-serialization with different key order.
 *
 * Delivery flow:
 *   1. RPOPLPUSH queue:{id} → processing:{id}  (atomic — hub can restart safely)
 *   2. Caller sends the message over WebSocket
 *   3. Caller calls ackProcessed() with the original raw string to remove from processing:{id}
 *
 * On hub restart, any entries in processing:{id} are re-queued by replayProcessing().
 */
export async function atomicFlushOne(
  instanceId: string,
): Promise<{ message: Message; raw: string } | null> {
  const raw = await redis.rpoplpush(queueKey(instanceId), processingKey(instanceId));
  if (!raw) return null;
  try {
    const message = JSON.parse(raw) as Message;
    return { message, raw };
  } catch {
    console.error(
      "[queue] Failed to parse message JSON from queue — removing corrupted entry",
      raw,
    );
    // Remove the corrupted entry from processing:{id} so it does not get stuck
    await redis.lrem(processingKey(instanceId), 1, raw);
    return null;
  }
}

/**
 * Remove a processed message from the processing list.
 * Called after successful WS send to complete the at-least-once delivery cycle.
 */
export async function ackProcessed(instanceId: string, raw: string): Promise<void> {
  await redis.lrem(processingKey(instanceId), 1, raw);
}

/**
 * On hub startup: move any entries in processing:{id} back to queue:{id} so they
 * are re-delivered on the next plugin reconnect.
 * Call this for each instanceId found in the registry on startup.
 */
export async function replayProcessing(instanceId: string): Promise<number> {
  let replayed = 0;
  while (true) {
    // RPOPLPUSH processes → queue (moves in reverse, but order is reset on flush anyway)
    const raw = await redis.rpoplpush(processingKey(instanceId), queueKey(instanceId));
    if (!raw) break;
    replayed++;
  }
  if (replayed > 0) {
    await redis.expire(queueKey(instanceId), QUEUE_TTL_SECONDS);
  }
  return replayed;
}

/** Return the current depth of an instance's queue. */
export async function getQueueDepth(instanceId: string): Promise<number> {
  return redis.llen(queueKey(instanceId));
}

/**
 * Return the sum of queue depths across all known instance IDs.
 * Called by GET /api/stats.
 */
export async function getTotalQueued(instanceIds: string[]): Promise<number> {
  if (instanceIds.length === 0) return 0;
  const pipeline = redis.pipeline();
  for (const id of instanceIds) pipeline.llen(queueKey(id));
  const results = await pipeline.exec();
  return (results ?? []).reduce((sum, r) => sum + ((r?.[1] as number) ?? 0), 0);
}

/**
 * Return today's message count from Redis.
 * Returns 0 if the key doesn't exist yet.
 */
export async function getMessagesTodayCount(): Promise<number> {
  const raw = await redis.get("stats:messages:today");
  return raw ? parseInt(raw, 10) : 0;
}

/**
 * Flush (delete) an entire queue. Admin operation — called by DELETE /api/queue/:id.
 */
export async function flushQueue(instanceId: string): Promise<void> {
  await redis.del(queueKey(instanceId));
}

/**
 * Migrate all queued/processing messages from one instance ID to another.
 * Used during session_update when a plugin reconnects with a new session ID.
 *
 * 1. RPOPLPUSH loop from processing:{oldId} → queue:{newId}
 * 2. If queue:{newId} is empty, RENAME queue:{oldId} → queue:{newId} (O(1))
 *    Otherwise RPOPLPUSH loop from queue:{oldId} → queue:{newId}
 * 3. Reset TTL on queue:{newId} to 24h
 * 4. Returns total count migrated
 */
export async function migrateQueue(oldId: string, newId: string): Promise<number> {
  let migrated = 0;

  // Step 1: Move processing:{oldId} → queue:{newId}
  const procKey = processingKey(oldId);
  while (true) {
    const raw = await redis.rpoplpush(procKey, queueKey(newId));
    if (!raw) break;
    migrated++;
  }

  // Step 2: Move queue:{oldId} → queue:{newId}
  const oldQueueKey = queueKey(oldId);
  const newQueueKey = queueKey(newId);
  const oldQueueLen = await redis.llen(oldQueueKey);

  if (oldQueueLen > 0) {
    const newQueueLen = await redis.llen(newQueueKey);
    if (newQueueLen === 0) {
      // O(1) atomic rename when destination is empty
      try {
        await redis.rename(oldQueueKey, newQueueKey);
        migrated += oldQueueLen;
      } catch {
        // RENAME fails if source key doesn't exist (race); fall through
      }
    } else {
      // Append via RPOPLPUSH loop
      while (true) {
        const raw = await redis.rpoplpush(oldQueueKey, newQueueKey);
        if (!raw) break;
        migrated++;
      }
    }
  }

  // Step 3: Reset TTL on new queue
  if (migrated > 0) {
    await redis.expire(newQueueKey, QUEUE_TTL_SECONDS);
  }

  return migrated;
}
