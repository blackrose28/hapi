import {
    TerminalErrorPayloadSchema,
    TerminalExitPayloadSchema,
    TerminalHistoryResultSchema,
    TerminalListPayloadSchema,
    TerminalOutputPayloadSchema,
    TerminalReadyPayloadSchema,
    TerminalWarningPayloadSchema,
    type TerminalScopeTyped
} from '@hapi/protocol'
import type { StoredMachine, StoredSession } from '../../../store'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { TerminalSessionStateStore } from '../../terminalSessionState'
import {
    TerminalHistoryRequestRegistry,
    type TerminalHistoryScope
} from '../../terminalHistoryRequests'
import type { CliSocketWithData, SocketServer, SocketWithData } from '../../socketTypes'
import { terminalScopeRoom } from '../../terminalRooms'
import type { AccessErrorReason, AccessResult } from './types'
import { capabilitySatisfies, type ResourceCapabilityResolver } from '../../../auth/resourceCapability'

type ResolveSessionAccess = (sessionId: string) => AccessResult<StoredSession>
type ResolveMachineAccess = (machineId: string) => AccessResult<StoredMachine>

type EmitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => void

type SocketNamespace = ReturnType<SocketServer['of']>

const terminalReadySchema = TerminalReadyPayloadSchema
const terminalOutputSchema = TerminalOutputPayloadSchema
const terminalExitSchema = TerminalExitPayloadSchema
const terminalErrorSchema = TerminalErrorPayloadSchema
const terminalListSchema = TerminalListPayloadSchema
const terminalWarningSchema = TerminalWarningPayloadSchema

export type TerminalHandlersDeps = {
    terminalRegistry: TerminalRegistry
    terminalHistoryRequests?: TerminalHistoryRequestRegistry
    terminalSessionState?: TerminalSessionStateStore
    terminalNamespace: SocketNamespace
    resolveSessionAccess: ResolveSessionAccess
    resolveMachineAccess: ResolveMachineAccess
    emitAccessError: EmitAccessError
    resolveCapability: ResourceCapabilityResolver
}

export function registerTerminalHandlers(socket: CliSocketWithData, deps: TerminalHandlersDeps): void {
    const { terminalRegistry, terminalSessionState, terminalNamespace, resolveSessionAccess, resolveMachineAccess, emitAccessError, resolveCapability } = deps
    const terminalHistoryRequests = deps.terminalHistoryRequests ?? new TerminalHistoryRequestRegistry()

    const authorizeTypedScope = (scope: TerminalScopeTyped): string | null => {
        if (scope.scopeType === 'session') {
            const sessionAccess = resolveSessionAccess(scope.sessionId)
            if (!sessionAccess.ok) {
                emitAccessError('session', scope.sessionId, sessionAccess.reason)
                return null
            }
            return sessionAccess.value.namespace
        }

        const machineAccess = resolveMachineAccess(scope.machineId)
        if (!machineAccess.ok) {
            emitAccessError('machine', scope.machineId, machineAccess.reason)
            return null
        }
        return machineAccess.value.namespace
    }

    const detachDeniedRecipient = (recipient: SocketWithData, scope: TerminalScopeTyped, room: string): void => {
        recipient.leave(room)
        const entries = scope.scopeType === 'session'
            ? terminalRegistry.entriesForSession(scope.sessionId, socket.data.namespace ?? '')
            : terminalRegistry.entriesForMachine(scope.machineId, socket.data.namespace ?? '')
        for (const entry of entries) {
            if (entry.socketId !== recipient.id) continue
            terminalRegistry.remove(entry.terminalId)
            socket.emit('terminal:detach', {
                ...(entry.sessionId ? { sessionId: entry.sessionId } : { machineId: entry.machineId! }),
                terminalId: entry.terminalId
            })
        }
    }

    const emitToAuthorizedRecipients = (event: string, payload: unknown, scope: TerminalScopeTyped, namespace: string): Set<string> => {
        const room = terminalScopeRoom(namespace, scope)
        const delivered = new Set<string>()
        const recipients = terminalNamespace.adapter.rooms.get(room) ?? new Set<string>()
        for (const socketId of recipients) {
            const recipient = terminalNamespace.sockets.get(socketId)
            if (!recipient?.data.membershipId || !recipient.data.organizationRole) {
                recipient?.leave(room)
                continue
            }
            const capability = resolveCapability({
                organizationId: namespace,
                membershipId: recipient.data.membershipId,
                role: recipient.data.organizationRole,
                resourceType: scope.scopeType,
                resourceId: scope.scopeType === 'session' ? scope.sessionId : scope.machineId
            })
            if (!capabilitySatisfies(capability, 'operate')) {
                detachDeniedRecipient(recipient, scope, room)
                continue
            }
            recipient.emit(event, payload)
            delivered.add(recipient.id)
        }
        return delivered
    }

    const forwardTerminalEvent = (event: string, payload: { sessionId?: string; machineId?: string; terminalId: string } & Record<string, unknown>, removeEntry = false) => {
        const entry = terminalRegistry.get(payload.terminalId)
        if (!entry) {
            return
        }
        if (entry.cliSocketId !== socket.id) {
            return
        }
        if (payload.sessionId !== entry.sessionId || payload.machineId !== entry.machineId) {
            return
        }
        const typedScope: TerminalScopeTyped | null = payload.sessionId
            ? { scopeType: 'session', sessionId: payload.sessionId }
            : payload.machineId
                ? { scopeType: 'machine', machineId: payload.machineId }
                : null
        const namespace = typedScope ? authorizeTypedScope(typedScope) : null
        if (!typedScope || !namespace) {
            if (removeEntry) {
                terminalRegistry.remove(payload.terminalId)
            }
            return
        }
        if (removeEntry) {
            terminalRegistry.remove(payload.terminalId)
        }
        const room = terminalScopeRoom(namespace, typedScope)
        const delivered = emitToAuthorizedRecipients(event, payload, typedScope, namespace)
        const terminalSocket = terminalNamespace.sockets.get(entry.socketId)
        if (!terminalSocket) {
            return
        }
        if (delivered.has(terminalSocket.id)) {
            return
        }
        if (!terminalSocket.data.membershipId || !terminalSocket.data.organizationRole) return
        const capability = resolveCapability({
            organizationId: namespace,
            membershipId: terminalSocket.data.membershipId,
            role: terminalSocket.data.organizationRole,
            resourceType: typedScope.scopeType,
            resourceId: typedScope.scopeType === 'session' ? typedScope.sessionId : typedScope.machineId
        })
        if (capabilitySatisfies(capability, 'operate')) terminalSocket.emit(event, payload)
        else detachDeniedRecipient(terminalSocket, typedScope, room)
    }

    socket.on('terminal:list', (data: unknown) => {
        const parsed = terminalListSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const namespace = authorizeTypedScope(parsed.data)
        if (!namespace) {
            return
        }
        terminalSessionState?.updateFromList(socket.id, namespace, parsed.data)
        const payload = parsed.data.scopeType === 'session'
            ? (terminalSessionState?.getCachedSessionList(parsed.data.sessionId, namespace) ?? parsed.data)
            : parsed.data
        emitToAuthorizedRecipients('terminal:list', payload, parsed.data, namespace)
    })

    socket.on('terminal:warning', (data: unknown) => {
        const parsed = terminalWarningSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const namespace = authorizeTypedScope(parsed.data)
        if (!namespace) {
            return
        }
        emitToAuthorizedRecipients('terminal:warning', parsed.data, parsed.data, namespace)
    })

    socket.on('terminal:ready', (data: unknown) => {
        const parsed = terminalReadySchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        terminalRegistry.markActivity(parsed.data.terminalId)
        forwardTerminalEvent('terminal:ready', parsed.data)
    })

    socket.on('terminal:output', (data: unknown) => {
        const parsed = terminalOutputSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        terminalRegistry.markActivity(parsed.data.terminalId)
        forwardTerminalEvent('terminal:output', parsed.data)
    })

    socket.on('terminal:exit', (data: unknown) => {
        const parsed = terminalExitSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const entry = terminalRegistry.get(parsed.data.terminalId)
        const sessionId = 'sessionId' in parsed.data ? parsed.data.sessionId : undefined
        const machineId = 'machineId' in parsed.data ? parsed.data.machineId : undefined
        if (!entry || entry.sessionId !== sessionId || entry.machineId !== machineId || entry.cliSocketId !== socket.id) {
            return
        }
        forwardTerminalEvent('terminal:exit', parsed.data, true)
    })

    socket.on('terminal:error', (data: unknown) => {
        const parsed = terminalErrorSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const entry = terminalRegistry.get(parsed.data.terminalId)
        const sessionId = 'sessionId' in parsed.data ? parsed.data.sessionId : undefined
        const machineId = 'machineId' in parsed.data ? parsed.data.machineId : undefined
        if (!entry || entry.sessionId !== sessionId || entry.machineId !== machineId || entry.cliSocketId !== socket.id) {
            return
        }

        forwardTerminalEvent('terminal:error', parsed.data, true)
    })

    socket.on('terminal:history-result', (data: unknown) => {
        const parsed = TerminalHistoryResultSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const scope: TerminalHistoryScope = 'sessionId' in parsed.data
            ? { sessionId: parsed.data.sessionId }
            : { machineId: parsed.data.machineId }
        const typedScope: TerminalScopeTyped = 'sessionId' in scope
            ? { scopeType: 'session', sessionId: scope.sessionId }
            : { scopeType: 'machine', machineId: scope.machineId }
        const namespace = authorizeTypedScope(typedScope)
        if (!namespace) {
            return
        }
        const entry = terminalRegistry.get(parsed.data.terminalId)
        if (
            !entry
            || entry.cliSocketId !== socket.id
            || entry.namespace !== namespace
            || entry.sessionId !== ('sessionId' in scope ? scope.sessionId : undefined)
            || entry.machineId !== ('machineId' in scope ? scope.machineId : undefined)
        ) {
            return
        }

        const pending = terminalHistoryRequests.consume(parsed.data.requestId, {
            cliSocketId: socket.id,
            terminalId: parsed.data.terminalId,
            namespace,
            scope
        })
        if (!pending) {
            return
        }
        const webSocket = terminalNamespace.sockets.get(pending.webSocketId)
        webSocket?.emit('terminal:history-result', {
            ...parsed.data,
            requestId: pending.webRequestId
        })
    })
}

export function cleanupTerminalHandlers(socket: CliSocketWithData, deps: {
    terminalRegistry: TerminalRegistry
    terminalHistoryRequests?: TerminalHistoryRequestRegistry
    terminalNamespace: SocketNamespace
    resolveCapability: ResourceCapabilityResolver
}): void {
    deps.terminalHistoryRequests?.removeByCliSocket(socket.id)
    const removed = deps.terminalRegistry.removeByCliSocket(socket.id)
    for (const entry of removed) {
        const terminalSocket = deps.terminalNamespace.sockets.get(entry.socketId)
        if (!terminalSocket?.data.membershipId || !terminalSocket.data.organizationRole) continue
        const resourceType = entry.sessionId ? 'session' : 'machine'
        const resourceId = entry.sessionId ?? entry.machineId!
        if (!capabilitySatisfies(deps.resolveCapability({
            organizationId: entry.namespace,
            membershipId: terminalSocket.data.membershipId,
            role: terminalSocket.data.organizationRole,
            resourceType,
            resourceId
        }), 'operate')) {
            terminalSocket.leave(terminalScopeRoom(entry.namespace, entry.sessionId
                ? { scopeType: 'session', sessionId: entry.sessionId }
                : { scopeType: 'machine', machineId: entry.machineId! }))
            continue
        }
        terminalSocket.emit('terminal:error', {
            ...(entry.sessionId ? { sessionId: entry.sessionId } : { machineId: entry.machineId }),
            terminalId: entry.terminalId,
            message: 'CLI disconnected.'
        })
    }
}
