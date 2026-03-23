// dashboard/src/hooks/use-reconnecting-ws.ts
"use client";

import { useCallback, useEffect, useRef } from "react";

/** Exponential backoff defaults (shared with WsProvider) */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_MAX_MS = 30_000;

export interface ReconnectingWsOptions {
  /** Called when the WebSocket successfully opens. */
  onOpen?: (ws: WebSocket) => void;
  /** Called for every inbound message frame. */
  onMessage?: (data: string) => void;
  /** Called on every error event. */
  onError?: () => void;
  /** Called when the WebSocket closes (before reconnect is scheduled). */
  onClose?: () => void;
}

export interface ReconnectingWsHandle {
  /** The current WebSocket instance (may be null if not yet connected). */
  wsRef: React.MutableRefObject<WebSocket | null>;
  /** Imperatively open the WebSocket. Call once to start, or after destroy. */
  connect: () => void;
  /** Close the socket and cancel any pending reconnect. */
  destroy: () => void;
}

/**
 * Manages a WebSocket with automatic exponential-backoff reconnection.
 *
 * The caller provides a URL factory (`getUrl`) so the URL can depend on
 * state (e.g. instanceId) that is only known at connect time.
 *
 * Lifecycle: call `connect()` to start; call `destroy()` on unmount.
 */
export function useReconnectingWs(
  getUrl: () => string,
  opts: ReconnectingWsOptions,
  mountedRef: React.MutableRefObject<boolean>,
): ReconnectingWsHandle {
  const wsRef = useRef<WebSocket | null>(null);
  const backoffMsRef = useRef(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  // Stable ref for the connect function so closures always call the latest version
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!mountedRef.current || destroyedRef.current) return;

    const ws = new WebSocket(getUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      backoffMsRef.current = BACKOFF_INITIAL_MS; // reset on successful connect
      opts.onOpen?.(ws);
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      opts.onMessage?.(evt.data);
    };

    ws.onerror = () => {
      opts.onError?.();
    };

    ws.onclose = () => {
      if (!mountedRef.current || destroyedRef.current) return;
      opts.onClose?.();
      // Schedule reconnect with current backoff, then increase for next attempt
      reconnectTimerRef.current = setTimeout(() => {
        backoffMsRef.current = Math.min(
          backoffMsRef.current * BACKOFF_MULTIPLIER,
          BACKOFF_MAX_MS,
        );
        connectRef.current();
      }, backoffMsRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getUrl, mountedRef]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const destroy = useCallback(() => {
    destroyedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  return { wsRef, connect, destroy };
}
