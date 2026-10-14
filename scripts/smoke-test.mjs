#!/usr/bin/env node
/**
 * NetReplay Smoke Test Script (Refactored for Step 2)
 *
 * Validates baseline connectivity and verifies network fault injection
 * using the reusable ToxiproxyAdapter package and deterministic test-target service.
 *
 * Execution flow:
 * 1. Pre-flight verification (target & Toxiproxy adapter checkHealth())
 * 2. Idempotent proxy provisioning via adapter.ensureProxy()
 * 3. Pre-test cleanup via adapter.removeFault()
 * 4. Phase 1: Baseline direct measurements (127.0.0.1:3000)
 * 5. Phase 2: Baseline proxy measurements without faults (127.0.0.1:8666)
 * 6. Fault injection via adapter.applyFault() (+500ms downstream latency)
 * 7. Phase 3: Fault-injected proxy measurements (127.0.0.1:8666)
 * 8. Statistical evaluation & delta threshold assertion (>= 300ms)
 * 9. Guaranteed cleanup in finally block via adapter.removeFault()
 */

import { performance } from 'node:perf_hooks';
import { ToxiproxyAdapter } from '../packages/toxiproxy/src/index.js';

// Environment-configurable addresses with stable local defaults
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3000';
const PROXY_URL = process.env.PROXY_URL || 'http://127.0.0.1:8666';
const CONTROL_URL = process.env.CONTROL_URL || 'http://127.0.0.1:8474';

const PROXY_NAME = 'netreplay-demo';
const TOXIC_NAME = 'latency_downstream';
const INJECTED_LATENCY_MS = 500;
const INJECTED_JITTER_MS = 0;
const SAMPLE_COUNT = 10;
const LATENCY_TOLERANCE_THRESHOLD_MS = 300; // Expected ~500ms, threshold 300ms
const REQUEST_TIMEOUT_MS = 5000;
const READINESS_TIMEOUT_MS = 15000;

// Initialize reusable Toxiproxy adapter with custom User-Agent
const adapter = new ToxiproxyAdapter({
  baseUrl: CONTROL_URL,
  userAgent: 'NetReplay-SmokeTest/1.0',
});

/**
 * Performs an HTTP fetch with a strict timeout and detailed error diagnostics.
 *
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [timeoutMs=REQUEST_TIMEOUT_MS]
 * @returns {Promise<Response>}
 */
async function timedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to '${url}' timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Failed to connect to '${url}': ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polls the test target health endpoint until ready or timeout expires.
 *
 * @param {string} url
 * @param {number} maxWaitMs
 */
async function waitForTargetReadiness(url, maxWaitMs = READINESS_TIMEOUT_MS) {
  const startTime = performance.now();
  process.stdout.write(`[*] Checking readiness for Test Target Server (${url})... `);

  while (performance.now() - startTime < maxWaitMs) {
    try {
      const res = await timedFetch(url, { method: 'GET' }, 1500);
      if (res.ok) {
        console.log(`[READY] (in ${Math.round(performance.now() - startTime)}ms)`);
        return;
      }
    } catch {
      // Endpoint not ready yet; wait and retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('[TIMEOUT]');
  throw new Error(
    `Readiness check timed out for Test Target (${url}) after ${maxWaitMs}ms.\n` +
    `Ensure Docker Compose is running: 'npm run up' or 'docker compose up -d'`
  );
}

/**
 * Polls Toxiproxy engine readiness via adapter.checkHealth().
 *
 * @param {number} maxWaitMs
 */
async function waitForAdapterReadiness(maxWaitMs = READINESS_TIMEOUT_MS) {
  const startTime = performance.now();
  process.stdout.write(`[*] Checking readiness for Toxiproxy Engine via Adapter (${CONTROL_URL})... `);

  while (performance.now() - startTime < maxWaitMs) {
    try {
      const health = await adapter.checkHealth();
      if (health.healthy) {
        console.log(`[READY] (v${health.version} in ${Math.round(performance.now() - startTime)}ms)`);
        return;
      }
    } catch {
      // Engine not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('[TIMEOUT]');
  throw new Error(
    `Readiness check timed out for Toxiproxy at ${CONTROL_URL} after ${maxWaitMs}ms.\n` +
    `Ensure Docker Compose is running: 'npm run up' or 'docker compose up -d'`
  );
}

/**
 * Computes descriptive statistics for an array of latency numbers.
 *
 * @param {number[]} latencies
 */
function computeStats(latencies) {
  if (latencies.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / sorted.length;

  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  return { min, max, mean, median };
}

/**
 * Executes a batch of HTTP requests and measures their elapsed round-trip duration.
 *
 * @param {string} phaseName
 * @param {string} baseUrl
 * @param {number} count
 * @param {string} reqPrefix
 */
async function executeMeasurementBatch(phaseName, baseUrl, count, reqPrefix) {
  console.log(`\n--- Phase: ${phaseName} (${count} requests) ---`);
  const timings = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 1; i <= count; i++) {
    const requestId = `${reqPrefix}-${String(i).padStart(2, '0')}`;
    const url = `${baseUrl}/api/demo?requestId=${requestId}`;

    const start = performance.now();
    try {
      const res = await timedFetch(url, { method: 'GET' }, REQUEST_TIMEOUT_MS);
      const elapsed = performance.now() - start;

      if (!res.ok) {
        failureCount++;
        console.log(`  [Req ${String(i).padStart(2, ' ')}/${count}] FAIL HTTP ${res.status} (${elapsed.toFixed(1)} ms)`);
        continue;
      }

      const body = await res.json();
      if (body.requestId !== requestId) {
        failureCount++;
        console.log(`  [Req ${String(i).padStart(2, ' ')}/${count}] FAIL requestId mismatch (${elapsed.toFixed(1)} ms)`);
        continue;
      }

      timings.push(elapsed);
      successCount++;
      console.log(`  [Req ${String(i).padStart(2, ' ')}/${count}] PASS ${elapsed.toFixed(1)} ms (id=${requestId})`);
    } catch (err) {
      const elapsed = performance.now() - start;
      failureCount++;
      console.log(`  [Req ${String(i).padStart(2, ' ')}/${count}] ERROR ${err.message} (${elapsed.toFixed(1)} ms)`);
    }
  }

  const stats = computeStats(timings);
  return {
    phaseName,
    count,
    successCount,
    failureCount,
    timings,
    stats,
  };
}

/**
 * Formats statistics nicely in a fixed-width row.
 */
function formatStatsRow(label, result) {
  const { stats, successCount, failureCount, count } = result;
  return (
    label.padEnd(28) +
    ` ${String(successCount + '/' + count).padStart(8)}` +
    ` ${stats.min.toFixed(1).padStart(10)} ms` +
    ` ${stats.median.toFixed(1).padStart(11)} ms` +
    ` ${stats.mean.toFixed(1).padStart(10)} ms` +
    ` ${stats.max.toFixed(1).padStart(10)} ms`
  );
}

/**
 * Main test orchestrator.
 */
async function main() {
  console.log('================================================================');
  console.log('        NetReplay Smoke Test (Powered by ToxiproxyAdapter)      ');
  console.log('================================================================');
  console.log(`Target Direct URL : ${TARGET_URL}`);
  console.log(`Toxiproxy Listener: ${PROXY_URL}`);
  console.log(`Toxiproxy Control : ${CONTROL_URL}`);
  console.log(`Sample Count      : ${SAMPLE_COUNT} requests per phase`);
  console.log(`Target Fault      : +${INJECTED_LATENCY_MS}ms downstream latency`);
  console.log('----------------------------------------------------------------');

  let directBaseline;
  let proxyBaseline;
  let faultProxyResult;
  let testPassed = false;
  let failureReason = '';

  try {
    // Step 1: Pre-flight readiness verification
    await waitForTargetReadiness(`${TARGET_URL}/health`);
    await waitForAdapterReadiness();

    // Step 2: Idempotent proxy configuration using ToxiproxyAdapter
    const proxy = await adapter.ensureProxy({
      name: PROXY_NAME,
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });
    console.log(`[+] Proxy '${proxy.name}' is verified: ${proxy.listen} -> ${proxy.upstream}`);

    // Step 3: Clean slate before baseline
    await adapter.removeFault(PROXY_NAME, TOXIC_NAME);

    // Step 4: Phase 1 - Direct target baseline measurement
    directBaseline = await executeMeasurementBatch(
      'Baseline Direct (No Proxy)',
      TARGET_URL,
      SAMPLE_COUNT,
      'direct'
    );

    // Step 5: Phase 2 - Proxy baseline measurement (without toxic)
    proxyBaseline = await executeMeasurementBatch(
      'Baseline Proxy (No Fault)',
      PROXY_URL,
      SAMPLE_COUNT,
      'proxy'
    );

    // Step 6: Inject fault using ToxiproxyAdapter
    console.log(`\n[*] Applying fault: adding ${INJECTED_LATENCY_MS}ms latency via ToxiproxyAdapter...`);
    const appliedToxic = await adapter.applyFault(PROXY_NAME, {
      name: TOXIC_NAME,
      type: 'latency',
      latencyMs: INJECTED_LATENCY_MS,
      jitterMs: INJECTED_JITTER_MS,
      stream: 'downstream',
    });
    console.log(`[+] Latency toxic '${appliedToxic.name}' applied (+${appliedToxic.attributes.latency}ms delay).`);

    // Step 7: Phase 3 - Proxy with injected latency
    faultProxyResult = await executeMeasurementBatch(
      `Proxy With Fault (+${INJECTED_LATENCY_MS}ms Latency)`,
      PROXY_URL,
      SAMPLE_COUNT,
      'fault'
    );

    // Step 8: Statistical evaluation
    console.log('\n================================================================');
    console.log('                     MEASUREMENT SUMMARY                        ');
    console.log('================================================================');
    console.log(
      'Phase'.padEnd(28) +
      ' Success'.padStart(9) +
      '       Min'.padStart(13) +
      '      Median'.padStart(14) +
      '      Mean'.padStart(13) +
      '       Max'.padStart(13)
    );
    console.log('-'.repeat(90));
    console.log(formatStatsRow('1. Direct Baseline', directBaseline));
    console.log(formatStatsRow('2. Proxy Baseline (Clean)', proxyBaseline));
    console.log(formatStatsRow('3. Proxy With Injected Fault', faultProxyResult));
    console.log('-'.repeat(90));

    // Comparative calculations
    const proxyBaselineMedian = proxyBaseline.stats.median;
    const faultProxyMedian = faultProxyResult.stats.median;
    const medianDelta = faultProxyMedian - proxyBaselineMedian;

    console.log(`Proxy Baseline Median      : ${proxyBaselineMedian.toFixed(2)} ms`);
    console.log(`Fault-Injected Median      : ${faultProxyMedian.toFixed(2)} ms`);
    console.log(`Observed Median Delta (Δ)  : +${medianDelta.toFixed(2)} ms`);
    console.log(`Expected Latency Addition  : ~${INJECTED_LATENCY_MS} ms`);
    console.log(`Acceptance Threshold (Min) : +${LATENCY_TOLERANCE_THRESHOLD_MS} ms`);
    console.log('----------------------------------------------------------------');

    // Assertions
    if (directBaseline.failureCount > 0) {
      failureReason = `Direct baseline had ${directBaseline.failureCount} failed requests.`;
    } else if (proxyBaseline.failureCount > 0) {
      failureReason = `Proxy clean baseline had ${proxyBaseline.failureCount} failed requests.`;
    } else if (faultProxyResult.failureCount > 0) {
      failureReason = `Fault-injected proxy phase had ${faultProxyResult.failureCount} failed requests.`;
    } else if (medianDelta < LATENCY_TOLERANCE_THRESHOLD_MS) {
      failureReason =
        `Observed latency delta (+${medianDelta.toFixed(1)} ms) is below the acceptance threshold (+${LATENCY_TOLERANCE_THRESHOLD_MS} ms).\n` +
        `The latency toxic did not increase response time sufficiently.`;
    } else {
      testPassed = true;
    }

    if (testPassed) {
      console.log('\n================================================================');
      console.log('  >>> RESULT: PASS - Network Fault Injection Confirmed! <<<');
      console.log('================================================================');
      console.log(
        `Verified that injecting ${INJECTED_LATENCY_MS}ms latency downstream produced ` +
        `an observed median latency increase of +${medianDelta.toFixed(1)}ms (threshold: >= ${LATENCY_TOLERANCE_THRESHOLD_MS}ms).`
      );
    } else {
      console.error('\n================================================================');
      console.error('  >>> RESULT: FAIL - Verification Assertion Failed <<<');
      console.error('================================================================');
      console.error(`Reason: ${failureReason}`);
    }
  } finally {
    // Step 9: Guaranteed cleanup in finally block using adapter
    console.log('\n[*] Cleaning up environment: removing latency toxic via adapter...');
    try {
      const removed = await adapter.removeFault(PROXY_NAME, TOXIC_NAME);
      if (removed) {
        console.log('[+] Latency toxic removed successfully. Environment restored to clean state.');
      } else {
        console.log('[*] Toxic was already removed.');
      }
    } catch (cleanupErr) {
      console.warn(`[!] Warning: Failed to clean up toxic '${TOXIC_NAME}': ${cleanupErr.message}`);
    }
  }

  process.exit(testPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
