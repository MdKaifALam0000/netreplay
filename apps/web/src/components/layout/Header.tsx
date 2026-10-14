import React from 'react';
import { Menu, PlayCircle, Radio, Activity } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useToxiproxyEngine, useV1Health } from '../../api/hooks';
import { clsx } from 'clsx';

interface HeaderProps {
  onMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const location = useLocation();
  const { data: toxiproxy } = useToxiproxyEngine();
  const { data: health } = useV1Health();

  const getPageMeta = (pathname: string) => {
    if (pathname === '/') return { title: 'System Overview', subtitle: 'Live engine metrics and experiment telemetry' };
    if (pathname === '/profiles') return { title: 'Experiment Profiles', subtitle: 'Configured network failure blueprints' };
    if (pathname === '/experiments/new') return { title: 'New Experiment', subtitle: 'Compose and execute a bounded fault experiment' };
    if (pathname.startsWith('/runs/') && pathname !== '/runs') return { title: 'Run Details', subtitle: 'Inspection, measurement traces, and replay' };
    if (pathname === '/runs') return { title: 'Experiment Runs', subtitle: 'Historical execution runs and audit log' };
    if (pathname === '/compare') return { title: 'Run Comparison', subtitle: 'Side-by-side latency and reliability variance' };
    return { title: 'NetReplay', subtitle: 'Network failure reproduction platform' };
  };

  const meta = getPageMeta(location.pathname);

  return (
    <header className="h-16 px-6 border-b border-surface-border bg-surface/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 lg:hidden"
          aria-label="Open sidebar menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-base font-bold text-zinc-100 leading-tight">{meta.title}</h1>
          <p className="text-xs text-zinc-400 hidden sm:block">{meta.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Live Connectivity Badges */}
        <div className="hidden md:flex items-center gap-2">
          <div
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border',
              toxiproxy?.healthy
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                : 'bg-rose-950/40 text-rose-400 border-rose-800/40'
            )}
            title={toxiproxy?.healthy ? `Toxiproxy online on port 8474 (v${toxiproxy.version})` : 'Toxiproxy unreachable'}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Toxiproxy</span>
            <span className={clsx('w-1.5 h-1.5 rounded-full', toxiproxy?.healthy ? 'bg-emerald-400' : 'bg-rose-400')} />
          </div>

          <div
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border',
              health?.status === 'ok'
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                : 'bg-rose-950/40 text-rose-400 border-rose-800/40'
            )}
            title={health?.status === 'ok' ? 'Fastify API + SQLite operational' : 'API unreachable'}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>API :3100</span>
            <span className={clsx('w-1.5 h-1.5 rounded-full', health?.status === 'ok' ? 'bg-emerald-400' : 'bg-rose-400')} />
          </div>
        </div>

        {location.pathname !== '/experiments/new' && (
          <Link to="/experiments/new">
            <Button size="sm" icon={<PlayCircle className="w-4 h-4" />}>
              New Experiment
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
};
