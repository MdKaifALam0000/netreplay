import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma, disconnectDb } from '../src/services/db.js';

describe('Profile Lifecycle Suite', () => {
  let app: FastifyInstance;
  let createdProfileId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Clean up created test profile
    if (createdProfileId) {
      await prisma.profile.deleteMany({ where: { id: createdProfileId } });
    }
    await app.close();
    await disconnectDb();
  });

  it('POST /api/v1/profiles creates a valid profile with defaults', async () => {
    const payload = {
      name: 'Test Latency Profile',
      description: 'Simulates 500ms downstream delay',
      engine: 'toxiproxy',
      target: {
        type: 'http',
        path: '/api/demo',
        method: 'GET',
      },
      faults: [
        {
          type: 'latency',
          latencyMs: 500,
          jitterMs: 50,
          stream: 'downstream',
          toxicity: 1.0,
        },
      ],
      requestCount: 5,
      requestTimeoutMs: 3000,
      tags: ['smoke', 'latency'],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Latency Profile');
    expect(body.faults.length).toBe(1);
    expect(body.faults[0].latencyMs).toBe(500);
    expect(body.tags).toEqual(['smoke', 'latency']);

    createdProfileId = body.id;
  });

  it('POST /api/v1/profiles rejects invalid latency bounds with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Invalid Profile',
        faults: [
          {
            type: 'latency',
            latencyMs: 999999, // Exceeds 60,000ms max
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('POST /api/v1/profiles rejects arbitrary external URLs in target with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Malicious Target Profile',
        target: {
          type: 'http',
          path: 'https://evil.external-server.com/steal-data',
        },
        faults: [{ type: 'latency', latencyMs: 100 }],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('POST /api/v1/profiles rejects empty fault list with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'No Faults Profile',
        faults: [],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('GET /api/v1/profiles lists profiles with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/profiles?page=1&limit=10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
  });

  it('GET /api/v1/profiles/:id retrieves a profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/profiles/${createdProfileId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(createdProfileId);
    expect(body.name).toBe('Test Latency Profile');
  });

  it('GET /api/v1/profiles/:id returns 404 for non-existent profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/profiles/non-existent-id',
    });

    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/v1/profiles/:id updates profile fields partially', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profiles/${createdProfileId}`,
      payload: {
        description: 'Updated description for Step 3 test',
        requestCount: 8,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.description).toBe('Updated description for Step 3 test');
    expect(body.requestCount).toBe(8);
  });

  it('DELETE /api/v1/profiles/:id removes the profile', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profiles/${createdProfileId}`,
    });

    expect(res.statusCode).toBe(204);

    // Verify it is gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/profiles/${createdProfileId}`,
    });
    expect(getRes.statusCode).toBe(404);
  });
});
