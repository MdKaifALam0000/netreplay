import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { disconnectDb } from '../src/services/db.js';

describe('Health & Engine Routes Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDb();
  });

  it('GET /health returns 200 and liveness payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('netreplay-api');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/v1/health returns 200 and connected database status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/v1/engines lists registered engines', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/engines',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.engines)).toBe(true);
    expect(body.engines.length).toBeGreaterThanOrEqual(1);

    const toxiproxy = body.engines.find((e: any) => e.id === 'toxiproxy');
    expect(toxiproxy).toBeDefined();
    expect(toxiproxy.configured).toBe(true);
  });

  it('GET /docs loads Swagger UI documentation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('GET /docs/json returns valid OpenAPI specification', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('NetReplay REST API');
    expect(spec.paths['/api/v1/profiles']).toBeDefined();
    expect(spec.paths['/api/v1/runs']).toBeDefined();
    expect(spec.paths['/api/v1/runs/{id}/report']).toBeDefined();
  });
});
