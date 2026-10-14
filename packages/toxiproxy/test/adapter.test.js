import test from 'node:test';
import assert from 'node:assert/strict';
import { ToxiproxyClient } from '../src/client.js';
import { ToxiproxyAdapter } from '../src/adapter.js';
import {
  ToxiproxyValidationError,
  ToxiproxyNotFoundError,
  ToxiproxyConflictError,
  ToxiproxyHttpError,
  ToxiproxyTimeoutError,
  ToxiproxyConnectionError,
  ToxiproxyCleanupError,
} from '../src/errors.js';

/**
 * Creates a mock fetch dispatcher for isolated unit testing.
 *
 * @param {Record<string, { status: number, body?: any, delayMs?: number, throws?: Error }>} routes
 */
function createMockFetch(routes = {}) {
  const requests = [];

  const mockFetch = async (url, init = {}) => {
    requests.push({ url, init });

    const parsed = new URL(url);
    const key = `${init.method || 'GET'} ${parsed.pathname}`;
    const route = routes[key] || routes[`ANY ${parsed.pathname}`];

    if (!route) {
      return new Response(JSON.stringify({ error: `Not found mock route: ${key}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (route.throws) {
      throw route.throws;
    }

    if (route.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, route.delayMs));
    }

    const is204 = (route.status === 204);
    const bodyContent = is204
      ? null
      : (route.body !== undefined
        ? (typeof route.body === 'string' ? route.body : JSON.stringify(route.body))
        : '');

    return new Response(bodyContent, {
      status: route.status || 200,
      statusText: route.statusText || 'OK',
      headers: {
        'Content-Type': 'application/json',
        ...(route.headers || {}),
      },
    });
  };

  mockFetch.requests = requests;
  return mockFetch;
}

test('Toxiproxy Client & Adapter Unit Suite', async (t) => {
  // --------------------------------------------------------------------------
  // Client URL & Options Validation
  // --------------------------------------------------------------------------
  await t.test('Client: rejects invalid or unsupported URL schemes', () => {
    assert.throws(
      () => new ToxiproxyClient({ baseUrl: 'file:///etc/toxiproxy' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'baseUrl'
    );
    assert.throws(
      () => new ToxiproxyClient({ baseUrl: 'ftp://localhost:8474' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'baseUrl'
    );
    assert.throws(
      () => new ToxiproxyClient({ baseUrl: 'not-a-valid-url' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'baseUrl'
    );
  });

  await t.test('Client: normalizes base URL and trims trailing slashes', () => {
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474///' });
    assert.equal(client.baseUrl, 'http://127.0.0.1:8474');
  });

  await t.test('Client: sends descriptive User-Agent on all control requests', async () => {
    const mock = createMockFetch({
      'GET /version': { status: 200, body: { version: '2.12.0' } },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const version = await client.getVersion();

    assert.equal(version, '2.12.0');
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].init.headers['User-Agent'], 'NetReplay-EngineAdapter/1.0');
  });

  // --------------------------------------------------------------------------
  // Client HTTP Error Handling
  // --------------------------------------------------------------------------
  await t.test('Client: maps HTTP 404 to ToxiproxyNotFoundError', async () => {
    const mock = createMockFetch({
      'GET /proxies/missing': { status: 404, body: { title: 'proxy not found', status: 404 } },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => client.getProxy('missing'),
      (err) => err instanceof ToxiproxyNotFoundError && err.status === 404
    );
  });

  await t.test('Client: maps HTTP 409 to ToxiproxyConflictError', async () => {
    const mock = createMockFetch({
      'POST /proxies': { status: 409, body: { title: 'proxy already exists', status: 409 } },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => client.createProxy({ name: 'dup', listen: '0.0.0.0:8666', upstream: 'app:3000' }),
      (err) => err instanceof ToxiproxyConflictError && err.status === 409
    );
  });

  await t.test('Client: maps generic HTTP 500 to ToxiproxyHttpError', async () => {
    const mock = createMockFetch({
      'GET /proxies': { status: 500, body: 'Internal daemon error' },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => client.listProxies(),
      (err) => err instanceof ToxiproxyHttpError && err.status === 500
    );
  });

  await t.test('Client: translates timeout to ToxiproxyTimeoutError', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const mock = createMockFetch({
      'GET /version': { throws: abortErr },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => client.getVersion(),
      (err) => err instanceof ToxiproxyTimeoutError
    );
  });

  await t.test('Client: translates connection failure to ToxiproxyConnectionError', async () => {
    const connErr = new TypeError('fetch failed');
    const mock = createMockFetch({
      'GET /version': { throws: connErr },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => client.getVersion(),
      (err) => err instanceof ToxiproxyConnectionError
    );
  });

  await t.test('Client: handles HTTP 204 No Content safely', async () => {
    const mock = createMockFetch({
      'DELETE /proxies/temp': { status: 204 },
    });
    const client = new ToxiproxyClient({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const raw = await client._request('DELETE', '/proxies/temp');
    assert.equal(raw, null);
    const res = await client.deleteProxy('temp');
    assert.equal(res, undefined);
  });

  // --------------------------------------------------------------------------
  // Adapter Idempotent ensureProxy Tests
  // --------------------------------------------------------------------------
  await t.test('Adapter: ensureProxy creates proxy when absent', async () => {
    const createdProxy = {
      name: 'netreplay-demo',
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo': { status: 404, body: { title: 'proxy not found' } },
      'POST /proxies': { status: 201, body: createdProxy },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const result = await adapter.ensureProxy(createdProxy);

    assert.equal(result.name, 'netreplay-demo');
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].init.method, 'GET');
    assert.equal(mock.requests[1].init.method, 'POST');
  });

  await t.test('Adapter: ensureProxy reuses matching proxy without unnecessary update', async () => {
    const existingProxy = {
      name: 'netreplay-demo',
      listen: '[::]:8666', // Dual-stack reported address
      upstream: 'test-target:3000',
      enabled: true,
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo': { status: 200, body: existingProxy },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const result = await adapter.ensureProxy({
      name: 'netreplay-demo',
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });

    assert.equal(result.name, 'netreplay-demo');
    assert.equal(mock.requests.length, 1); // Only GET, no POST needed!
  });

  await t.test('Adapter: ensureProxy updates disabled proxy to enabled', async () => {
    const existingProxy = {
      name: 'netreplay-demo',
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: false,
    };
    const updatedProxy = { ...existingProxy, enabled: true };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo': { status: 200, body: existingProxy },
      'POST /proxies/netreplay-demo': { status: 200, body: updatedProxy },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const result = await adapter.ensureProxy({
      name: 'netreplay-demo',
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });

    assert.equal(result.enabled, true);
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[1].init.method, 'POST');
  });

  // --------------------------------------------------------------------------
  // Adapter Fault Injection & Scoped withFault Tests
  // --------------------------------------------------------------------------
  await t.test('Adapter: applyFault rejects conflicting toxic name', async () => {
    const existingToxic = {
      name: 'latency_downstream',
      type: 'bandwidth', // Differing type!
      stream: 'downstream',
      attributes: { rate: 100 },
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics/latency_downstream': { status: 200, body: existingToxic },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => adapter.applyFault('netreplay-demo', { type: 'latency', latencyMs: 500 }),
      (err) => err instanceof ToxiproxyConflictError && err.message.includes('already exists')
    );
  });

  await t.test('Adapter: withFault executes callback and cleans up toxic on success', async () => {
    const toxicResponse = {
      name: 'latency_downstream',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { latency: 500, jitter: 0 },
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics/latency_downstream': { status: 404, body: { title: 'not found' } },
      'POST /proxies/netreplay-demo/toxics': { status: 200, body: toxicResponse },
      'DELETE /proxies/netreplay-demo/toxics/latency_downstream': { status: 204 },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    let callbackExecuted = false;

    const res = await adapter.withFault('netreplay-demo', { type: 'latency', latencyMs: 500 }, async () => {
      callbackExecuted = true;
      return 'experiment-result';
    });

    assert.equal(res, 'experiment-result');
    assert.equal(callbackExecuted, true);

    // Verify DELETE was called in finally
    const deleteReq = mock.requests.find((r) => r.init.method === 'DELETE');
    assert.ok(deleteReq, 'Toxic removal DELETE request should have been sent');
  });

  await t.test('Adapter: withFault cleans up toxic when callback throws', async () => {
    const toxicResponse = {
      name: 'latency_downstream',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { latency: 500, jitter: 0 },
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics/latency_downstream': { status: 404 },
      'POST /proxies/netreplay-demo/toxics': { status: 200, body: toxicResponse },
      'DELETE /proxies/netreplay-demo/toxics/latency_downstream': { status: 204 },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => {
        await adapter.withFault('netreplay-demo', { type: 'latency', latencyMs: 500 }, async () => {
          throw new Error('Callback failed due to assertion');
        });
      },
      (err) => err.message === 'Callback failed due to assertion'
    );

    const deleteReq = mock.requests.find((r) => r.init.method === 'DELETE');
    assert.ok(deleteReq, 'Toxic must be removed even when callback throws');
  });

  await t.test('Adapter: withFault attaches cleanup failure when callback throws and cleanup fails', async () => {
    const toxicResponse = {
      name: 'latency_downstream',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { latency: 500, jitter: 0 },
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics/latency_downstream': { status: 404 },
      'POST /proxies/netreplay-demo/toxics': { status: 200, body: toxicResponse },
      'DELETE /proxies/netreplay-demo/toxics/latency_downstream': { status: 500, body: 'Failed to delete' },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => {
        await adapter.withFault('netreplay-demo', { type: 'latency', latencyMs: 500 }, async () => {
          throw new Error('Primary error');
        });
      },
      (err) => {
        assert.equal(err.message, 'Primary error');
        assert.ok(err.cleanupError, 'cleanupError should be attached');
        assert.ok(err.cleanupError instanceof ToxiproxyHttpError);
        return true;
      }
    );
  });

  await t.test('Adapter: withFault throws ToxiproxyCleanupError if callback succeeds but cleanup fails', async () => {
    const toxicResponse = {
      name: 'latency_downstream',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { latency: 500, jitter: 0 },
    };

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics/latency_downstream': { status: 404 },
      'POST /proxies/netreplay-demo/toxics': { status: 200, body: toxicResponse },
      'DELETE /proxies/netreplay-demo/toxics/latency_downstream': { status: 500, body: 'Cleanup failed' },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });

    await assert.rejects(
      async () => {
        await adapter.withFault('netreplay-demo', { type: 'latency', latencyMs: 500 }, async () => {
          return 'all-good';
        });
      },
      (err) => err instanceof ToxiproxyCleanupError && err.cleanupError !== null
    );
  });

  await t.test('Adapter: clearFaults removes only toxics on target proxy', async () => {
    const toxicsList = [
      { name: 'toxic_1' },
      { name: 'toxic_2' },
    ];

    const mock = createMockFetch({
      'GET /proxies/netreplay-demo/toxics': { status: 200, body: toxicsList },
      'DELETE /proxies/netreplay-demo/toxics/toxic_1': { status: 204 },
      'DELETE /proxies/netreplay-demo/toxics/toxic_2': { status: 204 },
    });

    const adapter = new ToxiproxyAdapter({ baseUrl: 'http://127.0.0.1:8474', fetch: mock });
    const count = await adapter.clearFaults('netreplay-demo');

    assert.equal(count, 2);
    // Ensure no POST /reset was called!
    const resetReq = mock.requests.find((r) => r.init.method === 'POST' && r.url.endsWith('/reset'));
    assert.equal(resetReq, undefined, 'clearFaults must never issue a global engine reset');
  });
});
