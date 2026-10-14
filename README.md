# NetReplay — Network Failure Reproduction Platform

NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, reliably replay, and automatically minimize complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository implements **Step 5: Automatic Failure Minimization Engine**, building on the Step 1 Docker test target / Toxiproxy infrastructure, Step 2 reusable engine adapter, Step 3 Fastify REST API & SQLite persistence, and Step 4 React dashboard & telemetry visualization.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 5 Adds (Automatic Failure Minimization)](#what-step-5-adds-automatic-failure-minimization)
3. [How the Minimization Search Works](#how-the-minimization-search-works)
4. [Supported Failure Predicates & Fault Types](#supported-failure-predicates--fault-types)
5. [Search Budgets, Trial Policies & Reproduction Rates](#search-budgets-trial-policies--reproduction-rates)
6. [Empirical Search Bounds & Mathematical Limitations](#empirical-search-bounds--mathematical-limitations)
7. [Cleanup, Concurrency & Isolation Safeguards](#cleanup-concurrency--isolation-safeguards)
8. [Dashboard Pages and Features](#dashboard-pages-and-features)
9. [REST API Contract (`/api/v1`)](#rest-api-contract-apiv1)
10. [Prerequisites & Environment Configuration](#prerequisites--environment-configuration)
11. [Quickstart & PowerShell Commands](#quickstart--powershell-commands)
12. [Running Automated Tests](#running-automated-tests)
13. [Operational Safety & Limitations](#operational-safety--limitations)
14. [Troubleshooting Guide](#troubleshooting-guide)
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
|  |           Runs, Run Details, Run Comparison                 |                                 |
|  |  * Recharts: Latency timeline & bucket distribution         |                                 |
|  |  * TanStack Query: Bounded polling for active runs          |                                 |
|  +------------------------------+------------------------------+                                 |
|                                 |                                                                |
|                                 | HTTP / JSON (CORS restricted to localhost:5173)                |
|                                 v                                                                |
|  +------------------------------------------------------------------------------+                |
|  |                 Fastify REST API (`apps/api`) — Port :3100                   |                |
|  |                                                                              |                |
|  |  * Routes: Health, Engines, Profiles, Runs, Replay, Reports                  |                |
|  |  * Schemas: Strict Zod validation with TypeProviderZod                       |                |
|  |  * OpenAPI: Swagger UI live at http://127.0.0.1:3100/docs                    |                |
|  |  * Storage: SQLite via Prisma ORM (`apps/api/prisma/dev.db`)                 |                |
|  |  * Runner: Monotonic clock (`performance.now()`), 1 active run/proxy lock    |                |
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
|  |  * Traffic Listener: :8666  |               |  * Healthcheck: /health        |                |
|  |  * Toxics: latency, timeout,|               |  * Endpoints: /api/demo        |                |
|  |            bandwidth, reset |               |               /api/slow        |                |
|  +-----------------------------+               +--------------------------------+                |
+--------------------------------------------------------------------------------------------------+
```

---

## What Step 5 Adds (Automatic Failure Minimization)

The **Automatic Failure Minimization Engine** takes an existing failed experiment run and systematically searches for the simplest network fault configuration that still reproduces the target failure condition.

When an experiment with multiple interacting network faults causes a failure (e.g. latency + jitter + packet bandwidth throttle + TCP reset), it is often unclear which fault is truly necessary and which are incidental. The minimizer resolves this ambiguity through an automated staged search:

1. **Delta-Debugging Component Reduction**: Eliminates unnecessary fault components one by one and in pairs.
2. **Numeric Parameter Minimization**: Binary searches numeric parameters (e.g., latency duration, timeout thresholds, jitter) down to the lowest value that still trips the failure predicate.
3. **Multi-Trial Stochastic Verification**: Accounts for network nondeterminism through configurable trial policies and reproduction rate thresholds.
4. **Interactive Dashboard Integration**: A "Minimize Failure" dialog on Run Details launches jobs, links directly to the Minimization Progress & Diff view (`/minimizations/:id`), and clearly explains parameter reductions and removed components.

---

## How the Minimization Search Works

Minimization executes sequentially across four distinct stages:

```
+--------------------------------------------------------------------------------------------------+
|                                    MINIMIZATION WORKFLOW                                         |
|                                                                                                  |
|  [Stage A: Validate Baseline]                                                                    |
|    * Re-evaluates source run's original fault configuration snapshot.                            |
|    * If target failure does NOT reproduce, halts with status: `baseline_not_reproducible`.       |
|    * Source run history and measurements remain completely immutable.                            |
|                                     | (Baseline passes)                                          |
|                                     v                                                            |
|  [Stage B: Component Reduction (Delta Debugging)]                                                |
|    * Evaluates candidate configurations with individual fault components removed.                |
|    * If failure still reproduces: removal is KEPT (component was unnecessary).                  |
|    * If failure disappears: removal is REJECTED (component is restored).                         |
|    * Tests pairwise removals for interacting faults.                                             |
|                                     |                                                            |
|                                     v                                                            |
|  [Stage C: Numeric Parameter Minimization]                                                       |
|    * For latency faults: first attempts to reduce jitter to 0 ms.                                |
|    * Binary searches `latencyMs` between 0 and baseline latency to find the threshold.          |
|    * Binary searches `timeoutMs` or bandwidth throttles.                                         |
|                                     |                                                            |
|                                     v                                                            |
|  [Stage D: Verification & Final Trial Policy]                                                    |
|    * Re-evaluates final minimized candidate using configured verification trials (e.g. 3 to 5).  |
|    * Validates that observed reproduction rate meets or exceeds the required threshold.          |
|    * Marks job `completed` with detailed configuration diff and attempt audit history.           |
+--------------------------------------------------------------------------------------------------+
```

---

## Supported Failure Predicates & Fault Types

### Supported Failure Predicates
Predicates define what observable condition constitutes a successful reproduction of the target bug:

| Predicate Type | Identifier | Condition Checked | Parameters |
| :--- | :--- | :--- | :--- |
| **HTTP 5xx Server Error** | `status_5xx` | HTTP response status is between 500 and 599 | `statusCode` (optional, e.g. 500, 502, 503) |
| **Deadline Exceeded** | `deadline_exceeded` | Request latency or timeout exceeds threshold | `deadlineMs` (required integer, 1 to 60000 ms) |
| **Connection Reset** | `connection_reset` | TCP socket abruptly closed, ECONNRESET, EPIPE | None |
| **Network Error** | `network_error` | Request fails with a network exception | `errorCategory` (optional, e.g. `ETIMEDOUT`) |
| **Missing Response** | `response_missing` | Request timed out or response body dropped | None |
| **Exact Status Code** | `status_code` | Exact HTTP status assertion | `statusCode` (required integer, 100 to 599) |

### Infrastructure Error Isolation
The evaluator strictly distinguishes the target application bug from infrastructure outages:
- If Toxiproxy control plane (:8474) or the test target container (:3000) becomes unreachable due to external crashes, the trial is flagged as an infrastructure error (`isInfraError: true`).
- Infrastructure failures are **never** counted as a successful reproduction of the target bug.

### Supported Fault Types
Uses the validated Toxiproxy adapter schema:
- `latency`: `latencyMs` (0 to 60,000 ms), `jitterMs` (0 to 30,000 ms), `toxicity`, `stream`.
- `timeout`: `timeoutMs` (0 to 60,000 ms), `stream`.
- `bandwidth`: `rateKbps` (1 to 1,000,000 kbps), `stream`.
- `reset` / `reset_peer`: TCP connection reset.

---

## Search Budgets, Trial Policies & Reproduction Rates

Because real-world network reproduction cannot run indefinitely, search parameters are bounded with conservative defaults:

- **Attempt Budget (`maxAttempts`)**: Maximum candidate configurations evaluated (default: 50, upper bound: 200). If budget is exhausted, the engine terminates with `budget_exhausted` and returns the best partial configuration discovered so far.
- **Wall-Clock Deadline (`deadlineSeconds`)**: Total maximum search duration (default: 300s / 5 minutes, upper bound: 900s / 15 minutes).
- **Exploration Trials (`trialsPerCandidate`)**: Probes executed for each candidate during reduction (default: 1, range: 1 to 10).
- **Verification Trials (`finalTrials`)**: Repeated evaluations on the final minimized candidate (default: 3, range: 1 to 20).
- **Reproduction Rate Threshold (`minReproductionRate`)**: Fraction of trials required to trigger (default: 1.0 = 100%, range: 0.1 to 1.0). For stochastic network failures, setting `0.8` allows the engine to accept candidates that reproduce the failure at least 80% of the time.

---

## Empirical Search Bounds & Mathematical Limitations

> **Important Conceptual Note**:
> NetReplay reports the **smallest fault configuration found within the configured search strategy, attempt budget, and time limit**.
>
> In real distributed systems:
> 1. Network behaviors can be **nondeterministic** (stochastic packet loss, variable scheduling latency).
> 2. Certain application retry backoffs or circuit breakers exhibit **non-monotonic** behavior (where an intermediate delay trips a threshold that a higher or lower delay does not).
>
> Therefore, failure minimization provides an **empirical minimum within the bounded exploration space**, not a formal mathematical proof of a global minimum.

---

## Cleanup, Concurrency & Isolation Safeguards

1. **Per-Proxy Concurrency Lock**: Only one experiment run or failure minimization job can manipulate the target proxy (`netreplay-demo`) at any given time. Colliding starts are rejected with `409 Conflict`.
2. **Guaranteed Fault Cleanup**: Every candidate evaluation runs within a strict `try ... finally` block that invokes `toxiproxyService.clearFaults()`.
3. **Cancellation Safety**: Cancellation immediately aborts the active search loop and triggers proxy cleanup so no toxic remains active.
4. **Cleanup Failure Visibility**: If Toxiproxy fails to respond during cleanup, the job surfaces `cleanupStatus: "cleanup_failed"` and marks the record with high-severity alert details.
5. **Zero Host Mutation**: No host iptables, shell commands, or arbitrary URLs are touched. Probes are restricted exclusively to the isolated local test container.
6. **Immutability of Source Runs**: The source run's original snapshot, status, and telemetry measurements are never modified.

---

## Dashboard Pages and Features

| Page Route | Component | Key Features |
| :--- | :--- | :--- |
| `/` | `OverviewPage` | Live Toxiproxy (:8474) & Fastify (:3100) health cards, total profiles/runs stats, recent runs audit table, one-click quick profile launch. |
| `/profiles` | `ProfilesPage` | Searchable profile grid, tag filtering, profile creation/edit dialogs, delete confirmation with active-run safety checks, quick launch buttons. |
| `/experiments/new` | `ExperimentCreatePage` | Fault composer (latency, timeout, bandwidth, TCP reset), target whitelist selector, live pre-run summary preview, and immediate run scheduler. |
| `/runs` | `RunsPage` | Paginated historical runs table, status filtering (`queued`, `running`, `completed`, `failed`, `cancelled`), bounded polling, one-click snapshot replays, report downloads. |
| `/runs/:id` | `RunDetailsPage` | Live run status badge, median/mean/min/max metrics strip, Recharts latency timeline & distribution charts, request measurement table, lifecycle event log, snapshot inspector, cancel button with confirmation, and **"Minimize Failure"** launch button. |
| `/minimizations/:id` | `MinimizationPage` | Progress tracking, status badge, attempts used / budget, elapsed time, side-by-side original vs minimized fault configurations, reduction explanations (removed components, reduced numeric parameters), empirical disclaimer, and complete chronological attempts audit log with cancellation support. |
| `/compare` | `RunComparisonPage` | Side-by-side run picker, automated baseline detection, latency delta calculations ($\Delta$ Median, $\Delta$ Mean), comparative metric variance table, overlaid line chart. |

---

## Frontend Stack & Architecture

- **Framework**: React 18 + Vite 6
- **Routing**: React Router DOM v6
- **State & Caching**: TanStack Query v5 with bounded polling
- **Styling**: Tailwind CSS with custom developer dark palette
- **Charts**: Recharts v2 (ResponsiveContainer, AreaChart, BarChart, LineChart)
- **Icons**: Lucide React
- **Validation**: Zod + TypeScript strict mode
- **Testing**: Vitest + React Testing Library + jsdom

---

## REST API Contract (`/api/v1`)

The frontend interacts with the backend strictly via `/api/v1`:

- **Health & Engines**: `GET /health`, `GET /api/v1/health`, `GET /api/v1/engines`, `GET /api/v1/engines/toxiproxy`
- **Profiles**: `GET /api/v1/profiles`, `POST /api/v1/profiles`, `GET /api/v1/profiles/:id`, `PATCH /api/v1/profiles/:id`, `DELETE /api/v1/profiles/:id`
- **Runs**: `POST /api/v1/runs`, `GET /api/v1/runs`, `GET /api/v1/runs/:id`, `GET /api/v1/runs/:id/events`, `GET /api/v1/runs/:id/requests`, `POST /api/v1/runs/:id/replay`, `POST /api/v1/runs/:id/cancel`
- **Automatic Failure Minimization**:
  - `POST /api/v1/runs/:id/minimize` — validates options, enqueues minimization search, returns HTTP 202 Accepted.
  - `GET /api/v1/minimizations/:id` — retrieves current search status, minimized configuration, parameter reductions, and duration.
  - `GET /api/v1/minimizations/:id/attempts` — retrieves complete attempt history detailing each fault candidate evaluated, trial counts, and outcomes.
  - `POST /api/v1/minimizations/:id/cancel` — requests cancellation of an active search and cleanly restores proxy state.
- **Reports**: `GET /api/v1/runs/:id/report?format=json`, `GET /api/v1/runs/:id/report?format=markdown`
- **Documentation**: Swagger UI at `http://127.0.0.1:3100/docs`

---

## Prerequisites & Environment Configuration

### Prerequisites
- **Node.js LTS** (v20+, v22+, or v24+)
- **Docker Desktop for Windows** (running)

### Environment Files
- `apps/api/.env`:
  ```env
  API_PORT=3100
  HOST=127.0.0.1
  DATABASE_URL="file:./dev.db"
  CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
  ```
- `apps/web/.env`:
  ```env
  VITE_API_BASE_URL="http://127.0.0.1:3100"
  ```

---

## Quickstart & PowerShell Commands

### 1. Start Docker Containers
```powershell
npm run up
```

### 2. Initialize Backend Database
```powershell
npm run prisma:generate
npm run prisma:migrate
```

### 3. Start Backend & Frontend Together
In Terminal 1 (Fastify API):
```powershell
npm run dev:api
```
*(Listening at `http://127.0.0.1:3100`)*

In Terminal 2 (React Dashboard):
```powershell
npm run dev:web
```
*(Listening at `http://127.0.0.1:5173`)*

Open your browser to: **`http://127.0.0.1:5173`**

---

## Running Automated Tests

All test suites can be executed independently or together:

### 1. Run Complete Test Suite (Unit + API + Web)
Executes all 99 automated tests across all tiers:
```powershell
npm test
```

### 2. Failure Minimization & Backend API Integration Suite (Vitest)
Executes 43 tests in `apps/api/test/` covering baseline verification, component reduction delta-debugging, numeric binary search minimization, multi-trial verification policies, stochastic rate accounting, budget and deadline exhaustion, cancellation cleanup, proxy locking, and REST endpoints:
```powershell
npm run test:api
```

### 3. Frontend React Component, Chart & Client Tests (Vitest)
Executes 19 tests in `apps/web/test/` covering minimization API client calls, Button duplicate submission prevention, StatusBadge lifecycle styles, Recharts empty/populated states, and form validations:
```powershell
npm run test:web
```

### 4. Frontend Production Build & Type Check
```powershell
npm run typecheck:web
npm run build:web
```

### 5. Step 2 Toxiproxy Adapter Unit Tests
Executes 37 tests in `packages/toxiproxy/test/`:
```powershell
npm run test:unit
```

### 6. Live Step 1 & 2 Network Smoke Test
```powershell
npm run test:smoke
```

---

## Operational Safety & Limitations

1. **Local Test Target Whitelisting**: The dashboard only accepts probe paths targeting the verified local container (`/api/demo`, `/api/slow`, `/health`). Arbitrary external hostnames, shell commands, or raw IPs cannot be entered.
2. **Private Control API**: Port `8474` (Toxiproxy Control) is never called by the browser; all toxic mutations happen securely through the Fastify API.
3. **Bounded Polling**: TanStack Query polls active runs every 1 to 1.5 seconds and immediately disables interval polling when the run reaches `completed`, `failed`, or `cancelled`.
4. **Single Active Run Concurrency**: The backend prevents concurrent experiments against the same proxy to avoid contaminated latency measurements. The UI displays clear `409 Conflict` feedback if a collision is attempted.

---

## Troubleshooting Guide

### 1. "Unable to connect to NetReplay API"
- Ensure the API is running on port 3100 (`npm run dev:api`).
- Check `VITE_API_BASE_URL` in `apps/web/.env` is set to `http://127.0.0.1:3100`.

### 2. "CORS Error: Origin not allowed"
- The Fastify backend allows `http://localhost:5173` and `http://127.0.0.1:5173` by default. If using a custom port, add it to `CORS_ORIGINS` in `apps/api/.env`.

### 3. Toxiproxy Status Shows "Offline"
- Verify Docker Desktop is running: `docker compose ps`.
- Check port 8474 is bound: `curl.exe http://127.0.0.1:8474/version`.

---

## License

NetReplay is open-source under the MIT License.
Shopify Toxiproxy is licensed under the MIT License ([Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)).
