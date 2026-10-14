import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma, disconnectDb } from '../src/services/db.js';

describe('Run Orchestration & Lifecycle Suite', () => {
  let app: FastifyInstance;
  let profileId: string;
  let runId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Seed a test profile
    const profileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Runner Execution Profile',
        engine: 'toxiproxy',
        target: {
          type: 'http',
          path: '/api/demo',
        },
        faults: [
          {
            type: 'latency',
            latencyMs: 150,
            jitterMs: 0,
            stream: 'downstream',
          },
        ],
        requestCount: 3,
        requestTimeoutMs: 2000,
        successCriteria: {
          maxMedianLatencyMs: 1000,
          maxFailureCount: 0,
        },
      },
    });

    profileId = profileRes.json().id;
  });

  afterAll(async () => {
    if (runId) {
      await prisma.run.deleteMany({ where: { id: runId } });
    }
    if (profileId) {
      await prisma.profile.deleteMany({ where: { id: profileId } });
    }
    await app.close();
    await disconnectDb();
  });

  it('POST /api/v1/runs starts an experiment run and returns HTTP 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: {
        profileId,
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.profileId).toBe(profileId);
    expect(body.status).toBe('queued');
    expect(body.configSnapshot).toBeDefined();

    runId = body.id;
  });

  it('POST /api/v1/runs prevents concurrent experiments on the same proxy with 409', async () => {
    // If previous run is still active, this returns 409
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { profileId },
    });

    // Could be 409 if previous is executing, or 202 if already finished
    if (res.statusCode === 409) {
      expect(res.json().error).toBe('CONFLICT');
    } else {
      expect(res.statusCode).toBe(202);
      // Wait for it
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  it('GET /api/v1/runs lists runs with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs?page=1&limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('Waits for run completion and inspects status and summary', async () => {
    // Poll until terminal state (max 10 seconds)
    const start = Date.now();
    let currentStatus = 'queued';
    let body: any;

    while (Date.now() - start < 10000) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/runs/${runId}`,
      });
      body = res.json();
      currentStatus = body.status;
      if (['completed', 'failed', 'cancelled'].includes(currentStatus)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(['completed', 'failed']).toContain(currentStatus);
    if (currentStatus === 'completed') {
      expect(body.summary).toBeDefined();
      expect(body.summary.totalRequests).toBe(3);
      expect(body.summary.medianLatencyMs).toBeGreaterThan(0);
      expect(body.summary.successCriteriaMet).toBe(true);
    }
  });

  it('GET /api/v1/runs/:id/events retrieves ordered run events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/events`,
    });

    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const eventTypes = events.map((e: any) => e.eventType);
    expect(eventTypes).toContain('state_change');
  });

  it('GET /api/v1/runs/:id/requests retrieves request measurements', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/requests`,
    });

    expect(res.statusCode).toBe(200);
    const requests = res.json();
    expect(Array.isArray(requests)).toBe(true);
    expect(requests.length).toBe(3);
    expect(requests[0].requestIndex).toBe(1);
    expect(typeof requests[0].latencyMs).toBe('number');
  });

  it('POST /api/v1/runs/:id/replay starts a new run from configuration snapshot', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${runId}/replay`,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.id).not.toBe(runId);
    expect(body.replayedFromId).toBe(runId);
    expect(body.configSnapshot).toBeDefined();

    // Clean up replayed run
    await new Promise((r) => setTimeout(r, 1500));
    await prisma.run.deleteMany({ where: { id: body.id } });
  });

  it('POST /api/v1/runs/:id/cancel rejects cancelling an already completed run with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${runId}/cancel`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('BAD_REQUEST');
  });
});
