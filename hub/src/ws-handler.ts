// hub/src/ws-handler.ts
import type { ServerWebSocket } from "bun";
import type { HubEvent, Message, MessageType } from "@cc2cc/shared";
import {
  SendMessageInputSchema,
  BroadcastInputSchema,
  SessionUpdateActionSchema,
  SetRoleInputSchema,
  SubscribeTopicInputSchema,
  UnsubscribeTopicInputSchema,
  PublishTopicInputSchema,
} from "@cc2cc/shared";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { redis } from "./redis.js";
import { INSTANCE_ID_RE } from "./validation.js";
import { pushMessage, atomicFlushOne, ackProcessed, getQueueDepth, migrateQueue } from "./queue.js";
import { BroadcastManager } from "./broadcast.js";
import { topicManager, parseProject } from "./topic-manager.js";
import { keysEqual } from "./auth.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** WebSocket.OPEN numeric value. The WebSocket global is not available in Bun server context. */
const WS_OPEN = 1;

/** WS rate limit: max messages per window. */
const WS_RATE_LIMIT_MAX = 60;
/** WS rate limit: sliding window duration in milliseconds. */
const WS_RATE_LIMIT_WINDOW_MS = 10_000;

// ── Rate limiter ───────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Per-instanceId message rate limiter.
 * Tracks message counts in a fixed 10-second window.
 * Returns true if the message should be allowed, false if rate-limited.
 */
const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(instanceId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(instanceId);
  if (!entry || now - entry.windowStart >= WS_RATE_LIMIT_WINDOW_MS) {
    // Start a new window
    rateLimitMap.set(instanceId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= WS_RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

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

// ── WS error helper ───────────────────────────────────────────────────────────

/**
 * Build a consistent error response frame.
 * All WS error responses should use this helper to guarantee a uniform shape:
 * { error: string, requestId?: string, details?: unknown }
 */
function wsError(error: string, requestId?: string | unknown, details?: unknown): string {
  return JSON.stringify({
    error,
    ...(requestId ? { requestId } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}

// ── Dashboard broadcast helper ────────────────────────────────────────────────

export function emitToDashboards(event: HubEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of dashboardClients) {
    if (ws.readyState === WS_OPEN) {
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

  const project = parseProject(instanceId);
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
  // Clean up rate limiter state for this connection
  rateLimitMap.delete(instanceId);

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

  // Per-connection rate limit: max 60 messages per 10 seconds
  if (!checkRateLimit(instanceId)) {
    ws.send(
      JSON.stringify({
        error: "Rate limit exceeded. Max 60 messages per 10 seconds.",
        code: 429,
      }),
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawData === "string" ? rawData : rawData.toString());
  } catch {
    ws.send(wsError("Invalid JSON"));
    return;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    ws.send(wsError("Invalid message: expected a JSON object"));
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
    ws.send(wsError(`Unknown action: ${action}`));
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
  if (recipientWs && recipientWs.readyState === WS_OPEN) {
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

  // Broadcast:sent event to dashboards — include the actual type so feed displays correctly
  emitToDashboards({
    event: "broadcast:sent",
    from: fromInstanceId,
    content,
    type: type as string,
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

  // SEC-012: Register new identity BEFORE deregistering old to eliminate the
  // window where neither identity is reachable (race condition fix).
  const project = parseProject(newInstanceId);
  await registry.register(newInstanceId, project);
  ws.data.instanceId = newInstanceId;
  registry.setWsRef(newInstanceId, ws);
  broadcastManager.addPluginWs(newInstanceId, ws);

  // Now safely deregister the old identity
  registry.markOffline(oldInstanceId);
  registry.setWsRef(oldInstanceId, null);
  broadcastManager.removePluginWs(oldInstanceId);

  // Notify dashboards that the old session is gone
  emitToDashboards({
    event: "instance:left",
    instanceId: oldInstanceId,
    timestamp: new Date().toISOString(),
  });

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
  // Re-run auto-join for project topic (idempotent); `project` already derived from newInstanceId above
  await topicManager.createTopic(project, newInstanceId);
  await topicManager.subscribe(project, newInstanceId);
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
  const parseResult = SetRoleInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid set_role payload",
        details: parseResult.error.flatten(),
        requestId: msg.requestId,
      }),
    );
    return;
  }
  const { role } = parseResult.data;
  const requestId = msg.requestId as string | undefined;
  try {
    const updated = await registry.setRole(instanceId, role);
    ws.send(JSON.stringify({ requestId, instanceId, role: updated.role }));
    emitToDashboards({
      event: "instance:role_updated",
      instanceId,
      role: updated.role ?? "",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    ws.send(JSON.stringify({ requestId, error: (err as Error).message }));
  }
}

async function handleSubscribeTopic(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const parseResult = SubscribeTopicInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid subscribe_topic payload",
        details: parseResult.error.flatten(),
        requestId: msg.requestId,
      }),
    );
    return;
  }
  const { topic } = parseResult.data;
  const requestId = msg.requestId as string | undefined;
  try {
    await topicManager.subscribe(topic, instanceId);
    ws.send(JSON.stringify({ requestId, topic, subscribed: true }));
    emitToDashboards({
      event: "topic:subscribed",
      name: topic,
      instanceId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    ws.send(JSON.stringify({ requestId, error: (err as Error).message }));
  }
}

async function handleUnsubscribeTopic(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const parseResult = UnsubscribeTopicInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid unsubscribe_topic payload",
        details: parseResult.error.flatten(),
        requestId: msg.requestId,
      }),
    );
    return;
  }
  const { topic } = parseResult.data;
  const requestId = msg.requestId as string | undefined;
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
  const parseResult = PublishTopicInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        error: "Invalid publish_topic payload",
        details: parseResult.error.flatten(),
        requestId: msg.requestId,
      }),
    );
    return;
  }

  const { topic, type, content, persistent, metadata } = parseResult.data;
  const requestId = msg.requestId as string | undefined;

  const wsRefs = registry.getOnlineWsRefs();

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
  // The /ws/dashboard connection is an event-stream only — the dashboard sends messages
  // via its separate /ws/plugin identity instead. Unexpected frames here are ignored.
  console.warn(
    "[ws] Dashboard sent unexpected message (ignored):",
    rawData.toString().slice(0, 200),
  );
}
