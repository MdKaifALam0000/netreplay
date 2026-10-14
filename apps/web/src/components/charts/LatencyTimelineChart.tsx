import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { RequestResult } from '../../types/api';

interface LatencyTimelineChartProps {
  requests: RequestResult[];
  medianLatencyMs?: number;
  height?: number;
}

export const LatencyTimelineChart: React.FC<LatencyTimelineChartProps> = ({
  requests,
  medianLatencyMs,
  height = 260,
}) => {
  if (!requests || requests.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-zinc-500 bg-surface/50 border border-surface-border rounded-lg"
        style={{ height }}
      >
        No request measurements recorded yet.
      </div>
    );
  }

  const data = requests.map((r) => ({
    index: r.requestIndex,
    latency: r.latencyMs,
    outcome: r.outcome,
    statusCode: r.statusCode,
    error: r.errorCategory,
  }));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="index"
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            tickFormatter={(val) => `#${val}`}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            tickFormatter={(val) => `${val}ms`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const item = payload[0].payload;
                const outcomeColor =
                  item.outcome === 'success'
                    ? 'text-emerald-400'
                    : item.outcome === 'timeout'
                    ? 'text-amber-400'
                    : 'text-rose-400';

                return (
                  <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg shadow-xl text-xs space-y-1">
                    <div className="font-semibold text-zinc-200">Request #{item.index}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400">Latency:</span>
                      <span className="font-mono text-indigo-400 font-bold">
                        {item.latency.toFixed(1)} ms
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400">Outcome:</span>
                      <span className={`font-medium capitalize ${outcomeColor}`}>
                        {item.outcome} {item.statusCode ? `(${item.statusCode})` : ''}
                      </span>
                    </div>
                    {item.error && (
                      <div className="text-rose-400 text-[10px]">Error: {item.error}</div>
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          {medianLatencyMs !== undefined && medianLatencyMs > 0 && (
            <ReferenceLine
              y={medianLatencyMs}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{
                value: `Median: ${medianLatencyMs.toFixed(1)}ms`,
                fill: '#10b981',
                fontSize: 10,
                position: 'top',
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="latency"
            stroke="#6366f1"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#latencyGradient)"
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              const fill =
                payload.outcome === 'success'
                  ? '#10b981'
                  : payload.outcome === 'timeout'
                  ? '#f59e0b'
                  : '#ef4444';
              return (
                <circle
                  key={`dot-${payload.index}`}
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill={fill}
                  stroke="#09090b"
                  strokeWidth={1.5}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
