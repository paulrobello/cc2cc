// hub/src/config.ts

/**
 * Thrown when a required environment variable is missing at startup.
 * Catch this in the entry-point (index.ts) instead of calling process.exit
 * at import time, which breaks test environments and module mocking (ARC-009).
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const dashboardOriginRaw = process.env.CC2CC_DASHBOARD_ORIGIN;
if (!dashboardOriginRaw) {
  console.warn(
    "[hub] WARNING: CC2CC_DASHBOARD_ORIGIN is not set. CORS defaulting to 'http://localhost:8029'. " +
      "Set CC2CC_DASHBOARD_ORIGIN to your dashboard URL to restrict access in production.",
  );
}

export const config = {
  port: parseInt(process.env.CC2CC_HUB_PORT ?? "3100", 10),
  apiKey: process.env.CC2CC_HUB_API_KEY ?? "",
  redisUrl: process.env.CC2CC_REDIS_URL ?? "redis://localhost:6379",
  /** Allowed CORS origin for the dashboard. Defaults to localhost:8029 if not set. */
  dashboardOrigin: dashboardOriginRaw ?? "http://localhost:8029",
} as const;

/**
 * Validate required configuration values.
 * Call this once at server startup (hub/src/index.ts) — NOT at import time,
 * so that test modules can import config.ts without triggering an exit or throw
 * when CC2CC_HUB_API_KEY is not set in the test environment (ARC-009).
 *
 * @throws {ConfigurationError} if any required variable is missing.
 */
export function validateConfig(): void {
  if (!config.apiKey) {
    throw new ConfigurationError(
      "[hub] FATAL: CC2CC_HUB_API_KEY is not set. Set it in .env before starting.",
    );
  }
}

/**
 * Redis TTL for instance presence keys and queues (24 hours in seconds).
 * Shared constant — import from config.ts instead of duplicating the literal.
 */
export const REDIS_TTL_SECONDS = 86400;

/**
 * Redis TTL for offline instance presence keys (1 hour in seconds).
 * Online instances retain the full 24h TTL; when an instance disconnects,
 * the TTL is shortened so stale entries are cleaned up faster.
 */
export const OFFLINE_TTL_SECONDS = 3600;

/**
 * TTL in seconds before an empty topic (0 subscribers) is auto-deleted.
 * Set to 0 to disable auto-expiry globally. Default: 3600 (1 hour).
 * Individual topics can opt out by setting autoExpire=false.
 */
export const TOPIC_EMPTY_TTL_SECONDS = parseInt(process.env.CC2CC_TOPIC_EMPTY_TTL ?? "3600", 10);
