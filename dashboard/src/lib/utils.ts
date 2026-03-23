// dashboard/src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MessageType } from "@cc2cc/shared";
import type { MessageTypeColor } from "@/types/dashboard";

/** shadcn/ui cn() helper */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Returns the Tailwind color token for a given message type.
 * Used to drive border, background, and badge colors consistently.
 */
export function messageTypeColor(
  type: MessageType | string,
  isBroadcast = false,
): MessageTypeColor {
  if (isBroadcast) return "purple";
  switch (type) {
    case MessageType.task:
      return "amber";
    case MessageType.result:
      return "green";
    case MessageType.question:
      return "blue";
    case MessageType.ack:
    case MessageType.ping:
      return "zinc";
    default:
      return "zinc";
  }
}

/**
 * Maps a color token to Tailwind classes for a left-border message row.
 */
export function messageColorClasses(color: MessageTypeColor): {
  border: string;
  bg: string;
  badge: string;
  text: string;
} {
  const map: Record<
    MessageTypeColor,
    { border: string; bg: string; badge: string; text: string }
  > = {
    amber: {
      border: "border-l-amber-500",
      bg: "bg-amber-950/20",
      badge: "bg-amber-400/10 text-amber-300",
      text: "text-amber-300",
    },
    green: {
      border: "border-l-emerald-400",
      bg: "bg-emerald-950/20",
      badge: "bg-emerald-400/10 text-emerald-300",
      text: "text-emerald-300",
    },
    blue: {
      border: "border-l-blue-400",
      bg: "bg-blue-950/20",
      badge: "bg-blue-400/10 text-blue-300",
      text: "text-blue-300",
    },
    purple: {
      border: "border-l-purple-400",
      bg: "bg-purple-950/20",
      badge: "bg-purple-400/10 text-purple-300",
      text: "text-purple-300",
    },
    zinc: {
      border: "border-l-slate-600",
      bg: "bg-slate-900/10",
      badge: "bg-slate-700/20 text-slate-400",
      text: "text-slate-400",
    },
  };
  return map[color];
}

/** Format an ISO 8601 timestamp for display in the feed (HH:MM:SS local time) */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Truncate a long instance ID for sidebar display */
export function shortInstanceId(instanceId: string): string {
  // "paul@macbook:cc2cc/a1b2c3d4-..." → "paul@macbook:cc2cc"
  const slashIdx = instanceId.lastIndexOf("/");
  return slashIdx !== -1 ? instanceId.slice(0, slashIdx) : instanceId;
}
