// dashboard/src/app/api/hub/[...path]/route.ts
//
// BFF (Backend-For-Frontend) proxy for all hub REST calls.
//
// The hub API key is read from the server-side env var CC2CC_HUB_API_KEY
// (no NEXT_PUBLIC_ prefix) and injected here, on the server, before the
// request is forwarded to the hub. The browser never sees the key.
//
// All dashboard client-side REST calls target /api/hub/<path> and this
// handler transparently forwards them to the real hub, preserving method,
// headers, and body.

import type { NextRequest } from "next/server";
import { toHttpUrl } from "@cc2cc/shared";

/** Hub HTTP base URL — server-side only. */
function hubBase(): string {
  const wsUrl =
    process.env.CC2CC_HUB_WS_URL ??
    process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ??
    "ws://localhost:3100";
  return toHttpUrl(wsUrl);
}

/** Hub API key — server-side only, never exposed to the browser. */
function hubApiKey(): string {
  return (
    process.env.CC2CC_HUB_API_KEY ??
    process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ??
    ""
  );
}

/** Headers to forward from the upstream hub response (exclude hop-by-hop). */
const FORWARDED_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
]);

async function proxyRequest(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
): Promise<Response> {
  const { path } = await params;
  const subPath = path.join("/");

  // Preserve the original query string (minus any ?key= the client may have
  // sent — it would be wrong anyway since the client has no key).
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `/api/${subPath}`,
    hubBase(),
  );
  // Forward non-key query params (e.g. ?limit=10)
  for (const [k, v] of incomingUrl.searchParams.entries()) {
    if (k !== "key") upstreamUrl.searchParams.set(k, v);
  }
  // Inject the server-side API key
  upstreamUrl.searchParams.set("key", hubApiKey());

  // Build forwarded headers — strip host, add auth
  const forwardHeaders = new Headers();
  const skipHeaders = new Set(["host", "connection", "transfer-encoding"]);
  for (const [k, v] of request.headers.entries()) {
    if (!skipHeaders.has(k.toLowerCase())) {
      forwardHeaders.set(k, v);
    }
  }
  forwardHeaders.set("Authorization", `Bearer ${hubApiKey()}`);

  // Forward body for mutating methods
  const hasBody =
    request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
      // @ts-expect-error — Node/Bun fetch supports duplex for streaming bodies
      duplex: hasBody ? "half" : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return Response.json(
      { error: "Hub unreachable", detail: String(err) },
      { status: 502 },
    );
  }

  // Copy response, forwarding selected headers
  const responseHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (FORWARDED_RESPONSE_HEADERS.has(k.toLowerCase())) {
      responseHeaders.set(k, v);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => proxyRequest(req, ctx.params);

export const POST = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => proxyRequest(req, ctx.params);

export const PUT = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => proxyRequest(req, ctx.params);

export const PATCH = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => proxyRequest(req, ctx.params);

export const DELETE = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => proxyRequest(req, ctx.params);
