// hub/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, ConfigurationError, validateConfig } from "./config.js";
import { buildApiRoutes } from "./api.js";
import { INSTANCE_ID_RE } from "./validation.js";
import {
  validateWsKey,
  extractInstanceId,
  onPluginOpen,
  onPluginClose,
  onPluginMessage,
  onDashboardOpen,
  onDashboardClose,
  onDashboardMessage,
  setScheduler,
} from "./ws-handler.js";
import type { WsData } from "./ws-handler.js";
import type { ServerWebSocket } from "bun";
import { redis } from "./redis.js";
import { replayProcessing, pushMessage } from "./queue.js";
import { registry } from "./registry.js";
import { Scheduler } from "./scheduler.js";
import { randomUUID } from "node:crypto";
import { MessageType, SYSTEM_SENDER_ID } from "@cc2cc/shared";
import type { Message } from "@cc2cc/shared";
import { topicManager } from "./topic-manager.js";
import { broadcastManager, emitToDashboards } from "./event-bus.js";

// Validate required configuration at startup (ARC-009).
// Must be called after all imports so config.ts is fully evaluated.
try {
  validateConfig();
} catch (err) {
  if (err instanceof ConfigurationError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const app = new Hono();

// Security headers for all REST responses
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
});

// Allow cross-origin requests from the dashboard.
// Controlled by CC2CC_DASHBOARD_ORIGIN env var (defaults to '*' with a warning logged at startup).
app.use(
  "*",
  cors({
    origin: config.dashboardOrigin,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Scheduler ────────────────────────────────────────────────────────────────

import { WS_OPEN } from "./constants.js";

const scheduler = new Scheduler({
  redis,
  routeMessage: async (target, type, content, metadata, persistent) => {
    const now = new Date().toISOString();

    if (target === "broadcast") {
      broadcastManager.broadcast(SYSTEM_SENDER_ID, type, content, metadata);
      emitToDashboards({
        event: "broadcast:sent",
        from: SYSTEM_SENDER_ID,
        content,
        type,
        timestamp: now,
      });
      return;
    }

    if (target.startsWith("topic:")) {
      const topicName = target.slice(6);
      const message: Message = {
        messageId: randomUUID(),
        from: SYSTEM_SENDER_ID,
        to: target,
        type,
        content,
        topicName,
        metadata,
        timestamp: now,
      };
      const wsRefs = registry.getOnlineWsRefs();
      const { delivered, queued } = await topicManager.publishToTopic(
        topicName,
        message,
        persistent,
        SYSTEM_SENDER_ID,
        wsRefs,
      );
      emitToDashboards({
        event: "topic:message",
        name: topicName,
        message,
        persistent,
        delivered,
        queued,
        timestamp: now,
      });
      return;
    }

    if (target.startsWith("role:")) {
      const role = target.slice(5);
      const targets = registry.getByRole(role);
      for (const t of targets) {
        const message: Message = {
          messageId: randomUUID(),
          from: SYSTEM_SENDER_ID,
          to: t.instanceId,
          type,
          content,
          metadata,
          timestamp: now,
        };
        const depth = await pushMessage(t.instanceId, message);
        registry.setQueueDepth(t.instanceId, depth);
        const recipientWs = registry.getWsRef(t.instanceId) as ServerWebSocket<WsData> | undefined;
        if (recipientWs && recipientWs.readyState === WS_OPEN) {
          recipientWs.send(JSON.stringify(message));
        }
        emitToDashboards({ event: "message:sent", message, timestamp: now });
        emitToDashboards({
          event: "queue:stats",
          instanceId: t.instanceId,
          depth,
          timestamp: now,
        });
      }
      return;
    }

    // Direct instance delivery
    const message: Message = {
      messageId: randomUUID(),
      from: SYSTEM_SENDER_ID,
      to: target,
      type,
      content,
      metadata,
      timestamp: now,
    };
    const depth = await pushMessage(target, message);
    registry.setQueueDepth(target, depth);
    const recipientWs = registry.getWsRef(target) as ServerWebSocket<WsData> | undefined;
    if (recipientWs && recipientWs.readyState === WS_OPEN) {
      recipientWs.send(JSON.stringify(message));
    }
    emitToDashboards({ event: "message:sent", message, timestamp: now });
    emitToDashboards({
      event: "queue:stats",
      instanceId: target,
      depth,
      timestamp: now,
    });
  },
  emitToDashboards,
});

setScheduler(scheduler);

// Mount REST routes
buildApiRoutes(app, scheduler);

// Bun WebSocket server — handles upgrade for /ws/plugin and /ws/dashboard
// `server` is kept in scope so that SIGTERM / SIGINT handlers can call server.stop().
const server = Bun.serve<WsData>({
  port: config.port,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade paths
    if (url.pathname === "/ws/plugin" || url.pathname === "/ws/dashboard") {
      if (!validateWsKey(req.url)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const type = url.pathname === "/ws/plugin" ? "plugin" : "dashboard";
      let instanceId: string | undefined;

      if (type === "plugin") {
        const id = extractInstanceId(req.url);
        if (!id) {
          return new Response("Missing instanceId query parameter", { status: 400 });
        }
        // Validate instanceId format: username@host:project/session
        if (!INSTANCE_ID_RE.test(id)) {
          return new Response("Invalid instanceId format. Expected: username@host:project/uuid", {
            status: 400,
          });
        }
        instanceId = id;
      }

      const upgraded = server.upgrade(req, {
        data: { type, instanceId } satisfies WsData,
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // All other requests handled by Hono
    return app.fetch(req);
  },

  websocket: {
    async open(ws: ServerWebSocket<WsData>) {
      if (ws.data.type === "plugin") {
        await onPluginOpen(ws);
      } else {
        onDashboardOpen(ws);
      }
    },

    async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      if (ws.data.type === "plugin") {
        await onPluginMessage(ws, message);
      } else {
        onDashboardMessage(ws, message);
      }
    },

    async close(ws: ServerWebSocket<WsData>) {
      if (ws.data.type === "plugin") {
        await onPluginClose(ws);
      } else {
        onDashboardClose(ws);
      }
    },
  },
});

console.log(`[hub] listening on port ${config.port}`);

// Graceful shutdown — stop accepting new connections then let the process exit.
async function shutdown(signal: string): Promise<void> {
  console.log(`[hub] ${signal} received — shutting down`);
  scheduler.stop();
  topicManager.cancelAllPendingDeletions();
  await server.stop();
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(console.error);
});
process.on("SIGINT", () => {
  shutdown("SIGINT").catch(console.error);
});

// On startup: perform two Redis scans in parallel:
// 1. Re-hydrate in-memory registry from instance:* keys (so /api/instances is accurate immediately)
// 2. Replay any processing:* keys left from a previous crash (at-least-once delivery guarantee)
(async () => {
  try {
    // ── 1. Re-hydrate registry ──────────────────────────────────────────────
    // Use SCAN (not KEYS) to avoid blocking Redis.
    let regCursor = "0";
    let regTotal = 0;
    do {
      const [nextCursor, keys] = await redis.scan(regCursor, "MATCH", "instance:*", "COUNT", 100);
      regCursor = nextCursor;
      for (const key of keys) {
        const instanceId = key.slice("instance:".length);
        try {
          const raw = await redis.get(key);
          if (!raw) continue;
          const data = JSON.parse(raw) as {
            instanceId?: string;
            project?: string;
            connectedAt?: string;
            role?: string;
          };
          // Populate _map with offline entry — WS connect will promote to online
          registry.hydrateOffline(instanceId, data.project ?? instanceId, data.role);
          regTotal++;
        } catch {
          // Malformed Redis value — skip gracefully
        }
      }
    } while (regCursor !== "0");
    if (regTotal > 0) {
      console.log(`[hub] startup: re-hydrated ${regTotal} instance(s) from Redis`);
    }

    // ── 2. Replay in-flight messages ────────────────────────────────────────
    let procCursor = "0";
    let procTotal = 0;
    do {
      const [nextCursor, keys] = await redis.scan(
        procCursor,
        "MATCH",
        "processing:*",
        "COUNT",
        100,
      );
      procCursor = nextCursor;
      for (const key of keys) {
        const instanceId = key.slice("processing:".length);
        const replayed = await replayProcessing(instanceId);
        if (replayed > 0) {
          console.log(`[hub] startup: replayed ${replayed} message(s) for ${instanceId}`);
          procTotal += replayed;
        }
      }
    } while (procCursor !== "0");
    if (procTotal > 0) {
      console.log(
        `[hub] startup: replayed ${procTotal} total in-flight message(s) from processing keys`,
      );
    }

    // ── 3. Recover empty topics ───────────────────────────────────────────────
    const topicRecovered = await topicManager.recoverEmptyTopics();
    if (topicRecovered > 0) {
      console.log(`[hub] startup: scheduled deletion for ${topicRecovered} empty topic(s)`);
    }

    // ── 4. Recover schedules ─────────────────────────────────────────────────
    const schedRecovered = await scheduler.recover();
    if (schedRecovered > 0) {
      console.log(`[hub] startup: recovered ${schedRecovered} schedule(s)`);
    }
    scheduler.start();
  } catch (err) {
    console.error(
      "[hub] startup: initialization scan failed",
      err instanceof Error ? err.message : String(err),
    );
  }
})();
