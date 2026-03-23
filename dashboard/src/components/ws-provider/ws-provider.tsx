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
  TopicState,
  WsContextValue,
} from "@/types/dashboard";
import { fetchInstances, fetchTopics, fetchTopicSubscribers } from "@/lib/api";
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
  const [topics, setTopics] = useState<Map<string, TopicState>>(new Map());

  // Stable dashboard identity — lazy initializer runs once per mount
  const [dashboardInstanceId] = useState(() => initDashboardInstanceId());

  const mountedRef = useRef(true);
  // Tracks consecutive dashboard WS failures for the disconnect threshold
  const failureCountRef = useRef(0);

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
    let list;
    try {
      list = await fetchTopics();
    } catch {
      return; // hub unreachable — degrade gracefully
    }
    if (!mountedRef.current) return;
    const subsResults = await Promise.all(
      list.map((t) => fetchTopicSubscribers(t.name)),
    );
    if (!mountedRef.current) return;
    setTopics((prev) => {
      const next = new Map(prev);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const subs = subsResults[i];
        next.set(t.name, { ...t, subscribers: subs });
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
              type: (evt.type as MessageType | undefined) ?? MessageType.task,
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
              project: evt.newInstanceId.split(":")[1]?.split("/")[0] ?? "",
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
      }
    },
    [appendFeed],
  );

  // ── Dashboard WS (receive-only hub event stream) ────────────────────────────

  const getDashboardUrl = useCallback(
    () =>
      `${process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100"}/ws/dashboard?key=${encodeURIComponent(process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "")}`,
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
      `${process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100"}/ws/plugin?key=${encodeURIComponent(process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "")}&instanceId=${encodeURIComponent(dashboardInstanceId)}`,
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
    ): Promise<void> => {
      const hubHttpUrl = (
        process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100"
      ).replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://"));
      const apiKey = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";
      return fetch(
        `${hubHttpUrl}/api/topics/${encodeURIComponent(topic)}/publish?key=${encodeURIComponent(apiKey)}`,
        {
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
        },
      ).then((r) => {
        if (!r.ok) throw new Error(`publish failed: ${r.status}`);
      });
    },
    [dashboardInstanceId],
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    // seedInstances and seedTopics are async — setState fires after promise resolves, guarded by mountedRef.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    seedInstances();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    seedTopics();
    connectDashboard();
    connectPlugin();

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
      }}
    >
      {children}
    </WsContext.Provider>
  );
}
