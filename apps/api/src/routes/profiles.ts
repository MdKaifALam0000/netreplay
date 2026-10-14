import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { profileService } from '../services/profile-service.js';
import {
  CreateProfileSchema,
  UpdateProfileSchema,
  ProfileResponseSchema,
  ListProfilesQuerySchema,
} from '../schemas/profile.js';
import { IdParamSchema, ErrorResponseSchema } from '../schemas/common.js';

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  // List profiles with pagination
  app.get(
    '/api/v1/profiles',
    {
      schema: {
        tags: ['Profiles'],
        summary: 'List experiment profiles',
        description: 'Retrieves a paginated list of saved experiment profiles, optionally filtered by tag.',
        querystring: ListProfilesQuerySchema,
        response: {
          200: z.object({
            items: z.array(ProfileResponseSchema),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
            totalPages: z.number(),
          }),
        },
      },
    },
    async (req, res) => {
      const result = await profileService.list(req.query);
      return res.status(200).send(result);
    }
  );

  // Create a profile
  app.post(
    '/api/v1/profiles',
    {
      schema: {
        tags: ['Profiles'],
        summary: 'Create an experiment profile',
        description: 'Creates a new experiment profile containing validated target and fault specifications.',
        body: CreateProfileSchema,
        response: {
          201: ProfileResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const created = await profileService.create(req.body);
      return res.status(201).send(created);
    }
  );

  // Retrieve a profile by ID
  app.get(
    '/api/v1/profiles/:id',
    {
      schema: {
        tags: ['Profiles'],
        summary: 'Retrieve an experiment profile',
        params: IdParamSchema,
        response: {
          200: ProfileResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const profile = await profileService.getById(req.params.id);
      return res.status(200).send(profile);
    }
  );

  // Update a profile
  app.patch(
    '/api/v1/profiles/:id',
    {
      schema: {
        tags: ['Profiles'],
        summary: 'Update an experiment profile',
        params: IdParamSchema,
        body: UpdateProfileSchema,
        response: {
          200: ProfileResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      const updated = await profileService.update(req.params.id, req.body);
      return res.status(200).send(updated);
    }
  );

  // Delete a profile
  app.delete(
    '/api/v1/profiles/:id',
    {
      schema: {
        tags: ['Profiles'],
        summary: 'Delete an experiment profile',
        params: IdParamSchema,
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, res) => {
      await profileService.delete(req.params.id);
      return res.status(204).send(null);
    }
  );
};
