/**
 * NetReplay Fastify Application Factory
 *
 * Initializes Fastify instance, registers Zod type provider, Swagger documentation,
 * centralized error handlers, and versioned REST routes.
 */

import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { registerSwagger } from './plugins/swagger.js';
import { healthRoutes } from './routes/health.js';
import { engineRoutes } from './routes/engines.js';
import { profileRoutes } from './routes/profiles.js';
import { runRoutes } from './routes/runs.js';
import { reportRoutes } from './routes/reports.js';
import { ApiError } from './errors/api-error.js';
import { config } from './config.js';

export async function buildApp(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.logLevel,
    },
    ...options,
  }).withTypeProvider<ZodTypeProvider>();

  // Register Zod compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Register Swagger documentation
  await registerSwagger(app);

  // Centralized Error Handling
  app.setErrorHandler((error, _request, reply) => {
    // Schema / Zod validation errors
    if (
      error instanceof ZodError ||
      (error as any).name === 'ZodError' ||
      Array.isArray((error as any).validation)
    ) {
      const issues = (error as any).issues || (error as any).validation || [];
      return reply.status(400).send({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'Request validation failed',
        details: Array.isArray(issues)
          ? issues.map((i: any) => ({
              field: i.path
                ? Array.isArray(i.path)
                  ? i.path.join('.')
                  : String(i.path)
                : i.params?.issue?.path?.join('.') || 'body',
              message: i.message,
            }))
          : issues,
      });
    }

    // Typed Domain API Errors
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.errorCode,
        message: error.message,
        details: error.details,
      });
    }

    // Fastify built-in HTTP errors (e.g. 404, 400)
    const errObj = error as any;
    if (typeof errObj?.statusCode === 'number' && errObj.statusCode < 500) {
      return reply.status(errObj.statusCode).send({
        statusCode: errObj.statusCode,
        error: errObj.name || 'CLIENT_ERROR',
        message: errObj.message || 'Client error',
      });
    }

    // Unexpected internal server errors (mask stack traces)
    app.log.error(error);
    return reply.status(500).send({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
    });
  });

  // Register REST routes
  await app.register(healthRoutes);
  await app.register(engineRoutes);
  await app.register(profileRoutes);
  await app.register(runRoutes);
  await app.register(reportRoutes);

  return app;
}
