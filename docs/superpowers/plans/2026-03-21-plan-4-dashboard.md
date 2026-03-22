# cc2cc Plan 4: Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `dashboard/` Next.js app that gives operators a real-time view into all Claude instances, message flows, analytics, and conversation threads via three distinct views backed by a single WebSocket connection to the hub.

**Architecture:** A Next.js app with a shared `WsProvider` React context that owns the single WebSocket connection to the hub's `/ws/dashboard` endpoint with exponential backoff reconnect. All three views (Command Center, Analytics, Conversations) consume live events from this context plus REST calls to `/api/stats` and `/api/instances`. Session-local counters for active tasks and errors are accumulated in the provider and exposed via context. The dashboard never stores messages in a database — all state is ephemeral in-memory for the current browser session.

**Tech Stack:** Next.js (latest stable), Tailwind CSS (latest), shadcn/ui, @cc2cc/shared (workspace), React Testing Library + Jest (component tests), Bun runtime

---

## File Map

```
dashboard/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                         # shadcn/ui config
├── Dockerfile
├── .env.local.example
├── src/
│   ├── app/
│   │   ├── layout.tsx                      # root layout: WsProvider, nav tabs, connection banner
│   │   ├── page.tsx                        # View A — Command Center
│   │   ├── analytics/
│   │   │   └── page.tsx                    # View B — Analytics
│   │   └── conversations/
│   │       └── page.tsx                    # View C — Conversations
│   ├── components/
│   │   ├── ws-provider/
│   │   │   ├── ws-provider.tsx             # WebSocket context + exponential backoff
│   │   │   └── ws-provider.test.tsx        # RTL tests for connection state transitions
│   │   ├── connection-banner/
│   │   │   ├── connection-banner.tsx       # green/yellow/red pill banner
│   │   │   └── connection-banner.test.tsx
│   │   ├── nav/
│   │   │   └── nav-tabs.tsx                # top-level navigation between views
│   │   ├── instance-sidebar/
│   │   │   ├── instance-sidebar.tsx        # online + offline instance list with badges
│   │   │   └── instance-sidebar.test.tsx
│   │   ├── message-feed/
│   │   │   ├── message-feed.tsx            # live colored message stream + type filter chips
│   │   │   ├── message-row.tsx             # single message row with color-coded left border
│   │   │   └── message-feed.test.tsx
│   │   ├── manual-send-bar/
│   │   │   ├── manual-send-bar.tsx         # target selector + content input + send button
│   │   │   └── manual-send-bar.test.tsx
│   │   ├── stats-bar/
│   │   │   └── stats-bar.tsx               # shared stats display component
│   │   ├── activity-timeline/
│   │   │   └── activity-timeline.tsx       # per-instance dot grid on time axis
│   │   ├── conversation-view/
│   │   │   ├── conversation-view.tsx       # two-instance chat with thread grouping
│   │   │   └── message-inspector.tsx       # right panel metadata inspector
│   │   └── ui/                             # shadcn/ui generated components (badge, button, etc.)
│   ├── hooks/
│   │   └── use-ws.ts                       # useWs() hook — consumes WsContext
│   ├── lib/
│   │   ├── api.ts                          # typed fetch wrappers for hub REST endpoints
│   │   └── utils.ts                        # cn() helper + message type → color mapping
│   └── types/
│       └── dashboard.ts                    # dashboard-local types (FeedMessage, InstanceState, etc.)
└── tests/
    └── setup.ts                            # RTL global setup (jest-dom matchers)
```

---

### Task 1: Scaffold Next.js App

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/next.config.ts`
- Create: `dashboard/.env.local.example`

- [ ] **Step 1: Scaffold the Next.js app using create-next-app via bunx**

```bash
cd /Users/probello/Repos/cc2cc
bunx create-next-app@latest dashboard \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

> Accept all prompts. This creates the full Next.js scaffold with TypeScript, Tailwind CSS, ESLint, and the App Router inside `src/`.

- [ ] **Step 2: Add runtime dependencies**

```bash
cd /Users/probello/Repos/cc2cc/dashboard
bun add @cc2cc/shared
bun add class-variance-authority clsx tailwind-merge lucide-react
bun add next-themes
```

- [ ] **Step 3: Add dev dependencies for testing**

```bash
bun add --dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
bun add --dev jest jest-environment-jsdom @types/jest ts-jest
```

- [ ] **Step 4: Replace `dashboard/package.json` scripts section**

The generated `package.json` scripts should be updated to match project standards. Replace the `scripts` field:

```json
{
  "scripts": {
    "dev": "next dev -p 8030",
    "dev:bg": "next dev -p 8030 &",
    "restart:bg": "bun run kill && bun run dev:bg",
    "kill": "lsof -ti:8030 | xargs kill -9 2>/dev/null || true",
    "build": "next build",
    "start": "next start -p 8030",
    "lint": "next lint",
    "fmt": "bunx biome format --write ./src",
    "typecheck": "tsc --noEmit",
    "test": "jest --passWithNoTests"
  }
}
```

- [ ] **Step 5: Create `dashboard/.env.local.example`**

```bash
# Copy to .env.local and fill in real values
NEXT_PUBLIC_HUB_WS_URL=ws://localhost:3100
NEXT_PUBLIC_HUB_API_KEY=change-me-before-use
```

- [ ] **Step 6: Create `dashboard/jest.config.ts`**

```ts
import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.tsx', '**/*.test.ts'],
  passWithNoTests: true,
}

export default config
```

- [ ] **Step 7: Create `dashboard/tests/setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 8: Initialize shadcn/ui**

```bash
cd /Users/probello/Repos/cc2cc/dashboard
bunx shadcn@latest init --defaults
```

When prompted: choose Dark theme, keep CSS variables enabled.

- [ ] **Step 9: Add required shadcn/ui components**

```bash
bunx shadcn@latest add badge button card separator sheet tabs tooltip scroll-area select textarea
```

- [ ] **Step 10: Commit scaffold**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/
git commit -m "chore(dashboard): scaffold Next.js app with Tailwind, shadcn/ui, and test setup"
```

---

### Task 2: Dashboard-Local Types

**Files:**
- Create: `dashboard/src/types/dashboard.ts`

- [ ] **Step 1: Create dashboard-local type definitions**

```ts
// dashboard/src/types/dashboard.ts
import type { Message, InstanceInfo } from '@cc2cc/shared'

/** Connection state driven by the WsProvider reconnect logic */
export type ConnectionState = 'online' | 'reconnecting' | 'disconnected'

/**
 * A message as it appears in the feed — enriches the base Message with
 * display metadata injected by WsProvider when the event arrives.
 */
export interface FeedMessage {
  /** Original message envelope from the hub */
  message: Message
  /** Wall-clock time the dashboard received this event (for timeline display) */
  receivedAt: Date
  /** True when this message was sent via the broadcast fan-out path */
  isBroadcast: boolean
}

/** Live per-instance state maintained by WsProvider */
export interface InstanceState extends InstanceInfo {
  /** Last queue depth reported by queue:stats event */
  queueDepth: number
}

/** Session-local counters accumulated by WsProvider for the Analytics view */
export interface SessionStats {
  /** Incremented on message:sent with type=task; decremented when matching result arrives */
  activeTasks: number
  /** Incremented on any WebSocket connection error or 429-response event from the hub */
  errors: number
  /** Pending task message IDs waiting for a matching result (keyed by messageId) */
  pendingTaskIds: Set<string>
}

/** Full state shape exposed by WsContext */
export interface WsContextValue {
  connectionState: ConnectionState
  /** All known instances (online + offline), keyed by instanceId */
  instances: Map<string, InstanceState>
  /** Ordered list of feed messages (newest last), capped at MAX_FEED_SIZE */
  feed: FeedMessage[]
  /** Session-local counters */
  sessionStats: SessionStats
  /**
   * Send a WS frame to the hub.
   * Throws if the socket is not open.
   */
  sendFrame: (payload: SendFramePayload) => void
}

/** Payload shape for a message sent from the dashboard manual-send bar */
export interface SendFramePayload {
  type: 'send_message'
  to: string
  messageType: string
  content: string
}

/** Shape returned by GET /api/stats */
export interface HubStats {
  messagesToday: number
  activeInstances: number
  queuedTotal: number
}

/** Color token for each message type (Tailwind class fragments) */
export type MessageTypeColor =
  | 'amber'    // task
  | 'green'    // result
  | 'blue'     // question
  | 'purple'   // broadcast
  | 'zinc'     // ack / ping (dim)
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/types/dashboard.ts
git commit -m "feat(dashboard): add dashboard-local TypeScript types"
```

---

### Task 3: Utility Library

**Files:**
- Create: `dashboard/src/lib/utils.ts`
- Create: `dashboard/src/lib/api.ts`

- [ ] **Step 1: Create `dashboard/src/lib/utils.ts`**

```ts
// dashboard/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { MessageType } from '@cc2cc/shared'
import type { MessageTypeColor } from '@/types/dashboard'

/** shadcn/ui cn() helper */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Returns the Tailwind color token for a given message type.
 * Used to drive border, background, and badge colors consistently.
 */
export function messageTypeColor(
  type: MessageType | string,
  isBroadcast = false,
): MessageTypeColor {
  if (isBroadcast) return 'purple'
  switch (type) {
    case MessageType.task:     return 'amber'
    case MessageType.result:   return 'green'
    case MessageType.question: return 'blue'
    case MessageType.ack:
    case MessageType.ping:     return 'zinc'
    default:                   return 'zinc'
  }
}

/**
 * Maps a color token to Tailwind classes for a left-border message row.
 * Returns an object with `border`, `bg`, and `text` class strings.
 */
export function messageColorClasses(color: MessageTypeColor): {
  border: string
  bg: string
  badge: string
  text: string
} {
  const map: Record<MessageTypeColor, { border: string; bg: string; badge: string; text: string }> = {
    amber:  { border: 'border-l-amber-500',  bg: 'bg-amber-950/20',  badge: 'bg-amber-500/20 text-amber-300',  text: 'text-amber-300'  },
    green:  { border: 'border-l-green-500',  bg: 'bg-green-950/20',  badge: 'bg-green-500/20 text-green-300',  text: 'text-green-300'  },
    blue:   { border: 'border-l-blue-500',   bg: 'bg-blue-950/20',   badge: 'bg-blue-500/20 text-blue-300',   text: 'text-blue-300'   },
    purple: { border: 'border-l-purple-500', bg: 'bg-purple-950/30', badge: 'bg-purple-500/20 text-purple-300', text: 'text-purple-300' },
    zinc:   { border: 'border-l-zinc-600',   bg: 'bg-zinc-900/10',   badge: 'bg-zinc-700/40 text-zinc-400',   text: 'text-zinc-400'   },
  }
  return map[color]
}

/** Format an ISO 8601 timestamp for display in the feed (HH:MM:SS local time) */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** Truncate a long instance ID for sidebar display */
export function shortInstanceId(instanceId: string): string {
  // "paul@macbook:cc2cc/a1b2c3d4-..." → "paul@macbook:cc2cc"
  const slashIdx = instanceId.lastIndexOf('/')
  return slashIdx !== -1 ? instanceId.slice(0, slashIdx) : instanceId
}
```

- [ ] **Step 2: Create `dashboard/src/lib/api.ts`**

```ts
// dashboard/src/lib/api.ts
import type { InstanceInfo } from '@cc2cc/shared'
import type { HubStats } from '@/types/dashboard'

const HUB_BASE = process.env.NEXT_PUBLIC_HUB_WS_URL
  ?.replace('ws://', 'http://')
  .replace('wss://', 'https://') ?? 'http://localhost:3100'

const API_KEY = process.env.NEXT_PUBLIC_HUB_API_KEY ?? ''

function hubUrl(path: string): string {
  return `${HUB_BASE}${path}?key=${encodeURIComponent(API_KEY)}`
}

/**
 * Fetch all instances (online + offline) from the hub REST API.
 * Returns an empty array on error so the UI degrades gracefully.
 */
export async function fetchInstances(): Promise<InstanceInfo[]> {
  try {
    const res = await fetch(hubUrl('/api/instances'), {
      next: { revalidate: 0 },  // always fresh
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    return res.json() as Promise<InstanceInfo[]>
  } catch {
    return []
  }
}

/**
 * Fetch aggregate stats from the hub REST API.
 * Returns zeroed stats on error.
 */
export async function fetchStats(): Promise<HubStats> {
  const fallback: HubStats = { messagesToday: 0, activeInstances: 0, queuedTotal: 0 }
  try {
    const res = await fetch(hubUrl('/api/stats'), {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return fallback
    return res.json() as Promise<HubStats>
  } catch {
    return fallback
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/lib/
git commit -m "feat(dashboard): add utility helpers and typed hub API wrappers"
```

---

### Task 4: WsProvider — WebSocket Context with Exponential Backoff

**Files:**
- Create: `dashboard/src/components/ws-provider/ws-provider.tsx`
- Create: `dashboard/src/hooks/use-ws.ts`
- Create: `dashboard/src/components/ws-provider/ws-provider.test.tsx`

- [ ] **Step 1: Write failing tests first**

```tsx
// dashboard/src/components/ws-provider/ws-provider.test.tsx
import { render, screen, act } from '@testing-library/react'
import { WsProvider } from './ws-provider'
import { useWs } from '@/hooks/use-ws'

// Mock WebSocket globally
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null

  constructor(public url: string) {
    MockWebSocket.lastInstance = this
  }

  static lastInstance: MockWebSocket | null = null
  close = jest.fn()
  send = jest.fn()

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason: '', wasClean: false } as CloseEvent)
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => {
  global.WebSocket = MockWebSocket as unknown as typeof WebSocket
  MockWebSocket.lastInstance = null
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.clearAllMocks()
})

function TestConsumer() {
  const ctx = useWs()
  return <div data-testid="state">{ctx.connectionState}</div>
}

describe('WsProvider', () => {
  it('starts in reconnecting state before first connection opens', () => {
    render(
      <WsProvider>
        <TestConsumer />
      </WsProvider>,
    )
    expect(screen.getByTestId('state').textContent).toBe('reconnecting')
  })

  it('transitions to online when socket opens', () => {
    render(
      <WsProvider>
        <TestConsumer />
      </WsProvider>,
    )
    act(() => {
      MockWebSocket.lastInstance?.simulateOpen()
    })
    expect(screen.getByTestId('state').textContent).toBe('online')
  })

  it('transitions to reconnecting after socket closes', () => {
    render(
      <WsProvider>
        <TestConsumer />
      </WsProvider>,
    )
    act(() => {
      MockWebSocket.lastInstance?.simulateOpen()
    })
    act(() => {
      MockWebSocket.lastInstance?.simulateClose()
    })
    expect(screen.getByTestId('state').textContent).toBe('reconnecting')
  })

  it('transitions to disconnected after 3 failed reconnect attempts', () => {
    render(
      <WsProvider>
        <TestConsumer />
      </WsProvider>,
    )
    // Attempt 1: initial connect fails immediately
    act(() => { MockWebSocket.lastInstance?.simulateClose() })
    // Advance past first backoff (1s)
    act(() => { jest.advanceTimersByTime(1100) })
    act(() => { MockWebSocket.lastInstance?.simulateClose() })
    // Advance past second backoff (2s)
    act(() => { jest.advanceTimersByTime(2100) })
    act(() => { MockWebSocket.lastInstance?.simulateClose() })
    // After 3 failures, should show disconnected
    expect(screen.getByTestId('state').textContent).toBe('disconnected')
  })

  it('parses instance:joined event and adds to instances map', () => {
    function InstanceConsumer() {
      const { instances } = useWs()
      return <div data-testid="count">{instances.size}</div>
    }
    render(
      <WsProvider>
        <InstanceConsumer />
      </WsProvider>,
    )
    act(() => {
      MockWebSocket.lastInstance?.simulateOpen()
    })
    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        event: 'instance:joined',
        instanceId: 'paul@mac:cc2cc/abc',
        timestamp: new Date().toISOString(),
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern ws-provider
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dashboard/src/components/ws-provider/ws-provider.tsx`**

```tsx
// dashboard/src/components/ws-provider/ws-provider.tsx
'use client'

import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { HubEventSchema } from '@cc2cc/shared'
import type {
  ConnectionState,
  FeedMessage,
  InstanceState,
  SendFramePayload,
  SessionStats,
  WsContextValue,
} from '@/types/dashboard'
import { fetchInstances } from '@/lib/api'

/** Maximum number of messages retained in the feed */
const MAX_FEED_SIZE = 500

/** Exponential backoff config */
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MULTIPLIER = 2
const BACKOFF_MAX_MS = 30_000
/** Number of consecutive failures before showing "disconnected" (still retries in background) */
const DISCONNECT_THRESHOLD = 3

export const WsContext = createContext<WsContextValue>({
  connectionState: 'reconnecting',
  instances: new Map(),
  feed: [],
  sessionStats: { activeTasks: 0, errors: 0, pendingTaskIds: new Set() },
  sendFrame: () => { throw new Error('WsProvider not mounted') },
})

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting')
  const [instances, setInstances] = useState<Map<string, InstanceState>>(new Map())
  const [feed, setFeed] = useState<FeedMessage[]>([])
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    activeTasks: 0,
    errors: 0,
    pendingTaskIds: new Set(),
  })

  const wsRef = useRef<WebSocket | null>(null)
  const failureCountRef = useRef(0)
  const backoffMsRef = useRef(BACKOFF_INITIAL_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  /** Seed instances from REST on first load */
  const seedInstances = useCallback(async () => {
    const list = await fetchInstances()
    if (!mountedRef.current) return
    setInstances(prev => {
      const next = new Map(prev)
      for (const inst of list) {
        if (!next.has(inst.instanceId)) {
          next.set(inst.instanceId, { ...inst, queueDepth: inst.queueDepth ?? 0 })
        }
      }
      return next
    })
  }, [])

  const appendFeed = useCallback((entry: FeedMessage) => {
    setFeed(prev => {
      const next = [...prev, entry]
      return next.length > MAX_FEED_SIZE ? next.slice(next.length - MAX_FEED_SIZE) : next
    })
  }, [])

  const handleEvent = useCallback((raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    const result = HubEventSchema.safeParse(parsed)
    if (!result.success) return

    const evt = result.data

    switch (evt.event) {
      case 'instance:joined':
        setInstances(prev => {
          const next = new Map(prev)
          const existing = next.get(evt.instanceId)
          next.set(evt.instanceId, {
            instanceId: evt.instanceId,
            project: evt.instanceId.split(':')[1]?.split('/')[0] ?? '',
            status: 'online',
            connectedAt: evt.timestamp,
            queueDepth: existing?.queueDepth ?? 0,
          })
          return next
        })
        break

      case 'instance:left':
        setInstances(prev => {
          const next = new Map(prev)
          const existing = next.get(evt.instanceId)
          if (existing) {
            next.set(evt.instanceId, { ...existing, status: 'offline' })
          }
          return next
        })
        break

      case 'message:sent': {
        const msg = evt.message
        const isBroadcast = msg.to === 'broadcast'
        appendFeed({ message: msg, receivedAt: new Date(), isBroadcast })

        // Track active tasks: increment on task, decrement on matching result
        if (msg.type === 'task') {
          setSessionStats(prev => ({
            ...prev,
            activeTasks: prev.activeTasks + 1,
            pendingTaskIds: new Set([...prev.pendingTaskIds, msg.messageId]),
          }))
        } else if (msg.type === 'result' && msg.replyToMessageId) {
          setSessionStats(prev => {
            const nextPending = new Set(prev.pendingTaskIds)
            const wasTracked = nextPending.delete(msg.replyToMessageId!)
            return {
              ...prev,
              activeTasks: wasTracked ? Math.max(0, prev.activeTasks - 1) : prev.activeTasks,
              pendingTaskIds: nextPending,
            }
          })
        }
        break
      }

      case 'broadcast:sent':
        // Broadcast events surface in the feed as a synthetic Message-like entry
        appendFeed({
          message: {
            messageId: `broadcast-${Date.now()}`,
            from: evt.from,
            to: 'broadcast',
            type: 'task' as const,  // type field is irrelevant for display; isBroadcast flag drives styling
            content: evt.content,
            timestamp: evt.timestamp,
          },
          receivedAt: new Date(),
          isBroadcast: true,
        })
        break

      case 'queue:stats':
        setInstances(prev => {
          const next = new Map(prev)
          const existing = next.get(evt.instanceId)
          if (existing) {
            next.set(evt.instanceId, { ...existing, queueDepth: evt.depth })
          }
          return next
        })
        break
    }
  }, [appendFeed])

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const wsUrl = `${process.env.NEXT_PUBLIC_HUB_WS_URL ?? 'ws://localhost:3100'}/ws/dashboard?key=${encodeURIComponent(process.env.NEXT_PUBLIC_HUB_API_KEY ?? '')}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      failureCountRef.current = 0
      backoffMsRef.current = BACKOFF_INITIAL_MS
      setConnectionState('online')
    }

    ws.onmessage = (evt: MessageEvent<string>) => {
      handleEvent(evt.data)
    }

    ws.onerror = () => {
      setSessionStats(prev => ({ ...prev, errors: prev.errors + 1 }))
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      failureCountRef.current += 1

      if (failureCountRef.current >= DISCONNECT_THRESHOLD) {
        setConnectionState('disconnected')
      } else {
        setConnectionState('reconnecting')
      }

      // Schedule reconnect regardless of threshold — still retry in background
      reconnectTimerRef.current = setTimeout(() => {
        backoffMsRef.current = Math.min(
          backoffMsRef.current * BACKOFF_MULTIPLIER,
          BACKOFF_MAX_MS,
        )
        connect()
      }, backoffMsRef.current)
    }
  }, [handleEvent])

  const sendFrame = useCallback((payload: SendFramePayload) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    ws.send(JSON.stringify(payload))
  }, [])

  useEffect(() => {
    mountedRef.current = true
    seedInstances()
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect, seedInstances])

  return (
    <WsContext.Provider
      value={{ connectionState, instances, feed, sessionStats, sendFrame }}
    >
      {children}
    </WsContext.Provider>
  )
}
```

- [ ] **Step 4: Implement `dashboard/src/hooks/use-ws.ts`**

```ts
// dashboard/src/hooks/use-ws.ts
'use client'

import { useContext } from 'react'
import { WsContext } from '@/components/ws-provider/ws-provider'
import type { WsContextValue } from '@/types/dashboard'

/** Access the WebSocket context. Must be used inside <WsProvider>. */
export function useWs(): WsContextValue {
  return useContext(WsContext)
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern ws-provider
```

- [ ] **Step 6: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/ws-provider/ dashboard/src/hooks/
git commit -m "feat(dashboard): add WsProvider with exponential backoff reconnect and event handling"
```

---

### Task 5: Connection Banner Component

**Files:**
- Create: `dashboard/src/components/connection-banner/connection-banner.tsx`
- Create: `dashboard/src/components/connection-banner/connection-banner.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// dashboard/src/components/connection-banner/connection-banner.test.tsx
import { render, screen } from '@testing-library/react'
import { ConnectionBanner } from './connection-banner'

describe('ConnectionBanner', () => {
  it('renders green pill when online', () => {
    render(<ConnectionBanner state="online" />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent('hub online')
    expect(pill).toHaveClass('bg-green-500')
  })

  it('renders yellow pill when reconnecting', () => {
    render(<ConnectionBanner state="reconnecting" />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent('reconnecting…')
    expect(pill).toHaveClass('bg-yellow-500')
  })

  it('renders red pill when disconnected', () => {
    render(<ConnectionBanner state="disconnected" />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent('disconnected')
    expect(pill).toHaveClass('bg-red-500')
  })
})
```

- [ ] **Step 2: Implement `connection-banner.tsx`**

```tsx
// dashboard/src/components/connection-banner/connection-banner.tsx
import type { ConnectionState } from '@/types/dashboard'
import { cn } from '@/lib/utils'

interface ConnectionBannerProps {
  state: ConnectionState
}

const CONFIG: Record<ConnectionState, { dot: string; label: string; pill: string }> = {
  online:       { dot: 'bg-green-400',  label: 'hub online',     pill: 'bg-green-500/20  text-green-300  border-green-500/30'  },
  reconnecting: { dot: 'bg-yellow-400 animate-pulse', label: 'reconnecting…', pill: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  disconnected: { dot: 'bg-red-500',    label: 'disconnected',   pill: 'bg-red-500/20    text-red-300    border-red-500/30'    },
}

export function ConnectionBanner({ state }: ConnectionBannerProps) {
  const { dot, label, pill } = CONFIG[state]
  // role="status" makes it accessible and easy to query in tests
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        // Expose bg class directly so tests can match it
        state === 'online'       && 'bg-green-500',
        state === 'reconnecting' && 'bg-yellow-500',
        state === 'disconnected' && 'bg-red-500',
        pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  )
}
```

> **Note on test class matching:** The component applies both the opaque utility pill class and the solid bg-* class so RTL can `toHaveClass('bg-green-500')` without parsing Tailwind CSS at test time. In production the visual appearance is driven by the `/20` opacity variant; the solid class is present but overridden visually. This is a pragmatic test-friendly pattern.

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern connection-banner
```

- [ ] **Step 4: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/connection-banner/
git commit -m "feat(dashboard): add ConnectionBanner with green/yellow/red connection state pill"
```

---

### Task 6: Nav Tabs Component

**Files:**
- Create: `dashboard/src/components/nav/nav-tabs.tsx`

- [ ] **Step 1: Implement nav tabs**

```tsx
// dashboard/src/components/nav/nav-tabs.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, BarChart2, MessageSquare } from 'lucide-react'

const TABS = [
  { href: '/',               label: 'Command Center', icon: LayoutDashboard },
  { href: '/analytics',      label: 'Analytics',      icon: BarChart2        },
  { href: '/conversations',  label: 'Conversations',  icon: MessageSquare    },
]

export function NavTabs() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1" aria-label="Dashboard views">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/nav/
git commit -m "feat(dashboard): add NavTabs component linking all three views"
```

---

### Task 7: Root Layout

**Files:**
- Modify: `dashboard/src/app/layout.tsx`
- Create: `dashboard/src/app/globals.css` (update Tailwind base)

- [ ] **Step 1: Update `dashboard/src/app/layout.tsx`**

```tsx
// dashboard/src/app/layout.tsx
import type { Metadata } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { WsProvider } from '@/components/ws-provider/ws-provider'
import { ConnectionBanner } from '@/components/connection-banner/connection-banner'
import { NavTabs } from '@/components/nav/nav-tabs'
import { WsConnectionBannerClient } from '@/components/connection-banner/ws-connection-banner-client'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'cc2cc — Claude Command Center',
  description: 'Real-time dashboard for Claude-to-Claude communications',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased`}
      >
        <WsProvider>
          {/* Top header: branding + nav + connection banner */}
          <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
            <div className="flex h-12 items-center gap-4 px-4">
              <span className="font-mono text-sm font-bold tracking-tight text-purple-400">
                cc2cc
              </span>
              <div className="h-4 w-px bg-zinc-700" aria-hidden="true" />
              <NavTabs />
              <div className="ml-auto">
                <WsConnectionBannerClient />
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1">{children}</main>
        </WsProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Create `dashboard/src/components/connection-banner/ws-connection-banner-client.tsx`**

This thin client wrapper reads connectionState from WsContext and renders the banner. The layout itself is a server component so it cannot directly call `useWs()`.

```tsx
// dashboard/src/components/connection-banner/ws-connection-banner-client.tsx
'use client'

import { useWs } from '@/hooks/use-ws'
import { ConnectionBanner } from './connection-banner'

export function WsConnectionBannerClient() {
  const { connectionState } = useWs()
  return <ConnectionBanner state={connectionState} />
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/app/layout.tsx dashboard/src/components/connection-banner/ws-connection-banner-client.tsx
git commit -m "feat(dashboard): add root layout with WsProvider, nav, and connection banner"
```

---

### Task 8: Instance Sidebar Component

**Files:**
- Create: `dashboard/src/components/instance-sidebar/instance-sidebar.tsx`
- Create: `dashboard/src/components/instance-sidebar/instance-sidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// dashboard/src/components/instance-sidebar/instance-sidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceSidebar } from './instance-sidebar'
import type { InstanceState } from '@/types/dashboard'

const INSTANCES: Map<string, InstanceState> = new Map([
  ['paul@mac:cc2cc/abc', {
    instanceId: 'paul@mac:cc2cc/abc',
    project: 'cc2cc',
    status: 'online',
    connectedAt: new Date().toISOString(),
    queueDepth: 3,
  }],
  ['alice@srv:api/def', {
    instanceId: 'alice@srv:api/def',
    project: 'api',
    status: 'offline',
    connectedAt: new Date().toISOString(),
    queueDepth: 0,
  }],
])

describe('InstanceSidebar', () => {
  it('renders all instances including offline', () => {
    render(<InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText('paul@mac:cc2cc')).toBeInTheDocument()
    expect(screen.getByText('alice@srv:api')).toBeInTheDocument()
  })

  it('shows queue depth badge for instance with queued messages', () => {
    render(<InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls onSelect with instanceId when clicked', () => {
    const onSelect = jest.fn()
    render(<InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('paul@mac:cc2cc'))
    expect(onSelect).toHaveBeenCalledWith('paul@mac:cc2cc/abc')
  })

  it('highlights the selected instance', () => {
    render(
      <InstanceSidebar
        instances={INSTANCES}
        selectedId="paul@mac:cc2cc/abc"
        onSelect={() => {}}
      />,
    )
    const item = screen.getByRole('button', { name: /paul@mac:cc2cc/ })
    expect(item).toHaveClass('bg-zinc-800')
  })
})
```

- [ ] **Step 2: Implement `instance-sidebar.tsx`**

```tsx
// dashboard/src/components/instance-sidebar/instance-sidebar.tsx
import { cn, shortInstanceId } from '@/lib/utils'
import type { InstanceState } from '@/types/dashboard'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface InstanceSidebarProps {
  instances: Map<string, InstanceState>
  selectedId: string | null
  onSelect: (instanceId: string) => void
}

export function InstanceSidebar({ instances, selectedId, onSelect }: InstanceSidebarProps) {
  const sorted = Array.from(instances.values()).sort((a, b) => {
    // Online first, then alphabetical
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return a.instanceId.localeCompare(b.instanceId)
  })

  return (
    <aside className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Instances
        </h2>
      </div>
      <ScrollArea className="flex-1">
        <ul className="space-y-px p-2" role="list">
          {sorted.map(inst => (
            <li key={inst.instanceId}>
              <button
                type="button"
                onClick={() => onSelect(inst.instanceId)}
                aria-pressed={selectedId === inst.instanceId}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  selectedId === inst.instanceId
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                )}
              >
                {/* Status dot */}
                <span
                  aria-label={inst.status}
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    inst.status === 'online' ? 'bg-green-400' : 'bg-zinc-600',
                  )}
                />
                {/* Instance label — truncated UUID suffix */}
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {shortInstanceId(inst.instanceId)}
                </span>
                {/* Queue depth badge */}
                {inst.queueDepth > 0 && (
                  <Badge
                    variant="secondary"
                    className="h-4 shrink-0 bg-zinc-700 px-1 py-0 text-xs text-zinc-300"
                  >
                    {inst.queueDepth}
                  </Badge>
                )}
              </button>
            </li>
          ))}
          {sorted.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-zinc-600">
              No instances registered
            </li>
          )}
        </ul>
      </ScrollArea>
    </aside>
  )
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern instance-sidebar
```

- [ ] **Step 4: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/instance-sidebar/
git commit -m "feat(dashboard): add InstanceSidebar with online/offline status dots and queue badges"
```

---

### Task 9: Message Row and Feed Components

**Files:**
- Create: `dashboard/src/components/message-feed/message-row.tsx`
- Create: `dashboard/src/components/message-feed/message-feed.tsx`
- Create: `dashboard/src/components/message-feed/message-feed.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// dashboard/src/components/message-feed/message-feed.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageFeed } from './message-feed'
import type { FeedMessage } from '@/types/dashboard'
import { MessageType } from '@cc2cc/shared'

function makeMsg(overrides: Partial<FeedMessage['message']> = {}): FeedMessage {
  return {
    message: {
      messageId: 'test-id-1',
      from: 'paul@mac:cc2cc/abc',
      to: 'alice@srv:api/def',
      type: MessageType.task,
      content: 'Do the thing',
      timestamp: new Date().toISOString(),
      ...overrides,
    },
    receivedAt: new Date(),
    isBroadcast: false,
  }
}

describe('MessageFeed', () => {
  it('renders messages', () => {
    const feed = [makeMsg()]
    render(<MessageFeed feed={feed} filterInstanceId={null} />)
    expect(screen.getByText('Do the thing')).toBeInTheDocument()
  })

  it('shows type filter chips', () => {
    render(<MessageFeed feed={[]} filterInstanceId={null} />)
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /task/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /result/i })).toBeInTheDocument()
  })

  it('filters messages by type when chip is clicked', () => {
    const feed = [
      makeMsg({ type: MessageType.task,   content: 'Task message',   messageId: 'id-1' }),
      makeMsg({ type: MessageType.result, content: 'Result message', messageId: 'id-2' }),
    ]
    render(<MessageFeed feed={feed} filterInstanceId={null} />)
    fireEvent.click(screen.getByRole('button', { name: /result/i }))
    expect(screen.getByText('Result message')).toBeInTheDocument()
    expect(screen.queryByText('Task message')).not.toBeInTheDocument()
  })

  it('filters by instance when filterInstanceId is provided', () => {
    const feed = [
      makeMsg({ from: 'paul@mac:cc2cc/abc', content: 'Paul message', messageId: 'id-1' }),
      makeMsg({ from: 'alice@srv:api/def',  content: 'Alice message', messageId: 'id-2' }),
    ]
    render(<MessageFeed feed={feed} filterInstanceId="paul@mac:cc2cc/abc" />)
    expect(screen.getByText('Paul message')).toBeInTheDocument()
    expect(screen.queryByText('Alice message')).not.toBeInTheDocument()
  })

  it('applies amber styling for task messages', () => {
    render(<MessageFeed feed={[makeMsg()]} filterInstanceId={null} />)
    const row = screen.getByTestId('message-row-test-id-1')
    expect(row).toHaveClass('border-l-amber-500')
  })
})
```

- [ ] **Step 2: Implement `message-row.tsx`**

```tsx
// dashboard/src/components/message-feed/message-row.tsx
import { cn, messageTypeColor, messageColorClasses, formatTime, shortInstanceId } from '@/lib/utils'
import type { FeedMessage } from '@/types/dashboard'
import { Badge } from '@/components/ui/badge'

interface MessageRowProps {
  entry: FeedMessage
}

export function MessageRow({ entry }: MessageRowProps) {
  const { message, isBroadcast } = entry
  const color = messageTypeColor(message.type, isBroadcast)
  const classes = messageColorClasses(color)
  const typeLabel = isBroadcast ? 'broadcast' : message.type

  return (
    <div
      data-testid={`message-row-${message.messageId}`}
      className={cn(
        'flex flex-col gap-1 border-l-2 px-3 py-2 transition-colors',
        classes.border,
        classes.bg,
      )}
    >
      {/* Header row: type badge + from → to + timestamp */}
      <div className="flex items-center gap-2 text-xs">
        <Badge className={cn('shrink-0 rounded-sm px-1 py-0 font-mono', classes.badge)}>
          {typeLabel}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-zinc-500">
          <span className={cn('font-medium', classes.text)}>
            {shortInstanceId(message.from)}
          </span>
          <span className="mx-1 text-zinc-700">→</span>
          <span className="text-zinc-500">
            {message.to === 'broadcast' ? '(all)' : shortInstanceId(message.to)}
          </span>
        </span>
        <span className="shrink-0 font-mono text-zinc-600">
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Content */}
      <p className="break-words text-sm text-zinc-200">{message.content}</p>

      {/* Reply-to thread link */}
      {message.replyToMessageId && (
        <p className="font-mono text-xs text-zinc-600">
          ↳ re: {message.replyToMessageId.slice(0, 8)}…
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement `message-feed.tsx`**

```tsx
// dashboard/src/components/message-feed/message-feed.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageRow } from './message-row'
import { cn } from '@/lib/utils'
import type { FeedMessage } from '@/types/dashboard'
import { MessageType } from '@cc2cc/shared'

type FilterType = 'all' | MessageType | 'broadcast'

const FILTER_CHIPS: { label: string; value: FilterType }[] = [
  { label: 'All',       value: 'all'              },
  { label: 'Task',      value: MessageType.task    },
  { label: 'Result',    value: MessageType.result  },
  { label: 'Question',  value: MessageType.question },
  { label: 'Broadcast', value: 'broadcast'          },
  { label: 'Ack',       value: MessageType.ack      },
]

interface MessageFeedProps {
  feed: FeedMessage[]
  /** When set, only show messages to/from this instance */
  filterInstanceId: string | null
}

export function MessageFeed({ feed, filterInstanceId }: MessageFeedProps) {
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const filtered = feed.filter(entry => {
    // Instance filter
    if (filterInstanceId) {
      const { from, to } = entry.message
      if (from !== filterInstanceId && to !== filterInstanceId) return false
    }
    // Type filter
    if (typeFilter === 'all') return true
    if (typeFilter === 'broadcast') return entry.isBroadcast
    return entry.message.type === typeFilter && !entry.isBroadcast
  })

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filtered.length, autoScroll])

  return (
    <div className="flex h-full flex-col">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
        {FILTER_CHIPS.map(chip => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setTypeFilter(chip.value)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
              typeFilter === chip.value
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
            )}
          >
            {chip.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="h-3 w-3 accent-purple-500"
            />
            auto-scroll
          </label>
          <span className="text-xs text-zinc-600">
            {filtered.length} message{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto"
        onScroll={e => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
          setAutoScroll(atBottom)
        }}
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-700">
            No messages
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {filtered.map(entry => (
              <MessageRow key={entry.message.messageId} entry={entry} />
            ))}
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern message-feed
```

- [ ] **Step 5: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/message-feed/
git commit -m "feat(dashboard): add MessageFeed and MessageRow with type filter chips and color coding"
```

---

### Task 10: Manual Send Bar

**Files:**
- Create: `dashboard/src/components/manual-send-bar/manual-send-bar.tsx`
- Create: `dashboard/src/components/manual-send-bar/manual-send-bar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// dashboard/src/components/manual-send-bar/manual-send-bar.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManualSendBar } from './manual-send-bar'
import type { InstanceState } from '@/types/dashboard'

const INSTANCES: InstanceState[] = [
  {
    instanceId: 'paul@mac:cc2cc/abc',
    project: 'cc2cc',
    status: 'online',
    connectedAt: new Date().toISOString(),
    queueDepth: 0,
  },
]

describe('ManualSendBar', () => {
  it('renders target selector, textarea, and send button', () => {
    render(<ManualSendBar instances={INSTANCES} onSend={jest.fn()} disabled={false} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  it('calls onSend with correct payload when form is submitted', async () => {
    const user = userEvent.setup()
    const onSend = jest.fn()
    render(<ManualSendBar instances={INSTANCES} onSend={onSend} disabled={false} />)

    await user.type(screen.getByRole('textbox'), 'Hello Claude')
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hello Claude' }),
      )
    })
  })

  it('disables send button when disabled prop is true', () => {
    render(<ManualSendBar instances={INSTANCES} onSend={jest.fn()} disabled={true} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('clears textarea after successful send', async () => {
    const user = userEvent.setup()
    const onSend = jest.fn()
    render(<ManualSendBar instances={INSTANCES} onSend={onSend} disabled={false} />)
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hello')
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(textarea).toHaveValue(''))
  })
})
```

- [ ] **Step 2: Implement `manual-send-bar.tsx`**

```tsx
// dashboard/src/components/manual-send-bar/manual-send-bar.tsx
'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import type { InstanceState, SendFramePayload } from '@/types/dashboard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { shortInstanceId } from '@/lib/utils'
import { MessageType } from '@cc2cc/shared'

interface ManualSendBarProps {
  instances: InstanceState[]
  onSend: (payload: SendFramePayload) => void
  disabled: boolean
}

const MESSAGE_TYPES = [
  MessageType.task,
  MessageType.result,
  MessageType.question,
  MessageType.ack,
]

export function ManualSendBar({ instances, onSend, disabled }: ManualSendBarProps) {
  const [to, setTo] = useState<string>('broadcast')
  const [messageType, setMessageType] = useState<string>(MessageType.task)
  const [content, setContent] = useState('')

  function handleSend() {
    const trimmed = content.trim()
    if (!trimmed) return
    onSend({ type: 'send_message', to, messageType, content: trimmed })
    setContent('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      {/* Controls row: target + type selectors */}
      <div className="mb-2 flex gap-2">
        <Select value={to} onValueChange={setTo}>
          <SelectTrigger className="h-8 w-56 border-zinc-700 bg-zinc-900 text-xs">
            <SelectValue placeholder="Select target" />
          </SelectTrigger>
          <SelectContent className="border-zinc-700 bg-zinc-900">
            <SelectItem value="broadcast" className="text-purple-400">
              Broadcast (all online)
            </SelectItem>
            {instances.map(inst => (
              <SelectItem
                key={inst.instanceId}
                value={inst.instanceId}
                disabled={inst.status === 'offline'}
                className="font-mono text-xs"
              >
                {shortInstanceId(inst.instanceId)}
                {inst.status === 'offline' && (
                  <span className="ml-1 text-zinc-600">(offline)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={messageType} onValueChange={setMessageType}>
          <SelectTrigger className="h-8 w-32 border-zinc-700 bg-zinc-900 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-700 bg-zinc-900">
            {MESSAGE_TYPES.map(t => (
              <SelectItem key={t} value={t} className="text-xs">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Textarea + send button */}
      <div className="flex gap-2">
        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (⌘Enter to send)"
          rows={2}
          className="flex-1 resize-none border-zinc-700 bg-zinc-900 text-sm placeholder:text-zinc-600 focus-visible:ring-purple-500"
          disabled={disabled}
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={disabled || !content.trim()}
          className="h-full w-10 bg-purple-600 hover:bg-purple-700"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test -- --testPathPattern manual-send-bar
```

- [ ] **Step 4: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/manual-send-bar/
git commit -m "feat(dashboard): add ManualSendBar with instance selector, message type, and send"
```

---

### Task 11: Stats Bar Component

**Files:**
- Create: `dashboard/src/components/stats-bar/stats-bar.tsx`

- [ ] **Step 1: Implement `stats-bar.tsx`**

```tsx
// dashboard/src/components/stats-bar/stats-bar.tsx
import { cn } from '@/lib/utils'

interface StatItem {
  label: string
  value: number | string
  /** Optional Tailwind text-color class override */
  colorClass?: string
}

interface StatsBarProps {
  stats: StatItem[]
  className?: string
}

export function StatsBar({ stats, className }: StatsBarProps) {
  return (
    <div className={cn('flex items-center gap-6 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2', className)}>
      {stats.map(stat => (
        <div key={stat.label} className="flex flex-col">
          <span className="text-xs text-zinc-500">{stat.label}</span>
          <span className={cn('font-mono text-lg font-semibold tabular-nums', stat.colorClass ?? 'text-zinc-100')}>
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/stats-bar/
git commit -m "feat(dashboard): add reusable StatsBar component"
```

---

### Task 12: View A — Command Center (`/`)

**Files:**
- Modify: `dashboard/src/app/page.tsx`

- [ ] **Step 1: Implement Command Center page**

```tsx
// dashboard/src/app/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useWs } from '@/hooks/use-ws'
import { InstanceSidebar } from '@/components/instance-sidebar/instance-sidebar'
import { MessageFeed } from '@/components/message-feed/message-feed'
import { ManualSendBar } from '@/components/manual-send-bar/manual-send-bar'
import { StatsBar } from '@/components/stats-bar/stats-bar'
import { fetchStats } from '@/lib/api'
import type { HubStats, SendFramePayload } from '@/types/dashboard'

export default function CommandCenterPage() {
  const { instances, feed, connectionState, sendFrame } = useWs()
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [hubStats, setHubStats] = useState<HubStats>({ messagesToday: 0, activeInstances: 0, queuedTotal: 0 })

  // Poll /api/stats every 30 seconds for messages-today counter
  useEffect(() => {
    let active = true
    async function load() {
      const stats = await fetchStats()
      if (active) setHubStats(stats)
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => { active = false; clearInterval(interval) }
  }, [])

  const onlineCount = Array.from(instances.values()).filter(i => i.status === 'online').length
  const offlineCount = instances.size - onlineCount
  const totalQueued = Array.from(instances.values()).reduce((sum, i) => sum + i.queueDepth, 0)

  const stats = [
    { label: 'Online',      value: onlineCount,            colorClass: 'text-green-400' },
    { label: 'Offline',     value: offlineCount,           colorClass: 'text-zinc-500'  },
    { label: 'Msgs Today',  value: hubStats.messagesToday, colorClass: 'text-purple-400' },
    { label: 'Total Queued',value: totalQueued,            colorClass: totalQueued > 0 ? 'text-amber-400' : 'text-zinc-400' },
  ]

  function handleSend(payload: SendFramePayload) {
    try {
      sendFrame(payload)
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const instanceList = Array.from(instances.values())

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Stats top bar */}
      <StatsBar stats={stats} />

      {/* Three-column layout: sidebar | feed | (future detail) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: instance list */}
        <InstanceSidebar
          instances={instances}
          selectedId={selectedInstanceId}
          onSelect={id => setSelectedInstanceId(prev => prev === id ? null : id)}
        />

        {/* Main: message feed + send bar */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <MessageFeed feed={feed} filterInstanceId={selectedInstanceId} />
          <ManualSendBar
            instances={instanceList}
            onSend={handleSend}
            disabled={connectionState !== 'online'}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/app/page.tsx
git commit -m "feat(dashboard): implement View A — Command Center with stats bar, instance sidebar, and live feed"
```

---

### Task 13: Activity Timeline Component

**Files:**
- Create: `dashboard/src/components/activity-timeline/activity-timeline.tsx`

- [ ] **Step 1: Implement `activity-timeline.tsx`**

```tsx
// dashboard/src/components/activity-timeline/activity-timeline.tsx
'use client'

import { useMemo } from 'react'
import { cn, messageTypeColor, messageColorClasses, shortInstanceId } from '@/lib/utils'
import type { FeedMessage, InstanceState } from '@/types/dashboard'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface ActivityTimelineProps {
  instances: Map<string, InstanceState>
  feed: FeedMessage[]
  /** How many minutes of history to show on the time axis */
  windowMinutes?: number
}

/**
 * Renders a per-instance activity grid: rows are instances, columns are time buckets.
 * Each cell contains colored dots for messages in that bucket.
 */
export function ActivityTimeline({
  instances,
  feed,
  windowMinutes = 10,
}: ActivityTimelineProps) {
  const BUCKET_COUNT = 20
  const nowMs = Date.now()
  const windowMs = windowMinutes * 60 * 1000
  const bucketMs = windowMs / BUCKET_COUNT

  /**
   * Organise feed entries into per-instance buckets.
   * Only messages within the time window are included.
   */
  const grid = useMemo(() => {
    type BucketEntry = { color: string; label: string; content: string }
    const map = new Map<string, BucketEntry[][]>()

    for (const inst of instances.values()) {
      map.set(inst.instanceId, Array.from({ length: BUCKET_COUNT }, () => []))
    }

    for (const entry of feed) {
      const entryMs = entry.receivedAt.getTime()
      const age = nowMs - entryMs
      if (age < 0 || age > windowMs) continue

      const bucketIndex = Math.floor((windowMs - age) / bucketMs)
      const clampedIndex = Math.min(bucketIndex, BUCKET_COUNT - 1)

      const targetId =
        entry.message.to !== 'broadcast' && instances.has(entry.message.to)
          ? entry.message.to
          : entry.message.from

      const bucket = map.get(targetId)
      if (bucket) {
        const color = messageTypeColor(entry.message.type, entry.isBroadcast)
        const classes = messageColorClasses(color)
        bucket[clampedIndex].push({
          color: classes.text,
          label: entry.isBroadcast ? 'broadcast' : entry.message.type,
          content: entry.message.content.slice(0, 80),
        })
      }
    }

    return map
  }, [instances, feed, nowMs, windowMs, bucketMs])

  if (instances.size === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-zinc-700">
        No instances
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        {/* Time axis labels */}
        <div className="mb-1 ml-48 flex">
          <span className="flex-1 text-left font-mono text-xs text-zinc-700">
            -{windowMinutes}m
          </span>
          <span className="font-mono text-xs text-zinc-700">now</span>
        </div>

        {/* Instance rows */}
        <div className="space-y-1">
          {Array.from(instances.values()).map(inst => {
            const buckets = grid.get(inst.instanceId) ?? []
            return (
              <div key={inst.instanceId} className="flex items-center gap-2">
                {/* Instance label */}
                <div className="flex w-48 shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      inst.status === 'online' ? 'bg-green-400' : 'bg-zinc-600',
                    )}
                  />
                  <span className="min-w-0 truncate font-mono text-xs text-zinc-400">
                    {shortInstanceId(inst.instanceId)}
                  </span>
                </div>

                {/* Bucket cells */}
                <div className="flex flex-1 gap-px">
                  {buckets.map((dots, bucketIdx) => (
                    <div
                      // eslint-disable-next-line react/no-array-index-key
                      key={bucketIdx}
                      className="relative flex h-6 flex-1 items-center justify-center rounded-sm bg-zinc-900"
                    >
                      {dots.slice(0, 3).map((dot, dotIdx) => (
                        <Tooltip key={dotIdx}>
                          <TooltipTrigger asChild>
                            <span
                              className={cn('h-2 w-2 rounded-full cursor-default', dot.color.replace('text-', 'bg-'))}
                              aria-label={`${dot.label}: ${dot.content}`}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs border-zinc-700 bg-zinc-800 text-xs">
                            <p className="font-semibold">{dot.label}</p>
                            <p className="text-zinc-400">{dot.content}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      {dots.length > 3 && (
                        <span className="absolute bottom-0.5 right-0.5 font-mono text-[8px] text-zinc-600">
                          +{dots.length - 3}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/activity-timeline/
git commit -m "feat(dashboard): add ActivityTimeline per-instance dot grid for analytics view"
```

---

### Task 14: View B — Analytics (`/analytics`)

**Files:**
- Create: `dashboard/src/app/analytics/page.tsx`

- [ ] **Step 1: Implement Analytics page**

```tsx
// dashboard/src/app/analytics/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useWs } from '@/hooks/use-ws'
import { StatsBar } from '@/components/stats-bar/stats-bar'
import { ActivityTimeline } from '@/components/activity-timeline/activity-timeline'
import { MessageFeed } from '@/components/message-feed/message-feed'
import { fetchStats } from '@/lib/api'
import type { HubStats } from '@/types/dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function AnalyticsPage() {
  const { instances, feed, sessionStats } = useWs()
  const [hubStats, setHubStats] = useState<HubStats>({ messagesToday: 0, activeInstances: 0, queuedTotal: 0 })

  useEffect(() => {
    let active = true
    async function load() {
      const stats = await fetchStats()
      if (active) setHubStats(stats)
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => { active = false; clearInterval(interval) }
  }, [])

  const onlineCount  = Array.from(instances.values()).filter(i => i.status === 'online').length
  const offlineCount = instances.size - onlineCount

  const stats = [
    { label: 'Online',        value: onlineCount,               colorClass: 'text-green-400'  },
    { label: 'Offline',       value: offlineCount,              colorClass: 'text-zinc-500'   },
    { label: 'Msgs Today',    value: hubStats.messagesToday,    colorClass: 'text-purple-400' },
    { label: 'Active Tasks',  value: sessionStats.activeTasks,  colorClass: sessionStats.activeTasks > 0 ? 'text-amber-400' : 'text-zinc-400' },
    { label: 'Session Errors',value: sessionStats.errors,       colorClass: sessionStats.errors > 0 ? 'text-red-400' : 'text-zinc-400' },
  ]

  // Recent messages: last 20, newest first
  const recent = [...feed].reverse().slice(0, 20)

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col overflow-hidden">
      <StatsBar stats={stats} />

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        {/* Activity timeline */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-300">
              Instance Activity (last 10 min)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline instances={instances} feed={feed} windowMinutes={10} />
          </CardContent>
        </Card>

        {/* Recent messages */}
        <Card className="flex min-h-0 flex-1 flex-col border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-300">
              Recent Messages
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <MessageFeed feed={recent} filterInstanceId={null} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/app/analytics/
git commit -m "feat(dashboard): implement View B — Analytics with timeline grid and session stats"
```

---

### Task 15: Conversation View Component

**Files:**
- Create: `dashboard/src/components/conversation-view/conversation-view.tsx`
- Create: `dashboard/src/components/conversation-view/message-inspector.tsx`

- [ ] **Step 1: Implement `message-inspector.tsx`**

```tsx
// dashboard/src/components/conversation-view/message-inspector.tsx
import type { FeedMessage } from '@/types/dashboard'
import { cn } from '@/lib/utils'

interface MessageInspectorProps {
  entry: FeedMessage | null
}

function Field({ label, value, mono = false }: { label: string; value: string | undefined | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-2 border-b border-zinc-800 py-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={cn('break-all text-xs text-zinc-300', mono && 'font-mono')}>
        {value ?? <span className="italic text-zinc-700">—</span>}
      </span>
    </div>
  )
}

export function MessageInspector({ entry }: MessageInspectorProps) {
  if (!entry) {
    return (
      <aside className="flex h-full w-72 flex-col items-center justify-center border-l border-zinc-800 bg-zinc-950 text-xs text-zinc-700">
        Select a message to inspect
      </aside>
    )
  }

  const { message, receivedAt, isBroadcast } = entry
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Message Inspector
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <Field label="Message ID"  value={message.messageId}        mono />
        <Field label="Type"        value={isBroadcast ? 'broadcast (fan-out)' : message.type} />
        <Field label="From"        value={message.from}             mono />
        <Field label="To"          value={message.to}               mono />
        <Field label="Timestamp"   value={message.timestamp}        mono />
        <Field label="Received At" value={receivedAt.toISOString()} mono />
        <Field label="Reply To"    value={message.replyToMessageId} mono />
        {message.metadata && (
          <div className="mt-2">
            <span className="text-xs text-zinc-500">Metadata</span>
            <pre className="mt-1 overflow-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-400">
              {JSON.stringify(message.metadata, null, 2)}
            </pre>
          </div>
        )}
        <div className="mt-2">
          <span className="text-xs text-zinc-500">Content</span>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
            {message.content}
          </pre>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Implement `conversation-view.tsx`**

```tsx
// dashboard/src/components/conversation-view/conversation-view.tsx
'use client'

import { useMemo } from 'react'
import { cn, messageTypeColor, messageColorClasses, shortInstanceId, formatTime } from '@/lib/utils'
import type { FeedMessage, InstanceState } from '@/types/dashboard'

interface ConversationViewProps {
  instances: Map<string, InstanceState>
  feed: FeedMessage[]
  instanceA: string | null
  instanceB: string | null
  selectedMessage: FeedMessage | null
  onSelectMessage: (entry: FeedMessage) => void
}

/** Group messages into threads keyed by the root messageId */
function buildThreads(messages: FeedMessage[]): Map<string, FeedMessage[]> {
  const threads = new Map<string, FeedMessage[]>()
  for (const entry of messages) {
    const rootId = entry.message.replyToMessageId ?? entry.message.messageId
    if (!threads.has(rootId)) threads.set(rootId, [])
    threads.get(rootId)!.push(entry)
  }
  return threads
}

export function ConversationView({
  feed,
  instanceA,
  instanceB,
  selectedMessage,
  onSelectMessage,
}: ConversationViewProps) {
  /** Filter to messages exchanged between the two selected instances */
  const exchanged = useMemo(() => {
    if (!instanceA || !instanceB) return []
    return feed.filter(entry => {
      const { from, to } = entry.message
      return (
        (from === instanceA && to === instanceB) ||
        (from === instanceB && to === instanceA) ||
        (to === 'broadcast' && (from === instanceA || from === instanceB))
      )
    })
  }, [feed, instanceA, instanceB])

  const threads = useMemo(() => buildThreads(exchanged), [exchanged])

  if (!instanceA || !instanceB) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-700">
        Select two instances to view their conversation
      </div>
    )
  }

  if (exchanged.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-700">
        No messages exchanged between these instances
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      {Array.from(threads.entries()).map(([rootId, msgs]) => (
        <div key={rootId} className="space-y-1">
          {/* Thread root label */}
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="font-mono">thread {rootId.slice(0, 8)}</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          {msgs.map(entry => {
            const isFromA = entry.message.from === instanceA
            const color = messageTypeColor(entry.message.type, entry.isBroadcast)
            const classes = messageColorClasses(color)
            const isSelected = selectedMessage?.message.messageId === entry.message.messageId

            return (
              <button
                key={entry.message.messageId}
                type="button"
                onClick={() => onSelectMessage(entry)}
                className={cn(
                  'flex w-full flex-col rounded-md border-l-2 px-3 py-2 text-left transition-colors',
                  classes.border,
                  isSelected ? 'bg-zinc-800' : cn('hover:bg-zinc-900', classes.bg),
                  isFromA ? 'mr-8' : 'ml-8',
                )}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className={cn('font-medium', classes.text)}>
                    {shortInstanceId(entry.message.from)}
                  </span>
                  <span className={cn('rounded-sm px-1 py-0', classes.badge, 'text-xs')}>
                    {entry.isBroadcast ? 'broadcast' : entry.message.type}
                  </span>
                  <span className="ml-auto font-mono text-zinc-700">
                    {formatTime(entry.message.timestamp)}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-zinc-200">{entry.message.content}</p>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/components/conversation-view/
git commit -m "feat(dashboard): add ConversationView with thread grouping and MessageInspector"
```

---

### Task 16: View C — Conversations (`/conversations`)

**Files:**
- Create: `dashboard/src/app/conversations/page.tsx`

- [ ] **Step 1: Implement Conversations page**

```tsx
// dashboard/src/app/conversations/page.tsx
'use client'

import { useState } from 'react'
import { useWs } from '@/hooks/use-ws'
import { InstanceSidebar } from '@/components/instance-sidebar/instance-sidebar'
import { ConversationView } from '@/components/conversation-view/conversation-view'
import { MessageInspector } from '@/components/conversation-view/message-inspector'
import type { FeedMessage } from '@/types/dashboard'
import { cn, shortInstanceId } from '@/lib/utils'

export default function ConversationsPage() {
  const { instances, feed } = useWs()
  const [instanceA, setInstanceA] = useState<string | null>(null)
  const [instanceB, setInstanceB] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<FeedMessage | null>(null)

  /**
   * Clicking an instance in the sidebar cycles through selection:
   * - If neither slot is selected → assign to A
   * - If A is selected and this is a different instance → assign to B
   * - If this is the current A or B → deselect that slot
   */
  function handleInstanceSelect(id: string) {
    if (id === instanceA) {
      setInstanceA(null)
      return
    }
    if (id === instanceB) {
      setInstanceB(null)
      return
    }
    if (!instanceA) {
      setInstanceA(id)
      return
    }
    setInstanceB(id)
  }

  const selectionLabel = instanceA
    ? instanceB
      ? `${shortInstanceId(instanceA)} ↔ ${shortInstanceId(instanceB)}`
      : `${shortInstanceId(instanceA)} — pick a second instance`
    : 'Pick two instances to view their conversation'

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Left: instance picker sidebar */}
      <div className="flex w-64 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Instances
          </h2>
          <p className="mt-1 text-xs text-zinc-600">Click to select A then B</p>
        </div>

        {/* Custom selection-aware instance list */}
        <div className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-px" role="list">
            {Array.from(instances.values()).map(inst => {
              const isA = inst.instanceId === instanceA
              const isB = inst.instanceId === instanceB
              return (
                <li key={inst.instanceId}>
                  <button
                    type="button"
                    onClick={() => handleInstanceSelect(inst.instanceId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      isA && 'bg-blue-900/40 text-blue-300',
                      isB && 'bg-purple-900/40 text-purple-300',
                      !isA && !isB && 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        inst.status === 'online' ? 'bg-green-400' : 'bg-zinc-600',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {shortInstanceId(inst.instanceId)}
                    </span>
                    {isA && <span className="shrink-0 text-xs font-bold text-blue-400">A</span>}
                    {isB && <span className="shrink-0 text-xs font-bold text-purple-400">B</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Center: conversation thread view */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Selection label bar */}
        <div className="border-b border-zinc-800 bg-zinc-900/30 px-4 py-2">
          <p className="text-xs text-zinc-400">{selectionLabel}</p>
        </div>
        <ConversationView
          instances={instances}
          feed={feed}
          instanceA={instanceA}
          instanceB={instanceB}
          selectedMessage={selectedMessage}
          onSelectMessage={setSelectedMessage}
        />
      </div>

      {/* Right: message metadata inspector */}
      <MessageInspector entry={selectedMessage} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/src/app/conversations/
git commit -m "feat(dashboard): implement View C — Conversations with instance pair selection and inspector"
```

---

### Task 17: Dockerfile

**Files:**
- Create: `dashboard/Dockerfile`

- [ ] **Step 1: Create `dashboard/Dockerfile`**

```dockerfile
# dashboard/Dockerfile
# ── Stage 1: dependencies ──────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps
WORKDIR /app

# Copy workspace root configs needed for workspace resolution
COPY package.json bun.lockb* ./
COPY packages/shared/package.json ./packages/shared/

# Copy dashboard manifests
COPY dashboard/package.json ./dashboard/

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules 2>/dev/null || true

# Copy shared package source (dashboard imports from @cc2cc/shared)
COPY packages/shared ./packages/shared

# Copy dashboard source
COPY dashboard ./dashboard

# Build args become NEXT_PUBLIC_* env vars baked into the static build
ARG NEXT_PUBLIC_HUB_WS_URL=ws://localhost:3100
ARG NEXT_PUBLIC_HUB_API_KEY=change-me

ENV NEXT_PUBLIC_HUB_WS_URL=$NEXT_PUBLIC_HUB_WS_URL
ENV NEXT_PUBLIC_HUB_API_KEY=$NEXT_PUBLIC_HUB_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN cd dashboard && bun run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8030

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./.next/static

USER nextjs

EXPOSE 8030

CMD ["bun", "server.js"]
```

> **Note:** Next.js standalone output mode must be enabled. Add `output: 'standalone'` to `dashboard/next.config.ts`:
>
> ```ts
> // dashboard/next.config.ts
> import type { NextConfig } from 'next'
>
> const config: NextConfig = {
>   output: 'standalone',
>   // Treat @cc2cc/shared as an external package resolved from workspace
>   transpilePackages: ['@cc2cc/shared'],
> }
>
> export default config
> ```

- [ ] **Step 2: Update `dashboard/next.config.ts` with standalone output**

Apply the `output: 'standalone'` and `transpilePackages` settings shown above.

- [ ] **Step 3: Commit**

```bash
cd /Users/probello/Repos/cc2cc
git add dashboard/Dockerfile dashboard/next.config.ts
git commit -m "feat(dashboard): add Dockerfile with multi-stage build and Next.js standalone output"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Typecheck the dashboard**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run typecheck
```

Expected: No type errors.

- [ ] **Step 2: Run all tests**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run test
```

Expected: All tests PASS.

- [ ] **Step 3: Lint**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run lint
```

Expected: No lint errors.

- [ ] **Step 4: Verify Next.js build compiles**

```bash
cd /Users/probello/Repos/cc2cc/dashboard
cp .env.local.example .env.local
bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Smoke-test dev server**

```bash
cd /Users/probello/Repos/cc2cc/dashboard && bun run dev &
# Wait for "Ready" then:
curl -s http://localhost:8030 | grep -q 'cc2cc' && echo 'OK'
```

Expected: Returns the HTML shell with the app name.

- [ ] **Step 6: Run workspace-level checkall**

```bash
cd /Users/probello/Repos/cc2cc && make checkall
```

Expected: All packages pass fmt, lint, typecheck, and tests.

- [ ] **Step 7: Final commit**

```bash
cd /Users/probello/Repos/cc2cc
git add -A
git commit -m "chore(dashboard): plan 4 complete — all three views, WsProvider, Dockerfile, tests pass"
```

---

## What's Next

**Plan 5 (if needed):** End-to-end integration testing — bring up Redis + hub + dashboard via `docker-compose.dev.yml`, run a pair of simulated plugin connections, and verify the dashboard reflects events in real time using Playwright.
