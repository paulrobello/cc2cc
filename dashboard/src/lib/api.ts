// dashboard/src/lib/api.ts
import { InstanceInfoSchema, TopicInfoSchema } from "@cc2cc/shared";
import type { TopicInfo } from "@cc2cc/shared";
import { z } from "zod";
import type { HubStats } from "@/types/dashboard";

const HUB_BASE =
  process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL?.replace("ws://", "http://").replace(
    "wss://",
    "https://",
  ) ?? "http://localhost:3100";

const API_KEY = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";

/**
 * Build a hub REST URL. The ?key= query param is kept as a backward-compat fallback.
 * Prefer the Authorization header (see authHeaders) for new requests.
 */
function hubUrl(path: string): string {
  return `${HUB_BASE}${path}?key=${encodeURIComponent(API_KEY)}`;
}

/**
 * Returns Authorization header for hub REST requests.
 * Using both header and query param ensures compatibility during the migration window.
 */
function authHeaders(): Record<string, string> {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

const HubStatsSchema = z.object({
  messagesToday: z.number(),
  uptime: z.number(),
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
      headers: authHeaders(),
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
      headers: authHeaders(),
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const parsed = HubStatsSchema.parse(data);
    return { ...fallback, messagesToday: parsed.messagesToday };
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
      headers: authHeaders(),
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
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Failed to fetch topics");
  const data = await res.json();
  return z.array(TopicInfoSchema).parse(data);
}

/**
 * Fetch the subscriber list for a single topic.
 * Returns an empty array on error so callers degrade gracefully.
 */
export async function fetchTopicSubscribers(name: string): Promise<string[]> {
  try {
    const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}/subscribers`), {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return res.json() as Promise<string[]>;
  } catch {
    return [];
  }
}

export async function createTopic(name: string): Promise<TopicInfo> {
  const res = await fetch(hubUrl("/api/topics"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Failed to create topic");
  const data = await res.json();
  return TopicInfoSchema.parse(data);
}

export async function deleteTopic(name: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}`), {
    method: "DELETE",
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Failed to delete topic");
  }
}

export async function subscribeToTopic(name: string, instanceId: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}/subscribe`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ instanceId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Failed to subscribe");
}

export async function unsubscribeFromTopic(name: string, instanceId: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}/unsubscribe`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ instanceId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Failed to unsubscribe");
  }
}
