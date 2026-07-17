import { z } from 'zod'

export const RunnerPlatformSchema = z.enum(['linux', 'darwin'])
export const RunnerArchitectureSchema = z.enum(['x64', 'arm64'])
const BoundedIdSchema = z.string().min(1).max(256)
export const RunnerCredentialEnvelopeSchema = z.object({
    credentialId: BoundedIdSchema,
    secret: z.string().min(32).max(256)
}).strict()

export const RunnerProfileNameSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/)
export const RunnerProfileSchema = z.object({
    version: z.literal(1),
    profile: RunnerProfileNameSchema,
    hubUrl: z.string().url().max(2048),
    organizationId: BoundedIdSchema,
    runnerId: BoundedIdSchema,
    machineId: BoundedIdSchema
}).strict()
export const StoredRunnerCredentialSchema = z.object({
    version: z.literal(1),
    credential: RunnerCredentialEnvelopeSchema,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict()
export const RunnerSocketAuthSchema = z.object({
    kind: z.literal('runner'),
    credential: RunnerCredentialEnvelopeSchema,
    machineId: BoundedIdSchema,
    clientType: z.enum(['machine-scoped', 'session-scoped']),
    sessionId: BoundedIdSchema.optional()
}).strict()

export const RunnerEnrollmentIssueSchema = z.object({ ownerMembershipId: BoundedIdSchema.optional() }).strict()
export const RunnerEnrollmentIssueResultSchema = z.object({
    enrollmentId: BoundedIdSchema,
    code: z.string().min(16).max(256),
    expiresAt: z.number().int().positive()
}).strict()

export const RunnerEnrollmentExchangeSchema = z.object({
    code: z.string().min(16).max(256),
    profile: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/),
    machine: z.object({
        id: z.string().min(1).max(256),
        name: z.string().min(1).max(256),
        platform: RunnerPlatformSchema,
        arch: RunnerArchitectureSchema
    }).strict()
}).strict()

export const RunnerEnrollmentResultSchema = z.object({
    organizationId: BoundedIdSchema,
    runnerId: BoundedIdSchema,
    credential: RunnerCredentialEnvelopeSchema,
    generation: z.number().int().positive(),
    hubUrl: z.string().url()
}).strict()

export const RunnerCredentialRotateSchema = z.object({ expectedGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1) }).strict()
export const RunnerCredentialRotateResultSchema = z.object({
    runnerId: BoundedIdSchema,
    credential: RunnerCredentialEnvelopeSchema,
    generation: z.number().int().positive()
}).strict()
export const RunnerRevocationResultSchema = z.object({ runnerId: BoundedIdSchema, revoked: z.literal(true) }).strict()
export const RunnerEnrollmentListResultSchema = z.object({ enrollments: z.array(z.object({
    id: BoundedIdSchema,
    ownerMembershipId: BoundedIdSchema,
    expiresAt: z.number().int().positive(),
    consumed: z.boolean(),
    cancelled: z.boolean(),
    status: z.enum(['active', 'expired', 'consumed', 'cancelled'])
}).strict()).max(1000) }).strict()
export const RunnerTransferSchema = z.object({ targetMembershipId: BoundedIdSchema }).strict()
export const RunnerTransferResultSchema = z.object({
    runnerId: BoundedIdSchema,
    previousOwnerMembershipId: BoundedIdSchema,
    newOwnerMembershipId: BoundedIdSchema
}).strict()
export const RunnerCleanupResultSchema = z.object({
    runnerId: BoundedIdSchema,
    cleaned: z.literal(true)
}).strict()
export const RunnerListResultSchema = z.object({ runners: z.array(z.object({
    id: BoundedIdSchema,
    organizationId: BoundedIdSchema,
    ownerMembershipId: BoundedIdSchema,
    machineId: BoundedIdSchema,
    profile: z.string().min(1).max(64),
    name: z.string().min(1).max(256),
    status: z.enum(['active', 'revoked', 'archived']),
    createdAt: z.number().int().positive()
}).strict()).max(1000) }).strict()

export type RunnerEnrollmentExchange = z.infer<typeof RunnerEnrollmentExchangeSchema>
export type RunnerEnrollmentResult = z.infer<typeof RunnerEnrollmentResultSchema>
export type RunnerCredentialEnvelope = z.infer<typeof RunnerCredentialEnvelopeSchema>
export type RunnerProfile = z.infer<typeof RunnerProfileSchema>
export type StoredRunnerCredential = z.infer<typeof StoredRunnerCredentialSchema>
