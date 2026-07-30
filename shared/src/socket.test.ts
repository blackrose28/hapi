import { describe, expect, it } from 'bun:test'
import {
    CliCapabilitiesSchema,
    TerminalCloseAllPayloadSchema,
    TerminalClosePayloadSchema,
    TerminalErrorPayloadSchema,
    TerminalExitPayloadSchema,
    TerminalHistoryRequestSchema,
    TerminalHistoryResultSchema,
    TerminalKeepalivePayloadSchema,
    TerminalLegacyScopeSchema,
    TerminalListPayloadSchema,
    TerminalOpenPayloadSchema,
    TerminalOutputPayloadSchema,
    TerminalReadyPayloadSchema,
    TerminalResizePayloadSchema,
    TerminalScopeTypedSchema,
    TerminalStateSchema,
    TerminalWarningPayloadSchema,
    TerminalWritePayloadSchema,
    normalizeTerminalScope
} from './socket'
import type { ClientToServerEvents, ServerToClientEvents } from './socket'

type ServerTerminalList = Parameters<ServerToClientEvents['terminal:list']>[0]
const serverTerminalListRequest: ServerTerminalList = { scopeType: 'session', sessionId: 'session-1' }
void serverTerminalListRequest
// @ts-expect-error Server terminal:list must not accept payloads from hub to CLI.
const serverTerminalListPayload: ServerTerminalList = { scopeType: 'session', sessionId: 'session-1', terminals: [] }
void serverTerminalListPayload
// @ts-expect-error ServerToClientEvents must not expose terminal:warning.
type ServerTerminalWarning = ServerToClientEvents['terminal:warning']
// @ts-expect-error ClientToServerEvents must not expose terminal:keepalive.
type ClientTerminalKeepalive = ClientToServerEvents['terminal:keepalive']
// @ts-expect-error ClientToServerEvents must not expose terminal:close-all.
type ClientTerminalCloseAll = ClientToServerEvents['terminal:close-all']
type ClientTerminalList = Parameters<ClientToServerEvents['terminal:list']>[0]
const clientTerminalListPayload: ClientTerminalList = { scopeType: 'session', sessionId: 'session-1', terminals: [] }
void clientTerminalListPayload
// @ts-expect-error Client terminal:list must not accept bare requests from CLI to hub.
const clientTerminalListRequest: ClientTerminalList = { scopeType: 'session', sessionId: 'session-1' }
void clientTerminalListRequest
void (null as unknown as ServerTerminalWarning)
void (null as unknown as ClientTerminalKeepalive)
void (null as unknown as ClientTerminalCloseAll)

const baseSessionState = {
    scopeType: 'session' as const,
    sessionId: 'session-1',
    terminalId: 'terminal-1',
    label: 'Terminal 1',
    cols: 80,
    rows: 24,
    status: 'running' as const,
    closeReason: null,
    createdAt: 1,
    lastActivityAt: 1,
    idleWarningAt: null,
    hardExpiresAt: 86_401
}

const baseMachineState = {
    scopeType: 'machine' as const,
    machineId: 'machine-1',
    terminalId: 'terminal-1',
    label: 'Terminal 1',
    cols: 80,
    rows: 24,
    status: 'running' as const,
    closeReason: null,
    createdAt: 1,
    lastActivityAt: 1,
    idleWarningAt: null,
    hardExpiresAt: 86_401
}

describe('terminal lifecycle socket schemas', () => {
    it('accepts future CLI capability names without discarding the whole advertisement', () => {
        expect(CliCapabilitiesSchema.safeParse([
            'terminal-history-v1',
            'future-capability-v2'
        ]).success).toBe(true)
    })

    it('validates scoped terminal history requests and results', () => {
        expect(TerminalHistoryRequestSchema.safeParse({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            limit: 100
        }).success).toBe(true)

        expect(TerminalHistoryRequestSchema.safeParse({
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            limit: 101
        }).success).toBe(false)

        expect(TerminalHistoryRequestSchema.safeParse({
            sessionId: 'session-1',
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: 'request-1'
        }).success).toBe(false)

        expect(TerminalHistoryResultSchema.safeParse({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 42, command: 'git status' }]
        }).success).toBe(true)

        expect(TerminalHistoryResultSchema.safeParse({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            status: 'ok',
            entries: [{ index: -1, command: '' }]
        }).success).toBe(false)

        expect(TerminalHistoryResultSchema.safeParse({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            status: 'cli_outdated',
            entries: []
        }).success).toBe(true)
    })

    it('accepts typed session and machine scopes', () => {
        expect(TerminalScopeTypedSchema.safeParse({ scopeType: 'session', sessionId: 'session-1' }).success).toBe(true)
        expect(TerminalScopeTypedSchema.safeParse({ scopeType: 'machine', machineId: 'machine-1' }).success).toBe(true)
    })

    it('rejects mixed typed terminal scopes and lifecycle payload scopes', () => {
        expect(TerminalScopeTypedSchema.safeParse({ scopeType: 'session', sessionId: 's1', machineId: 'm1' }).success).toBe(false)
        expect(TerminalScopeTypedSchema.safeParse({ scopeType: 'machine', machineId: 'm1', sessionId: 's1' }).success).toBe(false)

        expect(TerminalWarningPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 's1',
            machineId: 'm1',
            terminalId: 'terminal-1',
            reason: 'idle',
            message: 'Terminal has been idle.',
            closesAt: 10
        }).success).toBe(false)

        expect(TerminalKeepalivePayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'm1',
            sessionId: 's1',
            terminalId: 'terminal-1'
        }).success).toBe(false)

        expect(TerminalCloseAllPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 's1',
            reason: 'archive',
            machineId: 'm1'
        }).success).toBe(false)
    })

    it('exports and normalizes legacy terminal scopes into typed scopes', () => {
        expect(TerminalLegacyScopeSchema.safeParse({ sessionId: 'session-1' }).success).toBe(true)
        expect(normalizeTerminalScope({ sessionId: 'session-1' })).toEqual({ scopeType: 'session', sessionId: 'session-1' })
        expect(normalizeTerminalScope({ machineId: 'machine-1' })).toEqual({ scopeType: 'machine', machineId: 'machine-1' })
        expect(normalizeTerminalScope({ sessionId: 'session-1', machineId: 'machine-1' })).toBeNull()
        expect(normalizeTerminalScope({})).toBeNull()
        expect(normalizeTerminalScope('not-an-object')).toBeNull()
    })

    it('rejects raw secret-bearing fields when normalizing legacy terminal scope only', () => {
        const rawSecretScope = {
            sessionId: 's',
            outputBuffer: 'secret',
            data: 'secret',
            env: { OPENAI_API_KEY: 'sk-secret' }
        }

        expect(TerminalLegacyScopeSchema.safeParse(rawSecretScope).success).toBe(false)
        expect(normalizeTerminalScope(rawSecretScope)).toBeNull()
    })

    it('accepts session terminal list payloads without raw output fields', () => {
        const result = TerminalListPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [baseSessionState]
        })

        expect(result.success).toBe(true)
        expect(result.data).not.toHaveProperty('outputBuffer')
    })

    it('accepts session terminal recovery metadata and rejects it for machine lists', () => {
        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            recovery: { reason: 'cli_lost', at: 123 },
            terminals: []
        }).success).toBe(true)

        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            recovery: { reason: 'cli_lost', at: 123 },
            terminals: []
        }).success).toBe(false)
    })

    it('rejects raw output fields in terminal state and list payloads', () => {
        expect(TerminalStateSchema.safeParse({ ...baseSessionState, outputBuffer: 'raw output' }).success).toBe(false)
        expect(TerminalStateSchema.safeParse({ ...baseSessionState, data: 'raw output' }).success).toBe(false)
        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [{ ...baseSessionState, outputBuffer: 'raw output' }]
        }).success).toBe(false)
    })


    it('rejects raw terminal output fields in state payloads', () => {
        const payload = {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [{
                ...baseSessionState,
                cwd: '/tmp',
                outputBuffer: 'secret',
                data: 'typed secret',
                env: { OPENAI_API_KEY: 'sk-secret' },
                command: 'export TOKEN=secret'
            }]
        }

        expect(TerminalListPayloadSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects terminal list payloads whose terminal state scope differs from list scope', () => {
        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [baseMachineState]
        }).success).toBe(false)

        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            terminals: [baseSessionState]
        }).success).toBe(false)
    })

    it('rejects invalid terminal state and close reason combinations', () => {
        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'running',
            closeReason: 'user_close'
        }).success).toBe(false)

        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'closed_user',
            closeReason: null
        }).success).toBe(false)

        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'closed_idle',
            closeReason: 'user_close'
        }).success).toBe(false)
    })

    it('accepts valid terminal state and close reason mappings', () => {
        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'closed_idle',
            closeReason: 'idle_timeout'
        }).success).toBe(true)

        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'lost',
            closeReason: 'cli_lost'
        }).success).toBe(true)

        expect(TerminalStateSchema.safeParse({
            ...baseSessionState,
            status: 'lost',
            closeReason: 'spawn_error'
        }).success).toBe(true)
    })

    it('accepts terminal warning and keepalive payloads', () => {
        expect(TerminalWarningPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            reason: 'idle',
            message: 'Terminal has been idle.',
            closesAt: 10
        }).success).toBe(true)

        expect(TerminalKeepalivePayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        }).success).toBe(true)
    })

    it('accepts machine terminal list, warning, and keepalive payloads', () => {
        expect(TerminalListPayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            terminals: [baseMachineState]
        }).success).toBe(true)

        expect(TerminalWarningPayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            reason: 'age',
            message: 'Terminal is near its maximum age.',
            closesAt: 10
        }).success).toBe(true)

        expect(TerminalKeepalivePayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'terminal-1'
        }).success).toBe(true)
    })

    it('keeps legacy terminal schemas compatible with session and machine scopes', () => {
        const legacySchemas = [
            [TerminalOpenPayloadSchema, { terminalId: 'terminal-1', cols: 80, rows: 24 }],
            [TerminalWritePayloadSchema, { terminalId: 'terminal-1', data: 'input' }],
            [TerminalResizePayloadSchema, { terminalId: 'terminal-1', cols: 80, rows: 24 }],
            [TerminalClosePayloadSchema, { terminalId: 'terminal-1' }],
            [TerminalReadyPayloadSchema, { terminalId: 'terminal-1' }],
            [TerminalOutputPayloadSchema, { terminalId: 'terminal-1', data: 'output' }],
            [TerminalExitPayloadSchema, { terminalId: 'terminal-1', code: 0, signal: null }],
            [TerminalErrorPayloadSchema, { terminalId: 'terminal-1', message: 'Terminal error' }]
        ] as const

        for (const [schema, payload] of legacySchemas) {
            expect(schema.safeParse({ sessionId: 'session-1', ...payload }).success).toBe(true)
            expect(schema.safeParse({ machineId: 'machine-1', ...payload }).success).toBe(true)
        }
    })

    it('rejects terminal open payloads with mixed typed and legacy scope fields', () => {
        expect(TerminalOpenPayloadSchema.safeParse({
            scopeType: 'machine',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        }).success).toBe(false)

        expect(TerminalOpenPayloadSchema.safeParse({
            sessionId: 'session-1',
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        }).success).toBe(false)
    })

    it('requires a session id and archive reason for internal close-all', () => {
        expect(TerminalCloseAllPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            reason: 'archive'
        }).success).toBe(true)
        expect(TerminalCloseAllPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1'
        }).success).toBe(false)
        expect(TerminalCloseAllPayloadSchema.safeParse({
            scopeType: 'machine',
            machineId: 'machine-1',
            reason: 'archive'
        }).success).toBe(false)
        expect(TerminalCloseAllPayloadSchema.safeParse({
            scopeType: 'session',
            sessionId: 'session-1',
            reason: 'archive',
            extra: true
        }).success).toBe(false)
    })
})
