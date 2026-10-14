import React, { useState } from 'react';
import {
  GitCompare,
  AlertTriangle,
} from 'lucide-react';
import { useRuns, useRunRequests } from '../api/hooks';
import type { Run } from '../types/api';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Badge } from '../components/ui/Badge';
import { ComparisonChart } from '../components/charts/ComparisonChart';

export const RunComparisonPage: React.FC = () => {
  const { data: runsData } = useRuns({ limit: 50 });
  const completedRuns = (runsData?.items || []).filter(
    (r) => r.status === 'completed' && r.summary
  );

  const [runAId, setRunAId] = useState<string>(completedRuns[1]?.id || completedRuns[0]?.id || '');
  const [runBId, setRunBId] = useState<string>(completedRuns[0]?.id || '');

  const runA = completedRuns.find((r) => r.id === runAId);
  const runB = completedRuns.find((r) => r.id === runBId);

  const { data: requestsA = [] } = useRunRequests(runAId, false);
  const { data: requestsB = [] } = useRunRequests(runBId, false);

  // Helper to determine if a run is actually a baseline based on recorded configuration
  const getRunClassification = (run?: Run): { isBaseline: boolean; label: string } => {
    if (!run) return { isBaseline: false, label: 'Unknown' };
    const faults = run.configSnapshot?.faults || [];
    const hasActiveFault = faults.some((f) => {
      if (f.type === 'latency') return f.latencyMs > 0;
      if (f.type === 'timeout') return f.timeoutMs > 0;
      if (f.type === 'bandwidth') return f.rateKbps < 1000000;
      return true; // reset
    });

    if (!hasActiveFault) {
      return { isBaseline: true, label: 'Clean Baseline (No Faults)' };
    }

    const descriptions = faults.map((f) => {
      if (f.type === 'latency') return `+${f.latencyMs}ms latency`;
      if (f.type === 'timeout') return `${f.timeoutMs}ms stall`;
      if (f.type === 'bandwidth') return `${f.rateKbps} KB/s`;
      return 'TCP reset';
    });

    return { isBaseline: false, label: `Fault-Injected (${descriptions.join(', ')})` };
  };

  const classA = getRunClassification(runA);
  const classB = getRunClassification(runB);

  // Compute deltas (B - A)
  const medianDelta =
    runA?.summary?.medianLatencyMs !== undefined && runB?.summary?.medianLatencyMs !== undefined
      ? runB.summary.medianLatencyMs - runA.summary.medianLatencyMs
      : null;

  const meanDelta =
    runA?.summary?.meanLatencyMs !== undefined && runB?.summary?.meanLatencyMs !== undefined
      ? runB.summary.meanLatencyMs - runA.summary.meanLatencyMs
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-indigo-400" />
          Run Comparison & Latency Delta
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Compare side-by-side telemetry between baseline experiments and fault-injected runs.
        </p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Run A Selector */}
        <Card title="Run A (Reference / Baseline)" className="border-emerald-800/40">
          <Select
            label="Select Reference Run"
            value={runAId}
            onChange={(e) => setRunAId(e.target.value)}
          >
            <option value="">-- Choose Run A --</option>
            {completedRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.configSnapshot?.profileName || 'Ad-hoc'} (ID: {r.id.slice(0, 8)}, median: {r.summary?.medianLatencyMs?.toFixed(1)}ms)
              </option>
            ))}
          </Select>
          {runA && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <Badge variant={classA.isBaseline ? 'emerald' : 'indigo'}>
                {classA.label}
              </Badge>
              <span className="font-mono text-zinc-400">{runA.summary?.totalRequests} requests</span>
            </div>
          )}
        </Card>

        {/* Run B Selector */}
        <Card title="Run B (Fault-Injected or Comparison)" className="border-indigo-800/40">
          <Select
            label="Select Comparison Run"
            value={runBId}
            onChange={(e) => setRunBId(e.target.value)}
          >
            <option value="">-- Choose Run B --</option>
            {completedRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.configSnapshot?.profileName || 'Ad-hoc'} (ID: {r.id.slice(0, 8)}, median: {r.summary?.medianLatencyMs?.toFixed(1)}ms)
              </option>
            ))}
          </Select>
          {runB && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <Badge variant={classB.isBaseline ? 'emerald' : 'indigo'}>
                {classB.label}
              </Badge>
              <span className="font-mono text-zinc-400">{runB.summary?.totalRequests} requests</span>
            </div>
          )}
        </Card>
      </div>

      {(!runA || !runB) ? (
        <Card className="p-12 text-center text-zinc-400">
          <AlertTriangle className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
          <p className="text-sm">Please select two completed runs to view comparison metrics.</p>
        </Card>
      ) : (
        <>
          {/* Delta Highlights Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 text-center">
              <span className="text-xs text-zinc-400 font-medium block">
                Median Latency Delta (Δ)
              </span>
              <span
                className={`text-2xl font-bold font-mono mt-1 block ${
                  medianDelta && medianDelta > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {medianDelta !== null ? `${medianDelta > 0 ? '+' : ''}${medianDelta.toFixed(1)} ms` : '—'}
              </span>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {runA.summary?.medianLatencyMs.toFixed(1)}ms → {runB.summary?.medianLatencyMs.toFixed(1)}ms
              </span>
            </Card>

            <Card className="p-4 text-center">
              <span className="text-xs text-zinc-400 font-medium block">
                Mean Latency Delta (Δ)
              </span>
              <span
                className={`text-2xl font-bold font-mono mt-1 block ${
                  meanDelta && meanDelta > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {meanDelta !== null ? `${meanDelta > 0 ? '+' : ''}${meanDelta.toFixed(1)} ms` : '—'}
              </span>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {runA.summary?.meanLatencyMs.toFixed(1)}ms → {runB.summary?.meanLatencyMs.toFixed(1)}ms
              </span>
            </Card>

            <Card className="p-4 text-center">
              <span className="text-xs text-zinc-400 font-medium block">
                Success Rate Shift
              </span>
              <span className="text-2xl font-bold font-mono text-zinc-200 mt-1 block">
                {runA.summary && runB.summary
                  ? `${Math.round((runA.summary.successCount / runA.summary.totalRequests) * 100)}% → ${Math.round(
                      (runB.summary.successCount / runB.summary.totalRequests) * 100
                    )}%`
                  : '—'}
              </span>
              <span className="text-[11px] text-zinc-500 mt-1 block">Reliability impact</span>
            </Card>
          </div>

          {/* Overlaid Comparative Chart */}
          <Card
            title="Comparative Probe Latency Curves"
            description="Per-request latency overlay between Run A (Green) and Run B (Indigo)"
          >
            <ComparisonChart
              runAName={runA.configSnapshot?.profileName || 'Run A'}
              runBName={runB.configSnapshot?.profileName || 'Run B'}
              requestsA={requestsA}
              requestsB={requestsB}
              height={300}
            />
          </Card>

          {/* Detailed Metric Comparison Table */}
          <Card title="Detailed Metric Variance Table">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-surface-border text-zinc-400">
                    <th className="pb-3 font-medium">Metric</th>
                    <th className="pb-3 font-medium text-emerald-400">
                      Run A: {runA.configSnapshot?.profileName || runA.id.slice(0, 8)}
                    </th>
                    <th className="pb-3 font-medium text-indigo-400">
                      Run B: {runB.configSnapshot?.profileName || runB.id.slice(0, 8)}
                    </th>
                    <th className="pb-3 font-medium text-right font-mono">Difference (B - A)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Classification</td>
                    <td className="py-2.5 font-semibold text-emerald-400">{classA.label}</td>
                    <td className="py-2.5 font-semibold text-indigo-400">{classB.label}</td>
                    <td className="py-2.5 text-right font-mono text-zinc-500">—</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Median Latency</td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runA.summary?.medianLatencyMs.toFixed(1)} ms
                    </td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runB.summary?.medianLatencyMs.toFixed(1)} ms
                    </td>
                    <td className="py-2.5 text-right font-mono font-bold text-amber-400">
                      {medianDelta !== null ? `${medianDelta > 0 ? '+' : ''}${medianDelta.toFixed(1)} ms` : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Mean Latency</td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runA.summary?.meanLatencyMs.toFixed(1)} ms
                    </td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runB.summary?.meanLatencyMs.toFixed(1)} ms
                    </td>
                    <td className="py-2.5 text-right font-mono text-zinc-300">
                      {meanDelta !== null ? `${meanDelta > 0 ? '+' : ''}${meanDelta.toFixed(1)} ms` : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Min / Max Latency</td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runA.summary?.minLatencyMs.toFixed(0)} / {runA.summary?.maxLatencyMs.toFixed(0)} ms
                    </td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {runB.summary?.minLatencyMs.toFixed(0)} / {runB.summary?.maxLatencyMs.toFixed(0)} ms
                    </td>
                    <td className="py-2.5 text-right font-mono text-zinc-500">—</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Total Probes</td>
                    <td className="py-2.5 font-mono text-zinc-200">{runA.summary?.totalRequests}</td>
                    <td className="py-2.5 font-mono text-zinc-200">{runB.summary?.totalRequests}</td>
                    <td className="py-2.5 text-right font-mono text-zinc-400">
                      {(runB.summary?.totalRequests || 0) - (runA.summary?.totalRequests || 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-zinc-300">Failures / Timeouts</td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {(runA.summary?.failureCount || 0) + (runA.summary?.timeoutCount || 0)}
                    </td>
                    <td className="py-2.5 font-mono text-zinc-200">
                      {(runB.summary?.failureCount || 0) + (runB.summary?.timeoutCount || 0)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-zinc-400">
                      {((runB.summary?.failureCount || 0) + (runB.summary?.timeoutCount || 0)) -
                        ((runA.summary?.failureCount || 0) + (runA.summary?.timeoutCount || 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
