// dashboard/src/components/manual-send-bar/manual-send-bar.tsx
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shortInstanceId } from "@/lib/utils";
import { MessageType } from "@cc2cc/shared";
import type { InstanceState } from "@/types/dashboard";
import { useWs } from "@/hooks/use-ws";

interface ManualSendBarProps {
  instances: InstanceState[];
  disabled: boolean;
  onError?: (err: unknown) => void;
}

const MESSAGE_TYPES = [
  MessageType.task,
  MessageType.result,
  MessageType.question,
  MessageType.ack,
];

export function ManualSendBar({
  instances,
  disabled,
  onError,
}: ManualSendBarProps) {
  const { sendMessage, sendBroadcast } = useWs();
  const [to, setTo] = useState<string>("broadcast");
  const [messageType, setMessageType] = useState<MessageType>(MessageType.task);
  const [content, setContent] = useState("");

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      if (to === "broadcast") {
        await sendBroadcast(messageType, trimmed);
      } else {
        await sendMessage(to, messageType, trimmed);
      }
      setContent("");
    } catch (err) {
      onError?.(err);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const canSend = !disabled && !!content.trim();

  return (
    <div
      className="px-3 py-2.5"
      style={{ borderTop: "1px solid #1a3356", background: "#070f1e" }}
    >
      {/* Controls row */}
      <div className="mb-2 flex gap-2">
        <Select
          value={to}
          onValueChange={(value: string | null) => {
            if (value !== null) setTo(value);
          }}
        >
          <SelectTrigger
            className="h-7 w-52 font-mono text-[11px]"
            style={{
              background: "#0d1f38",
              border: "1px solid #1a3356",
              color: "#6b8aaa",
            }}
          >
            <SelectValue placeholder="Select target" />
          </SelectTrigger>
          <SelectContent
            style={{ background: "#0d1f38", border: "1px solid #1a3356" }}
          >
            <SelectItem
              value="broadcast"
              className="font-mono text-[11px]"
              style={{ color: "#a855f7" }}
            >
              ⬡ broadcast (all online)
            </SelectItem>
            {instances.map((inst) => (
              <SelectItem
                key={inst.instanceId}
                value={inst.instanceId}
                disabled={inst.status === "offline"}
                className="font-mono text-[11px]"
                style={{ color: inst.status === "offline" ? "#3a5470" : "#6b8aaa" }}
              >
                {shortInstanceId(inst.instanceId)}
                {inst.status === "offline" && " (offline)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={messageType}
          onValueChange={(value: string | null) => {
            if (value !== null) setMessageType(value as MessageType);
          }}
        >
          <SelectTrigger
            className="h-7 w-28 font-mono text-[11px] uppercase tracking-wider"
            style={{
              background: "#0d1f38",
              border: "1px solid #1a3356",
              color: "#6b8aaa",
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            style={{ background: "#0d1f38", border: "1px solid #1a3356" }}
          >
            {MESSAGE_TYPES.map((t) => (
              <SelectItem
                key={t}
                value={t}
                className="font-mono text-[11px] uppercase tracking-wider"
                style={{ color: "#6b8aaa" }}
              >
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Textarea + send */}
      <div className="flex gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Transmit signal… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={disabled}
          className="flex-1 resize-none font-mono text-xs leading-relaxed outline-none transition-all"
          style={{
            background: "#0d1f38",
            border: "1px solid #1a3356",
            color: "#c8d8e8",
            padding: "6px 10px",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#00d4ff";
            e.currentTarget.style.boxShadow = "0 0 0 1px rgba(0,212,255,0.15)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#1a3356";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="Send message"
          className="flex w-9 shrink-0 items-center justify-center transition-all duration-150"
          style={{
            background: canSend ? "rgba(0,212,255,0.12)" : "#0d1f38",
            border: `1px solid ${canSend ? "#00d4ff" : "#1a3356"}`,
            color: canSend ? "#00d4ff" : "#2a5480",
            boxShadow: canSend ? "0 0 8px rgba(0,212,255,0.2)" : "none",
            cursor: canSend ? "pointer" : "not-allowed",
          }}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
