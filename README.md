# NetReplay — Step 2: Reusable Toxiproxy Engine Adapter

NetReplay is an open-source network failure reproduction platform designed to help engineers simulate, capture, and reliably replay complex distributed system network faults (latency, packet drops, bandwidth throttles, TCP connection resets, and timeouts).

This repository contains **Step 2: Reusable Toxiproxy Engine Adapter**, building upon the Step 1 infrastructure with a typed, modular, and resilient JavaScript ES module adapter located in `packages/toxiproxy/`.

---

## Table of Contents

1. [Architecture & Topology](#architecture--topology)
2. [What Step 2 Adds & Architecture Decisions](#what-step-2-adds--architecture-decisions)
3. [Control API (:8474) vs. Traffic Proxy Listener (:8666)](#control-api-8474-vs-traffic-proxy-listener-8666)
4. [Toxiproxy Adapter API & Code Examples](#toxiproxy-adapter-api--code-examples)
5. [Supported Fault Types & Schemas](#supported-fault-types--schemas)
6. [Prerequisites & Quickstart](#prerequisites--quickstart)
7. [Running Tests (Unit, Integration, Smoke)](#running-tests-unit-integration-smoke)
8. [Manual Inspection & Verification](#manual-inspection--verification)
9. [Diagnosing Port Failures & Troubleshooting](#diagnosing-port-failures--troubleshooting)
10. [Known Limitations (TCP Proxy vs. Linux tc-netem)](#known-limitations-tcp-proxy-vs-linux-tc-netem)
11. [Shutdown and Cleanup](#shutdown-and-cleanup)
12. [License & Third-Party Notes](#license--third-party-notes)

---

## Architecture & Topology

```
+-------------------------------------------------------------------------+
|                              HOST MACHINE                               |
|                                                                         |
|    [Node.js Runtime / Scripts / Tests / Fastify Service (Step 3)]       |
|                                  |                                      |
|    +-----------------------------v---------------------------------+    |
|    |           packages/toxiproxy (ToxiproxyAdapter)               |    |
|    |                                                               |    |
|    |  * validation.js  (Strict schema & parameter bounds checks)   |    |
|    |  * client.js      (Typed HTTP REST client with AbortSignal)   |    |
|    |  * adapter.js     (ensureProxy, applyFault, withFault)        |    |
|    |  * errors.js      (Actionable typed error hierarchy)          |    |
|    +------------------+------------------------------+-------------+    |
+-----------------------|------------------------------|------------------+
                        |                              |
      HTTP Control API  |          Proxied Traffic     | Direct Baseline
      (:8474)           |          (:8666)             | (:3000)
                        |                              |
+-----------------------v------------------------------v------------------+
| DOCKER BRIDGE NETWORK (`netreplay-network`)                             |
|                                                                         |
|  +-------------------------+            +----------------------------+  |
|  |   netreplay-toxiproxy   |            |   netreplay-test-target    |  |
|  |                         |  TCP Fwd   |                            |  |
|  |  * Control API: :8474   |----------->|  * Port: :3000             |  |
|  |  * Listener: :8666      |            |  * Healthcheck: /health    |  |
|  |  * Toxics: latency, etc.|            |  * Endpoints: /api/demo    |  |
|  +-------------------------+            |               /api/slow    |  |
|                                         +----------------------------+  |
+-------------------------------------------------------------------------+
```

---

## What Step 2 Adds & Architecture Decisions

1. **Modular Engine Adapter (`packages/toxiproxy/`)**:
   - `client.js`: Low-level, typed HTTP client communicating with Shopify Toxiproxy v2 REST API using Node.js built-in `fetch` and `AbortController`.
   - `adapter.js`: Domain orchestrator providing idempotent proxy management (`ensureProxy`), scoped fault lifecycles (`withFault`), and targeted fault cleanup (`clearFaults`).
   - `validation.js`: Schema validation and parameter bounds checking enforcing safe, bounded fault values.
   - `errors.js`: Actionable, typed error hierarchy (`ToxiproxyValidationError`, `ToxiproxyNotFoundError`, `ToxiproxyConflictError`, `ToxiproxyTimeoutError`, `ToxiproxyConnectionError`, `ToxiproxyCleanupError`).
2. **Anti-CSRF User-Agent Handling**:
   - Toxiproxy v2 automatically rejects requests whose `User-Agent` starts with `Mozilla/` (`403 Forbidden: User agent not allowed`). The adapter and client consistently inject a non-browser header (`NetReplay-EngineAdapter/1.0`).
3. **Scoped Fault Isolation (`withFault`)**:
   - Rather than globally resetting the engine or leaving stray toxics behind on failure, `adapter.withFault()` guarantees toxic cleanup in a `finally` block, coordinating both callback errors and cleanup errors without masking either.
4. **Refactored Smoke Test**:
   - `scripts/smoke-test.mjs` was refactored to use `ToxiproxyAdapter`, maintaining deterministic measurements while eliminating duplicated HTTP logic.

---

## Control API (:8474) vs. Traffic Proxy Listener (:8666)

Understanding the distinction between these two ports is critical when operating NetReplay:

| Characteristic | Control API (`:8474`) | Traffic Proxy Listener (`:8666`) |
| :--- | :--- | :--- |
| **Protocol** | HTTP (JSON REST API) | Raw TCP Stream (forwards to `test-target:3000`) |
| **Purpose** | Inspecting engine, configuring proxies, injecting toxics | Sending application requests to measure fault impact |
| **Initial State** | Immediately open upon Toxiproxy container boot | **Closed** until `ensureProxy` creates `netreplay-demo` |
| **User-Agent Requirement** | Rejects `Mozilla/*` (requires non-browser header) | Standard HTTP headers passed transparently |
| **Client** | `ToxiproxyClient` / `ToxiproxyAdapter` / `curl` | Browser / Test runner / Application client |

---

## Toxiproxy Adapter API & Code Examples

### Example 1: Basic Fault Injection and Manual Removal

```javascript
import { ToxiproxyAdapter } from './packages/toxiproxy/src/index.js';

const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474' });

// 1. Verify engine health
const health = await adapter.checkHealth();
console.log(`Connected to Toxiproxy v${health.version}`);

// 2. Ensure proxy exists and routes traffic (idempotent)
await adapter.ensureProxy({
  name: 'netreplay-demo',
  listen: '0.0.0.0:8666',
  upstream: 'test-target:3000',
  enabled: true,
});

// 3. Apply a 500ms downstream latency fault
await adapter.applyFault('netreplay-demo', {
  name: 'custom_latency',
  type: 'latency',
  latencyMs: 500,
  jitterMs: 50,
  stream: 'downstream',
});

// ... perform tests through http://127.0.0.1:8666 ...

// 4. Remove the fault when finished
await adapter.removeFault('netreplay-demo', 'custom_latency');
```

### Example 2: Scoped Execution with Cleanup Guarantee (`withFault`)

`withFault` applies the fault, executes your asynchronous callback, and guarantees toxic removal in a `finally` block even if the callback throws an error:

```javascript
import { ToxiproxyAdapter } from './packages/toxiproxy/src/index.js';

const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474' });

await adapter.withFault(
  'netreplay-demo',
  {
    type: 'latency',
    latencyMs: 1000,
    stream: 'downstream',
  },
  async () => {
    // Traffic sent through http://127.0.0.1:8666 will now experience +1000ms delay
    const start = performance.now();
    const res = await fetch('http://127.0.0.1:8666/api/demo');
    const elapsed = performance.now() - start;
    console.log(`Observed response time under fault: ${elapsed.toFixed(1)}ms`);

    // Even if an assertion throws here, the fault is GUARANTEED to be removed
    if (!res.ok) {
      throw new Error('Endpoint returned error status');
    }
  }
);
// Fault is cleanly removed at this point
```

---

## Supported Fault Types & Schemas

NetReplay maps internal fault declarations to Toxiproxy toxic definitions with strict validation:

### 1. `latency`
Adds transmission delay to packets.
- `latencyMs` (*integer, 0 to 60,000*): Milliseconds of added delay.
- `jitterMs` (*integer, 0 to 30,000, default: 0*): Milliseconds of randomized variance ($\pm \text{jitter}$).
- `stream` (*string, "upstream" or "downstream", default: "downstream"*): Link direction to affect.
- `toxicity` (*number, 0.0 to 1.0, default: 1.0*): Probability that packets are delayed.

### 2. `timeout`
Stalls all connection data and closes the TCP socket after the specified timeout.
- `timeoutMs` (*integer, 0 to 60,000*): Delay in milliseconds before closing connection. If `0`, connection stalls indefinitely without closing until toxic is removed.
- `stream` (*string, default: "downstream"*): Direction.
- `toxicity` (*number, default: 1.0*): Probability.

> [!NOTE]
> **Timeout vs. Client Request Deadline**: Toxiproxy's timeout toxic simulates connection transport stalling and delayed socket closure. This is distinct from an HTTP client's `AbortSignal` timeout, which is enforced locally on the caller.

### 3. `bandwidth`
Throttles connection throughput.
- `rateKbps` (*integer, 1 to 1,000,000*): Maximum rate in kilobytes per second.
- `stream` (*string, default: "downstream"*): Direction.
- `toxicity` (*number, default: 1.0*): Probability.

### 4. `reset` / `reset_peer`
Simulates sudden connection termination by issuing a TCP `RST` (connection reset by peer) without performing a standard TCP `FIN` handshake.
- `stream` (*string, default: "downstream"*): Direction.
- `toxicity` (*number, default: 1.0*): Probability.

---

## Prerequisites & Quickstart

### Prerequisites
- Node.js LTS (v20+ or v22+)
- Docker Desktop for Windows (running)

### Start Docker Containers
```powershell
npm run up
```
*(Runs `docker compose up -d --build`)*

Verify services are running:
```powershell
docker compose ps
```

---

## Running Tests (Unit, Integration, Smoke)

### 1. Unit Tests (Isolated, No Docker Required)
Runs 37 offline unit tests with mock fetch dispatchers testing URL validation, schema checking, bounds enforcement, error mapping, and `withFault` cleanup:
```powershell
npm run test:unit
```

### 2. Live Integration Tests (Requires Running Docker)
Runs live integration tests against the active Toxiproxy engine on `127.0.0.1:8474`:
```powershell
npm run test:integration
```

### 3. Smoke Test (End-to-End Fault Verification)
Runs the end-to-end smoke test measuring direct baseline, clean proxy baseline, and 500ms injected latency:
```powershell
npm run test:smoke
```

---

## Manual Inspection & Verification

### PowerShell Session Setup
To avoid typing `-UserAgent` on every manual request, configure PowerShell's default parameter values:
```powershell
$PSDefaultParameterValues['Invoke-RestMethod:UserAgent'] = 'NetReplay/1.0'
```

### Check Version & Configured Proxies
```powershell
# Version check
Invoke-RestMethod -Uri "http://127.0.0.1:8474/version"

# Inspect active proxies
Invoke-RestMethod -Uri "http://127.0.0.1:8474/proxies" | ConvertTo-Json -Depth 5
```

### Send Request Through Proxy
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8666/api/demo?requestId=test-01"
```

---

## Diagnosing Port Failures & Troubleshooting

### Problem 1: `The connection was closed unexpectedly` on Port 8666
- **Diagnosis**: Port 8666 is the proxy traffic port. When Toxiproxy first boots, it has an empty proxy list. Nothing is bound to container port 8666 until `ensureProxy` creates `netreplay-demo`.
- **Resolution**: Run `npm run test:smoke` or call `adapter.ensureProxy(...)` once to register the route.

### Problem 2: `Invoke-RestMethod : User agent not allowed` on Port 8474
- **Diagnosis**: Toxiproxy includes anti-CSRF protection that blocks user-agents starting with `Mozilla/`. Windows PowerShell 5.1 sends `Mozilla/5.0...` by default.
- **Resolution**: Run `$PSDefaultParameterValues['Invoke-RestMethod:UserAgent'] = 'NetReplay/1.0'` or use `curl.exe`.

### Problem 3: Stray Toxic Left Behind After Interrupted Process
- **Diagnosis**: An experiment was forcefully killed (`Ctrl + C`) before cleanup completed.
- **Resolution**: Clear toxics on the proxy without resetting other proxies:
  ```powershell
  # Using curl:
  curl.exe -X DELETE -H "User-Agent: NetReplay/1.0" http://127.0.0.1:8474/proxies/netreplay-demo/toxics/latency_downstream
  
  # Or perform a complete engine reset:
  curl.exe -X POST -H "User-Agent: NetReplay/1.0" http://127.0.0.1:8474/reset
  ```

---

## Known Limitations (TCP Proxy vs. Linux tc-netem)

NetReplay Step 2 uses Toxiproxy, which operates as an **application-layer TCP proxy**:
1. **L7/L4 Stream Manipulation**: Toxiproxy buffers and delays application byte streams over established TCP connections.
2. **Not Kernel Packet Emulation**: It does not modify kernel routing tables or execute Linux `tc` (Traffic Control) `netem` queueing disciplines. Low-level ICMP drops, MTU fragmentation, and out-of-order IP packet reordering at the kernel network interface level require Linux privileges (`CAP_NET_ADMIN`) and are not simulated by Toxiproxy.
3. **Connection Drops vs. Silent Packet Blackholes**: A Toxiproxy `reset` sends an immediate TCP `RST` segment. Simulating a silent network partition (where packets are silently dropped without RST or FIN) can be achieved using the `timeout` toxic with `timeout: 0`.

---

## Shutdown and Cleanup

To tear down all containers and networks:
```powershell
npm run down
```

---

## License & Third-Party Notes

- **NetReplay**: Open-source under the MIT License.
- **Shopify Toxiproxy**: Official open-source project by Shopify under the MIT License ([https://github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy)). Container image pinned: `ghcr.io/shopify/toxiproxy:2.12.0`.
- **Node.js**: Distributed under the Node.js open-source license ([https://nodejs.org](https://nodejs.org)).
