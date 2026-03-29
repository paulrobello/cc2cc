// dashboard/src/app/analytics/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useWs } from "@/hooks/use-ws";
import { StatsBar } from "@/components/stats-bar/stats-bar";
import { ActivityTimeline } from "@/components/activity-timeline/activity-timeline";
import { MessageFeed } from "@/components/message-feed/message-feed";
import { fetchStats } from "@/lib/api";
import type { HubStats } from "@/types/dashboard";

export default function AnalyticsPage() {
  const { instances, feed, sessionStats, topics } = useWs();
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

  const windowOptions = [1, 3, 5, 10] as const;
  const [windowMinutes, setWindowMinutes] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    const stored = localStorage.getItem("cc2cc:analytics:windowMinutes");
    const parsed = stored ? Number(stored) : NaN;
    return (windowOptions as readonly number[]).includes(parsed) ? parsed : 5;
  });
  const handleWindowChange = useCallback((v: number) => {
    setWindowMinutes(v);
    localStorage.setItem("cc2cc:analytics:windowMinutes", String(v));
  }, []);

  const recent = [...feed].reverse().slice(0, 20);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col overflow-hidden">
      <StatsBar stats={stats} />

      <div className="grid flex-1 grid-rows-[auto_1fr] overflow-hidden">
        {/* Activity timeline panel */}
        <div
          className="shrink-0 overflow-auto"
          style={{ borderBottom: "1px solid #1a3356", maxHeight: "40vh" }}
        >
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: "1px solid #1a3356", background: "#070f1e" }}
          >
            <h2
              className="text-[9px] font-bold uppercase tracking-[0.25em]"
              style={{ color: "#2a5480" }}
            >
              ◈ Node Activity — Last {windowMinutes} Min
            </h2>
            <div className="flex items-center gap-3">
              {/* Time span selector */}
              <select
                value={windowMinutes}
                onChange={(e) => handleWindowChange(Number(e.target.value))}
                className="cursor-pointer appearance-none rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider outline-none"
                style={{
                  background: "#0d1f38",
                  border: "1px solid #2a5480",
                  color: "#00d4ff",
                }}
              >
                {windowOptions.map((min) => (
                  <option key={min} value={min}>
                    {min}m
                  </option>
                ))}
              </select>
              {[
                { label: "Task", color: "#f59e0b" },
                { label: "Result", color: "#34d399" },
                { label: "Question", color: "#60a5fa" },
                { label: "Broadcast", color: "#c084fc" },
                { label: "Ack/Ping", color: "#94a3b8" },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: item.color, boxShadow: `0 0 3px ${item.color}` }}
                  />
                  <span className="font-mono text-[8px] uppercase tracking-wider" style={{ color: item.color }}>
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div className="p-4">
            <ActivityTimeline
              instances={instances}
              feed={feed}
              windowMinutes={windowMinutes}
            />
          </div>
        </div>

        {/* Recent messages panel */}
        <div className="flex min-h-0 flex-col overflow-hidden">
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
            <MessageFeed
              feed={recent}
              filterInstanceId={null}
              instances={instances}
              topics={topics}
              feedFilter={feedFilter}
              onFilterChange={setFeedFilter}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
