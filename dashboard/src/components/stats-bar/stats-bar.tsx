// dashboard/src/components/stats-bar/stats-bar.tsx
import { cn } from "@/lib/utils";

interface StatItem {
  label: string;
  value: number | string;
  /** Optional Tailwind text-color class override */
  colorClass?: string;
}

interface StatsBarProps {
  stats: StatItem[];
  className?: string;
}

export function StatsBar({ stats, className }: StatsBarProps) {
  return (
    <div
      className={cn("flex items-stretch", className)}
      style={{ background: "#070f1e", borderBottom: "1px solid #1a3356" }}
    >
      {stats.map((stat, idx) => (
        <div
          key={stat.label}
          className="flex flex-col items-start justify-center px-6 py-3"
          style={
            idx < stats.length - 1
              ? { borderRight: "1px solid #1a3356" }
              : undefined
          }
        >
          <span
            className="text-[9px] font-bold uppercase tracking-[0.2em]"
            style={{ color: "#3a5470" }}
          >
            {stat.label}
          </span>
          <span
            className={cn(
              "font-mono text-xl font-semibold tabular-nums leading-tight",
              stat.colorClass ?? "text-[#c8d8e8]",
            )}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}
