/**
 * NetReplay TanStack Query Hooks
 * Implements bounded polling: only polls while runs are active (non-terminal).
 * Automatically stops polling when all runs reach terminal states.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type {
  CreateProfileInput,
  UpdateProfileInput,
  RunStatus,
} from '../types/api';

export const isTerminalStatus = (status: RunStatus | string): boolean => {
  return ['completed', 'failed', 'cancelled'].includes(status);
};

// Health and Engines
export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth(),
    refetchInterval: 15000,
    staleTime: 10000,
  });

export const useV1Health = () =>
  useQuery({
    queryKey: ['v1-health'],
    queryFn: () => apiClient.getV1Health(),
    refetchInterval: 15000,
    staleTime: 10000,
  });

export const useEngines = () =>
  useQuery({
    queryKey: ['engines'],
    queryFn: () => apiClient.getEngines(),
    refetchInterval: 15000,
    staleTime: 10000,
  });

export const useToxiproxyEngine = () =>
  useQuery({
    queryKey: ['engine-toxiproxy'],
    queryFn: () => apiClient.getToxiproxyEngine(),
    refetchInterval: 10000,
    staleTime: 8000,
  });

// Profiles
export const useProfiles = (params?: { page?: number; limit?: number; tag?: string }) =>
  useQuery({
    queryKey: ['profiles', params],
    queryFn: () => apiClient.listProfiles(params),
    staleTime: 30000,
  });

export const useProfile = (id?: string) =>
  useQuery({
    queryKey: ['profile', id],
    queryFn: () => (id ? apiClient.getProfile(id) : null),
    enabled: Boolean(id),
  });

export const useCreateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfileInput) => apiClient.createProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfileInput }) =>
      apiClient.updateProfile(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['profile', variables.id] });
    },
  });
};

export const useDeleteProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

// Runs with Bounded Polling
export const useRuns = (params?: { page?: number; limit?: number; status?: string; profileId?: string }) =>
  useQuery({
    queryKey: ['runs', params],
    queryFn: () => apiClient.listRuns(params),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.items || data.items.length === 0) return false;
      const hasActiveRuns = data.items.some((r) => !isTerminalStatus(r.status));
      // Bounded polling: poll every 1.5s only while active runs exist; stop when all are terminal
      return hasActiveRuns ? 1500 : false;
    },
  });

export const useRun = (id?: string) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => (id ? apiClient.getRun(id) : null),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const run = query.state.data;
      if (!run) return false;
      // Stop polling as soon as terminal status is reached
      return !isTerminalStatus(run.status) ? 1000 : false;
    },
  });

export const useRunEvents = (id?: string, isRunActive = false) =>
  useQuery({
    queryKey: ['run-events', id],
    queryFn: () => (id ? apiClient.getRunEvents(id) : []),
    enabled: Boolean(id),
    refetchInterval: isRunActive ? 1500 : false,
  });

export const useRunRequests = (id?: string, isRunActive = false) =>
  useQuery({
    queryKey: ['run-requests', id],
    queryFn: () => (id ? apiClient.getRunRequests(id) : []),
    enabled: Boolean(id),
    refetchInterval: isRunActive ? 1500 : false,
  });

export const useStartRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => apiClient.startRun(profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
};

export const useReplayRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.replayRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
};

export const useCancelRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.cancelRun(id),
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['run', runId] });
      queryClient.invalidateQueries({ queryKey: ['run-events', runId] });
    },
  });
};
