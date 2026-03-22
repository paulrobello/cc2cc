// hub/src/config.ts

export const config = {
  port: parseInt(process.env.CC2CC_HUB_PORT ?? "3100", 10),
  apiKey: process.env.CC2CC_HUB_API_KEY ?? "",
  redisUrl: process.env.CC2CC_REDIS_URL ?? "redis://localhost:6379",
} as const;

if (!config.apiKey) {
  console.error("[hub] FATAL: CC2CC_HUB_API_KEY is not set. Set it in .env before starting.");
  process.exit(1);
}
