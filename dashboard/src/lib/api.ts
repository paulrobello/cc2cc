// dashboard/src/lib/api.ts
import { InstanceInfoSchema, type MessageType } from "@cc2cc/shared";
import type { TopicInfo } from "@cc2cc/shared";
import { z } from "zod";
import type { HubStats } from "@/types/dashboard";

const HUB_BASE =
  process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL?.replace("ws://", "http://").replace(
    "wss://",
    "https://",
  ) ?? "http://localhost:3100";

const API_KEY = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";

function hubUrl(path: string): string {
  return `${HUB_BASE}${path}?key=${encodeURIComponent(API_KEY)}`;
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
    return { ...fallback, messagesToday: parsed.messagesToday };
  } catch {
    return fallback;
  }
}

/**
 * Send a direct message to a specific instance via the hub REST API.
 * Throws on network or non-ok response.
 */
export async function sendMessage(
  to: string,
  type: MessageType,
  content: string,
): Promise<void> {
  const res = await fetch(hubUrl("/api/messages"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, type, content }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Send message failed: ${res.status} ${res.statusText}`);
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

/**
 * Broadcast a message to all online instances via the hub REST API.
 * Throws on network or non-ok response.
 */
export async function sendBroadcast(
  type: MessageType,
  content: string,
): Promise<void> {
  const res = await fetch(hubUrl("/api/broadcast"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, content }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Broadcast failed: ${res.status} ${res.statusText}`);
  }
}

export async function fetchTopics(): Promise<TopicInfo[]> {
  const res = await fetch(hubUrl("/api/topics"));
  if (!res.ok) throw new Error("Failed to fetch topics");
  return res.json() as Promise<TopicInfo[]>;
}

export async function createTopic(name: string): Promise<TopicInfo> {
  const res = await fetch(hubUrl("/api/topics"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create topic");
  return res.json() as Promise<TopicInfo>;
}

export async function deleteTopic(name: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}`), { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? "Failed to delete topic");
  }
}

export async function subscribeToTopic(name: string, instanceId: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}/subscribe`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId }),
  });
  if (!res.ok) throw new Error("Failed to subscribe");
}

export async function unsubscribeFromTopic(name: string, instanceId: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/topics/${encodeURIComponent(name)}/unsubscribe`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId }),
  });
  if (!res.ok) throw new Error("Failed to unsubscribe");
}
