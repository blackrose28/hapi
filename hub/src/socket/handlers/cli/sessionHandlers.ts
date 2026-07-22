import { isObject } from '@hapi/protocol'
import type { ClientToServerEvents } from '@hapi/protocol'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Store, StoredSession } from '../../../store'
import type { SyncEvent } from '../../../sync/syncEngine'
import { extractSessionTodoUpdates, reduceSessionTodos, TodosSchema } from '../../../sync/todos'
import { extractTeamStateFromMessageContent, applyTeamStateDelta } from '../../../sync/teams'
import { extractBackgroundTaskDelta } from '../../../sync/backgroundTasks'
import { shouldRecordSessionActivity } from '../../../sync/sessionActivity'
import type { CliSocketWithData } from '../../socketTypes'
import type { SessionEndReason } from '@hapi/protocol'
import type { AccessErrorReason, AccessResult } from './types'

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
    reason?: SessionEndReason
}

type ResolveSessionAccess = (sessionId: string) => AccessResult<StoredSession>

type EmitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => void

type UpdateMetadataHandler = ClientToServerEvents['update-metadata']
type UpdateStateHandler = ClientToServerEvents['update-state']

const messageSchema = z.object({
    sid: z.string(),
    message: z.union([z.string(), z.unknown()]),
    localId: z.string().optional()
})

const updateMetadataSchema = z.object({
    sid: z.string(),
    expectedVersion: z.number().int(),
    metadata: z.unknown()
})

const updateStateSchema = z.object({
    sid: z.string(),
    expectedVersion: z.number().int(),
    agentState: z.unknown().nullable()
})

export type SessionHandlersDeps = {
    store: Store
    resolveSessionAccess: ResolveSessionAccess
    emitAccessError: EmitAccessError
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onWebappEvent?: (event: SyncEvent) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    onSessionCrashed?: (sessionId: string, error?: string) => void
    onAgentTextMessage?: (input: { namespace: string; sessionId: string; text: string; requestId?: string | null }) => void
}

function getTeamMentionRequestId(content: unknown): string | null {
    if (!isObject(content)) return null
    const meta = (content as Record<string, unknown>).meta
    if (!isObject(meta)) return null
    const metaRecord = meta as Record<string, unknown>
    if (metaRecord.sentFrom !== 'team-chat') return null
    return typeof metaRecord.teamMentionRequestId === 'string' ? metaRecord.teamMentionRequestId : null
}

function findLatestTeamMentionRequestIdBeforeAgentReply(messages: Array<{ content: unknown }>): string | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const content = messages[index]?.content
        if (!isObject(content)) continue
        if ((content as Record<string, unknown>).role !== 'user') continue
        return getTeamMentionRequestId(content)
    }
    return null
}

function extractAgentTextMessage(content: unknown): string | null {
    if (!isObject(content) || (content as Record<string, unknown>).role !== 'agent') return null
    const inner = (content as Record<string, unknown>).content
    if (!isObject(inner)) return null
    const innerRecord = inner as Record<string, unknown>

    if (innerRecord.type === 'codex' && isObject(innerRecord.data)) {
        const data = innerRecord.data as Record<string, unknown>
        if (data.type === 'message') {
            if (typeof data.message === 'string') return data.message
            if (typeof data.text === 'string') return data.text
        }
    }

    if (innerRecord.type === 'message' && typeof innerRecord.message === 'string') {
        return innerRecord.message
    }

    if (innerRecord.type === 'text' && typeof innerRecord.text === 'string') {
        return innerRecord.text
    }

    return null
}

export function registerSessionHandlers(socket: CliSocketWithData, deps: SessionHandlersDeps): void {
    const { store, resolveSessionAccess, emitAccessError, onSessionAlive, onSessionEnd, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, onSessionCrashed, onAgentTextMessage } = deps

    socket.on('message', (data: unknown) => {
        const parsed = messageSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { sid, localId } = parsed.data
        const raw = parsed.data.message

        const incomingContent = typeof raw === 'string'
            ? (() => {
                try {
                    return JSON.parse(raw) as unknown
                } catch {
                    return raw
                }
            })()
            : raw

        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', sid, sessionAccess.reason)
            return
        }
        const session = sessionAccess.value

        const addResult = store.messages.addMessage(sid, incomingContent, localId)
        if (addResult.kind === 'duplicate') return
        const msg = addResult.message
        const content = msg.content
        if (shouldRecordSessionActivity(content)) {
            onSessionActivity?.(sid, msg.createdAt)
        }

        const recentMessageContents = store.messages
            .getMessages(sid, 200, msg.seq)
            .map((message) => message.content)
        const extraction = extractSessionTodoUpdates(content, recentMessageContents)
        for (const issue of extraction.issues) {
            console.warn(`Ignored ${issue.source} session todo update: ${issue.reason}`)
        }

        if (extraction.updates.length > 0) {
            const latest = store.sessions.getSession(sid)
            const currentTodos = latest?.todos === null
                ? null
                : (() => {
                    const parsedTodos = TodosSchema.safeParse(latest?.todos)
                    return parsedTodos.success ? parsedTodos.data : null
                })()
            const reduction = reduceSessionTodos(currentTodos, extraction.updates)
            if (reduction.kind === 'rejected') {
                console.warn(`Ignored invalid session todo reduction: ${reduction.reason}`)
            } else if (reduction.kind === 'changed') {
                const updatedAt = Math.max(msg.createdAt, (latest?.todosUpdatedAt ?? msg.createdAt - 1) + 1)
                const result = store.sessions.setSessionTodos(sid, reduction.todos, updatedAt, session.namespace)
                if (result === 'applied') {
                    onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid } })
                } else if (result === 'error') {
                    console.warn(`Failed to persist session todos for ${sid}`)
                }
            }
        }

        const teamDelta = extractTeamStateFromMessageContent(content)
        if (teamDelta) {
            const existingSession = store.sessions.getSession(sid)
            const existingTeamState = existingSession?.teamState as import('@hapi/protocol/types').TeamState | null | undefined
            const newTeamState = applyTeamStateDelta(existingTeamState ?? null, teamDelta)
            const updated = store.sessions.setSessionTeamState(sid, newTeamState, msg.createdAt, session.namespace)
            if (updated) {
                onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid } })
            }
        }

        const bgDelta = extractBackgroundTaskDelta(content)
        if (bgDelta) {
            onBackgroundTaskDelta?.(sid, bgDelta)
        }

        const agentText = extractAgentTextMessage(content)
        if (agentText) {
            const recentMessages = store.messages.getMessages(sid, 50, msg.seq)
            const requestId = findLatestTeamMentionRequestIdBeforeAgentReply(recentMessages)
            if (requestId) {
                try {
                    onAgentTextMessage?.({ namespace: session.namespace, sessionId: sid, text: agentText, requestId })
                } catch (error) {
                    console.warn('Failed to auto-report Team mention reply', error)
                }
            }
        }

        // Detect thread crash event from CLI → notify hub to set session inactive
        if (
            isObject(content) &&
            (content as Record<string, unknown>).role === 'agent' &&
            isObject((content as Record<string, unknown>).content)
        ) {
            const inner = (content as Record<string, unknown>).content as Record<string, unknown>
            if (
                inner.type === 'event' &&
                isObject(inner.data) &&
                (inner.data as Record<string, unknown>).type === 'thread-crashed'
            ) {
                const crashData = inner.data as Record<string, unknown>
                let crashError: string | undefined = undefined
                if (typeof crashData.error === 'string') {
                    crashError = crashData.error
                } else if (isObject(crashData.error)) {
                    try {
                        crashError = JSON.stringify(crashData.error)
                    } catch {
                        crashError = '[Unserializable Error Object]'
                    }
                }
                onSessionCrashed?.(sid, crashError)
            }
        }

        const update = {
            id: randomUUID(),
            seq: msg.seq,
            createdAt: Date.now(),
            body: {
                t: 'new-message' as const,
                sid,
                message: {
                    id: msg.id,
                    seq: msg.seq,
                    createdAt: msg.createdAt,
                    localId: msg.localId,
                    content: msg.content
                }
            }
        }
        socket.to(`session:${sid}`).emit('update', update)

        onWebappEvent?.({
            type: 'message-received',
            sessionId: sid,
            message: {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                content: msg.content,
                createdAt: msg.createdAt,
                invokedAt: msg.invokedAt
            }
        })
    })

    const handleUpdateMetadata: UpdateMetadataHandler = (data, cb) => {
        const parsed = updateMetadataSchema.safeParse(data)
        if (!parsed.success) {
            cb({ result: 'error' })
            return
        }

        const { sid, metadata, expectedVersion } = parsed.data
        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            cb({ result: 'error', reason: sessionAccess.reason })
            return
        }

        const result = store.sessions.updateSessionMetadata(
            sid,
            metadata,
            expectedVersion,
            sessionAccess.value.namespace
        )
        if (result.result === 'success') {
            cb({ result: 'success', version: result.version, metadata: result.value })
        } else if (result.result === 'version-mismatch') {
            cb({ result: 'version-mismatch', version: result.version, metadata: result.value })
        } else {
            cb({ result: 'error' })
        }

        if (result.result === 'success') {
            const update = {
                id: randomUUID(),
                seq: Date.now(),
                createdAt: Date.now(),
                body: {
                    t: 'update-session' as const,
                    sid,
                    metadata: { version: result.version, value: metadata },
                    agentState: null
                }
            }
            socket.to(`session:${sid}`).emit('update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid } })
        }
    }

    socket.on('update-metadata', handleUpdateMetadata)

    const handleUpdateState: UpdateStateHandler = (data, cb) => {
        const parsed = updateStateSchema.safeParse(data)
        if (!parsed.success) {
            cb({ result: 'error' })
            return
        }

        const { sid, agentState, expectedVersion } = parsed.data
        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            cb({ result: 'error', reason: sessionAccess.reason })
            return
        }

        const result = store.sessions.updateSessionAgentState(
            sid,
            agentState,
            expectedVersion,
            sessionAccess.value.namespace
        )
        if (result.result === 'success') {
            cb({ result: 'success', version: result.version, agentState: result.value })
        } else if (result.result === 'version-mismatch') {
            cb({ result: 'version-mismatch', version: result.version, agentState: result.value })
        } else {
            cb({ result: 'error' })
        }

        if (result.result === 'success') {
            const update = {
                id: randomUUID(),
                seq: Date.now(),
                createdAt: Date.now(),
                body: {
                    t: 'update-session' as const,
                    sid,
                    metadata: null,
                    agentState: { version: result.version, value: agentState }
                }
            }
            socket.to(`session:${sid}`).emit('update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid } })
        }
    }

    socket.on('update-state', handleUpdateState)

    socket.on('session-alive', (data: SessionAlivePayload) => {
        if (!data || typeof data.sid !== 'string' || typeof data.time !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onSessionAlive?.(data)
    })

    socket.on('messages-consumed', (data: { sid: string; localIds: string[] }) => {
        if (!data || typeof data.sid !== 'string' || !Array.isArray(data.localIds)) {
            return
        }
        const localIds = data.localIds.filter((id): id is string => typeof id === 'string')
        if (localIds.length === 0) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        const invokedAt = Date.now()
        try {
            store.messages.markMessagesInvoked(data.sid, localIds, invokedAt)
            onSessionActivity?.(data.sid, invokedAt)
            // Emit only after the DB write succeeds. Otherwise a transient SQLite
            // failure would broadcast an `invokedAt` that was never persisted —
            // live clients would hide the queued rows while a refresh / secondary
            // client would see them as queued again, diverging the state.
            onWebappEvent?.({ type: 'messages-consumed', sessionId: data.sid, localIds, invokedAt })
        } catch (err) {
            console.error('markMessagesInvoked failed', err)
        }
    })

    socket.on('session-end', (data: SessionEndPayload) => {
        if (!data || typeof data.sid !== 'string' || typeof data.time !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }

        // Force-invoke any user messages that are still queued at session end.
        // Without this, the floating bar pins the queued rows after the CLI is
        // gone — there is no longer an ack path (no CLI to emit
        // messages-consumed) so they would stay queued forever.
        try {
            const queued = store.messages.getUninvokedLocalMessages(data.sid)
            const localIds = queued
                .map((m) => m.localId)
                .filter((id): id is string => typeof id === 'string')
            if (localIds.length > 0) {
                const invokedAt = Date.now()
                store.messages.markMessagesInvoked(data.sid, localIds, invokedAt)
                onWebappEvent?.({
                    type: 'messages-consumed',
                    sessionId: data.sid,
                    localIds,
                    invokedAt
                })
            }
        } catch (err) {
            console.error('session-end markMessagesInvoked failed', err)
        }

        onSessionEnd?.(data)
    })
}
