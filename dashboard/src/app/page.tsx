// dashboard/src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useWs } from "@/hooks/use-ws";
import { InstanceSidebar } from "@/components/instance-sidebar/instance-sidebar";
import { MessageFeed } from "@/components/message-feed/message-feed";
import { ManualSendBar } from "@/components/manual-send-bar/manual-send-bar";
import { StatsBar } from "@/components/stats-bar/stats-bar";
import { fetchStats, removeInstance } from "@/lib/api";
import type { HubStats } from "@/types/dashboard";

export default function CommandCenterPage() {
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

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <StatsBar stats={stats} />

      <div className="flex flex-1 overflow-hidden">
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
        />

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
