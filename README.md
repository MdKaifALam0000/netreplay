# NetReplay — Network Failure Reproduction Platform

NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, and reliably replay complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository implements **Step 3: Fastify REST API and Experiment Storage**, building on the Step 1 Docker test target / Toxiproxy infrastructure and Step 2 reusable engine adapter.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 3 Adds](#what-step-3-adds)
3. [REST API Contract (`/api/v1`)](#rest-api-contract-apiv1)
4. [Database & Persistence (SQLite + Prisma)](#database--persistence-sqlite--prisma)
5. [Experiment Runner Mechanics](#experiment-runner-mechanics)
6. [Interactive OpenAPI / Swagger Documentation](#interactive-openapi--swagger-documentation)
7. [Prerequisites & Environment Configuration](#prerequisites--environment-configuration)
8. [Quickstart & PowerShell Commands](#quickstart--powershell-commands)
9. [Running Automated Tests](#running-automated-tests)
10. [Step 2 Toxiproxy Engine Adapter Overview](#step-2-toxiproxy-engine-adapter-overview)
11. [Supported Fault Types & Schemas](#supported-fault-types--schemas)
12. [Operational Safety & Known Limitations](#operational-safety--known-limitations)
13. [Troubleshooting Guide](#troubleshooting-guide)
14. [License](#license)

---

## Architecture & Topology

```
+------------------------------------------------------------------------------------+
|                                    HOST MACHINE                                    |
|                                                                                    |
|  +------------------------------------------------------------------------------+  |
|  |                 Fastify REST API (`apps/api`) — Port :3100                   |  |
|  |                                                                              |  |
|  |  * Routes: Health, Engines, Profiles, Runs, Replay, Reports                  |  |
|  |  * Schemas: Strict Zod validation with TypeProviderZod                       |  |
|  |  * OpenAPI: Swagger UI live at http://127.0.0.1:3100/docs                    |  |
|  |  * Storage: SQLite via Prisma ORM (`apps/api/prisma/dev.db`)                 |  |
|  |  * Runner: Monotonic clock (`performance.now()`), 1 active run/proxy lock    |  |
|  +-----------------------+-----------------------------+------------------------+  |
|                          |                             |                           |
|                          | Imports                     | Direct HTTP Calls         |
|                          v                             |                           |
|  +--------------------------------------------------+  |                           |
|  |     packages/toxiproxy (ToxiproxyAdapter)        |  |                           |
|  |  * Low-level client with NetReplay User-Agent    |  |                           |
|  |  * withFault scoped cleanup in finally block     |  |                           |
|  +-----------------------+--------------------------+  |                           |
+--------------------------|-----------------------------|---------------------------+
                           |                             |
         HTTP Control API  |             Proxied Traffic | Direct Baseline
         (:8474)           |             (:8666)         | (:3000)
                           |                             |
+--------------------------v-----------------------------v---------------------------+
| DOCKER BRIDGE NETWORK (`netreplay-network`)                                        |
|                                                                                    |
|  +-----------------------------+               +--------------------------------+  |
|  |     netreplay-toxiproxy     |               |     netreplay-test-target      |  |
|  |                             |   TCP Fwd     |                                |  |
|  |  * Control API: :8474       |-------------->|  * Port: :3000                 |  |
|  |  * Traffic Listener: :8666  |               |  * Healthcheck: /health        |  |
|  |  * Toxics: latency, timeout,|               |  * Endpoints: /api/demo        |  |
|  |            bandwidth, reset |               |               /api/slow        |  |
|  +-----------------------------+               +--------------------------------+  |
+------------------------------------------------------------------------------------+
```

---

## What Step 3 Adds

1. **Versioned REST API (`/api/v1`) in `apps/api/`**:
   - Built with Fastify v5 and strict TypeScript (`NodeNext` module resolution).
   - Zod validation for all route params, queries, and request bodies with automatic OpenAPI schema generation.
   - Centralized error handling providing RFC-compliant JSON errors without leaking internals or stack traces.
2. **Local Persistence with SQLite & Prisma**:
   - `Profile`, `Run`, `RequestResult`, and `RunEvent` data models.
   - Strict foreign key constraints with safe referential integrity: profiles cannot be deleted if active runs reference them; historical runs preserve configuration snapshots independently of future profile edits or deletions.
3. **In-Process Experiment Runner**:
   - Asynchronous queueing (returns `202 Accepted` immediately upon creation).
   - Lifecycle state machine: `queued` → `preparing` → `running` → `collecting` → `completed` (or `failed` / `cancelled`).
   - Single-experiment concurrency limit per proxy to prevent cross-contamination.
   - Microsecond timing resolution using monotonic clocks (`performance.now()`).
   - Guaranteed fault removal in a `finally` block even if the run fails or is cancelled.
4. **Replay Engine**:
   - Replays use the original run's immutable `configSnapshot` rather than current profile state.
   - Preserves historical experiment integrity across profile updates.
5. **Interactive Swagger UI**:
   - Hosted at `/docs` with schema models, operation summaries, and error formats.
6. **Multi-Format Experiment Reporting**:
   - Export run summaries, metrics, and request traces as JSON or formatted Markdown.

---

## REST API Contract (`/api/v1`)

### Health and Engines
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Basic application liveness check (`{ status: "ok", timestamp }`). |
| `GET` | `/api/v1/health` | Application readiness check, including database connectivity verification. |
| `GET` | `/api/v1/engines` | List available network fault engines, configuration status, and health. |
| `GET` | `/api/v1/engines/toxiproxy` | Inspect Toxiproxy engine status and reported daemon version. |

### Experiment Profiles
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/profiles` | List profiles with pagination (`page`, `pageSize`). |
| `POST` | `/api/v1/profiles` | Create a profile with validated target, engine, and bounded faults. |
| `GET` | `/api/v1/profiles/:id` | Retrieve a single profile by ID. |
| `PATCH` | `/api/v1/profiles/:id` | Partially update a profile. |
| `DELETE` | `/api/v1/profiles/:id` | Delete a profile (rejects with `409 Conflict` if an active run exists). |

### Experiment Runs
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/runs` | Schedule a new experiment run for a profile (`202 Accepted`). |
| `GET` | `/api/v1/runs` | List runs with pagination and optional `status` filter. |
| `GET` | `/api/v1/runs/:id` | Retrieve run status, timing, and summary statistics. |
| `GET` | `/api/v1/runs/:id/events` | List chronological lifecycle events for a run. |
| `GET` | `/api/v1/runs/:id/requests` | List individual request-level timing and outcome measurements. |
| `POST` | `/api/v1/runs/:id/replay` | Create and schedule a new run from the source run's exact config snapshot. |
| `POST` | `/api/v1/runs/:id/cancel` | Cancel an active run safely (stops future requests and cleans up faults). |

### Reports
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/runs/:id/report?format=json` | Export experiment summary, metrics, and requests in JSON. |
| `GET` | `/api/v1/runs/:id/report?format=markdown` | Export formatted Markdown experiment report. |

---

## Database & Persistence (SQLite + Prisma)

The SQLite database schema is defined in `apps/api/prisma/schema.prisma`:

- **`Profile`**: Defines reusable experiment specifications (name, description, engine, target, serialized config, tags).
- **`Run`**: Represents an experiment execution. Stores status (`queued`, `preparing`, `running`, `collecting`, `completed`, `failed`, `cancelled`), immutable `configSnapshot`, start/finish times, error codes, and summary JSON.
- **`RequestResult`**: Records every individual probe request (index, outcome, HTTP status, latency in ms, error category, timestamp).
- **`RunEvent`**: Ordered audit trail of lifecycle events (`run_queued`, `run_started`, `fault_injected`, `run_completed`, etc.) with structured JSON details.

---

## Experiment Runner Mechanics

1. **Non-blocking Execution**:
   - `POST /api/v1/runs` immediately inserts a `Run` record with status `queued` and fires the asynchronous runner, returning `202 Accepted` with `{ runId, status: "queued" }`.
2. **Concurrency Safety**:
   - The runner acquires an in-memory lock per proxy name (e.g. `netreplay-demo`). If an experiment is already executing against that proxy, concurrent requests are safely rejected or queued to prevent toxic collisions.
3. **Monotonic Timing**:
   - Probe request latencies are measured using `performance.now()` before and after HTTP calls to eliminate clock drift or NTP adjustments.
4. **Resilient Cleanup**:
   - Even if target requests timeout, abort, or throw unexpected socket exceptions, fault removal (`adapter.removeFault`) executes within a `finally` block, ensuring no orphan toxics persist on the proxy.
5. **Snapshot Isolation for Replays**:
   - Calling `POST /api/v1/runs/:id/replay` reads the historical `configSnapshot` from the source run rather than referencing the live profile. If the profile was updated or deleted after the original run, the replay remains unaffected.

---

## Interactive OpenAPI / Swagger Documentation

The API includes built-in Swagger/OpenAPI documentation:
- **Swagger UI**: [http://127.0.0.1:3100/docs](http://127.0.0.1:3100/docs)
- **OpenAPI JSON**: [http://127.0.0.1:3100/docs/json](http://127.0.0.1:3100/docs/json)

All endpoints, query parameters, request payloads, response codes, and validation error models are documented and testable directly in the browser.

---

## Prerequisites & Environment Configuration

### Prerequisites
- **Node.js LTS** (v20+ or v22+)
- **Docker Desktop for Windows** (running)

### Environment Files
Copy `.env.example` to `.env` (or configure the environment directly):
```env
# Application Host & Port
API_PORT=3100
HOST=127.0.0.1

# Database Configuration (SQLite)
DATABASE_URL="file:./dev.db"

# Toxiproxy Engine
TOXIPROXY_CONTROL_URL="http://127.0.0.1:8474"
TOXIPROXY_PROXY_NAME="netreplay-demo"

# Network Targets
TEST_TARGET_DIRECT_URL="http://127.0.0.1:3000"
TEST_TARGET_PROXIED_URL="http://127.0.0.1:8666"
```

---

## Quickstart & PowerShell Commands

### 1. Start Docker Infrastructure
```powershell
npm run up
```

### 2. Install Dependencies & Initialize Database
```powershell
# Install root & workspace dependencies
npm install

# Generate Prisma Client
npm run prisma:generate

# Run SQLite migrations
npm run prisma:migrate
```

### 3. Start the API Development Server
```powershell
npm run dev:api
```
The server will start at:
- **Base URL**: `http://127.0.0.1:3100`
- **Swagger Docs**: `http://127.0.0.1:3100/docs`
- **Health Check**: `http://127.0.0.1:3100/health`

### 4. Build for Production & Start Compiled Server
```powershell
npm run build:api
npm run start:api
```

---

## Running Automated Tests

NetReplay includes isolated unit tests, API integration tests, and live network fault smoke tests:

### 1. API Integration & Route Tests (Vitest)
Executes 25 comprehensive tests against an isolated in-memory/temporary SQLite database verifying health, engine checks, profile CRUD, validation rules, run scheduling, snapshot replays, cancellations, concurrency limits, and markdown/JSON reports:
```powershell
npm run test:api
```

### 2. Type Checking
Verifies TypeScript compilation across the API workspace under strict compiler options:
```powershell
npm run typecheck:api
```

### 3. Step 2 Toxiproxy Unit Tests (Isolated, No Docker)
Runs 37 unit tests for the reusable Toxiproxy adapter:
```powershell
npm run test:unit
```

### 4. Live Toxiproxy Integration Tests
Tests adapter operations directly against the running Toxiproxy Docker container:
```powershell
npm run test:integration
```

### 5. Network Smoke Test (Step 1 & 2 Verification)
Runs the baseline vs. 500ms downstream latency fault smoke test:
```powershell
npm run test:smoke
```

---

## Step 2 Toxiproxy Engine Adapter Overview

The Fastify API interacts with Toxiproxy via `packages/toxiproxy/`:
- `client.js`: HTTP client communicating with Shopify Toxiproxy v2 with custom User-Agent headers.
- `adapter.js`: Manages proxy initialization (`ensureProxy`), scoped fault lifecycles (`withFault`), and toxic removal (`clearFaults`).
- `validation.js`: Strict validation ensuring bounded numeric ranges for all fault parameters.
- `errors.js`: Actionable error classes (`ToxiproxyValidationError`, `ToxiproxyNotFoundError`, etc.).

---

## Supported Fault Types & Schemas

NetReplay maps profile fault definitions into Toxiproxy toxic configurations:

1. **`latency`**:
   - `latencyMs` (*integer, 0 to 60,000*): Downstream or upstream delay in milliseconds.
   - `jitterMs` (*integer, 0 to 30,000, default: 0*): Randomized jitter delay ($\pm \text{jitter}$).
   - `stream` (*"upstream" | "downstream", default: "downstream"*).
   - `toxicity` (*number, 0.0 to 1.0, default: 1.0*): Probability of packet injection.
2. **`timeout`**:
   - `timeoutMs` (*integer, 0 to 60,000*): Socket stall duration before closure. `0` stalls connection indefinitely.
   - `stream` (*"upstream" | "downstream"*).
   - `toxicity` (*0.0 to 1.0*).
3. **`bandwidth`**:
   - `rateKbps` (*integer, 1 to 1,000,000*): Maximum throughput rate in KB/s.
   - `stream` (*"upstream" | "downstream"*).
   - `toxicity` (*0.0 to 1.0*).
4. **`reset` / `reset_peer`**:
   - Simulates immediate TCP `RST` termination without standard TCP `FIN` handshake.
   - `stream` (*"upstream" | "downstream"*).
   - `toxicity` (*0.0 to 1.0*).

---

## Operational Safety & Known Limitations

1. **Target URL Whitelisting**:
   - For security, profiles only permit configured local test targets (`local-test-target` -> `http://127.0.0.1:8666`). Arbitrary outbound URLs or user-supplied destinations are strictly rejected.
2. **In-Process Runner Queue**:
   - The Step 3 experiment runner runs in-process. If the Node.js API process crashes or restarts, active or queued in-flight experiments will transition to terminal states upon startup. (Production distributed deployments in future steps will introduce persistent job workers).
3. **Replay Determinism Limits**:
   - A replay guarantees identical configuration snapshot reuse, identical fault parameters, and probe counts. However, real network dynamics (TCP window resizing, OS scheduling jitter, random packet loss) mean network experiments have natural physical variance.
4. **Authentication & Authorization**:
   - Step 3 is designed for local development and private test environments. Authentication, API keys, and RBAC must be added before exposing the service to public or untrusted networks.
5. **Control API Isolation**:
   - The Toxiproxy control API (`:8474`) remains bound to localhost and internal Docker networks, never exposed publicly.

---

## Troubleshooting Guide

### Port 3100 Already in Use
Check which process is listening on port 3100:
```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue | Select-Object OwningProcess
```
Stop the conflicting process or change `API_PORT` in `.env`.

### Database Schema Out of Sync
Re-run Prisma migrations:
```powershell
npm run prisma:migrate
```

### Stale Toxics on Proxy
If an external process crashed while a toxic was active:
```powershell
curl.exe -X POST -H "User-Agent: NetReplay/1.0" http://127.0.0.1:8474/reset
```

---

## License

NetReplay is open-source under the MIT License.
Shopify Toxiproxy is licensed under the MIT License ([Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)).
