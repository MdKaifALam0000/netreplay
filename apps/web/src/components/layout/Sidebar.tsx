import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Sliders,
  PlayCircle,
  History,
  GitCompare,
  BookOpen,
  Activity,
  Radio,
} from 'lucide-react';
import { useToxiproxyEngine, useV1Health } from '../../api/hooks';
import { clsx } from 'clsx';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { data: toxiproxy } = useToxiproxyEngine();
  const { data: health } = useV1Health();

  const navItems = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/profiles', label: 'Profiles', icon: Sliders },
    { to: '/experiments/new', label: 'New Experiment', icon: PlayCircle },
    { to: '/runs', label: 'Experiment Runs', icon: History },
    { to: '/compare', label: 'Run Comparison', icon: GitCompare },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={clsx(
          'fixed top-0 bottom-0 left-0 z-40 w-64 bg-surface border-r border-surface-border flex flex-col transition-transform duration-200 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="h-16 px-6 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-950">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-zinc-100">NetReplay</span>
              <span className="block text-[10px] text-zinc-500 font-mono">v0.1.0 • DevTools</span>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Platform
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  )
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          <div className="pt-6 px-3 pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Resources
          </div>
          <a
            href="http://127.0.0.1:3100/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>Swagger Docs</span>
            </div>
            <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
              :3100
            </span>
          </a>
        </nav>

        {/* Engine and Health Status Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-raised/40 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-zinc-500" /> Toxiproxy
            </span>
            <span
              className={clsx(
                'inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded',
                toxiproxy?.healthy
                  ? 'bg-emerald-950/60 text-emerald-400'
                  : 'bg-rose-950/60 text-rose-400'
              )}
            >
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  toxiproxy?.healthy ? 'bg-emerald-400' : 'bg-rose-400'
                )}
              />
              {toxiproxy?.healthy ? `v${toxiproxy.version || '2.12'}` : 'Offline'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-zinc-500" /> Database
            </span>
            <span
              className={clsx(
                'inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded',
                health?.database === 'connected'
                  ? 'bg-emerald-950/60 text-emerald-400'
                  : 'bg-rose-950/60 text-rose-400'
              )}
            >
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  health?.database === 'connected' ? 'bg-emerald-400' : 'bg-rose-400'
                )}
              />
              {health?.database === 'connected' ? 'SQLite' : 'Disconnected'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
