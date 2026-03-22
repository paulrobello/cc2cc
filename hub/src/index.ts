// hub/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.js";
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
} from "./ws-handler.js";
import type { WsData } from "./ws-handler.js";
import type { ServerWebSocket } from "bun";

const app = new Hono();

// Allow cross-origin requests from the dashboard (different port)
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// Mount REST routes
buildApiRoutes(app);

// Bun WebSocket server — handles upgrade for /ws/plugin and /ws/dashboard
// biome-ignore lint/correctness/noUnusedVariables: server reference is kept for potential graceful shutdown
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
