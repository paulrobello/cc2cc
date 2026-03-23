// dashboard/src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWs } from "@/hooks/use-ws";
import { InstanceSidebar } from "@/components/instance-sidebar/instance-sidebar";
import { MessageFeed } from "@/components/message-feed/message-feed";
import { ManualSendBar } from "@/components/manual-send-bar/manual-send-bar";
import { StatsBar } from "@/components/stats-bar/stats-bar";
import { fetchStats, removeInstance } from "@/lib/api";
import type { HubStats } from "@/types/dashboard";

export default function CommandCenterPage() {
  const router = useRouter();
  const { instances, topics, feed, connectionState } = useWs();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<{
    kind: "all" | "direct" | "broadcast" | "topic";
    topicName?: string;
  }>({ kind: "all" });
  const [hubStats, setHubStats] = useState<HubStats>({
    messagesToday: 0,
    activeInstances: 0,
    queuedTotal: 0,
  });

  useEffect(() => {
    let active = true;
    async function load() {
      const stats = await fetchStats();
      if (active) setHubStats(stats);
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const onlineCount = Array.from(instances.values()).filter(
    (i) => i.status === "online",
  ).length;
  const offlineCount = instances.size - onlineCount;
  const totalQueued = Array.from(instances.values()).reduce(
    (sum, i) => sum + i.queueDepth,
    0,
  );

  const stats = [
    { label: "Online", value: onlineCount, colorClass: "text-[#00d4ff] nr-glow-cyan" },
    { label: "Offline", value: offlineCount, colorClass: "text-[#3a5470]" },
    {
      label: "Msgs Today",
      value: hubStats.messagesToday,
      colorClass: "text-amber-400 nr-glow-amber",
    },
    {
      label: "Queued",
      value: totalQueued,
      colorClass: totalQueued > 0 ? "text-amber-400" : "text-[#3a5470]",
    },
  ];

  const instanceList = Array.from(instances.values());
  const topicList = Array.from(topics.values());

  const instanceTopics = Array.from(topics.values())
    .filter((t) => t.subscribers.includes(selectedInstanceId ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <StatsBar stats={stats} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden" style={{ width: "340px", flexShrink: 0 }}>
          <InstanceSidebar
            instances={instances}
            topics={topics}
            selectedId={selectedInstanceId}
            onSelect={(id) =>
              setSelectedInstanceId((prev) => (prev === id ? null : id))
            }
            onRemove={async (id) => {
              try {
                await removeInstance(id);
                if (selectedInstanceId === id) setSelectedInstanceId(null);
              } catch (err) {
                console.error("Failed to remove instance:", err);
              }
            }}
            onRemoveAll={async () => {
              const offlineIds = Array.from(instances.values())
                .filter((i) => i.status === "offline")
                .map((i) => i.instanceId);
              for (const id of offlineIds) {
                try {
                  await removeInstance(id);
                  if (selectedInstanceId === id) setSelectedInstanceId(null);
                } catch (err) {
                  console.error("Failed to remove instance:", id, err);
                }
              }
            }}
          />
          {selectedInstanceId &&
            !selectedInstanceId.startsWith("topic:") &&
            instanceTopics.length > 0 && (
              <div className="px-3 py-2 shrink-0" style={{ borderTop: "1px solid #1a3356", borderRight: "1px solid #1a3356", background: "#070f1e" }}>
                <div
                  className="mb-1 font-mono text-[9px] uppercase tracking-widest"
                  style={{ color: "#2a5480" }}
                >
                  Subscriptions
                </div>
                <div className="flex flex-wrap gap-1">
                  {instanceTopics.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => router.push("/topics")}
                      className="font-mono text-[10px] px-2 py-0.5 rounded"
                      style={{
                        background: "rgba(168,85,247,0.1)",
                        border: "1px solid rgba(168,85,247,0.3)",
                        color: "#a855f7",
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <MessageFeed
            feed={feed}
            filterInstanceId={selectedInstanceId}
            topics={topics}
            feedFilter={feedFilter}
            onFilterChange={setFeedFilter}
          />
          <ManualSendBar
            instances={instanceList}
            topics={topicList}
            disabled={connectionState !== "online"}
            onError={(err) => console.error("Failed to send message:", err)}
          />
        </div>
      </div>
    </div>
  );
}
