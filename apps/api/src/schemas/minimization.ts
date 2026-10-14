import { z } from 'zod';
import { FaultSchema } from './profile.js';

// ============================================================================
// Failure Predicates
// ============================================================================

export const Status5xxPredicateSchema = z.object({
  type: z.literal('status_5xx'),
  statusCode: z.number().int().min(500).max(599).optional(),
});

export const DeadlineExceededPredicateSchema = z.object({
  type: z.literal('deadline_exceeded'),
  deadlineMs: z.number().int().min(1).max(60000),
});

export const ConnectionResetPredicateSchema = z.object({
  type: z.literal('connection_reset'),
});

export const NetworkErrorPredicateSchema = z.object({
  type: z.literal('network_error'),
  errorCategory: z.string().min(1).max(100).optional(),
});

export const ResponseMissingPredicateSchema = z.object({
  type: z.literal('response_missing'),
});

export const StatusCodePredicateSchema = z.object({
  type: z.literal('status_code'),
  statusCode: z.number().int().min(100).max(599),
});

export const FailurePredicateSchema = z.discriminatedUnion('type', [
  Status5xxPredicateSchema,
  DeadlineExceededPredicateSchema,
  ConnectionResetPredicateSchema,
  NetworkErrorPredicateSchema,
  ResponseMissingPredicateSchema,
  StatusCodePredicateSchema,
]);

export type FailurePredicate = z.infer<typeof FailurePredicateSchema>;

// ============================================================================
// Minimization Options & Inputs
// ============================================================================

export const MinimizationStatusEnum = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
  'baseline_not_reproducible',
]);

export type MinimizationStatus = z.infer<typeof MinimizationStatusEnum>;

export const StartMinimizationSchema = z.object({
  predicate: FailurePredicateSchema,
  minReproductionRate: z.number().min(0.1).max(1.0).default(1.0),
  strategy: z.enum(['staged_delta_debugging']).default('staged_delta_debugging'),
  maxAttempts: z.number().int().min(1).max(200).default(50),
  deadlineSeconds: z.number().int().min(10).max(900).default(300),
  trialsPerCandidate: z.number().int().min(1).max(10).default(1),
  finalTrials: z.number().int().min(1).max(20).default(3),
});

export type StartMinimizationInput = z.infer<typeof StartMinimizationSchema>;

// ============================================================================
// Minimization Response Models
// ============================================================================

export const MinimizationAttemptResponseSchema = z.object({
  id: z.string(),
  minimizationId: z.string(),
  attemptNumber: z.number(),
  stage: z.string(),
  changeDesc: z.string(),
  candidateConfig: z.array(FaultSchema),
  triggered: z.boolean(),
  trialCount: z.number(),
  failedTrials: z.number(),
  reproductionRate: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  reason: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  timestamp: z.string(),
});

export type MinimizationAttemptResponse = z.infer<typeof MinimizationAttemptResponseSchema>;

export const ConfigDifferenceSchema = z.object({
  removedFaults: z.array(FaultSchema),
  modifiedFaults: z.array(
    z.object({
      faultType: z.string(),
      original: z.record(z.string(), z.unknown()),
      minimized: z.record(z.string(), z.unknown()),
      reductionSummary: z.string(),
    })
  ),
  retainedFaults: z.array(FaultSchema),
});

export type ConfigDifference = z.infer<typeof ConfigDifferenceSchema>;

export const MinimizationResponseSchema = z.object({
  id: z.string(),
  sourceRunId: z.string(),
  status: MinimizationStatusEnum,
  originalConfigSnapshot: z.record(z.string(), z.unknown()),
  minimizedConfig: z.array(FaultSchema).nullable().optional(),
  predicate: FailurePredicateSchema,
  minReproductionRate: z.number(),
  strategy: z.string(),
  maxAttempts: z.number(),
  attemptsUsed: z.number(),
  trialsPerCandidate: z.number(),
  finalTrials: z.number(),
  finalObservedRate: z.number().nullable().optional(),
  cleanupStatus: z.string(),
  differences: ConfigDifferenceSchema.nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MinimizationResponse = z.infer<typeof MinimizationResponseSchema>;
