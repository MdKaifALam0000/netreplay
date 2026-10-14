import { prisma } from './db.js';
import { experimentRunner } from './experiment-runner.js';
import { toxiproxyService } from './toxiproxy-service.js';
import {
  StartRunInput,
  RunResponse,
  ListRunsQuery,
  RequestResultResponse,
  RunEventResponse,
  ConfigSnapshot,
} from '../schemas/run.js';
import { NotFoundError, ConflictError, BadRequestError } from '../errors/api-error.js';

import { minimizerEngine } from './minimizer.js';

function formatRun(record: any): RunResponse {
  const parsedSnapshot = JSON.parse(record.configSnapshot);
  const parsedSummary = record.summary ? JSON.parse(record.summary) : null;

  return {
    id: record.id,
    profileId: record.profileId ?? null,
    replayedFromId: record.replayedFromId ?? null,
    status: record.status as any,
    configSnapshot: parsedSnapshot,
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    summary: parsedSummary,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class RunService {
  async start(input: StartRunInput): Promise<RunResponse> {
    if (experimentRunner.isBusy() || minimizerEngine.isBusy()) {
      const activeId = experimentRunner.getActiveRunId() || minimizerEngine.getActiveMinimizationId();
      throw new ConflictError(
        `A network experiment or failure minimization is already in progress (Active ID: '${activeId}'). Concurrent proxy operations are not permitted.`
      );
    }

    const profile = await prisma.profile.findUnique({
      where: { id: input.profileId },
    });

    if (!profile) {
      throw new NotFoundError(`Profile with ID '${input.profileId}' was not found`);
    }

    const parsedConfig = JSON.parse(profile.config);
    const parsedTags = profile.tags ? JSON.parse(profile.tags) : [];

    let engineVersion = 'unknown';
    try {
      const health = await toxiproxyService.getHealth();
      engineVersion = health.version;
    } catch {
      // Best-effort engine version capture
    }

    const snapshot: ConfigSnapshot = {
      profileName: profile.name,
      engine: profile.engine,
      target: parsedConfig.target,
      faults: parsedConfig.faults,
      requestCount: parsedConfig.requestCount,
      requestTimeoutMs: parsedConfig.requestTimeoutMs,
      successCriteria: parsedConfig.successCriteria,
      tags: parsedTags,
      engineVersion,
    };

    const run = await prisma.run.create({
      data: {
        profileId: profile.id,
        status: 'queued',
        configSnapshot: JSON.stringify(snapshot),
      },
    });

    // Schedule background execution (non-blocking HTTP response)
    void experimentRunner.execute(run.id, snapshot);

    return formatRun(run);
  }

  async list(query: ListRunsQuery): Promise<{
    items: RunResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.profileId) {
      where.profileId = query.profileId;
    }

    const [total, records] = await Promise.all([
      prisma.run.count({ where }),
      prisma.run.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      items: records.map(formatRun),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getById(id: string): Promise<RunResponse> {
    const record = await prisma.run.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`Run with ID '${id}' was not found`);
    }

    return formatRun(record);
  }

  async getEvents(id: string): Promise<RunEventResponse[]> {
    const run = await prisma.run.findUnique({
      where: { id },
    });

    if (!run) {
      throw new NotFoundError(`Run with ID '${id}' was not found`);
    }

    const events = await prisma.runEvent.findMany({
      where: { runId: id },
      orderBy: { timestamp: 'asc' },
    });

    return events.map((e) => ({
      id: e.id,
      runId: e.runId,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      details: e.details ? JSON.parse(e.details) : null,
    }));
  }

  async getRequests(id: string): Promise<RequestResultResponse[]> {
    const run = await prisma.run.findUnique({
      where: { id },
    });

    if (!run) {
      throw new NotFoundError(`Run with ID '${id}' was not found`);
    }

    const requests = await prisma.requestResult.findMany({
      where: { runId: id },
      orderBy: { requestIndex: 'asc' },
    });

    return requests.map((r) => ({
      id: r.id,
      runId: r.runId,
      requestIndex: r.requestIndex,
      outcome: r.outcome as any,
      statusCode: r.statusCode ?? null,
      latencyMs: r.latencyMs,
      errorCategory: r.errorCategory ?? null,
      timestamp: r.timestamp.toISOString(),
    }));
  }

  async replay(id: string): Promise<RunResponse> {
    if (experimentRunner.isBusy()) {
      const activeId = experimentRunner.getActiveRunId();
      throw new ConflictError(
        `An experiment is already in progress (Run ID: '${activeId}'). Concurrent experiments on the proxy are not permitted.`
      );
    }

    const sourceRun = await prisma.run.findUnique({
      where: { id },
    });

    if (!sourceRun) {
      throw new NotFoundError(`Source run with ID '${id}' was not found`);
    }

    const snapshot: ConfigSnapshot = JSON.parse(sourceRun.configSnapshot);

    const replayedRun = await prisma.run.create({
      data: {
        profileId: sourceRun.profileId,
        replayedFromId: sourceRun.id,
        status: 'queued',
        configSnapshot: sourceRun.configSnapshot,
      },
    });

    // Schedule background replay execution
    void experimentRunner.execute(replayedRun.id, snapshot);

    return formatRun(replayedRun);
  }

  async cancel(id: string): Promise<RunResponse> {
    const run = await prisma.run.findUnique({
      where: { id },
    });

    if (!run) {
      throw new NotFoundError(`Run with ID '${id}' was not found`);
    }

    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      throw new BadRequestError(`Cannot cancel run '${id}': run is already in terminal state '${run.status}'`);
    }

    // Attempt cancellation via runner signal
    const wasActive = experimentRunner.cancel(id);

    if (!wasActive && ['queued', 'preparing'].includes(run.status)) {
      await prisma.run.update({
        where: { id },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
          errorMessage: 'Run was cancelled before execution started',
        },
      });
      await prisma.runEvent.create({
        data: {
          runId: id,
          eventType: 'cancelled',
          details: JSON.stringify({ reason: 'Cancelled prior to active measurement phase' }),
        },
      });
    }

    return this.getById(id);
  }
}

export const runService = new RunService();
