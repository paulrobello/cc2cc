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
ARG NEXT_PUBLIC_CC2CC_HUB_WS_URL=ws://localhost:3100
ARG NEXT_PUBLIC_CC2CC_HUB_API_KEY=change-me

ENV NEXT_PUBLIC_CC2CC_HUB_WS_URL=$NEXT_PUBLIC_CC2CC_HUB_WS_URL
ENV NEXT_PUBLIC_CC2CC_HUB_API_KEY=$NEXT_PUBLIC_CC2CC_HUB_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN cd dashboard && bun run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8029

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./.next/static

USER nextjs

EXPOSE 8029

CMD ["bun", "server.js"]
