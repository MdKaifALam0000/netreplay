// @ts-check
import assert from 'node:assert/strict';
import { buildApp } from '../apps/api/dist/app.js';
import { prisma } from '../apps/api/dist/services/db.js';

async function runE2EVerification() {
  console.log('================================================================');
  console.log('      NetReplay Step 3 — Complete End-to-End API Verification   ');
  console.log('================================================================\n');

  // 1. Build and boot the Fastify app
  console.log('[1/12] Booting Fastify API with live Prisma & Docker services...');
  const app = await buildApp({ logger: false });
  await app.ready();
  console.log('  -> App ready and plugins registered.');

  try {
    // 2. Health & Engine Endpoints
    console.log('\n[2/12] Testing Health & Engine endpoints...');
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthRes.statusCode, 200, 'GET /health must return 200');
    const healthJson = healthRes.json();
    assert.equal(healthJson.status, 'ok');
    console.log('  ✔ GET /health -> 200 OK', healthJson);

    const v1HealthRes = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(v1HealthRes.statusCode, 200, 'GET /api/v1/health must return 200');
    const v1HealthJson = v1HealthRes.json();
    assert.equal(v1HealthJson.database, 'connected');
    console.log('  ✔ GET /api/v1/health -> 200 OK (database: connected)');

    const enginesRes = await app.inject({ method: 'GET', url: '/api/v1/engines' });
    assert.equal(enginesRes.statusCode, 200);
    const enginesJson = enginesRes.json();
    assert.ok(Array.isArray(enginesJson.engines));
    assert.ok(enginesJson.engines.some(e => e.id === 'toxiproxy' && e.healthy === true));
    console.log('  ✔ GET /api/v1/engines -> 200 OK (toxiproxy healthy)');

    const toxiRes = await app.inject({ method: 'GET', url: '/api/v1/engines/toxiproxy' });
    assert.equal(toxiRes.statusCode, 200);
    const toxiJson = toxiRes.json();
    assert.equal(toxiJson.healthy, true);
    assert.ok(toxiJson.version, 'Toxiproxy version must be reported');
    console.log(`  ✔ GET /api/v1/engines/toxiproxy -> 200 OK (version: ${toxiJson.version})`);

    // 3. Swagger / OpenAPI Documentation
    console.log('\n[3/12] Testing OpenAPI and Swagger UI endpoints...');
    const swaggerUiRes = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(swaggerUiRes.statusCode, 200);
    assert.ok(swaggerUiRes.headers['content-type']?.includes('text/html'));
    console.log('  ✔ GET /docs -> 200 OK (HTML UI loaded)');

    const openApiJsonRes = await app.inject({ method: 'GET', url: '/docs/json' });
    assert.equal(openApiJsonRes.statusCode, 200);
    const spec = openApiJsonRes.json();
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.paths['/api/v1/profiles']);
    assert.ok(spec.paths['/api/v1/runs']);
    console.log(`  ✔ GET /docs/json -> 200 OK (OpenAPI ${spec.openapi}, ${Object.keys(spec.paths).length} routes documented)`);

    // 4. Profile Validation Rules (Reject arbitrary destinations & invalid bounds)
    console.log('\n[4/12] Testing Profile validation rules...');
    const invalidTargetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Evil Profile',
        target: 'http://malicious-external-site.com/api',
        faults: [],
      },
    });
    assert.equal(invalidTargetRes.statusCode, 400, 'Must reject arbitrary external targets');
    console.log('  ✔ Rejection of arbitrary target URL verified -> 400 Bad Request');

    const invalidLatencyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Invalid Latency',
        target: 'local-test-target',
        faults: [{ type: 'latency', latencyMs: 999999 }], // Max allowed is 60000
      },
    });
    assert.equal(invalidLatencyRes.statusCode, 400, 'Must reject latencyMs exceeding 60,000ms');
    console.log('  ✔ Rejection of out-of-bounds fault params verified -> 400 Bad Request');

    // 5. Profile Creation & Retrieval
    console.log('\n[5/12] Testing Profile CRUD...');
    const createProfileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'E2E Verification Latency Profile',
        description: 'Automated E2E latency test profile with 200ms injected delay',
        target: 'local-test-target',
        requestCount: 5,
        requestTimeoutMs: 3000,
        faults: [
          {
            type: 'latency',
            name: 'e2e_latency_toxic',
            latencyMs: 200,
            jitterMs: 10,
            stream: 'downstream',
            toxicity: 1.0,
          },
        ],
        tags: ['e2e', 'automated', 'latency'],
      },
    });
    assert.equal(createProfileRes.statusCode, 201);
    const profile = createProfileRes.json();
    assert.ok(profile.id, 'Profile must have an ID');
    console.log(`  ✔ POST /api/v1/profiles -> 201 Created (ID: ${profile.id})`);

    const listProfilesRes = await app.inject({ method: 'GET', url: '/api/v1/profiles?page=1&pageSize=10' });
    assert.equal(listProfilesRes.statusCode, 200);
    const profilesList = listProfilesRes.json();
    assert.ok(profilesList.items.some(p => p.id === profile.id));
    console.log(`  ✔ GET /api/v1/profiles -> 200 OK (Found ${profilesList.items.length} profiles, total: ${profilesList.total})`);

    const getProfileRes = await app.inject({ method: 'GET', url: `/api/v1/profiles/${profile.id}` });
    assert.equal(getProfileRes.statusCode, 200);
    assert.equal(getProfileRes.json().name, 'E2E Verification Latency Profile');
    console.log(`  ✔ GET /api/v1/profiles/${profile.id} -> 200 OK`);

    const patchProfileRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profiles/${profile.id}`,
      payload: { description: 'Updated description for E2E test' },
    });
    assert.equal(patchProfileRes.statusCode, 200);
    assert.equal(patchProfileRes.json().description, 'Updated description for E2E test');
    console.log('  ✔ PATCH /api/v1/profiles/:id -> 200 OK (Partial update applied)');

    // 6. Starting a Run and Asynchronous Polling
    console.log('\n[6/12] Triggering an experiment Run...');
    const startRunRes = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { profileId: profile.id },
    });
    assert.equal(startRunRes.statusCode, 202, 'Must return 202 Accepted');
    const startRunBody = startRunRes.json();
    const runId = startRunBody.id;
    const initialStatus = startRunBody.status;
    assert.equal(initialStatus, 'queued');
    console.log(`  ✔ POST /api/v1/runs -> 202 Accepted (Run ID: ${runId}, status: queued)`);

    console.log('  [*] Polling run status until completion...');
    let run = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const pollRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
      assert.equal(pollRes.statusCode, 200);
      run = pollRes.json();
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        break;
      }
    }
    assert.equal(run.status, 'completed', 'Run should finish in completed status');
    const duration = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    console.log(`  ✔ Run completed in ${duration}ms!`);
    console.log(`    - Requests: ${run.summary.totalRequests} total, ${run.summary.successCount} success, ${run.summary.failureCount} failed`);
    console.log(`    - Latency: min=${run.summary.minLatencyMs}ms, median=${run.summary.medianLatencyMs}ms, mean=${run.summary.meanLatencyMs}ms, max=${run.summary.maxLatencyMs}ms`);
    assert.ok(run.summary.medianLatencyMs >= 180, 'Median latency should reflect the ~200ms injected fault');

    // 7. Request-level Measurements & Lifecycle Events
    console.log('\n[7/12] Verifying Request measurements and lifecycle Events...');
    const requestsRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/requests` });
    assert.equal(requestsRes.statusCode, 200);
    const requestsJson = requestsRes.json();
    assert.equal(requestsJson.length, 5, 'Should have exactly 5 request records');
    for (const req of requestsJson) {
      assert.equal(req.outcome, 'success');
      assert.equal(req.statusCode, 200);
      assert.ok(req.latencyMs >= 150, `Request latency ${req.latencyMs}ms should be around 200ms`);
    }
    console.log(`  ✔ GET /api/v1/runs/:id/requests -> 200 OK (${requestsJson.length} requests verified)`);

    const eventsRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/events` });
    assert.equal(eventsRes.statusCode, 200);
    const eventsJson = eventsRes.json();
    const eventTypes = eventsJson.map(e => e.eventType);
    console.log('  ✔ Lifecycle event sequence:', eventTypes.join(' -> '));
    assert.ok(eventTypes.includes('state_change'), 'Must record state_change events');
    assert.ok(eventTypes.includes('fault_applied'), 'Must record fault_applied event');
    assert.ok(eventTypes.includes('fault_removed'), 'Must record fault_removed event');

    // 8. Replay Functionality (Snapshot Isolation)
    console.log('\n[8/12] Testing Replay from historical configuration snapshot...');
    const replayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${runId}/replay`,
    });
    assert.equal(replayRes.statusCode, 202);
    const replayJson = replayRes.json();
    const replayRunId = replayJson.id;
    console.log(`  ✔ POST /api/v1/runs/:id/replay -> 202 Accepted (Replay Run ID: ${replayRunId})`);

    let replayRun = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const pollRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${replayRunId}` });
      replayRun = pollRes.json();
      if (['completed', 'failed', 'cancelled'].includes(replayRun.status)) {
        break;
      }
    }
    assert.equal(replayRun.status, 'completed');
    console.log(`  ✔ Replay run completed successfully! (median latency: ${replayRun.summary.medianLatencyMs}ms)`);

    // 9. Concurrency Protection
    console.log('\n[9/12] Testing Concurrency conflict rejection...');
    // Create a long profile with 20 requests
    const longProfileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Long Running Profile for Concurrency & Cancellation Test',
        target: 'local-test-target',
        requestCount: 20,
        requestTimeoutMs: 3000,
        faults: [{ type: 'latency', latencyMs: 250 }],
      },
    });
    const longProfile = longProfileRes.json();

    const runA = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { profileId: longProfile.id },
    });
    assert.equal(runA.statusCode, 202);
    const runAId = runA.json().id;

    // Immediately trigger a conflicting run on the same proxy
    const runConflict = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { profileId: longProfile.id },
    });
    assert.equal(runConflict.statusCode, 409, 'Concurrent run must be rejected with 409 Conflict');
    console.log('  ✔ Conflicting concurrent run rejected with 409 Conflict!');

    // 10. Cancellation & Safe Cleanup
    console.log('\n[10/12] Testing Run cancellation and guaranteed cleanup...');
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${runAId}/cancel`,
    });
    assert.equal(cancelRes.statusCode, 200);
    console.log('  ✔ POST /api/v1/runs/:id/cancel -> 200 OK (Cancellation requested)');

    // Wait briefly for cancellation to settle
    await new Promise(r => setTimeout(r, 800));
    const cancelledRunRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runAId}` });
    const cancelledRun = cancelledRunRes.json();
    assert.equal(cancelledRun.status, 'cancelled');
    console.log(`  ✔ Run transitioned to terminal 'cancelled' state (processed ${cancelledRun.summary.totalRequests} of 20 requests)`);

    // Verify proxy has 0 lingering toxics
    const proxyStatusRes = await fetch('http://127.0.0.1:8474/proxies/netreplay-demo', {
      headers: { 'User-Agent': 'NetReplay/1.0' },
    });
    const proxyData = await proxyStatusRes.json();
    assert.equal(proxyData.toxics.length, 0, 'Proxy must have 0 lingering toxics after cancellation');
    console.log('  ✔ Verified proxy has 0 lingering toxics (clean state restored)');

    // 11. Reports (JSON and Markdown)
    console.log('\n[11/12] Testing Report generation (JSON and Markdown)...');
    const jsonReportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/report?format=json`,
    });
    assert.equal(jsonReportRes.statusCode, 200);
    const jsonReport = jsonReportRes.json();
    assert.equal(jsonReport.runId, runId);
    assert.ok(jsonReport.summary);
    assert.ok(Array.isArray(jsonReport.requests));
    console.log('  ✔ GET /api/v1/runs/:id/report?format=json -> 200 OK');

    const mdReportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/report?format=markdown`,
    });
    assert.equal(mdReportRes.statusCode, 200);
    assert.ok(mdReportRes.headers['content-type']?.includes('text/markdown'));
    const mdContent = mdReportRes.body;
    assert.ok(mdContent.includes('# NetReplay Experiment Report'));
    assert.ok(mdContent.includes('## Injected Network Faults'));
    assert.ok(mdContent.includes('## Measurement Summary'));
    assert.ok(mdContent.includes('## Request Measurements Breakdown'));
    console.log('  ✔ GET /api/v1/runs/:id/report?format=markdown -> 200 OK (Markdown table report generated)');

    // 12. Safe Profile Deletion
    console.log('\n[12/12] Testing Profile deletion with referential integrity...');
    const deleteProfileRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profiles/${profile.id}`,
    });
    assert.equal(deleteProfileRes.statusCode, 204);
    console.log(`  ✔ DELETE /api/v1/profiles/${profile.id} -> 204 No Content`);

    // Cleanup long profile as well
    await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${longProfile.id}` });

    // Verify historical run still retains config snapshot and is intact
    const historicalRunRes = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    assert.equal(historicalRunRes.statusCode, 200);
    const historicalRun = historicalRunRes.json();
    assert.equal(historicalRun.profileId, null, 'Deleted profile sets run.profileId to null');
    assert.ok(historicalRun.configSnapshot, 'Historical config snapshot is preserved');
    console.log('  ✔ Historical run verified intact with configSnapshot after profile deletion');

    console.log('\n================================================================');
    console.log('   🎉 ALL 12 END-TO-END SUITES PASSED FLAWLESSLY!               ');
    console.log('================================================================');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

runE2EVerification().catch(err => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
