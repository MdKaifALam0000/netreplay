# ==============================================================================
# NetReplay Fastify API — Multi-Stage Production Dockerfile
# ==============================================================================

# Stage 1: Build & Compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies for API workspace
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
WORKDIR /app/apps/api
RUN npm ci

# Copy shared packages and Prisma schema
WORKDIR /app
COPY packages/toxiproxy ./packages/toxiproxy
COPY apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
RUN npx prisma generate

# Copy source code and build
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=3100
ENV API_HOST=0.0.0.0
ENV DATABASE_URL="file:/app/apps/api/data/netreplay.db"

# Install production-only dependencies
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
WORKDIR /app/apps/api
RUN npm ci --omit=dev

# Copy Prisma schema, migrations, and generated client from builder
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/api/node_modules/@prisma ./node_modules/@prisma

# Copy packages and compiled output
WORKDIR /app
COPY packages/toxiproxy ./packages/toxiproxy
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Create persistent database directory and grant ownership to non-root node user
RUN mkdir -p /app/apps/api/data && \
    chown -R node:node /app

# Switch to unprivileged non-root user
USER node

WORKDIR /app/apps/api

EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
