// hub/src/registry.ts
import type { InstanceInfo, InstanceStatus } from "@cc2cc/shared";
import { redis } from "./redis.js";

interface RegistryEntry extends InstanceInfo {
  // ws is intentionally kept out of InstanceInfo (shared type must not import Bun types)
  wsRef?: unknown; // set by ws-handler when plugin connects; used for live delivery check
  role?: string;
}

/**
 * In-memory map from instanceId → RegistryEntry.
 * Redis keys provide the durable presence layer (24h TTL).
 */
const _map = new Map<string, RegistryEntry>();

function parseProject(instanceId: string): string {
  // Format: username@host:project/session_uuid
  const colonPart = instanceId.split(":")[1] ?? "";
  return colonPart.split("/")[0] ?? instanceId;
}

export const registry = {
  /**
   * Register a new instance or re-register an existing one (reconnect).
   * Sets Redis presence key with 24h TTL.
   */
  async register(instanceId: string, project: string, role?: string): Promise<RegistryEntry> {
    const now = new Date().toISOString();
    const entry: RegistryEntry = {
      instanceId,
      project: project || parseProject(instanceId),
      status: "online" as InstanceStatus,
      connectedAt: now,
      queueDepth: 0,
      role,
    };
    _map.set(instanceId, entry);
    await redis.set(
      `instance:${instanceId}`,
      JSON.stringify({ instanceId, project: entry.project, connectedAt: now, role }),
      "EX",
      86400,
    );
    return entry;
  },

  /**
   * Mark an instance offline in the in-memory map.
   * Redis key TTL continues — the queue remains accessible.
   */
  markOffline(instanceId: string): void {
    const entry = _map.get(instanceId);
    if (entry) {
      entry.status = "offline";
    }
  },

  /** Attach or detach the live WebSocket reference for this instance. */
  setWsRef(instanceId: string, ws: unknown | null): void {
    const entry = _map.get(instanceId);
    if (entry) {
      entry.wsRef = ws ?? undefined;
    }
  },

  /** Return the live WebSocket reference, or undefined if offline/not set. */
  getWsRef(instanceId: string): unknown | undefined {
    return _map.get(instanceId)?.wsRef;
  },

  get(instanceId: string): RegistryEntry | undefined {
    return _map.get(instanceId);
  },

  getAll(): RegistryEntry[] {
    return Array.from(_map.values());
  },

  getOnline(): RegistryEntry[] {
    return Array.from(_map.values()).filter((e) => e.status === "online");
  },

  /** Update cached queue depth (called after each push/pop). */
  setQueueDepth(instanceId: string, depth: number): void {
    const entry = _map.get(instanceId);
    if (entry) entry.queueDepth = depth;
  },

  /** Set or update the role for an instance. Persists to Redis with 24h TTL. */
  async setRole(instanceId: string, role: string): Promise<RegistryEntry> {
    const entry = _map.get(instanceId);
    if (!entry) throw new Error(`instance not found: ${instanceId}`);
    entry.role = role;
    await redis.set(
      `instance:${instanceId}`,
      JSON.stringify({ instanceId, project: entry.project, connectedAt: entry.connectedAt, role }),
      "EX",
      86400,
    );
    return entry;
  },

  /**
   * Resolve a partial address (username@host:project) to a full instanceId.
   * A partial address has no "/" in it — it matches any instance whose ID
   * starts with `partial + "/"`.
   */
  resolvePartial(partial: string): { instanceId: string; warning?: string } | { error: string } {
    const prefix = partial + "/";
    const allMatches = Array.from(_map.values()).filter((e) => e.instanceId.startsWith(prefix));
    const onlineMatches = allMatches.filter((e) => e.status === "online");

    if (onlineMatches.length === 1) {
      return { instanceId: onlineMatches[0].instanceId };
    }
    if (onlineMatches.length >= 2) {
      return {
        error: `ambiguous address: ${onlineMatches.length} instances match, use full instanceId`,
      };
    }
    // 0 online — check offline
    const offlineMatches = allMatches.filter((e) => e.status === "offline");
    if (offlineMatches.length === 1) {
      return {
        instanceId: offlineMatches[0].instanceId,
        warning: "recipient offline, message queued",
      };
    }
    if (offlineMatches.length >= 2) {
      return {
        error: `ambiguous address: ${offlineMatches.length} instances match, use full instanceId`,
      };
    }
    return { error: "no instance found matching partial address" };
  },

  /**
   * Remove an instance entirely — delete from in-memory map and Redis.
   */
  async deregister(instanceId: string): Promise<void> {
    _map.delete(instanceId);
    await redis.del(`instance:${instanceId}`);
  },

  /** For testing — clears all entries. */
  clear(): void {
    _map.clear();
  },
};
