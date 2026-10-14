import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RotateCcw,
  StopCircle,
  Clock,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  FileCode,
} from 'lucide-react';
import {
  useRun,
  useRunRequests,
  useRunEvents,
  useReplayRun,
  useCancelRun,
  isTerminalStatus,
} from '../api/hooks';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Skeleton } from '../components/ui/Skeleton';
import { Dialog } from '../components/ui/Dialog';
import { LatencyTimelineChart } from '../components/charts/LatencyTimelineChart';
import { LatencyDistributionChart } from '../components/charts/LatencyDistributionChart';
import { useToast } from '../components/ui/Toast';

export const RunDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [isCancelOpen, setIsCancelOpen] = useState(false);

  const { data: run, isLoading: isRunLoading, error: runError } = useRun(id);
  const isActive = run ? !isTerminalStatus(run.status) : false;

  const { data: requests = [] } = useRunRequests(id, isActive);
  const { data: events = [] } = useRunEvents(id, isActive);

  const replayRun = useReplayRun();
  const cancelRun = useCancelRun();

  if (isRunLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (runError || !run) {
    return (
      <Card className="p-12 text-center text-zinc-400">
        <AlertTriangle className="w-10 h-10 mx-auto text-rose-500 mb-3" />
        <h3 className="text-base font-bold text-zinc-100">Run Not Found</h3>
        <p className="text-xs text-zinc-500 mt-1">
          {runError ? (runError as any).message : `No experiment run exists with ID "${id}".`}
        </p>
        <div className="mt-4">
          <Link to="/runs">
            <Button size="sm" variant="outline">
              ← Back to Runs
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  const snapshot = run.configSnapshot;
  const summary = run.summary;

  const handleReplay = async () => {
    try {
      const newRun = await replayRun.mutateAsync(run.id);
      toast({
        title: 'Replay Started',
        message: `New run created using snapshot (ID: ${newRun.id.slice(0, 8)}...)`,
        type: 'success',
      });
      navigate(`/runs/${newRun.id}`);
    } catch (err: any) {
      toast({ title: 'Replay Failed', message: err.message, type: 'error' });
    }
  };

  const handleCancelConfirm = async () => {
    try {
      await cancelRun.mutateAsync(run.id);
      toast({
        title: 'Run Cancelled',
        message: 'Experiment cancellation signal dispatched. Remaining probes stopped and toxics cleaned.',
        type: 'info',
      });
      setIsCancelOpen(false);
    } catch (err: any) {
      toast({ title: 'Cancel Failed', message: err.message, type: 'error' });
    }
  };

  const handleDownloadReport = async (format: 'json' | 'markdown') => {
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3100';
      const res = await fetch(`${baseUrl}/api/v1/runs/${run.id}/report?format=${format}`);
      if (!res.ok) throw new Error(`Report export failed with status ${res.status}`);

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netreplay-run-${run.id.slice(0, 8)}.${format === 'json' ? 'json' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Report Downloaded',
        message: `Saved ${format.toUpperCase()} report successfully`,
        type: 'success',
      });
    } catch (err: any) {
      toast({ title: 'Export Failed', message: err.message, type: 'error' });
    }
  };

  const calculateDuration = (): string => {
    if (!run.startedAt) return '—';
    const start = new Date(run.startedAt).getTime();
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
    const diff = end - start;
    if (diff < 1000) return `${diff}ms`;
    return `${(diff / 1000).toFixed(2)}s`;
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation & Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link
            to="/runs"
            className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Runs
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-zinc-100">
              {snapshot.profileName || 'Ad-hoc Experiment'}
            </h2>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-xs text-zinc-500 font-mono mt-1">
            Run ID: {run.id} {run.replayedFromId && `(Replayed from ${run.replayedFromId.slice(0, 8)}...)`}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isActive && (
            <Button
              variant="danger"
              size="sm"
              icon={<StopCircle className="w-4 h-4" />}
              onClick={() => setIsCancelOpen(true)}
            >
              Cancel Run
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            icon={<RotateCcw className="w-4 h-4" />}
            onClick={handleReplay}
            isLoading={replayRun.isPending}
          >
            Replay Snapshot
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon={<FileCode className="w-4 h-4" />}
            onClick={() => handleDownloadReport('json')}
          >
            JSON Report
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon={<FileText className="w-4 h-4" />}
            onClick={() => handleDownloadReport('markdown')}
          >
            Markdown Report
          </Button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Median Latency
          </span>
          <span className="text-xl font-bold font-mono text-indigo-400 mt-1 block">
            {summary?.medianLatencyMs !== undefined ? `${summary.medianLatencyMs.toFixed(1)}ms` : '—'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Mean Latency
          </span>
          <span className="text-xl font-bold font-mono text-zinc-200 mt-1 block">
            {summary?.meanLatencyMs !== undefined ? `${summary.meanLatencyMs.toFixed(1)}ms` : '—'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Min / Max
          </span>
          <span className="text-sm font-bold font-mono text-zinc-300 mt-2 block">
            {summary ? `${summary.minLatencyMs.toFixed(0)} / ${summary.maxLatencyMs.toFixed(0)}ms` : '—'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Successful Probes
          </span>
          <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">
            {summary ? `${summary.successCount}/${summary.totalRequests}` : '—'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Failed / Timeout
          </span>
          <span className="text-xl font-bold font-mono text-rose-400 mt-1 block">
            {summary ? `${summary.failureCount + summary.timeoutCount}` : '—'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Duration
          </span>
          <span className="text-xl font-bold font-mono text-zinc-200 mt-1 block">
            {calculateDuration()}
          </span>
        </Card>
      </div>

      {/* Latency Charts (Timeline + Distribution) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card
            title="Probe Request Latency Timeline"
            description="Per-request monotonic elapsed round-trip time in milliseconds"
          >
            <LatencyTimelineChart
              requests={requests}
              medianLatencyMs={summary?.medianLatencyMs}
              height={260}
            />
          </Card>
        </div>

        <div>
          <Card
            title="Latency Distribution"
            description="Bucketed response time frequency"
          >
            <LatencyDistributionChart requests={requests} height={260} />
          </Card>
        </div>
      </div>

      {/* Request Measurements Table & Event Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request Measurements (2 cols) */}
        <div className="lg:col-span-2">
          <Card
            title="Request-Level Measurements"
            description={`Individual probe telemetry (${requests.length} total recorded)`}
          >
            {requests.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                Waiting for runner probe measurements...
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-surface-raised border-b border-surface-border">
                    <tr className="text-zinc-400">
                      <th className="pb-2 font-medium">#</th>
                      <th className="pb-2 font-medium">Outcome</th>
                      <th className="pb-2 font-medium">HTTP Status</th>
                      <th className="pb-2 font-medium text-right">Latency</th>
                      <th className="pb-2 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {requests.map((r) => (
                      <tr key={r.id} className="hover:bg-zinc-800/30">
                        <td className="py-2 font-mono text-zinc-400">#{r.requestIndex}</td>
                        <td className="py-2">
                          {r.outcome === 'success' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Success
                            </span>
                          ) : r.outcome === 'timeout' ? (
                            <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                              <Clock className="w-3.5 h-3.5" /> Timeout
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                              <XCircle className="w-3.5 h-3.5" /> Failure
                            </span>
                          )}
                        </td>
                        <td className="py-2 font-mono text-zinc-300">
                          {r.statusCode || '—'}
                        </td>
                        <td className="py-2 text-right font-mono text-indigo-300 font-bold">
                          {r.latencyMs.toFixed(1)} ms
                        </td>
                        <td className="py-2 text-right font-mono text-zinc-500">
                          {r.timestamp.slice(11, 23)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Lifecycle Events & Snapshot Configuration (1 col) */}
        <div className="space-y-6">
          {/* Configuration Snapshot Card */}
          <Card
            title="Configuration Snapshot"
            description="Immutable parameters saved with this run"
          >
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Engine:</span>
                <span className="font-mono text-zinc-200">
                  {snapshot.engine} ({snapshot.engineVersion || 'v2.12'})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Target Path:</span>
                <span className="font-mono text-zinc-200">{snapshot.target?.path || '/api/demo'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Request Limit:</span>
                <span className="font-mono text-zinc-200">{snapshot.requestCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Timeout:</span>
                <span className="font-mono text-zinc-200">{snapshot.requestTimeoutMs}ms</span>
              </div>

              <div className="pt-2 border-t border-surface-border">
                <span className="text-zinc-400 block font-medium mb-1">Faults Applied:</span>
                {snapshot.faults?.map((f, i) => (
                  <div key={i} className="p-2 rounded bg-surface border border-surface-border font-mono text-[11px] text-indigo-300">
                    <strong>{f.type}</strong> ({f.stream || 'downstream'})
                    {f.type === 'latency' && `: +${f.latencyMs}ms delay, ±${f.jitterMs || 0}ms jitter`}
                    {f.type === 'timeout' && `: ${f.timeoutMs}ms stall`}
                    {f.type === 'bandwidth' && `: ${f.rateKbps} KB/s limit`}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Lifecycle Event Log */}
          <Card title="Lifecycle Event Audit Log" description="State transitions and engine events">
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">No lifecycle events recorded.</p>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2 rounded bg-surface border border-surface-border text-xs flex items-start gap-2"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-zinc-200">{ev.eventType}</span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {ev.timestamp.slice(11, 19)}
                        </span>
                      </div>
                      {ev.details && (
                        <pre className="mt-1 font-mono text-[10px] text-zinc-400 truncate">
                          {JSON.stringify(ev.details)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      <Dialog
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title="Cancel Active Experiment?"
        description="Are you sure you want to stop this experiment run?"
        confirmLabel="Cancel Run"
        confirmVariant="danger"
        onConfirm={handleCancelConfirm}
        isConfirmLoading={cancelRun.isPending}
      >
        <p className="text-xs text-zinc-300 leading-relaxed">
          Cancelling will abort future requests and guarantee immediate removal of injected toxics from the Toxiproxy proxy. Results collected so far will be saved.
        </p>
      </Dialog>
    </div>
  );
};
