// dashboard/src/components/message-feed/message-feed.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { MessageRow } from "./message-row";
import { cn } from "@/lib/utils";
import type { FeedMessage, InstanceState, TopicState } from "@/types/dashboard";
import { MessageType } from "@cc2cc/shared";

type FilterType = "all" | MessageType | "broadcast";

const FILTER_CHIPS: { label: string; value: FilterType }[] = [
  { label: "ALL", value: "all" },
  { label: "TASK", value: MessageType.task },
  { label: "RESULT", value: MessageType.result },
  { label: "QUERY", value: MessageType.question },
  { label: "CAST", value: "broadcast" },
  { label: "ACK", value: MessageType.ack },
];

interface MessageFeedProps {
  feed: FeedMessage[];
  filterInstanceId?: string | null;
  instances?: Map<string, InstanceState>;
  topics?: Map<string, TopicState>;
  feedFilter?: { kind: "all" | "direct" | "broadcast" | "topic"; topicName?: string };
  onFilterChange?: (f: { kind: "all" | "direct" | "broadcast" | "topic"; topicName?: string }) => void;
}

export function MessageFeed({
  feed,
  filterInstanceId,
  instances,
  topics,
  feedFilter,
  onFilterChange,
}: MessageFeedProps) {
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = feed.filter((entry) => {
    // Instance filter
    if (filterInstanceId) {
      const { from, to } = entry.message;
      if (from !== filterInstanceId && to !== filterInstanceId) return false;
    }
    // Feed filter (all/direct/broadcast/topic)
    if (feedFilter && feedFilter.kind !== "all") {
      if (feedFilter.kind === "direct") {
        if (entry.isBroadcast || entry.topicName) return false;
      } else if (feedFilter.kind === "broadcast") {
        if (!entry.isBroadcast) return false;
      } else if (feedFilter.kind === "topic") {
        if (entry.topicName !== feedFilter.topicName) return false;
      }
    }
    // Type filter
    if (typeFilter === "all") return true;
    if (typeFilter === "broadcast") return entry.isBroadcast;
    return entry.message.type === typeFilter && !entry.isBroadcast;
  });

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered.length, autoScroll]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Feed filter bar (all/direct/broadcast/topic) */}
      <div className="flex gap-1 px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid #1a3356" }}>
        {(["all", "direct", "broadcast"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onFilterChange?.({ kind })}
            className={cn(
              "px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              feedFilter?.kind === kind ? "text-[#00d4ff]" : "text-[#3a5470] hover:text-[#6b8aaa]",
            )}
          >
            {kind}
          </button>
        ))}
        <select
          value={feedFilter?.kind === "topic" ? (feedFilter.topicName ?? "") : ""}
          onChange={(e) =>
            e.target.value && onFilterChange?.({ kind: "topic", topicName: e.target.value })
          }
          className="font-mono text-[10px] bg-transparent border-0 outline-none cursor-pointer"
          style={{ color: feedFilter?.kind === "topic" ? "#00d4ff" : "#3a5470" }}
        >
          <option value="">topic ▾</option>
          {Array.from(topics?.values() ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Type filter strip */}
      <div
        className="flex items-center gap-px px-2 py-1.5"
        style={{ borderBottom: "1px solid #1a3356", background: "#070f1e" }}
      >
        {FILTER_CHIPS.map((chip) => {
          const active = typeFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setTypeFilter(chip.value)}
              className={cn(
                "px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest transition-all duration-100",
                active
                  ? "text-[#00d4ff]"
                  : "text-[#3a5470] hover:text-[#6b8aaa]",
              )}
              style={
                active
                  ? {
                      background: "rgba(0,212,255,0.06)",
                      borderBottom: "1px solid #00d4ff",
                    }
                  : { borderBottom: "1px solid transparent" }
              }
            >
              {chip.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider" style={{ color: "#3a5470" }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3"
              style={{ accentColor: "#00d4ff" }}
            />
            live
          </label>
          <span
            className="font-mono text-[9px] uppercase tracking-wider"
            style={{ color: "#3a5470" }}
          >
            {filtered.length} msg
          </span>
        </div>
      </div>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 ? (
          <div
            className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest"
            style={{ color: "#1a3356" }}
          >
            — no signal —
          </div>
        ) : (
          <div style={{ borderTop: "none" }}>
            {filtered.map((entry) => (
              <div
                key={entry.message.messageId}
                style={{ borderBottom: "1px solid rgba(26,51,86,0.5)" }}
              >
                <MessageRow entry={entry} senderRole={instances?.get(entry.message.from)?.role} />
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}
