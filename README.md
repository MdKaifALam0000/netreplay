# NetReplay — Network Failure Reproduction Platform

NetReplay is an open-source network failure reproduction engine designed to help engineers simulate, capture, reliably replay, and automatically minimize complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository represents the release-ready **Step 7: End-to-End Validation and Open-Source Release Readiness**, providing a verified first-run experience, preflight diagnostic tooling, a deterministic local test target, and a comprehensive 14-stage end-to-end verification journey.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 7 Adds (Release Readiness & E2E Validation)](#what-step-7-adds-release-readiness--e2e-validation)
3. [The Complete User Journey](#the-complete-user-journey)
4. [First Experiment Tutorial (Step-by-Step)](#first-experiment-tutorial-step-by-step)
5. [Deterministic Local Test Target](#deterministic-local-test-target)
6. [Security Architecture & Defensive Boundaries](#security-architecture--defensive-boundaries)
7. [Reliable Fault Cleanup & Recovery](#reliable-fault-cleanup--recovery)
8. [Docker Compose & Container Deployment](#docker-compose--container-deployment)
9. [GitHub Actions CI/CD Pipeline](#github-actions-cicd-pipeline)
10. [Dashboard Pages & Features](#dashboard-pages--features)
11. [REST API Contract (`/api/v1`)](#rest-api-contract-apiv1)
12. [Environment Configuration & Secrets Management](#environment-configuration--secrets-management)
13. [Quickstart & PowerShell Commands](#quickstart--powershell-commands)
14. [Running Automated Verification & Tests](#running-automated-verification--tests)
15. [Dependency & Code Quality Audit](#dependency--code-quality-audit)
16. [Contributing & Release Hygiene](#contributing--release-hygiene)
17. [Troubleshooting & Emergency Recovery Guide](#troubleshooting--emergency-recovery-guide)
18. [License](#license)

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
|  |     127.0.0.1 loopback)     |               |  * Endpoints: /api/demo, /ok,  |                |
|  |  * Traffic Listener: :8666  |               |               /slow, /status,  |                |
|  |  * Toxics: latency, timeout,|               |               /large           |                |
|  |            bandwidth, reset |               |  * Runs as unprivileged node   |                |
|  +-----------------------------+               +--------------------------------+                |
+--------------------------------------------------------------------------------------------------+
```

---

## What Step 7 Adds (Release Readiness & E2E Validation)

Step 7 prepares NetReplay for open-source adoption, community contributions, and clean-checkout verification:

1. **Preflight Environment Diagnostic (`npm run check:setup`)**:
   - Automated script (`scripts/check-setup.mjs`) verifying Node runtime ($\ge 20$), `.env` presence, database accessibility, Docker service responsiveness (`:3000`, `:8474`), and port availability with actionable diagnostics.
2. **Complete 14-Stage End-to-End Journey (`npm run test:e2e`)**:
   - Automated scenario (`scripts/verify-api-e2e.mjs`) covering test target health, direct baseline, clean proxy baseline, low-level toxic injection, guaranteed cleanup, API health/Swagger, profile CRUD, experiment run execution with monotonic measurement polling, snapshot replay, concurrency mutex (409 Conflict), cancellation cleanup, report generation, failure minimization, and safe profile deletion.
3. **Deterministic Local Test Target Enhancements**:
   - Enhanced `services/test-target/server.js` exposing predictable, bounded probe endpoints: `GET /health`, `GET /ok` (and `/api/demo`), `GET /slow?ms=...`, `GET /status/:code`, and `GET /large?sizeKb=...`.
4. **First-Run Dashboard UX**:
   - Prominent failure & cleanup status alert banner on `RunDetailsPage` highlighting `CLEANUP_FAILED` with recovery instructions.
   - Enhanced topology and emergency recovery reference on `OverviewPage`.
5. **Open-Source Repository Hygiene**:
   - Formal [LICENSE](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/LICENSE) (MIT License).
   - Contributor documentation in [CONTRIBUTING.md](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/CONTRIBUTING.md).
   - GitHub Issue & Pull Request templates (`.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/`).
   - Cross-editor consistency via [.editorconfig](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/.editorconfig).

---

## The Complete User Journey

A new contributor or engineer follows this straightforward 10-step journey:

```
  1. Clone Repository        --> git clone https://github.com/MdKaifALam0000/netreplay.git
  2. Preflight Check         --> npm run check:setup
  3. Start Dependencies      --> npm run up (or docker compose up -d test-target toxiproxy)
  4. Initialize Database     --> npm run prisma:migrate
  5. Boot Application        --> npm run dev:api (Terminal 1) & npm run dev:web (Terminal 2)
  6. Confirm Engine Health   --> Open http://127.0.0.1:5173 (confirm Toxiproxy & API cards show Ready)
  7. Run Baseline & Fault    --> Select "Latency Profile (+500ms)" and click Run
  8. Compare & Replay        --> Inspect Latency Timeline chart; click "Replay Snapshot"
  9. Inspect Report          --> Download Markdown or JSON experiment report
 10. Safe Teardown           --> docker compose down
```

---

## First Experiment Tutorial (Step-by-Step)

### Step 1: Preflight Verification
Verify your local environment is ready:
```powershell
npm run check:setup
```
*Expected output: All checks passed (Node LTS, database, and background services confirmed).*

### Step 2: Direct Baseline vs Faulted Proxy Inspection
Run the automated live smoke test to observe fault injection in real-time:
```powershell
npm run test:smoke
```

#### Actual Observed Smoke Test Output:
```text
================================================================
        NetReplay Smoke Test (Powered by ToxiproxyAdapter)      
================================================================
Target Direct URL : http://127.0.0.1:3000
Toxiproxy Listener: http://127.0.0.1:8666
Toxiproxy Control : http://127.0.0.1:8474
Sample Count      : 10 requests per phase
Target Fault      : +500ms downstream latency
----------------------------------------------------------------
[*] Checking readiness for Test Target Server... [READY]
[*] Checking readiness for Toxiproxy Engine... [READY] (v2.12.0)
[+] Proxy 'netreplay-demo' is verified: [::]:8666 -> test-target:3000

Phase                         Success          Min        Median         Mean          Max
------------------------------------------------------------------------------------------
1. Direct Baseline              10/10        3.2 ms         3.7 ms        4.0 ms        6.5 ms
2. Proxy Baseline (Clean)       10/10        3.5 ms         4.0 ms        5.0 ms       10.4 ms
3. Proxy With Injected Fault    10/10      504.0 ms       505.0 ms      508.1 ms      534.6 ms
------------------------------------------------------------------------------------------
Proxy Baseline Median      : 4.00 ms
Fault-Injected Median      : 505.03 ms
Observed Median Delta (Δ)  : +501.03 ms (Threshold: >= 300 ms)
----------------------------------------------------------------
  >>> RESULT: PASS - Network Fault Injection Confirmed! <<<
[*] Cleaning up environment: removing latency toxic via adapter...
[+] Latency toxic removed successfully. Environment restored to clean state.
```

### Step 3: Run the Full 14-Stage E2E Validation Journey
```powershell
npm run test:e2e
```
*Validates the full application stack (adapter, Fastify API, Prisma SQLite, Swagger OpenAPI, snapshot replays, 409 mutex locks, cancellation cleanup, markdown reports, and failure minimization).*

---

## Deterministic Local Test Target

Located in `services/test-target/server.js`, built exclusively using Node.js built-in modules (`node:http`):

| Endpoint | HTTP Method | Parameters | Behavior & Verification |
| :--- | :--- | :--- | :--- |
| `/health` | `GET`, `HEAD` | None | Returns HTTP 200 `{ status: "ok", service: "test-target", uptimeSeconds: ... }`. Used by container healthchecks. |
| `/ok` or `/api/demo` | `GET`, `HEAD` | `?requestId=...` | Returns deterministic HTTP 200 JSON payload with request ID reflection. |
| `/slow` or `/api/slow` | `GET`, `HEAD` | `?ms=150` or `?delay=150` | Simulates internal application processing delay (validated integer, 0-5000 ms). Demonstrates application latency distinct from network latency. |
| `/status/:code` | `GET`, `HEAD` | Route param or `?code=...` | Returns the specified HTTP status code (strictly validated between 200 and 599). |
| `/large` or `/api/large` | `GET`, `HEAD` | `?sizeKb=64` | Returns a deterministic repeated payload of specified size (1-1024 KB). Useful for throughput and bandwidth throttle testing. |

---

## Security Architecture & Defensive Boundaries

1. **Loopback Binding (`127.0.0.1`)**: All exposed Docker ports (`3000`, `3100`, `5173`, `8474`, `8666`) bind strictly to `127.0.0.1`. Neither Toxiproxy nor the API is exposed on `0.0.0.0` or public network adapters.
2. **Private Control Boundary**: Port `8474` (Toxiproxy Management) is kept internal. The browser dashboard interacts exclusively with the Fastify REST API (`/api/v1/*`), which validates and mediates all proxy mutations.
3. **Strict Target Whitelisting (Anti-SSRF)**: Target paths must be relative paths starting with `/` (e.g. `/api/demo`). Full URLs, external schemes (`http://`, `https://`), and internal metadata IPs (`169.254.169.254`) are rejected with HTTP 400.
4. **Request Size & Connection Limits**: Fastify enforces `bodyLimit: 1048576` (1MB payload cap, returning HTTP 413 `PAYLOAD_TOO_LARGE`) and `connectionTimeout: 30000` (30s).
5. **Sanitized Error Responses**: Internal errors return generic `{ statusCode: 500, error: 'INTERNAL_SERVER_ERROR' }`. Stack traces, database file paths, and environment secrets are masked.
6. **Logging Redaction**: Fastify Pino logger redacts `req.headers.authorization` and `req.headers.cookie`.
7. **Strict CORS Policy**: Restricted to explicit whitelisted origins (`http://localhost:5173`, `http://127.0.0.1:5173`). Wildcard `*` origins are prohibited.
8. **Concurrency Mutex**: Strict 1-active-experiment lock per proxy. Concurrent execution attempts return HTTP 409 `CONFLICT`.
9. **Trusted Environment Notice**: NetReplay is built for trusted local and CI test environments. It does not include authentication and should not be exposed directly to the public internet.

---

## Reliable Fault Cleanup & Recovery

1. **Guaranteed `finally` Blocks**: All experiment runs and minimization iterations execute `toxiproxyService.clearFaults()` in their `finally` blocks.
2. **Cancellation Protection**: In-flight runs cancelled via UI or API abort network requests and trigger immediate fault removal.
3. **Visibility of Cleanup Failures**: If cleanup throws, the run or minimization is **explicitly marked as `failed`** with `errorCode: 'CLEANUP_FAILED'`, and a recovery recommendation is shown. It is **never** silently marked as successful.
4. **Emergency Recovery CLI**: NetReplay includes an operator reset utility:
   ```powershell
   npm run clean:faults
   ```

---

## Docker Compose & Container Deployment

NetReplay provides a complete multi-container stack orchestrated via `docker-compose.yml`:

| Service | Container Name | Image / Base | Host Binding | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `test-target` | `netreplay-test-target` | `node:22-alpine` | `127.0.0.1:3000:3000` | Deterministic local HTTP target |
| `toxiproxy` | `netreplay-toxiproxy` | `ghcr.io/shopify/toxiproxy:2.12.0` | `127.0.0.1:8474:8474`<br>`127.0.0.1:8666:8666` | L4/L7 TCP fault proxy engine |
| `api` | `netreplay-api` | `node:22-alpine` (multi-stage) | `127.0.0.1:3100:3100` | Fastify REST API & SQLite persistence |
| `web` | `netreplay-web` | `nginx:1.27-alpine` (multi-stage) | `127.0.0.1:5173:5173` | React Dashboard & SPA web server |

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

The continuous integration pipeline ([.github/workflows/ci.yml](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/.github/workflows/ci.yml)) executes on every push and pull request to `main`:

- **Job 1: Typecheck & Schema Validation**: `npx prisma validate`, `npm run prisma:generate`, `npm run typecheck:api`, `npm run typecheck:web`.
- **Job 2: Toxiproxy Unit Tests**: `npm run test:unit` (37 pure tests).
- **Job 3: Integration, API & Smoke Tests**: Starts Docker services, runs `npm run check:setup`, `npm run test:api` (52 tests), `npm run test:web` (19 tests), `npm run test:integration` (6 tests), `npm run test:smoke` (+500ms delta), `npm run test:e2e` (14 stages), emergency cleanup, and teardown.
- **Job 4: Production Builds & Docker Packaging**: `npm run build:api`, `npm run build:web`, `docker compose config`, `docker compose build`.

---

## Dashboard Pages & Features

| Route | Component | Key Capabilities |
| :--- | :--- | :--- |
| `/` | `OverviewPage` | Live Toxiproxy (:8474) & Fastify (:3100) health cards, total profiles/runs stats, recent runs audit table, one-click quick profile launch, topology and emergency recovery reference. |
| `/profiles` | `ProfilesPage` | Searchable profile grid, tag filtering, profile creation/edit dialogs, delete confirmation with active-run safety checks, quick launch buttons. |
| `/experiments/new` | `ExperimentCreatePage` | Fault composer (latency, timeout, bandwidth, TCP reset), target whitelist selector, live pre-run summary preview, and immediate run scheduler. |
| `/runs` | `RunsPage` | Paginated historical runs table, status filtering (`queued`, `running`, `completed`, `failed`, `cancelled`), bounded polling, one-click snapshot replays, report downloads. |
| `/runs/:id` | `RunDetailsPage` | Live run status badge, median/mean/min/max metrics strip, Recharts latency timeline & distribution charts, request measurement table, lifecycle event log, snapshot inspector, cancel button with confirmation, failure & cleanup failure banner (`CLEANUP_FAILED`), and **"Minimize Failure"** launch button. |
| `/minimizations/:id` | `MinimizationPage` | Progress tracking, status badge, attempts used / budget, elapsed time, side-by-side original vs minimized fault configurations, reduction explanations (removed components, reduced numeric parameters), empirical disclaimer, and complete chronological attempts audit log with cancellation support. |
| `/compare` | `RunComparisonPage` | Side-by-side run picker, automated baseline detection, latency delta calculations ($\Delta$ Median, $\Delta$ Mean), comparative metric variance table, overlaid line chart. |

---

## REST API Contract (`/api/v1`)

- **Health & Engines**: `GET /health`, `GET /api/v1/health`, `GET /api/v1/engines`, `GET /api/v1/engines/toxiproxy`
- **Profiles**: `GET /api/v1/profiles`, `POST /api/v1/profiles`, `GET /api/v1/profiles/:id`, `PATCH /api/v1/profiles/:id`, `DELETE /api/v1/profiles/:id`
- **Runs**: `POST /api/v1/runs`, `GET /api/v1/runs`, `GET /api/v1/runs/:id`, `GET /api/v1/runs/:id/events`, `GET /api/v1/runs/:id/requests`, `POST /api/v1/runs/:id/replay`, `POST /api/v1/runs/:id/cancel`
- **Automatic Failure Minimization**: `POST /api/v1/runs/:id/minimize`, `GET /api/v1/minimizations/:id`, `GET /api/v1/minimizations/:id/attempts`, `POST /api/v1/minimizations/:id/cancel`
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
# 1. Run Preflight Setup Diagnostic Check
npm run check:setup

# 2. Start background infrastructure (test target & Toxiproxy)
npm run up

# 3. Run database migrations
npm run prisma:generate
npm run prisma:migrate

# 4. Start Fastify API (Terminal 1)
npm run dev:api
# Listens on http://127.0.0.1:3100 (Swagger docs at http://127.0.0.1:3100/docs)

# 5. Start React Web Dashboard (Terminal 2)
npm run dev:web
# Listens on http://127.0.0.1:5173

# 6. Emergency fault reset (if an experiment is interrupted)
npm run clean:faults
```

Open your browser to: **`http://127.0.0.1:5173`**

---

## Running Automated Verification & Tests

NetReplay features a comprehensive automated verification suite:

```powershell
# 1. Preflight environment diagnostic check
npm run check:setup

# 2. Complete combined test suite (108 tests)
npm test

# 3. Toxiproxy Engine Unit Tests (37 tests)
npm run test:unit

# 4. Fastify REST API & Security Test Suite (52 tests)
npm run test:api

# 5. React Dashboard Component & Client Suite (19 tests)
npm run test:web

# 6. Live Integration Suite (6 tests)
npm run test:integration

# 7. Live Network Fault Injection Smoke Test (+500ms delta check)
npm run test:smoke

# 8. Complete 14-Stage End-to-End User Journey
npm run test:e2e

# 9. TypeScript Typechecking
npm run typecheck:api
npm run typecheck:web

# 10. Production Builds
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

## Contributing & Release Hygiene

We welcome contributions to NetReplay! Please read our [CONTRIBUTING.md](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/CONTRIBUTING.md) guide before submitting pull requests.

- **Issue Templates**: Bug reports and feature requests can be filed using GitHub templates in `.github/ISSUE_TEMPLATE/`.
- **Pull Request Template**: Pull requests should adhere to [.github/pull_request_template.md](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/.github/pull_request_template.md).
- **Editor Consistency**: Maintained through [.editorconfig](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/.editorconfig).
- **Clean Git Status**: Zero credentials, `.env` files, or SQLite databases committed.

---

## Troubleshooting & Emergency Recovery Guide

### 1. Lingering Network Faults or Stuck Latency
If an experiment was interrupted abruptly (e.g. process kill) and latency persists:
```powershell
npm run clean:faults
```
*Inspects `netreplay-demo` on Toxiproxy and deletes any active toxics.*

### 2. "Preflight Check Reports Test Target Offline"
- Start the Docker container:
  ```powershell
  docker compose up -d test-target
  ```
- Or run locally:
  ```powershell
  npm run target:start
  ```

### 3. "Toxiproxy Engine Status Shows Offline"
- Check that the Toxiproxy container is running:
  ```powershell
  docker compose ps
  ```
- Verify port 8474 responds:
  ```powershell
  curl.exe http://127.0.0.1:8474/version
  ```
- If stopped, restart:
  ```powershell
  docker compose up -d toxiproxy
  ```

### 4. "Unable to connect to NetReplay API"
- Verify the Fastify API process is running on port 3100 (`npm run dev:api`).
- Verify `VITE_API_BASE_URL` in `apps/web/.env` is set to `http://127.0.0.1:3100`.

### 5. "CORS Error: Origin not allowed"
- The API restricts access to `http://localhost:5173` and `http://127.0.0.1:5173`.
- If accessing from a custom host or port, add it to `CORS_ORIGINS` in your `.env`.

---

## License

NetReplay is open-source software licensed under the [MIT License](file:///c:/Users/alamk/OneDrive/Desktop/netreplay/LICENSE).
Shopify Toxiproxy is licensed under the MIT License ([Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)).
