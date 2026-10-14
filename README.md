# NetReplay — Step 1: Foundation and Network Fault Injection

NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, and reliably replay complex distributed system network faults (latency, packet loss, bandwidth throttles, socket drops, and connection timeouts).

This repository contains **Step 1: Foundation and Network Fault Injection**, providing a self-contained local Docker Compose environment that pairs a deterministic HTTP test service with Shopify's Toxiproxy engine.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [What Step 1 Implements vs. What is Deferred](#what-step-1-implements-vs-what-is-deferred)
3. [Prerequisites & Installation](#prerequisites--installation)
4. [Project Structure](#project-structure)
5. [Quickstart (Windows PowerShell)](#quickstart-windows-powershell)
6. [Service Endpoints & API Reference](#service-endpoints--api-reference)
7. [Inspecting Services and Logs](#inspecting-services-and-logs)
8. [Toxiproxy HTTP API Guide](#toxiproxy-http-api-guide)
9. [Running the Smoke Test](#running-the-smoke-test)
10. [Troubleshooting](#troubleshooting)
11. [Shutdown and Cleanup](#shutdown-and-cleanup)
12. [License & Third-Party Dependencies](#license--third-party-dependencies)

---

## Architecture Overview

```
                      +---------------------------------------------------+
                      |                   HOST MACHINE                    |
                      |                                                   |
                      |   [Developer Machine / PowerShell / Test Script]  |
                      +---------+------------------+------------------+---+
                                |                  |                  |
           Direct Baseline Req  |     Fault-Injected Proxy Req       | Control API
           (http://127.0.0.1:3000)   (http://127.0.0.1:8666)          | (http://127.0.0.1:8474)
                                |                  |                  |
+-------------------------------v------------------v------------------v---+
| DOCKER BRIDGE NETWORK (`netreplay-network`)                              |
|                                                                         |
|  +-------------------------+            +----------------------------+  |
|  |       toxiproxy         |            |        test-target         |  |
|  |                         |  TCP Fwd   |                            |  |
|  |  * Control: :8474       |----------->|  * Port: :3000             |  |
|  |  * Listener: :8666      |            |  * Healthcheck: /health    |  |
|  |  * Toxic: latency_down  |            |  * Endpoints: /api/demo    |  |
|  +-------------------------+            |               /api/slow    |  |
|                                         +----------------------------+  |
+-------------------------------------------------------------------------+
```

---

## What Step 1 Implements vs. What is Deferred

### Implemented in Step 1
- **Deterministic HTTP Test Target** (`services/test-target/server.js`):
  - Lightweight Node.js server built exclusively with built-in modules (`node:http`, `node:url`).
  - `/health` endpoint for Docker container readiness checks.
  - `/api/demo` endpoint returning deterministic JSON and reflecting `requestId`.
  - `/api/slow` endpoint simulating server-side processing delay with bounded input validation (`0` to `5000` ms).
  - Production containerization via Dockerfile (`node:22-alpine`) with unprivileged user `node`.
- **Toxiproxy Integration** (`docker-compose.yml`):
  - Pinned verified stable official image: `ghcr.io/shopify/toxiproxy:2.12.0`.
  - Control API isolated to host localhost `127.0.0.1:8474`.
  - Proxy listener exposed on host localhost `127.0.0.1:8666`.
  - Internal DNS routing from `toxiproxy` to `test-target:3000` over a private bridge network.
- **Automated Smoke Test** (`scripts/smoke-test.mjs`):
  - Pure ES module using Node.js built-in `fetch` and `performance.now()`.
  - Measures direct baseline (port 3000), proxy clean baseline (port 8666), and injected fault latency (port 8666 with +500ms downstream delay).
  - Compares median latencies and verifies that the injected fault increased response times beyond a 300ms threshold.
  - Guaranteed toxic cleanup in a `finally` block.
- **npm Convenience Scripts**:
  - `npm run up`, `npm run down`, `npm run logs`, `npm run test:smoke`, `npm run test:smoke:setup`.

### Deferred to Subsequent Steps
- Fastify application API and backend orchestration.
- SQLite database with Prisma ORM.
- React web dashboard and UI visualizations.
- User authentication and role-based access control.
- Experiment queue and distributed execution engine.
- Automated failure-minimization / delta-debugging algorithms.

---

## Prerequisites & Installation

Before running NetReplay, ensure you have the following installed on your system:

1. **Node.js (LTS v20+ or v22+)**
   - Download: [https://nodejs.org/](https://nodejs.org/)
   - Verify in PowerShell:
     ```powershell
     node --version
     npm --version
     ```
2. **Docker Desktop for Windows**
   - Download: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
   - Ensure Docker Desktop is launched and the Linux engine is running.
   - Verify in PowerShell:
     ```powershell
     docker --version
     docker compose version
     docker ps
     ```
3. **Git**
   - Download: [https://git-scm.com/](https://git-scm.com/)

---

## Project Structure

```
netreplay/
├── services/
│   └── test-target/
│       ├── package.json        # Test-target service metadata
│       ├── server.js           # Deterministic HTTP server (Node.js built-in)
│       └── Dockerfile          # Multi-stage production container definition
├── scripts/
│   └── smoke-test.mjs          # Automated fault injection verification script
├── docker-compose.yml          # Container topology (test-target + toxiproxy)
├── package.json                # Root automation scripts
├── .gitignore                  # Git ignore rules
├── .env.example                # Environment variable defaults
└── README.md                   # Complete documentation
```

---

## Quickstart (Windows PowerShell)

Open Windows PowerShell in the project directory:

```powershell
cd c:\Users\alamk\OneDrive\Desktop\netreplay
```

### 1. (Optional) Create .env from Example
```powershell
Copy-Item .env.example .env
```

### 2. Start the Environment
```powershell
npm run up
```
*(Equivalent to: `docker compose up -d --build`)*

This builds the `test-target` image, pulls `ghcr.io/shopify/toxiproxy:2.12.0`, and launches both services in the background.

### 3. Run the Network Fault Smoke Test
```powershell
npm run test:smoke
```
*(Equivalent to: `node scripts/smoke-test.mjs`)*

---

## Service Endpoints & API Reference

| Service | Host URL | Description |
| :--- | :--- | :--- |
| **Direct Test Target** | `http://127.0.0.1:3000` | Baseline test target without any proxy intervention. |
| **Toxiproxy Listener** | `http://127.0.0.1:8666` | Fault-injected proxy route (forwards to `test-target:3000`). |
| **Toxiproxy Control** | `http://127.0.0.1:8474` | Toxiproxy HTTP REST API for managing proxies and toxics. |

### Test Target Endpoints

#### 1. `GET /health`
Returns HTTP 200 indicating service health and uptime.
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/health"
```
**Sample Response:**
```json
{
  "status": "ok",
  "service": "test-target",
  "healthy": true,
  "uptimeSeconds": 42
}
```

#### 2. `GET /api/demo?requestId=<ID>`
Returns deterministic JSON echoing the optional request identifier.
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/demo?requestId=demo-101"
```
**Sample Response:**
```json
{
  "status": "ok",
  "service": "test-target",
  "message": "NetReplay deterministic test target response",
  "requestId": "demo-101",
  "timestamp": "2026-10-14T15:30:00.000Z",
  "_documentation": {
    "determinism": "Payload structure and message are deterministic across runs.",
    "nondeterministicFields": ["timestamp"],
    "description": "The timestamp field reflects server time for request inspection."
  }
}
```

#### 3. `GET /api/slow?delay=<MS>`
Simulates server-side application processing latency (bounded between `0` and `5000` ms).
```powershell
# Safe 200ms delay
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/slow?delay=200"

# Rejection when delay exceeds maximum allowed limit
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/slow?delay=9999" -SkipHttpErrorCheck
```

---

## Inspecting Services and Logs

### Check Running Containers
```powershell
docker compose ps
```

### View Live Aggregated Logs
```powershell
npm run logs
```
*(Press `Ctrl + C` to stop following logs).*

### View Specific Service Logs
```powershell
# Test-target logs only
docker compose logs -f test-target

# Toxiproxy logs only
docker compose logs -f toxiproxy
```

---

## Toxiproxy HTTP API Guide

Toxiproxy communicates via a JSON REST API on port `8474`.

> [!NOTE]
> **Windows PowerShell User-Agent Note**: Toxiproxy includes built-in anti-CSRF protection that blocks requests with browser-like user agents (e.g., headers starting with `Mozilla/`). Because Windows PowerShell 5.1 sends `Mozilla/5.0...` by default, always include `-UserAgent "NetReplay/1.0"` when calling `Invoke-RestMethod` on port 8474, or use `curl.exe`.

### 1. Check Toxiproxy Version
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8474/version" -UserAgent "NetReplay/1.0"
# Or using curl.exe:
curl.exe http://127.0.0.1:8474/version
```

### 2. List Configured Proxies
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies" -UserAgent "NetReplay/1.0" | ConvertTo-Json -Depth 4
# Or using curl.exe:
curl.exe http://127.0.0.1:8474/proxies
```

### 3. Create the Proxy (if not already created)
```powershell
$body = @{
    name = "netreplay-demo"
    listen = "0.0.0.0:8666"
    upstream = "test-target:3000"
    enabled = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies" -Method Post -Body $body -ContentType "application/json" -UserAgent "NetReplay/1.0"
```

### 4. Inject 500ms Downstream Latency
```powershell
$toxic = @{
    name = "latency_downstream"
    type = "latency"
    stream = "downstream"
    toxicity = 1.0
    attributes = @{
        latency = 500
        jitter = 0
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies/netreplay-demo/toxics" -Method Post -Body $toxic -ContentType "application/json" -UserAgent "NetReplay/1.0"
```

### 5. Remove the Latency Toxic
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies/netreplay-demo/toxics/latency_downstream" -Method Delete -UserAgent "NetReplay/1.0"
```


---

## Running the Smoke Test

Execute the automated smoke test:
```powershell
npm run test:smoke
```

### Expected Output
```text
================================================================
              NetReplay Network Fault Injection Test            
================================================================
Target Direct URL : http://127.0.0.1:3000
Toxiproxy Listener: http://127.0.0.1:8666
Toxiproxy Control : http://127.0.0.1:8474
Sample Count      : 10 requests per phase
Target Fault      : +500ms downstream latency
----------------------------------------------------------------
[*] Checking readiness for Test Target Server (http://127.0.0.1:3000/health)... [READY] (in 24ms)
[*] Checking readiness for Toxiproxy Engine (http://127.0.0.1:8474/version)... [READY] (in 8ms)
[+] Proxy 'netreplay-demo' is configured: [::]:8666 -> test-target:3000

--- Phase: Baseline Direct (No Proxy) (10 requests) ---
  [Req  1/10] PASS 3.2 ms (id=direct-01)
  [Req  2/10] PASS 1.8 ms (id=direct-02)
  ...
  [Req 10/10] PASS 1.5 ms (id=direct-10)

--- Phase: Baseline Proxy (No Fault) (10 requests) ---
  [Req  1/10] PASS 4.1 ms (id=proxy-01)
  [Req  2/10] PASS 2.5 ms (id=proxy-02)
  ...
  [Req 10/10] PASS 2.2 ms (id=proxy-10)

[*] Applying fault: adding 500ms latency toxic via Toxiproxy API...
[+] Latency toxic 'latency_downstream' injected: +500ms downstream delay.

--- Phase: Proxy With Fault (+500ms Latency) (10 requests) ---
  [Req  1/10] PASS 504.8 ms (id=fault-01)
  [Req  2/10] PASS 502.1 ms (id=fault-02)
  ...
  [Req 10/10] PASS 503.4 ms (id=fault-10)

================================================================
                     MEASUREMENT SUMMARY                        
================================================================
Phase                         Success           Min         Median          Mean           Max
------------------------------------------------------------------------------------------
1. Direct Baseline              10/10       1.5 ms         1.9 ms        2.1 ms        3.2 ms
2. Proxy Baseline (Clean)       10/10       2.1 ms         2.5 ms        2.7 ms        4.1 ms
3. Proxy With Injected Fault    10/10     501.8 ms       503.2 ms      503.4 ms      506.1 ms
------------------------------------------------------------------------------------------
Proxy Baseline Median      : 2.50 ms
Fault-Injected Median      : 503.20 ms
Observed Median Delta (Δ)  : +500.70 ms
Expected Latency Addition  : ~500 ms
Acceptance Threshold (Min) : +300 ms
------------------------------------------------------------------------------------------

================================================================
  >>> RESULT: PASS - Network Fault Injection Confirmed! <<<
================================================================
Verified that injecting 500ms latency downstream produced an observed median latency increase of +500.7ms (threshold: >= 300ms).

[*] Cleaning up environment: removing latency toxic...
[+] Latency toxic removed successfully. Environment restored to clean state.
```

---

## Troubleshooting

### 1. `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`
- **Cause**: Docker Desktop is installed on Windows but is not currently running.
- **Fix**: Open the **Docker Desktop** application from the Windows Start menu. Wait until the status in the bottom left indicates "Engine running" before re-running `npm run up`.

### 2. Port Conflict (`Bind for 0.0.0.0:3000 failed: port is already allocated`)
- **Cause**: Another local process (e.g., a dev server) is using port 3000, 8474, or 8666.
- **Fix**:
  1. Identify the conflicting process in PowerShell:
     ```powershell
     Get-NetTCPConnection -LocalPort 3000, 8474, 8666 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess
     ```
  2. Or override ports in your `.env` file:
     ```env
     TEST_TARGET_PORT=3001
     TOXIPROXY_CONTROL_PORT=8475
     TOXIPROXY_LISTEN_PORT=8667
     ```

### 3. Toxic Left Active After Interrupted Test
- **Cause**: The test script was force-killed (`Ctrl+C`) before the `finally` block completed.
- **Fix**: Reset Toxiproxy back to clean state:
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:8474/reset" -Method Post
  ```
  *(The `POST /reset` endpoint removes all toxics and reenables all proxies).*

### 4. `The underlying connection was closed: The connection was closed unexpectedly` (Port 8666)
- **Cause**: Port 8666 is the Toxiproxy fault listener. When Toxiproxy first boots, it starts with an empty proxy list. Nothing listens on port 8666 until the `netreplay-demo` proxy is registered.
- **Fix**: Run the smoke test or create the proxy once via the Toxiproxy API:
  ```powershell
  npm run test:smoke
  ```
  After `smoke-test.mjs` runs, `netreplay-demo` is registered and `http://127.0.0.1:8666` routes to `test-target:3000`.

### 5. `Invoke-RestMethod : User agent not allowed` (Port 8474)
- **Cause**: Toxiproxy includes built-in anti-CSRF protection that blocks browser user-agents (e.g. `Mozilla/5.0...`). Windows PowerShell 5.1 sends a `Mozilla/5.0...` user agent by default.
- **Fix**: Provide a custom user-agent flag or use `curl.exe`:
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies" -UserAgent "NetReplay/1.0"
  # Or:
  curl.exe http://127.0.0.1:8474/proxies
  ```

### 6. Container Unhealthy / Startup Timeout
- Check service health status:
  ```powershell
  docker compose ps
  ```
- View container logs for errors:
  ```powershell
  docker compose logs test-target
  ```


---

## Shutdown and Cleanup

To stop and remove containers and networks created by Docker Compose:

```powershell
npm run down
```
*(Equivalent to: `docker compose down`)*

To also remove any built container images:
```powershell
docker compose down --rmi local
```

---

## License & Third-Party Dependencies

- **NetReplay**: Open-source under the MIT License.
- **Shopify Toxiproxy**: Open-source framework developed by Shopify under the MIT License ([https://github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)). Pinned Docker image: `ghcr.io/shopify/toxiproxy:2.12.0`.
- **Node.js**: Open-source runtime governed by the Node.js Foundation ([https://nodejs.org](https://nodejs.org)).
