import { Server as Engine } from '@socket.io/bun-engine'
import { Server, type DefaultEventsMap } from 'socket.io'
import { z } from 'zod'
import type { Store } from '../store'
import { configuration } from '../configuration'
import { registerCliHandlers } from './handlers/cli'
import { registerTerminalHandlers } from './handlers/terminal'
import { RpcRegistry } from './rpcRegistry'
import type { SyncEvent } from '../sync/syncEngine'
import { TerminalRegistry, type TerminalRegistryEntry } from './terminalRegistry'
import { TerminalSessionStateStore } from './terminalSessionState'
import { TerminalHistoryRequestRegistry } from './terminalHistoryRequests'
import type { CliSocketWithData, SocketData, SocketServer } from './socketTypes'
import type { RunnerAuthenticator } from '../auth/runnerAuthenticator'
import { RunnerSocketAuthSchema } from '@hapi/protocol/runner-enrollment'
import type { ResourceCapabilityResolver } from '../auth/resourceCapability'

const SHARED_SESSION_COOKIE = '__Host-hapi_session'

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null
    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=')
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue
        try { return decodeURIComponent(part.slice(separator + 1).trim()) } catch { return null }
    }
    return null
}

const DEFAULT_IDLE_TIMEOUT_MS = 0
const DEFAULT_MAX_TERMINALS = 4
const DEFAULT_SESSION_MAX_TERMINALS = 3

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveTerminalLimitConfig(): { maxTerminalsPerSocket: number; maxTerminalsPerSession: number } {
    return {
        maxTerminalsPerSocket: resolveEnvNumber('HAPI_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS),
        maxTerminalsPerSession: DEFAULT_SESSION_MAX_TERMINALS
    }
}

type SocketNamespace = ReturnType<SocketServer['of']>

export function handleTerminalRegistryIdle(entry: TerminalRegistryEntry, terminalNs: SocketNamespace, cliNs: SocketNamespace): void {
    if (entry.sessionId) {
        return
    }

    const terminalSocket = terminalNs.sockets.get(entry.socketId)
    terminalSocket?.emit('terminal:error', {
        terminalId: entry.terminalId,
        message: 'Terminal closed due to inactivity.'
    })

    const cliSocket = cliNs.sockets.get(entry.cliSocketId)
    cliSocket?.emit('terminal:close', {
        ...(entry.machineId ? { machineId: entry.machineId } : {}),
        terminalId: entry.terminalId
    })
}

export type SocketServerDeps = {
    store: Store
    jwtSecret: Uint8Array
    runnerAuthenticator: RunnerAuthenticator
    authorizeRunnerSession: (organizationId: string, runnerId: string, sessionId: string) => boolean
    validateWebSession: (sessionToken: string) => { membershipId: string; organizationId: string; role: 'admin' | 'member' | 'viewer' } | null
    resolveCapability: ResourceCapabilityResolver
    corsOrigins?: string[]
    getSession?: (sessionId: string) => { active: boolean; namespace: string } | null
    onWebappEvent?: (event: SyncEvent) => void
    onSessionAlive?: (payload: { sid: string; time: number; thinking?: boolean; mode?: 'local' | 'remote' }) => void
    onSessionReady?: (payload: { sid: string; time: number }) => void
    onSessionEnd?: (payload: { sid: string; time: number }) => void
    onMachineAlive?: (payload: { machineId: string; time: number }) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    onSessionCrashed?: (sessionId: string, error?: string) => void
    onAgentTextMessage?: (input: { namespace: string; sessionId: string; text: string; requestId?: string | null }) => void
    onSweepImmediateQueued?: (sessionId: string, now: number) => void
}

export function createSocketServer(deps: SocketServerDeps): {
    io: SocketServer
    engine: Engine
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    terminalSessionState: TerminalSessionStateStore
    disconnectOrganization: (organizationId: string) => void
    disconnectRunner: (organizationId: string, runnerId: string) => void
    disconnectMembership: (organizationId: string, membershipId: string) => void
} {
    const corsOrigins = deps.corsOrigins ?? configuration.corsOrigins
    const allowAllOrigins = corsOrigins.includes('*')
    const corsOriginOption = allowAllOrigins ? '*' : corsOrigins
    const corsOptions = {
        origin: corsOriginOption,
        methods: ['GET', 'POST'],
        credentials: true
    }

    const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>({
        cors: corsOptions
    })

    const engine = new Engine({
        path: '/socket.io/',
        cors: corsOptions,
        allowRequest: async (req) => {
            const origin = req.headers.get('origin')
            if (!origin || allowAllOrigins || corsOrigins.includes(origin)) {
                return
            }
            throw 'Origin not allowed'
        }
    })
    io.bind(engine)

    const rpcRegistry = new RpcRegistry()
    const idleTimeoutMs = resolveEnvNumber('HAPI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
    const { maxTerminalsPerSocket, maxTerminalsPerSession } = resolveTerminalLimitConfig()
    const cliNs = io.of('/cli')
    const terminalNs = io.of('/terminal')
    const terminalRegistry = new TerminalRegistry({
        idleTimeoutMs,
        onIdle: (entry) => handleTerminalRegistryIdle(entry, terminalNs, cliNs)
    })
    const terminalSessionState = new TerminalSessionStateStore()
    const terminalHistoryRequests = new TerminalHistoryRequestRegistry()

    cliNs.use((socket, next) => {
        const auth = socket.handshake.auth as Record<string, unknown> | undefined
        const parsed = RunnerSocketAuthSchema.safeParse(auth)
        if (!parsed.success) return next(new Error('Invalid Runner credential'))
        const runner = deps.runnerAuthenticator.authenticateAny(parsed.data.credential)
        if (!runner) return next(new Error('Invalid Runner credential'))
        if (runner.machineId !== parsed.data.machineId) return next(new Error('Machine binding mismatch'))
        if (parsed.data.clientType === 'session-scoped'
            && (!parsed.data.sessionId
                || !deps.authorizeRunnerSession(runner.organizationId, runner.id, parsed.data.sessionId))) {
            return next(new Error('Session binding mismatch'))
        }
        socket.data.namespace = runner.organizationId
        socket.data.organizationId = runner.organizationId
        socket.data.runnerId = runner.id
        socket.data.machineId = runner.machineId
        socket.data.principalKind = 'runner'
        socket.data.runnerClientType = parsed.data.clientType
        next()
    })
    cliNs.on('connection', (socket) => registerCliHandlers(socket as CliSocketWithData, {
        io,
        store: deps.store,
        rpcRegistry,
        terminalRegistry,
        terminalHistoryRequests,
        terminalSessionState,
        onSessionAlive: deps.onSessionAlive,
        onSessionReady: deps.onSessionReady,
        onSessionEnd: deps.onSessionEnd,
        onMachineAlive: deps.onMachineAlive,
        onWebappEvent: deps.onWebappEvent,
        onBackgroundTaskDelta: deps.onBackgroundTaskDelta,
        onSessionActivity: deps.onSessionActivity,
        onSessionCrashed: deps.onSessionCrashed,
        onAgentTextMessage: deps.onAgentTextMessage,
        onSweepImmediateQueued: deps.onSweepImmediateQueued,
        resolveCapability: deps.resolveCapability
    }))

    terminalNs.use((socket, next) => {
        const sessionToken = cookieValue(socket.handshake.headers.cookie, SHARED_SESSION_COOKIE)
        const session = sessionToken ? deps.validateWebSession(sessionToken) : null
        if (!session) return next(new Error('Invalid session'))
        socket.data.membershipId = session.membershipId
        socket.data.organizationId = session.organizationId
        socket.data.organizationRole = session.role
        socket.data.namespace = session.organizationId
        next()
    })
    terminalNs.on('connection', (socket) => registerTerminalHandlers(socket, {
        io,
        getSession: (sessionId) => {
            return deps.getSession?.(sessionId) ?? deps.store.sessions.getSession(sessionId)
        },
        getMachine: (machineId) => {
            return deps.store.machines.getMachine(machineId)
        },
        terminalRegistry,
        terminalHistoryRequests,
        terminalSessionState,
        maxTerminalsPerSocket,
        maxTerminalsPerSession,
        capabilityResolver: deps.resolveCapability
    }))

    return { io, engine, rpcRegistry, terminalRegistry, terminalSessionState,
        disconnectOrganization: (organizationId: string) => {
            for (const [id, socket] of cliNs.sockets) {
                if (socket.data.namespace === organizationId || socket.data.organizationId === organizationId) {
                    socket.disconnect(true)
                }
            }
            for (const socket of terminalNs.sockets.values()) {
                if (socket.data.organizationId === organizationId) socket.disconnect(true)
            }
        },
        disconnectRunner: (organizationId: string, runnerId: string) => {
            for (const socket of cliNs.sockets.values()) {
                if (socket.data.organizationId === organizationId && socket.data.runnerId === runnerId) {
                    socket.disconnect(true)
                }
            }
        },
        disconnectMembership: (organizationId: string, membershipId: string) => {
            for (const socket of terminalNs.sockets.values()) {
                if (socket.data.organizationId === organizationId && socket.data.membershipId === membershipId) {
                    socket.disconnect(true)
                }
            }
        }
    }
}
