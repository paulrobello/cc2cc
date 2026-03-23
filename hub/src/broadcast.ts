// hub/src/broadcast.ts
import type { MessageType } from "@cc2cc/shared";
import { randomUUID } from "node:crypto";

/** WebSocket.OPEN numeric value. The WebSocket global is not available in Bun server context. */
const WS_OPEN = 1;

interface BroadcastResult {
  delivered: number;
  rateLimited: boolean;
}

interface BroadcastManagerOptions {
  /** Rate limit window in ms. Default: 5000 (5s per spec). */
  rateLimitMs?: number;
}

/**
 * Manages plugin WebSocket connections for broadcast fan-out.
 * Maintains an in-memory Map of instanceId → WebSocket (Bun ServerWebSocket).
 * Rate-limits each instance to one broadcast per rateLimitMs window.
 * Fire-and-forget — messages are NOT queued in Redis.
 */
export class BroadcastManager {
  private readonly _pluginWs = new Map<string, { readyState: number; send(data: string): void }>();
  private readonly _lastBroadcast = new Map<string, number>();
  private readonly _rateLimitMs: number;

  constructor(options: BroadcastManagerOptions = {}) {
    this._rateLimitMs = options.rateLimitMs ?? 5_000;
  }

  addPluginWs(instanceId: string, ws: { readyState: number; send(data: string): void }): void {
    this._pluginWs.set(instanceId, ws);
  }

  removePluginWs(instanceId: string): void {
    this._pluginWs.delete(instanceId);
  }

  /**
   * Fan out a broadcast message to all plugin WS connections except the sender.
   * Returns { delivered, rateLimited }.
   * If rateLimited === true, delivered === 0 and nothing was sent.
   */
  broadcast(
    fromInstanceId: string,
    type: MessageType,
    content: string,
    metadata?: Record<string, unknown>,
  ): BroadcastResult {
    const now = Date.now();
    const last = this._lastBroadcast.get(fromInstanceId) ?? 0;

    if (now - last < this._rateLimitMs) {
      return { delivered: 0, rateLimited: true };
    }

    this._lastBroadcast.set(fromInstanceId, now);

    const envelope = JSON.stringify({
      messageId: randomUUID(),
      from: fromInstanceId,
      to: "broadcast",
      type,
      content,
      metadata,
      timestamp: new Date().toISOString(),
    });

    let delivered = 0;
    for (const [instanceId, ws] of this._pluginWs.entries()) {
      if (instanceId === fromInstanceId) continue;
      if (ws.readyState !== WS_OPEN) continue;
      ws.send(envelope);
      delivered++;
    }

    return { delivered, rateLimited: false };
  }

  /** Return count of currently tracked plugin WS connections. */
  get size(): number {
    return this._pluginWs.size;
  }
}
