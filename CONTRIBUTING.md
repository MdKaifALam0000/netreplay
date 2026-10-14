# Contributing to NetReplay

Thank you for your interest in contributing to NetReplay! NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, replay, and automatically minimize distributed system network faults.

---

## Code of Conduct

Please be respectful, constructive, and collaborative in all issues, pull requests, and discussions.

---

## Development Prerequisites

Before contributing, ensure your environment meets the minimum requirements:

- **Node.js**: v20 LTS, v22 LTS, or newer (`node --version`)
- **npm**: v10 or newer (`npm --version`)
- **Docker Desktop**: Running locally for Toxiproxy and test target containers (`docker --version`)

---

## Getting Started

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/netreplay.git
   cd netreplay
   ```

2. **Run the preflight setup check**:
   ```bash
   npm run check:setup
   ```

3. **Install dependencies**:
   ```bash
   cd apps/api && npm ci
   cd ../web && npm ci
   cd ../..
   ```

4. **Initialize database schema**:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. **Start isolated Docker background services**:
   ```bash
   docker compose up -d test-target toxiproxy
   ```

6. **Start development servers**:
   - In Terminal 1 (Fastify API):
     ```bash
     npm run dev:api
     ```
   - In Terminal 2 (React Dashboard):
     ```bash
     npm run dev:web
     ```

---

## Verification & Testing Standards

All pull requests must pass the project's automated verification suites before merging:

```bash
# Preflight health check
npm run check:setup

# TypeScript typechecks
npm run typecheck:api
npm run typecheck:web

# Pure unit tests (Toxiproxy adapter & client)
npm run test:unit

# Fastify REST API & Security test suite
npm run test:api

# React Web component & client test suite
npm run test:web

# Combined test suite
npm test

# Live network smoke test
npm run test:smoke

# Complete 14-stage end-to-end journey
npm run test:e2e

# Production builds
npm run build:api
npm run build:web
```

---

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive branches like `feat/new-toxic-type`, `fix/cleanup-handling`, `docs/setup-guide`.
2. **Commit Messages**: Follow standard Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`, `test: ...`).
3. **No Secrets or DB Files**: Never commit `.env` files, SQLite databases (`dev.db`), logs, or coverage directories.
4. **Guaranteed Cleanup**: Any code modifying network proxy state **must** guarantee cleanup in `finally` blocks and set `errorCode: 'CLEANUP_FAILED'` if cleanup fails.
5. **Private Boundaries**: Toxiproxy control API (:8474) must remain bound to `127.0.0.1` and never exposed to `0.0.0.0` or public internet interfaces.
