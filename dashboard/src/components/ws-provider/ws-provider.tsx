// dashboard/src/components/ws-provider/ws-provider.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HubEventSchema, MessageType } from "@cc2cc/shared";
import type {
  ConnectionState,
  FeedMessage,
  InstanceState,
  SessionStats,
  WsContextValue,
} from "@/types/dashboard";
import { fetchInstances } from "@/lib/api";

/** Maximum number of messages retained in the feed */
const MAX_FEED_SIZE = 500;

/** Exponential backoff config */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_MAX_MS = 30_000;
/** Number of consecutive failures before showing "disconnected" (still retries in background) */
const DISCONNECT_THRESHOLD = 3;

/** Request/response entry for plugin WS pending calls */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Generate (or restore) the dashboard's registered instance ID for this browser session. */
function initDashboardInstanceId(): string {
  if (typeof window === "undefined") {
    return "dashboard@server:dashboard/ssr";
  }
  const storageKey = "cc2cc-dashboard-session-id";
  let sessionId = sessionStorage.getItem(storageKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, sessionId);
  }
  return `dashboard@${window.location.hostname}:dashboard/${sessionId}`;
}

export const WsContext = createContext<WsContextValue>({
  connectionState: "reconnecting",
  instances: new Map(),
  feed: [],
  sessionStats: { activeTasks: 0, errors: 0, pendingTaskIds: new Set() },
  dashboardInstanceId: "",
  sendMessage: async () => {
    throw new Error("WsProvider not mounted");
  },
  sendBroadcast: async () => {
    throw new Error("WsProvider not mounted");
  },
});

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("reconnecting");
  const [instances, setInstances] = useState<Map<string, InstanceState>>(
    new Map(),
  );
  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    activeTasks: 0,
    errors: 0,
    pendingTaskIds: new Set(),
  });

  // Stable dashboard identity — lazy initializer runs once per mount
  const [dashboardInstanceId] = useState(() => initDashboardInstanceId());

  // ── Dashboard WS state (receive-only hub event stream) ─────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const failureCountRef = useRef(0);
  const backoffMsRef = useRef(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});

  // ── Plugin WS state (send/receive as registered instance) ──────────────────
  const pluginWsRef = useRef<WebSocket | null>(null);
  const pluginBackoffMsRef = useRef(BACKOFF_INITIAL_MS);
  const pluginReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pluginPendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const pluginConnectRef = useRef<() => void>(() => {});

  /** Seed instances from REST on first load */
  const seedInstances = useCallback(async () => {
    const list = await fetchInstances();
    if (!mountedRef.current) return;
    setInstances((prev) => {
      const next = new Map(prev);
      for (const inst of list) {
        if (!next.has(inst.instanceId)) {
          next.set(inst.instanceId, {
            ...inst,
            queueDepth: inst.queueDepth ?? 0,
          });
        }
      }
      return next;
    });
  }, []);

  const appendFeed = useCallback((entry: FeedMessage) => {
    setFeed((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_FEED_SIZE
        ? next.slice(next.length - MAX_FEED_SIZE)
        : next;
    });
  }, []);

  // ── Dashboard WS event handler ──────────────────────────────────────────────

  const handleEvent = useCallback(
    (raw: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const result = HubEventSchema.safeParse(parsed);
      if (!result.success) return;

      const evt = result.data;

      switch (evt.event) {
        case "instance:joined":
          setInstances((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.instanceId);
            next.set(evt.instanceId, {
              instanceId: evt.instanceId,
              project: evt.instanceId.split(":")[1]?.split("/")[0] ?? "",
              status: "online",
              connectedAt: evt.timestamp,
              queueDepth: existing?.queueDepth ?? 0,
            });
            return next;
          });
          break;

        case "instance:left":
          setInstances((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.instanceId);
            if (existing) {
              next.set(evt.instanceId, { ...existing, status: "offline" });
            }
            return next;
          });
          break;

        case "instance:removed":
          setInstances((prev) => {
            const next = new Map(prev);
            next.delete(evt.instanceId);
            return next;
          });
          break;

        case "message:sent": {
          const msg = evt.message;
          const isBroadcast = msg.to === "broadcast";
          appendFeed({ message: msg, receivedAt: new Date(), isBroadcast });

          if (msg.type === "task") {
            setSessionStats((prev) => ({
              ...prev,
              activeTasks: prev.activeTasks + 1,
              pendingTaskIds: new Set([...prev.pendingTaskIds, msg.messageId]),
            }));
          } else if (msg.type === "result" && msg.replyToMessageId) {
            setSessionStats((prev) => {
              const nextPending = new Set(prev.pendingTaskIds);
              const wasTracked = nextPending.delete(msg.replyToMessageId!);
              return {
                ...prev,
                activeTasks: wasTracked
                  ? Math.max(0, prev.activeTasks - 1)
                  : prev.activeTasks,
                pendingTaskIds: nextPending,
              };
            });
          }
          break;
        }

        case "broadcast:sent":
          appendFeed({
            message: {
              messageId: crypto.randomUUID(),
              from: evt.from,
              to: "broadcast",
              type: MessageType.task,
              content: evt.content,
              timestamp: evt.timestamp,
            },
            receivedAt: new Date(),
            isBroadcast: true,
          });
          break;

        case "queue:stats":
          setInstances((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.instanceId);
            if (existing) {
              next.set(evt.instanceId, {
                ...existing,
                queueDepth: evt.depth,
              });
            }
            return next;
          });
          break;
      }
    },
    [appendFeed],
  );

  // ── Dashboard WS connect ────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const wsUrl = `${process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100"}/ws/dashboard?key=${encodeURIComponent(process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "")}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      failureCountRef.current = 0;
      backoffMsRef.current = BACKOFF_INITIAL_MS;
      setConnectionState("online");
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      handleEvent(evt.data);
    };

    ws.onerror = () => {
      setSessionStats((prev) => ({ ...prev, errors: prev.errors + 1 }));
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      failureCountRef.current += 1;

      if (failureCountRef.current >= DISCONNECT_THRESHOLD) {
        setConnectionState("disconnected");
      } else {
        setConnectionState("reconnecting");
      }

      reconnectTimerRef.current = setTimeout(() => {
        backoffMsRef.current = Math.min(
          backoffMsRef.current * BACKOFF_MULTIPLIER,
          BACKOFF_MAX_MS,
        );
        connectRef.current();
      }, backoffMsRef.current);
    };
  }, [handleEvent]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── Plugin WS: request/response helpers ────────────────────────────────────

  /** Send a request over the plugin WS and await the matching ack. */
  const pluginRequest = useCallback(
    <T,>(action: string, payload: Record<string, unknown>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const ws = pluginWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Plugin WebSocket not connected"));
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pluginPendingRef.current.delete(requestId);
          reject(new Error(`request timeout: action=${action}`));
        }, 10_000);
        pluginPendingRef.current.set(requestId, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        ws.send(JSON.stringify({ action, requestId, ...payload }));
      });
    },
    [],
  );

  // ── Plugin WS connect ───────────────────────────────────────────────────────

  const connectPlugin = useCallback(() => {
    if (!mountedRef.current) return;

    const pluginWsUrl = `${process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100"}/ws/plugin?key=${encodeURIComponent(process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "")}&instanceId=${encodeURIComponent(dashboardInstanceId)}`;

    const ws = new WebSocket(pluginWsUrl);
    pluginWsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      pluginBackoffMsRef.current = BACKOFF_INITIAL_MS;
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        return;
      }

      // Route to pending request if this is an ack frame
      const requestId = frame.requestId as string | undefined;
      if (requestId) {
        const pending = pluginPendingRef.current.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pluginPendingRef.current.delete(requestId);
          if (frame.error) {
            pending.reject(new Error(frame.error as string));
          } else {
            pending.resolve(frame);
          }
          return;
        }
      }
      // Non-ack frames are queue-flushed inbound messages — already visible in
      // the feed via the dashboard WS message:sent events, so no extra handling needed.
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      // Reject all in-flight requests
      for (const pending of pluginPendingRef.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Plugin WebSocket closed"));
      }
      pluginPendingRef.current.clear();

      pluginReconnectTimerRef.current = setTimeout(() => {
        pluginBackoffMsRef.current = Math.min(
          pluginBackoffMsRef.current * BACKOFF_MULTIPLIER,
          BACKOFF_MAX_MS,
        );
        pluginConnectRef.current();
      }, pluginBackoffMsRef.current);
    };
  }, [dashboardInstanceId]);

  useEffect(() => {
    pluginConnectRef.current = connectPlugin;
  }, [connectPlugin]);

  // ── Public send API ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (to: string, type: MessageType, content: string): Promise<void> =>
      pluginRequest("send_message", { to, type, content }),
    [pluginRequest],
  );

  const sendBroadcast = useCallback(
    (type: MessageType, content: string): Promise<void> =>
      pluginRequest("broadcast", { type, content }),
    [pluginRequest],
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    // seedInstances is async — setState fires after promise resolves, guarded by mountedRef
    // eslint-disable-next-line react-hooks/set-state-in-effect
    seedInstances();
    connect();
    connectPlugin();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pluginReconnectTimerRef.current)
        clearTimeout(pluginReconnectTimerRef.current);
      wsRef.current?.close();
      pluginWsRef.current?.close();
    };
  }, [connect, connectPlugin, seedInstances]);

  return (
    <WsContext.Provider
      value={{
        connectionState,
        instances,
        feed,
        sessionStats,
        dashboardInstanceId,
        sendMessage,
        sendBroadcast,
      }}
    >
      {children}
    </WsContext.Provider>
  );
}
