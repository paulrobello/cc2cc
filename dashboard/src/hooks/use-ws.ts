// dashboard/src/hooks/use-ws.ts
"use client";

import { useContext } from "react";
import { WsContext } from "@/components/ws-provider/ws-provider";
import type { WsContextValue } from "@/types/dashboard";

/** Access the WebSocket context. Must be used inside <WsProvider>. */
export function useWs(): WsContextValue {
  return useContext(WsContext);
}
