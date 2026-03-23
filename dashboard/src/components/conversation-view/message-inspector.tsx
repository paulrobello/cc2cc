// dashboard/src/components/conversation-view/message-inspector.tsx
import type { FeedMessage } from "@/types/dashboard";
import { cn } from "@/lib/utils";

interface MessageInspectorProps {
  entry: FeedMessage | null;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | undefined | null;
  mono?: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[5.5rem_1fr] gap-x-2 py-1.5"
      style={{ borderBottom: "1px solid #1a3356" }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-widest"
        style={{ color: "#2a5480" }}
      >
        {label}
      </span>
      <span
        className={cn("break-all text-[11px]", mono && "font-mono")}
        style={{ color: value ? "#6b8aaa" : "#1a3356" }}
      >
        {value ?? <span className="italic">—</span>}
      </span>
    </div>
  );
}

export function MessageInspector({ entry }: MessageInspectorProps) {
  if (!entry) {
    return (
      <aside
        className="flex h-full w-64 flex-col items-center justify-center font-mono text-[10px] uppercase tracking-widest"
        style={{
          background: "#070f1e",
          borderLeft: "1px solid #1a3356",
          color: "#1a3356",
        }}
      >
        — select signal —
      </aside>
    );
  }

  const { message, receivedAt, isBroadcast } = entry;
  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col"
      style={{ background: "#070f1e", borderLeft: "1px solid #1a3356" }}
    >
      {/* Header */}
      <div
        className="px-3 py-2.5"
        style={{ borderBottom: "1px solid #1a3356" }}
      >
        <h3
          className="text-[9px] font-bold uppercase tracking-[0.25em]"
          style={{ color: "#00d4ff" }}
        >
          ◈ Signal Inspect
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <Field label="ID" value={message.messageId} mono />
        <Field
          label="Type"
          value={isBroadcast ? "broadcast" : message.type}
        />
        <Field label="From" value={message.from} mono />
        <Field label="To" value={message.to} mono />
        <Field label="Timestamp" value={message.timestamp} mono />
        <Field label="Received" value={receivedAt.toISOString()} mono />
        <Field label="Reply To" value={message.replyToMessageId} mono />

        {message.metadata && (
          <div className="mt-3">
            <span
              className="text-[9px] font-bold uppercase tracking-widest"
              style={{ color: "#2a5480" }}
            >
              Metadata
            </span>
            <pre
              className="mt-1 overflow-auto p-2 font-mono text-[10px] leading-relaxed"
              style={{
                background: "#0d1f38",
                border: "1px solid #1a3356",
                color: "#6b8aaa",
              }}
            >
              {JSON.stringify(message.metadata, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-3">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "#2a5480" }}
          >
            Content
          </span>
          <pre
            className="mt-1 whitespace-pre-wrap break-words p-2 font-mono text-xs leading-relaxed"
            style={{
              background: "#0d1f38",
              border: "1px solid #1a3356",
              color: "#c8d8e8",
            }}
          >
            {message.content}
          </pre>
        </div>
      </div>
    </aside>
  );
}
