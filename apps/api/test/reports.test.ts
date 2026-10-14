import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma, disconnectDb } from '../src/services/db.js';

describe('Reports Export Suite', () => {
  let app: FastifyInstance;
  let runId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Seed a completed run with mock requests and events
    const snapshot = {
      profileName: 'Report Testing Profile',
      engine: 'toxiproxy',
      target: { type: 'http', path: '/api/demo', method: 'GET' },
      faults: [{ type: 'latency', latencyMs: 500, jitterMs: 0, stream: 'downstream' }],
      requestCount: 3,
      requestTimeoutMs: 5000,
      tags: ['report-test'],
      engineVersion: '2.12.0',
    };

    const summary = {
      totalRequests: 3,
      successCount: 3,
      failureCount: 0,
      timeoutCount: 0,
      minLatencyMs: 503.2,
      maxLatencyMs: 506.8,
      medianLatencyMs: 504.5,
      meanLatencyMs: 504.8,
      successCriteriaMet: true,
    };

    const run = await prisma.run.create({
      data: {
        status: 'completed',
        configSnapshot: JSON.stringify(snapshot),
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        summary: JSON.stringify(summary),
        requests: {
          create: [
            { requestIndex: 1, outcome: 'success', statusCode: 200, latencyMs: 503.2 },
            { requestIndex: 2, outcome: 'success', statusCode: 200, latencyMs: 504.5 },
            { requestIndex: 3, outcome: 'success', statusCode: 200, latencyMs: 506.8 },
          ],
        },
        events: {
          create: [
            { eventType: 'state_change', details: JSON.stringify({ from: 'queued', to: 'running' }) },
            { eventType: 'fault_applied', details: JSON.stringify({ type: 'latency', latencyMs: 500 }) },
            { eventType: 'state_change', details: JSON.stringify({ to: 'completed' }) },
          ],
        },
      },
    });

    runId = run.id;
  });

  afterAll(async () => {
    if (runId) {
      await prisma.run.deleteMany({ where: { id: runId } });
    }
    await app.close();
    await disconnectDb();
  });

  it('GET /api/v1/runs/:id/report?format=json exports structured JSON report', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/report?format=json`,
    });

    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.runId).toBe(runId);
    expect(report.status).toBe('completed');
    expect(report.configSnapshot.profileName).toBe('Report Testing Profile');
    expect(report.summary.medianLatencyMs).toBe(504.5);
    expect(report.requests.length).toBe(3);
    expect(report.events.length).toBe(3);
  });

  it('GET /api/v1/runs/:id/report?format=markdown exports formatted Markdown report', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${runId}/report?format=markdown`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');

    const markdown = res.body;
    expect(markdown).toContain('# NetReplay Experiment Report: Report Testing Profile');
    expect(markdown).toContain('**Status**: **COMPLETED**');
    expect(markdown).toContain('## Injected Network Faults');
    expect(markdown).toContain('## Measurement Summary');
    expect(markdown).toContain('504.5 ms');
    expect(markdown).toContain('## Request Measurements Breakdown');
    expect(markdown).toContain('## Event Timeline');
  });

  it('GET /api/v1/runs/:id/report returns 404 for missing run', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/missing-run-id/report',
    });

    expect(res.statusCode).toBe(404);
  });
});
