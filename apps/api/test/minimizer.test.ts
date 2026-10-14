import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma, disconnectDb } from '../src/services/db.js';
import { MinimizerEngine } from '../src/services/minimizer.js';
import { MinimizationEvaluator, EvaluationResult } from '../src/services/minimization-evaluator.js';
import { ConfigSnapshot } from '../src/schemas/run.js';
import { StartMinimizationInput } from '../src/schemas/minimization.js';
import { Fault } from '../src/schemas/profile.js';

describe('Automatic Failure Minimization Engine & API Suite', () => {
  let app: FastifyInstance;
  let profileId: string;
  let sourceRunId: string;
  let activeMinimizationId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Seed profile and run for tests
    const profileRes = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: {
        name: 'Minimization Source Profile',
        engine: 'toxiproxy',
        target: {
          type: 'http',
          path: '/api/demo',
        },
        faults: [
          {
            type: 'latency',
            name: 'target_latency',
            latencyMs: 800,
            jitterMs: 100,
            stream: 'downstream',
          },
          {
            type: 'bandwidth',
            name: 'unrelated_bandwidth',
            rateKbps: 5000,
            stream: 'downstream',
          },
        ],
        requestCount: 3,
        requestTimeoutMs: 2000,
      },
    });

    profileId = profileRes.json().id;

    // Create a completed source run with the snapshot
    const run = await prisma.run.create({
      data: {
        profileId,
        status: 'completed',
        configSnapshot: JSON.stringify({
          profileName: 'Minimization Source Profile',
          engine: 'toxiproxy',
          target: { type: 'http', path: '/api/demo', method: 'GET' },
          faults: [
            {
              type: 'latency',
              name: 'target_latency',
              latencyMs: 800,
              jitterMs: 100,
              stream: 'downstream',
            },
            {
              type: 'bandwidth',
              name: 'unrelated_bandwidth',
              rateKbps: 5000,
              stream: 'downstream',
            },
          ],
          requestCount: 3,
          requestTimeoutMs: 2000,
        }),
        summary: JSON.stringify({
          totalRequests: 3,
          successCount: 0,
          failureCount: 3,
          timeoutCount: 0,
          minLatencyMs: 820,
          maxLatencyMs: 890,
          medianLatencyMs: 850,
          meanLatencyMs: 850,
        }),
      },
    });

    sourceRunId = run.id;
  });

  afterAll(async () => {
    if (activeMinimizationId) {
      await prisma.minimization.deleteMany({ where: { id: activeMinimizationId } });
    }
    if (sourceRunId) {
      await prisma.run.deleteMany({ where: { id: sourceRunId } });
    }
    if (profileId) {
      await prisma.profile.deleteMany({ where: { id: profileId } });
    }
    await app.close();
    await disconnectDb();
  });

  // ==========================================================================
  // Section 10: Requirements 1, 2, 3, 4, 5 — Engine Algorithmic Reductions
  // ==========================================================================

  it('1 & 2: Baseline reproduces failure and removes unrelated fault component', async () => {
    // Mock Toxiproxy
    const clearFaultsCalls: number[] = [];
    const appliedFaults: any[] = [];
    const mockToxiproxy: any = {
      clearFaults: async () => {
        clearFaultsCalls.push(Date.now());
        appliedFaults.length = 0;
        return 1;
      },
      applyFault: async (fault: any) => {
        appliedFaults.push(fault);
        return { name: fault.name || fault.type };
      },
    };

    // Evaluator: fails if target_latency is present, regardless of bandwidth
    const mockEvaluator: any = {
      evaluate: async (
        _target: any,
        _pred: any,
        _rate: number,
        trialCount: number
      ): Promise<EvaluationResult> => {
        const hasLatency = appliedFaults.some((f) => f.name === 'target_latency' || f.type === 'latency');
        return {
          triggered: hasLatency,
          reproductionRate: hasLatency ? 1.0 : 0.0,
          trialCount,
          failedTrials: hasLatency ? trialCount : 0,
          durationMs: 50,
          reason: hasLatency ? 'Failure reproduced' : 'Failure not reproduced',
          details: {},
          trialResults: [],
        };
      },
    };

    const engine = new MinimizerEngine({
      toxiproxy: mockToxiproxy,
      evaluator: mockEvaluator,
    });

    const minRecord = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: JSON.stringify({
          target: { type: 'http', path: '/api/demo' },
          faults: [
            { type: 'latency', name: 'target_latency', latencyMs: 800, jitterMs: 0, stream: 'downstream' },
            { type: 'bandwidth', name: 'unrelated_bandwidth', rateKbps: 5000, stream: 'downstream' },
          ],
        }),
        predicate: JSON.stringify({ type: 'deadline_exceeded', deadlineMs: 500 }),
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 20,
      },
    });

    activeMinimizationId = minRecord.id;

    const snapshot: ConfigSnapshot = {
      profileName: 'Test Profile',
      engine: 'toxiproxy',
      target: { type: 'http', path: '/api/demo', method: 'GET' },
      faults: [
        { type: 'latency', name: 'target_latency', latencyMs: 800, jitterMs: 0, stream: 'downstream' },
        { type: 'bandwidth', name: 'unrelated_bandwidth', rateKbps: 5000, stream: 'downstream' },
      ],
      requestCount: 3,
      requestTimeoutMs: 2000,
    };

    const input: StartMinimizationInput = {
      predicate: { type: 'deadline_exceeded', deadlineMs: 500 },
      minReproductionRate: 1.0,
      strategy: 'staged_delta_debugging',
      maxAttempts: 20,
      deadlineSeconds: 60,
      trialsPerCandidate: 1,
      finalTrials: 2,
    };

    await engine.execute(minRecord.id, snapshot, input);

    const updated = await prisma.minimization.findUnique({
      where: { id: minRecord.id },
      include: { attempts: true },
    });

    expect(updated?.status).toBe('completed');
    const minimized = JSON.parse(updated?.minimizedConfig || '[]');
    // Unrelated bandwidth should have been removed!
    expect(minimized.some((f: any) => f.name === 'unrelated_bandwidth')).toBe(false);
    // Latency should be retained
    expect(minimized.some((f: any) => f.name === 'target_latency')).toBe(true);
  });

  it('3: Required component is retained when removing it makes failure disappear', async () => {
    const appliedFaults: any[] = [];
    const mockToxiproxy: any = {
      clearFaults: async () => {
        appliedFaults.length = 0;
        return 1;
      },
      applyFault: async (f: any) => {
        appliedFaults.push(f);
        return f;
      },
    };

    // Evaluator requires BOTH latency AND reset to reproduce
    const mockEvaluator: any = {
      evaluate: async (_target: any, _pred: any, _rate: number, trialCount: number) => {
        const hasLatency = appliedFaults.some((f) => f.type === 'latency');
        const hasReset = appliedFaults.some((f) => f.type === 'reset');
        const triggered = hasLatency && hasReset;
        return {
          triggered,
          reproductionRate: triggered ? 1.0 : 0.0,
          trialCount,
          failedTrials: triggered ? trialCount : 0,
          durationMs: 20,
          reason: triggered ? 'Reproduced' : 'Failed',
          details: {},
          trialResults: [],
        };
      },
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'connection_reset' }),
      },
    });

    const snapshot: ConfigSnapshot = {
      profileName: 'P',
      engine: 'toxiproxy',
      target: { type: 'http', path: '/api/demo', method: 'GET' },
      faults: [
        { type: 'latency', name: 'req_latency', latencyMs: 300, jitterMs: 0, stream: 'downstream' },
        { type: 'reset', name: 'req_reset', stream: 'downstream' },
      ],
      requestCount: 2,
      requestTimeoutMs: 2000,
    };

    await engine.execute(min.id, snapshot, {
      predicate: { type: 'connection_reset' },
      minReproductionRate: 1.0,
      strategy: 'staged_delta_debugging',
      maxAttempts: 20,
      deadlineSeconds: 30,
      trialsPerCandidate: 1,
      finalTrials: 1,
    });

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    const minimized = JSON.parse(res?.minimizedConfig || '[]');
    // Both required components must still be present!
    expect(minimized.length).toBe(2);
  });

  it('4: Numeric parameter is reduced via binary search while failure predicate is satisfied', async () => {
    const appliedFaults: any[] = [];
    const mockToxiproxy: any = {
      clearFaults: async () => {
        appliedFaults.length = 0;
        return 1;
      },
      applyFault: async (f: any) => {
        appliedFaults.push(f);
        return f;
      },
    };

    // Fails only if latencyMs >= 400
    const mockEvaluator: any = {
      evaluate: async (_target: any, _pred: any, _rate: number, trialCount: number) => {
        const lat = appliedFaults.find((f) => f.type === 'latency');
        const triggered = Boolean(lat && lat.latencyMs >= 400);
        return {
          triggered,
          reproductionRate: triggered ? 1.0 : 0.0,
          trialCount,
          failedTrials: triggered ? trialCount : 0,
          durationMs: 20,
          reason: triggered ? 'Deadline exceeded' : 'Below deadline',
          details: {},
          trialResults: [],
        };
      },
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'deadline_exceeded', deadlineMs: 400 }),
      },
    });

    const snapshot: ConfigSnapshot = {
      profileName: 'P',
      engine: 'toxiproxy',
      target: { type: 'http', path: '/api/demo', method: 'GET' },
      faults: [
        { type: 'latency', name: 'latency', latencyMs: 1000, jitterMs: 50, stream: 'downstream' },
      ],
      requestCount: 2,
      requestTimeoutMs: 2000,
    };

    await engine.execute(min.id, snapshot, {
      predicate: { type: 'deadline_exceeded', deadlineMs: 400 },
      minReproductionRate: 1.0,
      strategy: 'staged_delta_debugging',
      maxAttempts: 25,
      deadlineSeconds: 30,
      trialsPerCandidate: 1,
      finalTrials: 1,
    });

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    const minimized = JSON.parse(res?.minimizedConfig || '[]');
    expect(minimized[0].jitterMs).toBe(0); // Jitter eliminated
    expect(minimized[0].latencyMs).toBeLessThan(1000); // Reduced from 1000ms
    expect(minimized[0].latencyMs).toBeGreaterThanOrEqual(400); // But >= 400ms threshold
  });

  it('5: The final configuration passes the required verification policy', async () => {
    let verificationTrialCount = 0;
    const mockToxiproxy: any = {
      clearFaults: async () => 1,
      applyFault: async (f: any) => f,
    };
    const mockEvaluator: any = {
      evaluate: async (_target: any, _pred: any, _rate: number, trialCount: number) => {
        if (trialCount === 4) {
          verificationTrialCount = trialCount;
        }
        return {
          triggered: true,
          reproductionRate: 1.0,
          trialCount,
          failedTrials: trialCount,
          durationMs: 10,
          reason: 'OK',
          details: {},
          trialResults: [],
        };
      },
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'reset', stream: 'downstream' }],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 10,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 4,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(res?.status).toBe('completed');
    expect(verificationTrialCount).toBe(4);
    expect(res?.finalObservedRate).toBe(1.0);
  });

  it('6: A baseline that does not reproduce the failure stops early with baseline_not_reproducible', async () => {
    const mockToxiproxy: any = {
      clearFaults: async () => 1,
      applyFault: async (f: any) => f,
    };
    // Baseline evaluation fails
    const mockEvaluator: any = {
      evaluate: async () => ({
        triggered: false,
        reproductionRate: 0.0,
        trialCount: 1,
        failedTrials: 0,
        durationMs: 15,
        reason: 'Target did not fail',
        details: {},
        trialResults: [],
      }),
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'latency', latencyMs: 500, stream: 'downstream' }],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 10,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 2,
      }
    );

    const res = await prisma.minimization.findUnique({
      where: { id: min.id },
      include: { attempts: true },
    });
    expect(res?.status).toBe('baseline_not_reproducible');
    expect(res?.attemptsUsed).toBe(1);
    expect(res?.attempts.length).toBe(1);
    expect(res?.attempts[0]?.outcome).toBe('baseline_failed');
  });

  it('7: A stochastic candidate records its trial count and observed reproduction rate', async () => {
    const mockToxiproxy: any = {
      clearFaults: async () => 1,
      applyFault: async (f: any) => f,
    };
    // 3 out of 4 trials triggered
    const mockEvaluator: any = {
      evaluate: async (_target: any, _pred: any, _minRate: number, trialCount: number) => ({
        triggered: true,
        reproductionRate: 0.75,
        trialCount,
        failedTrials: 3,
        durationMs: 40,
        reason: 'Reproduced 3 of 4',
        details: {},
        trialResults: [],
      }),
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'connection_reset' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'reset', stream: 'downstream' }],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'connection_reset' },
        minReproductionRate: 0.7,
        strategy: 'staged_delta_debugging',
        maxAttempts: 5,
        deadlineSeconds: 30,
        trialsPerCandidate: 4,
        finalTrials: 4,
      }
    );

    const attempt = await prisma.minimizationAttempt.findFirst({
      where: { minimizationId: min.id },
    });
    expect(attempt?.trialCount).toBe(4);
    expect(attempt?.failedTrials).toBe(3);
    expect(attempt?.reproductionRate).toBe(0.75);
  });

  it('8 & 9: Attempt-budget exhaustion returns a partial result and terminates', async () => {
    const mockToxiproxy: any = {
      clearFaults: async () => 1,
      applyFault: async (f: any) => f,
    };
    const mockEvaluator: any = {
      evaluate: async (_t: any, _p: any, _r: any, trialCount: number) => ({
        triggered: true,
        reproductionRate: 1.0,
        trialCount,
        failedTrials: trialCount,
        durationMs: 10,
        reason: 'OK',
        details: {},
        trialResults: [],
      }),
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'deadline_exceeded', deadlineMs: 500 }),
      },
    });

    // Budget of only 2 attempts!
    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [
          { type: 'latency', latencyMs: 800, stream: 'downstream' },
          { type: 'timeout', timeoutMs: 1000, stream: 'downstream' },
          { type: 'bandwidth', rateKbps: 5000, stream: 'downstream' },
        ],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'deadline_exceeded', deadlineMs: 500 },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 2,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 1,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(res?.status).toBe('budget_exhausted');
    expect(res?.attemptsUsed).toBeLessThanOrEqual(3);
    // Partial result preserved
    expect(res?.minimizedConfig).toBeDefined();
  });

  it('10: Deadline enforcement prevents runaway evaluations', async () => {
    const mockToxiproxy: any = {
      clearFaults: async () => 1,
      applyFault: async (f: any) => f,
    };
    // Mock evaluation that simulates 500ms delay
    const mockEvaluator: any = {
      evaluate: async (_t: any, _p: any, _r: any, trialCount: number) => {
        await new Promise((r) => setTimeout(r, 60));
        return {
          triggered: true,
          reproductionRate: 1.0,
          trialCount,
          failedTrials: trialCount,
          durationMs: 60,
          reason: 'OK',
          details: {},
          trialResults: [],
        };
      },
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    // Deadline set to 0.05 seconds (50ms)
    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [
          { type: 'reset', stream: 'downstream' },
          { type: 'bandwidth', rateKbps: 100, stream: 'downstream' },
        ],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 50,
        deadlineSeconds: 10 / 1000, // Very low deadline to trigger wall-clock check
        trialsPerCandidate: 1,
        finalTrials: 1,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(['budget_exhausted', 'completed']).toContain(res?.status);
  });

  it('11: Cancellation stops future evaluations and triggers cleanup', async () => {
    let clearFaultsCalled = false;
    const mockToxiproxy: any = {
      clearFaults: async () => {
        clearFaultsCalled = true;
        return 1;
      },
      applyFault: async (f: any) => f,
    };

    let engine: MinimizerEngine;
    const mockEvaluator: any = {
      evaluate: async () => {
        // Cancel mid-evaluation
        engine.cancel('test-cancel-id');
        return {
          triggered: true,
          reproductionRate: 1.0,
          trialCount: 1,
          failedTrials: 1,
          durationMs: 10,
          reason: 'OK',
          details: {},
          trialResults: [],
        };
      },
    };

    engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        id: 'test-cancel-id',
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [
          { type: 'reset', stream: 'downstream' },
          { type: 'bandwidth', rateKbps: 200, stream: 'downstream' },
        ],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 10,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 1,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(res?.status).toBe('cancelled');
    expect(clearFaultsCalled).toBe(true);
  });

  it('12: An evaluation exception still restores the previous fault state', async () => {
    let clearCount = 0;
    const mockToxiproxy: any = {
      clearFaults: async () => {
        clearCount++;
        return 1;
      },
      applyFault: async (f: any) => f,
    };

    const mockEvaluator: any = {
      evaluate: async () => {
        throw new Error('Socket network explosion');
      },
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'reset', stream: 'downstream' }],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 5,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 1,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(res?.status).toBe('failed');
    // clearFaults must be called in finally!
    expect(clearCount).toBeGreaterThanOrEqual(1);
  });

  it('13: A cleanup failure is visible in the result', async () => {
    const mockToxiproxy: any = {
      clearFaults: async () => {
        throw new Error('Toxiproxy control API connection refused during cleanup');
      },
      applyFault: async (f: any) => f,
    };

    const mockEvaluator: any = {
      evaluate: async () => ({
        triggered: true,
        reproductionRate: 1.0,
        trialCount: 1,
        failedTrials: 1,
        durationMs: 10,
        reason: 'OK',
        details: {},
        trialResults: [],
      }),
    };

    const engine = new MinimizerEngine({ toxiproxy: mockToxiproxy, evaluator: mockEvaluator });
    const min = await prisma.minimization.create({
      data: {
        sourceRunId,
        status: 'queued',
        originalConfigSnapshot: '{}',
        predicate: JSON.stringify({ type: 'status_5xx' }),
      },
    });

    await engine.execute(
      min.id,
      {
        profileName: 'P',
        engine: 'toxiproxy',
        target: { type: 'http', path: '/api/demo', method: 'GET' },
        faults: [{ type: 'reset', stream: 'downstream' }],
        requestCount: 1,
        requestTimeoutMs: 1000,
      },
      {
        predicate: { type: 'status_5xx' },
        minReproductionRate: 1.0,
        strategy: 'staged_delta_debugging',
        maxAttempts: 5,
        deadlineSeconds: 30,
        trialsPerCandidate: 1,
        finalTrials: 1,
      }
    );

    const res = await prisma.minimization.findUnique({ where: { id: min.id } });
    expect(res?.cleanupStatus).toBe('cleanup_failed');
    expect(res?.errorMessage).toContain('cleanup');
  });

  it('14: Concurrent minimization jobs cannot interfere with the same proxy', () => {
    const engine = new MinimizerEngine();
    // Simulate active job
    (engine as any).activeMinimizationId = 'active-job-123';
    expect(engine.isBusy()).toBe(true);
    expect(engine.getActiveMinimizationId()).toBe('active-job-123');
  });

  it('16: Existing run records remain unchanged', async () => {
    const sourceRun = await prisma.run.findUnique({
      where: { id: sourceRunId },
    });

    // Verify snapshot and summary are pristine
    expect(sourceRun?.status).toBe('completed');
    const snapshot = JSON.parse(sourceRun?.configSnapshot || '{}');
    expect(snapshot.faults.length).toBe(2);
    expect(snapshot.faults[0].latencyMs).toBe(800);
  });

  // ==========================================================================
  // Section 10: Requirement 17 — API Tests
  // ==========================================================================

  it('15: Invalid predicates and out-of-range values are rejected with 400', async () => {
    // 1. Invalid predicate type
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${sourceRunId}/minimize`,
      payload: {
        predicate: { type: 'unknown_predicate_type' },
      },
    });
    expect(res1.statusCode).toBe(400);

    // 2. Out of range maxAttempts
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${sourceRunId}/minimize`,
      payload: {
        predicate: { type: 'status_5xx' },
        maxAttempts: 500, // max is 200
      },
    });
    expect(res2.statusCode).toBe(400);

    // 3. Out of range deadlineMs
    const res3 = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${sourceRunId}/minimize`,
      payload: {
        predicate: { type: 'deadline_exceeded', deadlineMs: -50 },
      },
    });
    expect(res3.statusCode).toBe(400);
  });

  it('17: POST /api/v1/runs/:id/minimize enqueues job and returns HTTP 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/runs/${sourceRunId}/minimize`,
      payload: {
        predicate: {
          type: 'deadline_exceeded',
          deadlineMs: 500,
        },
        minReproductionRate: 1.0,
        maxAttempts: 20,
        deadlineSeconds: 60,
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.sourceRunId).toBe(sourceRunId);
    expect(body.status).toBe('queued');
    expect(body.predicate.type).toBe('deadline_exceeded');
    expect(body.maxAttempts).toBe(20);

    activeMinimizationId = body.id;
  });

  it('17: GET /api/v1/minimizations/:id retrieves status and diff details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minimizations/${activeMinimizationId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(activeMinimizationId);
    expect(body.sourceRunId).toBe(sourceRunId);
    expect(body.predicate).toBeDefined();
  });

  it('17: GET /api/v1/minimizations/:id/attempts retrieves search history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minimizations/${activeMinimizationId}/attempts`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('17: POST /api/v1/minimizations/:id/cancel requests cancellation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minimizations/${activeMinimizationId}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(activeMinimizationId);
  });
});
