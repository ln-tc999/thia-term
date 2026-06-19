# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/x402-compliance/package.json ./packages/x402-compliance/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Build all packages
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=deps /app/packages/x402-compliance/node_modules ./packages/x402-compliance/node_modules
COPY --from=deps /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY packages/sdk ./packages/sdk
COPY packages/x402-compliance ./packages/x402-compliance
COPY packages/mcp-server ./packages/mcp-server
COPY apps/api ./apps/api

RUN pnpm build --filter=@prooflink/api...

# Stage 3: Production dependencies only
FROM node:22-alpine AS prod-deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/x402-compliance/package.json ./packages/x402-compliance/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --ignore-scripts --prod

# Stage 4: Production image
FROM node:22-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S prooflink && \
    adduser -S prooflink -u 1001 -G prooflink

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy production node_modules
COPY --from=prod-deps --chown=prooflink:prooflink /app/node_modules ./node_modules
COPY --from=prod-deps --chown=prooflink:prooflink /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=prooflink:prooflink /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps --chown=prooflink:prooflink /app/apps/api/node_modules ./apps/api/node_modules

# Copy build artifacts
COPY --from=builder --chown=prooflink:prooflink /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=prooflink:prooflink /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=prooflink:prooflink /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=prooflink:prooflink /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=prooflink:prooflink /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder --chown=prooflink:prooflink /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder --chown=prooflink:prooflink /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=prooflink:prooflink /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=prooflink:prooflink /app/package.json ./

USER prooflink

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]
