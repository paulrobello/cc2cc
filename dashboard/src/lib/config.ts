// dashboard/src/lib/config.ts
//
// Centralised environment variable access for the dashboard.
// Import from here instead of accessing process.env inline so that all
// configuration reads are in one place and easy to audit.

/**
 * WebSocket URL for the cc2cc hub.
 * Falls back to ws://localhost:3100 for local development.
 * Only used as a fallback — the BFF /api/hub/ws-config endpoint delivers the
 * real URL at runtime so the API key is never baked into the browser bundle.
 */
export const HUB_WS_URL =
  process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100";

/**
 * API key for the cc2cc hub (browser-public env var).
 * In production this should be left unset and delivered via /api/hub/ws-config
 * so it is never included in the client bundle.
 */
export const HUB_API_KEY = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";
