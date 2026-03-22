FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace root manifest so Bun workspace resolution works
COPY package.json bun.lockb* ./
COPY packages/shared/package.json ./packages/shared/
COPY hub/package.json ./hub/

# Install all deps in CI mode (no dev deps for production)
RUN bun install --frozen-lockfile --production

# Copy source
COPY packages/shared/src ./packages/shared/src
COPY hub/src ./hub/src

EXPOSE 3100

CMD ["bun", "hub/src/index.ts"]
