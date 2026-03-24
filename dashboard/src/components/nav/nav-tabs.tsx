// dashboard/src/components/nav/nav-tabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, BarChart2, MessageSquare, Radio, Network } from "lucide-react";

const TABS = [
  { href: "/", label: "Command", icon: LayoutDashboard },
  { href: "/topics", label: "Topics", icon: Radio },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/conversations", label: "Signals", icon: MessageSquare },
  { href: "/graph", label: "Graph", icon: Network },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0" aria-label="Dashboard views">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-all duration-150",
              active
                ? "text-[#00d4ff]"
                : "text-[#3a5470] hover:text-[#6b8aaa]",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
            {/* Active underline */}
            {active && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, #00d4ff, transparent)",
                  boxShadow: "0 0 8px rgba(0,212,255,0.8)",
                }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
