import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../src/components/ui/Toast';
import { ExperimentCreatePage } from '../src/pages/ExperimentCreatePage';

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>{ui}</BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
};

describe('Forms and Validation Suite', () => {
  it('renders ExperimentCreatePage and restricts target endpoint to local test target', () => {
    renderWithProviders(<ExperimentCreatePage />);

    expect(screen.getByText('Create and Launch Experiment')).toBeInTheDocument();
    expect(screen.getByText('Compose New Fault')).toBeInTheDocument();
    expect(screen.getByText('Use Saved Profile')).toBeInTheDocument();

    // Verify target selector is restricted and does not allow arbitrary URL entry
    const targetSelect = screen.getByLabelText(/Test Target Endpoint/i);
    expect(targetSelect).toBeInTheDocument();
    expect(
      screen.getByText(
        /Restricted strictly to the local Node.js test-target via Toxiproxy listener/i
      )
    ).toBeInTheDocument();
  });

  it('updates pre-run summary in real-time when fault parameters change', () => {
    renderWithProviders(<ExperimentCreatePage />);

    // By default, latency is 250ms
    expect(screen.getByText(/Pre-Run Summary/i)).toBeInTheDocument();
    expect(screen.getByText(/\+250ms delay/i)).toBeInTheDocument();

    // Switch fault type to timeout
    const faultTypeSelect = screen.getByLabelText(/Fault Type/i);
    fireEvent.change(faultTypeSelect, { target: { value: 'timeout' } });

    // Summary should update to TCP stall
    expect(screen.getByText(/TCP stall 2000ms/i)).toBeInTheDocument();
  });

  it('switches between custom fault builder and saved profile selector', () => {
    renderWithProviders(<ExperimentCreatePage />);

    fireEvent.click(screen.getByText('Use Saved Profile'));
    expect(screen.getByText('Select Profile')).toBeInTheDocument();
    expect(screen.getByLabelText(/Saved Profile/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Compose New Fault'));
    expect(screen.getByText('Experiment Specifications')).toBeInTheDocument();
  });
});
