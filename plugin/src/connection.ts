// plugin/src/connection.ts
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export interface ConnectionOptions {
  /** Initial reconnect delay in milliseconds. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum reconnect delay in milliseconds. Default: 30000 */
  maxDelayMs?: number;
  /** Backoff multiplier. Default: 2 */
  multiplier?: number;
}

/**
 * HubConnection manages a persistent WebSocket connection to the cc2cc hub.
 *
 * Events emitted:
 *   'open'    — WebSocket connected successfully
 *   'message' — Parsed JSON payload received from hub
 *   'error'   — WebSocket error (non-fatal; reconnect will follow)
 *   'close'   — WebSocket closed; reconnect scheduled
 */
export class HubConnection extends EventEmitter {
  private readonly url: string;
  private readonly opts: Required<ConnectionOptions>;
  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDelay: number;

  constructor(url: string, opts: ConnectionOptions = {}) {
    super();
    // The API key is embedded in the URL as a query parameter by config.ts:
    // wsUrl = hubUrl + /ws/plugin?key=apiKey. The URL is passed directly here.
    this.url = url;
    this.opts = {
      initialDelayMs: opts.initialDelayMs ?? 1000,
      maxDelayMs: opts.maxDelayMs ?? 30_000,
      multiplier: opts.multiplier ?? 2,
    };
    this.currentDelay = this.opts.initialDelayMs;

    // Default no-op error handler to prevent "unhandled error event" crashes
    // when no external listener is attached. Callers can override by adding
    // their own 'error' listener.
    this.on("error", () => {});
  }

  /** Open the WebSocket connection. Safe to call multiple times (idempotent). */
  connect(): void {
    if (this.destroyed) return;
    this._openSocket();
  }

  /** Send a JSON-serialisable payload to the hub. No-op if not connected. */
  send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Send an action frame to the hub and await the matching response frame.
   * Resolves when the hub sends back { requestId: <same id>, ... }.
   * Rejects after 10 seconds if no response arrives.
   *
   * @throws {Error} If the connection is not open or the request times out
   */
  request<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID();

      const timeout = setTimeout(() => {
        this.removeListener("message", handler);
        reject(new Error(`request timeout: action=${action} requestId=${requestId}`));
      }, 10_000);

      const handler = (data: unknown) => {
        const frame = data as { requestId?: string } & T;
        if (frame.requestId === requestId) {
          clearTimeout(timeout);
          this.removeListener("message", handler);
          resolve(frame);
        }
      };

      this.on("message", handler);
      this.send({ action, requestId, ...payload });
    });
  }

  /**
   * Permanently destroy the connection and stop reconnect attempts.
   * After calling destroy() the instance must not be reused.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }

  private _openSocket(): void {
    if (this.destroyed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.emit("error", err);
      this._scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.currentDelay = this.opts.initialDelayMs; // reset backoff on successful connect
      this.emit("open");
    });

    this.ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
        // Hub push frames arrive without a requestId — handle before correlator
        if (parsed.action === "subscriptions:sync") {
          this.emit("subscriptions:sync", parsed.topics);
          return;
        }
        this.emit("message", parsed);
      } catch {
        // Non-JSON frame — ignore silently; hub should never send these
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
      // 'close' will follow; reconnect is scheduled there
    });

    this.ws.on("close", () => {
      this.emit("close");
      this._scheduleReconnect();
    });
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return;

    const delay = this.currentDelay;
    this.currentDelay = Math.min(this.currentDelay * this.opts.multiplier, this.opts.maxDelayMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._openSocket();
    }, delay);
  }
}
