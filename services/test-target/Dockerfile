# Syntax: docker/dockerfile:1
# Test target service container definition
FROM node:22-alpine

# Set non-root working environment
WORKDIR /app

# Ensure production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy service dependencies and source code
COPY package.json ./
COPY server.js ./

# Switch to standard unprivileged node user
USER node

# Expose internal listening port
EXPOSE 3000

# Container healthcheck using built-in node fetch
HEALTHCHECK --interval=5s --timeout=3s --retries=3 --start-period=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the test target server
CMD ["node", "server.js"]
