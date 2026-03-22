// hub/src/ws-handler.ts
import type { ServerWebSocket } from "bun";
import type { HubEvent, Message, MessageType } from "@cc2cc/shared";
import {
  SendMessageInputSchema,
  BroadcastInputSchema,
  SessionUpdateActionSchema,
} from "@cc2cc/shared";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { redis } from "./redis.js";
import { INSTANCE_ID_RE } from "./validation.js";
import { pushMessage, atomicFlushOne, ackProcessed, getQueueDepth, migrateQueue } from "./queue.js";
import { BroadcastManager } from "./broadcast.js";
import { topicManager, parseProject } from "./topic-manager.js";

// ── Shared state ──────────────────────────────────────────────────────────────

/** Single BroadcastManager instance shared across all connections. */
export const broadcastManager = new BroadcastManager();

/**
 * Set of all connected dashboard WebSocket connections.
 * Used to fan-out HubEvent notifications.
 */
export const dashboardClients = new Set<ServerWebSocket<WsData>>();

// ── WS data attached per connection ──────────────────────────────────────────

export interface WsData {
  type: "plugin" | "dashboard";
  instanceId?: string; // only for plugin connections
}

// ── Auth helper ───────────────────────────────────────────────────────────────

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
 * Validate the API key on a WebSocket upgrade request.
 * Returns true if valid; the caller should reject with 401 otherwise.
 */
export function validateWsKey(url: string): boolean {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  return key !== null && keysEqual(key, config.apiKey);
}

/**
 * Extract the instanceId from the upgrade URL query string.
 * Plugin must supply ?instanceId=<id> in addition to ?key=.
 */
export function extractInstanceId(url: string): string | null {
  return new URL(url, "http://localhost").searchParams.get("instanceId");
}

// ── Dashboard broadcast helper ────────────────────────────────────────────────

export function emitToDashboards(event: HubEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of dashboardClients) {
    if (
      ws.readyState ===
      1 /* WebSocket.OPEN — use literal; WebSocket global not available in Bun server context */
    ) {
      ws.send(payload);
    }
  }
}

// ── Plugin connect / disconnect ───────────────────────────────────────────────

export async function onPluginOpen(ws: ServerWebSocket<WsData>): Promise<void> {
  const { instanceId } = ws.data;
  if (!instanceId) {
    ws.close(1008, "Missing instanceId");
    return;
  }

  const project = instanceId.split(":")[1]?.split("/")[0] ?? "";
  await registry.register(instanceId, project);
  registry.setWsRef(instanceId, ws);
  broadcastManager.addPluginWs(instanceId, ws);

  // Atomic queue flush: replay all pending messages before entering live mode
  await flushPendingQueue(instanceId, ws);

  // Auto-join project topic (reuses `project` extracted above)
  await topicManager.createTopic(project, instanceId);
  await topicManager.subscribe(project, instanceId);
  const topics = await topicManager.getTopicsForInstance(instanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics }));

  // Broadcast instance:joined to all dashboard clients
  emitToDashboards({
    event: "instance:joined",
    instanceId,
    timestamp: new Date().toISOString(),
  });

  console.log(`[ws] plugin connected: ${instanceId}`);
}

async function flushPendingQueue(instanceId: string, ws: ServerWebSocket<WsData>): Promise<void> {
  // RPOPLPUSH loop: atomically move each message to processing list, send, then ack
  while (true) {
    const result = await atomicFlushOne(instanceId);
    if (!result) break;

    const { message, raw } = result;
    try {
      ws.send(JSON.stringify(message));
      // Pass original raw bytes to ackProcessed — avoids lrem mismatch from re-serialization
      await ackProcessed(instanceId, raw);
    } catch (err) {
      console.error(`[ws] Failed to flush message to ${instanceId}`, err);
      // Message stays in processing:{id} and will be re-queued on hub restart
      break;
    }
  }

  // Update queue depth in registry after flush
  const depth = await getQueueDepth(instanceId);
  registry.setQueueDepth(instanceId, depth);
}

export async function onPluginClose(ws: ServerWebSocket<WsData>): Promise<void> {
  const { instanceId } = ws.data;
  if (!instanceId) return;

  registry.markOffline(instanceId);
  registry.setWsRef(instanceId, null);
  broadcastManager.removePluginWs(instanceId);

  emitToDashboards({
    event: "instance:left",
    instanceId,
    timestamp: new Date().toISOString(),
  });

  console.log(`[ws] plugin disconnected: ${instanceId}`);
}

// ── Plugin message handling ───────────────────────────────────────────────────

export async function onPluginMessage(
  ws: ServerWebSocket<WsData>,
  rawData: string | Buffer,
): Promise<void> {
  const { instanceId } = ws.data;
  if (!instanceId) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawData === "string" ? rawData : rawData.toString());
  } catch {
    ws.send(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    ws.send(JSON.stringify({ error: "Invalid message: expected a JSON object" }));
    return;
  }

  const msg = parsed as Record<string, unknown>;
  const action = msg.action as string | undefined;

  if (action === "send_message") {
    // Check if `to` field requests broadcast routing — fan-out instead of direct delivery
    if (typeof msg.to === "string" && msg.to === "broadcast") {
      await handleBroadcast(ws, instanceId, msg);
    } else {
      await handleSendMessage(ws, instanceId, msg);
    }
  } else if (action === "broadcast") {
    await handleBroadcast(ws, instanceId, msg);
  } else if (action === "get_messages") {
    await handleGetMessages(ws, instanceId, msg);
  } else if (action === "session_update") {
    await handleSessionUpdate(ws, instanceId, msg);
  } else if (action === "set_role") {
    await handleSetRole(ws, instanceId, msg);
  } else if (action === "subscribe_topic") {
    await handleSubscribeTopic(ws, instanceId, msg);
  } else if (action === "unsubscribe_topic") {
    await handleUnsubscribeTopic(ws, instanceId, msg);
  } else if (action === "publish_topic") {
    await handlePublishTopic(ws, instanceId, msg);
  } else {
    ws.send(JSON.stringify({ error: `Unknown action: ${action}` }));
  }
}

async function handleSendMessage(
  ws: ServerWebSocket<WsData>,
  fromInstanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const parseResult = SendMessageInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid send_message payload",
        details: parseResult.error.flatten(),
      }),
    );
    return;
  }

  const { to, type, content, replyToMessageId, metadata } = parseResult.data;

  // Partial address resolution: if `to` has no "/" it's a partial address
  let resolvedTo = to;
  let partialWarning: string | undefined;
  if (!to.includes("/")) {
    const resolution = registry.resolvePartial(to);
    if ("error" in resolution) {
      ws.send(JSON.stringify({ error: resolution.error, requestId: msg.requestId }));
      return;
    }
    resolvedTo = resolution.instanceId;
    partialWarning = resolution.warning;
  }

  // Server-stamps `from` — client-supplied from field is always ignored
  const envelope: Message = {
    messageId: randomUUID(),
    from: fromInstanceId,
    to: resolvedTo,
    type,
    content,
    replyToMessageId,
    metadata,
    timestamp: new Date().toISOString(),
  };

  const depth = await pushMessage(resolvedTo, envelope);
  registry.setQueueDepth(resolvedTo, depth);

  // Messages are always queued in Redis first. If the recipient is online,
  // also deliver live over WS for immediate processing. The queue is flushed
  // on reconnect — there is no client-side ack mechanism.
  const recipientWs = registry.getWsRef(resolvedTo) as ServerWebSocket<WsData> | undefined;
  let queued = true;
  if (
    recipientWs &&
    recipientWs.readyState ===
      1 /* WebSocket.OPEN — use literal; WebSocket global not available in Bun server context */
  ) {
    recipientWs.send(JSON.stringify(envelope));
    queued = false;
  }

  // Broadcast message:sent to all dashboard clients
  emitToDashboards({
    event: "message:sent",
    message: envelope,
    timestamp: new Date().toISOString(),
  });

  // Also emit queue:stats update to dashboards
  emitToDashboards({
    event: "queue:stats",
    instanceId: resolvedTo,
    depth,
    timestamp: new Date().toISOString(),
  });

  // Build ack response — include warning from partial resolution or offline queueing
  const warning = partialWarning ?? (queued ? "message queued, recipient offline" : undefined);
  const requestId = msg.requestId as string | undefined;
  ws.send(
    JSON.stringify({
      ...(requestId ? { requestId } : {}),
      messageId: envelope.messageId,
      queued,
      ...(warning ? { warning } : {}),
    }),
  );
}

async function handleBroadcast(
  ws: ServerWebSocket<WsData>,
  fromInstanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const parseResult = BroadcastInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid broadcast payload",
        details: parseResult.error.flatten(),
      }),
    );
    return;
  }

  const { type, content, metadata } = parseResult.data;
  const result = broadcastManager.broadcast(fromInstanceId, type as MessageType, content, metadata);

  if (result.rateLimited) {
    ws.send(
      JSON.stringify({
        error: "Rate limit exceeded. Max one broadcast per 5 seconds.",
        code: 429,
      }),
    );
    return;
  }

  // Broadcast:sent event to dashboards
  emitToDashboards({
    event: "broadcast:sent",
    from: fromInstanceId,
    content,
    timestamp: new Date().toISOString(),
  });

  const requestId = msg.requestId as string | undefined;
  ws.send(JSON.stringify({ ...(requestId ? { requestId } : {}), delivered: result.delivered }));
}

// ── Get messages handler ─────────────────────────────────────────────────────

async function handleGetMessages(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const rawLimit = typeof msg.limit === "number" ? msg.limit : 10;
  const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
  const requestId = msg.requestId as string | undefined;

  const messages: Message[] = [];
  for (let i = 0; i < limit; i++) {
    const result = await atomicFlushOne(instanceId);
    if (!result) break;
    try {
      messages.push(result.message);
      await ackProcessed(instanceId, result.raw);
    } catch (err) {
      console.error(`[ws] Failed to ack message during get_messages for ${instanceId}`, err);
      break;
    }
  }

  // Update queue depth in registry
  const depth = await getQueueDepth(instanceId);
  registry.setQueueDepth(instanceId, depth);

  ws.send(JSON.stringify({ messages, ...(requestId ? { requestId } : {}) }));
}

// ── Session update handler ───────────────────────────────────────────────────

async function handleSessionUpdate(
  ws: ServerWebSocket<WsData>,
  oldInstanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const parseResult = SessionUpdateActionSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid session_update payload",
        details: parseResult.error.flatten(),
      }),
    );
    return;
  }

  const { newInstanceId, requestId } = parseResult.data;

  // Validate new instance ID format
  if (!INSTANCE_ID_RE.test(newInstanceId)) {
    ws.send(
      JSON.stringify({
        error: "Invalid newInstanceId format. Expected: username@host:project/session_id",
        requestId,
      }),
    );
    return;
  }

  // Migrate queued messages from old ID to new ID
  const migrated = await migrateQueue(oldInstanceId, newInstanceId);

  // Clean up old instance ID to prevent stale registry entries and ambiguous partial resolution
  registry.markOffline(oldInstanceId);
  registry.setWsRef(oldInstanceId, null);
  broadcastManager.removePluginWs(oldInstanceId);

  // Notify dashboards that the old session is gone
  emitToDashboards({
    event: "instance:left",
    instanceId: oldInstanceId,
    timestamp: new Date().toISOString(),
  });

  // Extract project from newInstanceId (same logic as onPluginOpen)
  const project = newInstanceId.split(":")[1]?.split("/")[0] ?? "";

  // Register the new instance ID
  await registry.register(newInstanceId, project);
  ws.data.instanceId = newInstanceId;
  registry.setWsRef(newInstanceId, ws);
  broadcastManager.addPluginWs(newInstanceId, ws);

  // Emit session_updated event to dashboards
  emitToDashboards({
    event: "instance:session_updated",
    oldInstanceId,
    newInstanceId,
    migrated,
    timestamp: new Date().toISOString(),
  });

  // Migrate topic subscriptions to new instanceId
  const topicNames = await topicManager.getTopicsForInstance(oldInstanceId);
  for (const name of topicNames) {
    await redis.srem(`topic:${name}:subscribers`, oldInstanceId);
    await redis.sadd(`topic:${name}:subscribers`, newInstanceId);
  }
  // SUNIONSTORE: union so any pre-existing newId subscriptions are preserved
  await redis.sunionstore(
    `instance:${newInstanceId}:topics`,
    `instance:${newInstanceId}:topics`,
    `instance:${oldInstanceId}:topics`,
  );
  await redis.del(`instance:${oldInstanceId}:topics`);
  // Re-run auto-join for project topic (idempotent)
  const newProject = parseProject(newInstanceId);
  await topicManager.createTopic(newProject, newInstanceId);
  await topicManager.subscribe(newProject, newInstanceId);
  const newTopics = await topicManager.getTopicsForInstance(newInstanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics: newTopics }));

  // Ack back to the plugin over the current (old) WS
  ws.send(JSON.stringify({ requestId, migrated }));

  console.log(
    `[ws] session_update: ${oldInstanceId} → ${newInstanceId} (${migrated} messages migrated)`,
  );
}

// ── Role / topic frame handlers ───────────────────────────────────────────────

async function handleSetRole(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const { role, requestId } = msg as { role: string; requestId: string };
  await registry.setRole(instanceId, role);
  ws.send(JSON.stringify({ requestId, instanceId, role }));
  emitToDashboards({
    event: "instance:role_updated",
    instanceId,
    role,
    timestamp: new Date().toISOString(),
  });
}

async function handleSubscribeTopic(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const { topic, requestId } = msg as { topic: string; requestId: string };
  await topicManager.subscribe(topic, instanceId);
  ws.send(JSON.stringify({ requestId, topic, subscribed: true }));
  emitToDashboards({
    event: "topic:subscribed",
    name: topic,
    instanceId,
    timestamp: new Date().toISOString(),
  });
}

async function handleUnsubscribeTopic(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const { topic, requestId } = msg as { topic: string; requestId: string };
  try {
    await topicManager.unsubscribe(topic, instanceId);
    ws.send(JSON.stringify({ requestId, topic, unsubscribed: true }));
    emitToDashboards({
      event: "topic:unsubscribed",
      name: topic,
      instanceId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    ws.send(JSON.stringify({ requestId, error: (err as Error).message }));
    // Do NOT emit HubEvent on rejection
  }
}

async function handlePublishTopic(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const {
    topic,
    type,
    content,
    persistent = false,
    metadata,
    requestId,
  } = msg as {
    topic: string;
    type: string;
    content: string;
    persistent?: boolean;
    metadata?: Record<string, unknown>;
    requestId: string;
  };

  const wsRefs = new Map<string, { readyState: number; send(d: string): void }>();
  for (const entry of registry.getOnline()) {
    const ref = registry.getWsRef(entry.instanceId);
    if (ref) wsRefs.set(entry.instanceId, ref as { readyState: number; send(d: string): void });
  }

  const message: Message = {
    messageId: randomUUID(),
    from: instanceId,
    to: `topic:${topic}`,
    type: type as MessageType,
    content,
    topicName: topic,
    metadata,
    timestamp: new Date().toISOString(),
  };

  const { delivered, queued } = await topicManager.publishToTopic(
    topic,
    message,
    persistent,
    instanceId,
    wsRefs,
  );

  ws.send(JSON.stringify({ requestId, delivered, queued }));
  emitToDashboards({
    event: "topic:message",
    name: topic,
    message,
    persistent,
    delivered,
    queued,
    timestamp: new Date().toISOString(),
  });
}

// ── Dashboard connect / disconnect ───────────────────────────────────────────

export function onDashboardOpen(ws: ServerWebSocket<WsData>): void {
  dashboardClients.add(ws);
  console.log(`[ws] dashboard connected (${dashboardClients.size} total)`);
}

export function onDashboardClose(ws: ServerWebSocket<WsData>): void {
  dashboardClients.delete(ws);
  console.log(`[ws] dashboard disconnected (${dashboardClients.size} remaining)`);
}

export function onDashboardMessage(_ws: ServerWebSocket<WsData>, rawData: string | Buffer): void {
  // Dashboard clients are receive-only in v1. Ignore inbound messages.
  console.warn(
    "[ws] Dashboard sent unexpected message (ignored):",
    rawData.toString().slice(0, 200),
  );
}
