import { CliCapabilitiesSchema, CliCapabilitySchema } from '@hapi/protocol'
import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { TerminalHistoryRequestRegistry } from '../../terminalHistoryRequests'
import type { LostSessionTerminalList, TerminalSessionStateStore } from '../../terminalSessionState'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerMachineHandlers } from './machineHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'
import { terminalScopeRoom } from '../../terminalRooms'
import type { ResourceCapabilityResolver } from '../../../auth/resourceCapability'

type SessionAlivePayload = {
    sid: string
    time: number
    thinking?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    collaborationMode?: CodexCollaborationMode
}

type SessionEndPayload = {
    sid: string
    time: number
}

type SessionReadyPayload = {
    sid: string
    time: number
}

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    terminalHistoryRequests?: TerminalHistoryRequestRegistry
    terminalSessionState?: TerminalSessionStateStore
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionReady?: (payload: SessionReadyPayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onMachineAlive?: (payload: MachineAlivePayload) => void
    onWebappEvent?: (event: SyncEvent) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    onSessionCrashed?: (sessionId: string, error?: string) => void
    onAgentTextMessage?: (input: { namespace: string; sessionId: string; text: string; requestId?: string | null }) => void
    onSweepImmediateQueued?: (sessionId: string, now: number) => void
    resolveCapability: ResourceCapabilityResolver
}

type SocketNamespace = ReturnType<SocketServer['of']>

export function broadcastLostTerminalLists(
    terminalNamespace: SocketNamespace,
    lostLists: LostSessionTerminalList[],
    resolveCapability: ResourceCapabilityResolver
): void {
    for (const lostList of lostLists) {
        const room = terminalScopeRoom(lostList.namespace, lostList.payload)
        const recipients = terminalNamespace.adapter.rooms.get(room) ?? new Set<string>()
        for (const socketId of recipients) {
            const recipient = terminalNamespace.sockets.get(socketId)
            if (!recipient?.data.membershipId || !recipient.data.organizationRole) {
                recipient?.leave(room)
                continue
            }
            const capability = resolveCapability({
                organizationId: lostList.namespace,
                membershipId: recipient.data.membershipId,
                role: recipient.data.organizationRole,
                resourceType: 'session',
                resourceId: lostList.payload.sessionId
            })
            if (capability !== 'operate' && capability !== 'manage') {
                recipient.leave(room)
                continue
            }
            recipient.emit('terminal:list', lostList.payload)
        }
    }
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, terminalHistoryRequests, terminalSessionState, onSessionAlive, onSessionReady, onSessionEnd, onMachineAlive, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, onSessionCrashed, onAgentTextMessage, onSweepImmediateQueued, resolveCapability } = deps
    const terminalNamespace = io.of('/terminal')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const resolveSessionAccess = (sessionId: string): AccessResult<StoredSession> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const session = store.sessions.getSessionByNamespace(sessionId, namespace)
        if (session) {
            return { ok: true, value: session }
        }
        if (store.sessions.getSession(sessionId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const resolveMachineAccess = (machineId: string): AccessResult<StoredMachine> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const machine = store.machines.getMachineByNamespace(machineId, namespace)
        if (machine) {
            return { ok: true, value: machine }
        }
        if (store.machines.getMachine(machineId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const parsedCapabilities = CliCapabilitiesSchema.safeParse(auth?.capabilities)
    socket.data.cliCapabilities = new Set(
        parsedCapabilities.success
            ? parsedCapabilities.data.flatMap((capability) => {
                const knownCapability = CliCapabilitySchema.safeParse(capability)
                return knownCapability.success ? [knownCapability.data] : []
            })
            : []
    )
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    if (sessionId && resolveSessionAccess(sessionId).ok) {
        socket.join(`session:${sessionId}`)
    }

    const machineId = typeof auth?.machineId === 'string' ? auth.machineId : null
    if (machineId && resolveMachineAccess(machineId).ok) {
        socket.join(`machine:${machineId}`)
    }

    const emitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => {
        const message = reason === 'access-denied'
            ? `${scope} access denied`
            : reason === 'not-found'
                ? `${scope} not found`
                : 'Namespace missing'
        socket.emit('error', { message, code: reason, scope, id })
    }

    registerRpcHandlers(socket, rpcRegistry)

    if (socket.data.runnerClientType === 'machine-scoped') {
        registerMachineHandlers(socket, {
            store,
            resolveMachineAccess: (id) => id === socket.data.machineId
                ? resolveMachineAccess(id)
                : { ok: false, reason: 'access-denied' },
            emitAccessError,
            onMachineAlive,
            onWebappEvent
        })
        return
    }

    if (socket.data.runnerClientType === 'session-scoped') {
        registerSessionHandlers(socket, {
            store,
            resolveSessionAccess,
            emitAccessError,
            onSessionAlive,
            onSessionReady,
            onSessionEnd,
            onWebappEvent,
            onBackgroundTaskDelta,
            onSessionActivity,
            onSessionCrashed,
            onAgentTextMessage,
            onSweepImmediateQueued
        })
        return
    }

    registerSessionHandlers(socket, {
        store,
        resolveSessionAccess,
        emitAccessError,
        onSessionAlive,
        onSessionReady,
        onSessionEnd,
        onWebappEvent,
        onBackgroundTaskDelta,
        onSessionActivity,
        onSessionCrashed,
        onAgentTextMessage,
        onSweepImmediateQueued
    })
    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess,
        emitAccessError,
        onMachineAlive,
        onWebappEvent
    })
    registerTerminalHandlers(socket, {
        terminalRegistry,
        terminalHistoryRequests,
        terminalSessionState,
        terminalNamespace,
        resolveSessionAccess,
        resolveMachineAccess,
        emitAccessError,
        resolveCapability
    })

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        const lostLists = terminalSessionState?.markLostByCliSocket(
            socket.id,
            Date.now(),
            namespace && sessionId ? { namespace, sessionId } : null
        ) ?? []
        broadcastLostTerminalLists(terminalNamespace, lostLists, resolveCapability)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalHistoryRequests, terminalNamespace, resolveCapability })
    })
}
