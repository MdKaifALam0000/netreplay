# ==============================================================================
# NetReplay React Dashboard — Multi-Stage Production Dockerfile
# ==============================================================================

# Stage 1: Build React SPA
FROM node:22-alpine AS builder

WORKDIR /app/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web ./

ARG VITE_API_BASE_URL=http://127.0.0.1:3100
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Minimal Nginx Web Server
# ------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Remove default nginx static assets and config
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy custom Nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=3s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:5173/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
