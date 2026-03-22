// Stub for react-markdown in Jest (ESM-only package)
import React from "react";

export default function ReactMarkdown({ children }: { children: string }) {
  return <div data-testid="markdown">{children}</div>;
}
