import { describe, expect, it } from 'bun:test'
import type { TerminalListPayload } from '@hapi/protocol'
import type { StoredMachine, StoredSession } from '../../../store'
import type { CliSocketWithData } from '../../socketTypes'
import { TerminalRegistry } from '../../terminalRegistry'
import { TerminalSessionStateStore } from '../../terminalSessionState'
import { registerTerminalHandlers as registerTerminalHandlersProduction, type TerminalHandlersDeps } from './terminalHandlers'
import { broadcastLostTerminalLists as broadcastLostTerminalListsProduction } from './index'
import { TerminalHistoryRequestRegistry } from '../../terminalHistoryRequests'

type EmittedEvent = {
    event: string
    data: unknown
}

const allowAllCapabilities = () => 'manage' as const

function registerTerminalHandlers(
    socket: CliSocketWithData,
    deps: Omit<TerminalHandlersDeps, 'resolveCapability'> & Partial<Pick<TerminalHandlersDeps, 'resolveCapability'>>
): void {
    const namespace = deps.terminalNamespace as unknown as FakeNamespace
    for (const recipient of namespace.sockets.values()) {
        recipient.data.membershipId ??= 'test-member'
        recipient.data.organizationRole ??= 'admin'
    }
    registerTerminalHandlersProduction(socket, {
        ...deps,
        resolveCapability: deps.resolveCapability ?? allowAllCapabilities
    })
}

function broadcastLostTerminalLists(...args: Parameters<typeof broadcastLostTerminalListsProduction> extends [infer A, infer B, unknown] ? [A, B] : never): void {
    broadcastLostTerminalListsProduction(...args, allowAllCapabilities)
}

class FakeSocket {
    readonly id: string
    readonly data: Record<string, unknown> = {}
    readonly emitted: EmittedEvent[] = []
    readonly rooms = new Set<string>()
    readonly leftRooms = new Set<string>()
    private readonly handlers = new Map<string, (...args: unknown[]) => void>()

    constructor(id: string, private readonly onEmit?: (event: string, data: unknown) => void) {
        this.id = id
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        this.onEmit?.(event, data)
        return true
    }

    leave(room: string): void {
        this.rooms.delete(room)
        this.leftRooms.add(room)
    }

    trigger(event: string, data?: unknown): void {
        const handler = this.handlers.get(event)
        if (!handler) {
            return
        }
        if (typeof data === 'undefined') {
            handler()
            return
        }
        handler(data)
    }
}

class FakeNamespace {
    readonly sockets = new Map<string, FakeSocket>()
    readonly roomEmits: EmittedEvent[] = []
    readonly roomMembers = new Map<string, Set<string>>()
    private activeRoom = ''
    readonly adapter = { rooms: { get: (room: string) => {
        this.activeRoom = room
        return this.roomMembers.get(room) ?? new Set(['authorized-recipient'])
    } } }

    constructor() {
        const recipient = new FakeSocket('authorized-recipient', (event, data) => {
            this.roomEmits.push({ event: `${this.activeRoom}:${event}`, data })
        })
        recipient.data.membershipId = 'test-member'
        recipient.data.organizationRole = 'admin'
        this.sockets.set(recipient.id, recipient)
    }

    to(room: string): { emit: (event: string, data: unknown) => boolean } {
        return {
            emit: (event, data) => {
                this.roomEmits.push({ event: `${room}:${event}`, data })
                return true
            }
        }
    }
}

function lastEmit(socket: FakeSocket, event: string): EmittedEvent | undefined {
    return [...socket.emitted].reverse().find((entry) => entry.event === event)
}

function storedSession(namespace = 'default'): StoredSession {
    return { namespace } as StoredSession
}

function storedMachine(namespace = 'default'): StoredMachine {
    return { namespace } as StoredMachine
}

type SessionTerminalState = Extract<TerminalListPayload['terminals'][number], { scopeType: 'session' }>

function runningSessionTerminal(overrides: Partial<SessionTerminalState> = {}): SessionTerminalState {
    return {
        scopeType: 'session',
        sessionId: 'session-1',
        terminalId: 'terminal-1',
        label: 'Terminal 1',
        cwd: '/repo',
        cols: 80,
        rows: 24,
        status: 'running',
        closeReason: null,
        createdAt: 1,
        lastActivityAt: 1,
        idleWarningAt: null,
        hardExpiresAt: 10,
        ...overrides
    }
}

describe('cli terminal handlers', () => {
    it('returns history only to the correlated web socket and restores its request id', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const webSocket = new FakeSocket('web-socket')
        const terminalNamespace = new FakeNamespace()
        terminalNamespace.sockets.set(webSocket.id, webSocket)
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: webSocket.id,
            cliSocketId: cliSocket.id
        })
        const terminalHistoryRequests = new TerminalHistoryRequestRegistry()
        const correlationId = terminalHistoryRequests.register({
            webSocketId: webSocket.id,
            webRequestId: 'web-request-1',
            cliSocketId: cliSocket.id,
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalHistoryRequests,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:history-result', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: correlationId,
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 8, command: 'git status' }]
        })

        expect(lastEmit(webSocket, 'terminal:history-result')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'web-request-1',
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 8, command: 'git status' }]
        })
        expect(terminalNamespace.roomEmits).toEqual([])

        cliSocket.trigger('terminal:history-result', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: correlationId,
            status: 'ok',
            entries: []
        })
        expect(webSocket.emitted.filter((event) => event.event === 'terminal:history-result')).toHaveLength(1)
    })

    it('ignores a history result whose terminal scope does not match the correlation', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const webSocket = new FakeSocket('web-socket')
        const terminalNamespace = new FakeNamespace()
        terminalNamespace.sockets.set(webSocket.id, webSocket)
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const terminalHistoryRequests = new TerminalHistoryRequestRegistry()
        const correlationId = terminalHistoryRequests.register({
            webSocketId: webSocket.id,
            webRequestId: 'web-request-1',
            cliSocketId: cliSocket.id,
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalHistoryRequests,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {}
        })

        cliSocket.trigger('terminal:history-result', {
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: correlationId,
            status: 'ok',
            entries: []
        })

        expect(lastEmit(webSocket, 'terminal:history-result')).toBeUndefined()
        expect(terminalHistoryRequests.has(correlationId)).toBe(true)
    })

    it('broadcasts lost terminal lists to exact session rooms', () => {
        const terminalNamespace = new FakeNamespace()

        broadcastLostTerminalLists(terminalNamespace as never, [{
            namespace: 'team/a',
            payload: {
                scopeType: 'session',
                sessionId: 'session-1',
                terminals: [runningSessionTerminal({ status: 'lost', closeReason: 'cli_lost' })],
                recovery: { reason: 'cli_lost', at: 999 }
            }
        }])

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:team%2Fa:session:session-1:terminal:list',
            data: {
                scopeType: 'session',
                sessionId: 'session-1',
                terminals: [runningSessionTerminal({ status: 'lost', closeReason: 'cli_lost' })],
                recovery: { reason: 'cli_lost', at: 999 }
            }
        }])
    })

    it('forwards typed terminal list payloads to the exact session room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: []
        })

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:session:session-1:terminal:list',
            data: { scopeType: 'session', sessionId: 'session-1', terminals: [] }
        }])
    })

    it('broadcasts the merged cached recovery list after restarted CLI sends an empty list', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const terminalSessionState = new TerminalSessionStateStore()
        terminalSessionState.markLostByCliSocket('old-cli', 999, { namespace: 'default', sessionId: 'session-1' })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalSessionState,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: []
        })

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:session:session-1:terminal:list',
            data: {
                scopeType: 'session',
                sessionId: 'session-1',
                terminals: [],
                recovery: { reason: 'cli_lost', at: 999 }
            }
        }])
    })

    it('uses namespace-specific terminal rooms for CLI list events with the same session id', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession('team/a') }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine('team/a') }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'same-session',
            terminals: []
        })

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:team%2Fa:session:same-session:terminal:list',
            data: { scopeType: 'session', sessionId: 'same-session', terminals: [] }
        }])
        expect(terminalNamespace.roomEmits.some((entry) => entry.event.startsWith('terminal:team%2Fb:'))).toBe(false)
    })

    it('forwards typed terminal list payloads to the exact machine room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'machine',
            machineId: 'machine-1',
            terminals: []
        })

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:machine:machine-1:terminal:list',
            data: { scopeType: 'machine', machineId: 'machine-1', terminals: [] }
        }])
    })

    it('forwards terminal warnings only to the exact machine room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:warning', {
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'tm',
            reason: 'idle',
            message: 'idle',
            closesAt: 10
        })

        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:machine:machine-1:terminal:warning',
            data: {
                scopeType: 'machine',
                machineId: 'machine-1',
                terminalId: 'tm',
                reason: 'idle',
                message: 'idle',
                closesAt: 10
            }
        }])
    })

    it('does not emit list or warning when access is denied and reports access error', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const accessErrors: Array<{ scope: string; id: string; reason: string }> = []

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: (scope, id, reason) => {
                accessErrors.push({ scope, id, reason })
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: []
        })
        cliSocket.trigger('terminal:warning', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            reason: 'age',
            message: 'old',
            closesAt: 10
        })

        expect(terminalNamespace.roomEmits).toEqual([])
        expect(accessErrors).toEqual([
            { scope: 'session', id: 'session-1', reason: 'access-denied' },
            { scope: 'session', id: 'session-1', reason: 'access-denied' }
        ])
    })

    it('rejects terminal list payloads whose terminal scope mismatches the list scope', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [runningSessionTerminal({ sessionId: 'session-2' })]
        })

        expect(terminalNamespace.roomEmits).toEqual([])
    })

    it('forwards terminal output to exact room after access check and keeps legacy attached socket emit', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:output', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'hello'
        })

        const payload = {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'hello'
        }
        expect(lastEmit(terminalSocket, 'terminal:output')?.data).toEqual(payload)
        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:session:session-1:terminal:output',
            data: payload
        }])
    })

    it('skips legacy direct stream emit when attached socket is already in the exact room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        terminalSocket.rooms.add('terminal:default:session:session-1')
        terminalNamespace.roomMembers.set('terminal:default:session:session-1', new Set([terminalSocket.id]))

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:output', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'hello'
        })

        expect(terminalNamespace.roomEmits).toEqual([])
        expect(lastEmit(terminalSocket, 'terminal:output')?.data).toEqual({
            sessionId: 'session-1', terminalId: 'terminal-1', data: 'hello'
        })
    })

    it('does not emit terminal output room when access is denied', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const accessErrors: Array<{ scope: string; id: string; reason: string }> = []

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: (scope, id, reason) => {
                accessErrors.push({ scope, id, reason })
            }
        })

        cliSocket.trigger('terminal:output', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'hello'
        })

        expect(terminalNamespace.roomEmits).toEqual([])
        expect(lastEmit(terminalSocket, 'terminal:output')).toBeUndefined()
        expect(accessErrors).toEqual([{ scope: 'session', id: 'session-1', reason: 'access-denied' }])
    })

    it('removes stale registry entries after terminal errors', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:error', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            message: 'Remote terminal is not supported on Windows yet.'
        })

        expect(terminalRegistry.get('terminal-1')).toBeNull()
        expect(lastEmit(terminalSocket, 'terminal:error')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            message: 'Remote terminal is not supported on Windows yet.'
        })
        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:session:session-1:terminal:error',
            data: {
                sessionId: 'session-1',
                terminalId: 'terminal-1',
                message: 'Remote terminal is not supported on Windows yet.'
            }
        }])
    })

    it('forwards ready and exit stream events to exact session room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:ready', {
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        cliSocket.trigger('terminal:exit', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            code: 0,
            signal: null
        })

        expect(terminalNamespace.roomEmits).toEqual([
            {
                event: 'terminal:default:session:session-1:terminal:ready',
                data: { sessionId: 'session-1', terminalId: 'terminal-1' }
            },
            {
                event: 'terminal:default:session:session-1:terminal:exit',
                data: { sessionId: 'session-1', terminalId: 'terminal-1', code: 0, signal: null }
            }
        ])
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('forwards machine-scoped terminal output without session access', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalSocket = new FakeSocket('terminal-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
        terminalRegistry.register({
            terminalId: 'terminal-machine',
            machineId: 'machine-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => {
                throw new Error('Session access should not be checked')
            },
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:output', {
            machineId: 'machine-1',
            terminalId: 'terminal-machine',
            data: 'hello'
        })

        expect(lastEmit(terminalSocket, 'terminal:output')?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine',
            data: 'hello'
        })
        expect(terminalNamespace.roomEmits).toEqual([{
            event: 'terminal:default:machine:machine-1:terminal:output',
            data: {
                machineId: 'machine-1',
                terminalId: 'terminal-machine',
                data: 'hello'
            }
        }])
    })

    it('forwards all machine terminal events only to the exact machine room', () => {
        const cliSocket = new FakeSocket('cli-socket')
        const terminalNamespace = new FakeNamespace()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })

        for (const terminalId of ['tm-ready', 'tm-output', 'tm-exit', 'tm-error']) {
            terminalRegistry.register({
                terminalId,
                machineId: 'machine-1',
                namespace: 'default',
                socketId: `terminal-socket-${terminalId}`,
                cliSocketId: cliSocket.id
            })
        }

        registerTerminalHandlers(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => {
                throw new Error('Session access should not be checked for machine events')
            },
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => {
                throw new Error('Unexpected access error')
            }
        })

        cliSocket.trigger('terminal:list', {
            scopeType: 'machine',
            machineId: 'machine-1',
            terminals: []
        })
        cliSocket.trigger('terminal:warning', {
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'tm-warning',
            reason: 'idle',
            message: 'idle',
            closesAt: 10
        })
        cliSocket.trigger('terminal:ready', {
            machineId: 'machine-1',
            terminalId: 'tm-ready'
        })
        cliSocket.trigger('terminal:output', {
            machineId: 'machine-1',
            terminalId: 'tm-output',
            data: 'hello'
        })
        cliSocket.trigger('terminal:exit', {
            machineId: 'machine-1',
            terminalId: 'tm-exit',
            code: 0,
            signal: null
        })
        cliSocket.trigger('terminal:error', {
            machineId: 'machine-1',
            terminalId: 'tm-error',
            message: 'boom'
        })

        expect(terminalNamespace.roomEmits.map((entry) => entry.event)).toEqual([
            'terminal:default:machine:machine-1:terminal:list',
            'terminal:default:machine:machine-1:terminal:warning',
            'terminal:default:machine:machine-1:terminal:ready',
            'terminal:default:machine:machine-1:terminal:output',
            'terminal:default:machine:machine-1:terminal:exit',
            'terminal:default:machine:machine-1:terminal:error'
        ])
        expect(terminalNamespace.roomEmits.some((entry) => entry.event.startsWith('terminal:default:session:machine-1:'))).toBe(false)
    })

    it('filters mixed room output live and detaches only the expired recipient', () => {
        const cliSocket = new FakeSocket('cli-socket')
        cliSocket.data.namespace = 'default'
        const affected = new FakeSocket('affected')
        affected.data.membershipId = 'expired-member'
        affected.data.organizationRole = 'member'
        const unrelated = new FakeSocket('unrelated')
        unrelated.data.membershipId = 'allowed-member'
        unrelated.data.organizationRole = 'member'
        const terminalNamespace = new FakeNamespace()
        terminalNamespace.sockets.set(affected.id, affected)
        terminalNamespace.sockets.set(unrelated.id, unrelated)
        const room = 'terminal:default:session:session-1'
        terminalNamespace.roomMembers.set(room, new Set([affected.id, unrelated.id]))
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        terminalRegistry.register({
            terminalId: 'terminal-1', sessionId: 'session-1', namespace: 'default',
            socketId: affected.id, cliSocketId: cliSocket.id
        })

        registerTerminalHandlersProduction(cliSocket as unknown as CliSocketWithData, {
            terminalRegistry,
            terminalNamespace: terminalNamespace as never,
            resolveSessionAccess: () => ({ ok: true, value: storedSession() }),
            resolveMachineAccess: () => ({ ok: true, value: storedMachine() }),
            emitAccessError: () => { throw new Error('Unexpected access error') },
            resolveCapability: ({ membershipId }) => membershipId === 'allowed-member' ? 'operate' : null
        })
        cliSocket.trigger('terminal:output', {
            sessionId: 'session-1', terminalId: 'terminal-1', data: 'allowed-only'
        })

        expect(affected.leftRooms.has(room)).toBe(true)
        expect(unrelated.leftRooms.has(room)).toBe(false)
        expect(terminalRegistry.get('terminal-1')).toBeNull()
        expect(lastEmit(cliSocket, 'terminal:detach')?.data).toEqual({
            sessionId: 'session-1', terminalId: 'terminal-1'
        })
        expect(lastEmit(cliSocket, 'terminal:close')).toBeUndefined()
        expect(lastEmit(unrelated, 'terminal:output')?.data).toEqual({
            sessionId: 'session-1', terminalId: 'terminal-1', data: 'allowed-only'
        })
        expect(lastEmit(affected, 'terminal:output')).toBeUndefined()
    })
})
