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
