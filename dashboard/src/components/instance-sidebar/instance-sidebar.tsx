// dashboard/src/components/instance-sidebar/instance-sidebar.tsx
import { cn, shortInstanceId } from "@/lib/utils";
import type { InstanceState } from "@/types/dashboard";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InstanceSidebarProps {
  instances: Map<string, InstanceState>;
  selectedId: string | null;
  onSelect: (instanceId: string) => void;
  onRemove?: (instanceId: string) => void;
}

export function InstanceSidebar({
  instances,
  selectedId,
  onSelect,
  onRemove,
}: InstanceSidebarProps) {
  const sorted = Array.from(instances.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === "online" ? -1 : 1;
    return a.instanceId.localeCompare(b.instanceId);
  });

  return (
    <aside
      className="flex h-full w-[340px] flex-col"
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
          {sorted.map((inst) => {
            const isOnline = inst.status === "online";
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
                      : isOnline
                        ? "text-[#6b8aaa] hover:text-[#c8d8e8]"
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
                  {/* Status indicator with pulse ring for online */}
                  <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                    {isOnline && (
                      <span
                        className="absolute inline-flex h-full w-full rounded-full animate-pulse-ring"
                        style={{ background: "#00d4ff", opacity: 0.4 }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      aria-label={inst.status}
                      className="relative inline-flex h-1.5 w-1.5 rounded-full"
                      style={{
                        background: isOnline ? "#00d4ff" : "#1a3356",
                        boxShadow: isOnline
                          ? "0 0 6px rgba(0,212,255,0.8)"
                          : undefined,
                      }}
                    />
                  </span>

                  {/* Instance label */}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {shortInstanceId(inst.instanceId)}
                  </span>

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

                {/* Remove button — sibling of select button to avoid nested <button> */}
                {!isOnline && onRemove && (
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

          {sorted.length === 0 && (
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
