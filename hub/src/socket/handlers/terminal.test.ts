import { describe, expect, it } from 'bun:test'
import { registerTerminalHandlers as registerTerminalHandlersProduction, type TerminalHandlersDeps } from './terminal'
import { TerminalRegistry } from '../terminalRegistry'
import { TerminalSessionStateStore } from '../terminalSessionState'
import { handleTerminalRegistryIdle, resolveTerminalLimitConfig } from '../server'
import type { SocketServer, SocketWithData } from '../socketTypes'
import { TerminalHistoryRequestRegistry } from '../terminalHistoryRequests'

type EmittedEvent = {
    event: string
    data: unknown
}

class FakeSocket {
    readonly id: string
    readonly data: Record<string, unknown> = {}
    readonly emitted: EmittedEvent[] = []
    readonly joinedRooms = new Set<string>()
    readonly rooms = this.joinedRooms
    private readonly handlers = new Map<string, (...args: unknown[]) => void>()

    constructor(id: string) {
        this.id = id
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    join(room: string): void {
        this.joinedRooms.add(room)
    }

    leave(room: string): void {
        this.joinedRooms.delete(room)
    }

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        return true
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

    hasHandler(event: string): boolean {
        return this.handlers.has(event)
    }
}

class FakeNamespace {
    readonly sockets = new Map<string, FakeSocket>()
    readonly adapter = { rooms: new Map<string, Set<string>>() }
}

class FakeServer {
    private readonly namespaces = new Map<string, FakeNamespace>()

    of(name: string): FakeNamespace {
        const existing = this.namespaces.get(name)
        if (existing) {
            return existing
        }
        const namespace = new FakeNamespace()
        this.namespaces.set(name, namespace)
        return namespace
    }
}

type Harness = {
    io: FakeServer
    terminalSocket: FakeSocket
    cliNamespace: FakeNamespace
    terminalRegistry: TerminalRegistry
    terminalHistoryRequests: TerminalHistoryRequestRegistry
}

function registerTerminalHandlers(
    socket: SocketWithData,
    deps: Omit<TerminalHandlersDeps, 'capabilityResolver'> & Partial<Pick<TerminalHandlersDeps, 'capabilityResolver'>>
): void {
    socket.data.membershipId ??= 'test-member'
    socket.data.organizationRole ??= 'admin'
    registerTerminalHandlersProduction(socket, {
        ...deps,
        capabilityResolver: deps.capabilityResolver ?? (() => 'manage')
    })
}

function createHarness(options?: {
    socketNamespace?: string
    sessionActive?: boolean
    sessionNamespace?: string
    machineActive?: boolean
    machineNamespace?: string
    maxTerminalsPerSocket?: number
    maxTerminalsPerSession?: number
    terminalSessionState?: TerminalSessionStateStore
    capabilityResolver?: TerminalHandlersDeps['capabilityResolver']
}): Harness {
    const io = new FakeServer()
    const terminalSocket = new FakeSocket('terminal-socket')
    terminalSocket.data.namespace = options?.socketNamespace ?? 'default'
    const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
    const terminalHistoryRequests = new TerminalHistoryRequestRegistry()
    const cliNamespace = io.of('/cli')

    registerTerminalHandlers(terminalSocket as unknown as SocketWithData, {
        io: io as unknown as SocketServer,
        getSession: () => ({ active: options?.sessionActive ?? true, namespace: options?.sessionNamespace ?? 'default' }),
        getMachine: () => ({ active: options?.machineActive ?? true, namespace: options?.machineNamespace ?? 'default' }),
        terminalRegistry,
        terminalHistoryRequests,
        terminalSessionState: options?.terminalSessionState,
        maxTerminalsPerSocket: options?.maxTerminalsPerSocket ?? 4,
        maxTerminalsPerSession: options?.maxTerminalsPerSession ?? 3,
        capabilityResolver: options?.capabilityResolver
    })

    return { io, terminalSocket, cliNamespace, terminalRegistry, terminalHistoryRequests }
}

function connectCliSocket(cliNamespace: FakeNamespace, cliSocket: FakeSocket, sessionId: string, namespace = 'default'): void {
    cliSocket.data.namespace = namespace
    cliNamespace.sockets.set(cliSocket.id, cliSocket)
    const roomId = `session:${sessionId}`
    const room = cliNamespace.adapter.rooms.get(roomId) ?? new Set<string>()
    room.add(cliSocket.id)
    cliNamespace.adapter.rooms.set(roomId, room)
}

function connectMachineCliSocket(cliNamespace: FakeNamespace, cliSocket: FakeSocket, machineId: string, namespace = 'default'): void {
    cliSocket.data.namespace = namespace
    cliNamespace.sockets.set(cliSocket.id, cliSocket)
    const roomId = `machine:${machineId}`
    const room = cliNamespace.adapter.rooms.get(roomId) ?? new Set<string>()
    room.add(cliSocket.id)
    cliNamespace.adapter.rooms.set(roomId, room)
}

function lastEmit(socket: FakeSocket, event: string): EmittedEvent | undefined {
    return [...socket.emitted].reverse().find((entry) => entry.event === event)
}

describe('terminal socket handlers', () => {
    it('privately forwards a clamped history request with an opaque correlation id', () => {
        const { terminalSocket, cliNamespace, terminalRegistry, terminalHistoryRequests } = createHarness()
        const cliSocket = new FakeSocket('cli-socket')
        cliSocket.data.cliCapabilities = new Set(['terminal-history-v1'])
        connectCliSocket(cliNamespace, cliSocket, 'session-1')
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        terminalSocket.trigger('terminal:history', {
            terminalId: 'terminal-1',
            requestId: 'web-request-1',
            limit: 500
        })

        const forwarded = lastEmit(cliSocket, 'terminal:history')
        expect(forwarded?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: expect.any(String),
            limit: 100
        })
        const correlationId = (forwarded?.data as { requestId: string }).requestId
        expect(correlationId).not.toBe('web-request-1')
        expect(terminalHistoryRequests.has(correlationId)).toBe(true)

        terminalSocket.trigger('disconnect')
        expect(terminalHistoryRequests.has(correlationId)).toBe(false)
    })

    it('reports an outdated CLI immediately instead of silently timing out history', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('old-cli-socket')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')
        terminalRegistry.register({
            terminalId: 'terminal-1',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: terminalSocket.id,
            cliSocketId: cliSocket.id
        })

        terminalSocket.trigger('terminal:history', {
            terminalId: 'terminal-1',
            requestId: 'web-request-1'
        })

        expect(lastEmit(terminalSocket, 'terminal:history-result')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'web-request-1',
            status: 'cli_outdated',
            entries: []
        })
        expect(lastEmit(cliSocket, 'terminal:history')).toBeUndefined()
    })

    it('does not forward history for an unowned terminal', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')
        terminalRegistry.register({
            terminalId: 'terminal-1',
            machineId: 'machine-1',
            namespace: 'default',
            socketId: 'another-web-socket',
            cliSocketId: cliSocket.id
        })

        terminalSocket.trigger('terminal:history', {
            terminalId: 'terminal-1',
            requestId: 'web-request-1'
        })

        expect(lastEmit(cliSocket, 'terminal:history')).toBeUndefined()
    })

    it('defaults session preflight max to 3 while legacy socket and machine max stay 4', () => {
        const previousMax = process.env.HAPI_TERMINAL_MAX_TERMINALS
        delete process.env.HAPI_TERMINAL_MAX_TERMINALS

        try {
            expect(resolveTerminalLimitConfig()).toEqual({
                maxTerminalsPerSocket: 4,
                maxTerminalsPerSession: 3
            })
        } finally {
            if (previousMax === undefined) delete process.env.HAPI_TERMINAL_MAX_TERMINALS
            else process.env.HAPI_TERMINAL_MAX_TERMINALS = previousMax
        }
    })

    it('keeps legacy env max for socket and machine paths but not session preflight default', () => {
        const previousMax = process.env.HAPI_TERMINAL_MAX_TERMINALS
        process.env.HAPI_TERMINAL_MAX_TERMINALS = '7'

        try {
            expect(resolveTerminalLimitConfig()).toEqual({
                maxTerminalsPerSocket: 7,
                maxTerminalsPerSession: 3
            })
        } finally {
            if (previousMax === undefined) delete process.env.HAPI_TERMINAL_MAX_TERMINALS
            else process.env.HAPI_TERMINAL_MAX_TERMINALS = previousMax
        }
    })

    it('keeps session registry idle from killing CLI process while preserving machine legacy close', () => {
        const terminalNamespace = new FakeNamespace()
        const cliNamespace = new FakeNamespace()
        const sessionTerminalSocket = new FakeSocket('session-terminal-socket')
        const sessionCliSocket = new FakeSocket('session-cli-socket')
        const machineTerminalSocket = new FakeSocket('machine-terminal-socket')
        const machineCliSocket = new FakeSocket('machine-cli-socket')

        terminalNamespace.sockets.set(sessionTerminalSocket.id, sessionTerminalSocket)
        terminalNamespace.sockets.set(machineTerminalSocket.id, machineTerminalSocket)
        cliNamespace.sockets.set(sessionCliSocket.id, sessionCliSocket)
        cliNamespace.sockets.set(machineCliSocket.id, machineCliSocket)

        handleTerminalRegistryIdle({
            terminalId: 'terminal-session',
            sessionId: 'session-1',
            namespace: 'default',
            socketId: sessionTerminalSocket.id,
            cliSocketId: sessionCliSocket.id,
            idleTimer: null
        }, terminalNamespace as never, cliNamespace as never)

        handleTerminalRegistryIdle({
            terminalId: 'terminal-machine',
            machineId: 'machine-1',
            namespace: 'default',
            socketId: machineTerminalSocket.id,
            cliSocketId: machineCliSocket.id,
            idleTimer: null
        }, terminalNamespace as never, cliNamespace as never)

        expect(lastEmit(sessionTerminalSocket, 'terminal:error')).toBeUndefined()
        expect(lastEmit(sessionCliSocket, 'terminal:close')).toBeUndefined()
        expect(lastEmit(machineTerminalSocket, 'terminal:error')?.data).toEqual({
            terminalId: 'terminal-machine',
            message: 'Terminal closed due to inactivity.'
        })
        expect(lastEmit(machineCliSocket, 'terminal:close')?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine'
        })
    })

    it('subscribes to an authorized session scope room and requests list from CLI', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'session',
            sessionId: 'session-1'
        })

        expect(terminalSocket.joinedRooms.has('terminal:default:session:session-1')).toBe(true)
        expect(lastEmit(cliSocket, 'terminal:list')?.data).toEqual({
            scopeType: 'session',
            sessionId: 'session-1'
        })
    })

    it('emits cached lost session list when no CLI route is available', () => {
        const terminalSessionState = new TerminalSessionStateStore()
        terminalSessionState.markLostByCliSocket('cli-gone', 999, { namespace: 'default', sessionId: 'session-1' })
        const { terminalSocket } = createHarness({ terminalSessionState })

        terminalSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1'
        })

        expect(lastEmit(terminalSocket, 'terminal:list')?.data).toEqual({
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [],
            recovery: { reason: 'cli_lost', at: 999 }
        })
    })

    it('emits cached lost list on subscribe and keeps machine subscriptions legacy-only', () => {
        const terminalSessionState = new TerminalSessionStateStore()
        terminalSessionState.markLostByCliSocket('cli-gone', 999, { namespace: 'default', sessionId: 'session-1' })
        const { terminalSocket } = createHarness({ terminalSessionState })

        terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'session',
            sessionId: 'session-1'
        })
        terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'machine',
            machineId: 'machine-1'
        })

        const listEvents = terminalSocket.emitted.filter((entry) => entry.event === 'terminal:list')
        expect(listEvents).toHaveLength(1)
        expect(listEvents[0].data).toEqual({
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [],
            recovery: { reason: 'cli_lost', at: 999 }
        })
    })

    it('uses namespace-specific terminal rooms for same session id across namespaces', () => {
        const namespaceA = createHarness({
            socketNamespace: 'team/a',
            sessionNamespace: 'team/a'
        })
        const namespaceB = createHarness({
            socketNamespace: 'team/b',
            sessionNamespace: 'team/b'
        })
        const cliA = new FakeSocket('cli-a')
        const cliB = new FakeSocket('cli-b')
        connectCliSocket(namespaceA.cliNamespace, cliA, 'same-session', 'team/a')
        connectCliSocket(namespaceB.cliNamespace, cliB, 'same-session', 'team/b')

        namespaceA.terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'session',
            sessionId: 'same-session'
        })
        namespaceB.terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'session',
            sessionId: 'same-session'
        })

        expect(namespaceA.terminalSocket.joinedRooms.has('terminal:team%2Fa:session:same-session')).toBe(true)
        expect(namespaceA.terminalSocket.joinedRooms.has('terminal:team%2Fb:session:same-session')).toBe(false)
        expect(namespaceB.terminalSocket.joinedRooms.has('terminal:team%2Fb:session:same-session')).toBe(true)
        expect(namespaceB.terminalSocket.joinedRooms.has('terminal:team%2Fa:session:same-session')).toBe(false)
        expect(lastEmit(cliA, 'terminal:list')?.data).toEqual({
            scopeType: 'session',
            sessionId: 'same-session'
        })
        expect(lastEmit(cliB, 'terminal:list')?.data).toEqual({
            scopeType: 'session',
            sessionId: 'same-session'
        })
    })

    it('enforces session terminal max per namespace for same session id', () => {
        const io = new FakeServer()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const cliNamespace = io.of('/cli')
        const terminalA = new FakeSocket('terminal-a')
        const terminalB = new FakeSocket('terminal-b')
        terminalA.data.namespace = 'team/a'
        terminalB.data.namespace = 'team/b'
        registerTerminalHandlers(terminalA as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'team/a' }),
            getMachine: () => ({ active: true, namespace: 'team/a' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 3
        })
        registerTerminalHandlers(terminalB as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'team/b' }),
            getMachine: () => ({ active: true, namespace: 'team/b' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 3
        })
        const cliA = new FakeSocket('cli-a')
        const cliB = new FakeSocket('cli-b')
        connectCliSocket(cliNamespace, cliA, 'same-session', 'team/a')
        connectCliSocket(cliNamespace, cliB, 'same-session', 'team/b')

        for (const terminalId of ['a1', 'a2', 'a3']) {
            terminalA.trigger('terminal:create', { sessionId: 'same-session', terminalId, cols: 80, rows: 24 })
        }
        terminalB.trigger('terminal:create', { sessionId: 'same-session', terminalId: 'b1', cols: 80, rows: 24 })

        expect(cliA.emitted.filter((entry) => entry.event === 'terminal:open')).toHaveLength(3)
        expect(lastEmit(cliB, 'terminal:open')?.data).toEqual({
            sessionId: 'same-session',
            terminalId: 'b1',
            cols: 80,
            rows: 24
        })
        expect(terminalB.emitted.some((entry) => entry.event === 'terminal:error')).toBe(false)
    })

    it('enforces max three session terminals across two web sockets for the same session', () => {
        const io = new FakeServer()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const cliNamespace = io.of('/cli')
        const terminalA = new FakeSocket('terminal-a')
        const terminalB = new FakeSocket('terminal-b')
        terminalA.data.namespace = 'default'
        terminalB.data.namespace = 'default'
        const deps = {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'default' }),
            getMachine: () => ({ active: true, namespace: 'default' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 3
        }
        registerTerminalHandlers(terminalA as unknown as SocketWithData, deps)
        registerTerminalHandlers(terminalB as unknown as SocketWithData, deps)
        const cliSocket = new FakeSocket('cli-socket')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalA.trigger('terminal:create', { sessionId: 'session-1', terminalId: 't1', cols: 80, rows: 24 })
        terminalB.trigger('terminal:create', { sessionId: 'session-1', terminalId: 't2', cols: 80, rows: 24 })
        terminalA.trigger('terminal:create', { sessionId: 'session-1', terminalId: 't3', cols: 80, rows: 24 })
        terminalB.trigger('terminal:create', { sessionId: 'session-1', terminalId: 't4', cols: 80, rows: 24 })

        expect(cliSocket.emitted.filter((entry) => entry.event === 'terminal:open')).toHaveLength(3)
        expect(terminalRegistry.countForSession('session-1', 'default')).toBe(3)
        expect(lastEmit(terminalB, 'terminal:error')?.data).toEqual({
            terminalId: 't4',
            message: 'Too many terminals open for this session (max 3).'
        })
    })

    it('rejects subscribe/list/keepalive for scopes outside the socket namespace', () => {
        const { terminalSocket, cliNamespace } = createHarness({
            sessionNamespace: 'other',
            machineNamespace: 'other'
        })
        const sessionCli = new FakeSocket('session-cli')
        const machineCli = new FakeSocket('machine-cli')
        connectCliSocket(cliNamespace, sessionCli, 'session-1')
        connectMachineCliSocket(cliNamespace, machineCli, 'machine-1')

        terminalSocket.trigger('terminal:subscribe', { scopeType: 'session', sessionId: 'session-1' })
        terminalSocket.trigger('terminal:list', { scopeType: 'session', sessionId: 'session-1' })
        terminalSocket.trigger('terminal:keepalive', { scopeType: 'session', sessionId: 'session-1', terminalId: 't1' })
        terminalSocket.trigger('terminal:subscribe', { scopeType: 'machine', machineId: 'machine-1' })
        terminalSocket.trigger('terminal:list', { scopeType: 'machine', machineId: 'machine-1' })
        terminalSocket.trigger('terminal:keepalive', { scopeType: 'machine', machineId: 'machine-1', terminalId: 'tm' })

        expect(terminalSocket.joinedRooms.size).toBe(0)
        expect(lastEmit(sessionCli, 'terminal:list')).toBeUndefined()
        expect(lastEmit(sessionCli, 'terminal:keepalive')).toBeUndefined()
        expect(lastEmit(machineCli, 'terminal:list')).toBeUndefined()
        expect(lastEmit(machineCli, 'terminal:keepalive')).toBeUndefined()
    })

    it('forwards typed list and keepalive requests to the matching CLI only', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const sessionCli = new FakeSocket('session-cli')
        const machineCli = new FakeSocket('machine-cli')
        connectCliSocket(cliNamespace, sessionCli, 'session-1')
        connectMachineCliSocket(cliNamespace, machineCli, 'machine-1')

        terminalSocket.trigger('terminal:list', { scopeType: 'machine', machineId: 'machine-1' })
        terminalSocket.trigger('terminal:keepalive', {
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'tm'
        })

        expect(lastEmit(machineCli, 'terminal:list')?.data).toEqual({
            scopeType: 'machine',
            machineId: 'machine-1'
        })
        expect(lastEmit(machineCli, 'terminal:keepalive')?.data).toEqual({
            scopeType: 'machine',
            machineId: 'machine-1',
            terminalId: 'tm'
        })
        expect(lastEmit(sessionCli, 'terminal:list')).toBeUndefined()
        expect(lastEmit(sessionCli, 'terminal:keepalive')).toBeUndefined()
    })

    it('does not expose close-all as a web terminal event', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        expect(terminalSocket.hasHandler('terminal:close-all')).toBe(false)

        terminalSocket.trigger('terminal:close-all', {
            scopeType: 'session',
            sessionId: 'session-1',
            reason: 'archive'
        })

        expect(lastEmit(cliSocket, 'terminal:close-all')).toBeUndefined()
    })

    it('rejects malformed typed scopes without join or CLI emit', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        for (const payload of [
            { sessionId: 'session-1' },
            { scopeType: 'session', sessionId: 'session-1', machineId: 'machine-1' },
            { scopeType: 'machine', sessionId: 'session-1' },
            { scopeType: 'session', sessionId: '' },
            { scopeType: 'session', sessionId: 'session-1', extra: true }
        ]) {
            terminalSocket.trigger('terminal:subscribe', payload)
            terminalSocket.trigger('terminal:list', payload)
        }

        expect(terminalSocket.joinedRooms.size).toBe(0)
        expect(lastEmit(cliSocket, 'terminal:list')).toBeUndefined()
    })

    it('rejects terminal create with mixed typed and legacy scope fields', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')

        terminalSocket.trigger('terminal:create', {
            scopeType: 'machine',
            sessionId: 'session-1',
            terminalId: 'mixed-1',
            cols: 80,
            rows: 24
        })
        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            machineId: 'machine-1',
            terminalId: 'mixed-2',
            cols: 80,
            rows: 24
        })

        expect(cliSocket.emitted.filter((entry) => entry.event === 'terminal:open')).toEqual([])
        expect(terminalRegistry.get('mixed-1')).toBeNull()
        expect(terminalRegistry.get('mixed-2')).toBeNull()
    })

    it('does not forward list/keepalive when CLI room has stale or wrong-namespace socket ids', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const wrongNamespaceCli = new FakeSocket('wrong-cli')
        wrongNamespaceCli.data.namespace = 'other'
        cliNamespace.sockets.set(wrongNamespaceCli.id, wrongNamespaceCli)
        cliNamespace.adapter.rooms.set('session:session-1', new Set(['missing-cli', wrongNamespaceCli.id]))

        terminalSocket.trigger('terminal:list', { scopeType: 'session', sessionId: 'session-1' })
        terminalSocket.trigger('terminal:keepalive', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 't1'
        })

        expect(lastEmit(wrongNamespaceCli, 'terminal:list')).toBeUndefined()
        expect(lastEmit(wrongNamespaceCli, 'terminal:keepalive')).toBeUndefined()
    })

    it('rejects terminal creation when session is inactive', () => {
        const { terminalSocket, terminalRegistry } = createHarness({ sessionActive: false })

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        })

        const errorEvent = lastEmit(terminalSocket, 'terminal:error')
        expect(errorEvent).toBeDefined()
        expect(errorEvent?.data).toEqual({
            terminalId: 'terminal-1',
            message: 'Session is inactive or unavailable.'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('blocks session subscribe and list when session is inactive', () => {
        const { terminalSocket, cliNamespace } = createHarness({ sessionActive: false })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'session',
            sessionId: 'session-1'
        })
        terminalSocket.trigger('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1'
        })

        expect(terminalSocket.joinedRooms.size).toBe(0)
        expect(lastEmit(cliSocket, 'terminal:list')).toBeUndefined()
    })

    it('rejects session terminal create after archive makes session inactive while kill is pending', () => {
        const io = new FakeServer()
        const terminalSocket = new FakeSocket('terminal-socket')
        terminalSocket.data.namespace = 'default'
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const cliNamespace = io.of('/cli')
        let sessionActive = true

        registerTerminalHandlers(terminalSocket as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: sessionActive, namespace: 'default' }),
            getMachine: () => ({ active: true, namespace: 'default' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 4
        })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-before-archive',
            cols: 80,
            rows: 24
        })
        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-before-archive',
            cols: 80,
            rows: 24
        })

        sessionActive = false
        cliSocket.emitted.length = 0
        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-after-archive',
            cols: 80,
            rows: 24
        })

        expect(lastEmit(terminalSocket, 'terminal:error')?.data).toEqual({
            terminalId: 'terminal-after-archive',
            message: 'Session is inactive or unavailable.'
        })
        expect(lastEmit(cliSocket, 'terminal:open')).toBeUndefined()
        expect(terminalRegistry.get('terminal-after-archive')).toBeNull()
    })

    it('allows machine terminal create when same session id is inactive', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness({ sessionActive: false })
        const cliSocket = new FakeSocket('cli-socket-machine')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')

        terminalSocket.trigger('terminal:create', {
            machineId: 'machine-1',
            terminalId: 'terminal-machine-active',
            cols: 80,
            rows: 24
        })

        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine-active',
            cols: 80,
            rows: 24
        })
        expect(terminalRegistry.get('terminal-machine-active')).not.toBeNull()
    })

    it('opens a terminal and forwards write/resize/close to the CLI socket', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40
        })

        const openEvent = lastEmit(cliSocket, 'terminal:open')
        expect(openEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40
        })
        expect(terminalRegistry.get('terminal-1')).not.toBeNull()

        terminalSocket.trigger('terminal:write', {
            terminalId: 'terminal-1',
            data: 'ls\n'
        })
        const writeEvent = lastEmit(cliSocket, 'terminal:write')
        expect(writeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'ls\n'
        })

        terminalSocket.trigger('terminal:resize', {
            terminalId: 'terminal-1',
            cols: 100,
            rows: 30
        })
        const resizeEvent = lastEmit(cliSocket, 'terminal:resize')
        expect(resizeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 100,
            rows: 30
        })

        terminalSocket.trigger('terminal:close', {
            terminalId: 'terminal-1'
        })
        const closeEvent = lastEmit(cliSocket, 'terminal:close')
        expect(closeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('allows an authorized session subscriber to write after another socket reattaches the same terminal', () => {
        const { io, terminalSocket: socketA, cliNamespace, terminalRegistry } = createHarness()
        const socketB = new FakeSocket('terminal-socket-b')
        socketB.data.namespace = 'default'
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        registerTerminalHandlers(socketB as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'default' }),
            getMachine: () => ({ active: true, namespace: 'default' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 3
        })

        socketA.trigger('terminal:subscribe', { scopeType: 'session', sessionId: 'session-1' })
        socketB.trigger('terminal:subscribe', { scopeType: 'session', sessionId: 'session-1' })
        socketA.trigger('terminal:create', { sessionId: 'session-1', terminalId: 'terminal-1', cols: 80, rows: 24 })
        socketB.trigger('terminal:create', { sessionId: 'session-1', terminalId: 'terminal-1', cols: 80, rows: 24, replay: true })

        socketA.trigger('terminal:write', { terminalId: 'terminal-1', data: 'echo still-owned-by-session\n' })

        expect(lastEmit(cliSocket, 'terminal:write')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'echo still-owned-by-session\n'
        })
    })

    it('opens a machine-scoped terminal without a chat session', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-machine')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')

        terminalSocket.trigger('terminal:create', {
            machineId: 'machine-1',
            terminalId: 'terminal-machine',
            cwd: '/repo',
            cols: 120,
            rows: 40
        })

        const openEvent = lastEmit(cliSocket, 'terminal:open')
        expect(openEvent?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine',
            cwd: '/repo',
            cols: 120,
            rows: 40
        })
        expect(terminalRegistry.get('terminal-machine')).not.toBeNull()

        terminalSocket.trigger('terminal:close', {
            terminalId: 'terminal-machine'
        })
        expect(lastEmit(cliSocket, 'terminal:close')?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine'
        })
    })

    it('allows four machine terminals through hub even when session max is three', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness({
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 3
        })
        const cliSocket = new FakeSocket('cli-socket-machine')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')

        for (const terminalId of ['tm-1', 'tm-2', 'tm-3', 'tm-4']) {
            terminalSocket.trigger('terminal:create', {
                machineId: 'machine-1',
                terminalId,
                cols: 80,
                rows: 24
            })
        }

        expect(cliSocket.emitted.filter((entry) => entry.event === 'terminal:open').map((entry) => entry.data)).toEqual([
            { machineId: 'machine-1', terminalId: 'tm-1', cols: 80, rows: 24 },
            { machineId: 'machine-1', terminalId: 'tm-2', cols: 80, rows: 24 },
            { machineId: 'machine-1', terminalId: 'tm-3', cols: 80, rows: 24 },
            { machineId: 'machine-1', terminalId: 'tm-4', cols: 80, rows: 24 }
        ])
        expect(terminalRegistry.countForMachine('machine-1')).toBe(4)
        expect(terminalSocket.emitted.some((entry) => (
            entry.event === 'terminal:error'
            && JSON.stringify(entry.data).includes('max 3')
        ))).toBe(false)
    })

    it('joins machine terminal subscriptions only to the machine room', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const machineCli = new FakeSocket('machine-cli')
        const sessionCli = new FakeSocket('session-cli')
        connectMachineCliSocket(cliNamespace, machineCli, 'shared-id')
        connectCliSocket(cliNamespace, sessionCli, 'shared-id')

        terminalSocket.trigger('terminal:subscribe', {
            scopeType: 'machine',
            machineId: 'shared-id'
        })

        expect(terminalSocket.joinedRooms.has('terminal:default:machine:shared-id')).toBe(true)
        expect(terminalSocket.joinedRooms.has('terminal:default:session:shared-id')).toBe(false)
        expect(lastEmit(machineCli, 'terminal:list')?.data).toEqual({
            scopeType: 'machine',
            machineId: 'shared-id'
        })
        expect(lastEmit(sessionCli, 'terminal:list')).toBeUndefined()
    })

    it('forwards replay requests to the CLI socket', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40,
            replay: true
        })

        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40,
            replay: true
        })
        terminalSocket.trigger('terminal:attach', {
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        expect(lastEmit(cliSocket, 'terminal:attach')).toBeUndefined()
    })

    it('forwards typed terminal close without registry and emits legacy close payload', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:close', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })

        expect(lastEmit(cliSocket, 'terminal:close')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('keeps typed close-one idempotent and does not close unrelated terminals', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 't1',
            cols: 80,
            rows: 24
        })
        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 't2',
            cols: 80,
            rows: 24
        })
        cliSocket.emitted.length = 0

        terminalSocket.trigger('terminal:close', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 't1'
        })
        terminalSocket.trigger('terminal:close', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 't1'
        })

        const closePayloads = cliSocket.emitted
            .filter((entry) => entry.event === 'terminal:close')
            .map((entry) => entry.data)
        expect(closePayloads).toEqual([
            { sessionId: 'session-1', terminalId: 't1' },
            { sessionId: 'session-1', terminalId: 't1' }
        ])
        expect(JSON.stringify(closePayloads)).not.toContain('t2')
        expect(terminalRegistry.get('t1')).toBeNull()
        expect(terminalRegistry.get('t2')).not.toBeNull()
    })

    it('ignores typed terminal close for a scope outside the socket namespace', () => {
        const { terminalSocket, cliNamespace } = createHarness({ sessionNamespace: 'other' })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:close', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })

        expect(lastEmit(cliSocket, 'terminal:close')).toBeUndefined()
    })

    it('rejects local write, resize, and legacy close payloads with extra keys', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })
        cliSocket.emitted.length = 0

        terminalSocket.trigger('terminal:write', {
            terminalId: 'terminal-1',
            data: 'ls\n',
            extra: true
        })
        terminalSocket.trigger('terminal:resize', {
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24,
            extra: true
        })
        terminalSocket.trigger('terminal:close', {
            terminalId: 'terminal-1',
            extra: true
        })

        expect(lastEmit(cliSocket, 'terminal:write')).toBeUndefined()
        expect(lastEmit(cliSocket, 'terminal:resize')).toBeUndefined()
        expect(lastEmit(cliSocket, 'terminal:close')).toBeUndefined()
    })

    it('detaches registry entries without closing CLI terminals on terminal socket disconnect', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })

        terminalSocket.trigger('disconnect')

        const closeEvent = lastEmit(cliSocket, 'terminal:close')
        expect(closeEvent).toBeUndefined()
        expect(lastEmit(cliSocket, 'terminal:detach')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('detaches machine registry entries without closing CLI terminals on terminal socket disconnect', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-machine')
        connectMachineCliSocket(cliNamespace, cliSocket, 'machine-1')

        terminalSocket.trigger('terminal:create', {
            machineId: 'machine-1',
            terminalId: 'terminal-machine',
            cols: 90,
            rows: 24
        })

        terminalSocket.trigger('disconnect')

        expect(lastEmit(cliSocket, 'terminal:close')).toBeUndefined()
        expect(lastEmit(cliSocket, 'terminal:detach')?.data).toEqual({
            machineId: 'machine-1',
            terminalId: 'terminal-machine'
        })
        expect(terminalRegistry.get('terminal-machine')).toBeNull()
    })

    it('enforces per-socket terminal limits', () => {
        const { terminalSocket, cliNamespace } = createHarness({ maxTerminalsPerSocket: 1 })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        })

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-2',
            cols: 80,
            rows: 24
        })

        const errorEvent = lastEmit(terminalSocket, 'terminal:error')
        expect(errorEvent?.data).toEqual({
            terminalId: 'terminal-2',
            message: 'Too many terminals open (max 1).'
        })
    })

    it('rechecks operate before control and detaches without closing after expiry', () => {
        let capability: 'operate' | 'view' = 'operate'
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness({
            capabilityResolver: () => capability
        })
        const cliSocket = new FakeSocket('cli-socket')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1', terminalId: 'terminal-expiring', cols: 80, rows: 24
        })
        capability = 'view'
        terminalSocket.trigger('terminal:write', { terminalId: 'terminal-expiring', data: 'secret' })

        expect(lastEmit(cliSocket, 'terminal:write')).toBeUndefined()
        expect(lastEmit(cliSocket, 'terminal:detach')?.data).toEqual({
            sessionId: 'session-1', terminalId: 'terminal-expiring'
        })
        expect(lastEmit(cliSocket, 'terminal:close')).toBeUndefined()
        expect(terminalRegistry.get('terminal-expiring')).toBeNull()
    })
})
