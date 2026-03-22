// dashboard/src/app/topics/page.tsx
"use client";

import { useState } from "react";
import { useWs } from "@/hooks/use-ws";
import {
  createTopic,
  deleteTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
} from "@/lib/api";
import { MessageType } from "@cc2cc/shared";

export default function TopicsPage() {
  const { topics, instances, dashboardInstanceId, sendPublishTopic } = useWs();
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [content, setContent] = useState("");
  const [msgType, setMsgType] = useState<MessageType>(MessageType.task);
  const [persistent, setPersistent] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    delivered: number;
    queued: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = selectedTopic ? topics.get(selectedTopic) : null;
  const topicList = Array.from(topics.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  async function handleCreate() {
    if (!newTopicName.trim()) return;
    try {
      await createTopic(newTopicName.trim());
      setNewTopicName("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteTopic(name);
      if (selectedTopic === name) setSelectedTopic(null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const isSubscribed =
    selected?.subscribers.includes(dashboardInstanceId) ?? false;

  async function handleToggleSubscribe() {
    if (!selectedTopic) return;
    try {
      if (isSubscribed) {
        await unsubscribeFromTopic(selectedTopic, dashboardInstanceId);
      } else {
        await subscribeToTopic(selectedTopic, dashboardInstanceId);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handlePublish() {
    if (!selectedTopic || !content.trim()) return;
    try {
      await sendPublishTopic(selectedTopic, msgType, content.trim(), persistent);
      setPublishResult(null); // result comes via HubEvent; clear any old result
      setContent("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]" style={{ background: "#060d1a" }}>
      {/* Panel 1: Topic list */}
      <div
        className="w-64 shrink-0 flex flex-col"
        style={{ borderRight: "1px solid #1a3356" }}
      >
        <div
          className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}
        >
          Topics
        </div>
        <div
          className="flex gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid #1a3356" }}
        >
          <input
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="new topic name"
            className="flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-[#3a5470]"
            style={{ color: "#e2e8f0" }}
          />
          <button
            type="button"
            onClick={handleCreate}
            className="font-mono text-[10px] px-2 py-0.5 rounded"
            style={{
              background: "rgba(0,212,255,0.1)",
              border: "1px solid rgba(0,212,255,0.3)",
              color: "#00d4ff",
            }}
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {topicList.map((t) => (
            <div
              key={t.name}
              onClick={() => setSelectedTopic(t.name)}
              className="flex items-center justify-between px-3 py-2 cursor-pointer"
              style={{
                background:
                  selectedTopic === t.name
                    ? "rgba(0,212,255,0.05)"
                    : "transparent",
                borderLeft:
                  selectedTopic === t.name
                    ? "2px solid #00d4ff"
                    : "2px solid transparent",
              }}
            >
              <span
                className="font-mono text-xs"
                style={{
                  color: selectedTopic === t.name ? "#00d4ff" : "#6b8aaa",
                }}
              >
                ◈ {t.name}
              </span>
              <div className="flex items-center gap-1">
                <span
                  className="font-mono text-[9px]"
                  style={{ color: "#3a5470" }}
                >
                  {t.subscriberCount}
                </span>
                {t.subscriberCount === 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(t.name);
                    }}
                    className="font-mono text-[9px] px-1 rounded opacity-0 hover:opacity-100"
                    style={{ color: "#6b8aaa" }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          {topicList.length === 0 && (
            <div
              className="px-4 py-3 font-mono text-[10px]"
              style={{ color: "#3a5470" }}
            >
              No topics yet
            </div>
          )}
        </div>
      </div>

      {/* Panel 2: Subscribers */}
      <div
        className="flex-1 flex flex-col"
        style={{ borderRight: "1px solid #1a3356" }}
      >
        <div
          className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}
        >
          {selected ? `${selected.name} — Subscribers` : "Select a topic"}
        </div>
        {selected && (
          <>
            <div className="px-3 py-2" style={{ borderBottom: "1px solid #1a3356" }}>
              <button
                type="button"
                onClick={handleToggleSubscribe}
                className="font-mono text-[10px] px-3 py-1 rounded"
                style={{
                  background: isSubscribed
                    ? "rgba(168,85,247,0.1)"
                    : "rgba(0,212,255,0.1)",
                  border: `1px solid ${
                    isSubscribed
                      ? "rgba(168,85,247,0.3)"
                      : "rgba(0,212,255,0.3)"
                  }`,
                  color: isSubscribed ? "#a855f7" : "#00d4ff",
                }}
              >
                {isSubscribed
                  ? "Unsubscribe dashboard"
                  : "Subscribe dashboard"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {selected.subscribers.map((subId) => {
                const inst = instances.get(subId);
                return (
                  <div key={subId} className="flex items-center gap-2 px-3 py-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background:
                          inst?.status === "online" ? "#4ade80" : "#3a5470",
                      }}
                    />
                    <span
                      className="font-mono text-[10px] flex-1 truncate"
                      style={{ color: "#6b8aaa" }}
                    >
                      {subId}
                    </span>
                    {inst?.role && (
                      <span
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded"
                        style={{
                          background: "rgba(0,212,255,0.08)",
                          color: "#00d4ff",
                        }}
                      >
                        {inst.role}
                      </span>
                    )}
                  </div>
                );
              })}
              {selected.subscribers.length === 0 && (
                <div
                  className="px-4 py-3 font-mono text-[10px]"
                  style={{ color: "#3a5470" }}
                >
                  No subscribers
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Panel 3: Publish */}
      <div className="w-80 shrink-0 flex flex-col">
        <div
          className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}
        >
          Publish
        </div>
        <div className="flex-1 flex flex-col gap-3 p-4">
          <select
            value={msgType}
            onChange={(e) => setMsgType(e.target.value as MessageType)}
            className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none"
            style={{ borderColor: "#1a3356", color: "#6b8aaa" }}
          >
            {(["task", "result", "question", "ack"] as const).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Message content..."
            className="w-full bg-transparent font-mono text-xs border rounded p-2 outline-none resize-none placeholder:text-[#3a5470]"
            style={{ borderColor: "#1a3356", color: "#e2e8f0" }}
          />
          <label
            className="flex items-center gap-2 font-mono text-[10px]"
            style={{ color: "#6b8aaa" }}
          >
            <input
              type="checkbox"
              checked={persistent}
              onChange={(e) => setPersistent(e.target.checked)}
            />
            persistent (deliver to offline subscribers)
          </label>
          <button
            type="button"
            onClick={handlePublish}
            disabled={!selectedTopic || !content.trim()}
            className="w-full py-1.5 font-mono text-[10px] uppercase tracking-wider rounded disabled:opacity-40"
            style={{
              background: "rgba(0,212,255,0.1)",
              border: "1px solid rgba(0,212,255,0.3)",
              color: "#00d4ff",
            }}
          >
            Publish to {selectedTopic ?? "…"}
          </button>
          {publishResult && (
            <div className="font-mono text-[10px]" style={{ color: "#6b8aaa" }}>
              delivered: {publishResult.delivered} · queued:{" "}
              {publishResult.queued}
            </div>
          )}
          {error && (
            <div className="font-mono text-[10px]" style={{ color: "#f87171" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
