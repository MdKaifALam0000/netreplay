# NetReplay — Network Failure Reproduction Platform

NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, and reliably replay complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository implements **Step 4: React Dashboard and Experiment Visualization**, building on the Step 1 Docker test target / Toxiproxy infrastructure, Step 2 reusable engine adapter, and Step 3 Fastify REST API & SQLite persistence.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 4 Adds](#what-step-4-adds)
3. [Dashboard Pages and Features](#dashboard-pages-and-features)
4. [Frontend Stack & Architecture](#frontend-stack--architecture)
5. [REST API Contract (`/api/v1`)](#rest-api-contract-apiv1)
6. [Prerequisites & Environment Configuration](#prerequisites--environment-configuration)
7. [Quickstart & PowerShell Commands](#quickstart--powershell-commands)
8. [Running Automated Tests](#running-automated-tests)
9. [Operational Safety & Limitations](#operational-safety--limitations)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [License](#license)

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

## What Step 4 Adds

1. **Modern Developer Dashboard (`apps/web`)**:
   - Dark developer-tool appearance (neutral `#09090b` surfaces, subtle `#27272a` borders, high-contrast typography).
   - Fully responsive layout with mobile drawer navigation, live system health pills, and toasts.
2. **Interactive Experiment Lifecycle**:
   - Create, list, edit, and safely delete experiment profiles.
   - Compose ad-hoc network faults (latency, timeout, bandwidth, reset) with live pre-run summary validation.
   - Real-time run execution tracking with bounded TanStack Query polling (polls only during active runs and immediately ceases upon completion/failure/cancellation).
3. **Rich Telemetry Visualization (Recharts)**:
   - **Request Latency Timeline**: Monotonic millisecond elapsed round-trip time per probe request with color-coded outcomes (green = success, amber = timeout, red = failure) and median reference line.
   - **Latency Bucket Distribution**: Histogram of request durations.
   - **Side-by-Side Comparison**: Overlay curves comparing reference baseline runs against fault-injected experiments.
4. **Report Exporting**:
   - One-click downloads for Markdown (`.md`) and JSON (`.json`) experiment reports directly from backend report endpoints.
5. **Architectural Safety**:
   - The browser never calls the Toxiproxy control API directly.
   - Fastify backend CORS is strictly whitelisted to local frontend origins (`http://localhost:5173`, `http://127.0.0.1:5173`).
   - Targets are restricted to whitelisted local endpoints (`/api/demo`, `/api/slow`, `/health`), rejecting arbitrary external URLs.

---

## Dashboard Pages and Features

| Page Route | Component | Key Features |
| :--- | :--- | :--- |
| `/` | `OverviewPage` | Live Toxiproxy (:8474) & Fastify (:3100) health cards, total profiles/runs stats, recent runs audit table, one-click quick profile launch. |
| `/profiles` | `ProfilesPage` | Searchable profile grid, tag filtering, profile creation/edit dialogs, delete confirmation with active-run safety checks, quick launch buttons. |
| `/experiments/new` | `ExperimentCreatePage` | Fault composer (latency, timeout, bandwidth, TCP reset), target whitelist selector, live pre-run summary preview, and immediate run scheduler. |
| `/runs` | `RunsPage` | Paginated historical runs table, status filtering (`queued`, `running`, `completed`, `failed`, `cancelled`), bounded polling, one-click snapshot replays, report downloads. |
| `/runs/:id` | `RunDetailsPage` | Live run status badge, median/mean/min/max metrics strip, Recharts latency timeline & distribution charts, request measurement table, lifecycle event log, snapshot inspector, cancel button with confirmation. |
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
```powershell
npm test
```

### 2. Frontend React Component & Chart Tests (Vitest)
Executes 18 tests in `apps/web/test/` covering API client error handling, Button duplicate submission prevention, StatusBadge lifecycle styles, Recharts empty/populated states, and form validations:
```powershell
npm run test:web
```

### 3. Frontend Production Build & Type Check
```powershell
npm run typecheck:web
npm run build:web
```

### 4. Backend API Integration Suite (Vitest)
```powershell
npm run test:api
```

### 5. Step 2 Toxiproxy Adapter Unit Tests
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
