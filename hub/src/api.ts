// hub/src/api.ts
import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { getMessagesTodayCount, getTotalQueued, flushQueue } from "./queue.js";
import { checkRedisHealth } from "./redis.js";
import { emitToDashboards } from "./ws-handler.js";
import { topicManager, validateTopicName } from "./topic-manager.js";
import { keysEqual } from "./auth.js";
import type { Message, MessageType } from "@cc2cc/shared";

const startTime = Date.now();

/**
 * Validate the API key from a Hono request context.
 * Prefers the Authorization header ("Bearer <key>"), falls back to the ?key= query param
 * for backward compatibility with existing plugin and dashboard clients.
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
 * Extract the API key from Authorization header (preferred) or ?key= query param (fallback).
 * Call this in each route handler instead of c.req.query("key") directly.
 */
function getKey(c: Context): string | undefined {
  const authHeader = c.req.header("Authorization") as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return c.req.query("key") as string | undefined;
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
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;

    return c.json(registry.getAll());
  });

  // GET /api/stats — { messagesToday, activeInstances, queuedTotal }
  app.get("/api/stats", async (c) => {
    const authErr = validateKey(getKey(c));
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
    const authErr = validateKey(getKey(c));
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

  // GET /api/ping/:id — check whether an instance is currently online
  app.get("/api/ping/:id", (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;

    const instanceId = decodeURIComponent(c.req.param("id"));
    const entry = registry.get(instanceId);
    const online = entry?.status === "online";

    return c.json({ online, instanceId });
  });

  // DELETE /api/instances/:id — remove a stale offline instance from the registry
  app.delete("/api/instances/:id", async (c) => {
    const authErr = validateKey(getKey(c));
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
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;

    const instanceId = decodeURIComponent(c.req.param("id"));
    await flushQueue(instanceId);
    registry.setQueueDepth(instanceId, 0);

    return c.json({ flushed: true, instanceId });
  });

  // GET /api/topics — list all topics
  app.get("/api/topics", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    return c.json(await topicManager.listTopics());
  });

  // GET /api/topics/:name/subscribers — get subscribers for a topic
  app.get("/api/topics/:name/subscribers", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    const nameErr = validateTopicName(name);
    if (nameErr) return c.json({ error: nameErr }, 400);
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    return c.json(await topicManager.getSubscribers(name));
  });

  // POST /api/topics — create a topic (idempotent; only emits topic:created for new topics)
  app.post("/api/topics", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const { name } = await c.req.json<{ name: string }>();
    const nameErr = validateTopicName(name);
    if (nameErr) return c.json({ error: nameErr }, 400);
    const isNew = !(await topicManager.topicExists(name));
    const info = await topicManager.createTopic(name, "dashboard");
    if (isNew) {
      emitToDashboards({
        event: "topic:created",
        name,
        createdBy: "dashboard",
        timestamp: new Date().toISOString(),
      });
    }
    return c.json(info);
  });

  // DELETE /api/topics/:name — delete a topic
  app.delete("/api/topics/:name", async (c) => {
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    const nameErrDel = validateTopicName(name);
    if (nameErrDel) return c.json({ error: nameErrDel }, 400);
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
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    const nameErrSub = validateTopicName(name);
    if (nameErrSub) return c.json({ error: nameErrSub }, 400);
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
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    const nameErrUnsub = validateTopicName(name);
    if (nameErrUnsub) return c.json({ error: nameErrUnsub }, 400);
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { instanceId } = await c.req.json<{ instanceId: string }>();
    const entry = registry.get(instanceId);
    const isOffline = !entry || entry.status !== "online";
    try {
      await topicManager.unsubscribe(name, instanceId, isOffline);
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
    const authErr = validateKey(getKey(c));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    const nameErrPub = validateTopicName(name);
    if (nameErrPub) return c.json({ error: nameErrPub }, 400);
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const {
      content,
      type,
      persistent = false,
      metadata,
    } = await c.req.json<{
      content: string;
      type: string;
      persistent?: boolean;
      metadata?: Record<string, unknown>;
    }>();

    const wsRefs = registry.getOnlineWsRefs();

    // SEC-007: Server-stamp `from` as "dashboard" — ignore any client-supplied from field
    const message: Message = {
      messageId: randomUUID(),
      from: "dashboard",
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
      "dashboard",
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
