// @ts-check
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../apps/api/dist/app.js';
import { prisma } from '../apps/api/dist/services/db.js';
import { ToxiproxyAdapter } from '../packages/toxiproxy/src/index.js';

async function runCompleteE2EJourney() {
  console.log('================================================================');
  console.log('    NetReplay Step 7 — Complete End-to-End Validation Journey   ');
  console.log('================================================================\n');

  const TOXIPROXY_CONTROL = process.env.TOXIPROXY_CONTROL_URL || 'http://127.0.0.1:8474';
  const TARGET_DIRECT = process.env.TEST_TARGET_DIRECT_URL || 'http://127.0.0.1:3000';
  const TARGET_PROXY = process.env.TEST_TARGET_PROXY_URL || 'http://127.0.0.1:8666';
  const PROXY_NAME = process.env.TOXIPROXY_PROXY_NAME || 'netreplay-demo';

  // --------------------------------------------------------------------------
  // Stage 1: Low-Level Engine & Test Target Verification
  // --------------------------------------------------------------------------
  console.log('[1/14] Verifying Test Target and Toxiproxy readiness...');
  const adapter = new ToxiproxyAdapter({ baseUrl: TOXIPROXY_CONTROL, userAgent: 'NetReplay-E2E/1.0' });
  const engineHealth = await adapter.checkHealth();
  assert.equal(engineHealth.healthy, true, 'Toxiproxy engine must be healthy');
  console.log(`  ✔ Toxiproxy engine is reachable (v${engineHealth.version || 'unknown'})`);

  const targetHealthRes = await fetch(`${TARGET_DIRECT}/health`);
  assert.equal(targetHealthRes.status, 200, 'Test target /health must return 200');
  console.log('  ✔ Test target /health is responding (200 OK)');

  // Verify proxy exists and is clean
  await adapter.ensureProxy({
    name: PROXY_NAME,
    listen: '0.0.0.0:8666',
    upstream: 'test-target:3000',
    enabled: true,
  });
  await adapter.clearFaults(PROXY_NAME);
  console.log(`  ✔ Proxy '${PROXY_NAME}' ensured and cleared of faults`);

  // --------------------------------------------------------------------------
  // Stage 2: Direct Baseline vs Clean Proxy Measurements
  // --------------------------------------------------------------------------
  console.log('\n[2/14] Measuring Direct Baseline vs Clean Proxy latencies...');
  const directStart = performance.now();
  const directRes = await fetch(`${TARGET_DIRECT}/api/demo`);
  const directDuration = performance.now() - directStart;
  assert.equal(directRes.status, 200);
  console.log(`  ✔ Direct baseline request: 200 OK (${directDuration.toFixed(2)}ms)`);

  const cleanStart = performance.now();
  const cleanRes = await fetch(`${TARGET_PROXY}/api/demo`);
  const cleanDuration = performance.now() - cleanStart;
  assert.equal(cleanRes.status, 200);
  console.log(`  ✔ Clean proxy request: 200 OK (${cleanDuration.toFixed(2)}ms)`);

  // --------------------------------------------------------------------------
  // Stage 3: Low-Level Fault Injection & Cleanup Verification
  // --------------------------------------------------------------------------
  console.log('\n[3/14] Testing Adapter Fault Injection (+200ms) & Guaranteed Cleanup...');
  await adapter.applyFault(PROXY_NAME, {
    type: 'latency',
    name: 'e2e_test_latency',
    latencyMs: 200,
    jitterMs: 0,
    stream: 'downstream',
    toxicity: 1.0,
  });

  const faultStart = performance.now();
  const faultRes = await fetch(`${TARGET_PROXY}/api/demo`);
  const faultDuration = performance.now() - faultStart;
  assert.equal(faultRes.status, 200);
  assert.ok(faultDuration >= 180, `Faulted latency (${faultDuration.toFixed(2)}ms) should reflect +200ms injection`);
  console.log(`  ✔ Fault-injected proxy request: 200 OK (${faultDuration.toFixed(2)}ms - delta: +${(faultDuration - cleanDuration).toFixed(2)}ms)`);

  // Cleanup fault
  const clearedCount = await adapter.clearFaults(PROXY_NAME);
  assert.ok(clearedCount >= 1, 'clearFaults must remove active toxic');

  // Verify state restored
  const postCleanStart = performance.now();
  const postCleanRes = await fetch(`${TARGET_PROXY}/api/demo`);
  const postCleanDuration = performance.now() - postCleanStart;
  assert.equal(postCleanRes.status, 200);
  assert.ok(postCleanDuration < 100, `Post-cleanup latency (${postCleanDuration.toFixed(2)}ms) should return to baseline`);
  console.log(`  ✔ Clean baseline verified after fault removal (${postCleanDuration.toFixed(2)}ms)`);

  // --------------------------------------------------------------------------
  // Stage 4: Enhanced Test Target Endpoints (/ok, /slow, /status, /large)
  // --------------------------------------------------------------------------
  console.log('\n[4/14] Testing Enhanced Deterministic Target Endpoints...');
  const okRes = await fetch(`${TARGET_DIRECT}/ok`);
  assert.equal(okRes.status, 200);
  console.log('  ✔ GET /ok -> 200 OK (deterministic response)');

  const slowRes = await fetch(`${TARGET_DIRECT}/slow?ms=150`);
  assert.equal(slowRes.status, 200);
  const slowJson = await slowRes.json();
  assert.equal(slowJson.simulatedDelayMs, 150);
  console.log('  ✔ GET /slow?ms=150 -> 200 OK (150ms simulated application delay)');

  const statusRes = await fetch(`${TARGET_DIRECT}/status/503`);
  assert.equal(statusRes.status, 503);
  console.log('  ✔ GET /status/503 -> 503 Service Unavailable (controlled status code)');

  const largeRes = await fetch(`${TARGET_DIRECT}/large?sizeKb=32`);
  assert.equal(largeRes.status, 200);
  const largeJson = await largeRes.json();
  assert.equal(largeJson.sizeBytes, 32768);
  console.log('  ✔ GET /large?sizeKb=32 -> 200 OK (32,768 bytes bounded throughput payload)');

  // --------------------------------------------------------------------------
  // Stage 5: Booting Fastify API Application
  // --------------------------------------------------------------------------
  console.log('\n[5/14] Booting Fastify API Application with TypeProvider & Prisma...');
  const app = await buildApp({ logger: false });
  await app.ready();
  console.log('  ✔ Fastify REST API ready and plugins registered');

  try {
    // ------------------------------------------------------------------------
    // Stage 6: Health & Swagger OpenAPI Spec Validation
    // ------------------------------------------------------------------------
    console.log('\n[6/14] Testing Health, Engines & OpenAPI documentation...');
    const livenessRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(livenessRes.statusCode, 200);
    assert.equal(livenessRes.json().status, 'ok');

    const readinessRes = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(readinessRes.statusCode, 200);
    assert.equal(readinessRes.json().database, 'connected');

    const enginesRes = await app.inject({ method: 'GET', url: '/api/v1/engines' });
    assert.equal(enginesRes.statusCode, 200);
    assert.ok(enginesRes.json().engines.some((e) => e.id === 'toxiproxy' && e.healthy));

    const docsRes = await app.inject({ method: 'GET', url: '/docs/json' });
    assert.equal(docsRes.statusCode, 200);
    const spec = docsRes.json();
    assert.equal(spec.openapi, '3.0.3');
    console.log(`  ✔ OpenAPI spec verified: ${Object.keys(spec.paths).length} routes documented`);

    // ------------------------------------------------------------------------
    // Stage 7: Profile Validation & Creation
    // ------------------------------------------------------------------------
    console.log('\n[7/14] Testing Profile creation & target restriction rules...');
    const invalidTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Evil Target',
        target: { type: 'http', path: 'http://malicious-site.com', method: 'GET' },
        faults: [{ type: 'latency', latencyMs: 100 }],
      },
    });
    assert.equal(invalidTarget.statusCode, 400, 'Must reject full URLs in target path');
    console.log('  ✔ Target restriction enforced -> 400 Bad Request');

    const profileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Step 7 E2E Latency Profile',
        description: 'Profile for automated Step 7 verification with 200ms delay',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'latency', latencyMs: 200, stream: 'downstream', toxicity: 1.0 }],
        requestCount: 5,
        requestTimeoutMs: 3000,
        tags: ['e2e', 'step7'],
      },
    });
    assert.equal(profileRes.statusCode, 201);
    const profile = profileRes.json();
    console.log(`  ✔ Created profile: '${profile.name}' (ID: ${profile.id})`);

    // ------------------------------------------------------------------------
    // Stage 8: Experiment Execution & Monotonic Measurement Polling
    // ------------------------------------------------------------------------
    console.log('\n[8/14] Triggering experiment run & polling real-time status...');
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { profileId: profile.id },
    });
    assert.equal(runRes.statusCode, 202);
    const runId = runRes.json().id;

    let runData;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 15000) {
      const pollRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
      runData = pollRes.json();
      if (['completed', 'failed', 'cancelled'].includes(runData.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.equal(runData.status, 'completed', 'Run must reach completed status');
    assert.equal(runData.summary.totalRequests, 5);
    assert.equal(runData.summary.successCount, 5);
    assert.ok(runData.summary.medianLatencyMs >= 180, 'Median latency must reflect +200ms injection');
    console.log(`  ✔ Experiment completed! (5 requests, median latency: ${runData.summary.medianLatencyMs}ms)`);

    // ------------------------------------------------------------------------
    // Stage 9: Request Measurements & Event Log Verification
    // ------------------------------------------------------------------------
    console.log('\n[9/14] Verifying granular request measurements and lifecycle events...');
    const reqsRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/requests` });
    assert.equal(reqsRes.statusCode, 200);
    const requests = reqsRes.json();
    assert.equal(requests.length, 5);

    const eventsRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/events` });
    assert.equal(eventsRes.statusCode, 200);
    const events = eventsRes.json();
    assert.ok(events.length >= 4, 'Must record state change and fault lifecycle events');
    console.log(`  ✔ Verified ${requests.length} request measurements and ${events.length} lifecycle events`);

    // ------------------------------------------------------------------------
    // Stage 10: Replay Behavior & Comparative Metrics
    // ------------------------------------------------------------------------
    console.log('\n[10/14] Replaying experiment from configuration snapshot...');
    const replayRes = await app.inject({ method: 'POST', url: `/api/v1/runs/${runId}/replay` });
    assert.equal(replayRes.statusCode, 202);
    const replayId = replayRes.json().id;

    let replayData;
    const replayPollStart = Date.now();
    while (Date.now() - replayPollStart < 15000) {
      const poll = await app.inject({ method: 'GET', url: `/api/v1/runs/${replayId}` });
      replayData = poll.json();
      if (['completed', 'failed', 'cancelled'].includes(replayData.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.equal(replayData.status, 'completed');
    assert.equal(replayData.replayedFromId, runId);
    const deltaMedian = Math.abs(replayData.summary.medianLatencyMs - runData.summary.medianLatencyMs);
    console.log(`  ✔ Replay completed! (Original: ${runData.summary.medianLatencyMs}ms vs Replay: ${replayData.summary.medianLatencyMs}ms, variance: ${deltaMedian.toFixed(2)}ms)`);

    // ------------------------------------------------------------------------
    // Stage 11: Concurrency Conflict Protection (409)
    // ------------------------------------------------------------------------
    console.log('\n[11/14] Testing Concurrency Mutex Protection...');
    const longProfileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Long Running Profile for Concurrency Test',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'latency', latencyMs: 50 }],
        requestCount: 20,
        requestTimeoutMs: 3000,
      },
    });
    const longProfile = longProfileRes.json();
    const runARes = await app.inject({ method: 'POST', url: '/api/v1/runs', payload: { profileId: longProfile.id } });
    assert.equal(runARes.statusCode, 202);
    const runAId = runARes.json().id;

    // Immediately attempt concurrent run B
    const runBRes = await app.inject({ method: 'POST', url: '/api/v1/runs', payload: { profileId: profile.id } });
    assert.equal(runBRes.statusCode, 409, 'Concurrent run must be rejected with 409 Conflict');
    console.log('  ✔ Concurrent experiment rejected with HTTP 409 Conflict');

    // Cancel run A and verify clean proxy
    const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/runs/${runAId}/cancel` });
    assert.equal(cancelRes.statusCode, 200);
    await new Promise((r) => setTimeout(r, 800));

    const lingeringToxics = await adapter.client.listToxics(PROXY_NAME);
    assert.equal(lingeringToxics.length, 0, 'Proxy must have 0 lingering toxics after cancellation');
    console.log('  ✔ Cancellation cleanly terminated run and restored 0 active toxics');

    // ------------------------------------------------------------------------
    // Stage 12: Report Generation (JSON & Markdown)
    // ------------------------------------------------------------------------
    console.log('\n[12/14] Testing Report Generation (JSON and Markdown)...');
    const jsonReport = (await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/report?format=json` })).json();
    assert.equal(jsonReport.runId, runId);
    assert.ok(jsonReport.summary);

    const mdReport = (await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/report?format=markdown` })).body;
    assert.ok(mdReport.includes('# NetReplay Experiment Report'));
    assert.ok(mdReport.includes('## Measurement Summary'));
    assert.ok(mdReport.includes('## Request Measurements Breakdown'));
    console.log('  ✔ Generated compliant JSON and Markdown reports with full measurement breakdowns');

    // ------------------------------------------------------------------------
    // Stage 13: Automatic Failure Minimization Verification
    // ------------------------------------------------------------------------
    console.log('\n[13/14] Testing Automatic Failure Minimization Engine...');
    // Create a failed run with multiple faults (latency 500ms + timeout + bandwidth)
    const multiFaultProfileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Minimization Candidate Profile',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [
          { type: 'latency', latencyMs: 400, stream: 'downstream', toxicity: 1.0 },
          { type: 'bandwidth', rateKbps: 500000, stream: 'downstream', toxicity: 1.0 },
        ],
        requestCount: 3,
        requestTimeoutMs: 200, // Short timeout to deliberately cause deadline failures
      },
    });
    const multiProfile = multiFaultProfileRes.json();
    const failedRunRes = await app.inject({ method: 'POST', url: '/api/v1/runs', payload: { profileId: multiProfile.id } });
    const failedRunId = failedRunRes.json().id;

    // Wait for run to fail
    let failedRun;
    const failPollStart = Date.now();
    while (Date.now() - failPollStart < 10000) {
      const poll = await app.inject({ method: 'GET', url: `/api/v1/runs/${failedRunId}` });
      failedRun = poll.json();
      if (['completed', 'failed'].includes(failedRun.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Trigger minimization with deadline predicate
    const minStartRes = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${failedRunId}/minimize`,
      payload: {
        predicate: { type: 'deadline_exceeded', deadlineMs: 250 },
        minReproductionRate: 0.6,
        maxAttempts: 10,
        deadlineSeconds: 60,
      },
    });
    assert.equal(minStartRes.statusCode, 202);
    const minId = minStartRes.json().id;

    // Poll minimization to terminal status
    let minData;
    const minPollStart = Date.now();
    while (Date.now() - minPollStart < 30000) {
      const poll = await app.inject({ method: 'GET', url: `/api/v1/minimizations/${minId}` });
      minData = poll.json();
      if (['completed', 'budget_exhausted', 'failed', 'baseline_not_reproducible'].includes(minData.status)) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    assert.ok(
      ['completed', 'budget_exhausted'].includes(minData.status),
      `Minimization reached terminal status '${minData.status}'`
    );
    assert.equal(minData.cleanupStatus, 'cleaned');
    console.log(`  ✔ Failure minimization completed! Status: '${minData.status}', attempts: ${minData.attemptsUsed}, final rate: ${minData.finalObservedRate ?? 'N/A'}`);

    // Inspect attempts audit trail
    const attemptsRes = await app.inject({ method: 'GET', url: `/api/v1/minimizations/${minId}/attempts` });
    assert.equal(attemptsRes.statusCode, 200);
    const attempts = attemptsRes.json().items;
    assert.ok(attempts.length >= 1, 'Minimization must record attempt audit trail');
    console.log(`  ✔ Retrieved ${attempts.length} minimization attempt evaluations`);

    // ------------------------------------------------------------------------
    // Stage 14: Safe Cleanup & Referential Integrity
    // ------------------------------------------------------------------------
    console.log('\n[14/14] Cleaning up test profiles & verifying referential integrity...');
    await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${profile.id}` });
    await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${longProfile.id}` });
    await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${multiProfile.id}` });

    // Verify historical run preserves config snapshot
    const preservedRun = (await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` })).json();
    assert.equal(preservedRun.profileId, null);
    assert.ok(preservedRun.configSnapshot);
    console.log('  ✔ Deleted profiles safely; historical runs retain frozen configSnapshot');

    console.log('\n================================================================');
    console.log('   🎉 ALL 14 END-TO-END VALIDATION STAGES PASSED FLAWLESSLY!    ');
    console.log('================================================================\n');
  } finally {
    await app.close();
    await prisma.$disconnect();
    // Final defensive cleanup
    await adapter.clearFaults(PROXY_NAME).catch(() => {});
  }
}

runCompleteE2EJourney().catch((err) => {
  console.error('\n❌ E2E VALIDATION JOURNEY FAILED:', err);
  process.exit(1);
});
