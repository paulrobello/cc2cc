// dashboard/src/app/conversations/page.tsx
"use client";

import { useState } from "react";
import { useWs } from "@/hooks/use-ws";
import { ConversationView } from "@/components/conversation-view/conversation-view";
import { MessageInspector } from "@/components/conversation-view/message-inspector";
import type { FeedMessage } from "@/types/dashboard";
import { cn, shortInstanceId } from "@/lib/utils";

export default function ConversationsPage() {
  const { instances, feed } = useWs();

  // Topic messages are not conversations — exclude from thread grouping
  const nonTopicFeed = feed.filter(
    (entry) => !entry.topicName && !entry.message.to?.startsWith?.("topic:"),
  );

  const [instanceA, setInstanceA] = useState<string | null>(null);
  const [instanceB, setInstanceB] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<FeedMessage | null>(null);

  function handleInstanceSelect(id: string) {
    if (id === instanceA) { setInstanceA(null); return; }
    if (id === instanceB) { setInstanceB(null); return; }
    if (!instanceA) { setInstanceA(id); return; }
    setInstanceB(id);
  }

  const selectionLabel = instanceA
    ? instanceB
      ? `${shortInstanceId(instanceA)} ↔ ${shortInstanceId(instanceB)}`
      : `${shortInstanceId(instanceA)} — pick second node`
    : "Pick two nodes to view signal exchange";

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Left: node picker */}
      <div
        className="flex w-60 flex-col"
        style={{ background: "#070f1e", borderRight: "1px solid #1a3356" }}
      >
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
          <p
            className="mt-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{ color: "#1a3356" }}
          >
            Select A then B
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-px" role="list">
            {Array.from(instances.values()).map((inst) => {
              const isA = inst.instanceId === instanceA;
              const isB = inst.instanceId === instanceB;
              const isOnline = inst.status === "online";

              return (
                <li key={inst.instanceId}>
                  <button
                    type="button"
                    onClick={() => handleInstanceSelect(inst.instanceId)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-all duration-100",
                    )}
                    style={{
                      borderLeft: isA
                        ? "2px solid #3b82f6"
                        : isB
                          ? "2px solid #a855f7"
                          : "2px solid transparent",
                      background: isA
                        ? "rgba(59,130,246,0.06)"
                        : isB
                          ? "rgba(168,85,247,0.06)"
                          : "transparent",
                      color: isA
                        ? "#93c5fd"
                        : isB
                          ? "#d8b4fe"
                          : isOnline
                            ? "#6b8aaa"
                            : "#3a5470",
                    }}
                  >
                    <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                      {isOnline && !isA && !isB && (
                        <span
                          className="absolute inline-flex h-full w-full rounded-full animate-pulse-ring"
                          style={{ background: "#00d4ff", opacity: 0.3 }}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full"
                        style={{
                          background: isOnline
                            ? isA
                              ? "#3b82f6"
                              : isB
                                ? "#a855f7"
                                : "#00d4ff"
                            : "#1a3356",
                          boxShadow: isOnline
                            ? isA
                              ? "0 0 6px rgba(59,130,246,0.8)"
                              : isB
                                ? "0 0 6px rgba(168,85,247,0.8)"
                                : "0 0 4px rgba(0,212,255,0.6)"
                            : undefined,
                          marginTop: "1px",
                        }}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                      {shortInstanceId(inst.instanceId)}
                    </span>
                    {isA && (
                      <span
                        className="shrink-0 font-mono text-[10px] font-bold"
                        style={{ color: "#60a5fa" }}
                      >
                        A
                      </span>
                    )}
                    {isB && (
                      <span
                        className="shrink-0 font-mono text-[10px] font-bold"
                        style={{ color: "#c084fc" }}
                      >
                        B
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Center: conversation */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Selection label */}
        <div
          className="shrink-0 px-4 py-2"
          style={{ borderBottom: "1px solid #1a3356", background: "#070f1e" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#3a5470" }}>
            {selectionLabel}
          </p>
        </div>
        <ConversationView
          instances={instances}
          feed={nonTopicFeed}
          instanceA={instanceA}
          instanceB={instanceB}
          selectedMessage={selectedMessage}
          onSelectMessage={setSelectedMessage}
        />
      </div>

      {/* Right: inspector */}
      <MessageInspector entry={selectedMessage} />
    </div>
  );
}
