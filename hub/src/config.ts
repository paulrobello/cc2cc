// hub/src/config.ts

const dashboardOriginRaw = process.env.CC2CC_DASHBOARD_ORIGIN;
if (!dashboardOriginRaw) {
  console.warn(
    "[hub] WARNING: CC2CC_DASHBOARD_ORIGIN is not set. CORS is open to all origins ('*'). " +
      "Set CC2CC_DASHBOARD_ORIGIN to your dashboard URL (e.g. http://localhost:8029) to restrict access.",
  );
}

export const config = {
  port: parseInt(process.env.CC2CC_HUB_PORT ?? "3100", 10),
  apiKey: process.env.CC2CC_HUB_API_KEY ?? "",
  redisUrl: process.env.CC2CC_REDIS_URL ?? "redis://localhost:6379",
  /** Allowed CORS origin for the dashboard. Defaults to '*' if not set (with a warning). */
  dashboardOrigin: dashboardOriginRaw ?? "*",
} as const;

if (!config.apiKey) {
  console.error("[hub] FATAL: CC2CC_HUB_API_KEY is not set. Set it in .env before starting.");
  process.exit(1);
}

/**
 * Redis TTL for instance presence keys and queues (24 hours in seconds).
 * Shared constant — import from config.ts instead of duplicating the literal.
 */
export const REDIS_TTL_SECONDS = 86400;
