/**
 * NetReplay API TypeScript Contracts
 * Mirrors Fastify /api/v1 Zod schemas and JSON responses.
 */

export interface HealthResponse {
  status: 'ok' | 'unhealthy';
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface V1HealthResponse {
  status: 'ok' | 'unhealthy';
  database: 'connected' | 'disconnected';
  timestamp: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  configured: boolean;
  healthy: boolean;
  description: string;
}

export interface EnginesResponse {
  engines: EngineInfo[];
}

export interface ToxiproxyEngineInfo {
  engine: 'toxiproxy';
  configured: boolean;
  healthy: boolean;
  version?: string;
  proxyName: string;
  error?: string;
}

// Fault Types
export type FaultType = 'latency' | 'timeout' | 'bandwidth' | 'reset' | 'reset_peer';

export interface BaseFault {
  type: FaultType;
  name?: string;
  stream?: 'upstream' | 'downstream';
  toxicity?: number;
}

export interface LatencyFault extends BaseFault {
  type: 'latency';
  latencyMs: number;
  jitterMs?: number;
}

export interface TimeoutFault extends BaseFault {
  type: 'timeout';
  timeoutMs: number;
}

export interface BandwidthFault extends BaseFault {
  type: 'bandwidth';
  rateKbps: number;
}

export interface ResetFault extends BaseFault {
  type: 'reset' | 'reset_peer';
}

export type Fault = LatencyFault | TimeoutFault | BandwidthFault | ResetFault;

export interface TargetConfig {
  type: 'http';
  path: string;
  method: 'GET' | 'HEAD';
}

export interface SuccessCriteria {
  maxMedianLatencyMs?: number;
  minSuccessRate?: number;
  maxFailureCount?: number;
}

// Profile
export interface Profile {
  id: string;
  name: string;
  description?: string | null;
  engine: string;
  target: TargetConfig;
  faults: Fault[];
  requestCount: number;
  requestTimeoutMs: number;
  successCriteria?: SuccessCriteria;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  name: string;
  description?: string;
  engine?: 'toxiproxy';
  target?: TargetConfig | 'local-test-target';
  faults: Fault[];
  requestCount?: number;
  requestTimeoutMs?: number;
  successCriteria?: SuccessCriteria;
  tags?: string[];
}

export interface UpdateProfileInput {
  name?: string;
  description?: string;
  target?: TargetConfig | 'local-test-target';
  faults?: Fault[];
  requestCount?: number;
  requestTimeoutMs?: number;
  successCriteria?: SuccessCriteria;
  tags?: string[];
}

export interface ListProfilesResponse {
  items: Profile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Runs
export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'collecting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ConfigSnapshot {
  profileName: string;
  engine: string;
  target: TargetConfig;
  faults: Fault[];
  requestCount: number;
  requestTimeoutMs: number;
  successCriteria?: SuccessCriteria;
  tags?: string[];
  engineVersion?: string;
}

export interface RunSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  medianLatencyMs: number;
  meanLatencyMs: number;
  successCriteriaMet?: boolean;
}

export interface Run {
  id: string;
  profileId?: string | null;
  replayedFromId?: string | null;
  status: RunStatus;
  configSnapshot: ConfigSnapshot;
  startedAt?: string | null;
  finishedAt?: string | null;
  summary?: RunSummary | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListRunsResponse {
  items: Run[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Request Measurements
export interface RequestResult {
  id: string;
  runId: string;
  requestIndex: number;
  outcome: 'success' | 'failure' | 'timeout';
  statusCode?: number | null;
  latencyMs: number;
  errorCategory?: string | null;
  timestamp: string;
}

// Lifecycle Events
export interface RunEvent {
  id: string;
  runId: string;
  eventType: string;
  timestamp: string;
  details?: Record<string, any>;
}

// Reports
export interface JsonReport {
  runId: string;
  profileId: string | null;
  replayedFromId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  configSnapshot: ConfigSnapshot;
  summary: RunSummary | null;
  requests: RequestResult[];
  events: RunEvent[];
  error?: {
    code: string | null;
    message: string | null;
  };
}

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  details?: any;
}
