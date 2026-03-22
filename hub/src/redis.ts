// hub/src/redis.ts
import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  // Reconnect with exponential backoff, max 30s
  retryStrategy(times: number): number {
    return Math.min(1000 * 2 ** (times - 1), 30_000);
  },
  // Prevent crash on connection failure — hub keeps running and retries
  lazyConnect: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => console.log("[redis] connected"));
redis.on("ready", () => console.log("[redis] ready"));
redis.on("error", (err) => console.error("[redis] error", err.message));

/**
 * Returns true if Redis responds to PING within 2 seconds.
 * Used by GET /health to populate redisOk field.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis PING timeout")), 2_000),
      ),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
}
