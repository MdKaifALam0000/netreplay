import { z } from 'zod';

export const LatencyFaultSchema = z.object({
  type: z.literal('latency'),
  name: z.string().min(1).max(50).optional(),
  latencyMs: z.number().int().min(0).max(60000),
  jitterMs: z.number().int().min(0).max(30000).default(0),
  stream: z.enum(['upstream', 'downstream']).default('downstream'),
  toxicity: z.number().min(0).max(1).default(1),
});

export const TimeoutFaultSchema = z.object({
  type: z.literal('timeout'),
  name: z.string().min(1).max(50).optional(),
  timeoutMs: z.number().int().min(0).max(60000),
  stream: z.enum(['upstream', 'downstream']).default('downstream'),
  toxicity: z.number().min(0).max(1).default(1),
});

export const BandwidthFaultSchema = z.object({
  type: z.literal('bandwidth'),
  name: z.string().min(1).max(50).optional(),
  rateKbps: z.number().int().min(1).max(1000000),
  stream: z.enum(['upstream', 'downstream']).default('downstream'),
  toxicity: z.number().min(0).max(1).default(1),
});

export const ResetFaultSchema = z.object({
  type: z.enum(['reset', 'reset_peer']),
  name: z.string().min(1).max(50).optional(),
  stream: z.enum(['upstream', 'downstream']).default('downstream'),
  toxicity: z.number().min(0).max(1).default(1),
});

export const FaultSchema = z.discriminatedUnion('type', [
  LatencyFaultSchema,
  TimeoutFaultSchema,
  BandwidthFaultSchema,
  ResetFaultSchema,
]);

export type Fault = z.infer<typeof FaultSchema>;

export const TargetConfigSchema = z.object({
  type: z.literal('http').default('http'),
  path: z.string().startsWith('/').max(200).default('/api/demo'),
  method: z.enum(['GET', 'HEAD']).default('GET'),
}).refine((val) => !val.path.includes('://'), {
  message: 'Target path must be a relative local path (e.g., /api/demo) and cannot contain full URLs or schemes',
});

export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const SuccessCriteriaSchema = z.object({
  maxMedianLatencyMs: z.number().min(0).optional(),
  minSuccessRate: z.number().min(0).max(1).optional(),
  maxFailureCount: z.number().int().min(0).optional(),
});

export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;

export const CreateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().max(500, 'Description must not exceed 500 characters').optional(),
  engine: z.literal('toxiproxy').default('toxiproxy'),
  target: TargetConfigSchema.default({ type: 'http', path: '/api/demo', method: 'GET' }),
  faults: z.array(FaultSchema).min(1, 'At least one fault must be configured').max(10, 'Maximum 10 faults allowed'),
  requestCount: z.number().int().min(1).max(100).default(10),
  requestTimeoutMs: z.number().int().min(100).max(30000).default(5000),
  successCriteria: SuccessCriteriaSchema.optional(),
  tags: z.array(z.string().min(1).max(30)).max(10).optional().default([]),
});

export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;

export const UpdateProfileSchema = CreateProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const ProfileResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  engine: z.string(),
  target: TargetConfigSchema,
  faults: z.array(FaultSchema),
  requestCount: z.number(),
  requestTimeoutMs: z.number(),
  successCriteria: SuccessCriteriaSchema.optional(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const ListProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tag: z.string().optional(),
});

export type ListProfilesQuery = z.infer<typeof ListProfilesQuerySchema>;
