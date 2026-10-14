import { performance } from 'node:perf_hooks';
import { prisma } from './db.js';
import { toxiproxyService, ToxiproxyService } from './toxiproxy-service.js';
import { MinimizationEvaluator, defaultEvaluator, EvaluationResult } from './minimization-evaluator.js';
import {
  StartMinimizationInput,
  MinimizationStatus,
  ConfigDifference,
} from '../schemas/minimization.js';
import { ConfigSnapshot } from '../schemas/run.js';
import { Fault } from '../schemas/profile.js';

export class MinimizerEngine {
  private activeMinimizationId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private toxiproxy: ToxiproxyService;
  private evaluator: MinimizationEvaluator;

  constructor(options?: { toxiproxy?: ToxiproxyService; evaluator?: MinimizationEvaluator }) {
    this.toxiproxy = options?.toxiproxy || toxiproxyService;
    this.evaluator = options?.evaluator || defaultEvaluator;
  }

  public isBusy(): boolean {
    return this.activeMinimizationId !== null;
  }

  public getActiveMinimizationId(): string | null {
    return this.activeMinimizationId;
  }

  public cancel(minimizationId: string): boolean {
    const controller = this.abortControllers.get(minimizationId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Computes the difference between original faults and minimized faults.
   */
  public computeDifferences(originalFaults: Fault[], minimizedFaults: Fault[]): ConfigDifference {
    const removedFaults: Fault[] = [];
    const modifiedFaults: Array<{
      faultType: string;
      original: Record<string, unknown>;
      minimized: Record<string, unknown>;
      reductionSummary: string;
    }> = [];
    const retainedFaults: Fault[] = [];

    // Match faults by name or type + stream
    for (const orig of originalFaults) {
      const match = minimizedFaults.find(
        (m) =>
          (m.name && orig.name && m.name === orig.name) ||
          (m.type === orig.type && m.stream === orig.stream)
      );

      if (!match) {
        removedFaults.push(orig);
      } else {
        const changes: string[] = [];
        if (orig.type === 'latency' && match.type === 'latency') {
          if (orig.latencyMs !== match.latencyMs) {
            changes.push(`latency reduced from ${orig.latencyMs}ms to ${match.latencyMs}ms`);
          }
          if (orig.jitterMs !== match.jitterMs) {
            changes.push(`jitter reduced from ${orig.jitterMs}ms to ${match.jitterMs}ms`);
          }
        } else if (orig.type === 'timeout' && match.type === 'timeout') {
          if (orig.timeoutMs !== match.timeoutMs) {
            changes.push(`timeout reduced from ${orig.timeoutMs}ms to ${match.timeoutMs}ms`);
          }
        } else if (orig.type === 'bandwidth' && match.type === 'bandwidth') {
          if (orig.rateKbps !== match.rateKbps) {
            changes.push(`bandwidth increased from ${orig.rateKbps}kbps to ${match.rateKbps}kbps`);
          }
        }

        if (changes.length > 0) {
          modifiedFaults.push({
            faultType: orig.type,
            original: orig as any,
            minimized: match as any,
            reductionSummary: changes.join(', '),
          });
        } else {
          retainedFaults.push(match);
        }
      }
    }

    return {
      removedFaults,
      modifiedFaults,
      retainedFaults,
    };
  }

  /**
   * Core staged minimization workflow.
   */
  public async execute(
    minimizationId: string,
    snapshot: ConfigSnapshot,
    input: StartMinimizationInput
  ): Promise<void> {
    this.activeMinimizationId = minimizationId;
    const abortController = new AbortController();
    this.abortControllers.set(minimizationId, abortController);

    const startTime = performance.now();
    let attemptsUsed = 0;
    let finalStatus: MinimizationStatus = 'completed';
    let cleanupStatus = 'cleaned';
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let finalObservedRate: number | null = null;

    const originalFaults: Fault[] = JSON.parse(JSON.stringify(snapshot.faults || []));
    let currentFaults: Fault[] = JSON.parse(JSON.stringify(originalFaults));

    const deadlineMs = input.deadlineSeconds * 1000;
    const isDeadlineExceeded = () => performance.now() - startTime >= deadlineMs;
    const hasRemainingBudget = () => attemptsUsed < input.maxAttempts && !isDeadlineExceeded();

    try {
      await prisma.minimization.update({
        where: { id: minimizationId },
        data: {
          status: 'running',
          startedAt: new Date(),
        },
      });

      // Helper to evaluate a candidate fault set and persist the attempt
      const evaluateCandidate = async (
        stage: string,
        changeDesc: string,
        candidateFaults: Fault[],
        trialCount: number
      ): Promise<{ result: EvaluationResult; outcome: string }> => {
        attemptsUsed++;

        // Apply candidate faults to proxy
        let evalResult: EvaluationResult;
        let applyError: any = null;

        try {
          await this.toxiproxy.clearFaults();
          for (const fault of candidateFaults) {
            await this.toxiproxy.applyFault(fault);
          }
        } catch (err: any) {
          applyError = err;
        }

        try {
          if (applyError) {
            evalResult = {
              triggered: false,
              reproductionRate: 0,
              trialCount,
              failedTrials: 0,
              durationMs: 0,
              reason: `Failed to apply faults: ${applyError.message}`,
              details: { error: applyError.message },
              trialResults: [],
              infraErrorDetected: true,
            };
          } else {
            evalResult = await this.evaluator.evaluate(
              snapshot.target,
              input.predicate,
              input.minReproductionRate,
              trialCount,
              snapshot.requestTimeoutMs || 5000,
              abortController.signal
            );
          }
        } finally {
          // Guaranteed fault cleanup after every single evaluation
          try {
            await this.toxiproxy.clearFaults();
          } catch (cleanErr: any) {
            cleanupStatus = 'cleanup_failed';
            errorMessage = `Fault cleanup failed after attempt: ${cleanErr.message}`;
          }
        }

        let outcome = 'rejected';
        if (stage === 'baseline') {
          outcome = evalResult.triggered ? 'baseline_verified' : 'baseline_failed';
        } else if (stage === 'verification') {
          outcome = evalResult.triggered ? 'verified' : 'verification_failed';
        } else {
          outcome = evalResult.triggered ? 'kept' : 'rejected';
        }

        // Persist attempt in DB
        await prisma.minimizationAttempt.create({
          data: {
            minimizationId,
            attemptNumber: attemptsUsed,
            stage,
            changeDesc,
            candidateConfig: JSON.stringify(candidateFaults),
            triggered: evalResult.triggered,
            trialCount: evalResult.trialCount,
            failedTrials: evalResult.failedTrials,
            reproductionRate: evalResult.reproductionRate,
            durationMs: evalResult.durationMs,
            outcome,
            reason: evalResult.reason,
            details: JSON.stringify(evalResult.details || {}),
          },
        });

        await prisma.minimization.update({
          where: { id: minimizationId },
          data: {
            attemptsUsed,
            minimizedConfig: JSON.stringify(currentFaults),
          },
        });

        return { result: evalResult, outcome };
      };

      // ----------------------------------------------------------------------
      // Stage A — Validate the baseline
      // ----------------------------------------------------------------------
      const baseline = await evaluateCandidate(
        'baseline',
        'Validating original fault configuration baseline',
        originalFaults,
        input.trialsPerCandidate
      );

      if (!baseline.result.triggered) {
        finalStatus = 'baseline_not_reproducible';
        errorMessage = baseline.result.infraErrorDetected
          ? 'Baseline evaluation failed due to infrastructure error'
          : `Target failure could not be reproduced under baseline configuration (${baseline.result.reason})`;
        return;
      }

      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
        return;
      }

      // ----------------------------------------------------------------------
      // Stage B — Remove unnecessary fault components (Delta Debugging)
      // ----------------------------------------------------------------------
      if (currentFaults.length > 0 && hasRemainingBudget()) {
        const faultsToTest = [...currentFaults];

        for (const fault of faultsToTest) {
          if (!hasRemainingBudget() || abortController.signal.aborted) {
            break;
          }

          const candidate = currentFaults.filter((f) => f !== fault);
          const desc = `Remove fault component '${fault.name || fault.type}' (${fault.stream || 'downstream'})`;

          const evaluation = await evaluateCandidate(
            'component_reduction',
            desc,
            candidate,
            input.trialsPerCandidate
          );

          if (evaluation.result.triggered) {
            // Keep the removal!
            currentFaults = candidate;
          }
        }

        // Test multi-component removals (e.g. pairs) if 3+ components remain
        if (currentFaults.length >= 3 && hasRemainingBudget() && !abortController.signal.aborted) {
          for (let i = 0; i < currentFaults.length - 1; i++) {
            if (!hasRemainingBudget() || abortController.signal.aborted) break;
            const pairToRemove = [currentFaults[i], currentFaults[i + 1]];
            const candidate = currentFaults.filter((f) => !pairToRemove.includes(f));
            const desc = `Remove fault pair '${pairToRemove[0]?.name || pairToRemove[0]?.type}' and '${pairToRemove[1]?.name || pairToRemove[1]?.type}'`;

            const evaluation = await evaluateCandidate(
              'component_reduction',
              desc,
              candidate,
              input.trialsPerCandidate
            );

            if (evaluation.result.triggered) {
              currentFaults = candidate;
            }
          }
        }
      }

      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
        return;
      }

      // ----------------------------------------------------------------------
      // Stage C — Minimize numeric values
      // ----------------------------------------------------------------------
      for (let i = 0; i < currentFaults.length; i++) {
        if (!hasRemainingBudget() || abortController.signal.aborted) break;

        const fault = currentFaults[i]!;

        if (fault.type === 'latency') {
          // Step C.1: Try removing jitter first if present
          if (fault.jitterMs && fault.jitterMs > 0 && hasRemainingBudget()) {
            const candidateFaults = JSON.parse(JSON.stringify(currentFaults)) as Fault[];
            const candidateFault = candidateFaults[i] as any;
            candidateFault.jitterMs = 0;

            const jitterEval = await evaluateCandidate(
              'parameter_minimization',
              `Remove jitter (set jitterMs: 0) on latency fault '${fault.name || 'latency'}'`,
              candidateFaults,
              input.trialsPerCandidate
            );

            if (jitterEval.result.triggered) {
              currentFaults = candidateFaults;
              fault.jitterMs = 0;
            }
          }

          // Step C.2: Binary search on latencyMs
          if (fault.latencyMs > 10 && hasRemainingBudget()) {
            let low = 0;
            let high = fault.latencyMs;
            const tolerance = 25; // Stop when interval is within 25ms

            while (high - low > tolerance && hasRemainingBudget() && !abortController.signal.aborted) {
              const mid = Math.round((low + high) / 2);
              const candidateFaults = JSON.parse(JSON.stringify(currentFaults)) as Fault[];
              (candidateFaults[i] as any).latencyMs = mid;

              const desc = `Binary search latency: reduce from ${high}ms to ${mid}ms on '${fault.name || 'latency'}'`;
              const midEval = await evaluateCandidate(
                'parameter_minimization',
                desc,
                candidateFaults,
                input.trialsPerCandidate
              );

              if (midEval.result.triggered) {
                high = mid;
                currentFaults = candidateFaults;
                fault.latencyMs = mid;
              } else {
                low = mid + 1;
              }
            }
          }
        } else if (fault.type === 'timeout') {
          // Binary search on timeoutMs
          if (fault.timeoutMs > 100 && hasRemainingBudget()) {
            let low = 0;
            let high = fault.timeoutMs;
            const tolerance = 100;

            while (high - low > tolerance && hasRemainingBudget() && !abortController.signal.aborted) {
              const mid = Math.round((low + high) / 2);
              const candidateFaults = JSON.parse(JSON.stringify(currentFaults)) as Fault[];
              (candidateFaults[i] as any).timeoutMs = mid;

              const desc = `Binary search timeout: reduce from ${high}ms to ${mid}ms on '${fault.name || 'timeout'}'`;
              const midEval = await evaluateCandidate(
                'parameter_minimization',
                desc,
                candidateFaults,
                input.trialsPerCandidate
              );

              if (midEval.result.triggered) {
                high = mid;
                currentFaults = candidateFaults;
                fault.timeoutMs = mid;
              } else {
                low = mid + 1;
              }
            }
          }
        }
      }

      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
        return;
      }

      // Check budget / deadline exhaustion before Stage D
      if (!hasRemainingBudget() && !isDeadlineExceeded()) {
        finalStatus = 'budget_exhausted';
      } else if (isDeadlineExceeded()) {
        finalStatus = 'budget_exhausted';
        errorMessage = 'Overall minimization wall-clock deadline exceeded';
      }

      // ----------------------------------------------------------------------
      // Stage D — Final verification with configurable trial policy
      // ----------------------------------------------------------------------
      if (finalStatus === 'completed' || finalStatus === 'budget_exhausted') {
        const verification = await evaluateCandidate(
          'verification',
          `Final verification policy evaluation with ${input.finalTrials} trials`,
          currentFaults,
          input.finalTrials
        );

        finalObservedRate = verification.result.reproductionRate;

        if (!verification.result.triggered) {
          if (finalStatus === 'completed') {
            finalStatus = 'completed'; // Keep partial minimized result
            errorMessage = `Final verification failed to achieve required threshold of ${Math.round(input.minReproductionRate * 100)}% (observed: ${Math.round(verification.result.reproductionRate * 100)}%)`;
          }
        }
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
      } else {
        finalStatus = 'failed';
        errorCode = 'MINIMIZATION_ERROR';
        errorMessage = err.message || 'An unexpected error occurred during minimization';
      }
    } finally {
      // ----------------------------------------------------------------------
      // Final Cleanup and State Restoration
      // ----------------------------------------------------------------------
      try {
        await this.toxiproxy.clearFaults();
      } catch (cleanErr: any) {
        cleanupStatus = 'cleanup_failed';
        finalStatus = 'failed';
        errorCode = errorCode || 'CLEANUP_FAILED';
        errorMessage = (errorMessage ? `${errorMessage}; ` : '') + `Final cleanup error: ${cleanErr.message}`;
        console.error(`[Minimizer] Final cleanup failed for minimization ${minimizationId}:`, cleanErr);
      }

      this.activeMinimizationId = null;
      this.abortControllers.delete(minimizationId);

      const totalDuration = Math.round(performance.now() - startTime);

      try {
        await prisma.minimization.update({
          where: { id: minimizationId },
          data: {
            status: finalStatus,
            minimizedConfig: JSON.stringify(currentFaults),
            attemptsUsed,
            finalObservedRate,
            cleanupStatus,
            finishedAt: new Date(),
            durationMs: totalDuration,
            errorCode,
            errorMessage,
          },
        });
      } catch {
        // Record may have been deleted by test runner or client
      }
    }
  }
}

export const minimizerEngine = new MinimizerEngine();
