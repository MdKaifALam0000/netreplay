import { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'NetReplay REST API',
        description: 'REST API for orchestrating network failure reproduction experiments, tracking execution metrics, and generating reports.',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://127.0.0.1:3100',
          description: 'Local development server',
        },
      ],
      tags: [
        { name: 'Health', description: 'Application readiness and liveness checks' },
        { name: 'Engines', description: 'Network fault injection engines and capability reporting' },
        { name: 'Profiles', description: 'Experiment profile lifecycle management' },
        { name: 'Runs', description: 'Experiment run scheduling, replay, and cancellation' },
        { name: 'Reports', description: 'Structured JSON and Markdown report export' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });
}
