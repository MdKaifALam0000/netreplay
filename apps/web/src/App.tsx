import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ui/Toast';
import { AppShell } from './components/layout/AppShell';

import { OverviewPage } from './pages/OverviewPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { ExperimentCreatePage } from './pages/ExperimentCreatePage';
import { RunsPage } from './pages/RunsPage';
import { RunDetailsPage } from './pages/RunDetailsPage';
import { RunComparisonPage } from './pages/RunComparisonPage';
import { NotFoundPage } from './pages/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="profiles" element={<ProfilesPage />} />
              <Route path="experiments/new" element={<ExperimentCreatePage />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="runs/:id" element={<RunDetailsPage />} />
              <Route path="compare" element={<RunComparisonPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
};
