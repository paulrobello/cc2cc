// hub/src/event-bus.ts
//
// Shared event-bus for the hub. Extracted to break the circular dependency
// between api.ts and ws-handler.ts: both previously imported from each other
// to share dashboardClients and emitToDashboards.
//
// Dependency graph after extraction:
//   api.ts       → event-bus.ts  (import emitToDashboards)
//   ws-handler.ts → event-bus.ts (import dashboardClients + emitToDashboards)
//   event-bus.ts  → (no hub imports — only @cc2cc/shared types)

import type { HubEvent } from "@cc2cc/shared";
import { WS_OPEN } from "./constants.js";
import { BroadcastManager } from "./broadcast.js";

// ── Dashboard clients set ─────────────────────────────────────────────────────

/**
 * Set of all connected dashboard WebSocket connections.
 * Used to fan-out HubEvent notifications to the monitoring dashboard.
 *
 * NOTE: This is an in-memory singleton. The hub is designed to run as a single
 * process; there is no cross-process sharing of this state. See ARC-010.
 */
export const dashboardClients = new Set<{
  readyState: number;
  send(data: string): void;
}>();

// ── Dashboard broadcast helper ────────────────────────────────────────────────

/**
 * Serialise a HubEvent and deliver it to every connected dashboard client.
 * Clients whose readyState is not WS_OPEN are silently skipped.
 */
export function emitToDashboards(event: HubEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of dashboardClients) {
    if (ws.readyState === WS_OPEN) {
      ws.send(payload);
    }
  }
}

// ── Broadcast manager singleton ───────────────────────────────────────────────

/**
 * Single BroadcastManager instance shared across all plugin connections.
 * Placed here alongside dashboardClients so both shared state objects live
 * in one module and both api.ts and ws-handler.ts can import them without
 * creating a cycle.
 */
export const broadcastManager = new BroadcastManager();
