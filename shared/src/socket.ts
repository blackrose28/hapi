import { z } from 'zod'
import type { CodexCollaborationMode, PermissionMode } from './modes'

export type SocketErrorReason = 'namespace-missing' | 'access-denied' | 'not-found'

export const TerminalLegacyScopeSchema = z.object({
    sessionId: z.string().min(1).optional(),
    machineId: z.string().min(1).optional()
}).strict().refine((value) => Boolean(value.sessionId) !== Boolean(value.machineId), {
    message: 'Exactly one of sessionId or machineId is required'
})

export const TerminalScopeTypedSchema = z.discriminatedUnion('scopeType', [
    z.object({ scopeType: z.literal('session'), sessionId: z.string().min(1) }).strict(),
    z.object({ scopeType: z.literal('machine'), machineId: z.string().min(1) }).strict()
])
export type TerminalScopeTyped = z.infer<typeof TerminalScopeTypedSchema>

export function normalizeTerminalScope(value: unknown): TerminalScopeTyped | null {
    const result = TerminalLegacyScopeSchema.safeParse(value)
    if (!result.success) return null
    if (result.data.sessionId) return { scopeType: 'session', sessionId: result.data.sessionId }
    if (result.data.machineId) return { scopeType: 'machine', machineId: result.data.machineId }
    return null
}

export const TerminalCloseReasonSchema = z.enum([
    'user_close',
    'idle_timeout',
    'hard_timeout',
    'archive',
    'process_exit',
    'cli_lost',
    'spawn_error'
])
export type TerminalCloseReason = z.infer<typeof TerminalCloseReasonSchema>

export const TerminalStateValueSchema = z.enum([
    'running',
    'detached',
    'warning_idle',
    'warning_age',
    'closed_idle',
    'closed_age',
    'closed_user',
    'closed_archive',
    'exited',
    'lost'
])
export type TerminalStateValue = z.infer<typeof TerminalStateValueSchema>

const terminalLiveStateValues = new Set<TerminalStateValue>(['running', 'detached', 'warning_idle', 'warning_age'])
const terminalCloseReasonByState: Partial<Record<TerminalStateValue, TerminalCloseReason | TerminalCloseReason[]>> = {
    closed_idle: 'idle_timeout',
    closed_age: 'hard_timeout',
    closed_user: 'user_close',
    closed_archive: 'archive',
    exited: 'process_exit',
    lost: ['cli_lost', 'spawn_error']
}

const TerminalStateShape = {
    terminalId: z.string().min(1),
    label: z.string().min(1),
    cwd: z.string().min(1).optional(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    status: TerminalStateValueSchema,
    closeReason: TerminalCloseReasonSchema.nullable(),
    createdAt: z.number().int().positive(),
    lastActivityAt: z.number().int().positive(),
    idleWarningAt: z.number().int().positive().nullable(),
    hardExpiresAt: z.number().int().positive()
}

export const TerminalStateSchema = z.discriminatedUnion('scopeType', [
    z.object({
        scopeType: z.literal('session'),
        sessionId: z.string().min(1),
        ...TerminalStateShape
    }).strict(),
    z.object({
        scopeType: z.literal('machine'),
        machineId: z.string().min(1),
        ...TerminalStateShape
    }).strict()
]).superRefine((value, ctx) => {
    const isLive = terminalLiveStateValues.has(value.status)
    if (isLive && value.closeReason !== null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['closeReason'],
            message: 'Live terminal states must not have a close reason'
        })
    }
    if (!isLive && value.closeReason === null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['closeReason'],
            message: 'Closed terminal states must have a close reason'
        })
        return
    }

    const expectedCloseReason = terminalCloseReasonByState[value.status]
    if (!expectedCloseReason || value.closeReason === null) return

    const allowedCloseReasons = Array.isArray(expectedCloseReason) ? expectedCloseReason : [expectedCloseReason]
    if (!allowedCloseReasons.includes(value.closeReason)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['closeReason'],
            message: 'Terminal close reason must match terminal state'
        })
    }
})
export type TerminalState = z.infer<typeof TerminalStateSchema>

export const TerminalListRequestSchema = TerminalScopeTypedSchema
export type TerminalListRequest = z.infer<typeof TerminalListRequestSchema>

export const TerminalRecoverySchema = z.object({
    reason: z.literal('cli_lost'),
    at: z.number().int().positive()
}).strict()
export type TerminalRecovery = z.infer<typeof TerminalRecoverySchema>

export const TerminalListPayloadSchema = z.discriminatedUnion('scopeType', [
    z.object({
        scopeType: z.literal('session'),
        sessionId: z.string().min(1),
        terminals: z.array(TerminalStateSchema),
        recovery: TerminalRecoverySchema.optional()
    }).strict(),
    z.object({
        scopeType: z.literal('machine'),
        machineId: z.string().min(1),
        terminals: z.array(TerminalStateSchema)
    }).strict()
]).superRefine((value, ctx) => {
    value.terminals.forEach((terminal, index) => {
        if (value.scopeType === 'session') {
            if (terminal.scopeType !== 'session' || terminal.sessionId !== value.sessionId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['terminals', index, 'scopeType'],
                    message: 'Terminal state scope must match list payload scope'
                })
            }
            return
        }
        if (terminal.scopeType !== 'machine' || terminal.machineId !== value.machineId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['terminals', index, 'scopeType'],
                message: 'Terminal state scope must match list payload scope'
            })
        }
    })
})
export type TerminalListPayload = z.infer<typeof TerminalListPayloadSchema>

const TerminalWarningShape = {
    terminalId: z.string().min(1),
    reason: z.enum(['idle', 'age']),
    message: z.string().min(1),
    closesAt: z.number().int().positive()
}

export const TerminalWarningPayloadSchema = z.discriminatedUnion('scopeType', [
    z.object({
        scopeType: z.literal('session'),
        sessionId: z.string().min(1),
        ...TerminalWarningShape
    }).strict(),
    z.object({
        scopeType: z.literal('machine'),
        machineId: z.string().min(1),
        ...TerminalWarningShape
    }).strict()
])
export type TerminalWarningPayload = z.infer<typeof TerminalWarningPayloadSchema>

export const TerminalKeepalivePayloadSchema = z.discriminatedUnion('scopeType', [
    z.object({
        scopeType: z.literal('session'),
        sessionId: z.string().min(1),
        terminalId: z.string().min(1)
    }).strict(),
    z.object({
        scopeType: z.literal('machine'),
        machineId: z.string().min(1),
        terminalId: z.string().min(1)
    }).strict()
])
export type TerminalKeepalivePayload = z.infer<typeof TerminalKeepalivePayloadSchema>

// Internal hub→CLI only. Browser/web socket handlers must not accept this event.
export const TerminalCloseAllPayloadSchema = z.object({
    scopeType: z.literal('session'),
    sessionId: z.string().min(1),
    reason: z.literal('archive')
}).strict()
export type TerminalCloseAllPayload = z.infer<typeof TerminalCloseAllPayloadSchema>

const TerminalOpenShape = {
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    cwd: z.string().min(1).optional(),
    replay: z.boolean().optional()
}

export const TerminalOpenPayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalOpenShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalOpenShape }).strict()
])

export type TerminalOpenPayload = z.infer<typeof TerminalOpenPayloadSchema>

const TerminalWriteShape = {
    terminalId: z.string().min(1),
    data: z.string()
}

export const TerminalWritePayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalWriteShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalWriteShape }).strict()
])

export type TerminalWritePayload = z.infer<typeof TerminalWritePayloadSchema>

const TerminalResizeShape = {
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
}

export const TerminalResizePayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalResizeShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalResizeShape }).strict()
])

export type TerminalResizePayload = z.infer<typeof TerminalResizePayloadSchema>

const TerminalCloseShape = {
    terminalId: z.string().min(1)
}

export const TerminalClosePayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalCloseShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalCloseShape }).strict()
])

export type TerminalClosePayload = z.infer<typeof TerminalClosePayloadSchema>
export const TerminalDetachPayloadSchema = TerminalClosePayloadSchema
export type TerminalDetachPayload = TerminalClosePayload

export const TerminalReadyPayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalCloseShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalCloseShape }).strict()
])

export type TerminalReadyPayload = z.infer<typeof TerminalReadyPayloadSchema>

const TerminalOutputShape = {
    terminalId: z.string().min(1),
    data: z.string()
}

export const TerminalOutputPayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalOutputShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalOutputShape }).strict()
])

export type TerminalOutputPayload = z.infer<typeof TerminalOutputPayloadSchema>

const TerminalExitShape = {
    terminalId: z.string().min(1),
    code: z.number().int().nullable(),
    signal: z.string().nullable()
}

export const TerminalExitPayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalExitShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalExitShape }).strict()
])

export type TerminalExitPayload = z.infer<typeof TerminalExitPayloadSchema>

const TerminalErrorShape = {
    terminalId: z.string().min(1),
    message: z.string()
}

export const TerminalErrorPayloadSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalErrorShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalErrorShape }).strict()
])

export type TerminalErrorPayload = z.infer<typeof TerminalErrorPayloadSchema>

export const TerminalHistoryEntrySchema = z.object({
    index: z.number().int().nonnegative(),
    command: z.string().min(1)
}).strict()
export type TerminalHistoryEntry = z.infer<typeof TerminalHistoryEntrySchema>

export const TERMINAL_HISTORY_CLI_CAPABILITY = 'terminal-history-v1' as const
export const CLI_CAPABILITIES = [TERMINAL_HISTORY_CLI_CAPABILITY] as const
export const CliCapabilitySchema = z.enum(CLI_CAPABILITIES)
export const CliCapabilitiesSchema = z.array(
    z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._:-]*$/)
).max(32)
export type CliCapability = z.infer<typeof CliCapabilitySchema>

export const TerminalHistoryStatusSchema = z.enum([
    'ok',
    'unsupported_shell',
    'not_ready',
    'read_failed',
    'cli_outdated'
])
export type TerminalHistoryStatus = z.infer<typeof TerminalHistoryStatusSchema>

const TerminalHistoryRequestShape = {
    terminalId: z.string().min(1),
    requestId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional()
}

export const TerminalHistoryRequestSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalHistoryRequestShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalHistoryRequestShape }).strict()
])
export type TerminalHistoryRequest = z.infer<typeof TerminalHistoryRequestSchema>

const TerminalHistoryResultShape = {
    terminalId: z.string().min(1),
    requestId: z.string().min(1),
    status: TerminalHistoryStatusSchema,
    shell: z.string().min(1).optional(),
    entries: z.array(TerminalHistoryEntrySchema).max(100)
}

export const TerminalHistoryResultSchema = z.union([
    z.object({ sessionId: z.string().min(1), ...TerminalHistoryResultShape }).strict(),
    z.object({ machineId: z.string().min(1), ...TerminalHistoryResultShape }).strict()
])
export type TerminalHistoryResult = z.infer<typeof TerminalHistoryResultSchema>

export const SessionEndReasonSchema = z.enum(['completed', 'terminated', 'error'])
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>

export const UpdateNewMessageBodySchema = z.object({
    t: z.literal('new-message'),
    sid: z.string(),
    message: z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        content: z.unknown()
    })
})

export type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>

export const UpdateSessionBodySchema = z.object({
    t: z.literal('update-session'),
    sid: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    agentState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>

export const UpdateMachineBodySchema = z.object({
    t: z.literal('update-machine'),
    machineId: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    runnerState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>

export const UpdateSchema = z.object({
    id: z.string(),
    seq: z.number(),
    body: z.union([UpdateNewMessageBodySchema, UpdateSessionBodySchema, UpdateMachineBodySchema]),
    createdAt: z.number()
})

export type Update = z.infer<typeof UpdateSchema>

export interface ServerToClientEvents {
    update: (data: Update) => void
    'rpc-request': (data: { method: string; params: string }, callback: (response: string) => void) => void
    'terminal:open': (data: TerminalOpenPayload) => void
    'terminal:write': (data: TerminalWritePayload) => void
    'terminal:resize': (data: TerminalResizePayload) => void
    'terminal:close': (data: TerminalClosePayload) => void
    'terminal:detach': (data: TerminalDetachPayload) => void
    'terminal:list': (data: TerminalListRequest) => void
    'terminal:keepalive': (data: TerminalKeepalivePayload) => void
    'terminal:close-all': (data: TerminalCloseAllPayload) => void
    'terminal:history': (data: TerminalHistoryRequest) => void
    error: (data: { message: string; code?: SocketErrorReason; scope?: 'session' | 'machine'; id?: string }) => void
}

export interface ClientToServerEvents {
    message: (data: { sid: string; message: unknown; localId?: string }) => void
    'session-alive': (data: {
        sid: string
        time: number
        thinking: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        modelReasoningEffort?: string | null
        effort?: string | null
        collaborationMode?: CodexCollaborationMode
    }) => void
    'session-end': (data: { sid: string; time: number; reason?: SessionEndReason }) => void
    /**
     * Per-tool liveness heartbeat, emitted volatile: a heartbeat that could not be
     * delivered immediately is worthless, so it must never be buffered and replayed.
     */
    'tool-progress': (data: {
        sid: string
        toolUseId: string
        parentToolUseId?: string | null
        toolName?: string
        elapsedSeconds?: number
    }) => void
    'messages-consumed': (data: { sid: string; localIds: string[] }) => void
    'update-metadata': (data: { sid: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'update-state': (data: { sid: string; expectedVersion: number; agentState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        agentState: unknown | null
    } | {
        result: 'success'
        version: number
        agentState: unknown | null
    }) => void) => void
    'machine-alive': (data: { machineId: string; time: number }) => void
    'machine-update-metadata': (data: { machineId: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'machine-update-state': (data: { machineId: string; expectedVersion: number; runnerState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        runnerState: unknown | null
    } | {
        result: 'success'
        version: number
        runnerState: unknown | null
    }) => void) => void
    'rpc-register': (data: { method: string }) => void
    'rpc-unregister': (data: { method: string }) => void
    'terminal:ready': (data: TerminalReadyPayload) => void
    'terminal:output': (data: TerminalOutputPayload) => void
    'terminal:exit': (data: TerminalExitPayload) => void
    'terminal:error': (data: TerminalErrorPayload) => void
    'terminal:list': (data: TerminalListPayload) => void
    'terminal:warning': (data: TerminalWarningPayload) => void
    'terminal:history-result': (data: TerminalHistoryResult) => void
    ping: (callback: () => void) => void
    'usage-report': (data: unknown) => void
}
