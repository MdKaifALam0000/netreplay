import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ToxiproxyAdapter } from '../src/adapter.js';

const CONTROL_URL = process.env.TOXIPROXY_CONTROL_URL || 'http://127.0.0.1:8474';
const PROXY_URL = process.env.PROXY_URL || 'http://127.0.0.1:8666';
const PROXY_NAME = 'netreplay-demo';

test('Toxiproxy Live Integration Suite', async (t) => {
  const adapter = new ToxiproxyAdapter({ baseUrl: CONTROL_URL });

  await t.test('1. Engine Health and Version Retrieval', async () => {
    const health = await adapter.checkHealth();
    assert.equal(health.healthy, true);
    assert.ok(typeof health.version === 'string' && health.version.length > 0);
    console.log(`  [integration] Connected to Toxiproxy engine version: ${health.version}`);
  });

  await t.test('2. Idempotent Proxy Inspection and Provisioning', async () => {
    const proxy = await adapter.ensureProxy({
      name: PROXY_NAME,
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });

    assert.equal(proxy.name, PROXY_NAME);
    assert.equal(proxy.upstream, 'test-target:3000');
    assert.equal(proxy.enabled, true);
  });

  await t.test('3. Proxy Connectivity Verification (Baseline)', async () => {
    const res = await fetch(`${PROXY_URL}/api/demo?requestId=integration-baseline`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.requestId, 'integration-baseline');
  });

  await t.test('4. Apply and Remove Latency Fault', async () => {
    // Ensure clean state before test
    await adapter.removeFault(PROXY_NAME, 'integration_latency');

    // Apply fault
    const toxic = await adapter.applyFault(PROXY_NAME, {
      name: 'integration_latency',
      type: 'latency',
      latencyMs: 300,
      jitterMs: 0,
      stream: 'downstream',
    });

    assert.equal(toxic.name, 'integration_latency');
    assert.equal(toxic.attributes.latency, 300);

    // Measure request under fault
    const start = performance.now();
    const res = await fetch(`${PROXY_URL}/api/demo?requestId=integration-fault`);
    const elapsed = performance.now() - start;

    assert.equal(res.status, 200);
    assert.ok(elapsed >= 250, `Expected elapsed >= 250ms, observed ${elapsed.toFixed(1)}ms`);

    // Remove fault
    const removed = await adapter.removeFault(PROXY_NAME, 'integration_latency');
    assert.equal(removed, true);

    // Verify fast baseline restored
    const postStart = performance.now();
    const postRes = await fetch(`${PROXY_URL}/api/demo?requestId=integration-restored`);
    const postElapsed = performance.now() - postStart;

    assert.equal(postRes.status, 200);
    assert.ok(postElapsed < 100, `Expected post-fault elapsed < 100ms, observed ${postElapsed.toFixed(1)}ms`);
  });

  await t.test('5. Scoped withFault Cleanup on Deliberate Callback Failure', async () => {
    let callbackExecuted = false;

    await assert.rejects(
      async () => {
        await adapter.withFault(
          PROXY_NAME,
          {
            name: 'deliberate_fault',
            type: 'latency',
            latencyMs: 200,
          },
          async () => {
            callbackExecuted = true;
            throw new Error('Deliberate callback exception for cleanup test');
          }
        );
      },
      (err) => err.message === 'Deliberate callback exception for cleanup test'
    );

    assert.equal(callbackExecuted, true);

    // Confirm that the toxic was cleaned up and is NOT active on the proxy
    const toxics = await adapter.client.listToxics(PROXY_NAME);
    const lingeringToxic = toxics.find((tx) => tx.name === 'deliberate_fault');
    assert.equal(lingeringToxic, undefined, 'deliberate_fault toxic should have been cleaned up');
  });
});
