// dashboard/src/components/activity-timeline/activity-timeline.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  cn,
  messageTypeColor,
  shortInstanceId,
} from "@/lib/utils";
import type { MessageTypeColor } from "@/types/dashboard";
import type { FeedMessage, InstanceState } from "@/types/dashboard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActivityTimelineProps {
  instances: Map<string, InstanceState>;
  feed: FeedMessage[];
  windowMinutes?: number;
}

export function ActivityTimeline({
  instances,
  feed,
  windowMinutes = 10,
}: ActivityTimelineProps) {
  const BUCKET_COUNT = 20;
  const windowMs = windowMinutes * 60 * 1000;
  const bucketMs = windowMs / BUCKET_COUNT;

  // Track wall-clock "now" with a stable ref updated by a 5-second interval.
  // Using a ref + state pair avoids stale Date.now() captures inside useMemo:
  // the state tick forces a re-render, and the ref always has the latest value.
  // eslint-disable-next-line react-hooks/purity -- Date.now() in useRef is safe: the initial value is only evaluated once
  const nowMsRef = useRef(Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      nowMsRef.current = Date.now();
      setTick((t) => t + 1);
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  /** Hex colors for activity dots — keyed by MessageTypeColor token. */
  const dotColors: Record<MessageTypeColor, string> = {
    amber: "#f59e0b",
    green: "#34d399",
    blue: "#60a5fa",
    purple: "#c084fc",
    zinc: "#94a3b8",
  };

  const grid = useMemo(() => {
    const nowMs = nowMsRef.current;
    type BucketEntry = { hex: string; label: string; content: string };
    const map = new Map<string, BucketEntry[][]>();

    for (const inst of instances.values()) {
      map.set(
        inst.instanceId,
        Array.from({ length: BUCKET_COUNT }, () => []),
      );
    }

    for (const entry of feed) {
      const entryMs = entry.receivedAt.getTime();
      const age = nowMs - entryMs;
      if (age < 0 || age > windowMs) continue;

      const bucketIndex = Math.floor((windowMs - age) / bucketMs);
      const clampedIndex = Math.min(bucketIndex, BUCKET_COUNT - 1);

      const targetId =
        entry.message.to !== "broadcast" && instances.has(entry.message.to)
          ? entry.message.to
          : entry.message.from;

      const bucket = map.get(targetId);
      if (bucket) {
        const colorToken = messageTypeColor(entry.message.type, entry.isBroadcast);
        bucket[clampedIndex].push({
          hex: dotColors[colorToken],
          label: entry.isBroadcast ? "broadcast" : entry.message.type,
          content: entry.message.content.slice(0, 80),
        });
      }
    }

    return map;
  }, [instances, feed, windowMs, bucketMs]);

  if (instances.size === 0) {
    return (
      <div
        className="flex h-24 items-center justify-center font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "#1a3356" }}
      >
        — no nodes registered —
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        {/* Time axis */}
        <div className="mb-2" style={{ marginLeft: "13rem" }}>
          <div className="flex">
            <span
              className="flex-1 text-left font-mono text-[9px] uppercase tracking-wider"
              style={{ color: "#2a5480" }}
            >
              -{windowMinutes}m
            </span>
            <span
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: "#2a5480" }}
            >
              now
            </span>
          </div>
          {/* Tick line */}
          <div
            className="mt-0.5 h-px"
            style={{
              background:
                "linear-gradient(90deg, #1a3356, #2a5480 50%, #00d4ff)",
            }}
          />
        </div>

        {/* Instance rows */}
        <div className="space-y-1.5">
          {Array.from(instances.values()).map((inst) => {
            const buckets = grid.get(inst.instanceId) ?? [];
            const isOnline = inst.status === "online";
            return (
              <div key={inst.instanceId} className="flex items-center gap-2">
                {/* Instance label */}
                <div className="flex w-52 shrink-0 items-center gap-2">
                  <span
                    className="relative flex h-2 w-2 shrink-0"
                  >
                    {isOnline && (
                      <span
                        className="absolute inline-flex h-full w-full rounded-full animate-pulse-ring"
                        style={{ background: "#00d4ff", opacity: 0.3 }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={cn("relative inline-flex h-1.5 w-1.5 rounded-full")}
                      style={{
                        background: isOnline ? "#00d4ff" : "#1a3356",
                        boxShadow: isOnline ? "0 0 4px rgba(0,212,255,0.8)" : undefined,
                        marginTop: "1px",
                      }}
                    />
                  </span>
                  <span
                    className="min-w-0 truncate font-mono text-[10px]"
                    style={{ color: isOnline ? "#6b8aaa" : "#3a5470" }}
                  >
                    {shortInstanceId(inst.instanceId)}
                  </span>
                </div>

                {/* Bucket cells */}
                <div className="flex flex-1 gap-px">
                  {buckets.map((dots, bucketIdx) => {
                    const hasActivity = dots.length > 0;
                    return hasActivity ? (
                        <Tooltip key={bucketIdx}>
                          <TooltipTrigger>
                            <div
                              className="relative flex h-7 items-center justify-center gap-0.5 cursor-default"
                              style={{
                                background: `${dots[0].hex}12`,
                                border: `1px solid ${dots[0].hex}40`,
                              }}
                            >
                              {dots.slice(0, 3).map((dot, dotIdx) => (
                                <span
                                  key={dotIdx}
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{
                                    background: dot.hex,
                                    boxShadow: `0 0 4px ${dot.hex}`,
                                  }}
                                  aria-label={`${dot.label}: ${dot.content}`}
                                />
                              ))}
                              {dots.length > 3 && (
                                <span
                                  className="font-mono text-[8px] font-bold"
                                  style={{ color: "#00d4ff" }}
                                >
                                  +{dots.length - 3}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="max-w-xs text-xs"
                            style={{
                              background: "#0d1f38",
                              border: "1px solid #1a3356",
                              color: "#c8d8e8",
                            }}
                          >
                            {dots.map((dot, dotIdx) => (
                              <div key={dotIdx} className={dotIdx > 0 ? "mt-1 border-t border-[#1a3356] pt-1" : ""}>
                                <p className="font-bold uppercase tracking-wider" style={{ color: dot.hex }}>
                                  {dot.label}
                                </p>
                                <p style={{ color: "#6b8aaa" }}>{dot.content}</p>
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div
                          key={bucketIdx}
                          className="flex h-7 flex-1 items-center justify-center"
                          style={{
                            background: "#070f1e",
                            border: "1px solid #1a3356",
                          }}
                        />
                      );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
