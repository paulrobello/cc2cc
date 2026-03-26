// dashboard/src/app/api/hub/ws-config/route.ts
//
// Returns the hub WebSocket URL and API key to the dashboard client.
//
// The API key is read server-side from CC2CC_HUB_API_KEY (no NEXT_PUBLIC_
// prefix) so it is never baked into the browser JS bundle. The client fetches
// this endpoint once on mount to obtain the credentials needed for its two
// direct WS connections (dashboard event stream + plugin sender).
//
// Response shape: { wsUrl: string; apiKey: string }
//
// Security note: this endpoint does not require its own authentication because
// the caller is already running on the same trusted LAN. For internet-facing
// deployments, add session-cookie authentication before returning the key.

export async function GET(): Promise<Response> {
  const wsUrl =
    process.env.CC2CC_HUB_WS_URL ??
    process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ??
    "ws://localhost:3100";

  const apiKey =
    process.env.CC2CC_HUB_API_KEY ??
    process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ??
    "";

  return Response.json(
    { wsUrl, apiKey },
    {
      headers: {
        // Prevent the key from being cached in shared / intermediate caches.
        "Cache-Control": "no-store",
      },
    },
  );
}
