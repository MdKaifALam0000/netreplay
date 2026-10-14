import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runService } from '../services/run-service.js';
import {
  StartRunSchema,
  RunResponseSchema,
  ListRunsQuerySchema,
  RequestResultResponseSchema,
  RunEventResponseSchema,
} from '../schemas/run.js';
import { IdParamSchema, ErrorResponseSchema } from '../schemas/common.js';

export const runRoutes: FastifyPluginAsyncZod = async (app) => {
  // Start an experiment run
  app.post(
    '/api/v1/runs',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Start an experiment run',
        description: 'Initiates a new experiment execution using a saved profile. Returns HTTP 202 with queued status.',
        body: StartRunSchema,
        response: {
          202: RunResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const run = await runService.start(req.body);
      return res.status(202).send(run);
    }
  );

  // List runs with pagination and filtering
  app.get(
    '/api/v1/runs',
    {
      schema: {
        tags: ['Runs'],
        summary: 'List experiment runs',
        description: 'Retrieves a paginated list of experiment runs with optional status or profile filters.',
        querystring: ListRunsQuerySchema,
        response: {
          200: z.object({
            items: z.array(RunResponseSchema),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
            totalPages: z.number(),
          }),
        },
      },
    },
    async (req, res) => {
      const result = await runService.list(req.query);
      return res.status(200).send(result);
    }
  );

  // Retrieve single run details
  app.get(
    '/api/v1/runs/:id',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Retrieve run details',
        description: 'Retrieves current status, configuration snapshot, and execution summary for a specific run.',
        params: IdParamSchema,
        response: {
          200: RunResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const run = await runService.getById(req.params.id);
      return res.status(200).send(run);
    }
  );

  // Retrieve run events
  app.get(
    '/api/v1/runs/:id/events',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Retrieve ordered run events',
        description: 'Returns chronological lifecycle and fault transition events recorded during the run.',
        params: IdParamSchema,
        response: {
          200: z.array(RunEventResponseSchema),
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const events = await runService.getEvents(req.params.id);
      return res.status(200).send(events);
    }
  );

  // Retrieve request-level measurements
  app.get(
    '/api/v1/runs/:id/requests',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Retrieve request measurements',
        description: 'Returns individual request latencies, status codes, outcomes, and timestamps.',
        params: IdParamSchema,
        response: {
          200: z.array(RequestResultResponseSchema),
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const requests = await runService.getRequests(req.params.id);
      return res.status(200).send(requests);
    }
  );

  // Replay a run from historical snapshot
  app.post(
    '/api/v1/runs/:id/replay',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Replay an experiment run',
        description: 'Starts a new run using the exact configuration snapshot of a past run.',
        params: IdParamSchema,
        response: {
          202: RunResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const replayed = await runService.replay(req.params.id);
      return res.status(202).send(replayed);
    }
  );

  // Cancel an active run
  app.post(
    '/api/v1/runs/:id/cancel',
    {
      schema: {
        tags: ['Runs'],
        summary: 'Cancel an active experiment run',
        description: 'Requests immediate cancellation of a running experiment and triggers guaranteed fault cleanup.',
        params: IdParamSchema,
        response: {
          200: RunResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const cancelled = await runService.cancel(req.params.id);
      return res.status(200).send(cancelled);
    }
  );
};
