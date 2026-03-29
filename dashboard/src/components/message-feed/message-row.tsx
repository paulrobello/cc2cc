// dashboard/src/components/message-feed/message-row.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  cn,
  messageTypeColor,
  messageColorClasses,
  formatTime,
  shortInstanceId,
} from "@/lib/utils";
import type { FeedMessage } from "@/types/dashboard";

interface MessageRowProps {
  entry: FeedMessage;
  senderRole?: string;
}

export function MessageRow({ entry, senderRole }: MessageRowProps) {
  const { message, isBroadcast } = entry;
  const color = messageTypeColor(message.type, isBroadcast);
  const classes = messageColorClasses(color);
  const typeLabel = isBroadcast ? "broadcast" : message.type;

  return (
    <div
      data-testid={`message-row-${message.messageId}`}
      className={cn(
        "animate-signal-in flex flex-col gap-1 border-l-[3px] px-3 py-2.5 transition-colors",
        classes.border,
        classes.bg,
      )}
    >
      {/* Header: type badge + from → to + timestamp */}
      <div className="flex items-center gap-2 text-[10px]">
        {/* Type badge — angular */}
        <span
          className={cn(
            "shrink-0 px-1.5 py-px font-mono font-bold uppercase tracking-wider",
            classes.badge,
          )}
        >
          {typeLabel}
        </span>

        {/* Route */}
        <span className="min-w-0 flex-1 truncate font-mono">
          <span className={cn("font-semibold", classes.text)}>
            {shortInstanceId(message.from)}
          </span>
          {senderRole && (
            <span
              className="ml-1 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wider"
              style={{ background: "rgba(0,212,255,0.1)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.2)" }}
            >
              {senderRole}
            </span>
          )}
          <span className="mx-1.5" style={{ color: "#2a5480" }}>
            ▶
          </span>
          <span style={{ color: "#3a5470" }}>
            {message.to === "broadcast" ? "(all)" : shortInstanceId(message.to)}
          </span>
        </span>

        <span className="shrink-0 font-mono" style={{ color: "#3a5470" }}>
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Content — rendered as markdown */}
      <div
        className="prose prose-sm max-w-none break-words text-sm leading-relaxed"
        style={{ color: "#c8d8e8" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
            code: ({ children, className }) => {
              const isBlock = className?.startsWith("language-");
              return isBlock ? (
                <code
                  className={cn("block overflow-x-auto rounded px-3 py-2 font-mono text-xs", className)}
                  style={{ background: "rgba(0,0,0,0.4)", color: "#7dd3fc" }}
                >
                  {children}
                </code>
              ) : (
                <code
                  className="rounded px-1 font-mono text-xs"
                  style={{ background: "rgba(0,0,0,0.4)", color: "#7dd3fc" }}
                >
                  {children}
                </code>
              );
            },
            pre: ({ children }) => (
              <pre
                className="mb-2 overflow-x-auto rounded p-0"
                style={{ background: "rgba(0,0,0,0.4)" }}
              >
                {children}
              </pre>
            ),
            ul: ({ children }) => <ul className="mb-1 ml-4 list-disc">{children}</ul>,
            ol: ({ children }) => <ol className="mb-1 ml-4 list-decimal">{children}</ol>,
            li: ({ children }) => <li className="mb-0.5">{children}</li>,
            strong: ({ children }) => (
              <strong className="font-semibold" style={{ color: "#e2e8f0" }}>{children}</strong>
            ),
            em: ({ children }) => <em style={{ color: "#94a3b8" }}>{children}</em>,
            h1: ({ children }) => <p className="mb-1 font-bold" style={{ color: "#e2e8f0" }}>{children}</p>,
            h2: ({ children }) => <p className="mb-1 font-semibold" style={{ color: "#e2e8f0" }}>{children}</p>,
            h3: ({ children }) => <p className="mb-0.5 font-semibold" style={{ color: "#cbd5e1" }}>{children}</p>,
            a: ({ href, children }) => (
              <a href={href} className="underline" style={{ color: "#38bdf8" }} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote
                className="mb-1 border-l-2 pl-3 italic"
                style={{ borderColor: "#2a5480", color: "#6b8aaa" }}
              >
                {children}
              </blockquote>
            ),
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Reply-to */}
      {message.replyToMessageId && (
        <p className="font-mono text-[10px]" style={{ color: "#2a5480" }}>
          ↳ re:{message.replyToMessageId.slice(0, 8)}&hellip;
        </p>
      )}
    </div>
  );
}
