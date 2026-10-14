import { prisma } from './db.js';
import { NotFoundError } from '../errors/api-error.js';

export interface JsonReport {
  runId: string;
  profileId: string | null;
  replayedFromId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  configSnapshot: any;
  summary: any;
  requests: any[];
  events: any[];
  error?: {
    code: string | null;
    message: string | null;
  };
}

export class ReportService {
  async generateJson(runId: string): Promise<JsonReport> {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        requests: { orderBy: { requestIndex: 'asc' } },
        events: { orderBy: { timestamp: 'asc' } },
      },
    });

    if (!run) {
      throw new NotFoundError(`Run with ID '${runId}' was not found`);
    }

    const snapshot = JSON.parse(run.configSnapshot);
    const summary = run.summary ? JSON.parse(run.summary) : null;

    let durationMs: number | null = null;
    if (run.startedAt && run.finishedAt) {
      durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
    }

    return {
      runId: run.id,
      profileId: run.profileId,
      replayedFromId: run.replayedFromId,
      status: run.status,
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      durationMs,
      configSnapshot: snapshot,
      summary,
      requests: run.requests.map((r) => ({
        index: r.requestIndex,
        outcome: r.outcome,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        errorCategory: r.errorCategory,
        timestamp: r.timestamp.toISOString(),
      })),
      events: run.events.map((e) => ({
        type: e.eventType,
        timestamp: e.timestamp.toISOString(),
        details: e.details ? JSON.parse(e.details) : null,
      })),
      error: run.errorCode || run.errorMessage
        ? {
            code: run.errorCode,
            message: run.errorMessage,
          }
        : undefined,
    };
  }

  async generateMarkdown(runId: string): Promise<string> {
    const report = await this.generateJson(runId);
    const snap = report.configSnapshot;
    const summary = report.summary;

    const lines: string[] = [];
    lines.push(`# NetReplay Experiment Report: ${snap.profileName || 'Experiment'}`);
    lines.push('');
    lines.push(`**Run ID**: \`${report.runId}\`  `);
    lines.push(`**Status**: **${report.status.toUpperCase()}**  `);
    lines.push(`**Engine**: \`${snap.engine}\` (v${snap.engineVersion || 'unknown'})  `);
    lines.push(`**Target Endpoint**: \`${snap.target?.method || 'GET'} ${snap.target?.path || '/api/demo'}\`  `);
    lines.push(`**Started At**: ${report.startedAt || 'N/A'}  `);
    lines.push(`**Finished At**: ${report.finishedAt || 'N/A'}  `);
    if (report.durationMs !== null) {
      lines.push(`**Total Duration**: ${(report.durationMs / 1000).toFixed(2)} seconds  `);
    }
    if (report.replayedFromId) {
      lines.push(`**Replayed From**: \`${report.replayedFromId}\`  `);
    }
    lines.push('');

    // Injected Faults section
    lines.push('## Injected Network Faults');
    lines.push('');
    lines.push('| Fault Type | Direction | Key Attributes | Toxicity |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const fault of snap.faults || []) {
      let attrs = '';
      if (fault.type === 'latency') attrs = `latency=${fault.latencyMs}ms, jitter=${fault.jitterMs || 0}ms`;
      else if (fault.type === 'timeout') attrs = `timeout=${fault.timeoutMs}ms`;
      else if (fault.type === 'bandwidth') attrs = `rate=${fault.rateKbps} KB/s`;
      else if (fault.type === 'reset' || fault.type === 'reset_peer') attrs = 'TCP RST';
      lines.push(`| **${fault.type}** | ${fault.stream || 'downstream'} | \`${attrs}\` | ${fault.toxicity ?? 1.0} |`);
    }
    lines.push('');

    // Execution Summary section
    lines.push('## Measurement Summary');
    lines.push('');
    if (summary) {
      lines.push('| Metric | Value |');
      lines.push('| :--- | :--- |');
      lines.push(`| **Total Requests** | ${summary.totalRequests} |`);
      lines.push(`| **Successful Requests** | ${summary.successCount} |`);
      lines.push(`| **Failed Requests** | ${summary.failureCount} |`);
      lines.push(`| **Timed Out Requests** | ${summary.timeoutCount} |`);
      lines.push(`| **Median Latency** | **${summary.medianLatencyMs.toFixed(1)} ms** |`);
      lines.push(`| **Mean Latency** | ${summary.meanLatencyMs.toFixed(1)} ms |`);
      lines.push(`| **Min / Max Latency** | ${summary.minLatencyMs.toFixed(1)} ms / ${summary.maxLatencyMs.toFixed(1)} ms |`);
      if (summary.successCriteriaMet !== undefined) {
        lines.push(`| **Success Criteria Met** | ${summary.successCriteriaMet ? '✅ PASS' : '❌ FAIL'} |`);
      }
      lines.push('');
    } else {
      lines.push('*No summary statistics recorded.*');
      lines.push('');
    }

    // Errors if any
    if (report.error) {
      lines.push('## Error Details');
      lines.push('');
      lines.push(`> [!WARNING]`);
      lines.push(`> **Code**: ${report.error.code || 'UNKNOWN'}  `);
      lines.push(`> **Message**: ${report.error.message || 'No detail'}`);
      lines.push('');
    }

    // Request Breakdown sample (up to 20)
    lines.push('## Request Measurements Breakdown');
    lines.push('');
    lines.push('| # | Outcome | HTTP Status | Latency | Timestamp |');
    lines.push('| :-: | :--- | :-: | :--- | :--- |');
    for (const req of report.requests.slice(0, 50)) {
      const outcomeIcon = req.outcome === 'success' ? '✅' : (req.outcome === 'timeout' ? '⏱️' : '❌');
      lines.push(
        `| ${req.index} | ${outcomeIcon} ${req.outcome} | ${req.statusCode ?? '-'} | ${req.latencyMs.toFixed(1)} ms | ${req.timestamp.slice(11, 23)} |`
      );
    }
    if (report.requests.length > 50) {
      lines.push(`*... ${report.requests.length - 50} additional requests omitted from Markdown view.*`);
    }
    lines.push('');

    // Event Timeline
    lines.push('## Event Timeline');
    lines.push('');
    for (const ev of report.events) {
      const detailStr = ev.details ? ` - \`${JSON.stringify(ev.details)}\`` : '';
      lines.push(`- **${ev.timestamp.slice(11, 23)}** [\`${ev.type}\`]${detailStr}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}

export const reportService = new ReportService();
