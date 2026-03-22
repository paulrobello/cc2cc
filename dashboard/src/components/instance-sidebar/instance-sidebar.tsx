// dashboard/src/components/instance-sidebar/instance-sidebar.tsx
import { cn, shortInstanceId } from "@/lib/utils";
import type { InstanceState, TopicState } from "@/types/dashboard";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InstanceSidebarProps {
  instances: Map<string, InstanceState>;
  topics: Map<string, TopicState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove?: (instanceId: string) => void;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <li
      className="px-2.5 pb-0.5 pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.25em]"
      style={{ color: "#2a5480" }}
      aria-hidden="true"
    >
      {label}
    </li>
  );
}

export function InstanceSidebar({
  instances,
  topics,
  selectedId,
  onSelect,
  onRemove,
}: InstanceSidebarProps) {
  const topicList = Array.from(topics.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const online = Array.from(instances.values())
    .filter((i) => i.status === "online")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const offline = Array.from(instances.values())
    .filter((i) => i.status === "offline")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));

  return (
    <aside
      className="flex min-h-0 flex-1 w-full flex-col"
      style={{ background: "#070f1e", borderRight: "1px solid #1a3356" }}
    >
      {/* Header */}
      <div
        className="px-3 py-2.5"
        style={{ borderBottom: "1px solid #1a3356" }}
      >
        <h2
          className="text-[9px] font-bold uppercase tracking-[0.25em]"
          style={{ color: "#2a5480" }}
        >
          ◈ Nodes
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <ul className="space-y-px p-2" role="list">
          {/* Topics section */}
          {topicList.length > 0 && (
            <>
              <SectionHeader label="Topics" />
              {topicList.map((topic) => {
                const topicId = `topic:${topic.name}`;
                const isSelected = selectedId === topicId;
                return (
                  <li key={topicId} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onSelect(topicId)}
                      aria-pressed={isSelected}
                      aria-label={`Topic: ${topic.name}`}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-all duration-100",
                        isSelected
                          ? "bg-zinc-800 text-[#a855f7]"
                          : "text-[#6b8aaa] hover:text-[#c8d8e8]",
                      )}
                      style={
                        isSelected
                          ? {
                              background: "rgba(168,85,247,0.05)",
                              borderLeft: "2px solid #a855f7",
                              boxShadow: "inset 0 0 20px rgba(168,85,247,0.03)",
                            }
                          : { borderLeft: "2px solid transparent" }
                      }
                    >
                      <span
                        className="shrink-0 font-mono text-[11px]"
                        style={{ color: isSelected ? "#a855f7" : "#4a6480" }}
                        aria-hidden="true"
                      >
                        ◈
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {topic.name}
                      </span>
                      {topic.subscribers.length > 0 && (
                        <span
                          className="shrink-0 rounded px-1 font-mono text-[9px] font-bold"
                          style={{
                            background: "rgba(168,85,247,0.12)",
                            color: "#a855f7",
                          }}
                        >
                          {topic.subscribers.length}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </>
          )}

          {/* Online section */}
          {online.length > 0 && (
            <>
              <SectionHeader label="Online" />
              {online.map((inst) => {
                const isSelected = selectedId === inst.instanceId;
                return (
                  <li key={inst.instanceId} className="group flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onSelect(inst.instanceId)}
                      aria-pressed={isSelected}
                      aria-label={shortInstanceId(inst.instanceId)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-all duration-100",
                        isSelected
                          ? "bg-zinc-800 text-[#00d4ff]"
                          : "text-[#6b8aaa] hover:text-[#c8d8e8]",
                      )}
                      style={
                        isSelected
                          ? {
                              background: "rgba(0,212,255,0.05)",
                              borderLeft: "2px solid #00d4ff",
                              boxShadow: "inset 0 0 20px rgba(0,212,255,0.03)",
                            }
                          : { borderLeft: "2px solid transparent" }
                      }
                    >
                      {/* Status indicator with pulse ring */}
                      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                        <span
                          className="absolute inline-flex h-full w-full rounded-full animate-pulse-ring"
                          style={{ background: "#00d4ff", opacity: 0.4 }}
                          aria-hidden="true"
                        />
                        <span
                          aria-label="online"
                          className="relative inline-flex h-1.5 w-1.5 rounded-full"
                          style={{
                            background: "#00d4ff",
                            boxShadow: "0 0 6px rgba(0,212,255,0.8)",
                          }}
                        />
                      </span>

                      {/* Instance label */}
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {shortInstanceId(inst.instanceId)}
                      </span>

                      {/* Role badge */}
                      {inst.role && (
                        <span
                          className="shrink-0 rounded px-1 font-mono text-[9px]"
                          style={{
                            background: "rgba(0,212,255,0.08)",
                            color: "#00d4ff",
                          }}
                        >
                          [{inst.role}]
                        </span>
                      )}

                      {/* Queue depth */}
                      {inst.queueDepth > 0 && (
                        <span
                          className="shrink-0 font-mono text-[10px] font-bold"
                          style={{ color: "#f59e0b" }}
                        >
                          {inst.queueDepth}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </>
          )}

          {/* Offline section */}
          {offline.length > 0 && (
            <>
              <SectionHeader label="Offline" />
              {offline.map((inst) => {
                const isSelected = selectedId === inst.instanceId;
                return (
                  <li key={inst.instanceId} className="group flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onSelect(inst.instanceId)}
                      aria-pressed={isSelected}
                      aria-label={shortInstanceId(inst.instanceId)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-all duration-100",
                        isSelected
                          ? "bg-zinc-800 text-[#00d4ff]"
                          : "text-[#3a5470] hover:text-[#6b8aaa]",
                      )}
                      style={
                        isSelected
                          ? {
                              background: "rgba(0,212,255,0.05)",
                              borderLeft: "2px solid #00d4ff",
                              boxShadow: "inset 0 0 20px rgba(0,212,255,0.03)",
                            }
                          : { borderLeft: "2px solid transparent" }
                      }
                    >
                      {/* Status indicator */}
                      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                        <span
                          aria-label="offline"
                          className="relative inline-flex h-1.5 w-1.5 rounded-full"
                          style={{ background: "#1a3356" }}
                        />
                      </span>

                      {/* Instance label */}
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {shortInstanceId(inst.instanceId)}
                      </span>

                      {/* Role badge */}
                      {inst.role && (
                        <span
                          className="shrink-0 rounded px-1 font-mono text-[9px]"
                          style={{
                            background: "rgba(58,84,112,0.2)",
                            color: "#3a5470",
                          }}
                        >
                          [{inst.role}]
                        </span>
                      )}
                    </button>

                    {/* Remove button */}
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(inst.instanceId)}
                        aria-label={`Remove ${shortInstanceId(inst.instanceId)}`}
                        className="shrink-0 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-100 leading-none text-[#3a5470] hover:text-[#ef4444]"
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </>
          )}

          {topicList.length === 0 && online.length === 0 && offline.length === 0 && (
            <li
              className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-widest"
              style={{ color: "#1a3356" }}
            >
              — no nodes —
            </li>
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
