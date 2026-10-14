import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LatencyTimelineChart } from '../src/components/charts/LatencyTimelineChart';
import { LatencyDistributionChart } from '../src/components/charts/LatencyDistributionChart';
import { ComparisonChart } from '../src/components/charts/ComparisonChart';
import type { RequestResult } from '../src/types/api';

describe('Charts Suite', () => {
  const mockRequests: RequestResult[] = [
    {
      id: 'req-1',
      runId: 'run-1',
      requestIndex: 1,
      outcome: 'success',
      statusCode: 200,
      latencyMs: 254.2,
      timestamp: '2026-10-14T17:00:00.000Z',
    },
    {
      id: 'req-2',
      runId: 'run-1',
      requestIndex: 2,
      outcome: 'success',
      statusCode: 200,
      latencyMs: 248.6,
      timestamp: '2026-10-14T17:00:00.250Z',
    },
    {
      id: 'req-3',
      runId: 'run-1',
      requestIndex: 3,
      outcome: 'timeout',
      statusCode: null,
      latencyMs: 1000.0,
      timestamp: '2026-10-14T17:00:00.500Z',
    },
  ];

  it('renders LatencyTimelineChart empty state without crashing', () => {
    render(<LatencyTimelineChart requests={[]} />);
    expect(screen.getByText('No request measurements recorded yet.')).toBeInTheDocument();
  });

  it('renders LatencyTimelineChart with populated requests', () => {
    const { container } = render(
      <LatencyTimelineChart requests={mockRequests} medianLatencyMs={254.2} />
    );
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('renders LatencyDistributionChart empty state gracefully', () => {
    render(<LatencyDistributionChart requests={[]} />);
    expect(screen.getByText('No distribution data.')).toBeInTheDocument();
  });

  it('renders LatencyDistributionChart with populated data', () => {
    const { container } = render(<LatencyDistributionChart requests={mockRequests} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('renders ComparisonChart with empty comparison sets gracefully', () => {
    render(
      <ComparisonChart
        runAName="Baseline"
        runBName="Faulted"
        requestsA={[]}
        requestsB={[]}
      />
    );
    expect(screen.getByText('No comparison data available.')).toBeInTheDocument();
  });

  it('renders ComparisonChart with two populated run sets', () => {
    const requestsB: RequestResult[] = [
      {
        id: 'req-b-1',
        runId: 'run-2',
        requestIndex: 1,
        outcome: 'success',
        statusCode: 200,
        latencyMs: 504.1,
        timestamp: '2026-10-14T17:05:00.000Z',
      },
    ];

    const { container } = render(
      <ComparisonChart
        runAName="Baseline Direct"
        runBName="+500ms Downstream"
        requestsA={mockRequests}
        requestsB={requestsB}
      />
    );
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });
});
