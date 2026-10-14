import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { toxiproxyService } from '../services/toxiproxy-service.js';

export const engineRoutes: FastifyPluginAsyncZod = async (app) => {
  // List all available engines
  app.get(
    '/api/v1/engines',
    {
      schema: {
        tags: ['Engines'],
        summary: 'List available fault injection engines',
        description: 'Returns metadata and current health status for all registered network failure engines.',
        response: {
          200: z.object({
            engines: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                configured: z.boolean(),
                healthy: z.boolean(),
                description: z.string(),
              })
            ),
          }),
        },
      },
    },
    async (_req, res) => {
      const toxiproxy = await toxiproxyService.getEngineInfo();
      return res.status(200).send({
        engines: [toxiproxy],
      });
    }
  );

  // Inspect Toxiproxy engine specific details
  app.get(
    '/api/v1/engines/toxiproxy',
    {
      schema: {
        tags: ['Engines'],
        summary: 'Inspect Toxiproxy engine health and version',
        description: 'Queries the Shopify Toxiproxy engine via the adapter and reports version and connectivity.',
        response: {
          200: z.object({
            id: z.string(),
            name: z.string(),
            version: z.string(),
            healthy: z.boolean(),
            proxyName: z.string(),
            trafficUrl: z.string(),
          }),
          503: z.object({
            id: z.string(),
            name: z.string(),
            healthy: z.literal(false),
            message: z.string(),
          }),
        },
      },
    },
    async (_req, res) => {
      try {
        const health = await toxiproxyService.getHealth();
        return res.status(200).send({
          id: health.id,
          name: health.name,
          version: health.version,
          healthy: health.healthy,
          proxyName: health.proxyName,
          trafficUrl: health.trafficUrl,
        });
      } catch (err: any) {
        return res.status(503).send({
          id: 'toxiproxy',
          name: 'Shopify Toxiproxy',
          healthy: false,
          message: `Unable to communicate with Toxiproxy engine: ${err.message}`,
        });
      }
    }
  );
};
