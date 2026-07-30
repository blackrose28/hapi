import {
    TERMINAL_HISTORY_CLI_CAPABILITY,
    TerminalKeepalivePayloadSchema,
    TerminalListRequestSchema,
    TerminalOpenPayloadSchema,
    type TerminalKeepalivePayload,
    type TerminalListRequest,
    type TerminalScopeTyped
} from '@hapi/protocol'
import { z } from 'zod'
import type { TerminalRegistry, TerminalRegistryEntry } from '../terminalRegistry'
import {
    TerminalHistoryRequestRegistry,
    type TerminalHistoryScope
} from '../terminalHistoryRequests'
import type { TerminalSessionStateStore } from '../terminalSessionState'
import type { SocketServer, SocketWithData } from '../socketTypes'
import { terminalScopeRoom } from '../terminalRooms'
import { capabilitySatisfies, type ResourceCapabilityResolver } from '../../auth/resourceCapability'

const terminalCreateSchema = TerminalOpenPayloadSchema

const terminalWriteSchema = z.object({
    terminalId: z.string().min(1),
    data: z.string()
}).strict()

const terminalResizeSchema = z.object({
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
}).strict()

const terminalHistoryWebRequestSchema = z.object({
    terminalId: z.string().min(1),
    requestId: z.string().min(1),
    limit: z.number().int().optional()
}).strict()

const terminalLegacyCloseSchema = z.object({
    terminalId: z.string().min(1)
}).strict()

const terminalTypedCloseSchema = TerminalKeepalivePayloadSchema
const terminalCloseSchema = z.union([terminalTypedCloseSchema, terminalLegacyCloseSchema])

export type TerminalHandlersDeps = {
    io: SocketServer
    getSession: (sessionId: string) => { active: boolean; namespace: string } | null
    getMachine: (machineId: string) => { active: boolean; namespace: string } | null
    terminalRegistry: TerminalRegistry
    terminalHistoryRequests?: TerminalHistoryRequestRegistry
    terminalSessionState?: TerminalSessionStateStore
    maxTerminalsPerSocket: number
    maxTerminalsPerSession: number
    capabilityResolver: ResourceCapabilityResolver
}

export function registerTerminalHandlers(socket: SocketWithData, deps: TerminalHandlersDeps): void {
    const { io, getSession, getMachine, terminalRegistry, terminalSessionState, maxTerminalsPerSocket, maxTerminalsPerSession, capabilityResolver } = deps
    const terminalHistoryRequests = deps.terminalHistoryRequests ?? new TerminalHistoryRequestRegistry()
    const cliNamespace = io.of('/cli')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const emitTerminalError = (terminalId: string, message: string) => {
        socket.emit('terminal:error', { terminalId, message })
    }

    const authorizeScope = (scope: TerminalScopeTyped): boolean => {
        if (!namespace || !socket.data.membershipId || !socket.data.organizationRole) {
            return false
        }
        if (scope.scopeType === 'session') {
            const session = getSession(scope.sessionId)
            if (!session || !session.active || session.namespace !== namespace) return false
        } else {
            const machine = getMachine(scope.machineId)
            if (!machine || !machine.active || machine.namespace !== namespace) return false
        }
        return capabilitySatisfies(capabilityResolver({
            organizationId: namespace,
            membershipId: socket.data.membershipId,
            role: socket.data.organizationRole,
            resourceType: scope.scopeType,
            resourceId: scope.scopeType === 'session' ? scope.sessionId : scope.machineId
        }), 'operate')
    }

    const legacyScopeFromTyped = (scope: TerminalScopeTyped): { sessionId: string } | { machineId: string } => {
        return scope.scopeType === 'session' ? { sessionId: scope.sessionId } : { machineId: scope.machineId }
    }

    const roomForScope = (scope: TerminalScopeTyped): string | null => {
        return namespace ? terminalScopeRoom(namespace, scope) : null
    }

    const resolveEntryForSocket = (terminalId: string): TerminalRegistryEntry | null => {
        const entry = terminalRegistry.get(terminalId)
        if (!entry || entry.socketId !== socket.id) {
            return null
        }
        return entry
    }

    const resolveEntryForControl = (terminalId: string): TerminalRegistryEntry | null => {
        const entry = terminalRegistry.get(terminalId)
        if (!entry) {
            return null
        }
        if (entry.namespace !== namespace) {
            return null
        }
        const scope: TerminalScopeTyped = entry.sessionId
            ? { scopeType: 'session', sessionId: entry.sessionId }
            : { scopeType: 'machine', machineId: entry.machineId! }
        if (!authorizeScope(scope)) {
            detachEntry(entry, scope)
            return null
        }
        if (entry.socketId === socket.id) return entry
        if (!entry.sessionId) return null
        const room = roomForScope(scope)
        if (!room || !socket.rooms.has(room)) {
            return null
        }
        return entry
    }

    const resolveCliSocket = (entry: TerminalRegistryEntry, reportError: boolean): SocketWithData | null => {
        const cliSocket = cliNamespace.sockets.get(entry.cliSocketId)
        if (!cliSocket || cliSocket.data.namespace !== namespace) {
            terminalRegistry.remove(entry.terminalId)
            if (reportError) {
                emitTerminalError(entry.terminalId, 'CLI disconnected.')
            }
            return null
        }
        return cliSocket
    }

    const getEntryScope = (entry: TerminalRegistryEntry): { sessionId: string } | { machineId: string } | null => {
        if (entry.sessionId) return { sessionId: entry.sessionId }
        if (entry.machineId) return { machineId: entry.machineId }
        return null
    }

    const emitCloseToCli = (entry: TerminalRegistryEntry): void => {
        const cliSocket = cliNamespace.sockets.get(entry.cliSocketId)
        if (!cliSocket || cliSocket.data.namespace !== namespace) {
            return
        }
        const scope = getEntryScope(entry)
        if (!scope) return
        cliSocket.emit('terminal:close', { ...scope, terminalId: entry.terminalId })
    }

    const emitDetachToCli = (entry: TerminalRegistryEntry): void => {
        const cliSocket = cliNamespace.sockets.get(entry.cliSocketId)
        if (!cliSocket || cliSocket.data.namespace !== namespace) {
            return
        }
        const scope = getEntryScope(entry)
        if (!scope) return
        cliSocket.emit('terminal:detach', { ...scope, terminalId: entry.terminalId })
    }

    const detachEntry = (entry: TerminalRegistryEntry, scope: TerminalScopeTyped): void => {
        const room = roomForScope(scope)
        if (room) socket.leave(room)
        if (entry.socketId !== socket.id) return
        terminalRegistry.remove(entry.terminalId)
        emitDetachToCli(entry)
    }

    const denyScope = (scope: TerminalScopeTyped): void => {
        const room = roomForScope(scope)
        if (room) socket.leave(room)
        const entries = scope.scopeType === 'session'
            ? terminalRegistry.entriesForSession(scope.sessionId, namespace ?? '')
            : terminalRegistry.entriesForMachine(scope.machineId, namespace ?? '')
        for (const entry of entries) {
            if (entry.socketId === socket.id) detachEntry(entry, scope)
        }
    }

    const pickCliSocketId = (scope: { sessionId: string } | { machineId: string }): string | null => {
        const roomId = 'sessionId' in scope ? `session:${scope.sessionId}` : `machine:${scope.machineId}`
        const room = cliNamespace.adapter.rooms.get(roomId)
        if (!room || room.size === 0) {
            return null
        }
        for (const socketId of room) {
            const cliSocket = cliNamespace.sockets.get(socketId)
            if (cliSocket && cliSocket.data.namespace === namespace) {
                return cliSocket.id
            }
        }
        return null
    }

    const emitCachedSessionList = (payload: TerminalListRequest): boolean => {
        if (!namespace || payload.scopeType !== 'session') {
            return false
        }
        const cached = terminalSessionState?.getCachedSessionList(payload.sessionId, namespace)
        if (!cached) {
            return false
        }
        socket.emit('terminal:list', cached)
        return true
    }

    const forwardToCli = (event: 'terminal:list' | 'terminal:keepalive', payload: TerminalListRequest | TerminalKeepalivePayload): boolean => {
        if (!authorizeScope(payload)) {
            denyScope(payload)
            return false
        }
        const cliSocketId = pickCliSocketId(legacyScopeFromTyped(payload))
        if (!cliSocketId) {
            return false
        }
        const cliSocket = cliNamespace.sockets.get(cliSocketId)
        if (!cliSocket || cliSocket.data.namespace !== namespace) {
            return false
        }
        cliSocket.emit(event, payload)
        return true
    }

    socket.on('terminal:subscribe', (data: unknown) => {
        const parsed = TerminalListRequestSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        if (!authorizeScope(parsed.data)) {
            denyScope(parsed.data)
            return
        }
        const room = roomForScope(parsed.data)
        if (!room) {
            return
        }
        socket.join(room)
        emitCachedSessionList(parsed.data)
        forwardToCli('terminal:list', parsed.data)
    })

    socket.on('terminal:unsubscribe', (data: unknown) => {
        const parsed = TerminalListRequestSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const room = roomForScope(parsed.data)
        if (!room) {
            return
        }
        socket.leave(room)
    })

    socket.on('terminal:list', (data: unknown) => {
        const parsed = TerminalListRequestSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        if (!authorizeScope(parsed.data)) {
            denyScope(parsed.data)
            return
        }
        const forwarded = forwardToCli('terminal:list', parsed.data)
        if (!forwarded) {
            emitCachedSessionList(parsed.data)
        }
    })

    socket.on('terminal:keepalive', (data: unknown) => {
        const parsed = TerminalKeepalivePayloadSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        forwardToCli('terminal:keepalive', parsed.data)
    })

    socket.on('terminal:create', (data: unknown) => {
        const parsed = terminalCreateSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const terminalId = parsed.data.terminalId
        const cols = parsed.data.cols
        const rows = parsed.data.rows
        const cwd = parsed.data.cwd
        const replay = parsed.data.replay
        const sessionId = 'sessionId' in parsed.data ? parsed.data.sessionId : undefined
        const machineId = 'machineId' in parsed.data ? parsed.data.machineId : undefined
        const typedScope: TerminalScopeTyped = sessionId
            ? { scopeType: 'session', sessionId }
            : { scopeType: 'machine', machineId: machineId! }
        const scope = legacyScopeFromTyped(typedScope)
        if (!namespace) {
            emitTerminalError(terminalId, 'Terminal namespace is unavailable.')
            return
        }

        if (sessionId) {
            const session = getSession(sessionId)
            if (!session || !session.active || session.namespace !== namespace) {
                emitTerminalError(terminalId, 'Session is inactive or unavailable.')
                return
            }
        } else {
            const machine = getMachine(machineId!)
            if (!machine || !machine.active || machine.namespace !== namespace) {
                emitTerminalError(terminalId, 'Machine is inactive or unavailable.')
                return
            }
        }
        if (!authorizeScope(typedScope)) {
            denyScope(typedScope)
            emitTerminalError(terminalId, 'Terminal access denied.')
            return
        }

        const existingEntry = terminalRegistry.get(terminalId)
        const isReconnect = existingEntry?.sessionId === sessionId
            && existingEntry?.machineId === machineId
            && existingEntry?.namespace === namespace

        if (!isReconnect && terminalRegistry.countForSocket(socket.id) >= maxTerminalsPerSocket) {
            emitTerminalError(terminalId, `Too many terminals open (max ${maxTerminalsPerSocket}).`)
            return
        }

        const scopeLabel = sessionId ? 'session' : 'machine'
        if (!isReconnect && sessionId && terminalRegistry.countForSession(sessionId, namespace) >= maxTerminalsPerSession) {
            emitTerminalError(terminalId, `Too many terminals open for this ${scopeLabel} (max ${maxTerminalsPerSession}).`)
            return
        }

        const cliSocketId = pickCliSocketId(scope)
        if (!cliSocketId) {
            emitTerminalError(terminalId, `CLI is not connected for this ${scopeLabel}.`)
            return
        }

        const entry = terminalRegistry.register({
            terminalId,
            sessionId,
            machineId,
            namespace,
            socketId: socket.id,
            cliSocketId
        })
        if (!entry) {
            emitTerminalError(terminalId, 'Terminal ID is already in use.')
            return
        }

        const cliSocket = cliNamespace.sockets.get(cliSocketId)
        if (!cliSocket) {
            terminalRegistry.remove(terminalId)
            emitTerminalError(terminalId, `CLI is not connected for this ${scopeLabel}.`)
            return
        }

        cliSocket.emit('terminal:open', {
            ...scope,
            terminalId,
            cols,
            rows,
            ...(cwd ? { cwd } : {}),
            ...(replay ? { replay } : {})
        })
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:write', (data: unknown) => {
        const parsed = terminalWriteSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId, data: payload } = parsed.data
        const entry = resolveEntryForControl(terminalId)
        if (!entry) {
            return
        }

        const cliSocket = resolveCliSocket(entry, true)
        if (!cliSocket) {
            return
        }
        const entryScope = getEntryScope(entry)
        if (!entryScope) return
        cliSocket.emit('terminal:write', {
            ...entryScope,
            terminalId,
            data: payload
        })
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:resize', (data: unknown) => {
        const parsed = terminalResizeSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId, cols, rows } = parsed.data
        const entry = resolveEntryForControl(terminalId)
        if (!entry) {
            return
        }

        const cliSocket = resolveCliSocket(entry, true)
        if (!cliSocket) {
            return
        }
        const entryScope = getEntryScope(entry)
        if (!entryScope) return
        cliSocket.emit('terminal:resize', {
            ...entryScope,
            terminalId,
            cols,
            rows
        })
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:history', (data: unknown) => {
        const parsed = terminalHistoryWebRequestSchema.safeParse(data)
        if (!parsed.success || !namespace) {
            return
        }
        const entry = resolveEntryForControl(parsed.data.terminalId)
        if (!entry) {
            return
        }
        const cliSocket = resolveCliSocket(entry, true)
        const scope = getEntryScope(entry) as TerminalHistoryScope | null
        if (!cliSocket || !scope) {
            return
        }
        if (!cliSocket.data.cliCapabilities?.has(TERMINAL_HISTORY_CLI_CAPABILITY)) {
            socket.emit('terminal:history-result', {
                ...scope,
                terminalId: entry.terminalId,
                requestId: parsed.data.requestId,
                status: 'cli_outdated',
                entries: []
            })
            return
        }

        const correlationId = terminalHistoryRequests.register({
            webSocketId: socket.id,
            webRequestId: parsed.data.requestId,
            cliSocketId: cliSocket.id,
            terminalId: entry.terminalId,
            namespace,
            scope
        })
        const limit = Math.min(100, Math.max(1, parsed.data.limit ?? 100))
        const forwarded = cliSocket.emit('terminal:history', {
            ...scope,
            terminalId: entry.terminalId,
            requestId: correlationId,
            limit
        })
        if (!forwarded) {
            terminalHistoryRequests.remove(correlationId)
            return
        }
        terminalRegistry.markActivity(entry.terminalId)
    })

    socket.on('terminal:close', (data: unknown) => {
        const parsed = terminalCloseSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId } = parsed.data
        if ('scopeType' in parsed.data) {
            if (!authorizeScope(parsed.data)) {
                denyScope(parsed.data)
                return
            }
            const scope = legacyScopeFromTyped(parsed.data)
            const cliSocketId = pickCliSocketId(scope)
            if (!cliSocketId) {
                return
            }
            const cliSocket = cliNamespace.sockets.get(cliSocketId)
            if (!cliSocket || cliSocket.data.namespace !== namespace) {
                return
            }
            const entry = terminalRegistry.get(terminalId)
            if (
                entry
                && entry.sessionId === ('sessionId' in scope ? scope.sessionId : undefined)
                && entry.machineId === ('machineId' in scope ? scope.machineId : undefined)
                && entry.namespace === namespace
            ) {
                terminalRegistry.remove(terminalId)
            }
            cliSocket.emit('terminal:close', {
                ...scope,
                terminalId
            })
            return
        }

        const entry = resolveEntryForSocket(terminalId)
        if (!entry) {
            return
        }

        const scope: TerminalScopeTyped = entry.sessionId
            ? { scopeType: 'session', sessionId: entry.sessionId }
            : { scopeType: 'machine', machineId: entry.machineId! }
        if (!authorizeScope(scope)) {
            detachEntry(entry, scope)
            return
        }

        terminalRegistry.remove(terminalId)
        emitCloseToCli(entry)
    })

    socket.on('disconnect', () => {
        terminalHistoryRequests.removeByWebSocket(socket.id)
        // Socket disconnect means the web view detached (route switch,
        // reconnect, page background, etc.). Do not close the underlying
        // terminal process here; explicit `terminal:close` is the destructive
        // lifecycle event. A later `terminal:create` with the same ID will
        // re-register and reattach to the CLI-side terminal manager.
        const removed = terminalRegistry.removeBySocket(socket.id)
        for (const entry of removed) {
            emitDetachToCli(entry)
        }
    })
}
