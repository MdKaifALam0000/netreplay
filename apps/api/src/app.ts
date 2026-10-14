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
import { minimizationRoutes } from './routes/minimizations.js';
import { ApiError } from './errors/api-error.js';
import { config } from './config.js';

export async function buildApp(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: config.requestBodyLimit,
    connectionTimeout: config.connectionTimeoutMs,
    logger: options.logger ?? {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    ...options,
  }).withTypeProvider<ZodTypeProvider>();

  // Register Zod compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Security headers hook
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // Register CORS restricted to configured local frontend origins
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. curl, test runners, server-to-server)
      if (!origin) {
        return cb(null, true);
      }
      if (config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`Origin '${origin}' not allowed by CORS`), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Register Swagger documentation
  await registerSwagger(app);

  // Centralized Error Handling
  app.setErrorHandler((error, _request, reply) => {
    // Payload too large error (413)
    if (
      (error as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
      (error as any).statusCode === 413
    ) {
      return reply.status(413).send({
        statusCode: 413,
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds the maximum permitted limit of 1MB',
      });
    }

    // CORS forbidden error
    const errorMessage = (error as any)?.message || '';
    if (errorMessage.includes('not allowed by CORS')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'FORBIDDEN',
        message: errorMessage,
      });
    }

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
  await app.register(minimizationRoutes);

  return app;
}
