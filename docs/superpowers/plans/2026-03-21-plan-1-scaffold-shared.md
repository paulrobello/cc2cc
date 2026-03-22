# cc2cc Plan 1: Monorepo Scaffold + Shared Types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the cc2cc Bun monorepo with workspace configuration, Makefile, Docker Compose files, and the `@cc2cc/shared` package containing all shared TypeScript types, Zod schemas, and WebSocket event shapes used by hub, plugin, and dashboard.

**Architecture:** Bun workspaces monorepo with a `packages/shared` library built first since every other component imports from it. Shared types are the contract between all components — getting them right before building anything else prevents schema drift. Zod 3.x (latest stable) provides runtime validation; TypeScript types are inferred from schemas.

**Tech Stack:** Bun workspaces, TypeScript (latest stable), Zod 3.x (latest stable), Docker Compose

---

## File Map

```
cc2cc/
├── package.json                          # bun workspace root
├── tsconfig.base.json                    # shared TS config extended by each package
├── Makefile                              # build · test · lint · fmt · typecheck · checkall
├── .gitignore
├── .env.example
├── docker-compose.yml                    # hub + redis + dashboard
├── docker-compose.dev.yml               # redis only
├── packages/
│   └── shared/
│       ├── package.json                  # name: @cc2cc/shared
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # barrel export
│           ├── types.ts                  # InstanceId, MessageType, Message interface
│           ├── schema.ts                 # Zod schemas (MessageSchema, InstanceSchema, etc.)
│           └── events.ts                 # WebSocket event shapes (hub → dashboard events)
└── packages/shared/tests/
    ├── types.test.ts
    ├── schema.test.ts
    └── events.test.ts
```

---

### Task 1: Initialize Bun Workspace Root

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize the repo**

```bash
cd /Users/probello/Repos/cc2cc
bun init -y
```

- [ ] **Step 2: Replace `package.json` with workspace config**

```json
{
  "name": "cc2cc",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "hub",
    "plugin",
    "dashboard",
    "skill"
  ],
  "scripts": {
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test",
    "lint": "bun run --filter '*' lint",
    "fmt": "bun run --filter '*' fmt",
    "typecheck": "bun run --filter '*' typecheck",
    "checkall": "bun run fmt && bun run lint && bun run typecheck && bun run test"
  },
  "devDependencies": {
    "typescript": "latest"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.local
*.local.*
*-mcp.json
.gemini-clipboard
claude_scratch/
.idea
settings.local.json
CLAUDE.local.md
.superpowers/
```

- [ ] **Step 5: Create `.env.example`**

```bash
# Shared API key — must match across hub, plugin, and dashboard
HUB_API_KEY=change-me-before-use

# Hub
HUB_PORT=3100
REDIS_URL=redis://localhost:6379

# Dashboard
NEXT_PUBLIC_HUB_WS_URL=ws://localhost:3100
NEXT_PUBLIC_HUB_API_KEY=change-me-before-use

# Plugin
CC2CC_HUB_URL=ws://192.168.1.10:3100
CC2CC_API_KEY=change-me-before-use
CC2CC_USERNAME=
CC2CC_HOST=
CC2CC_PROJECT=

# LAN IP for docker-compose (set to your machine's LAN IP for multi-device access)
HOST_LAN_IP=localhost
```

- [ ] **Step 6: Install root deps**

```bash
bun install
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .env.example
git commit -m "chore: initialize bun workspace monorepo"
```

---

### Task 2: Create Docker Compose Files

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  redis:
    image: redis:alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  hub:
    build:
      context: ./hub
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "${HUB_PORT:-3100}:3100"
    environment:
      REDIS_URL: redis://redis:6379
      HUB_API_KEY: ${HUB_API_KEY}
      HUB_PORT: 3100
    depends_on:
      redis:
        condition: service_started

  dashboard:
    build:
      context: ./dashboard
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "8030:8030"
    environment:
      NEXT_PUBLIC_HUB_WS_URL: ws://${HOST_LAN_IP:-localhost}:3100
      NEXT_PUBLIC_HUB_API_KEY: ${HUB_API_KEY}
    depends_on:
      hub:
        condition: service_started

volumes:
  redis_data:
```

- [ ] **Step 2: Create `docker-compose.dev.yml`**

```yaml
# Dev mode: Redis only. Run hub and dashboard natively.
services:
  redis:
    image: redis:alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml
git commit -m "chore: add docker compose configs (full stack + dev redis-only)"
```

---

### Task 3: Create Makefile

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Create `Makefile`**

```makefile
.PHONY: build test lint fmt typecheck checkall dev dev-hub dev-dashboard docker-up docker-down docker-dev-up docker-dev-down

# ── Build ────────────────────────────────────────────────────────────────────
build:
	bun run --filter '*' build

# ── Quality ──────────────────────────────────────────────────────────────────
test:
	bun run --filter '*' test

lint:
	bun run --filter '*' lint

fmt:
	bun run --filter '*' fmt

typecheck:
	bun run --filter '*' typecheck

checkall: fmt lint typecheck test

# ── Dev ──────────────────────────────────────────────────────────────────────
dev-redis:
	docker compose -f docker-compose.dev.yml up -d

dev-hub:
	cd hub && bun run dev

dev-dashboard:
	cd dashboard && bun run dev

# ── Docker ───────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-dev-up:
	docker compose -f docker-compose.dev.yml up -d

docker-dev-down:
	docker compose -f docker-compose.dev.yml down
```

- [ ] **Step 2: Commit**

```bash
git add Makefile
git commit -m "chore: add Makefile with standard targets"
```

---

### Task 4: Scaffold `@cc2cc/shared` Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts` (empty barrel for now)

- [ ] **Step 1: Create package directory**

```bash
mkdir -p packages/shared/src packages/shared/tests
```

- [ ] **Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "@cc2cc/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "echo 'shared: no build step (source imports)'",
    "test": "bun test tests/",
    "lint": "bunx biome lint ./src ./tests",
    "fmt": "bunx biome format --write ./src ./tests",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "typescript": "latest"
  },
  "dependencies": {
    "zod": "^3"
  }
}
```

> **Note:** `@cc2cc/shared` uses direct TypeScript source imports (no build step). Other packages import `@cc2cc/shared` and Bun resolves the `.ts` source directly via the `exports` field. This keeps the workspace simple.

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create empty barrel `packages/shared/src/index.ts`**

```ts
export * from './types.js'
export * from './schema.js'
export * from './events.js'
```

- [ ] **Step 5: Install shared deps**

```bash
cd packages/shared && bun install
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "chore(shared): scaffold @cc2cc/shared package"
```

---

### Task 5: Write Failing Tests for Types

**Files:**
- Create: `packages/shared/tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/types.test.ts
import { describe, it, expect } from 'bun:test'
import type { Message, InstanceInfo } from '../src/types.js'
import { MessageType } from '../src/types.js'

describe('MessageType enum', () => {
  it('has the required values', () => {
    expect(MessageType.task).toBe('task')
    expect(MessageType.result).toBe('result')
    expect(MessageType.question).toBe('question')
    expect(MessageType.ack).toBe('ack')
    expect(MessageType.ping).toBe('ping')
  })

  it('does not include broadcast as a type value', () => {
    expect((MessageType as Record<string, string>)['broadcast']).toBeUndefined()
  })
})

describe('Message interface', () => {
  it('accepts a valid full message', () => {
    const msg: Message = {
      messageId: '550e8400-e29b-41d4-a716-446655440000',
      from: 'paul@macbook:cc2cc/abc123',
      to: 'alice@server:api/def456',
      type: MessageType.task,
      content: 'Review the auth module',
      replyToMessageId: undefined,
      metadata: { priority: 'high' },
      timestamp: new Date().toISOString(),
    }
    expect(msg.type).toBe('task')
    expect(msg.replyToMessageId).toBeUndefined()
  })

  it('accepts broadcast routing in the to field', () => {
    const msg: Message = {
      messageId: '550e8400-e29b-41d4-a716-446655440001',
      from: 'paul@macbook:cc2cc/abc123',
      to: 'broadcast',
      type: MessageType.task,
      content: 'Starting auth refactor — avoid src/auth/',
      timestamp: new Date().toISOString(),
    }
    expect(msg.to).toBe('broadcast')
  })
})

describe('InstanceInfo interface', () => {
  it('accepts a valid instance', () => {
    const inst: InstanceInfo = {
      instanceId: 'paul@macbook:cc2cc/abc123',
      project: 'cc2cc',
      status: 'online',
      connectedAt: new Date().toISOString(),
      queueDepth: 0,
    }
    expect(inst.status).toBe('online')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && bun test tests/types.test.ts
```

Expected: FAIL — `Cannot find module '../src/types.js'`

---

### Task 6: Implement `types.ts`

**Files:**
- Create: `packages/shared/src/types.ts`

- [ ] **Step 1: Implement types**

```ts
// packages/shared/src/types.ts

export enum MessageType {
  task     = 'task',
  result   = 'result',
  question = 'question',
  ack      = 'ack',
  ping     = 'ping',
  // Note: 'broadcast' is NOT a MessageType value.
  // Broadcast routing is determined by to === 'broadcast' in the Message envelope.
  // The broadcast() MCP tool sends messages with a standard type (e.g. task).
}

export type InstanceStatus = 'online' | 'offline'

/** Fully-qualified instance identifier: username@host:project/session_uuid */
export type InstanceId = string

export interface Message {
  messageId: string                    // UUIDv4
  from: InstanceId                     // server-stamped by hub; client-supplied value ignored
  to: InstanceId | 'broadcast'         // recipient instanceId or 'broadcast' for fan-out
  type: MessageType
  content: string
  replyToMessageId?: string            // correlates result/ack back to originating task/question
  metadata?: Record<string, unknown>
  timestamp: string                    // ISO 8601
}

export interface InstanceInfo {
  instanceId: InstanceId
  project: string
  status: InstanceStatus
  connectedAt: string                  // ISO 8601; last connection time
  queueDepth: number
}
```

- [ ] **Step 2: Run the test — expect PASS**

```bash
cd packages/shared && bun test tests/types.test.ts
```

Expected: PASS (all tests green)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/tests/types.test.ts
git commit -m "feat(shared): add Message and InstanceInfo types with MessageType enum"
```

---

### Task 7: Write Failing Tests for Zod Schemas

**Files:**
- Create: `packages/shared/tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/schema.test.ts
import { describe, it, expect } from 'bun:test'
import {
  MessageSchema,
  InstanceInfoSchema,
  SendMessageInputSchema,
  BroadcastInputSchema,
} from '../src/schema.js'

describe('MessageSchema', () => {
  it('parses a valid message', () => {
    const result = MessageSchema.safeParse({
      messageId: '550e8400-e29b-41d4-a716-446655440000',
      from: 'paul@mac:cc2cc/abc',
      to: 'alice@srv:api/def',
      type: 'task',
      content: 'Do the thing',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid message type', () => {
    const result = MessageSchema.safeParse({
      messageId: '550e8400-e29b-41d4-a716-446655440000',
      from: 'paul@mac:cc2cc/abc',
      to: 'alice@srv:api/def',
      type: 'broadcast',  // not a valid MessageType value
      content: 'test',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('allows to=broadcast', () => {
    const result = MessageSchema.safeParse({
      messageId: '550e8400-e29b-41d4-a716-446655440000',
      from: 'paul@mac:cc2cc/abc',
      to: 'broadcast',
      type: 'task',
      content: 'Fan-out message',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a message missing required fields', () => {
    const result = MessageSchema.safeParse({ from: 'paul@mac:cc2cc/abc' })
    expect(result.success).toBe(false)
  })
})

describe('SendMessageInputSchema', () => {
  it('parses valid send_message input', () => {
    const result = SendMessageInputSchema.safeParse({
      to: 'alice@srv:api/def',
      type: 'task',
      content: 'Do the thing',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional replyToMessageId', () => {
    const result = SendMessageInputSchema.safeParse({
      to: 'alice@srv:api/def',
      type: 'result',
      content: 'Done',
      replyToMessageId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.replyToMessageId).toBeDefined()
  })
})

describe('BroadcastInputSchema', () => {
  it('parses valid broadcast input', () => {
    const result = BroadcastInputSchema.safeParse({
      type: 'task',
      content: 'Starting refactor',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && bun test tests/schema.test.ts
```

Expected: FAIL — `Cannot find module '../src/schema.js'`

---

### Task 8: Implement `schema.ts`

**Files:**
- Create: `packages/shared/src/schema.ts`

- [ ] **Step 1: Implement schemas**

```ts
// packages/shared/src/schema.ts
import { z } from 'zod'

const MessageTypeSchema = z.enum(['task', 'result', 'question', 'ack', 'ping'])

export const MessageSchema = z.object({
  messageId:        z.string().uuid(),
  from:             z.string().min(1),
  to:               z.string().min(1),  // instanceId or 'broadcast'
  type:             MessageTypeSchema,
  content:          z.string().min(1),
  replyToMessageId: z.string().uuid().optional(),
  metadata:         z.record(z.unknown()).optional(),
  timestamp:        z.string().datetime(),
})

export const InstanceInfoSchema = z.object({
  instanceId:  z.string().min(1),
  project:     z.string().min(1),
  status:      z.enum(['online', 'offline']),
  connectedAt: z.string().datetime(),
  queueDepth:  z.number().int().min(0),
})

/** Input schema for the send_message MCP tool */
export const SendMessageInputSchema = z.object({
  to:               z.string().min(1),
  type:             MessageTypeSchema,
  content:          z.string().min(1),
  replyToMessageId: z.string().uuid().optional(),
  metadata:         z.record(z.unknown()).optional(),
})

/** Input schema for the broadcast MCP tool */
export const BroadcastInputSchema = z.object({
  type:     MessageTypeSchema,
  content:  z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
})

/** Input schema for the get_messages MCP tool */
export const GetMessagesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
})

// Infer TypeScript types from schemas where needed
export type MessageInput      = z.infer<typeof MessageSchema>
export type SendMessageInput  = z.infer<typeof SendMessageInputSchema>
export type BroadcastInput    = z.infer<typeof BroadcastInputSchema>
export type GetMessagesInput  = z.infer<typeof GetMessagesInputSchema>
```

- [ ] **Step 2: Run the test — expect PASS**

```bash
cd packages/shared && bun test tests/schema.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schema.ts packages/shared/tests/schema.test.ts
git commit -m "feat(shared): add Zod schemas for Message, InstanceInfo, and MCP tool inputs"
```

---

### Task 9: Write Failing Tests for WebSocket Events

**Files:**
- Create: `packages/shared/tests/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/events.test.ts
import { describe, it, expect } from 'bun:test'
import {
  HubEventSchema,
  type HubEvent,
  type InstanceJoinedEvent,
  type MessageSentEvent,
} from '../src/events.js'

describe('HubEventSchema', () => {
  it('parses instance:joined event', () => {
    const result = HubEventSchema.safeParse({
      event: 'instance:joined',
      instanceId: 'paul@mac:cc2cc/abc',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses message:sent event', () => {
    const result = HubEventSchema.safeParse({
      event: 'message:sent',
      message: {
        messageId: '550e8400-e29b-41d4-a716-446655440000',
        from: 'paul@mac:cc2cc/abc',
        to: 'alice@srv:api/def',
        type: 'task',
        content: 'Do the thing',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses broadcast:sent event', () => {
    const result = HubEventSchema.safeParse({
      event: 'broadcast:sent',
      from: 'paul@mac:cc2cc/abc',
      content: 'Starting refactor',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown event type', () => {
    const result = HubEventSchema.safeParse({
      event: 'unknown:event',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && bun test tests/events.test.ts
```

Expected: FAIL — `Cannot find module '../src/events.js'`

---

### Task 10: Implement `events.ts`

**Files:**
- Create: `packages/shared/src/events.ts`

- [ ] **Step 1: Implement WebSocket event shapes**

```ts
// packages/shared/src/events.ts
import { z } from 'zod'
import { MessageSchema, InstanceInfoSchema } from './schema.js'

const InstanceJoinedEventSchema = z.object({
  event:      z.literal('instance:joined'),
  instanceId: z.string().min(1),
  timestamp:  z.string().datetime(),
})

const InstanceLeftEventSchema = z.object({
  event:      z.literal('instance:left'),
  instanceId: z.string().min(1),
  timestamp:  z.string().datetime(),
})

const MessageSentEventSchema = z.object({
  event:     z.literal('message:sent'),
  message:   MessageSchema,
  timestamp: z.string().datetime(),
})

const BroadcastSentEventSchema = z.object({
  event:     z.literal('broadcast:sent'),
  from:      z.string().min(1),
  content:   z.string().min(1),
  timestamp: z.string().datetime(),
})

const QueueStatsEventSchema = z.object({
  event:      z.literal('queue:stats'),
  instanceId: z.string().min(1),
  depth:      z.number().int().min(0),
})

/** Discriminated union of all events the hub emits to WebSocket clients */
export const HubEventSchema = z.discriminatedUnion('event', [
  InstanceJoinedEventSchema,
  InstanceLeftEventSchema,
  MessageSentEventSchema,
  BroadcastSentEventSchema,
  QueueStatsEventSchema,
])

export type HubEvent            = z.infer<typeof HubEventSchema>
export type InstanceJoinedEvent = z.infer<typeof InstanceJoinedEventSchema>
export type InstanceLeftEvent   = z.infer<typeof InstanceLeftEventSchema>
export type MessageSentEvent    = z.infer<typeof MessageSentEventSchema>
export type BroadcastSentEvent  = z.infer<typeof BroadcastSentEventSchema>
export type QueueStatsEvent     = z.infer<typeof QueueStatsEventSchema>
```

- [ ] **Step 2: Run the test — expect PASS**

```bash
cd packages/shared && bun test tests/events.test.ts
```

Expected: PASS

- [ ] **Step 3: Run all shared tests**

```bash
cd packages/shared && bun test
```

Expected: All tests PASS

- [ ] **Step 4: Typecheck**

```bash
cd packages/shared && bun run typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/tests/events.test.ts
git commit -m "feat(shared): add WebSocket hub event shapes as discriminated union"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run full checkall from root**

```bash
cd /Users/probello/Repos/cc2cc && make checkall
```

Expected: fmt, lint, typecheck, and tests all pass for `@cc2cc/shared`. Other workspace packages may warn/skip (they don't exist yet — that's fine).

- [ ] **Step 2: Verify workspace resolution**

```bash
bun pm ls
```

Expected: `@cc2cc/shared` listed as a workspace package.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: plan 1 complete — monorepo scaffold and @cc2cc/shared package"
```

---

## What's Next

**Plan 2:** Hub server — Bun + Hono, WebSocket upgrade paths, Redis queues, instance registry, broadcast fan-out, REST endpoints, Docker build.
