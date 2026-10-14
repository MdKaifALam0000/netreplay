/**
 * NetReplay Centralized Typed API Client
 * Communicates strictly with Fastify REST API (/api/v1).
 * Never directly calls Toxiproxy control API (:8474) from the browser.
 */

import type {
  HealthResponse,
  V1HealthResponse,
  EnginesResponse,
  ToxiproxyEngineInfo,
  Profile,
  CreateProfileInput,
  UpdateProfileInput,
  ListProfilesResponse,
  Run,
  ListRunsResponse,
  RequestResult,
  RunEvent,
  JsonReport,
  ApiErrorResponse,
  Minimization,
  StartMinimizationInput,
  MinimizationAttemptsResponse,
} from '../types/api';

export class ApiClientError extends Error {
  public statusCode: number;
  public error: string;
  public details?: any;

  constructor(message: string, statusCode: number, error = 'API_ERROR', details?: any) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.error = error;
    this.details = details;
  }
}

const getBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:3100';
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      let errorData: ApiErrorResponse | null = null;
      if (isJson) {
        try {
          errorData = await response.json();
        } catch {
          // ignore parsing error
        }
      }

      const message = errorData?.message || `Request failed with status ${response.status} ${response.statusText}`;
      const code = errorData?.error || `HTTP_${response.status}`;
      throw new ApiClientError(message, response.status, code, errorData?.details);
    }

    if (isJson) {
      return (await response.json()) as T;
    }

    // For plain text / markdown responses
    return (await response.text()) as unknown as T;
  } catch (err: any) {
    if (err instanceof ApiClientError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new ApiClientError(`Request timeout after ${timeoutMs}ms`, 408, 'TIMEOUT');
    }
    throw new ApiClientError(
      err.message || 'Unable to connect to NetReplay API. Please verify the backend service is running.',
      0,
      'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export const apiClient = {
  // Health
  getHealth: () => request<HealthResponse>('/health'),
  getV1Health: () => request<V1HealthResponse>('/api/v1/health'),

  // Engines
  getEngines: () => request<EnginesResponse>('/api/v1/engines'),
  getToxiproxyEngine: () => request<ToxiproxyEngineInfo>('/api/v1/engines/toxiproxy'),

  // Profiles
  listProfiles: (params?: { page?: number; limit?: number; tag?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.tag) query.set('tag', params.tag);
    const qs = query.toString();
    return request<ListProfilesResponse>(`/api/v1/profiles${qs ? `?${qs}` : ''}`);
  },

  getProfile: (id: string) => request<Profile>(`/api/v1/profiles/${id}`),

  createProfile: (data: CreateProfileInput) =>
    request<Profile>('/api/v1/profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProfile: (id: string, data: UpdateProfileInput) =>
    request<Profile>(`/api/v1/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteProfile: (id: string) =>
    request<void>(`/api/v1/profiles/${id}`, {
      method: 'DELETE',
    }),

  // Runs
  listRuns: (params?: { page?: number; limit?: number; status?: string; profileId?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status && params.status !== 'all') query.set('status', params.status);
    if (params?.profileId) query.set('profileId', params.profileId);
    const qs = query.toString();
    return request<ListRunsResponse>(`/api/v1/runs${qs ? `?${qs}` : ''}`);
  },

  getRun: (id: string) => request<Run>(`/api/v1/runs/${id}`),

  startRun: (profileId: string) =>
    request<Run>('/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  replayRun: (id: string) =>
    request<Run>(`/api/v1/runs/${id}/replay`, {
      method: 'POST',
    }),

  cancelRun: (id: string) =>
    request<{ message: string; runId: string }>(`/api/v1/runs/${id}/cancel`, {
      method: 'POST',
    }),

  getRunEvents: (id: string) => request<RunEvent[]>(`/api/v1/runs/${id}/events`),

  getRunRequests: (id: string) => request<RequestResult[]>(`/api/v1/runs/${id}/requests`),

  // Reports
  getJsonReport: (id: string) =>
    request<JsonReport>(`/api/v1/runs/${id}/report?format=json`),

  getMarkdownReport: (id: string) =>
    request<string>(`/api/v1/runs/${id}/report?format=markdown`),

  // Minimizations
  startMinimization: (runId: string, input: StartMinimizationInput) =>
    request<Minimization>(`/api/v1/runs/${runId}/minimize`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getMinimization: (id: string) =>
    request<Minimization>(`/api/v1/minimizations/${id}`),

  getMinimizationAttempts: (id: string) =>
    request<MinimizationAttemptsResponse>(`/api/v1/minimizations/${id}/attempts`),

  cancelMinimization: (id: string) =>
    request<Minimization>(`/api/v1/minimizations/${id}/cancel`, {
      method: 'POST',
    }),
};
