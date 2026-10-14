import { prisma } from './db.js';
import {
  CreateProfileInput,
  UpdateProfileInput,
  ProfileResponse,
  ListProfilesQuery,
  CreateProfileSchema,
} from '../schemas/profile.js';
import { NotFoundError, ConflictError } from '../errors/api-error.js';

function formatProfile(record: any): ProfileResponse {
  const parsedConfig = JSON.parse(record.config);
  const parsedTags = record.tags ? JSON.parse(record.tags) : [];

  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    engine: record.engine,
    target: parsedConfig.target,
    faults: parsedConfig.faults,
    requestCount: parsedConfig.requestCount,
    requestTimeoutMs: parsedConfig.requestTimeoutMs,
    successCriteria: parsedConfig.successCriteria,
    tags: parsedTags,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class ProfileService {
  async create(input: CreateProfileInput): Promise<ProfileResponse> {
    const validated = CreateProfileSchema.parse(input);

    const configPayload = {
      target: validated.target,
      faults: validated.faults,
      requestCount: validated.requestCount,
      requestTimeoutMs: validated.requestTimeoutMs,
      successCriteria: validated.successCriteria,
    };

    const record = await prisma.profile.create({
      data: {
        name: validated.name,
        description: validated.description ?? null,
        engine: validated.engine,
        config: JSON.stringify(configPayload),
        tags: JSON.stringify(validated.tags || []),
      },
    });

    return formatProfile(record);
  }

  async list(query: ListProfilesQuery): Promise<{
    items: ProfileResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.tag) {
      where.tags = {
        contains: query.tag,
      };
    }

    const [total, records] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      items: records.map(formatProfile),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getById(id: string): Promise<ProfileResponse> {
    const record = await prisma.profile.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`Profile with ID '${id}' was not found`);
    }

    return formatProfile(record);
  }

  async update(id: string, input: UpdateProfileInput): Promise<ProfileResponse> {
    const existing = await prisma.profile.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError(`Profile with ID '${id}' was not found`);
    }

    const existingConfig = JSON.parse(existing.config);
    const existingTags = existing.tags ? JSON.parse(existing.tags) : [];

    const mergedData = {
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      engine: input.engine ?? existing.engine,
      target: input.target ?? existingConfig.target,
      faults: input.faults ?? existingConfig.faults,
      requestCount: input.requestCount ?? existingConfig.requestCount,
      requestTimeoutMs: input.requestTimeoutMs ?? existingConfig.requestTimeoutMs,
      successCriteria: input.successCriteria !== undefined ? input.successCriteria : existingConfig.successCriteria,
      tags: input.tags ?? existingTags,
    };

    const validated = CreateProfileSchema.parse(mergedData);

    const configPayload = {
      target: validated.target,
      faults: validated.faults,
      requestCount: validated.requestCount,
      requestTimeoutMs: validated.requestTimeoutMs,
      successCriteria: validated.successCriteria,
    };

    const updated = await prisma.profile.update({
      where: { id },
      data: {
        name: validated.name,
        description: validated.description ?? null,
        engine: validated.engine,
        config: JSON.stringify(configPayload),
        tags: JSON.stringify(validated.tags || []),
      },
    });

    return formatProfile(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await prisma.profile.findUnique({
      where: { id },
      include: {
        runs: {
          where: {
            status: {
              in: ['queued', 'preparing', 'running', 'collecting'],
            },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError(`Profile with ID '${id}' was not found`);
    }

    if (existing.runs.length > 0) {
      throw new ConflictError(
        `Cannot delete profile '${id}': there are currently active runs for this profile. Cancel them first.`
      );
    }

    await prisma.profile.delete({
      where: { id },
    });
  }
}

export const profileService = new ProfileService();
