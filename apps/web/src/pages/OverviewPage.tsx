import React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Radio,
  Sliders,
  History,
  PlayCircle,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  useHealth,
  useToxiproxyEngine,
  useProfiles,
  useRuns,
  useStartRun,
} from '../api/hooks';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useNavigate } from 'react-router-dom';

export const OverviewPage: React.FC = () => {
  const { data: health, isLoading: isHealthLoading } = useHealth();
  const { data: toxiproxy, isLoading: isToxiLoading } = useToxiproxyEngine();
  const { data: profilesData, isLoading: isProfilesLoading } = useProfiles({ limit: 10 });
  const { data: runsData, isLoading: isRunsLoading } = useRuns({ limit: 10 });

  const startRun = useStartRun();
  const { toast } = useToast();
  const navigate = useNavigate();

  const runs = runsData?.items || [];
  const profiles = profilesData?.items || [];

  // Compute live metrics from actual API data
  const totalRuns = runsData?.total || runs.length;
  const completedRuns = runs.filter((r) => r.status === 'completed');
  const activeRuns = runs.filter((r) =>
    ['queued', 'preparing', 'running', 'collecting'].includes(r.status)
  );

  let totalSuccessfulRequests = 0;
  let totalMeasuredRequests = 0;
  for (const r of completedRuns) {
    if (r.summary) {
      totalSuccessfulRequests += r.summary.successCount;
      totalMeasuredRequests += r.summary.totalRequests;
    }
  }

  const successRate =
    totalMeasuredRequests > 0
      ? Math.round((totalSuccessfulRequests / totalMeasuredRequests) * 100)
      : 100;

  const handleQuickRun = async (profileId: string, profileName: string) => {
    try {
      const run = await startRun.mutateAsync(profileId);
      toast({
        title: 'Experiment Scheduled',
        message: `Run started for "${profileName}" (ID: ${run.id.slice(0, 8)}...)`,
        type: 'success',
      });
      navigate(`/runs/${run.id}`);
    } catch (err: any) {
      toast({
        title: 'Failed to Start Run',
        message: err.message,
        type: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Welcome / System Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-gradient-to-r from-surface-raised via-surface-raised to-indigo-950/30 border border-surface-border rounded-xl">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Network Failure Reproduction Platform</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Simulate downstream latency, packet timeouts, bandwidth bottlenecks, and connection resets with deterministic measurement.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/experiments/new">
            <Button icon={<PlayCircle className="w-4 h-4" />}>
              Create Experiment
            </Button>
          </Link>
          <Link to="/profiles">
            <Button variant="outline" icon={<Sliders className="w-4 h-4" />}>
              Manage Profiles
            </Button>
          </Link>
        </div>
      </div>

      {/* Engine & Health Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Toxiproxy Engine Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Fault Engine</span>
            <Radio className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            {isToxiLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div>
                <span className="text-lg font-bold text-zinc-100">Toxiproxy</span>
                <span className="text-xs text-zinc-500 font-mono ml-2">
                  v{toxiproxy?.version || '2.12'}
                </span>
              </div>
            )}
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                toxiproxy?.healthy
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                  : 'bg-rose-950/60 text-rose-400 border-rose-800/60'
              }`}
            >
              {toxiproxy?.healthy ? 'Online :8474' : 'Offline'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2 font-mono">
            Proxy Listener: 127.0.0.1:8666
          </p>
        </Card>

        {/* API Health Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Fastify REST API</span>
            <Activity className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            {isHealthLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div>
                <span className="text-lg font-bold text-zinc-100">Port 3100</span>
                <span className="text-xs text-zinc-500 font-mono ml-2">SQLite</span>
              </div>
            )}
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                health?.status === 'ok'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                  : 'bg-rose-950/60 text-rose-400 border-rose-800/60'
              }`}
            >
              {health?.status === 'ok' ? 'Ready' : 'Degraded'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">
            Uptime: {health ? `${Math.floor(health.uptimeSeconds / 60)}m ${health.uptimeSeconds % 60}s` : '—'}
          </p>
        </Card>

        {/* Total Profiles Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Saved Profiles</span>
            <Sliders className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            {isProfilesLoading ? (
              <Skeleton className="h-7 w-12" />
            ) : (
              <span className="text-2xl font-bold font-mono text-zinc-100">
                {profilesData?.total ?? profiles.length}
              </span>
            )}
            <Link to="/profiles" className="text-xs text-indigo-400 hover:text-indigo-300">
              View all →
            </Link>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">Configured fault patterns</p>
        </Card>

        {/* Experiment Runs Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Total Runs</span>
            <History className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            {isRunsLoading ? (
              <Skeleton className="h-7 w-12" />
            ) : (
              <div>
                <span className="text-2xl font-bold font-mono text-zinc-100">{totalRuns}</span>
                {activeRuns.length > 0 && (
                  <span className="ml-2 text-xs text-blue-400 font-medium">
                    ({activeRuns.length} active)
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-emerald-400 font-mono">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{successRate}% pass</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">Historical executions</p>
        </Card>
      </div>

      {/* Main Content Split: Recent Runs & Quick Start */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Runs Table (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card
            title="Recent Experiment Runs"
            description="Chronological log of fault injection experiments and replays"
            action={
              <Link to="/runs">
                <Button variant="ghost" size="sm">
                  View All Runs →
                </Button>
              </Link>
            }
          >
            {isRunsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 space-y-3">
                <AlertTriangle className="w-8 h-8 mx-auto text-zinc-600" />
                <p className="text-sm">No experiment runs recorded yet.</p>
                <Link to="/experiments/new">
                  <Button size="sm" variant="outline">
                    Launch Your First Run
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-xs text-zinc-400">
                      <th className="pb-3 font-medium">Run ID</th>
                      <th className="pb-3 font-medium">Profile</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium text-right">Median</th>
                      <th className="pb-3 font-medium text-right">Success</th>
                      <th className="pb-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {runs.slice(0, 6).map((run) => (
                      <tr key={run.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 font-mono text-xs text-zinc-300">
                          <Link to={`/runs/${run.id}`} className="hover:text-indigo-400">
                            {run.id.slice(0, 10)}...
                          </Link>
                        </td>
                        <td className="py-3 font-medium text-zinc-200">
                          {run.configSnapshot?.profileName || 'Ad-hoc Experiment'}
                        </td>
                        <td className="py-3">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="py-3 text-right font-mono text-xs text-zinc-300">
                          {run.summary?.medianLatencyMs !== undefined
                            ? `${run.summary.medianLatencyMs.toFixed(1)}ms`
                            : '—'}
                        </td>
                        <td className="py-3 text-right font-mono text-xs text-zinc-300">
                          {run.summary
                            ? `${run.summary.successCount}/${run.summary.totalRequests}`
                            : '—'}
                        </td>
                        <td className="py-3 text-right">
                          <Link to={`/runs/${run.id}`}>
                            <Button variant="ghost" size="sm" icon={<ArrowRight className="w-3.5 h-3.5" />}>
                              View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Available Profiles Quick Launcher (1 col) */}
        <div className="space-y-4">
          <Card
            title="Quick Launch Profiles"
            description="Trigger configured experiment profiles with one click"
            action={
              <Link to="/profiles">
                <Button variant="ghost" size="sm">
                  Manage →
                </Button>
              </Link>
            }
          >
            {isProfilesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 space-y-2">
                <p className="text-xs">No saved profiles found.</p>
                <Link to="/experiments/new">
                  <Button size="sm" variant="outline">
                    Create Profile
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {profiles.slice(0, 4).map((prof) => {
                  const faultSummary = prof.faults
                    .map((f) => {
                      if (f.type === 'latency') return `+${f.latencyMs}ms latency`;
                      if (f.type === 'timeout') return `${f.timeoutMs}ms timeout`;
                      if (f.type === 'bandwidth') return `${f.rateKbps} KB/s`;
                      return 'TCP reset';
                    })
                    .join(', ');

                  return (
                    <div
                      key={prof.id}
                      className="p-3 rounded-lg bg-surface border border-surface-border flex items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
                    >
                      <div className="min-w-0">
                        <h4 className="text-sm font-medium text-zinc-200 truncate">
                          {prof.name}
                        </h4>
                        <p className="text-xs text-indigo-400 font-mono truncate mt-0.5">
                          {faultSummary || 'Clean baseline (no faults)'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleQuickRun(prof.id, prof.name)}
                        isLoading={startRun.isPending}
                      >
                        Run
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Quick Architecture Summary */}
          <Card className="p-4 bg-surface/50 border-dashed">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Topology Reference
            </h4>
            <div className="space-y-1.5 text-xs text-zinc-400 font-mono">
              <div className="flex justify-between">
                <span>Test Target:</span>
                <span className="text-zinc-200">:3000 (direct)</span>
              </div>
              <div className="flex justify-between">
                <span>Toxiproxy Proxy:</span>
                <span className="text-zinc-200">:8666 (faulted)</span>
              </div>
              <div className="flex justify-between">
                <span>Toxiproxy API:</span>
                <span className="text-zinc-200">:8474 (control)</span>
              </div>
              <div className="flex justify-between">
                <span>Fastify API:</span>
                <span className="text-zinc-200">:3100 (REST)</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
