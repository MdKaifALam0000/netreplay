import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../services/db.js';
import { toxiproxyService } from '../services/toxiproxy-service.js';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Root liveness check
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Root liveness check',
        description: 'Returns HTTP 200 indicating that the API process is alive.',
        response: {
          200: z.object({
            status: z.literal('ok'),
            service: z.string(),
            uptimeSeconds: z.number(),
            timestamp: z.string(),
          }),
        },
      },
    },
    async (_req, res) => {
      return res.status(200).send({
        status: 'ok',
        service: 'netreplay-api',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }
  );

  // Versioned readiness check inspecting critical dependencies (database and engine)
  app.get(
    '/api/v1/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Application readiness check',
        description: 'Verifies API status and dependency connectivity (database and Toxiproxy engine).',
        response: {
          200: z.object({
            status: z.literal('ok'),
            database: z.enum(['connected', 'disconnected']),
            engine: z.enum(['connected', 'disconnected']).optional(),
            uptimeSeconds: z.number(),
            timestamp: z.string(),
          }),
          503: z.object({
            status: z.literal('unhealthy'),
            database: z.enum(['connected', 'disconnected']),
            engine: z.enum(['connected', 'disconnected']).optional(),
            message: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
    async (_req, res) => {
      let dbStatus: 'connected' | 'disconnected' = 'disconnected';
      let engineStatus: 'connected' | 'disconnected' = 'disconnected';

      try {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
      } catch {
        dbStatus = 'disconnected';
      }

      try {
        const engineHealth = await toxiproxyService.getHealth();
        if (engineHealth.healthy) {
          engineStatus = 'connected';
        }
      } catch {
        engineStatus = 'disconnected';
      }

      const isReady = dbStatus === 'connected';

      if (!isReady) {
        return res.status(503).send({
          status: 'unhealthy',
          database: dbStatus,
          engine: engineStatus,
          message: 'Database dependency is unavailable',
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).send({
        status: 'ok',
        database: dbStatus,
        engine: engineStatus,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }
  );
};
