// hub/src/ws-handler.ts
import type { ServerWebSocket } from "bun";
import type { Message } from "@cc2cc/shared";
import {
  MessageType,
  SendMessageInputSchema,
  BroadcastInputSchema,
  SessionUpdateActionSchema,
  SetRoleInputSchema,
  SubscribeTopicInputSchema,
  UnsubscribeTopicInputSchema,
  PublishTopicInputSchema,
  CreateScheduleInputSchema,
  UpdateScheduleInputSchema,
} from "@cc2cc/shared";
import type { Scheduler } from "./scheduler.js";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { registry } from "./registry.js";
import { INSTANCE_ID_RE } from "./validation.js";
import { pushMessage, atomicFlushOne, ackProcessed, getQueueDepth, migrateQueue } from "./queue.js";
import { topicManager } from "./topic-manager.js";
import { parseProject, sanitizeProjectTopic } from "./utils.js";
import { keysEqual } from "./auth.js";
import { WS_OPEN } from "./constants.js";
import { dashboardClients, emitToDashboards, broadcastManager } from "./event-bus.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** WS rate limit: max messages per window. */
const WS_RATE_LIMIT_MAX = 60;
/** WS rate limit: sliding window duration in milliseconds. */
const WS_RATE_LIMIT_WINDOW_MS = 10_000;

// ── Rate limiter ───────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** Maximum number of entries the rate limiter map may hold at any time. */
const RATE_LIMIT_MAP_MAX = 10_000;

/**
 * Per-instanceId message rate limiter.
 * Tracks message counts in a fixed 10-second window.
 * Returns true if the message should be allowed, false if rate-limited.
 * The map is bounded to RATE_LIMIT_MAP_MAX entries; when the cap is reached,
 * stale (expired-window) entries are evicted first. If still at cap, the
 * oldest entry is dropped to prevent unbounded memory growth from spoofed
 * or never-disconnecting instanceIds.
 */
const rateLimitMap = new Map<string, RateLimitEntry>();

function evictStaleRateLimitEntries(): void {
  const now = Date.now();
  for (const [id, entry] of rateLimitMap) {
    if (now - entry.windowStart >= WS_RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(id);
    }
  }
}

function checkRateLimit(instanceId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(instanceId);
  if (!entry || now - entry.windowStart >= WS_RATE_LIMIT_WINDOW_MS) {
    // Enforce map size cap before inserting a new entry
    if (!entry && rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      evictStaleRateLimitEntries();
      // If still at cap after stale eviction, drop the oldest entry
      if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
        const oldestKey = rateLimitMap.keys().next().value;
        if (oldestKey !== undefined) rateLimitMap.delete(oldestKey);
      }
    }
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

// ── Scheduler reference ──────────────────────────────────────────────────────

let _scheduler: Scheduler | null = null;

export function setScheduler(scheduler: Scheduler): void {
  _scheduler = scheduler;
}

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

// Re-export emitToDashboards so existing callers in tests that import from
// ws-handler.ts continue to resolve without changes.
export { emitToDashboards, dashboardClients, broadcastManager } from "./event-bus.js";

// ── Plugin connect / disconnect ───────────────────────────────────────────────

/**
 * Handle a plugin WebSocket connection opening.
 *
 * Registers the instance in the registry, flushes any messages that arrived
 * while it was offline, auto-joins its project topic, and emits
 * `instance:joined` to all dashboard clients.
 */
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

  // Auto-join project topic (sanitized to meet topic name constraints)
  const topicName = sanitizeProjectTopic(project);
  const isNewTopic = !(await topicManager.topicExists(topicName));
  await topicManager.createTopic(topicName, instanceId);
  if (isNewTopic) {
    emitToDashboards({
      event: "topic:created",
      name: topicName,
      createdBy: instanceId,
      timestamp: new Date().toISOString(),
    });
  }
  await topicManager.subscribe(topicName, instanceId);
  emitToDashboards({
    event: "topic:subscribed",
    name: topicName,
    instanceId,
    timestamp: new Date().toISOString(),
  });
  const topics = await topicManager.getTopicsForInstance(instanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics }));

  // Broadcast instance:joined to all dashboard clients
  emitToDashboards({
    event: "instance:joined",
    instanceId,
    timestamp: new Date().toISOString(),
  });

  // Delayed 5s to allow the plugin MCP transport and Claude Code to finish
  // initializing — channel notifications sent before that are dropped.
  // Both the queue flush and the wake-up nudge are deferred to this window.
  // Without this delay, queued messages are drained from Redis but the MCP
  // notifications are silently dropped because Claude Code isn't ready yet.
  setTimeout(async () => {
    const current = registry.get(instanceId);
    if (!current || current.status !== "online") return;

    // Flush queued messages now that Claude Code is ready to receive notifications
    await flushPendingQueue(instanceId, ws);

    // Wake-up nudge: send a connected message so the agent becomes active.
    // If the instance has no role, prompt it to set one; otherwise just confirm.
    const content = current.role
      ? `You are now connected to the cc2cc hub with role "${current.role}". Ready for messages.`
      : "You are now connected to the cc2cc hub. If you have been assigned a role, please call the set_role tool now to announce it. Do not reply to this message.";

    const nudge: Message = {
      messageId: randomUUID(),
      from: `system@hub:cc2cc/${randomUUID()}`,
      to: instanceId,
      type: MessageType.ping,
      content,
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(nudge));
  }, 5_000);

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

/**
 * Handle a plugin WebSocket connection closing.
 *
 * Marks the instance offline in the registry, removes it from the broadcast
 * manager, cleans up its rate-limiter entry, and emits `instance:left` to
 * all dashboard clients.
 */
export async function onPluginClose(ws: ServerWebSocket<WsData>): Promise<void> {
  const { instanceId } = ws.data;
  if (!instanceId) return;

  await registry.markOffline(instanceId);
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

/**
 * Dispatch an incoming WS frame from a plugin to the appropriate action handler.
 *
 * Enforces per-connection rate limiting (60 msg / 10 s) before parsing.
 * Routes on the `action` field: `send_message` (direct, role, or broadcast),
 * `broadcast`, `get_messages`, `session_update`, `set_role`,
 * `subscribe_topic`, `unsubscribe_topic`, `publish_topic`.
 * Unknown actions receive a structured error response.
 */
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
    } else if (typeof msg.to === "string" && msg.to.startsWith("role:")) {
      await handleRoleSend(ws, instanceId, msg);
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
  } else if (action === "create_schedule") {
    await handleCreateSchedule(ws, instanceId, msg);
  } else if (action === "list_schedules") {
    await handleListSchedules(ws, msg);
  } else if (action === "get_schedule") {
    await handleGetSchedule(ws, msg);
  } else if (action === "update_schedule") {
    await handleUpdateSchedule(ws, msg);
  } else if (action === "delete_schedule") {
    await handleDeleteSchedule(ws, msg);
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

/**
 * Role-based fan-out: send a message to every instance whose role matches `role:<name>`.
 * Each recipient gets its own copy of the envelope (unique messageId).
 * The sender is excluded from its own fan-out.
 * Emits one message:sent + queue:stats HubEvent per recipient.
 * Returns { role, recipients, delivered, queued } to the caller.
 */
async function handleRoleSend(
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
        requestId: msg.requestId,
      }),
    );
    return;
  }

  const { to, type, content, replyToMessageId, metadata } = parseResult.data;
  const role = to.slice(5); // strip "role:"
  const requestId = msg.requestId as string | undefined;

  const targets = registry.getByRole(role).filter((t) => t.instanceId !== fromInstanceId);

  if (targets.length === 0) {
    ws.send(
      JSON.stringify({
        error: `no instances found with role: ${role}`,
        ...(requestId ? { requestId } : {}),
      }),
    );
    return;
  }

  const recipients: string[] = [];
  let delivered = 0;
  let queued = 0;
  const now = new Date().toISOString();

  for (const target of targets) {
    const envelope: Message = {
      messageId: randomUUID(),
      from: fromInstanceId,
      to: target.instanceId,
      type,
      content,
      replyToMessageId,
      metadata,
      timestamp: now,
    };

    const depth = await pushMessage(target.instanceId, envelope);
    registry.setQueueDepth(target.instanceId, depth);

    const recipientWs = registry.getWsRef(target.instanceId) as ServerWebSocket<WsData> | undefined;
    if (recipientWs && recipientWs.readyState === WS_OPEN) {
      recipientWs.send(JSON.stringify(envelope));
      delivered++;
    } else {
      queued++;
    }

    recipients.push(target.instanceId);

    emitToDashboards({ event: "message:sent", message: envelope, timestamp: now });
    emitToDashboards({
      event: "queue:stats",
      instanceId: target.instanceId,
      depth,
      timestamp: now,
    });
  }

  ws.send(
    JSON.stringify({
      ...(requestId ? { requestId } : {}),
      role,
      recipients,
      delivered,
      queued,
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
  const result = broadcastManager.broadcast(fromInstanceId, type, content, metadata);

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
    type,
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

/**
 * Swap the in-memory registry and broadcast-manager state from oldId to newId.
 * Registers new identity BEFORE deregistering old (SEC-012 race-condition fix).
 */
async function migrateRegistration(
  ws: ServerWebSocket<WsData>,
  oldInstanceId: string,
  newInstanceId: string,
): Promise<void> {
  const project = parseProject(newInstanceId);
  await registry.register(newInstanceId, project);
  ws.data.instanceId = newInstanceId;
  registry.setWsRef(newInstanceId, ws);
  broadcastManager.addPluginWs(newInstanceId, ws);
  // Deregister old identity only after new one is live
  await registry.markOffline(oldInstanceId);
  registry.setWsRef(oldInstanceId, null);
  broadcastManager.removePluginWs(oldInstanceId);
}

/**
 * Re-join the project topic for the new instance, emitting topic HubEvents,
 * and push a subscriptions:sync frame to the plugin.
 */
async function syncTopicsAfterSession(
  ws: ServerWebSocket<WsData>,
  newInstanceId: string,
): Promise<void> {
  const project = parseProject(newInstanceId);
  const topicName = sanitizeProjectTopic(project);
  const isNewTopic = !(await topicManager.topicExists(topicName));
  await topicManager.createTopic(topicName, newInstanceId);
  if (isNewTopic) {
    emitToDashboards({
      event: "topic:created",
      name: topicName,
      createdBy: newInstanceId,
      timestamp: new Date().toISOString(),
    });
  }
  await topicManager.subscribe(topicName, newInstanceId);
  emitToDashboards({
    event: "topic:subscribed",
    name: project,
    instanceId: newInstanceId,
    timestamp: new Date().toISOString(),
  });
  const topics = await topicManager.getTopicsForInstance(newInstanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics }));
}

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

  if (!INSTANCE_ID_RE.test(newInstanceId)) {
    ws.send(
      JSON.stringify({
        error: "Invalid newInstanceId format. Expected: username@host:project/session_id",
        requestId,
      }),
    );
    return;
  }

  // Step 1: Migrate queued messages
  const migrated = await migrateQueue(oldInstanceId, newInstanceId);

  // Step 2: Swap registry / broadcast-manager registration
  await migrateRegistration(ws, oldInstanceId, newInstanceId);

  // Step 3: Notify dashboards
  emitToDashboards({
    event: "instance:left",
    instanceId: oldInstanceId,
    timestamp: new Date().toISOString(),
  });
  emitToDashboards({
    event: "instance:session_updated",
    oldInstanceId,
    newInstanceId,
    migrated,
    timestamp: new Date().toISOString(),
  });

  // Step 4: Migrate topic subscriptions and re-join project topic
  await topicManager.migrateSubscriptions(oldInstanceId, newInstanceId);
  await syncTopicsAfterSession(ws, newInstanceId);

  // Step 5: Ack back to the plugin
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
    ws.send(JSON.stringify({ requestId, error: err instanceof Error ? err.message : String(err) }));
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
    ws.send(JSON.stringify({ requestId, error: err instanceof Error ? err.message : String(err) }));
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
    ws.send(JSON.stringify({ requestId, error: err instanceof Error ? err.message : String(err) }));
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
    type,
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

// ── Schedule frame handlers ──────────────────────────────────────────────────

async function handleCreateSchedule(
  ws: ServerWebSocket<WsData>,
  instanceId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not available", requestId));
    return;
  }
  const parseResult = CreateScheduleInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(wsError("Invalid create_schedule payload", requestId, parseResult.error.flatten()));
    return;
  }
  try {
    const schedule = await _scheduler.createSchedule(parseResult.data, instanceId);
    ws.send(JSON.stringify({ requestId, ...schedule }));
  } catch (err) {
    ws.send(wsError(err instanceof Error ? err.message : String(err), requestId));
  }
}

async function handleListSchedules(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not available", requestId));
    return;
  }
  const schedules = await _scheduler.listSchedules();
  ws.send(JSON.stringify({ requestId, schedules }));
}

async function handleGetSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not available", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string | undefined;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const schedule = await _scheduler.getSchedule(scheduleId);
  if (!schedule) {
    ws.send(wsError("Schedule not found", requestId));
    return;
  }
  ws.send(JSON.stringify({ requestId, ...schedule }));
}

async function handleUpdateSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not available", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string | undefined;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const parseResult = UpdateScheduleInputSchema.safeParse(msg);
  if (!parseResult.success) {
    ws.send(wsError("Invalid update_schedule payload", requestId, parseResult.error.flatten()));
    return;
  }
  try {
    const schedule = await _scheduler.updateSchedule(scheduleId, parseResult.data);
    ws.send(JSON.stringify({ requestId, ...schedule }));
  } catch (err) {
    ws.send(wsError(err instanceof Error ? err.message : String(err), requestId));
  }
}

async function handleDeleteSchedule(
  ws: ServerWebSocket<WsData>,
  msg: Record<string, unknown>,
): Promise<void> {
  const requestId = msg.requestId as string | undefined;
  if (!_scheduler) {
    ws.send(wsError("Scheduler not available", requestId));
    return;
  }
  const scheduleId = msg.scheduleId as string | undefined;
  if (!scheduleId) {
    ws.send(wsError("Missing scheduleId", requestId));
    return;
  }
  const existing = await _scheduler.getSchedule(scheduleId);
  if (!existing) {
    ws.send(wsError("Schedule not found", requestId));
    return;
  }
  await _scheduler.deleteSchedule(scheduleId);
  ws.send(JSON.stringify({ requestId, deleted: true, scheduleId }));
}

// ── Dashboard connect / disconnect ───────────────────────────────────────────

/**
 * Handle a dashboard WebSocket connection opening.
 * Adds the connection to the dashboardClients set so it receives all HubEvent fan-outs.
 */
export function onDashboardOpen(ws: ServerWebSocket<WsData>): void {
  dashboardClients.add(ws);
  console.log(`[ws] dashboard connected (${dashboardClients.size} total)`);
}

/**
 * Handle a dashboard WebSocket connection closing.
 * Removes the connection from the dashboardClients set.
 */
export function onDashboardClose(ws: ServerWebSocket<WsData>): void {
  dashboardClients.delete(ws);
  console.log(`[ws] dashboard disconnected (${dashboardClients.size} remaining)`);
}

/**
 * Handle an unexpected inbound frame on the dashboard WebSocket.
 *
 * The `/ws/dashboard` connection is a server-to-browser event stream only.
 * The dashboard sends messages via its `/ws/plugin` identity. Any frame
 * received here is unexpected and is logged then silently dropped.
 */
export function onDashboardMessage(_ws: ServerWebSocket<WsData>, rawData: string | Buffer): void {
  // The /ws/dashboard connection is an event-stream only — the dashboard sends messages
  // via its separate /ws/plugin identity instead. Unexpected frames here are ignored.
  const frameLength = typeof rawData === "string" ? rawData.length : rawData.byteLength;
  console.warn(`[ws] Dashboard sent unexpected message (ignored): ${frameLength} bytes`);
}
