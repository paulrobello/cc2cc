// dashboard/src/components/activity-timeline/activity-timeline.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Extract project name from an InstanceState (falls back to "unknown"). */
function instanceProject(inst: InstanceState): string {
  return inst.project || "unknown";
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

  /** Collapsed project sections (project name → collapsed). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapsed = useCallback((project: string) => {
    setCollapsed((prev) => ({ ...prev, [project]: !prev[project] }));
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

  /** Group instances by project, sorted alphabetically. */
  const projectGroups = useMemo(() => {
    const groups = new Map<string, InstanceState[]>();
    for (const inst of instances.values()) {
      const proj = instanceProject(inst);
      const list = groups.get(proj);
      if (list) {
        list.push(inst);
      } else {
        groups.set(proj, [inst]);
      }
    }
    // Sort projects alphabetically, instances within each group alphabetically
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [, insts] of sorted) {
      insts.sort((a, b) =>
        shortInstanceId(a.instanceId).localeCompare(
          shortInstanceId(b.instanceId),
        ),
      );
    }
    return sorted;
  }, [instances]);

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
        <div className="mb-2">
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

        {/* Project groups */}
        <div className="space-y-3">
          {projectGroups.map(([project, projectInstances]) => {
            const isCollapsed = collapsed[project] ?? false;
            const onlineCount = projectInstances.filter(
              (i) => i.status === "online",
            ).length;
            return (
              <div key={project}>
                {/* Project header */}
                <button
                  type="button"
                  onClick={() => toggleCollapsed(project)}
                  className="mb-1.5 flex w-full items-center gap-2 text-left"
                >
                  <span
                    className="font-mono text-[9px] transition-transform duration-150"
                    style={{
                      color: "#2a5480",
                      display: "inline-block",
                      transform: isCollapsed
                        ? "rotate(-90deg)"
                        : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                  <span
                    className="font-mono text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: "#4a8ac0" }}
                  >
                    {project}
                  </span>
                  <span
                    className="font-mono text-[9px]"
                    style={{ color: "#2a5480" }}
                  >
                    {onlineCount}/{projectInstances.length}
                  </span>
                  <span
                    className="flex-1 h-px"
                    style={{ background: "#1a335680" }}
                  />
                </button>

                {/* Collapsible instance rows */}
                {!isCollapsed && (
                  <div className="space-y-2 pl-3">
                    {projectInstances.map((inst) => {
                      const buckets = grid.get(inst.instanceId) ?? [];
                      const isOnline = inst.status === "online";
                      return (
                        <div key={inst.instanceId}>
                          {/* Instance label — above grid */}
                          <div className="mb-0.5 flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2 shrink-0">
                              {isOnline && (
                                <span
                                  className="absolute inline-flex h-full w-full rounded-full animate-pulse-ring"
                                  style={{
                                    background: "#00d4ff",
                                    opacity: 0.3,
                                  }}
                                  aria-hidden="true"
                                />
                              )}
                              <span
                                className={cn(
                                  "relative inline-flex h-1.5 w-1.5 rounded-full",
                                )}
                                style={{
                                  background: isOnline ? "#00d4ff" : "#1a3356",
                                  boxShadow: isOnline
                                    ? "0 0 4px rgba(0,212,255,0.8)"
                                    : undefined,
                                  marginTop: "1px",
                                }}
                              />
                            </span>
                            <span
                              className="font-mono text-[10px]"
                              style={{
                                color: isOnline ? "#6b8aaa" : "#3a5470",
                              }}
                            >
                              {shortInstanceId(inst.instanceId)}
                              {inst.role && (
                                <span
                                  className="ml-1.5 rounded px-1 py-px text-[8px] uppercase tracking-wider"
                                  style={{
                                    background: "#1a335640",
                                    border: "1px solid #2a548060",
                                    color: "#5a8ab0",
                                  }}
                                >
                                  {inst.role}
                                </span>
                              )}
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
                                      <div
                                        key={dotIdx}
                                        className={
                                          dotIdx > 0
                                            ? "mt-1 border-t border-[#1a3356] pt-1"
                                            : ""
                                        }
                                      >
                                        <p
                                          className="font-bold uppercase tracking-wider"
                                          style={{ color: dot.hex }}
                                        >
                                          {dot.label}
                                        </p>
                                        <p style={{ color: "#6b8aaa" }}>
                                          {dot.content}
                                        </p>
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
                )}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
