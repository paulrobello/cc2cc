// dashboard/src/components/connection-banner/connection-banner.tsx
import type { ConnectionState } from "@/types/dashboard";
import { cn } from "@/lib/utils";

interface ConnectionBannerProps {
  state: ConnectionState;
}

const CONFIG: Record<
  ConnectionState,
  { dotColor: string; label: string; textColor: string; borderColor: string }
> = {
  online: {
    dotColor: "#00d4ff",
    label: "hub online",
    textColor: "#00d4ff",
    borderColor: "#00d4ff40",
  },
  reconnecting: {
    dotColor: "#f59e0b",
    label: "reconnecting\u2026",
    textColor: "#f59e0b",
    borderColor: "#f59e0b40",
  },
  disconnected: {
    dotColor: "#ef4444",
    label: "disconnected",
    textColor: "#ef4444",
    borderColor: "#ef444440",
  },
};

export function ConnectionBanner({ state }: ConnectionBannerProps) {
  const { dotColor, label, textColor, borderColor } = CONFIG[state];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold tracking-widest",
        "uppercase",
        // Bare solid bg classes kept for test compatibility
        state === "online" && "bg-green-500",
        state === "reconnecting" && "bg-yellow-500",
        state === "disconnected" && "bg-red-500",
      )}
      style={{
        background:
          state === "online"
            ? "rgba(0,212,255,0.06)"
            : state === "reconnecting"
              ? "rgba(245,158,11,0.06)"
              : "rgba(239,68,68,0.06)",
        border: `1px solid ${borderColor}`,
        color: textColor,
      }}
    >
      <span
        className={cn(
          "relative h-1.5 w-1.5 shrink-0 rounded-full",
          state === "reconnecting" && "animate-pulse",
        )}
        style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
