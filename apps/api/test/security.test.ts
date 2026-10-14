/**
 * Security and Reliability Hardening Test Suite
 *
 * Verifies payload size limits, security headers, CORS boundary enforcement,
 * target restriction validation, error masking, and graceful cleanup guarantees.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { disconnectDb, prisma } from '../src/services/db.js';
import { experimentRunner } from '../src/services/experiment-runner.js';

describe('Security and Reliability Hardening Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDb();
  });

  describe('Security Headers', () => {
    it('sets standard defensive security headers on responses', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('Request Size Limits', () => {
    it('rejects oversized JSON request bodies with 413 PAYLOAD_TOO_LARGE', async () => {
      // Generate a payload exceeding 1MB (1048576 bytes)
      const oversizedString = 'x'.repeat(1024 * 1024 + 100);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        headers: {
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          name: 'oversized-profile',
          description: oversizedString,
          faults: [{ type: 'latency', latencyMs: 100 }],
        }),
      });

      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.statusCode).toBe(413);
      expect(body.error).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toContain('1MB');
    });
  });

  describe('Network Target Restrictions', () => {
    it('rejects profile creation with absolute URLs or external schemes in target path', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'ssrf-attempt',
          target: {
            type: 'http',
            path: 'http://169.254.169.254/latest/meta-data/',
            method: 'GET',
          },
          faults: [{ type: 'latency', latencyMs: 100 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('BAD_REQUEST');
      expect(JSON.stringify(body.details)).toMatch(/relative local path|cannot contain full URLs/);
    });

    it('rejects target paths that do not start with a leading slash', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'invalid-path-profile',
          target: {
            type: 'http',
            path: 'relative/without/slash',
            method: 'GET',
          },
          faults: [{ type: 'latency', latencyMs: 100 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('BAD_REQUEST');
    });
  });

  describe('CORS Restrictions', () => {
    it('allows requests from configured origin (http://localhost:5173)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:5173',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('rejects requests from unlisted external origin with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://malicious-attacker.com',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('FORBIDDEN');
      expect(body.message).toContain('not allowed by CORS');
    });
  });

  describe('Error Sanitization and Stack Trace Masking', () => {
    it('masks internal server error details and stack traces', async () => {
      // Trigger an internal error by injecting a route with unhandled throw
      const testApp = await buildApp({ logger: false });
      testApp.get('/test-internal-error', async () => {
        throw new Error('Database password leak: secret-db-pass-1234');
      });

      const res = await testApp.inject({
        method: 'GET',
        url: '/test-internal-error',
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.statusCode).toBe(500);
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      expect(body.message).toBe('An unexpected internal server error occurred');
      // Stack trace and sensitive message must not be exposed to client
      expect(body.message).not.toContain('secret-db-pass-1234');
      expect(JSON.stringify(body)).not.toContain('at ');

      await testApp.close();
    });
  });

  describe('Fault Application and Concurrency Locking', () => {
    it('rejects concurrent runs while an experiment is active', async () => {
      // Create a test profile via API
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'concurrency-test-profile',
          engine: 'toxiproxy',
          target: { type: 'http', path: '/api/demo', method: 'GET' },
          faults: [{ type: 'latency', latencyMs: 50, stream: 'downstream', toxicity: 1 }],
          requestCount: 5,
          requestTimeoutMs: 1000,
          tags: ['security-test'],
        },
      });

      expect(createRes.statusCode).toBe(201);
      const profile = createRes.json();

      // Simulate runner being busy
      const originalIsBusy = experimentRunner.isBusy.bind(experimentRunner);
      experimentRunner.isBusy = () => true;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          payload: {
            profileId: profile.id,
          },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body.error).toBe('CONFLICT');
        expect(body.message).toContain('already in progress');
        expect(body.message).toContain('Concurrent proxy operations are not permitted');
      } finally {
        experimentRunner.isBusy = originalIsBusy;
        await prisma.profile.delete({ where: { id: profile.id } }).catch(() => {});
      }
    });

    it('rejects invalid fault values (negative latency, out of bounds)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'invalid-fault-profile',
          faults: [
            {
              type: 'latency',
              latencyMs: -100, // Invalid: negative latency
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('BAD_REQUEST');
    });
  });
});
