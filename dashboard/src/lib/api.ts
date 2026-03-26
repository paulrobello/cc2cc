// dashboard/src/lib/api.ts
//
// All hub REST calls are routed through the Next.js BFF proxy at /api/hub/...
// The hub API key is injected server-side by the proxy — this module never
// reads or transmits NEXT_PUBLIC_CC2CC_HUB_API_KEY.
import { InstanceInfoSchema, TopicInfoSchema } from "@cc2cc/shared";
import type { TopicInfo } from "@cc2cc/shared";

/** Topic with subscriber list — returned by GET /api/topics?includeSubscribers=true (ARC-008). */
export type TopicWithSubscribers = TopicInfo & { subscribers: string[] };
import { z } from "zod";
import type { HubStats } from "@/types/dashboard";

/**
 * Build a proxy-relative URL for a hub REST path.
 * All calls go through /api/hub/<path> where the BFF proxy adds auth.
 */
function hubUrl(path: string): string {
  // path begins with /api/ — strip that prefix because the proxy mounts at
  // /api/hub/ and the catch-all segment captures everything after that.
  // e.g. /api/instances  →  /api/hub/instances
  const subPath = path.replace(/^\/api\//, "");
  return `/api/hub/${subPath}`;
}

const HubStatsSchema = z.object({
  messagesToday: z.number(),
  activeInstances: z.number(),
  queuedTotal: z.number(),
  uptime: z.number().optional(), // not returned by all hub versions
});

/**
 * Fetch all instances (online + offline) from the hub REST API.
 * Returns an empty array on error so the UI degrades gracefully.
 */
export async function fetchInstances(): Promise<
  z.infer<typeof InstanceInfoSchema>[]
> {
  try {
    const res = await fetch(hubUrl("/api/instances"), {
      next: { revalidate: 0 }, // always fresh
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return z.array(InstanceInfoSchema).parse(data);
  } catch {
    return [];
  }
}

/**
 * Fetch aggregate stats from the hub REST API.
 * Returns zeroed stats on error.
 */
export async function fetchStats(): Promise<HubStats> {
  const fallback: HubStats = {
    messagesToday: 0,
    activeInstances: 0,
    queuedTotal: 0,
  };
  try {
    const res = await fetch(hubUrl("/api/stats"), {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const parsed = HubStatsSchema.parse(data);
    return {
      messagesToday: parsed.messagesToday,
      activeInstances: parsed.activeInstances,
      queuedTotal: parsed.queuedTotal,
    };
  } catch {
    return fallback;
  }
}

/**
 * Remove a stale offline instance from the hub registry.
 * Throws on network or non-ok response (including 409 if instance is online).
 */
export async function removeInstance(instanceId: string): Promise<void> {
  const res = await fetch(
    hubUrl(`/api/instances/${encodeURIComponent(instanceId)}`),
    {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Remove instance failed: ${res.status}`,
    );
  }
}

export async function fetchTopics(): Promise<TopicInfo[]> {
  const res = await fetch(hubUrl("/api/topics"), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Failed to fetch topics");
  const data = await res.json();
  return z.array(TopicInfoSchema).parse(data);
}

/**
 * Fetch all topics with their subscriber lists in a single HTTP request.
 * Uses GET /api/topics?includeSubscribers=true to avoid N+1 requests (ARC-008).
 * Returns an empty array on error so callers degrade gracefully.
 */
export async function fetchTopicsWithSubscribers(): Promise<TopicWithSubscribers[]> {
  try {
    const res = await fetch(hubUrl("/api/topics?includeSubscribers=true"), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return z
      .array(TopicInfoSchema.extend({ subscribers: z.array(z.string()) }))
      .parse(data);
  } catch {
    return [];
  }
}

/**
 * Fetch the subscriber list for a single topic.
 * Returns an empty array on error so callers degrade gracefully.
 */
export async function fetchTopicSubscribers(name: string): Promise<string[]> {
  try {
    const res = await fetch(
      hubUrl(`/api/topics/${encodeURIComponent(name)}/subscribers`),
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    return res.json() as Promise<string[]>;
  } catch {
    return [];
  }
}

export async function createTopic(name: string): Promise<TopicInfo> {
  const res = await fetch(hubUrl("/api/topics"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Failed to create topic");
  const data = await res.json();
  return TopicInfoSchema.parse(data);
}

export async function deleteTopic(name: string): Promise<void> {
  const res = await fetch(
    hubUrl(`/api/topics/${encodeURIComponent(name)}`),
    {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete topic");
  }
}

export async function subscribeToTopic(
  name: string,
  instanceId: string,
): Promise<void> {
  const res = await fetch(
    hubUrl(`/api/topics/${encodeURIComponent(name)}/subscribe`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error("Failed to subscribe");
}

export async function unsubscribeFromTopic(
  name: string,
  instanceId: string,
): Promise<void> {
  const res = await fetch(
    hubUrl(`/api/topics/${encodeURIComponent(name)}/unsubscribe`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to unsubscribe");
  }
}
