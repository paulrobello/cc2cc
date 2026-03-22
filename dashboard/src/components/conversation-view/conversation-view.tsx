// dashboard/src/components/conversation-view/conversation-view.tsx
"use client";

import { useMemo } from "react";
import {
  cn,
  messageTypeColor,
  messageColorClasses,
  shortInstanceId,
  formatTime,
} from "@/lib/utils";
import type { FeedMessage, InstanceState } from "@/types/dashboard";

interface ConversationViewProps {
  instances: Map<string, InstanceState>;
  feed: FeedMessage[];
  instanceA: string | null;
  instanceB: string | null;
  selectedMessage: FeedMessage | null;
  onSelectMessage: (entry: FeedMessage) => void;
}

function buildThreads(messages: FeedMessage[]): Map<string, FeedMessage[]> {
  const threads = new Map<string, FeedMessage[]>();
  for (const entry of messages) {
    const rootId =
      entry.message.replyToMessageId ?? entry.message.messageId;
    if (!threads.has(rootId)) threads.set(rootId, []);
    threads.get(rootId)!.push(entry);
  }
  return threads;
}

export function ConversationView({
  feed,
  instanceA,
  instanceB,
  selectedMessage,
  onSelectMessage,
}: ConversationViewProps) {
  const exchanged = useMemo(() => {
    if (!instanceA || !instanceB) return [];
    return feed.filter((entry) => {
      const { from, to } = entry.message;
      return (
        (from === instanceA && to === instanceB) ||
        (from === instanceB && to === instanceA) ||
        (to === "broadcast" && (from === instanceA || from === instanceB))
      );
    });
  }, [feed, instanceA, instanceB]);

  const threads = useMemo(() => buildThreads(exchanged), [exchanged]);

  if (!instanceA || !instanceB) {
    return (
      <div
        className="flex flex-1 items-center justify-center font-mono text-[11px] uppercase tracking-widest"
        style={{ color: "#1a3356" }}
      >
        — select two nodes to view signal exchange —
      </div>
    );
  }

  if (exchanged.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center font-mono text-[11px] uppercase tracking-widest"
        style={{ color: "#1a3356" }}
      >
        — no signals exchanged —
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {Array.from(threads.entries()).map(([rootId, msgs]) => (
        <div key={rootId} className="space-y-1.5">
          {/* Thread divider */}
          <div className="flex items-center gap-2">
            <div className="h-px flex-1" style={{ background: "#1a3356" }} />
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: "#2a5480" }}
            >
              thread:{rootId.slice(0, 8)}
            </span>
            <div className="h-px flex-1" style={{ background: "#1a3356" }} />
          </div>

          {msgs.map((entry) => {
            const isFromA = entry.message.from === instanceA;
            const color = messageTypeColor(entry.message.type, entry.isBroadcast);
            const classes = messageColorClasses(color);
            const isSelected =
              selectedMessage?.message.messageId === entry.message.messageId;

            return (
              <button
                key={entry.message.messageId}
                type="button"
                onClick={() => onSelectMessage(entry)}
                className={cn(
                  "flex w-full flex-col border-l-[3px] px-3 py-2.5 text-left transition-all duration-100",
                  classes.border,
                  isFromA ? "mr-10" : "ml-10",
                )}
                style={{
                  background: isSelected
                    ? "rgba(0,212,255,0.06)"
                    : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    e.currentTarget.style.background = "rgba(26,51,86,0.4)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "";
                }}
              >
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={cn("font-mono font-semibold", classes.text)}>
                    {shortInstanceId(entry.message.from)}
                  </span>
                  <span
                    className={cn(
                      "px-1.5 py-px font-mono font-bold uppercase tracking-wider",
                      classes.badge,
                    )}
                  >
                    {entry.isBroadcast ? "broadcast" : entry.message.type}
                  </span>
                  <span
                    className="ml-auto font-mono"
                    style={{ color: "#3a5470" }}
                  >
                    {formatTime(entry.message.timestamp)}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm" style={{ color: "#c8d8e8" }}>
                  {entry.message.content}
                </p>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
