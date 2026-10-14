import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  History,
  RotateCcw,
  ArrowRight,
  Filter,
  Download,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useRuns, useReplayRun } from '../api/hooks';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Skeleton } from '../components/ui/Skeleton';
import { Select } from '../components/ui/Select';
import { useToast } from '../components/ui/Toast';

export const RunsPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useRuns({
    page,
    limit: 20,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  const replayRun = useReplayRun();
  const { toast } = useToast();
  const navigate = useNavigate();

  const runs = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const handleReplay = async (id: string, profileName: string) => {
    try {
      const newRun = await replayRun.mutateAsync(id);
      toast({
        title: 'Replay Initiated',
        message: `New run created cloning snapshot from "${profileName}"`,
        type: 'success',
      });
      navigate(`/runs/${newRun.id}`);
    } catch (err: any) {
      toast({ title: 'Replay Failed', message: err.message, type: 'error' });
    }
  };

  const handleDownloadReport = async (runId: string, format: 'json' | 'markdown') => {
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3100';
      const res = await fetch(`${baseUrl}/api/v1/runs/${runId}/report?format=${format}`);
      if (!res.ok) throw new Error(`Report export failed with status ${res.status}`);

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netreplay-run-${runId.slice(0, 8)}.${format === 'json' ? 'json' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Report Downloaded',
        message: `Saved ${format.toUpperCase()} report for run ${runId.slice(0, 8)}`,
        type: 'success',
      });
    } catch (err: any) {
      toast({ title: 'Download Failed', message: err.message, type: 'error' });
    }
  };

  const calculateDuration = (startedAt?: string | null, finishedAt?: string | null): string => {
    if (!startedAt) return '—';
    const start = new Date(startedAt).getTime();
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    const diff = end - start;
    if (diff < 1000) return `${diff}ms`;
    return `${(diff / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-400" />
            Experiment Runs
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Historical executions with real-time status tracking and snapshot replays.
          </p>
        </div>

        {/* Filter Dropdown */}
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-zinc-500" />
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-44 text-xs py-1.5"
          >
            <option value="all">All Statuses ({total})</option>
            <option value="running">Running / Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </div>

      {/* Runs Table Card */}
      <Card>
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <p className="font-semibold text-sm">Error Loading Runs</p>
            <p className="text-xs text-zinc-400 mt-1">{(error as any).message}</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center text-zinc-400 space-y-3">
            <History className="w-10 h-10 mx-auto text-zinc-600" />
            <h3 className="text-sm font-semibold text-zinc-200">No experiment runs found</h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              {statusFilter !== 'all'
                ? `No runs found with status "${statusFilter}". Try selecting "All Statuses".`
                : 'Start an experiment from a saved profile or compose a new network fault.'}
            </p>
            <Link to="/experiments/new">
              <Button size="sm">Start an Experiment</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-border text-xs text-zinc-400">
                  <th className="pb-3 font-medium">Run ID</th>
                  <th className="pb-3 font-medium">Profile Name</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Duration</th>
                  <th className="pb-3 font-medium text-right">Probes</th>
                  <th className="pb-3 font-medium text-right">Median Latency</th>
                  <th className="pb-3 font-medium text-right">Outcomes</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {runs.map((run) => {
                  const duration = calculateDuration(run.startedAt, run.finishedAt);
                  const profileName = run.configSnapshot?.profileName || 'Ad-hoc Experiment';
                  const summary = run.summary;

                  return (
                    <tr key={run.id} className="hover:bg-zinc-800/20 transition-colors">
                      <td className="py-3 font-mono text-xs text-zinc-300">
                        <Link to={`/runs/${run.id}`} className="hover:text-indigo-400 font-bold">
                          {run.id.slice(0, 10)}...
                        </Link>
                        {run.replayedFromId && (
                          <span className="block text-[10px] text-zinc-500 font-mono">
                            replayed
                          </span>
                        )}
                      </td>
                      <td className="py-3 font-medium text-zinc-200">
                        {profileName}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-3 text-xs text-zinc-400 font-mono">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          {duration}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono text-xs text-zinc-300">
                        {summary?.totalRequests || run.configSnapshot?.requestCount || '—'}
                      </td>
                      <td className="py-3 text-right font-mono text-xs text-zinc-200">
                        {summary?.medianLatencyMs !== undefined
                          ? `${summary.medianLatencyMs.toFixed(1)} ms`
                          : '—'}
                      </td>
                      <td className="py-3 text-right">
                        {summary ? (
                          <div className="inline-flex items-center gap-2 text-xs font-mono">
                            <span className="inline-flex items-center text-emerald-400 gap-0.5">
                              <CheckCircle2 className="w-3 h-3" />
                              {summary.successCount}
                            </span>
                            {summary.failureCount > 0 && (
                              <span className="inline-flex items-center text-rose-400 gap-0.5">
                                <XCircle className="w-3 h-3" />
                                {summary.failureCount}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link to={`/runs/${run.id}`}>
                            <Button variant="ghost" size="sm" title="View Run Details">
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>

                          <Button
                            variant="ghost"
                            size="sm"
                            title="Replay Run from Snapshot"
                            onClick={() => handleReplay(run.id, profileName)}
                            isLoading={replayRun.isPending}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            title="Download JSON Report"
                            onClick={() => handleDownloadReport(run.id, 'json')}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-surface-border flex items-center justify-between text-xs text-zinc-400">
            <span>
              Page {page} of {totalPages} ({total} total runs)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
