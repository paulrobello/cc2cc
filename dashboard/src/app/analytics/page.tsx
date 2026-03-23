// dashboard/src/app/analytics/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useWs } from "@/hooks/use-ws";
import { StatsBar } from "@/components/stats-bar/stats-bar";
import { ActivityTimeline } from "@/components/activity-timeline/activity-timeline";
import { MessageFeed } from "@/components/message-feed/message-feed";
import { fetchStats } from "@/lib/api";
import type { HubStats } from "@/types/dashboard";

export default function AnalyticsPage() {
  const { instances, feed, sessionStats } = useWs();
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

  const stats = [
    { label: "Online", value: onlineCount, colorClass: "text-[#00d4ff] nr-glow-cyan" },
    { label: "Offline", value: offlineCount, colorClass: "text-[#3a5470]" },
    {
      label: "Msgs Today",
      value: hubStats.messagesToday,
      colorClass: "text-amber-400 nr-glow-amber",
    },
    {
      label: "Active Tasks",
      value: sessionStats.activeTasks,
      colorClass:
        sessionStats.activeTasks > 0 ? "text-amber-400 nr-glow-amber" : "text-[#3a5470]",
    },
    {
      label: "Errors",
      value: sessionStats.errors,
      colorClass:
        sessionStats.errors > 0 ? "text-red-400 nr-glow-red" : "text-[#3a5470]",
    },
  ];

  const recent = [...feed].reverse().slice(0, 20);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col overflow-hidden">
      <StatsBar stats={stats} />

      <div className="flex flex-1 flex-col gap-0 overflow-auto">
        {/* Activity timeline panel */}
        <div
          className="shrink-0"
          style={{ borderBottom: "1px solid #1a3356" }}
        >
          <div
            className="px-4 py-2"
            style={{ borderBottom: "1px solid #1a3356", background: "#070f1e" }}
          >
            <h2
              className="text-[9px] font-bold uppercase tracking-[0.25em]"
              style={{ color: "#2a5480" }}
            >
              ◈ Node Activity — Last {10} Min
            </h2>
          </div>
          <div className="p-4">
            <ActivityTimeline
              instances={instances}
              feed={feed}
              windowMinutes={10}
            />
          </div>
        </div>

        {/* Recent messages panel */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="shrink-0 px-4 py-2"
            style={{ borderBottom: "1px solid #1a3356", background: "#070f1e" }}
          >
            <h2
              className="text-[9px] font-bold uppercase tracking-[0.25em]"
              style={{ color: "#2a5480" }}
            >
              ◈ Recent Transmissions
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <MessageFeed feed={recent} filterInstanceId={null} />
          </div>
        </div>
      </div>
    </div>
  );
}
