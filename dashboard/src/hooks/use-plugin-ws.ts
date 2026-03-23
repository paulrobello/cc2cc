// dashboard/src/hooks/use-plugin-ws.ts
"use client";

import { useCallback, useRef } from "react";
import { useReconnectingWs } from "./use-reconnecting-ws";

/** Pending request entry stored while awaiting an ack from the plugin WS. */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PluginWsHandle {
  /** Imperatively open the WebSocket. Call once to start, or after destroy. */
  connect: () => void;
  /** Close the socket, cancel reconnect, and reject all in-flight requests. */
  destroy: () => void;
  /**
   * Send a JSON action frame and await the matching ack from the hub.
   * Rejects with a timeout error after 10 seconds.
   */
  request: <T>(action: string, payload: Record<string, unknown>) => Promise<T>;
}

/**
 * Manages a plugin WebSocket connection with automatic exponential-backoff
 * reconnection and a request/response correlator for hub ack frames.
 *
 * Builds on `useReconnectingWs` and adds:
 * - Transparent `subscriptions:sync` frame handling (ignored by correlator)
 * - In-flight request rejection when the socket closes
 * - A `request()` method for send-and-await-ack call patterns
 */
export function usePluginWs(
  getUrl: () => string,
  mountedRef: React.MutableRefObject<boolean>,
): PluginWsHandle {
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  const { wsRef, connect, destroy: baseDestroy } = useReconnectingWs(
    getUrl,
    {
      onMessage: (data) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }

        // Ignore server-pushed subscriptions:sync — dashboard seeds from REST
        if (frame.action === "subscriptions:sync") return;

        // Route ack frames to the matching pending request
        const requestId = frame.requestId as string | undefined;
        if (requestId) {
          const pending = pendingRef.current.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRef.current.delete(requestId);
            if (frame.error) {
              pending.reject(new Error(frame.error as string));
            } else {
              pending.resolve(frame);
            }
          }
        }
        // Non-ack frames (queue-flushed inbound messages) are already visible
        // in the feed via dashboard WS message:sent events — no extra handling.
      },
      onClose: () => {
        // Reject all in-flight requests so callers don't hang
        for (const pending of pendingRef.current.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Plugin WebSocket closed"));
        }
        pendingRef.current.clear();
      },
    },
    mountedRef,
  );

  const destroy = useCallback(() => {
    // Reject pending requests before closing
    for (const pending of pendingRef.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Plugin WebSocket destroyed"));
    }
    pendingRef.current.clear();
    baseDestroy();
  }, [baseDestroy]);

  const request = useCallback(
    <T,>(action: string, payload: Record<string, unknown>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Plugin WebSocket not connected"));
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pendingRef.current.delete(requestId);
          reject(new Error(`request timeout: action=${action}`));
        }, 10_000);
        pendingRef.current.set(requestId, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        ws.send(JSON.stringify({ action, requestId, ...payload }));
      }),
    [wsRef],
  );

  return { connect, destroy, request };
}
