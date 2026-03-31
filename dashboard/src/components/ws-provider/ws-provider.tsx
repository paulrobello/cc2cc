// dashboard/src/components/ws-provider/ws-provider.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HubEventSchema, MessageType, parseProject } from "@cc2cc/shared";
import type {
  ConnectionState,
  FeedMessage,
  InstanceState,
  ScheduleState,
  SessionStats,
  TopicState,
  WsContextValue,
} from "@/types/dashboard";
import { fetchInstances, fetchSchedules, fetchTopicsWithSubscribers } from "@/lib/api";
import { useReconnectingWs } from "@/hooks/use-reconnecting-ws";
import { usePluginWs } from "@/hooks/use-plugin-ws";

/** Maximum number of messages retained in the feed */
const MAX_FEED_SIZE = 500;

/** Number of consecutive failures before showing "disconnected" (still retries in background) */
const DISCONNECT_THRESHOLD = 3;

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
  topics: new Map(),
  sendMessage: async () => {
    throw new Error("WsProvider not mounted");
  },
  sendBroadcast: async () => {
    throw new Error("WsProvider not mounted");
  },
  sendPublishTopic: async () => {
    throw new Error("WsProvider not mounted");
  },
  refreshTopics: async () => {
    throw new Error("WsProvider not mounted");
  },
  schedules: new Map(),
  refreshSchedules: async () => {
    throw new Error("WsProvider not mounted");
  },
});

/** Shape of the response from /api/hub/ws-config */
interface WsConfig {
  wsUrl: string;
  apiKey: string;
}

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
  const [topics, setTopics] = useState<Map<string, TopicState>>(new Map());
  const [schedules, setSchedules] = useState<Map<string, ScheduleState>>(new Map());

  // Stable dashboard identity — lazy initializer runs once per mount
  const [dashboardInstanceId] = useState(() => initDashboardInstanceId());

  const mountedRef = useRef(true);
  // Tracks consecutive dashboard WS failures for the disconnect threshold
  const failureCountRef = useRef(0);

  // WS config fetched once from the server-side /api/hub/ws-config endpoint.
  // The API key is never embedded in the browser bundle — it arrives at runtime
  // from a server route that reads the server-only CC2CC_HUB_API_KEY env var.
  const wsConfigRef = useRef<WsConfig>({
    wsUrl: "ws://localhost:3100",
    apiKey: "",
  });

  // ── Seed from REST on first load ────────────────────────────────────────────

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

  const seedTopics = useCallback(async () => {
    // Single request returns topics + subscriber lists in one round-trip (ARC-008)
    let list;
    try {
      list = await fetchTopicsWithSubscribers();
    } catch {
      return; // hub unreachable — degrade gracefully
    }
    if (!mountedRef.current) return;
    setTopics((prev) => {
      const next = new Map(prev);
      for (const t of list) {
        next.set(t.name, { ...t });
      }
      return next;
    });
  }, []);

  const seedSchedules = useCallback(async () => {
    let list;
    try {
      list = await fetchSchedules();
    } catch {
      return;
    }
    if (!mountedRef.current) return;
    setSchedules((prev) => {
      const next = new Map(prev);
      for (const s of list) {
        next.set(s.scheduleId, { ...s, recentFires: next.get(s.scheduleId)?.recentFires ?? [] });
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
              project: parseProject(evt.instanceId),
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
              type: evt.type ?? MessageType.task,
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

        case "instance:role_updated":
          setInstances((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.instanceId);
            if (existing)
              next.set(evt.instanceId, { ...existing, role: evt.role });
            return next;
          });
          break;

        case "topic:created":
          setTopics((prev) => {
            const next = new Map(prev);
            if (!next.has(evt.name)) {
              next.set(evt.name, {
                name: evt.name,
                createdAt: evt.timestamp,
                createdBy: evt.createdBy,
                subscriberCount: 0,
                subscribers: [],
              });
            }
            return next;
          });
          break;

        case "topic:deleted":
          setTopics((prev) => {
            const next = new Map(prev);
            next.delete(evt.name);
            return next;
          });
          break;

        case "topic:subscribed":
          setTopics((prev) => {
            const next = new Map(prev);
            const t = next.get(evt.name);
            if (t && !t.subscribers.includes(evt.instanceId)) {
              next.set(evt.name, {
                ...t,
                subscriberCount: t.subscriberCount + 1,
                subscribers: [...t.subscribers, evt.instanceId],
              });
            }
            return next;
          });
          break;

        case "topic:unsubscribed":
          setTopics((prev) => {
            const next = new Map(prev);
            const t = next.get(evt.name);
            if (t) {
              next.set(evt.name, {
                ...t,
                subscriberCount: Math.max(0, t.subscriberCount - 1),
                subscribers: t.subscribers.filter(
                  (id) => id !== evt.instanceId,
                ),
              });
            }
            return next;
          });
          break;

        case "instance:session_updated":
          setInstances((prev) => {
            const next = new Map(prev);
            // Remove the old session entry
            next.delete(evt.oldInstanceId);
            // Upsert the new session as online
            next.set(evt.newInstanceId, {
              instanceId: evt.newInstanceId,
              project: parseProject(evt.newInstanceId),
              status: "online",
              connectedAt: evt.timestamp,
              queueDepth: 0,
            });
            return next;
          });
          break;

        case "topic:message":
          appendFeed({
            message: evt.message,
            receivedAt: new Date(),
            isBroadcast: false,
            topicName: evt.name,
          });
          break;

        case "schedule:created":
          setSchedules((prev) => {
            const next = new Map(prev);
            next.set(evt.schedule.scheduleId, { ...evt.schedule, recentFires: [] });
            return next;
          });
          break;

        case "schedule:updated":
          setSchedules((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.schedule.scheduleId);
            next.set(evt.schedule.scheduleId, {
              ...evt.schedule,
              recentFires: existing?.recentFires ?? [],
            });
            return next;
          });
          break;

        case "schedule:deleted":
          setSchedules((prev) => {
            const next = new Map(prev);
            next.delete(evt.scheduleId);
            return next;
          });
          break;

        case "schedule:fired":
          setSchedules((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.scheduleId);
            if (existing) {
              const recentFires = [
                ...existing.recentFires,
                { timestamp: evt.timestamp, fireCount: evt.fireCount },
              ].slice(-50);
              next.set(evt.scheduleId, {
                ...existing,
                fireCount: evt.fireCount,
                nextFireAt: evt.nextFireAt,
                lastFiredAt: evt.timestamp,
                recentFires,
              });
            }
            return next;
          });
          break;
      }
    },
    [appendFeed],
  );

  // ── Dashboard WS (receive-only hub event stream) ────────────────────────────

  const getDashboardUrl = useCallback(
    () =>
      `${wsConfigRef.current.wsUrl}/ws/dashboard?key=${encodeURIComponent(wsConfigRef.current.apiKey)}`,
    [],
  );

  const {
    connect: connectDashboard,
    destroy: destroyDashboard,
  } = useReconnectingWs(
    getDashboardUrl,
    {
      onOpen: () => {
        failureCountRef.current = 0;
        setConnectionState("online");
      },
      onMessage: handleEvent,
      onError: () =>
        setSessionStats((prev) => ({ ...prev, errors: prev.errors + 1 })),
      onClose: () => {
        failureCountRef.current += 1;
        if (failureCountRef.current >= DISCONNECT_THRESHOLD) {
          setConnectionState("disconnected");
        } else {
          setConnectionState("reconnecting");
        }
      },
    },
    mountedRef,
  );

  // ── Plugin WS (registered instance for send operations) ────────────────────

  const getPluginUrl = useCallback(
    () =>
      `${wsConfigRef.current.wsUrl}/ws/plugin?key=${encodeURIComponent(wsConfigRef.current.apiKey)}&instanceId=${encodeURIComponent(dashboardInstanceId)}`,
    [dashboardInstanceId],
  );

  const {
    connect: connectPlugin,
    destroy: destroyPlugin,
    request: pluginRequest,
  } = usePluginWs(getPluginUrl, mountedRef);

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

  const sendPublishTopic = useCallback(
    (
      topic: string,
      type: MessageType,
      content: string,
      persistent: boolean,
      metadata?: Record<string, unknown>,
    ): Promise<void> =>
      // Route through the BFF proxy — the API key is added server-side.
      fetch(`/api/hub/topics/${encodeURIComponent(topic)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          type,
          persistent,
          metadata,
          from: dashboardInstanceId,
        }),
        signal: AbortSignal.timeout(10_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`publish failed: ${r.status}`);
      }),
    [dashboardInstanceId],
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Fetch WS config (URL + API key) from the server-side BFF endpoint before
    // opening WebSocket connections. This ensures the API key is never baked
    // into the browser bundle — it is read server-side and delivered at runtime.
    const init = async () => {
      try {
        const res = await fetch("/api/hub/ws-config", {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok && mountedRef.current) {
          const cfg = (await res.json()) as WsConfig;
          wsConfigRef.current = cfg;
        }
      } catch {
        // Fall through with default config (ws://localhost:3100, empty key)
      }

      if (!mountedRef.current) return;

      // seedInstances, seedTopics, and seedSchedules are async — setState fires after promise resolves, guarded by mountedRef.
      seedInstances();
      seedTopics();
      seedSchedules();
      connectDashboard();
      connectPlugin();
    };

    void init();

    return () => {
      mountedRef.current = false;
      destroyDashboard();
      destroyPlugin();
    };
  }, [
    connectDashboard,
    destroyDashboard,
    connectPlugin,
    destroyPlugin,
    seedInstances,
    seedTopics,
    seedSchedules,
  ]);

  return (
    <WsContext.Provider
      value={{
        connectionState,
        instances,
        feed,
        sessionStats,
        dashboardInstanceId,
        topics,
        sendMessage,
        sendBroadcast,
        sendPublishTopic,
        refreshTopics: seedTopics,
        schedules,
        refreshSchedules: seedSchedules,
      }}
    >
      {children}
    </WsContext.Provider>
  );
}
