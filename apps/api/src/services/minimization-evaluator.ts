import { performance } from 'node:perf_hooks';
import { FailurePredicate } from '../schemas/minimization.js';
import { TargetConfig } from '../schemas/profile.js';
import { config } from '../config.js';

export interface TrialResult {
  trialIndex: number;
  triggered: boolean;
  outcome: 'success' | 'failure' | 'timeout';
  statusCode: number | null;
  latencyMs: number;
  errorCategory: string | null;
  reason: string;
  isInfraError?: boolean;
}

export interface EvaluationResult {
  triggered: boolean;
  reproductionRate: number;
  trialCount: number;
  failedTrials: number;
  durationMs: number;
  reason: string;
  details: Record<string, unknown>;
  trialResults: TrialResult[];
  infraErrorDetected?: boolean;
}

export interface EvaluatorOptions {
  trafficBaseUrl?: string;
  healthCheckFn?: () => Promise<boolean>;
}

export class MinimizationEvaluator {
  private trafficBaseUrl: string;
  private healthCheckFn?: () => Promise<boolean>;

  constructor(options?: EvaluatorOptions) {
    this.trafficBaseUrl = (options?.trafficBaseUrl || config.testTargetProxyUrl).replace(/\/+$/, '');
    this.healthCheckFn = options?.healthCheckFn;
  }

  /**
   * Evaluates a candidate network fault configuration against the given failure predicate
   * across one or more trials.
   */
  async evaluate(
    target: TargetConfig,
    predicate: FailurePredicate,
    minReproductionRate: number,
    trialCount: number,
    requestTimeoutMs: number,
    signal?: AbortSignal
  ): Promise<EvaluationResult> {
    const startOverall = performance.now();
    const trialResults: TrialResult[] = [];
    let failedTrials = 0;
    let infraErrorDetected = false;

    const targetPath = target.path.startsWith('/') ? target.path : `/${target.path}`;
    const method = target.method || 'GET';

    for (let i = 1; i <= trialCount; i++) {
      if (signal?.aborted) {
        throw new Error('Minimization cancelled by user');
      }

      const trialStart = performance.now();
      const delimiter = targetPath.includes('?') ? '&' : '?';
      const requestId = `min-${Date.now().toString(36)}-${i}`;
      const url = `${this.trafficBaseUrl}${targetPath}${delimiter}requestId=${requestId}`;

      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      let outcome: 'success' | 'failure' | 'timeout' = 'success';
      let statusCode: number | null = null;
      let errorCategory: string | null = null;
      let latencyMs = 0;
      let isInfraError = false;
      let reason = '';
      let triggered = false;

      try {
        const res = await fetch(url, {
          method,
          signal: combinedSignal,
          headers: {
            'User-Agent': 'NetReplay-Minimizer/1.0',
            'X-NetReplay-Minimization-Trial': String(i),
          },
        });

        latencyMs = Math.round((performance.now() - trialStart) * 100) / 100;
        statusCode = res.status;

        if (res.ok) {
          outcome = 'success';
        } else {
          outcome = 'failure';
          errorCategory = `HTTP_${res.status}`;
        }
      } catch (err: any) {
        latencyMs = Math.round((performance.now() - trialStart) * 100) / 100;

        if (signal?.aborted) {
          throw new Error('Minimization cancelled by user');
        }

        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          outcome = 'timeout';
          errorCategory = 'TIMEOUT';
        } else {
          outcome = 'failure';
          errorCategory = err.code || err.cause?.code || err.name || 'NETWORK_ERROR';

          // Distinguish infra error: check if test target or proxy itself is unreachable
          if (this.healthCheckFn) {
            try {
              const isHealthy = await this.healthCheckFn();
              if (!isHealthy) {
                isInfraError = true;
                infraErrorDetected = true;
                reason = 'Target or engine infrastructure unreachable, not counted as reproduction';
              }
            } catch {
              isInfraError = true;
              infraErrorDetected = true;
              reason = 'Target or engine infrastructure health check failed';
            }
          }
        }
      }

      // Check predicate match if not an infrastructure failure
      if (!isInfraError) {
        const match = this.checkPredicateMatch(predicate, outcome, statusCode, latencyMs, errorCategory);
        triggered = match.triggered;
        reason = match.reason;
      }

      if (triggered) {
        failedTrials++;
      }

      trialResults.push({
        trialIndex: i,
        triggered,
        outcome,
        statusCode,
        latencyMs,
        errorCategory,
        reason,
        isInfraError,
      });
    }

    const durationMs = Math.round(performance.now() - startOverall);
    const reproductionRate = trialCount > 0 ? failedTrials / trialCount : 0;
    const overallTriggered = !infraErrorDetected && reproductionRate >= minReproductionRate;

    return {
      triggered: overallTriggered,
      reproductionRate,
      trialCount,
      failedTrials,
      durationMs,
      reason: overallTriggered
        ? `Failure predicate '${predicate.type}' reproduced (${failedTrials}/${trialCount} trials, rate: ${Math.round(reproductionRate * 100)}%)`
        : infraErrorDetected
        ? 'Infrastructure error detected during evaluation'
        : `Failure predicate '${predicate.type}' not met (${failedTrials}/${trialCount} trials, required: ${Math.round(minReproductionRate * 100)}%)`,
      details: {
        predicate,
        minReproductionRate,
        observedReproductionRate: reproductionRate,
        infraErrorDetected,
      },
      trialResults,
      infraErrorDetected,
    };
  }

  /**
   * Matches observed trial measurements against a specific failure predicate.
   */
  public checkPredicateMatch(
    predicate: FailurePredicate,
    outcome: 'success' | 'failure' | 'timeout',
    statusCode: number | null,
    latencyMs: number,
    errorCategory: string | null
  ): { triggered: boolean; reason: string } {
    switch (predicate.type) {
      case 'status_5xx': {
        if (statusCode !== null && statusCode >= 500 && statusCode <= 599) {
          if (predicate.statusCode !== undefined && statusCode !== predicate.statusCode) {
            return {
              triggered: false,
              reason: `HTTP status ${statusCode} does not match expected status ${predicate.statusCode}`,
            };
          }
          return {
            triggered: true,
            reason: `Observed HTTP 5xx error: ${statusCode}`,
          };
        }
        return {
          triggered: false,
          reason: `Observed status ${statusCode ?? 'none'}, expected HTTP 5xx`,
        };
      }

      case 'deadline_exceeded': {
        if (outcome === 'timeout' || latencyMs >= predicate.deadlineMs) {
          return {
            triggered: true,
            reason: `Request duration (${latencyMs}ms) exceeded deadline of ${predicate.deadlineMs}ms`,
          };
        }
        return {
          triggered: false,
          reason: `Request duration (${latencyMs}ms) remained below deadline (${predicate.deadlineMs}ms)`,
        };
      }

      case 'connection_reset': {
        const isReset =
          errorCategory === 'ECONNRESET' ||
          errorCategory === 'EPIPE' ||
          errorCategory === 'UND_ERR_SOCKET' ||
          (errorCategory && errorCategory.toLowerCase().includes('reset'));
        if (isReset) {
          return {
            triggered: true,
            reason: `Connection reset observed (${errorCategory})`,
          };
        }
        return {
          triggered: false,
          reason: `No connection reset observed (error: ${errorCategory ?? 'none'}, status: ${statusCode ?? 200})`,
        };
      }

      case 'network_error': {
        if (outcome === 'failure' || outcome === 'timeout') {
          if (predicate.errorCategory) {
            const matches = errorCategory === predicate.errorCategory;
            return {
              triggered: matches,
              reason: matches
                ? `Matched network error category '${predicate.errorCategory}'`
                : `Observed error '${errorCategory}', expected '${predicate.errorCategory}'`,
            };
          }
          return {
            triggered: true,
            reason: `Network error observed: ${errorCategory || 'failure'}`,
          };
        }
        return {
          triggered: false,
          reason: 'Request succeeded without network error',
        };
      }

      case 'response_missing': {
        if (outcome === 'timeout' || errorCategory === 'TIMEOUT' || (outcome === 'failure' && statusCode === null)) {
          return {
            triggered: true,
            reason: 'Expected response was missing or timed out',
          };
        }
        return {
          triggered: false,
          reason: `Response received with status ${statusCode ?? 200}`,
        };
      }

      case 'status_code': {
        if (statusCode === predicate.statusCode) {
          return {
            triggered: true,
            reason: `Observed exact status code ${statusCode}`,
          };
        }
        return {
          triggered: false,
          reason: `Observed status ${statusCode ?? 'none'}, expected ${predicate.statusCode}`,
        };
      }

      default:
        return {
          triggered: false,
          reason: `Unknown predicate type: ${(predicate as any).type}`,
        };
    }
  }
}

export const defaultEvaluator = new MinimizationEvaluator();
