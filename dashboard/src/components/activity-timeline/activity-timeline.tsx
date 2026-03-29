// dashboard/src/components/activity-timeline/activity-timeline.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Hex colors for activity dots — keyed by MessageTypeColor token. */
const dotColors: Record<MessageTypeColor, string> = {
  amber: "#f59e0b",
  green: "#34d399",
  blue: "#60a5fa",
  purple: "#c084fc",
  zinc: "#94a3b8",
};

interface DotData {
  key: string;
  /** Birth timestamp (ms since epoch) — immutable, drives the CSS animation. */
  birthMs: number;
  hex: string;
  label: string;
  content: string;
}

export function ActivityTimeline({
  instances,
  feed,
  windowMinutes = 10,
}: ActivityTimelineProps) {
  const windowMs = windowMinutes * 60 * 1000;

  // Periodic re-render only to add/remove dots and expired instances.
  // The actual dot motion is handled by CSS @keyframes animation.
  // nowMs is captured here (outside useMemo) so the React compiler
  // doesn't flag Date.now() as an impure call inside a memo.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  /** Collapsed project sections (project name -> collapsed). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapsed = useCallback((project: string) => {
    setCollapsed((prev) => ({ ...prev, [project]: !prev[project] }));
  }, []);

  /** Map of instanceId -> dots with birth timestamps. */
  const dotMap = useMemo(() => {
    const map = new Map<string, DotData[]>();

    for (const inst of instances.values()) {
      map.set(inst.instanceId, []);
    }

    for (const entry of feed) {
      const birthMs = entry.receivedAt.getTime();
      const age = nowMs - birthMs;
      if (age < 0 || age > windowMs) continue;

      const targetId =
        entry.message.to !== "broadcast" && instances.has(entry.message.to)
          ? entry.message.to
          : entry.message.from;

      const dots = map.get(targetId);
      if (dots) {
        const colorToken = messageTypeColor(
          entry.message.type,
          entry.isBroadcast,
        );
        const key = `${entry.message.messageId}-${targetId}`;

        dots.push({
          key,
          birthMs,
          hex: dotColors[colorToken],
          label: entry.isBroadcast ? "broadcast" : entry.message.type,
          content: entry.message.content.slice(0, 80),
        });
      }
    }

    return map;
  }, [instances, feed, windowMs, nowMs]);

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
      {/* Inject keyframes — animation goes from right edge (100%) to left edge (0%) */}
      <style>{`
        @keyframes lane-drift {
          from { left: 100%; }
          to   { left: 0%; }
        }
      `}</style>

      <div>
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
                  <div className="space-y-1 pl-3">
                    {projectInstances.map((inst) => {
                      const dots = dotMap.get(inst.instanceId) ?? [];
                      const isOnline = inst.status === "online";
                      return (
                        <div key={inst.instanceId}>
                          {/* Instance label */}
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

                          {/* Continuous timeline lane */}
                          <div
                            className="relative h-7 w-full overflow-hidden"
                            style={{
                              background: "#070f1e",
                              border: "1px solid #1a3356",
                              borderRadius: "2px",
                            }}
                          >
                            {dots.map((dot) => {
                              const delayMs = dot.birthMs - nowMs;
                              return (
                                <Tooltip key={dot.key}>
                                  <TooltipTrigger
                                    className="absolute cursor-default"
                                    style={{
                                      top: 0,
                                      width: "14px",
                                      height: "100%",
                                      marginLeft: "-7px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      animationName: "lane-drift",
                                      animationDuration: `${windowMs}ms`,
                                      animationTimingFunction: "linear",
                                      animationIterationCount: 1,
                                      animationFillMode: "both",
                                      animationDelay: `${delayMs}ms`,
                                    }}
                                  >
                                    <span
                                      className="block h-2.5 w-2.5 rounded-full"
                                      style={{
                                        background: dot.hex,
                                        boxShadow: `0 0 6px ${dot.hex}, 0 0 2px ${dot.hex}`,
                                      }}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    align="center"
                                    className="max-w-xs text-xs"
                                    style={{
                                      background: "#0d1f38",
                                      border: "1px solid #1a3356",
                                      color: "#c8d8e8",
                                    }}
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
                                  </TooltipContent>
                                </Tooltip>
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
