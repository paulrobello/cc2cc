// hub/src/topic-manager.ts
import { randomUUID } from "node:crypto";
import type { Message, TopicInfo } from "@cc2cc/shared";
import { redis } from "./redis.js";
import { pushMessage } from "./queue.js";

/** Parse the bare project segment from an instanceId. Exported for use in ws-handler. */
export function parseProject(instanceId: string): string {
  const colonPart = instanceId.split(":")[1] ?? "";
  return colonPart.split("/")[0] ?? instanceId;
}

/** WS-ref shape needed for live delivery in publishToTopic */
interface WsRef {
  readyState: number;
  send(data: string): void;
}

export const topicManager = {
  async createTopic(name: string, createdBy: string): Promise<TopicInfo> {
    const existing = await redis.hgetall(`topic:${name}`);
    if (existing?.name) {
      const subscribers = await redis.smembers(`topic:${name}:subscribers`);
      return {
        name: existing.name,
        createdAt: existing.createdAt ?? new Date().toISOString(),
        createdBy: existing.createdBy ?? createdBy,
        subscriberCount: subscribers.length,
      };
    }
    const now = new Date().toISOString();
    await redis.hset(`topic:${name}`, { name, createdAt: now, createdBy });
    return { name, createdAt: now, createdBy, subscriberCount: 0 };
  },

  async deleteTopic(name: string): Promise<void> {
    const members = await redis.smembers(`topic:${name}:subscribers`);
    await Promise.all(members.map((id) => redis.srem(`instance:${id}:topics`, name)));
    await redis.del(`topic:${name}:subscribers`);
    await redis.del(`topic:${name}`);
  },

  async subscribe(name: string, instanceId: string): Promise<void> {
    await redis.sadd(`topic:${name}:subscribers`, instanceId);
    await redis.sadd(`instance:${instanceId}:topics`, name);
  },

  async unsubscribe(name: string, instanceId: string): Promise<void> {
    if (name === parseProject(instanceId)) {
      throw new Error("cannot unsubscribe from auto-joined project topic");
    }
    await redis.srem(`topic:${name}:subscribers`, instanceId);
    await redis.srem(`instance:${instanceId}:topics`, name);
  },

  async getSubscribers(name: string): Promise<string[]> {
    return redis.smembers(`topic:${name}:subscribers`);
  },

  async getTopicsForInstance(instanceId: string): Promise<string[]> {
    return redis.smembers(`instance:${instanceId}:topics`);
  },

  async listTopics(): Promise<TopicInfo[]> {
    const keys = await redis.keys("topic:*");
    const topicKeys = keys.filter((k) => !k.includes(":subscribers") && !k.includes(":topics"));
    const results = await Promise.all(
      topicKeys.map(async (key) => {
        const name = key.replace("topic:", "");
        const data = await redis.hgetall(key);
        if (!data || !data.name) return null;
        const subscribers = await redis.smembers(`topic:${name}:subscribers`);
        return {
          name: data.name,
          createdAt: data.createdAt ?? "",
          createdBy: data.createdBy ?? "",
          subscriberCount: subscribers.length,
        } satisfies TopicInfo;
      }),
    );
    return results.filter((t): t is TopicInfo => t !== null);
  },

  async topicExists(name: string): Promise<boolean> {
    const data = await redis.hgetall(`topic:${name}`);
    return data !== null && !!data.name;
  },

  async publishToTopic(
    name: string,
    message: Message,
    persistent: boolean,
    senderInstanceId: string,
    wsRefs: Map<string, WsRef>,
  ): Promise<{ delivered: number; queued: number }> {
    const subscribers = await redis.smembers(`topic:${name}:subscribers`);
    const recipients = subscribers.filter((id) => id !== senderInstanceId);

    let delivered = 0;
    let queued = 0;

    for (const id of recipients) {
      const ws = wsRefs.get(id);
      const isOnline = ws !== undefined && ws.readyState === 1;

      if (isOnline) {
        ws.send(JSON.stringify(message));
        delivered++;
        if (persistent) {
          await pushMessage(id, message);
          queued++;
        }
      } else if (persistent) {
        // Offline subscriber — queue for later delivery
        await pushMessage(id, message);
        queued++;
      }
      // Offline + !persistent: skip (no delivery)
    }

    // Non-persistent path: increment daily stat directly
    if (!persistent) {
      await redis.incr("stats:messages:today");
    }

    return { delivered, queued };
  },
};
