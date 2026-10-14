import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../services/db.js';

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

  // Versioned readiness check including database ping
  app.get(
    '/api/v1/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Application readiness check',
        description: 'Verifies API status and database connectivity.',
        response: {
          200: z.object({
            status: z.literal('ok'),
            database: z.enum(['connected', 'disconnected']),
            uptimeSeconds: z.number(),
            timestamp: z.string(),
          }),
          503: z.object({
            status: z.literal('unhealthy'),
            database: z.enum(['connected', 'disconnected']),
            message: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
    async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return res.status(200).send({
          status: 'ok',
          database: 'connected',
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        return res.status(503).send({
          status: 'unhealthy',
          database: 'disconnected',
          message: `Database ping failed: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
