import React from 'react';
import type { RunStatus } from '../../types/api';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface StatusBadgeProps {
  status: RunStatus | string;
  className?: string;
  showDot?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  showDot = true,
}) => {
  const normalized = status.toLowerCase() as RunStatus;

  const config: Record<
    RunStatus,
    { label: string; bg: string; text: string; border: string; dot: string; ping?: boolean }
  > = {
    queued: {
      label: 'Queued',
      bg: 'bg-zinc-800/80',
      text: 'text-zinc-300',
      border: 'border-zinc-700',
      dot: 'bg-zinc-400',
      ping: true,
    },
    preparing: {
      label: 'Preparing',
      bg: 'bg-sky-950/50',
      text: 'text-sky-400',
      border: 'border-sky-800/60',
      dot: 'bg-sky-400',
      ping: true,
    },
    running: {
      label: 'Running',
      bg: 'bg-blue-950/60',
      text: 'text-blue-400',
      border: 'border-blue-700/80',
      dot: 'bg-blue-400',
      ping: true,
    },
    collecting: {
      label: 'Collecting',
      bg: 'bg-indigo-950/50',
      text: 'text-indigo-400',
      border: 'border-indigo-800/60',
      dot: 'bg-indigo-400',
      ping: true,
    },
    completed: {
      label: 'Completed',
      bg: 'bg-emerald-950/50',
      text: 'text-emerald-400',
      border: 'border-emerald-800/60',
      dot: 'bg-emerald-400',
    },
    failed: {
      label: 'Failed',
      bg: 'bg-rose-950/50',
      text: 'text-rose-400',
      border: 'border-rose-800/60',
      dot: 'bg-rose-400',
    },
    cancelled: {
      label: 'Cancelled',
      bg: 'bg-amber-950/50',
      text: 'text-amber-400',
      border: 'border-amber-800/60',
      dot: 'bg-amber-400',
    },
  };

  const current = config[normalized] || {
    label: status,
    bg: 'bg-zinc-800',
    text: 'text-zinc-300',
    border: 'border-zinc-700',
    dot: 'bg-zinc-400',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border font-mono tracking-tight select-none',
          current.bg,
          current.text,
          current.border,
          className
        )
      )}
    >
      {showDot && (
        <span className="relative flex h-2 w-2">
          {current.ping && (
            <span
              className={clsx(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                current.dot
              )}
            />
          )}
          <span className={clsx('relative inline-flex rounded-full h-2 w-2', current.dot)} />
        </span>
      )}
      {current.label}
    </span>
  );
};
