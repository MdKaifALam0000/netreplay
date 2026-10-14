import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import type { RequestResult } from '../../types/api';

interface LatencyDistributionChartProps {
  requests: RequestResult[];
  height?: number;
}

export const LatencyDistributionChart: React.FC<LatencyDistributionChartProps> = ({
  requests,
  height = 200,
}) => {
  if (!requests || requests.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-zinc-500 bg-surface/50 border border-surface-border rounded-lg"
        style={{ height }}
      >
        No distribution data.
      </div>
    );
  }

  // Define buckets
  const buckets = [
    { label: '< 10ms', min: 0, max: 10, count: 0, color: '#10b981' },
    { label: '10-50ms', min: 10, max: 50, count: 0, color: '#3b82f6' },
    { label: '50-200ms', min: 50, max: 200, count: 0, color: '#6366f1' },
    { label: '200-500ms', min: 200, max: 500, count: 0, color: '#f59e0b' },
    { label: '> 500ms', min: 500, max: Infinity, count: 0, color: '#ef4444' },
  ];

  for (const r of requests) {
    for (const b of buckets) {
      if (r.latencyMs >= b.min && r.latencyMs < b.max) {
        b.count++;
        break;
      }
    }
  }

  const data = buckets.filter((b) => b.count > 0 || true);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} />
          <YAxis stroke="#71717a" fontSize={11} tickLine={false} allowDecimals={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const item = payload[0].payload;
                return (
                  <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg shadow-xl text-xs space-y-1">
                    <div className="font-semibold text-zinc-200">{item.label}</div>
                    <div className="text-zinc-400">
                      Requests:{' '}
                      <span className="font-bold font-mono text-zinc-100">{item.count}</span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
