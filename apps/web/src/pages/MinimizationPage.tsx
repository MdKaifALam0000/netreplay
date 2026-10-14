import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  useMinimization,
  useMinimizationAttempts,
  useCancelMinimization,
} from '../api/hooks';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Layers,
  StopCircle,
  ShieldCheck,
  Activity,
  Sliders,
  MinusCircle,
  HelpCircle,
} from 'lucide-react';
import type { MinimizationStatus, Fault } from '../types/api';

const statusBadgeVariant = (
  status: MinimizationStatus
): 'neutral' | 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'purple' => {
  switch (status) {
    case 'completed':
      return 'emerald';
    case 'running':
    case 'queued':
      return 'indigo';
    case 'budget_exhausted':
    case 'baseline_not_reproducible':
      return 'amber';
    case 'failed':
      return 'rose';
    case 'cancelled':
    default:
      return 'neutral';
  }
};

const stageBadgeVariant = (
  stage: string
): 'neutral' | 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'purple' => {
  switch (stage) {
    case 'baseline':
      return 'blue';
    case 'component_reduction':
      return 'amber';
    case 'parameter_minimization':
      return 'purple';
    case 'verification':
      return 'emerald';
    default:
      return 'neutral';
  }
};

export const MinimizationPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isCancelOpen, setIsCancelOpen] = useState(false);

  const { data: minimization, isLoading, error } = useMinimization(id);
  const isActive = minimization?.status === 'running' || minimization?.status === 'queued';

  const { data: attemptsData } = useMinimizationAttempts(id, isActive);
  const cancelMutation = useCancelMinimization();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Activity className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-zinc-400">Loading minimization results...</p>
        </div>
      </div>
    );
  }

  if (error || !minimization) {
    return (
      <Card className="p-8 text-center border-red-900/50">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Minimization Job Not Found</h2>
        <p className="text-zinc-400 text-sm mb-6">
          {(error as any)?.message || 'The requested failure minimization record could not be loaded.'}
        </p>
        <Link to="/runs">
          <Button variant="secondary" icon={<ArrowLeft className="w-4 h-4" />}>
            Back to Experiments
          </Button>
        </Link>
      </Card>
    );
  }

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(minimization.id);
      toast({
        title: 'Minimization Cancelled',
        message: 'Active search cancelled and proxy state cleaned.',
        type: 'info',
      });
      setIsCancelOpen(false);
    } catch (err: any) {
      toast({ title: 'Cancel Failed', message: err.message, type: 'error' });
    }
  };

  const originalFaults: Fault[] = minimization.originalConfigSnapshot?.faults || [];
  const minimizedFaults: Fault[] = minimization.minimizedConfig || [];
  const diffs = minimization.differences;

  return (
    <div className="space-y-6">
      {/* Header and Breadcrumbs */}
      <div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
          <Link to="/runs" className="hover:text-zinc-200">
            Runs
          </Link>
          <span>/</span>
          <Link to={`/runs/${minimization.sourceRunId}`} className="hover:text-zinc-200">
            {minimization.sourceRunId.slice(0, 8)}...
          </Link>
          <span>/</span>
          <span className="text-zinc-200">Failure Minimization</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">Automatic Failure Minimization</h1>
              <Badge variant={statusBadgeVariant(minimization.status)}>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse mr-1.5" />}
                {minimization.status.toUpperCase().replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Discovers the smallest network fault configuration that still reproduces the specified failure condition.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isActive && (
              <Button
                variant="danger"
                size="sm"
                icon={<StopCircle className="w-4 h-4" />}
                onClick={() => setIsCancelOpen(true)}
                isLoading={cancelMutation.isPending}
              >
                Cancel Search
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate(`/runs/${minimization.sourceRunId}`)}
            >
              Source Run
            </Button>
          </div>
        </div>
      </div>

      {/* Cleanup Warning Alert if cleanup failed */}
      {minimization.cleanupStatus === 'cleanup_failed' && (
        <div className="bg-red-950/60 border border-red-500/50 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-red-200">High Severity: Proxy Cleanup Failed</h4>
            <p className="text-xs text-red-300/80 mt-1">
              The engine could not cleanly restore the proxy to a zero-fault state. Check Toxiproxy connectivity.
            </p>
          </div>
        </div>
      )}

      {/* Baseline not reproducible alert */}
      {minimization.status === 'baseline_not_reproducible' && (
        <div className="bg-amber-950/50 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-amber-200">Baseline Could Not Be Reproduced</h4>
            <p className="text-xs text-amber-300/80 mt-1">
              The target failure condition did not trigger under the original fault configuration. Minimization halted early because no reproducible baseline could be established.
            </p>
          </div>
        </div>
      )}

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Attempts Used
          </span>
          <span className="text-xl font-bold font-mono text-indigo-400 mt-1 block">
            {minimization.attemptsUsed} / {minimization.maxAttempts}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Elapsed Time
          </span>
          <span className="text-xl font-bold font-mono text-zinc-200 mt-1 block">
            {minimization.durationMs ? `${(minimization.durationMs / 1000).toFixed(1)}s` : 'Active'}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Target Predicate
          </span>
          <span className="text-sm font-semibold font-mono text-emerald-400 mt-1.5 block truncate">
            {minimization.predicate.type}
          </span>
        </Card>

        <Card className="p-3 text-center">
          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
            Final Observed Rate
          </span>
          <span className="text-xl font-bold font-mono text-purple-400 mt-1 block">
            {minimization.finalObservedRate !== null && minimization.finalObservedRate !== undefined
              ? `${Math.round(minimization.finalObservedRate * 100)}%`
              : '—'}
          </span>
        </Card>
      </div>

      {/* Reductions Summary Banner */}
      {diffs && (diffs.removedFaults.length > 0 || diffs.modifiedFaults.length > 0) && (
        <Card className="p-4 bg-gradient-to-r from-emerald-950/30 to-zinc-900/60 border-emerald-500/30">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-semibold text-white">Minimization Reductions Discovered</h3>
              <ul className="text-xs space-y-1 text-zinc-300">
                {diffs.removedFaults.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-emerald-300">
                    <MinusCircle className="w-3.5 h-3.5 text-red-400" />
                    <span>
                      Removed unnecessary component: <strong className="font-mono">{f.name || f.type}</strong> ({f.type})
                    </span>
                  </li>
                ))}
                {diffs.modifiedFaults.map((m, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-indigo-300">
                    <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      Reduced numeric parameters on <strong className="font-mono">{m.faultType}</strong>: {m.reductionSummary}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Side-by-side Configuration Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Original Faults */}
        <Card className="p-5">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-semibold text-white">Original Fault Configuration</h3>
            </div>
            <span className="text-xs text-zinc-400">{originalFaults.length} components</span>
          </div>

          <div className="mt-4 space-y-2">
            {originalFaults.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">No faults configured</p>
            ) : (
              originalFaults.map((fault, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs flex justify-between items-center"
                >
                  <div>
                    <span className="font-mono font-semibold text-zinc-200">{fault.name || fault.type}</span>
                    <span className="text-zinc-500 ml-2 font-mono">({fault.type})</span>
                  </div>
                  <div className="font-mono text-zinc-400 text-right">
                    {fault.type === 'latency' && `${fault.latencyMs}ms (jitter: ${fault.jitterMs || 0}ms)`}
                    {fault.type === 'timeout' && `${fault.timeoutMs}ms timeout`}
                    {fault.type === 'bandwidth' && `${fault.rateKbps} kbps`}
                    {(fault.type === 'reset' || fault.type === 'reset_peer') && 'TCP Reset'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Minimized Faults */}
        <Card className="p-5 border-indigo-900/40">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Minimized Fault Configuration</h3>
            </div>
            <span className="text-xs text-indigo-400">{minimizedFaults.length} components</span>
          </div>

          <div className="mt-4 space-y-2">
            {minimizedFaults.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                {isActive ? 'Searching for minimized configuration...' : 'No faults required to reproduce failure'}
              </p>
            ) : (
              minimizedFaults.map((fault, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-500/30 text-xs flex justify-between items-center"
                >
                  <div>
                    <span className="font-mono font-semibold text-indigo-200">{fault.name || fault.type}</span>
                    <span className="text-indigo-400 ml-2 font-mono">({fault.type})</span>
                  </div>
                  <div className="font-mono text-indigo-300 text-right font-medium">
                    {fault.type === 'latency' && `${fault.latencyMs}ms (jitter: ${fault.jitterMs || 0}ms)`}
                    {fault.type === 'timeout' && `${fault.timeoutMs}ms timeout`}
                    {fault.type === 'bandwidth' && `${fault.rateKbps} kbps`}
                    {(fault.type === 'reset' || fault.type === 'reset_peer') && 'TCP Reset'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Explanatory Note on Bounded Empirical Strategy */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300 block mb-1">Empirical Result Disclaimer</span>
        This result represents the smallest network fault configuration discovered within the configured search strategy (Staged Delta Debugging), attempt budget ({minimization.maxAttempts}), and time limit. Due to network stochasticity and non-monotonic application behaviors, this is an empirical optimum within the bounded search space rather than a mathematical global minimum proof.
      </div>

      {/* Attempts Search History Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-white">Search History & Attempts</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Chronological log of candidate evaluations and delta-debugging decisions.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-400">{attemptsData?.items.length || 0} evaluations</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 font-medium">
                <th className="pb-2 pl-2">#</th>
                <th className="pb-2">Stage</th>
                <th className="pb-2">Change Tested</th>
                <th className="pb-2">Triggered</th>
                <th className="pb-2">Trials</th>
                <th className="pb-2">Outcome</th>
                <th className="pb-2 text-right pr-2">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {!attemptsData?.items || attemptsData.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500 italic">
                    {isActive ? 'Waiting for first evaluation attempt...' : 'No attempts recorded'}
                  </td>
                </tr>
              ) : (
                attemptsData.items.map((attempt) => (
                  <tr key={attempt.id} className="hover:bg-zinc-800/30">
                    <td className="py-2.5 pl-2 text-zinc-500 font-bold">{attempt.attemptNumber}</td>
                    <td className="py-2.5 font-sans">
                      <Badge variant={stageBadgeVariant(attempt.stage)} size="sm">
                        {attempt.stage.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="py-2.5 font-sans text-zinc-200 font-medium max-w-xs truncate" title={attempt.changeDesc}>
                      {attempt.changeDesc}
                    </td>
                    <td className="py-2.5">
                      {attempt.triggered ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1 font-sans">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-zinc-500 flex items-center gap-1 font-sans">
                          <XCircle className="w-3.5 h-3.5 text-zinc-600" /> No
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-zinc-300">
                      {attempt.failedTrials}/{attempt.trialCount} ({Math.round(attempt.reproductionRate * 100)}%)
                    </td>
                    <td className="py-2.5 font-sans">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          attempt.outcome === 'kept' || attempt.outcome === 'verified' || attempt.outcome === 'baseline_verified'
                            ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/30'
                            : 'bg-zinc-800/70 text-zinc-400 border border-zinc-700/30'
                        }`}
                      >
                        {attempt.outcome.toUpperCase().replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 text-right pr-2 text-zinc-400">{attempt.durationMs}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cancellation Confirmation Dialog */}
      <Dialog
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title="Cancel Failure Minimization"
        description="Are you sure you want to stop the ongoing search?"
        confirmLabel="Confirm Cancel"
        confirmVariant="danger"
        onConfirm={handleCancel}
        isConfirmLoading={cancelMutation.isPending}
      >
        <p className="text-xs text-zinc-300 leading-relaxed">
          The ongoing search will stop immediately, the proxy will be cleaned of any injected candidate faults, and the simplest configuration found so far will be saved.
        </p>
      </Dialog>
    </div>
  );
};
