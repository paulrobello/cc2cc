# dashboard/Dockerfile
#
# SECURITY — BFF PROXY PATTERN
# ─────────────────────────────────────────────────────────────────────────────
# The hub API key is NO LONGER baked into the static JavaScript bundle.
# Instead, the dashboard proxies all hub REST calls through Next.js API routes
# (src/app/api/hub/) that inject the key server-side. WebSocket credentials are
# fetched at runtime via GET /api/hub/ws-config (also server-side).
#
# Required runtime environment variable (set in docker-compose or at run time):
#   CC2CC_HUB_API_KEY    — hub API key (server-side only, never sent to browser)
#
# Optional runtime environment variable:
#   CC2CC_HUB_WS_URL     — hub WebSocket base URL (default: ws://localhost:3100)
#
# The build-time arg NEXT_PUBLIC_CC2CC_HUB_WS_URL is still accepted so the
# Content-Security-Policy header in next.config.ts can include the hub origin.
# It does NOT contain the API key.
# ─────────────────────────────────────────────────────────────────────────────
#
# ── Stage 1: dependencies ──────────────────────────────────────────────────────
FROM oven/bun:1.1.38-alpine AS deps
WORKDIR /app

# Copy workspace root configs needed for workspace resolution
COPY package.json bun.lockb* ./
COPY packages/shared/package.json ./packages/shared/

# Copy dashboard manifests
COPY dashboard/package.json ./dashboard/

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM oven/bun:1.1.38-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules 2>/dev/null || true

# Copy shared package source (dashboard imports from @cc2cc/shared)
COPY packages/shared ./packages/shared

# Copy dashboard source
COPY dashboard ./dashboard

# NEXT_PUBLIC_CC2CC_HUB_WS_URL is still baked in at build time so the
# Content-Security-Policy connect-src directive in next.config.ts can include
# the hub WebSocket origin. It does NOT contain any credentials.
# The API key is injected at container runtime via CC2CC_HUB_API_KEY.
ARG NEXT_PUBLIC_CC2CC_HUB_WS_URL=ws://localhost:3100

ENV NEXT_PUBLIC_CC2CC_HUB_WS_URL=$NEXT_PUBLIC_CC2CC_HUB_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN cd dashboard && bun run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM oven/bun:1.1.38-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8029
# CC2CC_HUB_API_KEY must be supplied at container run time (not baked in).
# CC2CC_HUB_WS_URL defaults to ws://localhost:3100 if not supplied.
ENV CC2CC_HUB_API_KEY=""
ENV CC2CC_HUB_WS_URL=""

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./.next/static

USER nextjs

EXPOSE 8029

CMD ["bun", "server.js"]
