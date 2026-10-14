/**
 * NetReplay Experiment Runner
 *
 * Coordinates execution of fault-injected experiment runs against local test targets
 * through the Toxiproxy adapter. Enforces strict single-experiment concurrency per proxy,
 * records request-level measurements with monotonic clocks, and guarantees fault cleanup.
 */

import { performance } from 'node:perf_hooks';
import { prisma } from './db.js';
import { toxiproxyService } from './toxiproxy-service.js';
import { config } from '../config.js';
import { ConfigSnapshot, RunSummary } from '../schemas/run.js';

export class ExperimentRunner {
  private activeRunId: string | null = null;
  private abortControllers = new Map<string, AbortController>();

  /**
   * Checks if an experiment is currently running.
   */
  public isBusy(): boolean {
    return this.activeRunId !== null;
  }

  /**
   * Returns the ID of the currently executing run, if any.
   */
  public getActiveRunId(): string | null {
    return this.activeRunId;
  }

  /**
   * Requests cancellation of an active run.
   */
  public cancel(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Computes statistical aggregates from an array of latencies.
   */
  private computeStatistics(
    timings: number[],
    successCount: number,
    failureCount: number,
    timeoutCount: number,
    criteria?: { maxMedianLatencyMs?: number; minSuccessRate?: number; maxFailureCount?: number }
  ): RunSummary {
    const totalRequests = timings.length + timeoutCount;

    if (timings.length === 0) {
      return {
        totalRequests,
        successCount,
        failureCount,
        timeoutCount,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        medianLatencyMs: 0,
        meanLatencyMs: 0,
        successCriteriaMet: false,
      };
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const minLatencyMs = Math.round(sorted[0]! * 100) / 100;
    const maxLatencyMs = Math.round(sorted[sorted.length - 1]! * 100) / 100;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const meanLatencyMs = Math.round((sum / sorted.length) * 100) / 100;

    const mid = Math.floor(sorted.length / 2);
    const medianLatencyMs = Math.round(
      (sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2) * 100
    ) / 100;

    let successCriteriaMet: boolean | undefined = undefined;
    if (criteria) {
      let meets = true;
      if (criteria.maxMedianLatencyMs !== undefined && medianLatencyMs > criteria.maxMedianLatencyMs) {
        meets = false;
      }
      if (criteria.maxFailureCount !== undefined && failureCount > criteria.maxFailureCount) {
        meets = false;
      }
      if (criteria.minSuccessRate !== undefined && totalRequests > 0) {
        const rate = successCount / totalRequests;
        if (rate < criteria.minSuccessRate) {
          meets = false;
        }
      }
      successCriteriaMet = meets;
    }

    return {
      totalRequests,
      successCount,
      failureCount,
      timeoutCount,
      minLatencyMs,
      maxLatencyMs,
      medianLatencyMs,
      meanLatencyMs,
      successCriteriaMet,
    };
  }

  /**
   * Helper to append an event to the run history.
   */
  private async recordEvent(runId: string, eventType: string, details?: Record<string, unknown>): Promise<void> {
    try {
      await prisma.runEvent.create({
        data: {
          runId,
          eventType,
          details: details ? JSON.stringify(details) : null,
        },
      });
    } catch {
      // Event logging is best-effort and shouldn't crash execution
    }
  }

  /**
   * Asynchronously executes a scheduled run in the background.
   */
  public async execute(runId: string, snapshot: ConfigSnapshot): Promise<void> {
    this.activeRunId = runId;
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    const timings: number[] = [];
    let successCount = 0;
    let failureCount = 0;
    let timeoutCount = 0;
    let finalStatus: 'completed' | 'failed' | 'cancelled' = 'completed';
    let errorMessage: string | null = null;
    let errorCode: string | null = null;

    try {
      // ----------------------------------------------------------------------
      // Step 1: Preparing
      // ----------------------------------------------------------------------
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'preparing' },
      });
      await this.recordEvent(runId, 'state_change', { from: 'queued', to: 'preparing' });

      // Verify proxy listener is intact
      await toxiproxyService.ensureProxyReady();
      // Ensure no previous leftover faults
      await toxiproxyService.clearFaults();

      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
        return;
      }

      // ----------------------------------------------------------------------
      // Step 2: Ingest & Apply Faults
      // ----------------------------------------------------------------------
      for (const fault of snapshot.faults) {
        await toxiproxyService.applyFault(fault);
        await this.recordEvent(runId, 'fault_applied', {
          name: fault.name || `${fault.type}_${fault.stream}`,
          type: fault.type,
          stream: fault.stream,
        });
      }

      if (abortController.signal.aborted) {
        finalStatus = 'cancelled';
        return;
      }

      // ----------------------------------------------------------------------
      // Step 3: Running (Measurements)
      // ----------------------------------------------------------------------
      const startedAt = new Date();
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'running', startedAt },
      });
      await this.recordEvent(runId, 'state_change', { from: 'preparing', to: 'running' });

      const targetBase = config.testTargetProxyUrl.replace(/\/+$/, '');
      const targetPath = snapshot.target.path.startsWith('/') ? snapshot.target.path : `/${snapshot.target.path}`;
      const method = snapshot.target.method || 'GET';
      const timeoutMs = snapshot.requestTimeoutMs || 5000;

      for (let i = 1; i <= snapshot.requestCount; i++) {
        if (abortController.signal.aborted) {
          finalStatus = 'cancelled';
          await this.recordEvent(runId, 'cancelled', { cancelledAtRequest: i });
          break;
        }

        const requestId = `run-${runId.slice(-6)}-${String(i).padStart(3, '0')}`;
        const delimiter = targetPath.includes('?') ? '&' : '?';
        const url = `${targetBase}${targetPath}${delimiter}requestId=${requestId}`;

        const requestSignal = AbortSignal.any([
          abortController.signal,
          AbortSignal.timeout(timeoutMs),
        ]);

        const start = performance.now();
        let outcome: 'success' | 'failure' | 'timeout' = 'success';
        let statusCode: number | null = null;
        let errorCategory: string | null = null;

        try {
          const res = await fetch(url, {
            method,
            signal: requestSignal,
            headers: {
              'User-Agent': 'NetReplay-ExperimentRunner/1.0',
            },
          });
          const elapsed = performance.now() - start;
          statusCode = res.status;

          if (res.ok) {
            outcome = 'success';
            successCount++;
            timings.push(elapsed);
          } else {
            outcome = 'failure';
            failureCount++;
            errorCategory = `HTTP_${res.status}`;
            timings.push(elapsed);
          }
        } catch (err: any) {
          const elapsed = performance.now() - start;
          if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            if (abortController.signal.aborted) {
              outcome = 'timeout';
              errorCategory = 'CANCELLED';
            } else {
              outcome = 'timeout';
              timeoutCount++;
              errorCategory = 'TIMEOUT';
            }
          } else {
            outcome = 'failure';
            failureCount++;
            errorCategory = err.code || err.name || 'NETWORK_ERROR';
            timings.push(elapsed);
          }
        }

        // Persist individual request measurement
        await prisma.requestResult.create({
          data: {
            runId,
            requestIndex: i,
            outcome,
            statusCode,
            latencyMs: Math.round((performance.now() - start) * 100) / 100,
            errorCategory,
          },
        });
      }

      // ----------------------------------------------------------------------
      // Step 4: Collecting Results
      // ----------------------------------------------------------------------
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'collecting' },
      });
      await this.recordEvent(runId, 'state_change', { from: 'running', to: 'collecting' });
    } catch (err: any) {
      finalStatus = 'failed';
      errorCode = 'EXECUTION_ERROR';
      errorMessage = err.message || 'An unexpected error occurred during experiment execution';
      await this.recordEvent(runId, 'error', { error: errorMessage });
    } finally {
      // ----------------------------------------------------------------------
      // Step 5: Guaranteed Cleanup & Finalization
      // ----------------------------------------------------------------------
      try {
        await toxiproxyService.clearFaults();
        await this.recordEvent(runId, 'fault_removed', { status: 'cleaned' });
      } catch (cleanupErr: any) {
        console.error(`[ExperimentRunner] Cleanup failed for run ${runId}:`, cleanupErr);
        await this.recordEvent(runId, 'cleanup_error', { error: cleanupErr.message });
        finalStatus = 'failed';
        errorCode = errorCode || 'CLEANUP_FAILED';
        errorMessage = errorMessage
          ? `${errorMessage}; Cleanup failed: ${cleanupErr.message}`
          : `Fault cleanup failed: ${cleanupErr.message}`;
      }

      this.activeRunId = null;
      this.abortControllers.delete(runId);

      const summary = this.computeStatistics(
        timings,
        successCount,
        failureCount,
        timeoutCount,
        snapshot.successCriteria
      );

      const finishedAt = new Date();

      await prisma.run.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          finishedAt,
          summary: JSON.stringify(summary),
          errorCode,
          errorMessage,
        },
      });

      await this.recordEvent(runId, 'state_change', { to: finalStatus, summary });
    }
  }
}

export const experimentRunner = new ExperimentRunner();
