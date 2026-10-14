# NetReplay — Network Failure Reproduction Platform

NetReplay is an open-source network failure reproduction engine designed to help engineers simulate, capture, reliably replay, and automatically minimize complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository implements **Step 6: Production Hardening, Security, Docker, and CI/CD**, hardening the complete multi-tier architecture: Step 1 Docker test target / Toxiproxy infrastructure, Step 2 reusable engine adapter, Step 3 Fastify REST API & SQLite persistence, Step 4 React dashboard & telemetry visualization, and Step 5 Automatic failure minimization engine.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 6 Adds (Hardening, Security, Docker, CI/CD)](#what-step-6-adds-hardening-security-docker-cicd)
3. [Security Architecture & Defensive Boundaries](#security-architecture--defensive-boundaries)
4. [Reliable Fault Cleanup & Disaster Recovery](#reliable-fault-cleanup--disaster-recovery)
5. [Docker Compose & Container Deployment](#docker-compose--container-deployment)
6. [GitHub Actions CI/CD Pipeline](#github-actions-cicd-pipeline)
7. [Automatic Failure Minimization Engine](#automatic-failure-minimization-engine)
8. [Dashboard Pages & Features](#dashboard-pages--features)
9. [REST API Contract (`/api/v1`)](#rest-api-contract-apiv1)
10. [Environment Configuration & Secrets Management](#environment-configuration--secrets-management)
11. [Quickstart & PowerShell Commands](#quickstart--powershell-commands)
12. [Running Automated Verification & Tests](#running-automated-verification--tests)
13. [Dependency & Code Quality Audit](#dependency--code-quality-audit)
14. [Troubleshooting & Emergency Recovery Guide](#troubleshooting--emergency-recovery-guide)
15. [License](#license)

---

## Architecture & Topology

```
+--------------------------------------------------------------------------------------------------+
|                                           HOST MACHINE                                           |
|                                                                                                  |
|  +-------------------------------------------------------------+                                 |
|  |             React Web Dashboard (`apps/web`) — Port :5173   |                                 |
|  |                                                             |                                 |
|  |  * Views: Overview, Profiles, Experiment Builder,           |                                 |
|  |           Runs, Run Details, Run Comparison, Minimization   |                                 |
|  |  * Recharts: Latency timeline & bucket distribution         |                                 |
|  |  * TanStack Query: Bounded polling for active runs          |                                 |
|  +------------------------------+------------------------------+                                 |
|                                 |                                                                |
|                                 | HTTP / JSON (CORS restricted to localhost:5173)                |
|                                 v                                                                |
|  +------------------------------------------------------------------------------+                |
|  |                 Fastify REST API (`apps/api`) — Port :3100                   |                |
|  |                                                                              |                |
|  |  * Security: 1MB Body Limit, Security Headers, Redacted Auth Logging         |                |
|  |  * Routes: Health, Engines, Profiles, Runs, Replay, Reports, Minimization   |                |
|  |  * Schemas: Strict Zod validation with fastify-type-provider-zod            |                |
|  |  * OpenAPI: Swagger UI live at http://127.0.0.1:3100/docs                    |                |
|  |  * Storage: SQLite via Prisma ORM (`apps/api/prisma/dev.db` / Docker Vol)   |                |
|  |  * Concurrency: Strict 1-active-experiment mutex per proxy                   |                |
|  +-----------------------+-----------------------------+------------------------+                |
|                          |                             |                                         |
|                          | Imports                     | Direct HTTP Calls                       |
|                          v                             |                                         |
|  +--------------------------------------------------+  |                                         |
|  |     packages/toxiproxy (ToxiproxyAdapter)        |  |                                         |
|  |  * Low-level client with NetReplay User-Agent    |  |                                         |
|  |  * withFault scoped cleanup in finally block     |  |                                         |
|  +-----------------------+--------------------------+  |                                         |
+--------------------------|-----------------------------|-----------------------------------------+
                           |                             |
         HTTP Control API  |             Proxied Traffic | Direct Baseline
         (:8474)           |             (:8666)         | (:3000)
                           |                             |
+--------------------------v-----------------------------v-----------------------------------------+
| DOCKER BRIDGE NETWORK (`netreplay-network`)                                                      |
|                                                                                                  |
|  +-----------------------------+               +--------------------------------+                |
|  |     netreplay-toxiproxy     |               |     netreplay-test-target      |                |
|  |                             |   TCP Fwd     |                                |                |
|  |  * Control API: :8474       |-------------->|  * Port: :3000                 |                |
|  |    (Bound strictly to       |               |  * Healthcheck: /health        |                |
|  |     127.0.0.1 loopback)     |               |  * Endpoints: /api/demo        |                |
|  |  * Traffic Listener: :8666  |               |               /api/slow        |                |
|  |  * Toxics: latency, timeout,|               |  * Runs as unprivileged node   |                |
|  |            bandwidth, reset |               |                                |                |
|  +-----------------------------+               +--------------------------------+                |
+--------------------------------------------------------------------------------------------------+
```

---

## What Step 6 Adds (Hardening, Security, Docker, CI/CD)

Step 6 hardens the entire NetReplay codebase for enterprise reliability, audit compliance, and automated deployment:

1. **Security & Defensive Boundaries**:
   - Explicit loopback `127.0.0.1` port bindings across all services.
   - Isolation of the Toxiproxy control API to internal / local boundaries.
   - Strict target URL whitelisting (preventing SSRF and open-proxy vulnerabilities).
   - 1MB request payload limits (HTTP 413 `PAYLOAD_TOO_LARGE`) and 30-second connection timeouts.
   - Standard security response headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-XSS-Protection`).
   - Logging redaction for sensitive headers (`authorization`, `cookie`).
   - Error masking to prevent stack trace or credential leakage.

2. **Reliable Fault Cleanup & Recovery**:
   - Guaranteed cleanup in `finally` blocks for both experiment runs and minimization iterations.
   - Cleanup failures mark runs and minimizations as `failed` with `CLEANUP_FAILED` error codes (never silently marked as completed).
   - Bounded graceful shutdown (5-second force-termination timeout on SIGINT/SIGTERM).
   - Dedicated manual recovery utility (`npm run clean:faults` / `scripts/reset-faults.mjs`).

3. **Multi-Stage Docker Deployment**:
   - Production multi-stage Dockerfiles for `apps/api` (Node 22 Alpine, non-root `node` user, Prisma deploy) and `apps/web` (Nginx 1.27 Alpine, SPA fallback, security headers).
   - Full-stack `docker-compose.yml` supporting all 4 services with pinned versions, container healthchecks, and persistent volume (`netreplay-api-data`).

4. **GitHub Actions CI/CD Pipeline**:
   - End-to-end automated workflow (`.github/workflows/ci.yml`) covering clean install (`npm ci`), Prisma validation, TypeScript typechecks (`api` and `web`), Toxiproxy unit tests, Docker Compose integration tests, live network smoke tests, production builds, and Docker packaging.

---

## Security Architecture & Defensive Boundaries

### 1. Loopback Interface Binding & Private Control API
- **Why Toxiproxy Control Must Remain Private**: Toxiproxy's HTTP management API (`http://127.0.0.1:8474`) allows arbitrary TCP proxy creation, manipulation, and network toxic injection without authentication. If exposed to public host interfaces or the internet, an attacker could route arbitrary traffic or disrupt services.
- **Enforcement**: In `docker-compose.yml`, all ports are explicitly bound to `127.0.0.1` (`"127.0.0.1:8474:8474"` and `"127.0.0.1:8666:8666"`). Fastify API acts as the sole, authenticated gatekeeper for proxy mutations.

### 2. Network Target Restrictions (Anti-SSRF / Anti-Open-Proxy)
- NetReplay is **not** a general-purpose proxy and cannot be used to probe internal cloud metadata (`169.254.169.254`), intranet hosts, or arbitrary upstream URLs.
- **Validation**:
  - `TargetConfigDetailsSchema` in `apps/api/src/schemas/profile.ts` enforces that target paths must be relative paths starting with `/` (e.g. `/api/demo`, `/api/slow`).
  - Inputs containing `://` (schemes like `http://`, `https://`, `file://`) are rejected immediately with HTTP 400 `BAD_REQUEST`.
  - Target base URLs are strictly resolved via server-side configuration (`TEST_TARGET_PROXY_URL`).

### 3. Request Size & Timeout Limits
- Fastify application factory (`buildApp` in `apps/api/src/app.ts`) configures `bodyLimit: 1048576` (1MB).
- Payloads exceeding 1MB are rejected with HTTP 413 `PAYLOAD_TOO_LARGE`.
- Server connections enforce `connectionTimeout: 30000` (30 seconds) to prevent slowloris resource exhaustion.

### 4. CORS Policy
- CORS is restricted to explicit allowed origins via `@fastify/cors`:
  ```ts
  corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173']
  ```
- Requests from unlisted origins receive HTTP 403 `FORBIDDEN`.
- Unrestricted wildcard (`*`) origins with credentials are expressly prohibited.

### 5. Error Masking & Redacted Logging
- Centralized error handler catches internal errors and masks internal details. Clients receive:
  ```json
  {
    "statusCode": 500,
    "error": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected internal server error occurred"
  }
  ```
- Stack traces, database file paths, and environment variables are never exposed in API responses.
- Pino logger redacts `req.headers.authorization` and `req.headers.cookie`.

### 6. Concurrency Locking
- Both `ExperimentRunner` and `MinimizationService` maintain in-memory mutexes.
- Attempting to launch a run or minimization while another is active immediately returns HTTP 409 `CONFLICT`:
  ```json
  {
    "statusCode": 409,
    "error": "CONFLICT",
    "message": "A network experiment or failure minimization is already in progress. Concurrent proxy operations are not permitted."
  }
  ```

### 7. Trusted Environment Notice
> [!IMPORTANT]
> NetReplay is architected for trusted local development, CI pipelines, and isolated testing environments. It does not contain user authentication or role-based access control (RBAC). It should **never** be exposed directly to the public internet without an authenticating reverse proxy or VPN boundary.

---

## Reliable Fault Cleanup & Disaster Recovery

Fault injection inherently risks leaving toxic rules active on network proxies, which could disrupt subsequent tests or local services. NetReplay implements multiple defensive layers to guarantee clean state restoration:

1. **Guaranteed `finally` Blocks**:
   - `ExperimentRunner.execute()` and `MinimizerEngine.execute()` always invoke `toxiproxyService.clearFaults()` in their `finally` blocks.
2. **Cancellation Handling**:
   - When a user cancels a run (`POST /api/v1/runs/:id/cancel`) or minimization (`POST /api/v1/minimizations/:id/cancel`), active `AbortController` signals terminate in-flight requests and immediately trigger fault cleanup.
3. **Visibility of Cleanup Failures**:
   - If Toxiproxy is unreachable or returns an error during cleanup, the run or minimization is **explicitly marked as `failed`** with `errorCode: 'CLEANUP_FAILED'` and a descriptive message. It is **never** silently marked as successful.
4. **Proxy Scoping**:
   - `clearFaults(proxyName)` clears toxics only from the specific target proxy (`netreplay-demo`). It never deletes unrelated proxies or issues global engine wipes.
5. **Bounded Graceful Shutdown**:
   - Fastify API listens for `SIGINT` and `SIGTERM`. If shutdown does not complete within 5 seconds (e.g., due to an in-flight socket lock), force-termination occurs.
6. **Manual Emergency Reset Script**:
   - NetReplay includes an emergency operator tool that inspects and restores proxy state:
     ```powershell
     npm run clean:faults
     # Or directly:
     node scripts/reset-faults.mjs [optional-proxy-name]
     ```

---

## Docker Compose & Container Deployment

NetReplay provides a complete, reproducible multi-container stack orchestrated via `docker-compose.yml`.

### Services

| Service | Container Name | Image / Build | Port Bindings | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `test-target` | `netreplay-test-target` | Multi-stage (`node:22-alpine`) | `127.0.0.1:3000:3000` | Deterministic HTTP target (`/api/demo`, `/api/slow`, `/health`) |
| `toxiproxy` | `netreplay-toxiproxy` | `ghcr.io/shopify/toxiproxy:2.12.0` | `127.0.0.1:8474:8474`<br>`127.0.0.1:8666:8666` | L4/L7 TCP fault proxy engine |
| `api` | `netreplay-api` | Multi-stage (`node:22-alpine`) | `127.0.0.1:3100:3100` | Fastify REST API & SQLite persistence |
| `web` | `netreplay-web` | Multi-stage (`nginx:1.27-alpine`) | `127.0.0.1:5173:5173` | React Dashboard & SPA web server |

### Local Docker Workflow Commands

```powershell
# 1. Validate Docker Compose configuration
docker compose config

# 2. Build multi-stage container images reproducibly from lockfile
docker compose build

# 3. Start all services in the background
docker compose up -d

# 4. Check container health status
docker compose ps

# 5. Inspect application logs
docker compose logs -f --tail 100

# 6. Stop and remove containers cleanly
docker compose down
```

---

## GitHub Actions CI/CD Pipeline

NetReplay includes a continuous integration pipeline (`.github/workflows/ci.yml`) that runs on every push and pull request to `main`:

```
+-----------------------------------------------------------------------------+
|                            GitHub Actions CI Workflow                       |
+-----------------------------------------------------------------------------+
  |
  +--> Job 1: Typecheck & Schema Validation
  |      * Clean install with npm ci (Node 22)
  |      * Prisma schema validation: npx prisma validate
  |      * Prisma client generation: npm run prisma:generate
  |      * TypeScript checks: npm run typecheck:api & npm run typecheck:web
  |
  +--> Job 2: Toxiproxy Unit Tests
  |      * Pure Node.js unit tests: npm run test:unit (37 tests)
  |
  +--> Job 3: Integration, API & Smoke Tests
  |      * Spin up Docker Compose: docker compose up -d test-target toxiproxy
  |      * Await container healthchecks
  |      * Execute Fastify API test suite: npm run test:api (52 tests)
  |      * Execute React Web component test suite: npm run test:web (19 tests)
  |      * Execute Toxiproxy live integration: npm run test:integration (6 tests)
  |      * Execute live network smoke test: npm run test:smoke (+500ms delta check)
  |      * Emergency fault cleanup reset: npm run clean:faults
  |      * Teardown Docker Compose: docker compose down -v
  |
  +--> Job 4: Production Builds & Docker Packaging
         * Production compile API: npm run build:api
         * Production compile Web SPA: npm run build:web
         * Validate compose config: docker compose config
         * Build multi-stage Docker images: docker compose build
```

---

## Automatic Failure Minimization Engine

The **Automatic Failure Minimization Engine** takes an existing failed experiment run and systematically searches for the simplest network fault configuration that still reproduces the target failure condition:

1. **Delta-Debugging Component Reduction**: Eliminates unnecessary fault components one by one and in pairs.
2. **Numeric Parameter Minimization**: Binary searches numeric parameters (latency, timeout thresholds, jitter) down to the lowest value that still trips the failure predicate.
3. **Multi-Trial Stochastic Verification**: Accounts for network nondeterminism through configurable trial policies and reproduction rate thresholds.
4. **Interactive Dashboard Integration**: A "Minimize Failure" dialog on Run Details launches jobs, links directly to the Minimization Progress & Diff view (`/minimizations/:id`), and clearly explains parameter reductions and removed components.

---

## Dashboard Pages & Features

| Route | Component | Key Capabilities |
| :--- | :--- | :--- |
| `/` | `OverviewPage` | Live Toxiproxy (:8474) & Fastify (:3100) health cards, total profiles/runs stats, recent runs audit table, one-click quick profile launch. |
| `/profiles` | `ProfilesPage` | Searchable profile grid, tag filtering, profile creation/edit dialogs, delete confirmation with active-run safety checks, quick launch buttons. |
| `/experiments/new` | `ExperimentCreatePage` | Fault composer (latency, timeout, bandwidth, TCP reset), target whitelist selector, live pre-run summary preview, and immediate run scheduler. |
| `/runs` | `RunsPage` | Paginated historical runs table, status filtering (`queued`, `running`, `completed`, `failed`, `cancelled`), bounded polling, one-click snapshot replays, report downloads. |
| `/runs/:id` | `RunDetailsPage` | Live run status badge, median/mean/min/max metrics strip, Recharts latency timeline & distribution charts, request measurement table, lifecycle event log, snapshot inspector, cancel button with confirmation, and **"Minimize Failure"** launch button. |
| `/minimizations/:id` | `MinimizationPage` | Progress tracking, status badge, attempts used / budget, elapsed time, side-by-side original vs minimized fault configurations, reduction explanations (removed components, reduced numeric parameters), empirical disclaimer, and complete chronological attempts audit log with cancellation support. |
| `/compare` | `RunComparisonPage` | Side-by-side run picker, automated baseline detection, latency delta calculations ($\Delta$ Median, $\Delta$ Mean), comparative metric variance table, overlaid line chart. |

---

## REST API Contract (`/api/v1`)

- **Health & Engines**:
  - `GET /health` — Fast process liveness probe (HTTP 200).
  - `GET /api/v1/health` — Readiness probe (inspects SQLite DB connectivity and Toxiproxy engine status).
  - `GET /api/v1/engines` — Lists registered fault engines (`toxiproxy`).
  - `GET /api/v1/engines/toxiproxy` — Detailed Toxiproxy health and version.
- **Profiles**: `GET /api/v1/profiles`, `POST /api/v1/profiles`, `GET /api/v1/profiles/:id`, `PATCH /api/v1/profiles/:id`, `DELETE /api/v1/profiles/:id`
- **Runs**: `POST /api/v1/runs`, `GET /api/v1/runs`, `GET /api/v1/runs/:id`, `GET /api/v1/runs/:id/events`, `GET /api/v1/runs/:id/requests`, `POST /api/v1/runs/:id/replay`, `POST /api/v1/runs/:id/cancel`
- **Automatic Failure Minimization**:
  - `POST /api/v1/runs/:id/minimize` — validates options, enqueues minimization search, returns HTTP 202 Accepted.
  - `GET /api/v1/minimizations/:id` — retrieves current search status, minimized configuration, parameter reductions, and duration.
  - `GET /api/v1/minimizations/:id/attempts` — retrieves complete attempt history detailing each fault candidate evaluated, trial counts, and outcomes.
  - `POST /api/v1/minimizations/:id/cancel` — requests cancellation of an active search and cleanly restores proxy state.
- **Reports**: `GET /api/v1/runs/:id/report?format=json`, `GET /api/v1/runs/:id/report?format=markdown`
- **Interactive Documentation**: Swagger UI live at `http://127.0.0.1:3100/docs`

---

## Environment Configuration & Secrets Management

Configuration is handled via `.env.example` templates with safe defaults for local development:

```env
# Node Environment
NODE_ENV=development

# Host Port Bindings
TEST_TARGET_PORT=3000
TOXIPROXY_CONTROL_PORT=8474
TOXIPROXY_LISTEN_PORT=8666
API_PORT=3100
API_HOST=127.0.0.1
WEB_PORT=5173

# Database
DATABASE_URL="file:../prisma/dev.db"

# Internal Engine URLs
TOXIPROXY_CONTROL_URL=http://127.0.0.1:8474
TOXIPROXY_PROXY_NAME=netreplay-demo
TEST_TARGET_DIRECT_URL=http://127.0.0.1:3000
TEST_TARGET_PROXY_URL=http://127.0.0.1:8666

# Security & Request Limits
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
REQUEST_BODY_LIMIT_BYTES=1048576
CONNECTION_TIMEOUT_MS=30000
LOG_LEVEL=info

# Frontend Client Public Base URL (never put secrets here)
VITE_API_BASE_URL=http://127.0.0.1:3100
```

---

## Quickstart & PowerShell Commands

### Local Development Setup

```powershell
# 1. Start background infrastructure (test target & Toxiproxy)
npm run up

# 2. Run database migrations
npm run prisma:generate
npm run prisma:migrate

# 3. Start Fastify API (Terminal 1)
npm run dev:api
# Listens on http://127.0.0.1:3100

# 4. Start React Web Dashboard (Terminal 2)
npm run dev:web
# Listens on http://127.0.0.1:5173
```

Open your browser to: **`http://127.0.0.1:5173`**

---

## Running Automated Verification & Tests

NetReplay features a comprehensive automated test suite with **114 passing automated tests**:

```powershell
# 1. Run All Tests (Unit + API + Web + Security)
npm test

# 2. Run Toxiproxy Engine Unit Tests (37 tests)
npm run test:unit

# 3. Run Fastify REST API & Security Test Suite (52 tests)
npm run test:api

# 4. Run React Dashboard Component & Client Suite (19 tests)
npm run test:web

# 5. Run Live Integration Suite (6 tests)
npm run test:integration

# 6. Run Live Network Smoke Test (Validates ~500ms injected latency)
npm run test:smoke

# 7. Run TypeScript Typechecking
npm run typecheck:api
npm run typecheck:web

# 8. Run Production Builds
npm run build:api
npm run build:web
```

---

## Dependency & Code Quality Audit

A security audit (`npm audit`) was performed across all workspaces:

- **Audit Findings**:
  - `tinypool` / `@vitest/mocker`: Dev-dependencies used strictly by Vitest for local test execution. Upgrading would require `vitest@5`, which introduces breaking changes to the test suite.
  - `braces` / `postcss-selector-parser`: Dev-dependencies in Tailwind CSS v3 build chain. Resolving requires Tailwind v4, which deprecates existing CSS `@tailwind` configurations.
  - `react-router-dom`: Router v6 dev dependency. Resolving requires React Router v7, which rewrites route definitions.
  - `@fastify/static`: Nested inside `@fastify/swagger-ui`. Resolving requires a major version upgrade.
- **Decision & Rationale**:
  - In accordance with production stability best practices, breaking major upgrades were **not forced**.
  - All application dependencies used in runtime production builds were verified.
  - Development tools are isolated to local testing environments and omitted from production container stages (`npm ci --omit=dev`).

---

## Troubleshooting & Emergency Recovery Guide

### 1. Lingering Network Faults or Stuck Latency
If an experiment was interrupted abruptly (e.g. process kill) and latency persists:
```powershell
npm run clean:faults
```
*Inspects `netreplay-demo` on Toxiproxy and deletes any active toxics.*

### 2. "Unable to connect to NetReplay API"
- Verify the Fastify API process is running on port 3100 (`npm run dev:api`).
- Verify `VITE_API_BASE_URL` in `apps/web/.env` is set to `http://127.0.0.1:3100`.

### 3. "CORS Error: Origin not allowed"
- The API restricts access to `http://localhost:5173` and `http://127.0.0.1:5173`.
- If accessing from a custom host or port, add it to `CORS_ORIGINS` in your `.env`.

### 4. Toxiproxy Engine Status Shows "Offline"
- Check that the Toxiproxy container is running: `docker compose ps`.
- Verify port 8474 responds:
  ```powershell
  curl.exe http://127.0.0.1:8474/version
  ```
- If stopped, restart:
  ```powershell
  docker compose up -d toxiproxy
  ```

### 5. SQLite Database Migration / Schema Out of Sync
- Run Prisma migrations:
  ```powershell
  npm run prisma:generate
  npm run prisma:migrate
  ```

---

## License

NetReplay is open-source under the MIT License.
Shopify Toxiproxy is licensed under the MIT License ([Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)).
