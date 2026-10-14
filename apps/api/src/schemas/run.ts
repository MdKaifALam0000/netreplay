import { z } from 'zod';
import { TargetConfigSchema, FaultSchema, SuccessCriteriaSchema } from './profile.js';

export const RunStatusEnum = z.enum([
  'queued',
  'preparing',
  'running',
  'collecting',
  'completed',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof RunStatusEnum>;

export const StartRunSchema = z.object({
  profileId: z.string().min(1, 'profileId is required'),
});

export type StartRunInput = z.infer<typeof StartRunSchema>;

export const RunSummarySchema = z.object({
  totalRequests: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  timeoutCount: z.number(),
  minLatencyMs: z.number(),
  maxLatencyMs: z.number(),
  medianLatencyMs: z.number(),
  meanLatencyMs: z.number(),
  successCriteriaMet: z.boolean().optional(),
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

export const ConfigSnapshotSchema = z.object({
  profileName: z.string(),
  engine: z.string(),
  target: TargetConfigSchema,
  faults: z.array(FaultSchema),
  requestCount: z.number(),
  requestTimeoutMs: z.number(),
  successCriteria: SuccessCriteriaSchema.optional(),
  tags: z.array(z.string()).optional(),
  engineVersion: z.string().optional(),
});

export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

export const RunResponseSchema = z.object({
  id: z.string(),
  profileId: z.string().nullable().optional(),
  replayedFromId: z.string().nullable().optional(),
  status: RunStatusEnum,
  configSnapshot: ConfigSnapshotSchema,
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  summary: RunSummarySchema.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RunResponse = z.infer<typeof RunResponseSchema>;

export const ListRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: RunStatusEnum.optional(),
  profileId: z.string().optional(),
});

export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

export const RequestResultResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  requestIndex: z.number(),
  outcome: z.enum(['success', 'failure', 'timeout']),
  statusCode: z.number().nullable().optional(),
  latencyMs: z.number(),
  errorCategory: z.string().nullable().optional(),
  timestamp: z.string(),
});

export type RequestResultResponse = z.infer<typeof RequestResultResponseSchema>;

export const RunEventResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  eventType: z.string(),
  timestamp: z.string(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RunEventResponse = z.infer<typeof RunEventResponseSchema>;

export const ReportQuerySchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
});

export type ReportQuery = z.infer<typeof ReportQuerySchema>;
