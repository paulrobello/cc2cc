# Roles & Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free-form instance roles and persistent pub/sub topics to cc2cc, enabling team collaboration within and across projects.

**Architecture:** A new `TopicManager` in the hub owns all topic Redis operations (parallel to existing `BroadcastManager`). Topics are global, stored as Redis Sets with no TTL. The plugin gains five new MCP tools; the dashboard gains a Topics page and enhanced sidebar/feed/send UI.

**Tech Stack:** Bun + Hono + ioredis (hub), MCP SDK (plugin), Next.js 16 + React + Tailwind + shadcn/ui (dashboard), Zod v3 (shared schemas), bun:test (hub/plugin/shared), Jest + jsdom (dashboard)

**Spec:** `docs/superpowers/specs/2026-03-22-roles-topics-design.md`

---

## File Map

**Create:**
- `hub/src/topic-manager.ts` — all topic Redis operations
- `hub/tests/topic-manager.test.ts`
- `dashboard/src/app/topics/page.tsx` — Topics page (3-panel layout)
- `skill/skills/cc2cc/patterns/topics.md` — topic naming & usage guide

**Modify:**
- `packages/shared/src/types.ts` — add `TopicInfo`, extend `Message.to`, add `Message.topicName`, add `InstanceInfo.role`
- `packages/shared/src/schema.ts` — add `TopicInfoSchema`, extend `MessageSchema`, extend `InstanceInfoSchema`, add tool input schemas
- `packages/shared/src/events.ts` — add 6 new HubEvent types
- `packages/shared/src/index.ts` — export new types
- `hub/src/registry.ts` — add `role` to `RegistryEntry`, add `setRole()`
- `hub/tests/registry.test.ts` — tests for `setRole`
- `hub/src/ws-handler.ts` — auto-join on connect, session migration, 4 new frame handlers
- `hub/src/api.ts` — 7 new topic REST endpoints; add `randomUUID` import
- `hub/tests/api.test.ts` — topic endpoint tests (add `ws-handler` mock)
- `plugin/src/connection.ts` — intercept `subscriptions:sync` before request/reply correlator
- `plugin/src/channel.ts` — add `topic` attribute when `message.topicName` is set
- `plugin/src/tools.ts` — 5 new MCP tools
- `plugin/src/index.ts` — register 5 new MCP tools
- `skill/skills/cc2cc/SKILL.md` — add Roles and Topics sections
- `skill/.claude-plugin/plugin.json` — bump version
- `dashboard/src/types/dashboard.ts` — add `TopicState`, `FeedMessage.topicName`, extend `InstanceState` and `WsContextValue`
- `dashboard/src/components/ws-provider/ws-provider.tsx` — new state + handlers + `subscriptions:sync`
- `dashboard/src/components/instance-sidebar/instance-sidebar.tsx` — 3-group sort, role badge, topic chips
- `dashboard/src/components/manual-send-bar/manual-send-bar.tsx` — topics group in dropdown, `persistent` toggle
- `dashboard/src/components/message-feed/message-feed.tsx` — filter bar (All/Direct/Topic/Broadcast)
- `dashboard/src/components/nav/nav-tabs.tsx` — add Topics nav link
- `dashboard/src/app/page.tsx` — pass topics to sidebar + send bar
- `dashboard/src/app/conversations/page.tsx` — exclude topic messages from thread grouping
- `dashboard/src/lib/api.ts` — topic REST wrappers (use existing `hubUrl()` helper)

---

## Task 1: Shared Types & Schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schema.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Update `types.ts`**

  Add `TopicInfo` after `InstanceInfo`:
  ```typescript
  export interface TopicInfo {
    name: string;
    createdAt: string;   // ISO 8601
    createdBy: string;   // instanceId
    subscriberCount: number;
  }
  ```

  Add `role?: string` to `InstanceInfo`:
  ```typescript
  export interface InstanceInfo {
    instanceId: InstanceId;
    project: string;
    role?: string;         // NEW
    status: InstanceStatus;
    connectedAt: string;
    queueDepth: number;
  }
  ```

  Extend `Message`:
  ```typescript
  export interface Message {
    messageId: string;
    from: InstanceId;
    to: InstanceId | "broadcast" | `topic:${string}`;  // NEW: topic sentinel
    type: MessageType;
    content: string;
    replyToMessageId?: string;
    topicName?: string;    // NEW: present when delivered via topic routing
    metadata?: Record<string, unknown>;
    timestamp: string;
  }
  ```

  All consumers that branch on `msg.to` must add a `msg.to.startsWith("topic:")` guard alongside the existing `"broadcast"` check.

- [ ] **Step 2: Update `schema.ts`**

  Add `topicName` to `MessageSchema`:
  ```typescript
  export const MessageSchema = z.object({
    messageId: z.string().uuid(),
    from: z.string().min(1),
    to: z.string().min(1),
    type: MessageTypeSchema,
    content: z.string().min(1),
    replyToMessageId: z.string().uuid().optional(),
    topicName: z.string().optional(),    // NEW
    metadata: z.record(z.unknown()).optional(),
    timestamp: z.string().datetime(),
  });
  ```

  Add `role` to `InstanceInfoSchema`:
  ```typescript
  export const InstanceInfoSchema = z.object({
    instanceId: z.string().min(1),
    project: z.string().min(1),
    role: z.string().optional(),          // NEW
    status: z.enum(["online", "offline"]),
    connectedAt: z.string().datetime(),
    queueDepth: z.number().int().min(0),
  });
  ```

  Add `TopicInfoSchema` and new tool input schemas:
  ```typescript
  export const TopicInfoSchema = z.object({
    name: z.string().min(1),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1),
    subscriberCount: z.number().int().min(0),
  });

  export const SetRoleInputSchema = z.object({
    role: z.string().min(1),
  });

  export const SubscribeTopicInputSchema = z.object({
    topic: z.string().min(1),
  });

  export const UnsubscribeTopicInputSchema = z.object({
    topic: z.string().min(1),
  });

  export const PublishTopicInputSchema = z.object({
    topic: z.string().min(1),
    type: MessageTypeSchema,
    content: z.string().min(1),
    persistent: z.boolean().default(false),
    metadata: z.record(z.unknown()).optional(),
  });
  ```

- [ ] **Step 3: Add 6 new HubEvents to `events.ts`**

  ```typescript
  const TopicCreatedEventSchema = z.object({
    event: z.literal("topic:created"),
    name: z.string().min(1),
    createdBy: z.string().min(1),
    timestamp: z.string().datetime(),
  });

  const TopicDeletedEventSchema = z.object({
    event: z.literal("topic:deleted"),
    name: z.string().min(1),
    timestamp: z.string().datetime(),
  });

  const TopicSubscribedEventSchema = z.object({
    event: z.literal("topic:subscribed"),
    name: z.string().min(1),
    instanceId: z.string().min(1),
    timestamp: z.string().datetime(),
  });

  const TopicUnsubscribedEventSchema = z.object({
    event: z.literal("topic:unsubscribed"),
    name: z.string().min(1),
    instanceId: z.string().min(1),
    timestamp: z.string().datetime(),
  });

  const TopicMessageEventSchema = z.object({
    event: z.literal("topic:message"),
    name: z.string().min(1),
    message: MessageSchema,
    persistent: z.boolean(),
    delivered: z.number().int().min(0),
    queued: z.number().int().min(0),
    timestamp: z.string().datetime(),
  });

  const InstanceRoleUpdatedEventSchema = z.object({
    event: z.literal("instance:role_updated"),
    instanceId: z.string().min(1),
    role: z.string().min(1),
    timestamp: z.string().datetime(),
  });
  ```

  Add all 6 to `HubEventSchema` discriminated union. Export all inferred types.

- [ ] **Step 4: Update `index.ts` exports**

  Export `TopicInfo`, `TopicInfoSchema`, and all new tool input schemas.

- [ ] **Step 5: Run typecheck**

  ```bash
  make typecheck
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/shared/src/
  git commit -m "feat(shared): add TopicInfo, role fields, topicName, 6 new HubEvent types, tool input schemas"
  ```

---

## Task 2: Hub — TopicManager

**Files:**
- Create: `hub/src/topic-manager.ts`
- Create: `hub/tests/topic-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

  Note: the redis mock must include all operations `TopicManager` uses: `hset`, `hgetall`, `del`, `sadd`, `srem`, `smembers`, `sunionstore`, `keys`, `incr`. The `pushMessage` call in `publishToTopic` (persistent path) is called via `queue.js` — mock that module too.

  ```typescript
  // hub/tests/topic-manager.test.ts
  import { describe, it, expect, beforeEach, mock } from "bun:test";

  const redisMock = {
    hset: mock(async () => 1),
    hgetall: mock(async () => null as Record<string, string> | null),
    del: mock(async () => 1),
    sadd: mock(async () => 1),
    srem: mock(async () => 1),
    smembers: mock(async () => [] as string[]),
    sunionstore: mock(async () => 0),
    keys: mock(async () => [] as string[]),
    incr: mock(async () => 1),
    on: mock(() => {}),
  };

  const pushMessageMock = mock(async () => {});

  mock.module("../src/redis.js", () => ({
    redis: redisMock,
    checkRedisHealth: mock(async () => true),
  }));

  mock.module("../src/queue.js", () => ({
    pushMessage: pushMessageMock,
    getTotalQueued: mock(async () => 0),
    getMessagesTodayCount: mock(async () => 0),
    flushQueue: mock(async () => {}),
    replayProcessing: mock(async () => 0),
  }));

  const { topicManager } = await import("../src/topic-manager.js");

  function clearMocks() {
    Object.values(redisMock).forEach((m) => (m as ReturnType<typeof mock>).mockClear?.());
    pushMessageMock.mockClear();
  }

  describe("topicManager.createTopic", () => {
    beforeEach(() => {
      clearMocks();
      redisMock.hgetall.mockResolvedValue(null);
      redisMock.smembers.mockResolvedValue([]);
    });

    it("writes topic hash to Redis for a new topic", async () => {
      await topicManager.createTopic("cc2cc", "alice@srv:cc2cc/abc");
      expect(redisMock.hset).toHaveBeenCalledWith(
        "topic:cc2cc",
        expect.objectContaining({ name: "cc2cc", createdBy: "alice@srv:cc2cc/abc" }),
      );
    });

    it("returns TopicInfo with subscriberCount 0 for new topic", async () => {
      const info = await topicManager.createTopic("cc2cc", "alice@srv:cc2cc/abc");
      expect(info.name).toBe("cc2cc");
      expect(info.subscriberCount).toBe(0);
    });

    it("is idempotent — skips hset when topic already exists", async () => {
      redisMock.hgetall.mockResolvedValue({
        name: "cc2cc",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "alice@srv:cc2cc/abc",
      });
      redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
      await topicManager.createTopic("cc2cc", "bob@srv:cc2cc/xyz");
      expect(redisMock.hset).not.toHaveBeenCalled();
    });
  });

  describe("topicManager.subscribe / unsubscribe", () => {
    beforeEach(clearMocks);

    it("subscribe adds instanceId to both topic and reverse-index sets", async () => {
      await topicManager.subscribe("cc2cc", "alice@srv:cc2cc/abc");
      expect(redisMock.sadd).toHaveBeenCalledWith("topic:cc2cc:subscribers", "alice@srv:cc2cc/abc");
      expect(redisMock.sadd).toHaveBeenCalledWith("instance:alice@srv:cc2cc/abc:topics", "cc2cc");
    });

    it("unsubscribe removes from both sets for non-project topic", async () => {
      await topicManager.unsubscribe("other-topic", "alice@srv:cc2cc/abc");
      expect(redisMock.srem).toHaveBeenCalledWith("topic:other-topic:subscribers", "alice@srv:cc2cc/abc");
      expect(redisMock.srem).toHaveBeenCalledWith("instance:alice@srv:cc2cc/abc:topics", "other-topic");
    });

    it("unsubscribe throws when topic equals the auto-joined project topic", async () => {
      // instanceId project segment is "cc2cc" — matches topic name
      await expect(
        topicManager.unsubscribe("cc2cc", "alice@srv:cc2cc/abc"),
      ).rejects.toThrow("cannot unsubscribe from auto-joined project topic");
    });
  });

  describe("topicManager.deleteTopic", () => {
    beforeEach(() => {
      clearMocks();
      redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc", "bob@srv:cc2cc/xyz"]);
    });

    it("removes the topic from each subscriber's reverse index", async () => {
      await topicManager.deleteTopic("cc2cc");
      expect(redisMock.srem).toHaveBeenCalledWith("instance:alice@srv:cc2cc/abc:topics", "cc2cc");
      expect(redisMock.srem).toHaveBeenCalledWith("instance:bob@srv:cc2cc/xyz:topics", "cc2cc");
    });

    it("deletes the subscriber set and topic hash", async () => {
      await topicManager.deleteTopic("cc2cc");
      expect(redisMock.del).toHaveBeenCalledWith("topic:cc2cc:subscribers");
      expect(redisMock.del).toHaveBeenCalledWith("topic:cc2cc");
    });
  });

  describe("topicManager.publishToTopic", () => {
    const makeMsg = () => ({
      messageId: crypto.randomUUID(),
      from: "alice@srv:cc2cc/abc",
      to: "topic:cc2cc" as const,
      type: "task" as const,
      content: "hello",
      topicName: "cc2cc",
      timestamp: new Date().toISOString(),
    });

    it("returns delivered=0 queued=0 for empty subscriber list", async () => {
      redisMock.smembers.mockResolvedValue([]);
      const result = await topicManager.publishToTopic(
        "cc2cc", makeMsg() as never, false, "alice@srv:cc2cc/abc", new Map(),
      );
      expect(result.delivered).toBe(0);
      expect(result.queued).toBe(0);
    });

    it("persistent=true queues message for offline subscriber", async () => {
      redisMock.smembers.mockResolvedValue(["bob@srv:cc2cc/xyz"]);
      // bob has no WS ref → offline
      await topicManager.publishToTopic(
        "cc2cc", makeMsg() as never, true, "alice@srv:cc2cc/abc", new Map(),
      );
      expect(pushMessageMock).toHaveBeenCalledWith("bob@srv:cc2cc/xyz", expect.any(Object));
    });

    it("persistent=false increments stats counter once", async () => {
      redisMock.smembers.mockResolvedValue([]);
      await topicManager.publishToTopic(
        "cc2cc", makeMsg() as never, false, "alice@srv:cc2cc/abc", new Map(),
      );
      expect(redisMock.incr).toHaveBeenCalledWith("stats:messages:today");
    });

    it("excludes sender from delivery", async () => {
      const senderWs = { readyState: 1, send: mock(() => {}) };
      redisMock.smembers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
      const wsRefs = new Map([["alice@srv:cc2cc/abc", senderWs]]);
      await topicManager.publishToTopic(
        "cc2cc", makeMsg() as never, false, "alice@srv:cc2cc/abc", wsRefs,
      );
      expect(senderWs.send).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd hub && bun test tests/topic-manager.test.ts
  ```
  Expected: FAIL — `topic-manager.js` not found.

- [ ] **Step 3: Implement `hub/src/topic-manager.ts`**

  Important: `TopicInfo` is imported from `@cc2cc/shared` — do NOT define a local interface.

  ```typescript
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
      if (existing && existing.name) {
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
      await Promise.all(
        members.map((id) => redis.srem(`instance:${id}:topics`, name)),
      );
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
      const topicKeys = keys.filter(
        (k) => !k.includes(":subscribers") && !k.includes(":topics"),
      );
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
        }

        if (persistent) {
          await pushMessage(id, message);
          queued++;
        }
      }

      // Non-persistent path: increment daily stat directly (persistent path uses pushMessage which already increments)
      if (!persistent) {
        await redis.incr("stats:messages:today");
      }

      return { delivered, queued };
    },
  };
  ```

- [ ] **Step 4: Run tests — all should pass**

  ```bash
  cd hub && bun test tests/topic-manager.test.ts
  ```

- [ ] **Step 5: Run full hub tests**

  ```bash
  cd hub && bun test
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add hub/src/topic-manager.ts hub/tests/topic-manager.test.ts
  git commit -m "feat(hub): add TopicManager with Redis-backed pub/sub topic operations"
  ```

---

## Task 3: Hub — Registry Role Support

**Files:**
- Modify: `hub/src/registry.ts`
- Modify: `hub/tests/registry.test.ts`

- [ ] **Step 1: Write failing tests — add to `hub/tests/registry.test.ts`**

  Add a new `describe` block and one additional `it` at the top level:

  ```typescript
  describe("registry.setRole", () => {
    beforeEach(() => {
      registry.clear();
      redisMock.set.mockClear();
    });

    it("updates role in-memory and returns updated entry", async () => {
      await registry.register("alice@srv:cc2cc/abc", "cc2cc");
      const updated = await registry.setRole("alice@srv:cc2cc/abc", "backend");
      expect(updated.role).toBe("backend");
      expect(registry.get("alice@srv:cc2cc/abc")?.role).toBe("backend");
    });

    it("re-writes Redis with EX 86400 and role in the JSON blob", async () => {
      await registry.register("alice@srv:cc2cc/abc", "cc2cc");
      redisMock.set.mockClear();
      await registry.setRole("alice@srv:cc2cc/abc", "backend");
      expect(redisMock.set).toHaveBeenCalledWith(
        "instance:alice@srv:cc2cc/abc",
        expect.stringContaining('"role":"backend"'),
        "EX",
        86400,
      );
    });

    it("throws for an unknown instanceId", async () => {
      await expect(registry.setRole("unknown@x:y/z", "anything")).rejects.toThrow();
    });
  });

  // Also add inside the first "registry" describe block:
  it("register stores role when provided", async () => {
    await registry.register("alice@srv:cc2cc/abc", "cc2cc", "architect");
    expect(registry.get("alice@srv:cc2cc/abc")?.role).toBe("architect");
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd hub && bun test tests/registry.test.ts
  ```

- [ ] **Step 3: Update `hub/src/registry.ts`**

  - Add `role?: string` to `RegistryEntry`
  - Update `register()` to accept `role?: string` as third param; include it in both `_map` entry and the Redis JSON blob
  - Add `setRole()` method:
    ```typescript
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
    ```

- [ ] **Step 4: Run tests**

  ```bash
  cd hub && bun test tests/registry.test.ts
  ```
  Expected: all PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add hub/src/registry.ts hub/tests/registry.test.ts
  git commit -m "feat(hub): add role field to registry and setRole() method"
  ```

---

## Task 4: Hub — WsHandler Topic Integration

**Files:**
- Modify: `hub/src/ws-handler.ts`

> `ws-handler.ts` wires live Bun WS — no unit tests. Verify with `bun test tests/integration.test.ts` after changes.

- [ ] **Step 1: Add imports at the top of `ws-handler.ts`**

  ```typescript
  import { randomUUID } from "node:crypto";
  import { topicManager, parseProject } from "./topic-manager.js";
  ```

  `parseProject` is exported from `topic-manager.ts` (Task 2 Step 3) — use it everywhere project extraction is needed rather than inlining.

- [ ] **Step 2: Add connect-time auto-join after existing queue flush**

  After the `replayProcessing` / queue-flush block in the plugin connect handler:
  ```typescript
  // Auto-join project topic
  const project = parseProject(instanceId);
  await topicManager.createTopic(project, instanceId);
  await topicManager.subscribe(project, instanceId);
  const topics = await topicManager.getTopicsForInstance(instanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics }));
  ```

- [ ] **Step 3: Add session update topic migration in `handleSessionUpdate`**

  After the existing queue migration logic:
  ```typescript
  // Migrate topic subscriptions to new instanceId
  const topicNames = await topicManager.getTopicsForInstance(oldInstanceId);
  for (const name of topicNames) {
    await redis.srem(`topic:${name}:subscribers`, oldInstanceId);
    await redis.sadd(`topic:${name}:subscribers`, newInstanceId);
  }
  // SUNIONSTORE: union so any pre-existing newId subscriptions are preserved
  await redis.sunionstore(
    `instance:${newInstanceId}:topics`,
    `instance:${newInstanceId}:topics`,
    `instance:${oldInstanceId}:topics`,
  );
  await redis.del(`instance:${oldInstanceId}:topics`);
  // Re-run auto-join for project topic (idempotent)
  const project = parseProject(newInstanceId);
  await topicManager.createTopic(project, newInstanceId);
  await topicManager.subscribe(project, newInstanceId);
  const newTopics = await topicManager.getTopicsForInstance(newInstanceId);
  ws.send(JSON.stringify({ action: "subscriptions:sync", topics: newTopics }));
  ```

  Note: `redis` is already imported in `ws-handler.ts` for queue operations.

- [ ] **Step 4: Add 4 new WS frame action handlers**

  In the plugin message dispatch switch, add after the existing cases:

  ```typescript
  case "set_role": {
    const { role, requestId } = frame as { role: string; requestId: string };
    const updated = await registry.setRole(instanceId, role);
    ws.send(JSON.stringify({ requestId, instanceId, role: updated.role }));
    emitToDashboards({
      event: "instance:role_updated",
      instanceId,
      role: updated.role ?? "",
      timestamp: new Date().toISOString(),
    });
    break;
  }

  case "subscribe_topic": {
    const { topic, requestId } = frame as { topic: string; requestId: string };
    await topicManager.subscribe(topic, instanceId);
    ws.send(JSON.stringify({ requestId, topic, subscribed: true }));
    emitToDashboards({
      event: "topic:subscribed",
      name: topic,
      instanceId,
      timestamp: new Date().toISOString(),
    });
    break;
  }

  case "unsubscribe_topic": {
    const { topic, requestId } = frame as { topic: string; requestId: string };
    try {
      await topicManager.unsubscribe(topic, instanceId);
      ws.send(JSON.stringify({ requestId, topic, unsubscribed: true }));
      emitToDashboards({
        event: "topic:unsubscribed",
        name: topic,
        instanceId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      ws.send(JSON.stringify({ requestId, error: (err as Error).message }));
      // Do NOT emit HubEvent on rejection
    }
    break;
  }

  case "publish_topic": {
    const { topic, type, content, persistent = false, metadata, requestId } =
      frame as { topic: string; type: string; content: string; persistent?: boolean; metadata?: Record<string, unknown>; requestId: string };

    const wsRefs = new Map<string, { readyState: number; send(d: string): void }>();
    for (const entry of registry.getOnline()) {
      const ref = registry.getWsRef(entry.instanceId);
      if (ref) wsRefs.set(entry.instanceId, ref as never);
    }

    const message: Message = {
      messageId: randomUUID(),
      from: instanceId,
      to: `topic:${topic}`,
      type: type as MessageType,
      content,
      topicName: topic,
      metadata,
      timestamp: new Date().toISOString(),
    };

    const { delivered, queued } = await topicManager.publishToTopic(
      topic, message, persistent, instanceId, wsRefs,
    );

    ws.send(JSON.stringify({ requestId, delivered, queued }));
    emitToDashboards({
      event: "topic:message",
      name: topic,
      message,
      persistent,
      delivered,
      queued,
      timestamp: new Date().toISOString(),
    });
    break;
  }
  ```

  Add `Message` and `MessageType` to the imports from `@cc2cc/shared` if not already present.

- [ ] **Step 5: Run integration tests**

  ```bash
  cd hub && bun test tests/integration.test.ts
  ```

- [ ] **Step 6: Run full hub tests**

  ```bash
  cd hub && bun test
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add hub/src/ws-handler.ts
  git commit -m "feat(hub): auto-join project topic on connect, session migration, 4 new WS frame handlers"
  ```

---

## Task 5: Hub — Topic REST Endpoints

**Files:**
- Modify: `hub/src/api.ts`
- Modify: `hub/tests/api.test.ts`

- [ ] **Step 1: Read the existing `hub/tests/api.test.ts`** to understand the current mock setup pattern before adding mocks.

- [ ] **Step 2: Add mocks for `topic-manager` and `ws-handler` to the api.test.ts mock block**

  `api.ts` imports both `topicManager` (new) and `emitToDashboards` from `ws-handler`. Both must be mocked before any app import. Add to the top of `api.test.ts`, alongside existing mock blocks:

  ```typescript
  // Mock topicManager
  const topicManagerMock = {
    listTopics: mock(async () => [] as TopicInfo[]),
    createTopic: mock(async () => ({ name: "cc2cc", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "test", subscriberCount: 0 } as TopicInfo)),
    deleteTopic: mock(async () => {}),
    subscribe: mock(async () => {}),
    unsubscribe: mock(async () => {}),
    getSubscribers: mock(async () => [] as string[]),
    getTopicsForInstance: mock(async () => [] as string[]),
    topicExists: mock(async () => true),
    publishToTopic: mock(async () => ({ delivered: 0, queued: 0 })),
  };

  mock.module("../src/topic-manager.js", () => ({
    topicManager: topicManagerMock,
    parseProject: (id: string) => id.split(":")[1]?.split("/")[0] ?? id,
  }));

  // Mock ws-handler (api.ts calls emitToDashboards)
  mock.module("../src/ws-handler.js", () => ({
    emitToDashboards: mock(() => {}),
    dashboardClients: new Set(),
  }));
  ```

  Then before each test, clear all mocks:
  ```typescript
  beforeEach(() => {
    Object.values(topicManagerMock).forEach((m) => (m as ReturnType<typeof mock>).mockClear?.());
  });
  ```

- [ ] **Step 3: Write failing tests for the new topic endpoints**

  ```typescript
  describe("GET /api/topics", () => {
    it("returns 200 with topic list", async () => {
      topicManagerMock.listTopics.mockResolvedValue([
        { name: "cc2cc", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "alice@srv:cc2cc/abc", subscriberCount: 1 },
      ]);
      const res = await app.request(`/api/topics?key=${KEY}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(body).toHaveLength(1);
    });
  });

  describe("GET /api/topics/:name/subscribers", () => {
    it("returns 404 when topic does not exist", async () => {
      topicManagerMock.topicExists.mockResolvedValue(false);
      const res = await app.request(`/api/topics/missing?key=${KEY}/subscribers`);
      expect(res.status).toBe(404);
    });

    it("returns subscriber list for existing topic", async () => {
      topicManagerMock.topicExists.mockResolvedValue(true);
      topicManagerMock.getSubscribers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
      const res = await app.request(`/api/topics/cc2cc/subscribers?key=${KEY}`);
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/topics", () => {
    it("creates and returns a TopicInfo", async () => {
      const res = await app.request(`/api/topics?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "cc2cc" }),
      });
      expect(res.status).toBe(200);
      expect(topicManagerMock.createTopic).toHaveBeenCalled();
    });
  });

  describe("DELETE /api/topics/:name", () => {
    it("returns 404 when topic does not exist", async () => {
      topicManagerMock.topicExists.mockResolvedValue(false);
      const res = await app.request(`/api/topics/missing?key=${KEY}`, { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 409 when topic has subscribers", async () => {
      topicManagerMock.topicExists.mockResolvedValue(true);
      topicManagerMock.getSubscribers.mockResolvedValue(["alice@srv:cc2cc/abc"]);
      const res = await app.request(`/api/topics/cc2cc?key=${KEY}`, { method: "DELETE" });
      expect(res.status).toBe(409);
    });

    it("deletes and returns { deleted: true, name }", async () => {
      topicManagerMock.topicExists.mockResolvedValue(true);
      topicManagerMock.getSubscribers.mockResolvedValue([]);
      const res = await app.request(`/api/topics/cc2cc?key=${KEY}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json() as { deleted: boolean; name: string };
      expect(body.deleted).toBe(true);
      expect(body.name).toBe("cc2cc");
    });
  });

  describe("POST /api/topics/:name/publish", () => {
    it("returns 404 when topic does not exist", async () => {
      topicManagerMock.topicExists.mockResolvedValue(false);
      const res = await app.request(`/api/topics/missing/publish?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hi", type: "task" }),
      });
      expect(res.status).toBe(404);
    });
  });
  ```

- [ ] **Step 4: Run tests to confirm they fail**

  ```bash
  cd hub && bun test tests/api.test.ts
  ```
  Expected: new tests FAIL.

- [ ] **Step 5: Add topic routes to `hub/src/api.ts`**

  Add `randomUUID` to existing imports:
  ```typescript
  import { timingSafeEqual, randomUUID } from "node:crypto";
  ```

  Add `topicManager` import and `emitToDashboards` import:
  ```typescript
  import { topicManager } from "./topic-manager.js";
  // emitToDashboards is already imported from ./ws-handler.js
  ```

  Add routes after the existing DELETE `/api/queue/:id`:
  ```typescript
  // GET /api/topics
  app.get("/api/topics", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    return c.json(await topicManager.listTopics());
  });

  // GET /api/topics/:name/subscribers
  app.get("/api/topics/:name/subscribers", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    return c.json(await topicManager.getSubscribers(name));
  });

  // POST /api/topics
  app.post("/api/topics", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const { name } = await c.req.json<{ name: string }>();
    const info = await topicManager.createTopic(name, "dashboard");
    emitToDashboards({ event: "topic:created", name, createdBy: "dashboard", timestamp: new Date().toISOString() });
    return c.json(info);
  });

  // DELETE /api/topics/:name
  app.delete("/api/topics/:name", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const subscribers = await topicManager.getSubscribers(name);
    if (subscribers.length > 0) {
      return c.json({ error: "topic has subscribers", subscriberCount: subscribers.length }, 409);
    }
    await topicManager.deleteTopic(name);
    emitToDashboards({ event: "topic:deleted", name, timestamp: new Date().toISOString() });
    return c.json({ deleted: true, name });
  });

  // POST /api/topics/:name/subscribe
  app.post("/api/topics/:name/subscribe", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { instanceId } = await c.req.json<{ instanceId: string }>();
    if (!registry.get(instanceId)) {
      return c.json({ error: "instance not found" }, 404);
    }
    await topicManager.subscribe(name, instanceId);
    emitToDashboards({ event: "topic:subscribed", name, instanceId, timestamp: new Date().toISOString() });
    return c.json({ subscribed: true, topic: name });
  });

  // POST /api/topics/:name/unsubscribe
  app.post("/api/topics/:name/unsubscribe", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { instanceId } = await c.req.json<{ instanceId: string }>();
    try {
      await topicManager.unsubscribe(name, instanceId);
      emitToDashboards({ event: "topic:unsubscribed", name, instanceId, timestamp: new Date().toISOString() });
      return c.json({ unsubscribed: true, topic: name });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // POST /api/topics/:name/publish
  app.post("/api/topics/:name/publish", async (c) => {
    const authErr = validateKey(c.req.query("key"));
    if (authErr) return authErr;
    const name = decodeURIComponent(c.req.param("name"));
    if (!(await topicManager.topicExists(name))) {
      return c.json({ error: "topic not found" }, 404);
    }
    const { content, type, persistent = false, from, metadata } =
      await c.req.json<{ content: string; type: string; persistent?: boolean; from?: string; metadata?: Record<string, unknown> }>();

    const wsRefs = new Map<string, { readyState: number; send(d: string): void }>();
    for (const entry of registry.getOnline()) {
      const ref = registry.getWsRef(entry.instanceId);
      if (ref) wsRefs.set(entry.instanceId, ref as never);
    }

    const message: Message = {
      messageId: randomUUID(),
      from: from ?? "dashboard",
      to: `topic:${name}`,
      type: type as MessageType,
      content,
      topicName: name,
      metadata,
      timestamp: new Date().toISOString(),
    };

    const { delivered, queued } = await topicManager.publishToTopic(
      name, message, persistent, from ?? "", wsRefs,
    );

    emitToDashboards({ event: "topic:message", name, message, persistent, delivered, queued, timestamp: new Date().toISOString() });
    return c.json({ delivered, queued });
  });
  ```

  Add `Message` and `MessageType` to `@cc2cc/shared` imports.

- [ ] **Step 6: Run tests**

  ```bash
  cd hub && bun test tests/api.test.ts
  ```

- [ ] **Step 7: Run full hub tests**

  ```bash
  cd hub && bun test
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add hub/src/api.ts hub/tests/api.test.ts
  git commit -m "feat(hub): add 7 topic REST endpoints with 404/409 guards"
  ```

---

## Task 6: Plugin — connection.ts & channel.ts

**Files:**
- Modify: `plugin/src/connection.ts`
- Modify: `plugin/src/channel.ts`

- [ ] **Step 1: Update `connection.ts` — intercept `subscriptions:sync` before the correlator**

  In `_openSocket()`, in the `ws.on("message", ...)` handler:
  ```typescript
  this.ws.on("message", (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      // Hub push frames arrive without a requestId — handle before correlator
      if (parsed.action === "subscriptions:sync") {
        this.emit("subscriptions:sync", parsed.topics);
        return;
      }
      this.emit("message", parsed);
    } catch {
      // Non-JSON — ignore
    }
  });
  ```

  The `"subscriptions:sync"` event is emitted on the `HubConnection` EventEmitter. The plugin's `index.ts` can log it if desired.

- [ ] **Step 2: Update `channel.ts` — add `topic` attribute**

  ```typescript
  export async function emitChannelNotification(
    mcp: Pick<Server, "notification">,
    message: Message,
  ): Promise<void> {
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: message.content,
        meta: {
          source: "cc2cc",
          from: message.from,
          type: message.type,
          message_id: message.messageId,
          reply_to: message.replyToMessageId ?? "",
          ...(message.topicName ? { topic: message.topicName } : {}),
        },
      },
    });
  }
  ```

- [ ] **Step 3: Run plugin tests**

  ```bash
  cd plugin && bun test
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add plugin/src/connection.ts plugin/src/channel.ts
  git commit -m "feat(plugin): intercept subscriptions:sync push frames, add topic attr to channel tag"
  ```

---

## Task 7: Plugin — Five New MCP Tools

**Files:**
- Modify: `plugin/src/tools.ts`
- Modify: `plugin/src/index.ts`

- [ ] **Step 1: Add five new tools to `createTools()` in `tools.ts`**

  After the existing `ping` tool, add:

  ```typescript
  async set_role(input: { role: string }): Promise<{ instanceId: string; role: string }> {
    const response = await conn.request<{ requestId: string; instanceId: string; role: string }>(
      "set_role", { role: input.role },
    );
    const { requestId: _, ...result } = response;
    return result;
  },

  async subscribe_topic(input: { topic: string }): Promise<{ topic: string; subscribed: true }> {
    const response = await conn.request<{ requestId: string; topic: string; subscribed: true }>(
      "subscribe_topic", { topic: input.topic },
    );
    const { requestId: _, ...result } = response;
    return result;
  },

  async unsubscribe_topic(input: { topic: string }): Promise<{ topic: string; unsubscribed: true }> {
    const response = await conn.request<{ requestId: string; topic: string; unsubscribed: true } | { requestId: string; error: string }>(
      "unsubscribe_topic", { topic: input.topic },
    );
    if ("error" in response) throw new Error(response.error);
    const { requestId: _, ...result } = response as { requestId: string; topic: string; unsubscribed: true };
    return result;
  },

  async list_topics(_input: Record<string, never>): Promise<TopicInfo[]> {
    const res = await fetch(`${httpHubUrl}/api/topics?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`list_topics failed: ${res.status} ${res.statusText}`);
    return res.json() as Promise<TopicInfo[]>;
  },

  async publish_topic(input: {
    topic: string;
    type: MessageType;
    content: string;
    persistent?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<{ delivered: number; queued: number }> {
    const payload: Record<string, unknown> = {
      topic: input.topic,
      type: input.type,
      content: input.content,
      persistent: input.persistent ?? false,
    };
    if (input.metadata !== undefined) payload.metadata = input.metadata;
    const response = await conn.request<{ requestId: string; delivered: number; queued: number }>(
      "publish_topic", payload,
    );
    const { requestId: _, ...result } = response;
    return result;
  },
  ```

  Add `TopicInfo` to the `@cc2cc/shared` import at the top of `tools.ts`.

- [ ] **Step 2: Register the new tools in `plugin/src/index.ts`**

  Follow the exact same pattern as the existing `list_instances`, `send_message`, etc. registrations. Each tool needs:
  - A `name` string matching the function name
  - A `description` string for Claude
  - An `inputSchema` pointing to the corresponding Zod schema from `@cc2cc/shared` (e.g. `SetRoleInputSchema`, `SubscribeTopicInputSchema`, etc.)
  - A handler that calls `tools.set_role(input)`, `tools.subscribe_topic(input)`, etc.

  `list_topics` uses an empty object schema (no inputs).

- [ ] **Step 3: Run plugin tests and typecheck**

  ```bash
  cd plugin && bun test
  make typecheck
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add plugin/src/tools.ts plugin/src/index.ts
  git commit -m "feat(plugin): add set_role, subscribe_topic, unsubscribe_topic, list_topics, publish_topic MCP tools"
  ```

---

## Task 8: Skill Updates

**Files:**
- Modify: `skill/skills/cc2cc/SKILL.md`
- Create: `skill/skills/cc2cc/patterns/topics.md`
- Modify: `skill/.claude-plugin/plugin.json` — bump version

- [ ] **Step 1: Add Roles section to `SKILL.md`** (after "Instance Identity"):

  ```markdown
  ## Declaring Your Role

  Call `set_role()` early in a session to declare your function on the team.

  - Use `{project}/{function}` for specificity (e.g. `cc2cc/backend-reviewer`, `cc2cc/architect`)
  - Re-call `set_role()` if your focus shifts mid-session
  - Role is optional — omitting it has no functional consequence
  ```

- [ ] **Step 2: Add Topics section to `SKILL.md`** (after Roles):

  ```markdown
  ## Topics

  Topics are named pub/sub channels. Your project topic (e.g. `cc2cc`) is automatically
  created and joined when you connect — never unsubscribe from it.

  ### At session start
  Review your subscriptions from the `subscriptions:sync` frame. Call `list_topics()` to
  see all available topics. Unsubscribe from any no longer relevant; ask the user if unsure.

  ### Naming conventions
  Always prefix generic topic names with your project:
  - ✓ `cc2cc/frontend`  ✗ `frontend`

  ### Choosing the right send path

  | Goal | Use |
  |---|---|
  | Notify all online instances | `broadcast()` |
  | Notify a topic's subscribers (incl. offline if persistent) | `publish_topic()` |
  | Send to a specific instance | `send_message()` |

  Use `persistent: true` for task assignments and handoffs. `persistent: false` for status
  signals and FYIs. See `patterns/topics.md` for full guidance.
  ```

  Also document the five new tools in the `## Available MCP Tools` section following the same format as existing tools.

- [ ] **Step 3: Create `skill/skills/cc2cc/patterns/topics.md`**

  Cover: naming conventions table, when to create vs reuse topics, decision tree (`publish_topic` vs `broadcast` vs `send_message`), subscription hygiene (what to do with stale subscriptions), and the inbound topic message format with the `topic` attribute.

- [ ] **Step 4: Bump plugin version in `skill/.claude-plugin/plugin.json`**

  Increment `version` (e.g. `0.1.0` → `0.2.0`). Update `sync-plugin-cache.sh` to point at the new version directory, then run:
  ```bash
  bash skill/sync-plugin-cache.sh
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add skill/
  git commit -m "feat(skill): add Roles and Topics sections, topics.md pattern guide, bump plugin to 0.2.0"
  ```

---

## Task 9a: Dashboard — Types & WsProvider

**Files:**
- Modify: `dashboard/src/types/dashboard.ts`
- Modify: `dashboard/src/components/ws-provider/ws-provider.tsx`

> Run dashboard tests with: `cd dashboard && bun run test`  (NOT `bun test`)

- [ ] **Step 1: Update `dashboard/src/types/dashboard.ts`**

  Add `TopicState`; extend `FeedMessage`, `InstanceState`, and `WsContextValue`:

  ```typescript
  import type { Message, InstanceInfo, MessageType, TopicInfo } from "@cc2cc/shared";

  export interface TopicState extends TopicInfo {
    subscribers: string[];
  }

  export interface FeedMessage {
    message: Message;
    receivedAt: Date;
    isBroadcast: boolean;
    topicName?: string;   // NEW
  }

  // InstanceState extends InstanceInfo which now has role?: string — no extra change needed

  export interface WsContextValue {
    connectionState: ConnectionState;
    instances: Map<string, InstanceState>;
    topics: Map<string, TopicState>;           // NEW
    feed: FeedMessage[];
    sessionStats: SessionStats;
    dashboardInstanceId: string;
    sendMessage: (to: string, type: MessageType, content: string) => Promise<void>;
    sendBroadcast: (type: MessageType, content: string) => Promise<void>;
    sendPublishTopic: (                        // NEW
      topic: string,
      type: MessageType,
      content: string,
      persistent: boolean,
      metadata?: Record<string, unknown>,
    ) => Promise<void>;
  }
  ```

- [ ] **Step 2: Update `WsContext` default value in `ws-provider.tsx`**

  ```typescript
  export const WsContext = createContext<WsContextValue>({
    connectionState: "reconnecting",
    instances: new Map(),
    topics: new Map(),
    feed: [],
    sessionStats: { activeTasks: 0, errors: 0, pendingTaskIds: new Set() },
    dashboardInstanceId: "",
    sendMessage: async () => { throw new Error("WsProvider not mounted"); },
    sendBroadcast: async () => { throw new Error("WsProvider not mounted"); },
    sendPublishTopic: async () => { throw new Error("WsProvider not mounted"); },
  });
  ```

- [ ] **Step 3: Add `topics` state and `seedTopics` in `WsProvider`**

  ```typescript
  const [topics, setTopics] = useState<Map<string, TopicState>>(new Map());

  const seedTopics = useCallback(async () => {
    const hubHttpUrl = (process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100")
      .replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://"));
    const apiKey = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";
    const res = await fetch(`${hubHttpUrl}/api/topics?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok || !mountedRef.current) return;
    const list = await res.json() as TopicInfo[];
    setTopics((prev) => {
      const next = new Map(prev);
      for (const t of list) {
        if (!next.has(t.name)) next.set(t.name, { ...t, subscribers: [] });
      }
      return next;
    });
  }, []);
  ```

  Call `seedTopics()` in the same `useEffect` as `seedInstances()`.

- [ ] **Step 4: Add new HubEvent handlers in `handleEvent`**

  Add to the `switch (evt.event)` block:

  ```typescript
  case "instance:role_updated":
    setInstances((prev) => {
      const next = new Map(prev);
      const existing = next.get(evt.instanceId);
      if (existing) next.set(evt.instanceId, { ...existing, role: evt.role });
      return next;
    });
    break;

  case "topic:created":
    setTopics((prev) => {
      const next = new Map(prev);
      if (!next.has(evt.name)) {
        next.set(evt.name, { name: evt.name, createdAt: evt.timestamp, createdBy: evt.createdBy, subscriberCount: 0, subscribers: [] });
      }
      return next;
    });
    break;

  case "topic:deleted":
    setTopics((prev) => {
      const next = new Map(prev);
      next.delete(evt.name);
      return next;
    });
    break;

  case "topic:subscribed":
    setTopics((prev) => {
      const next = new Map(prev);
      const t = next.get(evt.name);
      if (t && !t.subscribers.includes(evt.instanceId)) {
        next.set(evt.name, { ...t, subscriberCount: t.subscriberCount + 1, subscribers: [...t.subscribers, evt.instanceId] });
      }
      return next;
    });
    break;

  case "topic:unsubscribed":
    setTopics((prev) => {
      const next = new Map(prev);
      const t = next.get(evt.name);
      if (t) {
        next.set(evt.name, { ...t, subscriberCount: Math.max(0, t.subscriberCount - 1), subscribers: t.subscribers.filter((id) => id !== evt.instanceId) });
      }
      return next;
    });
    break;

  case "topic:message":
    appendFeed({ message: evt.message, receivedAt: new Date(), isBroadcast: false, topicName: evt.name });
    break;
  ```

- [ ] **Step 5: Handle `subscriptions:sync` in plugin WS `onmessage`**

  In `connectPlugin`'s `ws.onmessage`, add **before** the `requestId` check:
  ```typescript
  if (frame.action === "subscriptions:sync") {
    // Dashboard's own subscriptions — already seeded from REST; no additional state needed
    return;
  }
  ```

- [ ] **Step 6: Add `sendPublishTopic` and expose in context**

  ```typescript
  const sendPublishTopic = useCallback(
    (topic: string, type: MessageType, content: string, persistent: boolean, metadata?: Record<string, unknown>): Promise<void> => {
      const hubHttpUrl = (process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100")
        .replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://"));
      const apiKey = process.env.NEXT_PUBLIC_CC2CC_HUB_API_KEY ?? "";
      return fetch(
        `${hubHttpUrl}/api/topics/${encodeURIComponent(topic)}/publish?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, type, persistent, metadata, from: dashboardInstanceId }),
        },
      ).then((r) => { if (!r.ok) throw new Error(`publish failed: ${r.status}`); });
    },
    [dashboardInstanceId],
  );
  ```

  Add `topics`, `sendPublishTopic` to `WsContext.Provider` value.

- [ ] **Step 7: Run dashboard tests**

  ```bash
  cd dashboard && bun run test -- --testPathPattern=ws-provider
  ```
  Expected: existing tests pass (new state is purely additive).

- [ ] **Step 8: Commit**

  ```bash
  git add dashboard/src/types/dashboard.ts dashboard/src/components/ws-provider/ws-provider.tsx
  git commit -m "feat(dashboard): add TopicState, extend WsContextValue, handle 6 new HubEvents in WsProvider"
  ```

---

## Task 9b: Dashboard — lib/api.ts Topic Wrappers

**Files:**
- Modify: `dashboard/src/lib/api.ts`

> Read the existing `lib/api.ts` first. It already defines a `hubUrl(path)` helper — use it everywhere, do not re-define the URL.

- [ ] **Step 1: Add topic REST wrappers to `lib/api.ts`**

  ```typescript
  import type { TopicInfo } from "@cc2cc/shared";

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
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add dashboard/src/lib/api.ts
  git commit -m "feat(dashboard): add topic REST wrappers to lib/api.ts"
  ```

---

## Task 9c: Dashboard — Sidebar, Feed Filter, Nav, and Conversations

**Files:**
- Modify: `dashboard/src/components/instance-sidebar/instance-sidebar.tsx`
- Modify: `dashboard/src/components/message-feed/message-feed.tsx`
- Modify: `dashboard/src/components/nav/nav-tabs.tsx`
- Modify: `dashboard/src/app/page.tsx`
- Modify: `dashboard/src/app/conversations/page.tsx`

- [ ] **Step 1: Update `InstanceSidebar` — 3-group sort, role badge, topic chips**

  Update props:
  ```typescript
  interface InstanceSidebarProps {
    instances: Map<string, InstanceState>;
    topics: Map<string, TopicState>;       // NEW
    selectedId: string | null;
    onSelect: (id: string) => void;        // called for topics (id = "topic:{name}") and instances
    onRemove?: (instanceId: string) => void;
  }
  ```

  Replace sorting logic with three groups:
  ```typescript
  const topicList = Array.from(topics.values()).sort((a, b) => a.name.localeCompare(b.name));
  const online = Array.from(instances.values())
    .filter((i) => i.status === "online")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const offline = Array.from(instances.values())
    .filter((i) => i.status === "offline")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  ```

  Render three sections in `<ul>`, each preceded by a section header `<li>`:
  - **Topics**: each row shows `◈ {topic.name}` + subscriber count badge; `isSelected` when `selectedId === "topic:{name}"`
  - **Online**: existing row rendering; add role badge: `{inst.role && <span>[{inst.role}]</span>}`; topic chip list shown on hover via `group-hover` class using `inst.topics` if available (see Task 9a where `InstanceState` now has `role?` via `InstanceInfo`)
  - **Offline**: existing row with remove button

- [ ] **Step 2: Add feed filter bar to `MessageFeed`**

  Update props:
  ```typescript
  interface MessageFeedProps {
    feed: FeedMessage[];
    filterInstanceId?: string | null;
    topics?: Map<string, TopicState>;
    feedFilter?: { kind: "all" | "direct" | "broadcast" | "topic"; topicName?: string };
    onFilterChange?: (f: { kind: "all" | "direct" | "broadcast" | "topic"; topicName?: string }) => void;
  }
  ```

  Add filter bar above the scroll area:
  ```tsx
  <div className="flex gap-1 px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid #1a3356" }}>
    {(["all", "direct", "broadcast"] as const).map((kind) => (
      <button key={kind} type="button" onClick={() => onFilterChange?.({ kind })}
        className={cn("px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
          feedFilter?.kind === kind ? "text-[#00d4ff]" : "text-[#3a5470] hover:text-[#6b8aaa]")}>
        {kind}
      </button>
    ))}
    <select
      value={feedFilter?.kind === "topic" ? feedFilter.topicName ?? "" : ""}
      onChange={(e) => e.target.value && onFilterChange?.({ kind: "topic", topicName: e.target.value })}
      className="font-mono text-[10px] bg-transparent border-0 outline-none cursor-pointer"
      style={{ color: feedFilter?.kind === "topic" ? "#00d4ff" : "#3a5470" }}>
      <option value="">topic ▾</option>
      {Array.from(topics?.values() ?? []).map((t) => (
        <option key={t.name} value={t.name}>{t.name}</option>
      ))}
    </select>
  </div>
  ```

  Apply filter before rendering:
  ```typescript
  const filtered = feed.filter((entry) => {
    if (!feedFilter || feedFilter.kind === "all") return true;
    if (feedFilter.kind === "direct") return !entry.isBroadcast && !entry.topicName;
    if (feedFilter.kind === "broadcast") return entry.isBroadcast;
    if (feedFilter.kind === "topic") return entry.topicName === feedFilter.topicName;
    return true;
  });
  ```

- [ ] **Step 3: Add "Topics" to nav bar in `nav-tabs.tsx`**

  Insert between Dashboard and Analytics:
  ```tsx
  { href: "/topics", label: "Topics" }
  ```

- [ ] **Step 4: Update `app/page.tsx`**

  ```typescript
  const { instances, topics, feed, connectionState } = useWs();
  const [feedFilter, setFeedFilter] = useState<{ kind: "all" | "direct" | "broadcast" | "topic"; topicName?: string }>({ kind: "all" });
  const topicList = Array.from(topics.values());
  ```

  Pass `topics` to `InstanceSidebar`, and `topics`, `feedFilter`, `onFilterChange` to `MessageFeed`. Pass `topics={topicList}` to `ManualSendBar`.

- [ ] **Step 5: Exclude topic messages from `/conversations` thread grouping**

  Read `dashboard/src/app/conversations/page.tsx`. Find where messages are grouped into threads. Add a filter to exclude topic messages:
  ```typescript
  // Topic messages are not conversations — exclude from thread grouping
  const nonTopicFeed = feed.filter((entry) => !entry.topicName && !entry.message.to?.startsWith?.("topic:"));
  // Use nonTopicFeed instead of feed for thread construction
  ```

- [ ] **Step 6: Run dashboard tests**

  ```bash
  cd dashboard && bun run test
  ```
  Fix any prop-type mismatches in test files (pass empty Maps for new props).

- [ ] **Step 7: Commit**

  ```bash
  git add dashboard/src/components/instance-sidebar/ dashboard/src/components/message-feed/ dashboard/src/components/nav/ dashboard/src/app/page.tsx dashboard/src/app/conversations/
  git commit -m "feat(dashboard): 3-group sidebar, role badge, feed filter bar, Topics nav link, conversations exclusion"
  ```

---

## Task 9d: Dashboard — ManualSendBar Topics

**Files:**
- Modify: `dashboard/src/components/manual-send-bar/manual-send-bar.tsx`

- [ ] **Step 1: Update props and imports**

  ```typescript
  import type { InstanceState, TopicState } from "@/types/dashboard";

  interface ManualSendBarProps {
    instances: InstanceState[];
    topics: TopicState[];     // NEW
    disabled: boolean;
    onError?: (err: unknown) => void;
  }
  ```

- [ ] **Step 2: Add `persistent` state and `sendPublishTopic`**

  ```typescript
  const { sendMessage, sendBroadcast, sendPublishTopic } = useWs();
  const [persistent, setPersistent] = useState(false);
  ```

- [ ] **Step 3: Rebuild the recipient `<SelectContent>` with three groups**

  Replace current content (broadcast + instance items) with:
  ```tsx
  {/* Topics group */}
  <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: "#2a5480" }}>Topics</div>
  {[...topics].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
    <SelectItem key={`topic:${t.name}`} value={`topic:${t.name}`}
      className="font-mono text-[11px]" style={{ color: "#a855f7" }}>
      ◈ {t.name} ({t.subscriberCount})
    </SelectItem>
  ))}
  {/* Online group */}
  <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: "#2a5480" }}>Online</div>
  <SelectItem value="broadcast" className="font-mono text-[11px]" style={{ color: "#a855f7" }}>
    ⬡ broadcast (all online)
  </SelectItem>
  {instances.filter((i) => i.status === "online")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((inst) => (
      <SelectItem key={inst.instanceId} value={inst.instanceId}
        className="font-mono text-[11px]" style={{ color: "#6b8aaa" }}>
        {shortInstanceId(inst.instanceId)}
        {inst.role && ` [${inst.role}]`}
      </SelectItem>
    ))}
  {/* Offline group */}
  <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: "#2a5480" }}>Offline</div>
  {instances.filter((i) => i.status === "offline")
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((inst) => (
      <SelectItem key={inst.instanceId} value={inst.instanceId} disabled
        className="font-mono text-[11px]" style={{ color: "#3a5470" }}>
        {shortInstanceId(inst.instanceId)} (offline)
      </SelectItem>
    ))}
  ```

- [ ] **Step 4: Show `persistent` toggle when a topic is selected**

  ```tsx
  {to.startsWith("topic:") && (
    <label className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "#6b8aaa" }}>
      <input type="checkbox" checked={persistent} onChange={(e) => setPersistent(e.target.checked)} />
      persistent
    </label>
  )}
  ```

- [ ] **Step 5: Update `handleSend`**

  ```typescript
  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      if (to === "broadcast") {
        await sendBroadcast(messageType, trimmed);
      } else if (to.startsWith("topic:")) {
        await sendPublishTopic(to.slice("topic:".length), messageType, trimmed, persistent);
      } else {
        await sendMessage(to, messageType, trimmed);
      }
      setContent("");
    } catch (err) {
      onError?.(err);
    }
  }
  ```

- [ ] **Step 6: Run dashboard tests**

  ```bash
  cd dashboard && bun run test -- --testPathPattern=manual-send-bar
  ```
  Fix any prop-type mismatches.

- [ ] **Step 7: Commit**

  ```bash
  git add dashboard/src/components/manual-send-bar/
  git commit -m "feat(dashboard): add topic group to recipient dropdown with persistent toggle"
  ```

---

## Task 9e: Dashboard — Instance Chat Area Subscriptions + Topics Page

**Files:**
- Modify: `dashboard/src/app/page.tsx` (instance detail panel)
- Create: `dashboard/src/app/topics/page.tsx`

- [ ] **Step 1: Add Subscriptions section to the instance detail panel in `app/page.tsx`**

  When an instance is selected (`selectedInstanceId` is set), show its topic subscriptions. The `topics` Map in WsProvider tracks `subscribers[]` per topic — invert it to find topics for a given instance:

  ```typescript
  const instanceTopics = Array.from(topics.values())
    .filter((t) => t.subscribers.includes(selectedInstanceId ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name));
  ```

  Render below the message feed (or in the detail sidebar if one exists) when an instance is selected:
  ```tsx
  {selectedInstanceId && instanceTopics.length > 0 && (
    <div className="px-3 py-2" style={{ borderTop: "1px solid #1a3356" }}>
      <div className="mb-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: "#2a5480" }}>
        Subscriptions
      </div>
      <div className="flex flex-wrap gap-1">
        {instanceTopics.map((t) => (
          <button key={t.name} type="button"
            onClick={() => router.push("/topics")}
            className="font-mono text-[10px] px-2 py-0.5 rounded"
            style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7" }}>
            {t.name}
          </button>
        ))}
      </div>
    </div>
  )}
  ```

  Import `useRouter` from `"next/navigation"` at the top of the file.

- [ ] **Step 2: Read `node_modules/next/dist/docs/` for Next.js 16 page conventions** before writing the topics page.

- [ ] **Step 3: Create `dashboard/src/app/topics/page.tsx`**

  Three-panel layout (topic list left, subscriber center, publish right). Use the visual style from other dashboard pages (dark bg `#060d1a`, border `#1a3356`, cyan `#00d4ff`, purple `#a855f7`).

  Key wiring:
  - **Topic list** — from `topics` Map via `useWs()`; sorted alphabetically; "New Topic" → `createTopic()`; delete (shown only when `subscriberCount === 0`) → `deleteTopic()`
  - **Subscriber panel** — `selected.subscribers` from topic state (live-updated via HubEvents); subscribe/unsubscribe dashboard's own `dashboardInstanceId` via `subscribeToTopic()` / `unsubscribeFromTopic()`; each row shows online status from `instances` Map and role badge if set
  - **Publish panel** — type selector, content textarea, persistent toggle; "Publish" → `sendPublishTopic()`; show `{ delivered, queued }` result

- [ ] **Step 4: Run dashboard tests and typecheck**

  ```bash
  cd dashboard && bun run test
  make typecheck
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add dashboard/src/app/
  git commit -m "feat(dashboard): add Topics page and instance chat area subscriptions section"
  ```

---

## Task 10: Final Integration Check

- [ ] **Step 1: Run full test suite**

  ```bash
  make checkall
  ```
  Expected: format ✓, lint ✓, typecheck ✓, tests ✓. Fix any failures before proceeding.

- [ ] **Step 2: Start dev stack and smoke test**

  ```bash
  make dev-redis   # terminal 1
  make dev-hub     # terminal 2
  make dev-dashboard  # terminal 3
  ```

  Verify manually:
  - Two plugin instances connect → both appear in Topics group (project topic) and Online group in sidebar
  - `set_role("cc2cc/backend")` → role badge `[cc2cc/backend]` appears in sidebar
  - `publish_topic("cc2cc", "task", "hello team", false)` → `<channel topic="cc2cc">` tag appears in receiving instance; feed shows it in topic filter
  - Topics page shows project topic with both instances as subscribers
  - Dashboard can subscribe/unsubscribe itself from a topic
  - Dashboard can publish to a topic; deliver/queued counts shown
  - Recipient dropdown shows Topics / Online / Offline groups; selecting topic reveals persistent toggle
  - `/conversations` page does not show topic messages as threads
  - `/clear` in plugin session → subscriptions migrated; `subscriptions:sync` received by new instanceId

- [ ] **Step 3: Update plugin cache**

  ```bash
  bash skill/sync-plugin-cache.sh
  ```

- [ ] **Step 4: Final commit if any fixes needed**

  ```bash
  make checkall
  git add -A
  git commit -m "fix: post-integration-test fixes for roles and topics feature"
  ```
