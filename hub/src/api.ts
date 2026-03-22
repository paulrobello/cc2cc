// hub/src/api.ts
import { timingSafeEqual, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { getMessagesTodayCount, getTotalQueued, flushQueue } from "./queue.js";
import { checkRedisHealth } from "./redis.js";
import { emitToDashboards } from "./ws-handler.js";
import { topicManager } from "./topic-manager.js";
import type { Message, MessageType } from "@cc2cc/shared";

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

  // GET /api/topics — list all topics
  app.get("/api/topics", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    return c.json(await topicManager.listTopics());
  });

  // GET /api/topics/:name/subscribers — get subscribers for a topic
  app.get("/api/topics/:name/subscribers", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    return c.json(await topicManager.getSubscribers(name));
  });

  // POST /api/topics — create a topic
  app.post("/api/topics", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const { name } = await c.req.json<{ name: string }>();
    const info = await topicManager.createTopic(name, "dashboard");
    emitToDashboards({
      event: "topic:created",
      name,
      createdBy: "dashboard",
      timestamp: new Date().toISOString(),
    });
    return c.json(info);
  });

  // DELETE /api/topics/:name — delete a topic
  app.delete("/api/topics/:name", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const subscribers = await topicManager.getSubscribers(name);
    if (subscribers.length > 0) {
      return c.json({ error: "topic has subscribers", subscriberCount: subscribers.length }, 409);
    }
    await topicManager.deleteTopic(name);
    emitToDashboards({ event: "topic:deleted", name, timestamp: new Date().toISOString() });
    return c.json({ deleted: true, name });
  });

  // POST /api/topics/:name/subscribe — subscribe an instance to a topic
  app.post("/api/topics/:name/subscribe", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { instanceId } = await c.req.json<{ instanceId: string }>();
    if (!registry.get(instanceId)) {
      return c.json({ error: "instance not found" }, 404);
    }
    await topicManager.subscribe(name, instanceId);
    emitToDashboards({
      event: "topic:subscribed",
      name,
      instanceId,
      timestamp: new Date().toISOString(),
    });
    return c.json({ subscribed: true, topic: name });
  });

  // POST /api/topics/:name/unsubscribe — unsubscribe an instance from a topic
  app.post("/api/topics/:name/unsubscribe", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { instanceId } = await c.req.json<{ instanceId: string }>();
    try {
      await topicManager.unsubscribe(name, instanceId);
      emitToDashboards({
        event: "topic:unsubscribed",
        name,
        instanceId,
        timestamp: new Date().toISOString(),
      });
      return c.json({ unsubscribed: true, topic: name });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // POST /api/topics/:name/publish — publish a message to a topic
  app.post("/api/topics/:name/publish", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const {
      content,
      type,
      persistent = false,
      from,
      metadata,
    } = await c.req.json<{
      content: string;
      type: string;
      persistent?: boolean;
      from?: string;
      metadata?: Record<string, unknown>;
    }>();

    const wsRefs = new Map<string, { readyState: number; send(d: string): void }>();
    for (const entry of registry.getOnline()) {
      const ref = registry.getWsRef(entry.instanceId);
      if (ref) wsRefs.set(entry.instanceId, ref as { readyState: number; send(d: string): void });
    }

    const message: Message = {
      messageId: randomUUID(),
      from: from ?? "dashboard",
      to: `topic:${name}`,
      type: type as MessageType,
      content,
      topicName: name,
      metadata,
      timestamp: new Date().toISOString(),
    };

    const { delivered, queued } = await topicManager.publishToTopic(
      name,
      message,
      persistent,
      from ?? "",
      wsRefs,
    );

    emitToDashboards({
      event: "topic:message",
      name,
      message,
      persistent,
      delivered,
      queued,
      timestamp: new Date().toISOString(),
    });
    return c.json({ delivered, queued });
  });
}
