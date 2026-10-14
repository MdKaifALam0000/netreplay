import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndMapFault,
  validateProxyConfig,
  BOUNDS,
} from '../src/validation.js';
import { ToxiproxyValidationError } from '../src/errors.js';

test('Toxiproxy Validation Suite', async (t) => {
  // --------------------------------------------------------------------------
  // Latency Fault Validation
  // --------------------------------------------------------------------------
  await t.test('Latency: valid configuration with defaults', () => {
    const mapped = validateAndMapFault({
      type: 'latency',
      latencyMs: 500,
    });

    assert.equal(mapped.type, 'latency');
    assert.equal(mapped.name, 'latency_downstream');
    assert.equal(mapped.stream, 'downstream');
    assert.equal(mapped.toxicity, 1.0);
    assert.equal(mapped.attributes.latency, 500);
    assert.equal(mapped.attributes.jitter, 0);
  });

  await t.test('Latency: valid configuration with explicit fields and custom name', () => {
    const mapped = validateAndMapFault({
      name: 'custom_latency',
      type: 'latency',
      latencyMs: 1200,
      jitterMs: 150,
      stream: 'upstream',
      toxicity: 0.75,
    });

    assert.equal(mapped.name, 'custom_latency');
    assert.equal(mapped.type, 'latency');
    assert.equal(mapped.stream, 'upstream');
    assert.equal(mapped.toxicity, 0.75);
    assert.equal(mapped.attributes.latency, 1200);
    assert.equal(mapped.attributes.jitter, 150);
  });

  await t.test('Latency: rejects out of bounds latencyMs', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: -1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'latencyMs'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: BOUNDS.LATENCY_MAX_MS + 1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'latencyMs'
    );
  });

  await t.test('Latency: rejects float or non-numeric latencyMs', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100.5 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'latencyMs'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: '500' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'latencyMs'
    );
  });

  await t.test('Latency: rejects out of bounds jitterMs', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 500, jitterMs: -1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'jitterMs'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 500, jitterMs: BOUNDS.JITTER_MAX_MS + 1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'jitterMs'
    );
  });

  // --------------------------------------------------------------------------
  // Timeout Fault Validation
  // --------------------------------------------------------------------------
  await t.test('Timeout: valid configuration', () => {
    const mapped = validateAndMapFault({
      type: 'timeout',
      timeoutMs: 3000,
      stream: 'upstream',
    });

    assert.equal(mapped.type, 'timeout');
    assert.equal(mapped.name, 'timeout_upstream');
    assert.equal(mapped.stream, 'upstream');
    assert.equal(mapped.toxicity, 1.0);
    assert.equal(mapped.attributes.timeout, 3000);
  });

  await t.test('Timeout: rejects negative or excessive timeoutMs', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'timeout', timeoutMs: -10 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'timeoutMs'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'timeout', timeoutMs: BOUNDS.TIMEOUT_MAX_MS + 1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'timeoutMs'
    );
  });

  // --------------------------------------------------------------------------
  // Bandwidth Fault Validation
  // --------------------------------------------------------------------------
  await t.test('Bandwidth: valid configuration', () => {
    const mapped = validateAndMapFault({
      type: 'bandwidth',
      rateKbps: 256,
    });

    assert.equal(mapped.type, 'bandwidth');
    assert.equal(mapped.name, 'bandwidth_downstream');
    assert.equal(mapped.attributes.rate, 256);
  });

  await t.test('Bandwidth: rejects non-positive or excessive rateKbps', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'bandwidth', rateKbps: 0 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'rateKbps'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'bandwidth', rateKbps: BOUNDS.RATE_MAX_KBPS + 1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'rateKbps'
    );
  });

  // --------------------------------------------------------------------------
  // Reset Peer Fault Validation
  // --------------------------------------------------------------------------
  await t.test('Reset: valid configuration for reset and reset_peer', () => {
    const mapped1 = validateAndMapFault({ type: 'reset' });
    assert.equal(mapped1.type, 'reset_peer');
    assert.equal(mapped1.name, 'reset_downstream');
    assert.deepEqual(mapped1.attributes, {});

    const mapped2 = validateAndMapFault({ type: 'reset_peer', stream: 'upstream' });
    assert.equal(mapped2.type, 'reset_peer');
    assert.equal(mapped2.name, 'reset_upstream');
  });

  // --------------------------------------------------------------------------
  // Common Fault Parameters: stream, toxicity, unknown fields
  // --------------------------------------------------------------------------
  await t.test('Common: rejects invalid stream', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100, stream: 'bidirectional' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'stream'
    );
  });

  await t.test('Common: rejects invalid toxicity', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100, toxicity: -0.1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'toxicity'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100, toxicity: 1.1 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'toxicity'
    );
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100, toxicity: 'high' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'toxicity'
    );
  });

  await t.test('Common: rejects unsupported fault type', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'tc_netem' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'type'
    );
  });

  await t.test('Common: rejects unexpected extraneous fields', () => {
    assert.throws(
      () => validateAndMapFault({ type: 'latency', latencyMs: 100, extraKey: 'forbidden' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'extraKey'
    );
  });

  // --------------------------------------------------------------------------
  // Proxy Configuration Validation
  // --------------------------------------------------------------------------
  await t.test('Proxy: validates correct configuration', () => {
    const valid = validateProxyConfig({
      name: 'demo-proxy',
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });
    assert.equal(valid.name, 'demo-proxy');
    assert.equal(valid.listen, '0.0.0.0:8666');
    assert.equal(valid.upstream, 'test-target:3000');
    assert.equal(valid.enabled, true);
  });

  await t.test('Proxy: rejects missing or empty fields', () => {
    assert.throws(
      () => validateProxyConfig({ listen: '0.0.0.0:8666', upstream: 'target:3000' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'name'
    );
    assert.throws(
      () => validateProxyConfig({ name: 'demo', listen: '', upstream: 'target:3000' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'listen'
    );
    assert.throws(
      () => validateProxyConfig({ name: 'demo', listen: '0.0.0.0:8666', upstream: '   ' }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'upstream'
    );
  });

  await t.test('Proxy: rejects unexpected keys', () => {
    assert.throws(
      () => validateProxyConfig({ name: 'demo', listen: '0.0.0.0:8666', upstream: 'target:3000', extra: 123 }),
      (err) => err instanceof ToxiproxyValidationError && err.field === 'extra'
    );
  });
});
