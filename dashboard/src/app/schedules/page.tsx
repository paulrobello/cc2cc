// dashboard/src/app/schedules/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useWs } from "@/hooks/use-ws";
import {
  createSchedule as apiCreateSchedule,
  updateSchedule as apiUpdateSchedule,
  deleteSchedule as apiDeleteSchedule,
} from "@/lib/api";
import { MessageType } from "@cc2cc/shared";
import type { ScheduleState } from "@/types/dashboard";

/** Convert common cron patterns to human-readable strings */
function humanCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;

  // Every N minutes: */N * * * *
  if (min.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const n = min.slice(2);
    return `every ${n}m`;
  }
  // Every hour at minute N: N * * * *
  if (!min.includes("*") && !min.includes("/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return `every hour at :${min.padStart(2, "0")}`;
  }
  // Every N hours: 0 */N * * *
  if (min === "0" && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    const n = hour.slice(2);
    return `every ${n}h`;
  }
  // Daily at H:M: M H * * *
  if (!min.includes("*") && !min.includes("/") && !hour.includes("*") && !hour.includes("/") && dom === "*" && month === "*" && dow === "*") {
    return `daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  // Every minute: * * * * *
  if (expr.trim() === "* * * * *") return "every 1m";

  return expr;
}

/** Convert ISO timestamp to relative string */
function relativeTime(iso: string): string {
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diffMs = target - now;

  if (diffMs < -60_000) return "overdue";
  if (diffMs < 0) return "now";

  const diffS = Math.round(diffMs / 1000);
  const diffM = Math.round(diffS / 60);
  const diffH = Math.floor(diffM / 60);
  const remM = diffM % 60;

  if (diffM < 1) return `in ${diffS}s`;
  if (diffH === 0) return `in ${diffM}m`;
  if (remM === 0) return `in ${diffH}h`;
  return `in ${diffH}h ${remM}m`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SchedulesPage() {
  const { schedules, refreshSchedules } = useWs();

  useEffect(() => {
    refreshSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New schedule form state
  const [newName, setNewName] = useState("");
  const [newExpr, setNewExpr] = useState("*/5 * * * *");
  const [newTarget, setNewTarget] = useState("broadcast");
  const [newMsgType, setNewMsgType] = useState<MessageType>(MessageType.task);
  const [newContent, setNewContent] = useState("");
  const [newPersistent, setNewPersistent] = useState(false);
  const [newMaxFires, setNewMaxFires] = useState("");
  const [newExpires, setNewExpires] = useState("");

  // Derived
  const scheduleList: ScheduleState[] = Array.from(schedules.values()).sort(
    (a, b) => new Date(a.nextFireAt).getTime() - new Date(b.nextFireAt).getTime(),
  );
  const selected = selectedId ? schedules.get(selectedId) ?? null : null;

  async function handleCreate() {
    if (!newName.trim() || !newExpr.trim() || !newTarget.trim() || !newContent.trim()) return;
    try {
      await apiCreateSchedule({
        name: newName.trim(),
        expression: newExpr.trim(),
        target: newTarget.trim(),
        messageType: newMsgType,
        content: newContent.trim(),
        persistent: newPersistent,
        maxFireCount: newMaxFires ? Number(newMaxFires) : undefined,
        expiresAt: newExpires ? new Date(newExpires).toISOString() : undefined,
      });
      // Reset form
      setNewName("");
      setNewExpr("*/5 * * * *");
      setNewTarget("broadcast");
      setNewMsgType(MessageType.task);
      setNewContent("");
      setNewPersistent(false);
      setNewMaxFires("");
      setNewExpires("");
      setCreating(false);
      setError(null);
      await refreshSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(scheduleId: string) {
    try {
      await apiDeleteSchedule(scheduleId);
      if (selectedId === scheduleId) setSelectedId(null);
      setError(null);
      await refreshSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleEnabled() {
    if (!selected) return;
    try {
      await apiUpdateSchedule(selected.scheduleId, { enabled: !selected.enabled });
      setError(null);
      await refreshSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]" style={{ background: "#060d1a" }}>
      {/* ── Left panel: Schedule list ────────────────────────────────── */}
      <div
        className="w-72 shrink-0 flex flex-col"
        style={{ borderRight: "1px solid #1a3356" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid #1a3356" }}
        >
          <span
            className="font-mono text-xs uppercase tracking-widest"
            style={{ color: "#00d4ff" }}
          >
            Schedules
          </span>
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            className="font-mono text-[10px] px-2 py-0.5 rounded"
            style={{
              background: creating
                ? "rgba(248,113,113,0.1)"
                : "rgba(0,212,255,0.1)",
              border: `1px solid ${creating ? "rgba(248,113,113,0.3)" : "rgba(0,212,255,0.3)"}`,
              color: creating ? "#f87171" : "#00d4ff",
            }}
          >
            {creating ? "Cancel" : "+ New"}
          </button>
        </div>

        {/* Inline create form */}
        {creating && (
          <div
            className="flex flex-col gap-2 px-3 py-3"
            style={{ borderBottom: "1px solid #1a3356" }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none placeholder:text-[#3a5470]"
              style={{ borderColor: "#1a3356", color: "#e2e8f0" }}
            />
            <input
              value={newExpr}
              onChange={(e) => setNewExpr(e.target.value)}
              placeholder="Cron expression (e.g. */5 * * * *)"
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none placeholder:text-[#3a5470]"
              style={{ borderColor: "#1a3356", color: "#e2e8f0" }}
            />
            <input
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="Target (broadcast, topic:name, instanceId)"
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none placeholder:text-[#3a5470]"
              style={{ borderColor: "#1a3356", color: "#e2e8f0" }}
            />
            <select
              value={newMsgType}
              onChange={(e) => setNewMsgType(e.target.value as MessageType)}
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none"
              style={{ borderColor: "#1a3356", color: "#6b8aaa", background: "#060d1a" }}
            >
              {(["task", "result", "question", "ack"] as const).map((t) => (
                <option key={t} value={t} style={{ background: "#060d1a" }}>
                  {t}
                </option>
              ))}
            </select>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={3}
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
                checked={newPersistent}
                onChange={(e) => setNewPersistent(e.target.checked)}
              />
              persistent
            </label>
            <input
              value={newMaxFires}
              onChange={(e) => setNewMaxFires(e.target.value)}
              placeholder="Max fires (optional)"
              type="number"
              min="1"
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none placeholder:text-[#3a5470]"
              style={{ borderColor: "#1a3356", color: "#e2e8f0" }}
            />
            <input
              value={newExpires}
              onChange={(e) => setNewExpires(e.target.value)}
              type="datetime-local"
              placeholder="Expires at (optional)"
              className="w-full bg-transparent font-mono text-xs border rounded px-2 py-1 outline-none"
              style={{ borderColor: "#1a3356", color: "#6b8aaa", background: "#060d1a" }}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || !newExpr.trim() || !newTarget.trim() || !newContent.trim()}
              className="w-full py-1 font-mono text-[10px] uppercase tracking-wider rounded disabled:opacity-40"
              style={{
                background: "rgba(0,212,255,0.1)",
                border: "1px solid rgba(0,212,255,0.3)",
                color: "#00d4ff",
              }}
            >
              Create
            </button>
          </div>
        )}

        {/* Schedule list */}
        <div className="flex-1 overflow-y-auto">
          {scheduleList.map((s) => (
            <div
              key={s.scheduleId}
              onClick={() => setSelectedId(s.scheduleId)}
              className="group flex items-start justify-between px-3 py-2 cursor-pointer"
              style={{
                opacity: s.enabled ? 1 : 0.4,
                background:
                  selectedId === s.scheduleId
                    ? "rgba(0,212,255,0.05)"
                    : "transparent",
                borderLeft:
                  selectedId === s.scheduleId
                    ? "2px solid #00d4ff"
                    : "2px solid transparent",
              }}
            >
              <div className="flex flex-col min-w-0">
                <span
                  className="font-mono text-xs truncate"
                  style={{
                    color: selectedId === s.scheduleId ? "#00d4ff" : "#e2e8f0",
                  }}
                >
                  {s.name}
                </span>
                <span
                  className="font-mono text-[10px]"
                  style={{ color: "#3a5470" }}
                >
                  {humanCron(s.expression)}
                </span>
                <span
                  className="font-mono text-[9px]"
                  style={{ color: "#6b8aaa" }}
                >
                  {relativeTime(s.nextFireAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(s.scheduleId);
                }}
                className="font-mono text-[10px] px-1 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "#f87171" }}
                title="Delete schedule"
              >
                ×
              </button>
            </div>
          ))}
          {scheduleList.length === 0 && (
            <div
              className="px-4 py-3 font-mono text-[10px]"
              style={{ color: "#3a5470" }}
            >
              No schedules yet
            </div>
          )}
        </div>
      </div>

      {/* ── Center panel: Schedule detail ──────────────────────────────── */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ borderRight: "1px solid #1a3356" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid #1a3356" }}
        >
          <span
            className="font-mono text-xs uppercase tracking-widest"
            style={{ color: "#00d4ff" }}
          >
            {selected ? selected.name : "Select a schedule"}
          </span>
          {selected && (
            <button
              type="button"
              onClick={handleToggleEnabled}
              className="font-mono text-[10px] px-3 py-1 rounded"
              style={{
                background: selected.enabled
                  ? "rgba(248,113,113,0.1)"
                  : "rgba(74,222,128,0.1)",
                border: `1px solid ${selected.enabled ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)"}`,
                color: selected.enabled ? "#f87171" : "#4ade80",
              }}
            >
              {selected.enabled ? "Disable" : "Enable"}
            </button>
          )}
        </div>

        {selected && (
          <div className="flex-1 overflow-y-auto p-4">
            {/* Key-value grid */}
            <div
              className="grid gap-x-6 gap-y-2 mb-4"
              style={{ gridTemplateColumns: "max-content 1fr" }}
            >
              {[
                ["Expression", selected.expression],
                ["Human", humanCron(selected.expression)],
                ["Target", selected.target],
                ["Type", selected.messageType],
                ["Next fire", `${new Date(selected.nextFireAt).toLocaleString()} (${relativeTime(selected.nextFireAt)})`],
                ["Fire count", String(selected.fireCount)],
                ["Max fires", selected.maxFireCount != null ? String(selected.maxFireCount) : "—"],
                ["Persistent", selected.persistent ? "yes" : "no"],
                ["Created by", selected.createdBy],
                ["Created at", new Date(selected.createdAt).toLocaleString()],
                ["Expires", selected.expiresAt ? new Date(selected.expiresAt).toLocaleString() : "—"],
                ["Last fired", selected.lastFiredAt ? new Date(selected.lastFiredAt).toLocaleString() : "—"],
              ].map(([label, value]) => (
                <>
                  <span
                    key={`label-${label}`}
                    className="font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "#3a5470" }}
                  >
                    {label}
                  </span>
                  <span
                    key={`value-${label}`}
                    className="font-mono text-[10px] break-all"
                    style={{ color: "#6b8aaa" }}
                  >
                    {value}
                  </span>
                </>
              ))}
            </div>

            {/* Content block */}
            <div
              className="font-mono text-[10px] uppercase tracking-wider mb-1"
              style={{ color: "#3a5470" }}
            >
              Content
            </div>
            <pre
              className="font-mono text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap break-all"
              style={{
                background: "rgba(0,212,255,0.03)",
                border: "1px solid #1a3356",
                color: "#e2e8f0",
              }}
            >
              {selected.content}
            </pre>
          </div>
        )}
      </div>

      {/* ── Right panel: Fire history ────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col">
        <div
          className="px-4 py-3 font-mono text-xs uppercase tracking-widest"
          style={{ color: "#00d4ff", borderBottom: "1px solid #1a3356" }}
        >
          Fire History
        </div>
        <div className="flex-1 overflow-y-auto">
          {selected && selected.recentFires.length > 0 ? (
            [...selected.recentFires].reverse().map((fire, idx) => (
              <div
                key={`${fire.timestamp}-${idx}`}
                className="flex items-center justify-between px-3 py-2"
                style={{ borderBottom: "1px solid rgba(26,51,86,0.5)" }}
              >
                <span
                  className="font-mono text-[10px]"
                  style={{ color: "#6b8aaa" }}
                >
                  {formatTimestamp(fire.timestamp)}
                </span>
                <span
                  className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(0,212,255,0.08)",
                    color: "#00d4ff",
                  }}
                >
                  #{fire.fireCount}
                </span>
              </div>
            ))
          ) : (
            <div
              className="px-4 py-3 font-mono text-[10px]"
              style={{ color: "#3a5470" }}
            >
              {selected
                ? "No fires observed this session"
                : "Select a schedule to view fire history"}
            </div>
          )}
        </div>
      </div>

      {/* ── Error toast ─────────────────────────────────────────────── */}
      {error && (
        <div
          className="fixed bottom-4 right-4 flex items-center gap-3 px-4 py-3 rounded font-mono text-[10px] z-50"
          style={{
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            color: "#f87171",
            maxWidth: "400px",
          }}
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0"
            style={{ color: "#f87171" }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
