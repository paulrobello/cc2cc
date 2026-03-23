// dashboard/src/components/connection-banner/ws-connection-banner-client.tsx
"use client";

import { useWs } from "@/hooks/use-ws";
import { ConnectionBanner } from "./connection-banner";

export function WsConnectionBannerClient() {
  const { connectionState } = useWs();
  return <ConnectionBanner state={connectionState} />;
}
