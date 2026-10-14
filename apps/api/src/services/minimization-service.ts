import { prisma } from './db.js';
import { experimentRunner } from './experiment-runner.js';
import { minimizerEngine } from './minimizer.js';
import {
  StartMinimizationInput,
  MinimizationResponse,
  MinimizationAttemptResponse,
} from '../schemas/minimization.js';
import { NotFoundError, ConflictError, BadRequestError } from '../errors/api-error.js';
import { Fault } from '../schemas/profile.js';

function formatMinimization(record: any): MinimizationResponse {
  const originalSnapshot = JSON.parse(record.originalConfigSnapshot);
  const originalFaults: Fault[] = originalSnapshot.faults || [];
  const minimizedFaults: Fault[] | null = record.minimizedConfig ? JSON.parse(record.minimizedConfig) : null;
  const predicate = JSON.parse(record.predicate);

  const differences = minimizedFaults ? minimizerEngine.computeDifferences(originalFaults, minimizedFaults) : null;

  return {
    id: record.id,
    sourceRunId: record.sourceRunId,
    status: record.status as any,
    originalConfigSnapshot: originalSnapshot,
    minimizedConfig: minimizedFaults,
    predicate,
    minReproductionRate: record.minReproductionRate,
    strategy: record.strategy,
    maxAttempts: record.maxAttempts,
    attemptsUsed: record.attemptsUsed,
    trialsPerCandidate: record.trialsPerCandidate,
    finalTrials: record.finalTrials,
    finalObservedRate: record.finalObservedRate,
    cleanupStatus: record.cleanupStatus,
    differences,
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    durationMs: record.durationMs ?? null,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function formatAttempt(record: any): MinimizationAttemptResponse {
  return {
    id: record.id,
    minimizationId: record.minimizationId,
    attemptNumber: record.attemptNumber,
    stage: record.stage,
    changeDesc: record.changeDesc,
    candidateConfig: JSON.parse(record.candidateConfig),
    triggered: record.triggered,
    trialCount: record.trialCount,
    failedTrials: record.failedTrials,
    reproductionRate: record.reproductionRate,
    durationMs: record.durationMs,
    outcome: record.outcome,
    reason: record.reason ?? null,
    details: record.details ? JSON.parse(record.details) : null,
    timestamp: record.timestamp.toISOString(),
  };
}

export class MinimizationService {
  async start(runId: string, input: StartMinimizationInput): Promise<MinimizationResponse> {
    if (experimentRunner.isBusy()) {
      const activeId = experimentRunner.getActiveRunId();
      throw new ConflictError(
        `An experiment run is currently executing on the proxy (Run ID: '${activeId}'). Concurrent minimization is not permitted.`
      );
    }

    if (minimizerEngine.isBusy()) {
      const activeMinId = minimizerEngine.getActiveMinimizationId();
      throw new ConflictError(
        `Another failure minimization job is already running (Minimization ID: '${activeMinId}'). Concurrent minimization is not permitted.`
      );
    }

    const run = await prisma.run.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new NotFoundError(`Run with ID '${runId}' was not found`);
    }

    if (run.status === 'running' || run.status === 'preparing' || run.status === 'collecting') {
      throw new BadRequestError(`Cannot minimize active run '${runId}' with status '${run.status}'`);
    }

    let parsedSnapshot: any;
    try {
      parsedSnapshot = JSON.parse(run.configSnapshot);
    } catch {
      throw new BadRequestError(`Run '${runId}' contains an invalid or unparseable configuration snapshot`);
    }

    if (!parsedSnapshot.faults || !Array.isArray(parsedSnapshot.faults)) {
      throw new BadRequestError(`Run '${runId}' does not contain any configured faults to minimize`);
    }

    const minimization = await prisma.minimization.create({
      data: {
        sourceRunId: run.id,
        status: 'queued',
        originalConfigSnapshot: run.configSnapshot,
        predicate: JSON.stringify(input.predicate),
        minReproductionRate: input.minReproductionRate,
        strategy: input.strategy,
        maxAttempts: input.maxAttempts,
        trialsPerCandidate: input.trialsPerCandidate,
        finalTrials: input.finalTrials,
      },
    });

    // Run asynchronously in the background
    minimizerEngine
      .execute(minimization.id, parsedSnapshot, input)
      .catch((err) => {
        console.error(`[Minimizer] Unhandled failure in background job ${minimization.id}:`, err);
      });

    return formatMinimization(minimization);
  }

  async getById(id: string): Promise<MinimizationResponse> {
    const record = await prisma.minimization.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`Minimization with ID '${id}' was not found`);
    }

    return formatMinimization(record);
  }

  async getAttempts(minimizationId: string): Promise<MinimizationAttemptResponse[]> {
    const exists = await prisma.minimization.findUnique({
      where: { id: minimizationId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundError(`Minimization with ID '${minimizationId}' was not found`);
    }

    const attempts = await prisma.minimizationAttempt.findMany({
      where: { minimizationId },
      orderBy: { attemptNumber: 'asc' },
    });

    return attempts.map(formatAttempt);
  }

  async cancel(id: string): Promise<MinimizationResponse> {
    const record = await prisma.minimization.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundError(`Minimization with ID '${id}' was not found`);
    }

    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') {
      return formatMinimization(record);
    }

    const cancelled = minimizerEngine.cancel(id);
    if (!cancelled) {
      // If it wasn't actively executing in engine, update record directly
      const updated = await prisma.minimization.update({
        where: { id },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
        },
      });
      return formatMinimization(updated);
    }

    // Give a brief moment for the cancellation to propagate and return updated record
    const updated = await prisma.minimization.findUnique({ where: { id } });
    return formatMinimization(updated || record);
  }
}

export const minimizationService = new MinimizationService();
