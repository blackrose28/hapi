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

type SessionReadyPayload = {
    sid: string
    time: number
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

const toolProgressSchema = z.object({
    sid: z.string(),
    toolUseId: z.string().min(1),
    parentToolUseId: z.string().nullable().optional(),
    toolName: z.string().optional(),
    elapsedSeconds: z.number().finite().nonnegative().optional()
})

export type SessionHandlersDeps = {
    store: Store
    resolveSessionAccess: ResolveSessionAccess
    emitAccessError: EmitAccessError
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionReady?: (payload: SessionReadyPayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onWebappEvent?: (event: SyncEvent) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    onSessionCrashed?: (sessionId: string, error?: string) => void
    onAgentTextMessage?: (input: { namespace: string; sessionId: string; text: string; requestId?: string | null }) => void
    /** Delegates session-end immediate-queue sweep to the MessageService layer. */
    onSweepImmediateQueued?: (sessionId: string, now: number) => void
    /** Drops the queued-thinking grace so synchronous CLI handlers (e.g. slash
     *  commands) don't leave the spinner stuck for the full grace window. */
    onMessagesConsumed?: (sessionId: string) => void
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
    const { store, resolveSessionAccess, emitAccessError, onSessionAlive, onSessionReady, onSessionEnd, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, onSessionCrashed, onAgentTextMessage, onSweepImmediateQueued, onMessagesConsumed } = deps

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
                    onWebappEvent?.({ type: 'session-updated', sessionId: sid })
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
                onWebappEvent?.({ type: 'session-updated', sessionId: sid })
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
                    // Broadcast the persisted (merged) value, not the pre-merge
                    // payload — otherwise other CLIs in the session room would
                    // overwrite their local cache with a tokenless metadata
                    // snapshot even though the DB row was preserved.
                    // See store.sessions.mergeSessionMetadata for the merge
                    // contract.
                    metadata: { version: result.version, value: result.value },
                    agentState: null
                }
            }
            socket.to(`session:${sid}`).emit('update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid })
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
            onWebappEvent?.({ type: 'session-updated', sessionId: sid })
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

    socket.on('session-ready', (data: SessionReadyPayload) => {
        if (!data || typeof data.sid !== 'string' || typeof data.time !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onSessionReady?.(data)
    })

    socket.on('tool-progress', (data: unknown) => {
        const parsed = toolProgressSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        const sessionAccess = resolveSessionAccess(parsed.data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', parsed.data.sid, sessionAccess.reason)
            return
        }
        onWebappEvent?.({
            type: 'tool-progress',
            sessionId: parsed.data.sid,
            toolUseId: parsed.data.toolUseId,
            parentToolUseId: parsed.data.parentToolUseId ?? null,
            ...(parsed.data.toolName === undefined ? {} : { toolName: parsed.data.toolName }),
            ...(parsed.data.elapsedSeconds === undefined ? {} : { elapsedSeconds: parsed.data.elapsedSeconds })
        })
    })

    socket.on('messages-consumed', (data: { sid: string; localIds: string[]; clearQueuedThinkingGrace?: boolean }) => {
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
            // Only drop the queued-thinking grace when the CLI explicitly opts in
            // (synchronous handlers like slash commands that will never send
            // their own `thinking=true` keepalive). Normal queue drains still
            // need the grace so the spinner doesn't flicker between the queue
            // shift and `backend.prompt` start.
            if (data.clearQueuedThinkingGrace === true) {
                onMessagesConsumed?.(data.sid)
            }
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

        // Force-invoke only immediate-queued messages (scheduled_at IS NULL) at
        // session end.  *All* scheduled rows — mature or future — are deliberately
        // preserved in DB so the mature-scan path (releaseMatureScheduledMessages)
        // remains the sole emit channel and the CLI ack remains the sole writer of
        // invoked_at.  See HAPI Bot R4: stamping a mature scheduled row here would
        // make the next mature-scan tick skip it (filter on invoked_at IS NULL) and
        // silently drop the user's prompt.
        //
        // Without this sweep for immediate rows, the floating bar would pin queued
        // rows after the CLI exits — there is no longer an ack path, so they would
        // stay queued forever.  The 5-second tick in syncEngine.expireInactive
        // emits scheduled rows when they mature, regardless of session end.
        try {
            onSweepImmediateQueued?.(data.sid, Date.now())
        } catch (err) {
            console.error('session-end sweep failed', err)
        }

        onSessionEnd?.(data)
    })
}
