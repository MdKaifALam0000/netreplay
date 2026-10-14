import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportService } from '../services/report-service.js';
import { ReportQuerySchema } from '../schemas/run.js';
import { IdParamSchema, ErrorResponseSchema } from '../schemas/common.js';

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/v1/runs/:id/report',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Export experiment report',
        description: 'Generates a structured experiment report in either JSON or human-readable Markdown format.',
        params: IdParamSchema,
        querystring: ReportQuerySchema,
        response: {
          200: z.union([
            z.string(), // for markdown
            z.record(z.string(), z.unknown()), // for json
          ]),
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const { id } = req.params;
      const { format } = req.query;

      if (format === 'markdown') {
        const markdown = await reportService.generateMarkdown(id);
        return res
          .status(200)
          .header('Content-Type', 'text/markdown; charset=utf-8')
          .send(markdown);
      }

      const jsonReport = await reportService.generateJson(id);
      return res
        .status(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send(jsonReport as any);
    }
  );
};
