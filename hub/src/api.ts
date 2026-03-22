// hub/src/api.ts
import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { getMessagesTodayCount, getTotalQueued, flushQueue } from "./queue.js";
import { checkRedisHealth } from "./redis.js";
import { emitToDashboards } from "./ws-handler.js";

const startTime = Date.now();

/**
 * Timing-safe comparison of two strings to prevent timing attacks.
 */
function keysEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate the ?key= query parameter.
 * Returns a 401 Response if invalid, or null if valid.
 */
export function validateKey(key: string | undefined): Response | null {
  if (!key || !keysEqual(key, config.apiKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/**
 * Mount all REST routes onto the given Hono app.
 * /health is publicly accessible; all other routes require ?key=<CC2CC_HUB_API_KEY>.
 */
export function buildApiRoutes(app: Hono): void {
  // GET /health — no auth required; must be publicly accessible
  app.get("/health", async (c) => {
    const redisOk = await checkRedisHealth();
    const onlineInstances = registry.getOnline();

    return c.json({
      status: "ok",
      connectedInstances: onlineInstances.length,
      redisOk,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // GET /api/instances — returns ALL instances (online + offline) with status field
  app.get("/api/instances", (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;

    return c.json(registry.getAll());
  });

  // GET /api/stats — { messagesToday, activeInstances, queuedTotal }
  app.get("/api/stats", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;

    const allInstances = registry.getAll();
    const onlineInstances = registry.getOnline();
    const [messagesToday, queuedTotal] = await Promise.all([
      getMessagesTodayCount(),
      getTotalQueued(allInstances.map((i) => i.instanceId)),
    ]);

    return c.json({
      messagesToday,
      activeInstances: onlineInstances.length,
      queuedTotal,
    });
  });

  // GET /api/messages/:id — fetch a stored message by messageId
  // Note: the hub doesn't maintain a separate message-by-ID store in v1.
  // This endpoint is a stub for dashboard inspection; returns 404 with a clear message.
  app.get("/api/messages/:id", (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;

    // In v1, individual message lookup requires scanning queues — not implemented.
    // Dashboard inspector uses the message:sent WS events to build its own store.
    return c.json(
      {
        error:
          "Message lookup by ID not supported in v1. Use the WS event stream to build a local index.",
      },
      404,
    );
  });

  // DELETE /api/instances/:id — remove a stale offline instance from the registry
  app.delete("/api/instances/:id", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;

    const instanceId = decodeURIComponent(c.req.param("id"));
    const entry = registry.get(instanceId);

    if (!entry) {
      return c.json({ error: "Instance not found" }, 404);
    }
    if (entry.status === "online") {
      return c.json({ error: "Cannot remove an online instance" }, 409);
    }

    await flushQueue(instanceId);
    await registry.deregister(instanceId);

    emitToDashboards({
      event: "instance:removed",
      instanceId,
      timestamp: new Date().toISOString(),
    });

    return c.json({ removed: true, instanceId });
  });

  // DELETE /api/queue/:id — flush a queue (admin)
  app.delete("/api/queue/:id", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;

    const instanceId = decodeURIComponent(c.req.param("id"));
    await flushQueue(instanceId);
    registry.setQueueDepth(instanceId, 0);

    return c.json({ flushed: true, instanceId });
  });
}
