# cc2cc Plan 3: MCP Plugin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `plugin/` MCP server that gives each Claude Code session a stdio-transport bridge to the cc2cc hub, enabling inbound message delivery as `notifications/claude/channel` notifications and outbound tool calls for sending, broadcasting, and listing instances.

**Architecture:** The plugin is a long-running Bun subprocess spawned by Claude Code. It maintains a single WebSocket connection to the hub with exponential-backoff reconnect. Inbound WS frames are forwarded to Claude as `notifications/claude/channel` events; outbound tool calls are serialised as JSON frames sent over the same WS connection. Config is assembled at startup from env vars and a fresh UUIDv4 is generated to form the instance ID.

**Tech Stack:** Bun, @modelcontextprotocol/sdk (latest), @cc2cc/shared (workspace), ws (latest)

**Dependencies:** Plan 1 (@cc2cc/shared types and schemas), Plan 2 (hub must be running for integration tests; unit tests use a mock WS server)

---

## File Map

```
plugin/
├── package.json                      # name: @cc2cc/plugin
├── tsconfig.json
└── src/
    ├── index.ts                      # MCP server entry, capability declaration, wires transport
    ├── config.ts                     # env-var config + instanceId assembly (username@host:project/uuid)
    ├── connection.ts                 # WebSocket client + exponential-backoff reconnect
    ├── channel.ts                    # hub WS message → MCP notifications/claude/channel emission
    └── tools.ts                     # MCP tool handlers (list_instances, send_message, broadcast, get_messages, ping)
plugin/tests/
    ├── config.test.ts
    ├── connection.test.ts
    ├── channel.test.ts
    ├── tools.test.ts
    └── integration.test.ts           # mock WS hub, verifies end-to-end notification emission
```

---

### Task 1: Scaffold Plugin Package

**Files:**
- Edit: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/src/index.ts` (stub)

- [ ] **Step 1: Resolve latest package versions**

```bash
cd /Users/probello/Repos/cc2cc/plugin
# Resolve latest versions before pinning — never copy from this plan
bun add @modelcontextprotocol/sdk ws
bun add --dev @types/ws typescript @biomejs/biome
```

- [ ] **Step 2: Replace `plugin/package.json` with full config**

```json
{
  "name": "@cc2cc/plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "bin": {
    "cc2cc-plugin": "./src/index.ts"
  },
  "scripts": {
    "start":     "bun run src/index.ts",
    "dev":       "bun --watch run src/index.ts",
    "build":     "echo 'plugin: no separate build step (bun runs TS directly)'",
    "test":      "bun test tests/",
    "lint":      "bunx biome lint ./src ./tests",
    "fmt":       "bunx biome format --write ./src ./tests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cc2cc/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "latest",
    "ws": "latest"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@types/ws": "latest",
    "typescript": "latest"
  }
}
```

> **Note:** `@cc2cc/shared` is resolved as a workspace package — Bun loads the TypeScript source directly without a separate build step.

- [ ] **Step 3: Create `plugin/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create stub `plugin/src/index.ts`**

```ts
// plugin/src/index.ts — placeholder replaced in Task 7
throw new Error('Not yet implemented')
```

- [ ] **Step 5: Install deps and verify workspace resolution**

```bash
cd /Users/probello/Repos/cc2cc && bun install
bun pm ls | grep '@cc2cc/plugin'
```

- [ ] **Step 6: Commit**

```bash
git add plugin/
git commit -m "chore(plugin): scaffold @cc2cc/plugin package with deps"
```

---

### Task 2: Write Failing Tests for `config.ts`

**Files:**
- Create: `plugin/tests/config.test.ts`

- [ ] **Step 1: Create the test**

```ts
// plugin/tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

// Save and restore env between tests
const saved: Record<string, string | undefined> = {}
function saveEnv(...keys: string[]) {
  for (const k of keys) saved[k] = process.env[k]
}
function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

const ENV_KEYS = [
  'CC2CC_HUB_URL',
  'CC2CC_API_KEY',
  'CC2CC_USERNAME',
  'CC2CC_HOST',
  'CC2CC_PROJECT',
]

describe('loadConfig', () => {
  beforeEach(() => saveEnv(...ENV_KEYS))
  afterEach(() => restoreEnv(...ENV_KEYS))

  it('reads explicit env vars', async () => {
    process.env.CC2CC_HUB_URL  = 'ws://192.168.1.10:3100'
    process.env.CC2CC_API_KEY  = 'secret-key'
    process.env.CC2CC_USERNAME = 'alice'
    process.env.CC2CC_HOST     = 'workstation'
    process.env.CC2CC_PROJECT  = 'myproject'

    // Re-import to force fresh config load
    const { loadConfig } = await import('../src/config.ts')
    const config = loadConfig()

    expect(config.hubUrl).toBe('ws://192.168.1.10:3100')
    expect(config.apiKey).toBe('secret-key')
    expect(config.username).toBe('alice')
    expect(config.host).toBe('workstation')
    expect(config.project).toBe('myproject')
  })

  it('falls back to $USER when CC2CC_USERNAME is absent', async () => {
    process.env.CC2CC_HUB_URL = 'ws://localhost:3100'
    process.env.CC2CC_API_KEY = 'key'
    delete process.env.CC2CC_USERNAME

    const { loadConfig } = await import('../src/config.ts')
    const config = loadConfig()

    // Falls back to process.env.USER or a non-empty string
    expect(typeof config.username).toBe('string')
    expect(config.username.length).toBeGreaterThan(0)
  })

  it('falls back to cwd basename when CC2CC_PROJECT is absent', async () => {
    process.env.CC2CC_HUB_URL = 'ws://localhost:3100'
    process.env.CC2CC_API_KEY = 'key'
    delete process.env.CC2CC_PROJECT

    const { loadConfig } = await import('../src/config.ts')
    const config = loadConfig()

    expect(typeof config.project).toBe('string')
    expect(config.project.length).toBeGreaterThan(0)
  })

  it('assembles instanceId as username@host:project/uuid', async () => {
    process.env.CC2CC_HUB_URL  = 'ws://localhost:3100'
    process.env.CC2CC_API_KEY  = 'key'
    process.env.CC2CC_USERNAME = 'bob'
    process.env.CC2CC_HOST     = 'laptop'
    process.env.CC2CC_PROJECT  = 'demo'

    const { loadConfig } = await import('../src/config.ts')
    const config = loadConfig()

    // Pattern: bob@laptop:demo/<uuidv4>
    expect(config.instanceId).toMatch(
      /^bob@laptop:demo\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('generates a unique instanceId each call', async () => {
    process.env.CC2CC_HUB_URL = 'ws://localhost:3100'
    process.env.CC2CC_API_KEY = 'key'

    const { loadConfig } = await import('../src/config.ts')
    const a = loadConfig()
    const b = loadConfig()

    expect(a.instanceId).not.toBe(b.instanceId)
  })

  it('throws when CC2CC_HUB_URL is missing', async () => {
    delete process.env.CC2CC_HUB_URL
    process.env.CC2CC_API_KEY = 'key'

    const { loadConfig } = await import('../src/config.ts')
    expect(() => loadConfig()).toThrow(/CC2CC_HUB_URL/)
  })

  it('throws when CC2CC_API_KEY is missing', async () => {
    process.env.CC2CC_HUB_URL = 'ws://localhost:3100'
    delete process.env.CC2CC_API_KEY

    const { loadConfig } = await import('../src/config.ts')
    expect(() => loadConfig()).toThrow(/CC2CC_API_KEY/)
  })
})
```

- [ ] **Step 2: Create `plugin/tests/` directory and run to confirm failure**

```bash
mkdir -p /Users/probello/Repos/cc2cc/plugin/tests
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/config.test.ts
```

Expected: FAIL — `Cannot find module '../src/config.ts'`

---

### Task 3: Implement `config.ts`

**Files:**
- Create: `plugin/src/config.ts`

- [ ] **Step 1: Implement config**

```ts
// plugin/src/config.ts
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface PluginConfig {
  /** Hub WebSocket URL, e.g. ws://192.168.1.10:3100 */
  hubUrl: string
  /** Shared API key — must match HUB_API_KEY on the hub */
  apiKey: string
  /** Username component of the instance ID */
  username: string
  /** Hostname component of the instance ID */
  host: string
  /** Project component of the instance ID (cwd basename by default) */
  project: string
  /**
   * Fully-qualified instance ID: username@host:project/uuidv4
   * Generated fresh on each loadConfig() call so each plugin start is unique.
   */
  instanceId: string
  /** Full WebSocket URL including auth: ws://<hubUrl>/ws/plugin?key=<apiKey> */
  wsUrl: string
}

/**
 * Load and validate plugin configuration from environment variables.
 * Generates a fresh UUIDv4 instance ID on every call.
 *
 * @throws {Error} If CC2CC_HUB_URL or CC2CC_API_KEY are not set.
 */
export function loadConfig(): PluginConfig {
  const hubUrl = process.env.CC2CC_HUB_URL
  if (!hubUrl) {
    throw new Error(
      'Missing required env var CC2CC_HUB_URL (e.g. ws://192.168.1.10:3100)'
    )
  }

  const apiKey = process.env.CC2CC_API_KEY
  if (!apiKey) {
    throw new Error(
      'Missing required env var CC2CC_API_KEY (must match hub HUB_API_KEY)'
    )
  }

  const username =
    process.env.CC2CC_USERNAME ||
    process.env.USER ||
    process.env.LOGNAME ||
    'unknown'

  const host =
    process.env.CC2CC_HOST ||
    process.env.HOSTNAME ||
    'unknown-host'

  const project =
    process.env.CC2CC_PROJECT ||
    basename(process.cwd())

  const sessionUuid = randomUUID()
  const instanceId  = `${username}@${host}:${project}/${sessionUuid}`

  // Build the full WebSocket URL with auth query parameter.
  // Hub validates key on upgrade and returns 401 if invalid.
  const wsUrl = `${hubUrl}/ws/plugin?key=${encodeURIComponent(apiKey)}`

  return { hubUrl, apiKey, username, host, project, instanceId, wsUrl }
}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/config.test.ts
```

Expected: All config tests PASS

- [ ] **Step 3: Commit**

```bash
git add plugin/src/config.ts plugin/tests/config.test.ts
git commit -m "feat(plugin): implement config.ts — env vars, instance ID assembly, UUIDv4"
```

---

### Task 4: Write Failing Tests for `connection.ts`

**Files:**
- Create: `plugin/tests/connection.test.ts`

- [ ] **Step 1: Create the test**

```ts
// plugin/tests/connection.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { WebSocketServer } from 'ws'

// A minimal in-process mock hub to test reconnect behaviour
async function startMockHub(port: number): Promise<{
  wss: WebSocketServer
  receivedMessages: string[]
  close: () => Promise<void>
}> {
  const receivedMessages: string[] = []
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      receivedMessages.push(data.toString())
    })
  })

  await new Promise<void>((resolve) => wss.on('listening', resolve))

  return {
    wss,
    receivedMessages,
    close: () =>
      new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve()))
      ),
  }
}

describe('HubConnection', () => {
  it('connects to the hub URL and emits "open" event', async () => {
    const { wss, close } = await startMockHub(19001)

    try {
      const { HubConnection } = await import('../src/connection.ts')
      const conn = new HubConnection(`ws://127.0.0.1:19001`, 'test-key')

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000)
        conn.on('open', () => { clearTimeout(timeout); resolve() })
        conn.connect()
      })

      conn.destroy()
    } finally {
      await close()
    }
  })

  it('emits "message" events for each frame received', async () => {
    const { wss, close } = await startMockHub(19002)

    try {
      const { HubConnection } = await import('../src/connection.ts')
      const conn = new HubConnection(`ws://127.0.0.1:19002`, 'test-key')
      const received: unknown[] = []

      conn.on('message', (data) => received.push(data))

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000)
        conn.on('open', () => {
          clearTimeout(timeout)
          // Send a frame from the server to the client
          wss.clients.forEach((ws) => ws.send(JSON.stringify({ type: 'ping' })))
          resolve()
        })
        conn.connect()
      })

      // Wait for message to arrive
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      expect(received.length).toBeGreaterThan(0)
      conn.destroy()
    } finally {
      await close()
    }
  })

  it('reconnects with exponential backoff after disconnect', async () => {
    // Start a server, connect, stop the server, restart it, verify reconnect
    let wss = await startMockHub(19003)
    const connectCount = { n: 0 }

    wss.wss.on('connection', () => { connectCount.n++ })

    const { HubConnection } = await import('../src/connection.ts')
    // Use 50ms initial delay for test speed
    const conn = new HubConnection(`ws://127.0.0.1:19003`, 'test-key', {
      initialDelayMs: 50,
      maxDelayMs: 200,
    })

    // First connect
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('initial connect timeout')), 3000)
      conn.on('open', () => { clearTimeout(timeout); resolve() })
      conn.connect()
    })

    expect(connectCount.n).toBe(1)

    // Kill the server to trigger disconnect
    await wss.close()

    // Restart on same port
    wss = await startMockHub(19003)
    wss.wss.on('connection', () => { connectCount.n++ })

    // Wait for reconnect (backoff starts at 50ms)
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    expect(connectCount.n).toBeGreaterThanOrEqual(2)
    conn.destroy()
    await wss.close()
  })

  it('send() transmits a JSON frame over the WebSocket', async () => {
    const { wss, receivedMessages, close } = await startMockHub(19004)

    try {
      const { HubConnection } = await import('../src/connection.ts')
      const conn = new HubConnection(`ws://127.0.0.1:19004`, 'test-key')

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000)
        conn.on('open', () => { clearTimeout(timeout); resolve() })
        conn.connect()
      })

      conn.send({ action: 'list_instances' })
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      expect(receivedMessages).toContain(JSON.stringify({ action: 'list_instances' }))
      conn.destroy()
    } finally {
      await close()
    }
  })

  it('destroy() stops reconnect attempts', async () => {
    const { HubConnection } = await import('../src/connection.ts')
    // Connect to a port with nothing listening
    const conn = new HubConnection(`ws://127.0.0.1:19099`, 'test-key', {
      initialDelayMs: 50,
      maxDelayMs: 100,
    })
    conn.connect()

    // Let one reconnect attempt happen then destroy
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    conn.destroy()

    // After destroy, no further events should be emitted — just verify no throw
    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/connection.test.ts
```

Expected: FAIL — `Cannot find module '../src/connection.ts'`

---

### Task 5: Implement `connection.ts`

**Files:**
- Create: `plugin/src/connection.ts`

- [ ] **Step 1: Implement the WebSocket client with exponential backoff**

```ts
// plugin/src/connection.ts
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export interface ConnectionOptions {
  /** Initial reconnect delay in milliseconds. Default: 1000 */
  initialDelayMs?: number
  /** Maximum reconnect delay in milliseconds. Default: 30000 */
  maxDelayMs?: number
  /** Backoff multiplier. Default: 2 */
  multiplier?: number
}

/**
 * HubConnection manages a persistent WebSocket connection to the cc2cc hub.
 *
 * Events emitted:
 *   'open'    — WebSocket connected successfully
 *   'message' — Parsed JSON payload received from hub
 *   'error'   — WebSocket error (non-fatal; reconnect will follow)
 *   'close'   — WebSocket closed; reconnect scheduled
 */
export class HubConnection extends EventEmitter {
  private readonly url: string
  private readonly opts: Required<ConnectionOptions>
  private ws: WebSocket | null = null
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentDelay: number

  constructor(url: string, _apiKey: string, opts: ConnectionOptions = {}) {
    super()
    // The API key is embedded in the URL as a query parameter by the caller
    // (config.ts assembles wsUrl = hubUrl + /ws/plugin?key=apiKey).
    // Accepting _apiKey here allows callers that pass the raw hub URL to work
    // in tests — production callers should pass the pre-assembled wsUrl.
    this.url  = url
    this.opts = {
      initialDelayMs: opts.initialDelayMs ?? 1000,
      maxDelayMs:     opts.maxDelayMs     ?? 30_000,
      multiplier:     opts.multiplier     ?? 2,
    }
    this.currentDelay = this.opts.initialDelayMs
  }

  /** Open the WebSocket connection. Safe to call multiple times (idempotent). */
  connect(): void {
    if (this.destroyed) return
    this._openSocket()
  }

  /** Send a JSON-serialisable payload to the hub. No-op if not connected. */
  send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  /**
   * Permanently destroy the connection and stop reconnect attempts.
   * After calling destroy() the instance must not be reused.
   */
  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }
  }

  private _openSocket(): void {
    if (this.destroyed) return

    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      this.emit('error', err)
      this._scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      this.currentDelay = this.opts.initialDelayMs  // reset backoff on successful connect
      this.emit('open')
    })

    this.ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString())
        this.emit('message', parsed)
      } catch {
        // Non-JSON frame — ignore silently; hub should never send these
      }
    })

    this.ws.on('error', (err) => {
      this.emit('error', err)
      // 'close' will follow; reconnect is scheduled there
    })

    this.ws.on('close', () => {
      this.emit('close')
      this._scheduleReconnect()
    })
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return

    const delay = this.currentDelay
    this.currentDelay = Math.min(
      this.currentDelay * this.opts.multiplier,
      this.opts.maxDelayMs
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._openSocket()
    }, delay)
  }
}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/connection.test.ts
```

Expected: All connection tests PASS

- [ ] **Step 3: Commit**

```bash
git add plugin/src/connection.ts plugin/tests/connection.test.ts
git commit -m "feat(plugin): implement HubConnection with exponential backoff reconnect"
```

---

### Task 6: Write Failing Tests for `channel.ts`

**Files:**
- Create: `plugin/tests/channel.test.ts`

- [ ] **Step 1: Create the test**

```ts
// plugin/tests/channel.test.ts
import { describe, it, expect, mock } from 'bun:test'
import type { Message } from '@cc2cc/shared'
import { MessageType } from '@cc2cc/shared'

describe('emitChannelNotification', () => {
  it('calls mcp.notification with notifications/claude/channel method', async () => {
    const { emitChannelNotification } = await import('../src/channel.ts')

    const notificationSpy = mock(async (_params: unknown) => {})
    const fakeServer = { notification: notificationSpy } as any

    const msg: Message = {
      messageId: '550e8400-e29b-41d4-a716-446655440000',
      from:      'alice@server:api/abc',
      to:        'bob@laptop:cc2cc/def',
      type:      MessageType.task,
      content:   'Please review the auth module',
      timestamp: new Date().toISOString(),
    }

    await emitChannelNotification(fakeServer, msg)

    expect(notificationSpy).toHaveBeenCalledTimes(1)
    const call = notificationSpy.mock.calls[0][0] as any
    expect(call.method).toBe('notifications/claude/channel')
  })

  it('sets params.content to message.content', async () => {
    const { emitChannelNotification } = await import('../src/channel.ts')

    const notificationSpy = mock(async (_params: unknown) => {})
    const fakeServer = { notification: notificationSpy } as any

    const msg: Message = {
      messageId: '550e8400-e29b-41d4-a716-446655440001',
      from:      'alice@server:api/abc',
      to:        'bob@laptop:cc2cc/def',
      type:      MessageType.result,
      content:   'Auth module looks good',
      timestamp: new Date().toISOString(),
    }

    await emitChannelNotification(fakeServer, msg)

    const call = notificationSpy.mock.calls[0][0] as any
    expect(call.params.content).toBe('Auth module looks good')
  })

  it('sets all required meta fields with identifier keys (no hyphens)', async () => {
    const { emitChannelNotification } = await import('../src/channel.ts')

    const notificationSpy = mock(async (_params: unknown) => {})
    const fakeServer = { notification: notificationSpy } as any

    const msg: Message = {
      messageId:        '550e8400-e29b-41d4-a716-446655440002',
      from:             'alice@server:api/abc',
      to:               'bob@laptop:cc2cc/def',
      type:             MessageType.ack,
      content:          'Accepted',
      replyToMessageId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp:        new Date().toISOString(),
    }

    await emitChannelNotification(fakeServer, msg)

    const call = notificationSpy.mock.calls[0][0] as any
    const meta = call.params.meta

    // Keys must be valid identifiers — no hyphens
    expect(meta.from).toBe('alice@server:api/abc')
    expect(meta.type).toBe('ack')
    expect(meta.message_id).toBe('550e8400-e29b-41d4-a716-446655440002')
    expect(meta.reply_to).toBe('550e8400-e29b-41d4-a716-446655440000')

    // Confirm hyphenated keys are NOT used
    expect(meta['message-id']).toBeUndefined()
    expect(meta['reply-to']).toBeUndefined()
  })

  it('sets reply_to to empty string when replyToMessageId is absent', async () => {
    const { emitChannelNotification } = await import('../src/channel.ts')

    const notificationSpy = mock(async (_params: unknown) => {})
    const fakeServer = { notification: notificationSpy } as any

    const msg: Message = {
      messageId: '550e8400-e29b-41d4-a716-446655440003',
      from:      'alice@server:api/abc',
      to:        'bob@laptop:cc2cc/def',
      type:      MessageType.question,
      content:   'What is the status?',
      timestamp: new Date().toISOString(),
      // replyToMessageId intentionally omitted
    }

    await emitChannelNotification(fakeServer, msg)

    const call = notificationSpy.mock.calls[0][0] as any
    expect(call.params.meta.reply_to).toBe('')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/channel.test.ts
```

Expected: FAIL — `Cannot find module '../src/channel.ts'`

---

### Task 7: Implement `channel.ts`

**Files:**
- Create: `plugin/src/channel.ts`

- [ ] **Step 1: Implement channel notification emitter**

```ts
// plugin/src/channel.ts
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Message } from '@cc2cc/shared'

/**
 * Emit a notifications/claude/channel notification to Claude Code.
 *
 * Claude Code renders this as:
 *   <channel source="cc2cc" from="..." type="..." message_id="..." reply_to="...">
 *     {message.content}
 *   </channel>
 *
 * Meta key naming rules (from the MCP channels reference):
 *   - Keys must be valid identifiers — no hyphens
 *   - Use snake_case: message_id, reply_to
 *
 * @param mcp    - The MCP Server instance used to emit the notification
 * @param message - The inbound message received from the hub over WebSocket
 */
export async function emitChannelNotification(
  mcp: Pick<Server, 'notification'>,
  message: Message,
): Promise<void> {
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: message.content,
      meta: {
        from:       message.from,
        type:       message.type,
        message_id: message.messageId,
        reply_to:   message.replyToMessageId ?? '',
      },
    },
  })
}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/channel.test.ts
```

Expected: All channel tests PASS

- [ ] **Step 3: Commit**

```bash
git add plugin/src/channel.ts plugin/tests/channel.test.ts
git commit -m "feat(plugin): implement channel.ts — hub message to MCP channel notification"
```

---

### Task 8: Write Failing Tests for `tools.ts`

**Files:**
- Create: `plugin/tests/tools.test.ts`

- [ ] **Step 1: Create the test**

```ts
// plugin/tests/tools.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { MessageType } from '@cc2cc/shared'
import type { InstanceInfo } from '@cc2cc/shared'

// ── Mock HubConnection ──────────────────────────────────────────────────────
// Tools communicate with the hub by sending JSON frames over the WS connection
// and awaiting a matching response. We mock HubConnection to test tools in
// isolation without a real hub or network.

function makeMockConnection(responseFactory: (req: unknown) => unknown) {
  const pendingResolvers = new Map<string, (v: unknown) => void>()
  const sentFrames: unknown[] = []

  const conn = {
    send: mock((frame: unknown) => {
      sentFrames.push(frame)
      // Simulate hub response: immediately resolve any pending awaiter
      const f = frame as { requestId?: string }
      if (f.requestId) {
        const resolve = pendingResolvers.get(f.requestId)
        if (resolve) {
          pendingResolvers.delete(f.requestId)
          resolve(responseFactory(frame))
        }
      }
    }),
    request: mock(async (action: string, payload: Record<string, unknown>) => {
      return responseFactory({ action, ...payload })
    }),
    sentFrames,
  }

  return conn
}

describe('listInstances', () => {
  it('sends list_instances action and returns InstanceInfo array', async () => {
    const { createTools } = await import('../src/tools.ts')

    const mockInstances: InstanceInfo[] = [
      {
        instanceId: 'alice@server:api/abc',
        project:    'api',
        status:     'online',
        connectedAt: new Date().toISOString(),
        queueDepth:  0,
      },
    ]

    const conn = makeMockConnection(() => ({ instances: mockInstances }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.list_instances({})
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].instanceId).toBe('alice@server:api/abc')
    expect(conn.request).toHaveBeenCalledWith('list_instances', {})
  })
})

describe('sendMessage', () => {
  it('sends send_message action with required fields and returns messageId', async () => {
    const { createTools } = await import('../src/tools.ts')

    const messageId = '550e8400-e29b-41d4-a716-446655440000'
    const conn = makeMockConnection(() => ({ messageId, queued: false }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.send_message({
      to:      'alice@server:api/abc',
      type:    MessageType.task,
      content: 'Please review auth module',
    })

    expect(result.messageId).toBe(messageId)
    expect(result.queued).toBe(false)
    expect(conn.request).toHaveBeenCalledWith('send_message', expect.objectContaining({
      to:      'alice@server:api/abc',
      type:    'task',
      content: 'Please review auth module',
    }))
  })

  it('includes replyToMessageId when provided', async () => {
    const { createTools } = await import('../src/tools.ts')

    const conn = makeMockConnection(() => ({
      messageId: '550e8400-e29b-41d4-a716-446655440001',
      queued:    true,
      warning:   'message queued, recipient offline',
    }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.send_message({
      to:               'alice@server:api/abc',
      type:             MessageType.result,
      content:          'Done',
      replyToMessageId: '550e8400-e29b-41d4-a716-446655440000',
    })

    expect(result.queued).toBe(true)
    expect(result.warning).toBe('message queued, recipient offline')
    expect(conn.request).toHaveBeenCalledWith('send_message', expect.objectContaining({
      replyToMessageId: '550e8400-e29b-41d4-a716-446655440000',
    }))
  })
})

describe('broadcast', () => {
  it('sends broadcast action and returns delivered count', async () => {
    const { createTools } = await import('../src/tools.ts')

    const conn = makeMockConnection(() => ({ delivered: 3 }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.broadcast({
      type:    MessageType.task,
      content: 'Starting auth refactor — avoid src/auth/',
    })

    expect(result.delivered).toBe(3)
    expect(conn.request).toHaveBeenCalledWith('broadcast', expect.objectContaining({
      type:    'task',
      content: 'Starting auth refactor — avoid src/auth/',
    }))
  })
})

describe('getMessages', () => {
  it('fetches messages with default limit of 10', async () => {
    const { createTools } = await import('../src/tools.ts')

    const fakeMessages = [
      {
        messageId: '550e8400-e29b-41d4-a716-446655440002',
        from:      'alice@server:api/abc',
        to:        'bob@laptop:cc2cc/def',
        type:      'task',
        content:   'Review the handler',
        timestamp: new Date().toISOString(),
      },
    ]

    const conn = makeMockConnection(() => ({ messages: fakeMessages }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.get_messages({})
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].messageId).toBe('550e8400-e29b-41d4-a716-446655440002')
    expect(conn.request).toHaveBeenCalledWith('get_messages', { limit: 10 })
  })

  it('respects a custom limit', async () => {
    const { createTools } = await import('../src/tools.ts')

    const conn = makeMockConnection(() => ({ messages: [] }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    await tools.get_messages({ limit: 5 })
    expect(conn.request).toHaveBeenCalledWith('get_messages', { limit: 5 })
  })
})

describe('ping', () => {
  it('returns online: true with latency when hub confirms online', async () => {
    const { createTools } = await import('../src/tools.ts')

    const conn = makeMockConnection(() => ({ online: true, latency: 12 }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.ping({ to: 'alice@server:api/abc' })
    expect(result.online).toBe(true)
    expect(typeof result.latency).toBe('number')
  })

  it('returns online: false when target is offline', async () => {
    const { createTools } = await import('../src/tools.ts')

    const conn = makeMockConnection(() => ({ online: false }))
    const tools = createTools(conn as any, 'bob@laptop:cc2cc/def')

    const result = await tools.ping({ to: 'ghost@server:api/xyz' })
    expect(result.online).toBe(false)
    expect(result.latency).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/tools.test.ts
```

Expected: FAIL — `Cannot find module '../src/tools.ts'`

---

### Task 9: Implement `tools.ts`

**Files:**
- Create: `plugin/src/tools.ts`

- [ ] **Step 1: Implement MCP tool handlers**

```ts
// plugin/src/tools.ts
import type { InstanceInfo, Message, MessageType } from '@cc2cc/shared'

// ── Connection interface ─────────────────────────────────────────────────────
// tools.ts depends on this interface rather than the concrete HubConnection
// class to keep the dependency direction clean and tests easy to mock.

export interface ConnectionClient {
  /**
   * Send an action to the hub and await the typed response.
   * The hub matches requests by action name.
   */
  request<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T>
}

// ── Tool input types ─────────────────────────────────────────────────────────

export interface SendMessageInput {
  to: string
  type: MessageType
  content: string
  replyToMessageId?: string
  metadata?: Record<string, unknown>
}

export interface BroadcastInput {
  type: MessageType
  content: string
  metadata?: Record<string, unknown>
}

export interface GetMessagesInput {
  limit?: number
}

export interface PingInput {
  to: string
}

// ── Tool output types ────────────────────────────────────────────────────────

export interface SendMessageResult {
  messageId: string
  queued: boolean
  warning?: string
}

export interface BroadcastResult {
  delivered: number
}

export interface PingResult {
  online: boolean
  latency?: number
}

// ── Tool factory ─────────────────────────────────────────────────────────────

/**
 * Create the MCP tool handler functions bound to a given connection and instance ID.
 *
 * Each tool sends a JSON frame to the hub via the connection's `request()` method
 * and returns the typed hub response. The `instanceId` parameter is available for
 * future use (e.g. stamping outbound frames) but the hub server-stamps `from`
 * from the registered socket, so the plugin never needs to send it.
 *
 * @param conn       - Connection client wrapping the hub WebSocket
 * @param instanceId - This plugin's instance ID (for local reference)
 */
export function createTools(conn: ConnectionClient, _instanceId: string) {
  return {
    /**
     * list_instances — returns all known instances (online and offline).
     * Returns: InstanceInfo[]
     */
    async list_instances(_input: Record<string, never>): Promise<InstanceInfo[]> {
      const resp = await conn.request<{ instances: InstanceInfo[] }>(
        'list_instances',
        {}
      )
      return resp.instances
    },

    /**
     * send_message — send a typed message to a specific instance.
     * If the target is offline the hub queues it and sets queued=true + warning.
     */
    async send_message(input: SendMessageInput): Promise<SendMessageResult> {
      const payload: Record<string, unknown> = {
        to:      input.to,
        type:    input.type,
        content: input.content,
      }
      if (input.replyToMessageId !== undefined) {
        payload.replyToMessageId = input.replyToMessageId
      }
      if (input.metadata !== undefined) {
        payload.metadata = input.metadata
      }
      return conn.request<SendMessageResult>('send_message', payload)
    },

    /**
     * broadcast — fire-and-forget to all online instances except self.
     * Rate-limited to one per 5 seconds by the hub (returns 429-equivalent error if exceeded).
     * Returns: { delivered: number }
     */
    async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
      const payload: Record<string, unknown> = {
        type:    input.type,
        content: input.content,
      }
      if (input.metadata !== undefined) {
        payload.metadata = input.metadata
      }
      return conn.request<BroadcastResult>('broadcast', payload)
    },

    /**
     * get_messages — destructive pull from own queue (LPOP up to limit).
     * Default limit: 10. Use as polling fallback only — live delivery arrives
     * via WebSocket channel notifications.
     * Returns: Message[]
     */
    async get_messages(input: GetMessagesInput): Promise<Message[]> {
      const limit = input.limit ?? 10
      const resp  = await conn.request<{ messages: Message[] }>(
        'get_messages',
        { limit }
      )
      return resp.messages
    },

    /**
     * ping — check liveness of a target instance.
     * Returns: { online: boolean, latency?: number }
     */
    async ping(input: PingInput): Promise<PingResult> {
      return conn.request<PingResult>('ping', { to: input.to })
    },
  }
}

export type PluginTools = ReturnType<typeof createTools>
```

- [ ] **Step 2: Add `request()` method to `HubConnection` (extends Task 5)**

Open `plugin/src/connection.ts` and add the `request()` method. The hub routes WS frames by `action`; it sends back a response frame with the same `requestId`. The plugin generates a UUID per request, sends the frame, and waits for the response.

```ts
// Add to HubConnection class in plugin/src/connection.ts

import { randomUUID } from 'node:crypto'

// Inside HubConnection class:

  /**
   * Send an action frame to the hub and await the matching response frame.
   * Resolves when the hub sends back { requestId: <same id>, ... }.
   * Rejects after 10 seconds if no response arrives.
   *
   * @throws {Error} If the connection is not open or the request times out
   */
  request<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID()

      const timeout = setTimeout(() => {
        this.removeListener('message', handler)
        reject(new Error(`request timeout: action=${action} requestId=${requestId}`))
      }, 10_000)

      const handler = (data: unknown) => {
        const frame = data as { requestId?: string } & T
        if (frame.requestId === requestId) {
          clearTimeout(timeout)
          this.removeListener('message', handler)
          resolve(frame)
        }
      }

      this.on('message', handler)
      this.send({ action, requestId, ...payload })
    })
  }
```

> **Implementation note:** Add `import { randomUUID } from 'node:crypto'` to the top of `connection.ts` if not already present, and paste the `request()` method into the `HubConnection` class body after the existing `send()` method.

- [ ] **Step 3: Run all plugin tests so far**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/tools.test.ts tests/connection.test.ts tests/channel.test.ts tests/config.test.ts
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add plugin/src/tools.ts plugin/src/connection.ts plugin/tests/tools.test.ts
git commit -m "feat(plugin): implement MCP tool handlers (list_instances, send_message, broadcast, get_messages, ping)"
```

---

### Task 10: Implement `index.ts` — MCP Server Entry Point

**Files:**
- Edit: `plugin/src/index.ts` (replace stub)

- [ ] **Step 1: Implement the MCP server entry**

```ts
// plugin/src/index.ts
import { Server }     from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { loadConfig }             from './config.js'
import { HubConnection }          from './connection.js'
import { emitChannelNotification } from './channel.js'
import { createTools }            from './tools.js'
import type { Message }           from '@cc2cc/shared'
import { MessageType }            from '@cc2cc/shared'

// ── Boot ────────────────────────────────────────────────────────────────────

const config = loadConfig()

// ── MCP Server ──────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'cc2cc', version: '0.1.0' },
  {
    capabilities: {
      /**
       * claude/channel: Claude Code-specific capability.
       * Enables notifications/claude/channel push, rendered as <channel> XML tags.
       * Requires Claude Code v2.1.80+ and --dangerously-load-development-channels.
       */
      experimental: { 'claude/channel': {} },
      /** tools: standard MCP capability for outbound tool calls */
      tools: {},
    },
    instructions: `
You are connected to the cc2cc hub as instance ${config.instanceId}.

Messages from other Claude instances arrive as <channel> tags with attributes:
  source="cc2cc"  from="<instanceId>"  type="<task|result|question|ack|ping>"
  message_id="<uuid>"  reply_to="<uuid or empty>"

Refer to the cc2cc skill for the full collaboration protocol.
Always check reply_to when receiving results to match them to outstanding tasks.
    `.trim(),
  },
)

// ── Hub Connection ───────────────────────────────────────────────────────────

const conn = new HubConnection(config.wsUrl, config.apiKey)
const tools = createTools(conn, config.instanceId)

// Route inbound hub WS messages to channel notifications
conn.on('message', async (data: unknown) => {
  // Only forward message envelopes (hub also sends ack frames for tool requests)
  const frame = data as { messageId?: string } & Message
  if (frame.messageId && frame.from && frame.content) {
    await emitChannelNotification(mcp, frame as Message)
  }
})

conn.on('error', (err: Error) => {
  // Log to stderr — never to stdout (stdio is the MCP transport)
  process.stderr.write(`[cc2cc] hub connection error: ${err.message}\n`)
})

// ── Tool Definitions (ListTools) ─────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        'list_instances',
      description: 'List all cc2cc instances (online and offline) with their status and queue depth.',
      inputSchema: {
        type:       'object',
        properties: {},
        required:   [],
      },
    },
    {
      name:        'send_message',
      description:
        'Send a typed message to a specific Claude instance. ' +
        'If the target is offline the message is queued and warning is set.',
      inputSchema: {
        type:     'object',
        required: ['to', 'type', 'content'],
        properties: {
          to:               { type: 'string', description: 'Target instance ID' },
          type:             { type: 'string', enum: Object.values(MessageType), description: 'Message type' },
          content:          { type: 'string', description: 'Message content' },
          replyToMessageId: { type: 'string', description: 'messageId this reply correlates to', nullable: true },
          metadata:         { type: 'object', description: 'Optional metadata key-value pairs', nullable: true },
        },
      },
    },
    {
      name:        'broadcast',
      description:
        'Fire-and-forget broadcast to all online instances except self. ' +
        'Rate-limited to one per 5 seconds. Returns delivered count.',
      inputSchema: {
        type:     'object',
        required: ['type', 'content'],
        properties: {
          type:     { type: 'string', enum: Object.values(MessageType) },
          content:  { type: 'string' },
          metadata: { type: 'object', nullable: true },
        },
      },
    },
    {
      name:        'get_messages',
      description:
        'Destructive pull: LPOP up to `limit` messages from own queue (default 10). ' +
        'Use as polling fallback only — live delivery is via channel notifications.',
      inputSchema: {
        type:       'object',
        properties: {
          limit: { type: 'number', description: 'Max messages to return (1–100)', default: 10 },
        },
        required: [],
      },
    },
    {
      name:        'ping',
      description: 'Check liveness of a target instance. Returns { online, latency? }.',
      inputSchema: {
        type:     'object',
        required: ['to'],
        properties: {
          to: { type: 'string', description: 'Target instance ID to ping' },
        },
      },
    },
  ],
}))

// ── Tool Dispatch (CallTool) ──────────────────────────────────────────────────

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  try {
    switch (name) {
      case 'list_instances': {
        const instances = await tools.list_instances({})
        return { content: [{ type: 'text', text: JSON.stringify(instances, null, 2) }] }
      }

      case 'send_message': {
        const input = z.object({
          to:               z.string(),
          type:             z.nativeEnum(MessageType),
          content:          z.string(),
          replyToMessageId: z.string().optional(),
          metadata:         z.record(z.unknown()).optional(),
        }).parse(args)

        const result = await tools.send_message(input)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'broadcast': {
        const input = z.object({
          type:     z.nativeEnum(MessageType),
          content:  z.string(),
          metadata: z.record(z.unknown()).optional(),
        }).parse(args)

        const result = await tools.broadcast(input)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'get_messages': {
        const input = z.object({
          limit: z.number().int().min(1).max(100).default(10),
        }).parse(args)

        const messages = await tools.get_messages(input)
        return { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }] }
      }

      case 'ping': {
        const input = z.object({ to: z.string() }).parse(args)
        const result = await tools.ping(input)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    }
  }
})

// ── Connect and Start ─────────────────────────────────────────────────────────

conn.connect()

const transport = new StdioServerTransport()
await mcp.connect(transport)

// Graceful shutdown
process.on('SIGINT',  () => { conn.destroy(); process.exit(0) })
process.on('SIGTERM', () => { conn.destroy(); process.exit(0) })
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun run typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add plugin/src/index.ts
git commit -m "feat(plugin): implement MCP server entry with capability declaration and tool dispatch"
```

---

### Task 11: Write Failing Integration Test

**Files:**
- Create: `plugin/tests/integration.test.ts`

The integration test spins up an in-process mock hub WebSocket server, connects a real `HubConnection`, sends a simulated inbound message from the hub, and verifies that `emitChannelNotification` is called with the correct parameters. It does not test the full MCP stdio transport (which requires Claude Code) but validates the end-to-end path from WS frame to notification call.

- [ ] **Step 1: Create the integration test**

```ts
// plugin/tests/integration.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { WebSocketServer }            from 'ws'
import { MessageType }                from '@cc2cc/shared'
import type { Message }               from '@cc2cc/shared'

const INTEGRATION_PORT = 19100

async function startMockHub(port: number) {
  const wss = new WebSocketServer({ port })
  await new Promise<void>((resolve) => wss.on('listening', resolve))
  return {
    wss,
    close: () => new Promise<void>((resolve, reject) =>
      wss.close((err) => (err ? reject(err) : resolve()))
    ),
  }
}

describe('Plugin integration: hub WS message → channel notification', () => {
  it('emits a channel notification when hub delivers a message', async () => {
    const { wss, close } = await startMockHub(INTEGRATION_PORT)

    try {
      const { HubConnection }          = await import('../src/connection.ts')
      const { emitChannelNotification } = await import('../src/channel.ts')

      const notificationSpy = mock(async (_params: unknown) => {})
      const fakeMcp = { notification: notificationSpy } as any

      const conn = new HubConnection(`ws://127.0.0.1:${INTEGRATION_PORT}`, 'test-key')
      const receivedMessages: Message[] = []

      // Wire connection to channel emitter — same as index.ts does
      conn.on('message', async (data: unknown) => {
        const frame = data as { messageId?: string } & Message
        if (frame.messageId && frame.from && frame.content) {
          receivedMessages.push(frame as Message)
          await emitChannelNotification(fakeMcp, frame as Message)
        }
      })

      // Connect and wait for the WS handshake
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000)
        conn.on('open', () => { clearTimeout(timeout); resolve() })
        conn.connect()
      })

      // Hub pushes a message envelope to the plugin
      const inboundMessage: Message = {
        messageId: '550e8400-e29b-41d4-a716-446655440099',
        from:      'alice@server:api/xyz',
        to:        'bob@laptop:cc2cc/def',
        type:      MessageType.task,
        content:   'Please review the auth handler',
        timestamp: new Date().toISOString(),
      }

      wss.clients.forEach((ws) => ws.send(JSON.stringify(inboundMessage)))

      // Wait for async message handler to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 200))

      // Verify the channel notification was emitted
      expect(notificationSpy).toHaveBeenCalledTimes(1)

      const call = notificationSpy.mock.calls[0][0] as any
      expect(call.method).toBe('notifications/claude/channel')
      expect(call.params.content).toBe('Please review the auth handler')
      expect(call.params.meta.from).toBe('alice@server:api/xyz')
      expect(call.params.meta.type).toBe('task')
      expect(call.params.meta.message_id).toBe('550e8400-e29b-41d4-a716-446655440099')
      expect(call.params.meta.reply_to).toBe('')

      conn.destroy()
    } finally {
      await close()
    }
  })

  it('does not emit notification for hub ack frames (no messageId)', async () => {
    const { wss, close } = await startMockHub(INTEGRATION_PORT + 1)

    try {
      const { HubConnection }          = await import('../src/connection.ts')
      const { emitChannelNotification } = await import('../src/channel.ts')

      const notificationSpy = mock(async (_params: unknown) => {})
      const fakeMcp = { notification: notificationSpy } as any

      const conn = new HubConnection(`ws://127.0.0.1:${INTEGRATION_PORT + 1}`, 'test-key')

      conn.on('message', async (data: unknown) => {
        const frame = data as { messageId?: string } & Message
        if (frame.messageId && frame.from && frame.content) {
          await emitChannelNotification(fakeMcp, frame as Message)
        }
      })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000)
        conn.on('open', () => { clearTimeout(timeout); resolve() })
        conn.connect()
      })

      // Hub sends a tool-response ack frame (no messageId, from, content)
      const ackFrame = {
        requestId: '550e8400-e29b-41d4-a716-000000000001',
        instances: [],
      }
      wss.clients.forEach((ws) => ws.send(JSON.stringify(ackFrame)))

      await new Promise<void>((resolve) => setTimeout(resolve, 200))

      // Notification must NOT be emitted for non-message frames
      expect(notificationSpy).not.toHaveBeenCalled()

      conn.destroy()
    } finally {
      await close()
    }
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test tests/integration.test.ts
```

Expected: FAIL (module not yet wired, or the test reveals a gap in connection.ts)

---

### Task 12: Make Integration Test Pass

- [ ] **Step 1: Run all plugin tests**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test
```

Review any failures. The integration test exercises the same code paths as the unit tests but with a real WebSocket connection. Common failure modes:

- **`connection.ts` emits 'message' before 'open'**: Ensure the `open` event fires first.
- **JSON parse failure on non-JSON frames**: The `ws.on('message')` handler already silently skips these — confirm the ack frame guard in the integration test matches `connection.ts` behaviour.
- **Port conflicts**: Each test uses a unique port (19001–19004 for unit, 19100–19101 for integration). Verify no overlap with other tests.

- [ ] **Step 2: Fix any issues found**

Fix only what the test reveals. Do not change the test to match broken behaviour — fix the implementation.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun test
```

Expected: All tests PASS

- [ ] **Step 4: Typecheck**

```bash
cd /Users/probello/Repos/cc2cc/plugin && bun run typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add plugin/tests/integration.test.ts
git commit -m "test(plugin): add integration test — mock hub WS → channel notification emission"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run `make checkall` from root**

```bash
cd /Users/probello/Repos/cc2cc && make checkall
```

Expected: fmt, lint, typecheck, and all tests pass for `@cc2cc/plugin` (and continue to pass for `@cc2cc/shared`).

- [ ] **Step 2: Verify the plugin starts without crashing (smoke test)**

```ts
// Set required env vars then run — will fail to connect (no hub running) but
// must not throw a startup error
CC2CC_HUB_URL=ws://127.0.0.1:3100 CC2CC_API_KEY=test-key bun run plugin/src/index.ts &
sleep 1
kill %1
```

Expected: Process starts, logs a connection error to stderr, does not crash.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(plugin): plan 3 complete — MCP plugin with channel notifications and all tools"
```

---

## What's Next

**Plan 4:** Hub server — Bun + Hono, `/ws/plugin` and `/ws/dashboard` WebSocket upgrade paths, Redis queues with RPOPLPUSH delivery guarantees, instance registry, broadcast fan-out with rate limiting, REST endpoints (`/health`, `/api/instances`, `/api/stats`, `/api/messages/:id`, `DELETE /api/queue/:id`), and Docker build.

**Plan 5:** Next.js dashboard — three views (Command Center, Analytics, Conversations), live WebSocket context with exponential backoff, instance sidebar, message feed with type filter chips, and manual send bar.

**Plan 6:** Skill — `skill/cc2cc.md` and the three pattern sub-documents (`task-delegation.md`, `broadcast.md`, `result-aggregation.md`).
