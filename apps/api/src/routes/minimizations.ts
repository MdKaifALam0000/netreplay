import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { minimizationService } from '../services/minimization-service.js';
import {
  StartMinimizationSchema,
  MinimizationResponseSchema,
  MinimizationAttemptResponseSchema,
} from '../schemas/minimization.js';
import { IdParamSchema, ErrorResponseSchema } from '../schemas/common.js';

export const minimizationRoutes: FastifyPluginAsyncZod = async (app) => {
  // Start failure minimization for a completed/failed run
  app.post(
    '/api/v1/runs/:id/minimize',
    {
      schema: {
        tags: ['Minimization'],
        summary: 'Start failure minimization',
        description:
          'Enqueues an automatic search to discover the simplest network fault configuration that still reproduces the specified failure condition. Returns HTTP 202 with queued status.',
        params: IdParamSchema,
        body: StartMinimizationSchema,
        response: {
          202: MinimizationResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const minimization = await minimizationService.start(req.params.id, req.body);
      return res.status(202).send(minimization);
    }
  );

  // Get minimization status and configuration
  app.get(
    '/api/v1/minimizations/:id',
    {
      schema: {
        tags: ['Minimization'],
        summary: 'Get failure minimization status',
        description: 'Retrieves current status, minimized configuration, parameter reductions, and summary of a minimization job.',
        params: IdParamSchema,
        response: {
          200: MinimizationResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const minimization = await minimizationService.getById(req.params.id);
      return res.status(200).send(minimization);
    }
  );

  // Get search history / attempts
  app.get(
    '/api/v1/minimizations/:id/attempts',
    {
      schema: {
        tags: ['Minimization'],
        summary: 'Get minimization search attempts',
        description: 'Retrieves the complete search attempt history detailing each fault candidate evaluated, trial counts, and outcomes.',
        params: IdParamSchema,
        response: {
          200: z.object({
            items: z.array(MinimizationAttemptResponseSchema),
            total: z.number(),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const attempts = await minimizationService.getAttempts(req.params.id);
      return res.status(200).send({
        items: attempts,
        total: attempts.length,
      });
    }
  );

  // Cancel an active minimization job
  app.post(
    '/api/v1/minimizations/:id/cancel',
    {
      schema: {
        tags: ['Minimization'],
        summary: 'Cancel minimization job',
        description: 'Requests immediate cancellation of an active minimization search. Cleanly restores proxy state.',
        params: IdParamSchema,
        response: {
          200: MinimizationResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const result = await minimizationService.cancel(req.params.id);
      return res.status(200).send(result);
    }
  );
};
