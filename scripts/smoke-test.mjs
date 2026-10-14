#!/usr/bin/env node
/**
 * NetReplay Smoke Test Script
 *
 * Validates baseline connectivity and verifies network fault injection
 * using Shopify Toxiproxy and the deterministic test-target service.
 *
 * Execution flow:
 * 1. Pre-flight verification (test-target & toxiproxy control API readiness)
 * 2. Idempotent proxy configuration ('netreplay-demo' -> 'test-target:3000')
 * 3. Pre-test cleanup (removes any existing toxics)
 * 4. Baseline direct measurements (Direct target: 127.0.0.1:3000)
 * 5. Baseline proxy measurements (Toxiproxy: 127.0.0.1:8666, no fault)
 * 6. Fault injection (500ms downstream latency via Toxiproxy API)
 * 7. Fault-injected proxy measurements (Toxiproxy: 127.0.0.1:8666)
 * 8. Statistical evaluation & assertion (Median delta >= 300ms)
 * 9. Finally block cleanup (guaranteed toxic removal)
 */

import { performance } from 'node:perf_hooks';

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
 * Polls an HTTP endpoint until it responds with HTTP 200 or timeout expires.
 *
 * @param {string} name
 * @param {string} url
 * @param {number} maxWaitMs
 */
async function waitForReadiness(name, url, maxWaitMs = READINESS_TIMEOUT_MS) {
  const startTime = performance.now();
  process.stdout.write(`[*] Checking readiness for ${name} (${url})... `);

  while (performance.now() - startTime < maxWaitMs) {
    try {
      const res = await timedFetch(url, { method: 'GET' }, 1500);
      if (res.ok) {
        console.log(`[READY] (in ${Math.round(performance.now() - startTime)}ms)`);
        return;
      }
    } catch {
      // Endpoint not ready yet; back off briefly
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('[TIMEOUT]');
  throw new Error(
    `Readiness check timed out for ${name} (${url}) after ${maxWaitMs}ms.\n` +
    `Ensure Docker Compose is running: 'npm run up' or 'docker compose up -d'`
  );
}

/**
 * Ensures the Toxiproxy proxy exists and points to test-target:3000.
 * Idempotent: creates if missing, updates if modified, preserves if intact.
 */
async function ensureProxyConfigured() {
  const checkUrl = `${CONTROL_URL}/proxies/${PROXY_NAME}`;
  const res = await timedFetch(checkUrl, { method: 'GET' }, 2000);

  if (res.status === 200) {
    const data = await res.json();
    if (!data.enabled) {
      console.log(`[*] Proxy '${PROXY_NAME}' is currently disabled. Enabling it...`);
      const enableRes = await timedFetch(checkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      if (!enableRes.ok) {
        throw new Error(`Failed to enable proxy '${PROXY_NAME}': HTTP ${enableRes.status}`);
      }
    }
    console.log(`[+] Proxy '${PROXY_NAME}' is configured: ${data.listen} -> ${data.upstream}`);
    return;
  }

  if (res.status === 404) {
    console.log(`[*] Proxy '${PROXY_NAME}' does not exist. Creating proxy...`);
    const createUrl = `${CONTROL_URL}/proxies`;
    const payload = {
      name: PROXY_NAME,
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    };

    const createRes = await timedFetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create proxy '${PROXY_NAME}': HTTP ${createRes.status} - ${errText}`);
    }

    const created = await createRes.json();
    console.log(`[+] Proxy '${PROXY_NAME}' created successfully: ${created.listen} -> ${created.upstream}`);
    return;
  }

  throw new Error(`Unexpected status checking proxy '${PROXY_NAME}': HTTP ${res.status}`);
}

/**
 * Removes the latency toxic from the proxy if present.
 * Idempotent: succeeds whether the toxic was active or not.
 */
async function removeLatencyToxic() {
  const toxicUrl = `${CONTROL_URL}/proxies/${PROXY_NAME}/toxics/${TOXIC_NAME}`;
  try {
    const res = await timedFetch(toxicUrl, { method: 'DELETE' }, 2000);
    if (res.status === 200 || res.status === 204 || res.status === 404) {
      return true;
    }
    console.warn(`[!] Warning: Unexpected status while removing toxic: HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.warn(`[!] Warning: Failed to remove toxic '${TOXIC_NAME}': ${err.message}`);
    return false;
  }
}

/**
 * Injects a downstream latency toxic via the Toxiproxy HTTP API.
 *
 * @param {number} latencyMs
 * @param {number} jitterMs
 */
async function injectLatencyToxic(latencyMs = INJECTED_LATENCY_MS, jitterMs = INJECTED_JITTER_MS) {
  const toxicUrl = `${CONTROL_URL}/proxies/${PROXY_NAME}/toxics`;
  const payload = {
    name: TOXIC_NAME,
    type: 'latency',
    stream: 'downstream',
    toxicity: 1.0,
    attributes: {
      latency: latencyMs,
      jitter: jitterMs,
    },
  };

  const res = await timedFetch(toxicUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Failed to inject latency toxic via Toxiproxy API: HTTP ${res.status}\n` +
      `Response: ${errText}`
    );
  }

  const toxic = await res.json();
  console.log(`[+] Latency toxic '${toxic.name}' injected: +${toxic.attributes.latency}ms downstream delay.`);
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
  console.log('              NetReplay Network Fault Injection Test            ');
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
    await waitForReadiness('Test Target Server', `${TARGET_URL}/health`);
    await waitForReadiness('Toxiproxy Engine', `${CONTROL_URL}/version`);

    // Step 2: Idempotent proxy configuration
    await ensureProxyConfigured();

    // Step 3: Ensure clean slate (no toxics before baseline)
    await removeLatencyToxic();

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

    // Step 6: Inject fault
    console.log(`\n[*] Applying fault: adding ${INJECTED_LATENCY_MS}ms latency toxic via Toxiproxy API...`);
    await injectLatencyToxic(INJECTED_LATENCY_MS, INJECTED_JITTER_MS);

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
    // Step 9: Guaranteed cleanup in finally block
    console.log('\n[*] Cleaning up environment: removing latency toxic...');
    const cleaned = await removeLatencyToxic();
    if (cleaned) {
      console.log('[+] Latency toxic removed successfully. Environment restored to clean state.');
    } else {
      console.warn('[!] Note: Toxic was already removed or could not be contacted.');
    }
  }

  process.exit(testPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
