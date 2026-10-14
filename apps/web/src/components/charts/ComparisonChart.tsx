import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { RequestResult } from '../../types/api';

interface ComparisonChartProps {
  runAName: string;
  runBName: string;
  requestsA: RequestResult[];
  requestsB: RequestResult[];
  height?: number;
}

export const ComparisonChart: React.FC<ComparisonChartProps> = ({
  runAName,
  runBName,
  requestsA,
  requestsB,
  height = 280,
}) => {
  const maxLen = Math.max(requestsA.length, requestsB.length);

  if (maxLen === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-zinc-500 bg-surface/50 border border-surface-border rounded-lg"
        style={{ height }}
      >
        No comparison data available.
      </div>
    );
  }

  const data: Array<{
    index: number;
    latencyA: number | null;
    latencyB: number | null;
  }> = [];

  for (let i = 1; i <= maxLen; i++) {
    const rA = requestsA.find((r) => r.requestIndex === i);
    const rB = requestsB.find((r) => r.requestIndex === i);
    data.push({
      index: i,
      latencyA: rA ? rA.latencyMs : null,
      latencyB: rB ? rB.latencyMs : null,
    });
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="index"
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            tickFormatter={(v) => `#${v}`}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            tickFormatter={(v) => `${v}ms`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const item = payload[0].payload;
                return (
                  <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-lg shadow-xl text-xs space-y-1.5">
                    <div className="font-semibold text-zinc-200">Request #{item.index}</div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-emerald-400 font-medium">{runAName}:</span>
                      <span className="font-mono text-zinc-100 font-bold">
                        {item.latencyA !== null ? `${item.latencyA.toFixed(1)} ms` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-indigo-400 font-medium">{runBName}:</span>
                      <span className="font-mono text-zinc-100 font-bold">
                        {item.latencyB !== null ? `${item.latencyB.toFixed(1)} ms` : 'N/A'}
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value) => <span className="text-xs text-zinc-300 font-medium">{value}</span>}
          />
          <Line
            type="monotone"
            name={runAName}
            dataKey="latencyA"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3, fill: '#10b981' }}
            connectNulls
          />
          <Line
            type="monotone"
            name={runBName}
            dataKey="latencyB"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: '#6366f1' }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
