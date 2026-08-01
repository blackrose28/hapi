import { describe, expect, it, spyOn } from 'bun:test'
import { toSessionSummary } from '@hapi/protocol'
import type { SyncEvent, TodoItem } from '@hapi/protocol/types'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { registerSessionHandlers } from '../socket/handlers/cli/sessionHandlers'
import { registerTerminalHandlers } from '../socket/handlers/terminal'
import { TerminalRegistry } from '../socket/terminalRegistry'
import type { SocketServer, SocketWithData } from '../socket/socketTypes'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'
import { SyncEngine } from './syncEngine'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

function registerTestSessionHandlers(
    store: Store,
    onWebappEvent: (event: SyncEvent) => void
): Map<string, (payload: unknown) => void> {
    const handlers = new Map<string, (payload: unknown) => void>()
    registerSessionHandlers({
        on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
        to: () => ({ emit() {} })
    } as never, {
        store,
        resolveSessionAccess: (sessionId) => {
            const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
            return stored ? { ok: true as const, value: stored } : { ok: false as const, reason: 'not-found' }
        },
        emitAccessError: () => {},
        onWebappEvent
    })
    return handlers
}

function codexPlan(step: string, status: 'pending' | 'inProgress' | 'completed' = 'inProgress'): unknown {
    return {
        role: 'agent',
        content: {
            type: 'codex',
            data: { type: 'tool-call', name: 'update_plan', input: { plan: [{ step, status }] } }
        }
    }
}

function claudeTaskCall(name: string, input: Record<string, unknown>, id = 'tool-1'): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { content: [{ type: 'tool_use', id, name, input }] }
            }
        }
    }
}

function claudeTaskResult(content: unknown, id = 'tool-1'): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'user',
                message: {
                    content: [{ type: 'tool_result', tool_use_id: id, content }]
                }
            }
        }
    }
}

type TerminalEmittedEvent = {
    event: string
    data: unknown
}

class TerminalFakeSocket {
    readonly id: string
    readonly data: Record<string, unknown> = {}
    readonly emitted: TerminalEmittedEvent[] = []
    private readonly handlers = new Map<string, (...args: unknown[]) => void>()

    constructor(id: string) {
        this.id = id
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    join(): void {}
    leave(): void {}

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        return true
    }

    trigger(event: string, data?: unknown): void {
        const handler = this.handlers.get(event)
        if (!handler) return
        if (typeof data === 'undefined') handler()
        else handler(data)
    }
}

class TerminalFakeNamespace {
    readonly sockets = new Map<string, TerminalFakeSocket>()
    readonly adapter = { rooms: new Map<string, Set<string>>() }
}

class TerminalFakeServer {
    private readonly namespaces = new Map<string, TerminalFakeNamespace>()

    of(name: string): TerminalFakeNamespace {
        const existing = this.namespaces.get(name)
        if (existing) return existing
        const namespace = new TerminalFakeNamespace()
        this.namespaces.set(name, namespace)
        return namespace
    }
}

function lastTerminalEmit(socket: TerminalFakeSocket, event: string): TerminalEmittedEvent | undefined {
    return [...socket.emitted].reverse().find((entry) => entry.event === event)
}

describe('session model', () => {
    it('stores a projected plan after the source message and emits once', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-live', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        handlers.get('message')?.({ sid: session.id, message: codexPlan('Ship') })

        expect(store.messages.getMessages(session.id)).toHaveLength(1)
        expect(store.sessions.getSession(session.id)?.todos).toEqual([
            { id: 'codex-plan-1', content: 'Ship', status: 'in_progress', priority: 'medium' }
        ])
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(1)
    })

    it('does not advance the session or emit for a duplicate plan snapshot', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-duplicate', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        handlers.get('message')?.({ sid: session.id, message: codexPlan('Ship') })
        const seqAfterFirstSnapshot = store.sessions.getSession(session.id)?.seq
        handlers.get('message')?.({ sid: session.id, message: codexPlan('Ship') })

        expect(store.messages.getMessages(session.id)).toHaveLength(2)
        expect(store.sessions.getSession(session.id)?.seq).toBe(seqAfterFirstSnapshot)
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(1)
    })

    it('does not roll todo projection back when an older local message is retried', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-local-retry', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        handlers.get('message')?.({ sid: session.id, localId: 'local-a', message: codexPlan('Plan A') })
        handlers.get('message')?.({ sid: session.id, localId: 'local-b', message: codexPlan('Plan B') })
        const seqAfterPlanB = store.sessions.getSession(session.id)?.seq
        const todoEventsAfterPlanB = events.filter((event) => event.type === 'session-updated').length

        handlers.get('message')?.({ sid: session.id, localId: 'local-a', message: codexPlan('Plan A') })

        expect(store.messages.getMessages(session.id)).toHaveLength(2)
        expect(store.sessions.getSession(session.id)?.todos).toEqual([
            { id: 'codex-plan-1', content: 'Plan B', status: 'in_progress', priority: 'medium' }
        ])
        expect(store.sessions.getSession(session.id)?.seq).toBe(seqAfterPlanB)
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(todoEventsAfterPlanB)
    })

    it('does not project an unpersisted payload from a duplicate local ID', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-local-payload', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        handlers.get('message')?.({ sid: session.id, localId: 'local-a', message: codexPlan('Persisted') })
        const seqAfterPersist = store.sessions.getSession(session.id)?.seq
        handlers.get('message')?.({ sid: session.id, localId: 'local-a', message: codexPlan('Not persisted') })

        expect(store.messages.getMessages(session.id).map((message) => message.content)).toEqual([
            codexPlan('Persisted')
        ])
        expect(store.sessions.getSession(session.id)?.todos).toEqual([
            { id: 'codex-plan-1', content: 'Persisted', status: 'in_progress', priority: 'medium' }
        ])
        expect(store.sessions.getSession(session.id)?.seq).toBe(seqAfterPersist)
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(1)
    })

    it('stores a malformed source message without changing or emitting todos', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-malformed', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        const warn = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            handlers.get('message')?.({
                sid: session.id,
                message: {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'tool-call',
                            name: 'update_plan',
                            input: { plan: [{ step: '', status: 'pending' }] }
                        }
                    }
                }
            })

            expect(warn).toHaveBeenCalledWith('Ignored codex session todo update: invalid update_plan snapshot')
        } finally {
            warn.mockRestore()
        }

        expect(store.messages.getMessages(session.id)).toHaveLength(1)
        expect(store.sessions.getSession(session.id)?.todos).toBeNull()
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(0)
    })

    it('uses monotonic todo timestamps for two changed messages in the same millisecond', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-same-millisecond', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))
        const originalNow = Date.now
        const fixedNow = originalNow()

        try {
            Date.now = () => fixedNow
            handlers.get('message')?.({ sid: session.id, message: codexPlan('First') })
            const firstUpdatedAt = store.sessions.getSession(session.id)?.todosUpdatedAt
            handlers.get('message')?.({ sid: session.id, message: codexPlan('Second') })

            expect(store.sessions.getSession(session.id)?.todos).toEqual([
                { id: 'codex-plan-1', content: 'Second', status: 'in_progress', priority: 'medium' }
            ])
            expect(store.sessions.getSession(session.id)?.todosUpdatedAt).toBe((firstUpdatedAt ?? 0) + 1)
            expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(2)
        } finally {
            Date.now = originalNow
        }
    })

    it('correlates a live Claude task result with its stored call', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession('task-claude-live', {}, null, 'default')
        const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

        handlers.get('message')?.({
            sid: session.id,
            message: claudeTaskCall('TaskCreate', { subject: 'Requested', activeForm: 'Creating' })
        })
        handlers.get('message')?.({
            sid: session.id,
            message: claudeTaskResult(JSON.stringify({ task: { id: '42', subject: 'Created' } }))
        })

        expect(store.messages.getMessages(session.id)).toHaveLength(2)
        expect(store.sessions.getSession(session.id)?.todos).toEqual([{
            id: '42',
            content: 'Created',
            activeForm: 'Creating',
            status: 'pending',
            priority: 'medium'
        }])
        expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(1)
    })

    it('backfills todos by replaying the latest 200 messages without changing team state', () => {
        const store = new Store(':memory:')
        const stored = store.sessions.getOrCreateSession('task-backfill', {}, null, 'default')
        const teamState = { teamName: 'Keep me', tasks: [{ id: 'team-1', title: 'Team task' }] }
        store.sessions.setSessionTeamState(stored.id, teamState, 10, 'default')
        store.messages.addMessage(stored.id, codexPlan('Outside replay window'))
        for (let index = 0; index < 198; index += 1) {
            store.messages.addMessage(stored.id, { role: 'agent', content: { type: 'text', text: `filler-${index}` } })
        }
        store.messages.addMessage(stored.id, claudeTaskCall('TaskCreate', { subject: 'Requested' }, 'backfill-call'))
        store.messages.addMessage(
            stored.id,
            claudeTaskResult(JSON.stringify({ task: { id: 'backfill-1', subject: 'Recovered' } }), 'backfill-call')
        )
        const events: SyncEvent[] = []

        const reloaded = new SessionCache(store, createPublisher(events)).refreshSession(stored.id)

        expect(store.messages.getMessages(stored.id, 200)).toHaveLength(200)
        expect(reloaded?.todos).toEqual([{
            id: 'backfill-1',
            content: 'Recovered',
            status: 'pending',
            priority: 'medium'
        }])
        expect(store.sessions.getSession(stored.id)?.teamState).toEqual(teamState)
    })

    it('includes explicit model in session summaries', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-summary',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4'
        )

        expect(session.model).toBe('gpt-5.4')
        expect(toSessionSummary(session).model).toBe('gpt-5.4')
        expect(toSessionSummary(session).effort).toBeNull()
    })

    it('includes explicit effort in session summaries', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-effort-summary',
            { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
            null,
            'default',
            'sonnet',
            'high'
        )

        expect(session.effort).toBe('high')
        expect(toSessionSummary(session).effort).toBe('high')
    })

    it('persists explicit model reasoning effort on Codex sessions', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-reasoning-effort',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4',
            undefined,
            'xhigh'
        )

        expect(session.modelReasoningEffort).toBe('xhigh')
        expect(store.sessions.getSession(session.id)?.modelReasoningEffort).toBe('xhigh')
    })

    it('preserves model from old session when merging into resumed session', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const oldSession = cache.getOrCreateSession(
            'session-model-old',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4'
        )
        const newSession = cache.getOrCreateSession(
            'session-model-new',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.model).toBe('gpt-5.4')
    })

    it('keeps the newer todo snapshot when merging sessions', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const source = cache.getOrCreateSession(
            'session-todos-old',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const target = cache.getOrCreateSession(
            'session-todos-new',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const olderTodos: TodoItem[] = [{
            id: 'old', content: 'Old task', status: 'pending', priority: 'medium'
        }]
        const newerTodos: TodoItem[] = [{
            id: 'new', content: 'New task', status: 'completed', priority: 'high'
        }]
        expect(store.sessions.setSessionTodos(source.id, olderTodos, 100, 'default')).toBe('applied')
        expect(store.sessions.setSessionTodos(target.id, newerTodos, 200, 'default')).toBe('applied')

        await cache.mergeSessions(source.id, target.id, 'default')

        expect(cache.getSession(target.id)?.todos).toEqual(newerTodos)
        expect(store.sessions.getSession(target.id)).toMatchObject({
            todos: newerTodos,
            todosUpdatedAt: 200
        })
    })

    it('persists applied session model updates, including clear-to-auto', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-config',
            { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
            null,
            'default',
            'sonnet'
        )

        cache.applySessionConfig(session.id, { model: 'opus[1m]' })
        expect(cache.getSession(session.id)?.model).toBe('opus[1m]')
        expect(store.sessions.getSession(session.id)?.model).toBe('opus[1m]')

        cache.applySessionConfig(session.id, { model: null })
        expect(cache.getSession(session.id)?.model).toBeNull()
        expect(store.sessions.getSession(session.id)?.model).toBeNull()
    })

    it('persists keepalive model changes, including clearing the model', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-heartbeat',
            { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
            null,
            'default',
            'sonnet'
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            model: null
        })

        expect(cache.getSession(session.id)?.model).toBeNull()
        expect(store.sessions.getSession(session.id)?.model).toBeNull()
    })

    it('persists applied session effort updates, including clear-to-auto', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-effort-config',
            { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
            null,
            'default',
            'sonnet',
            'medium'
        )

        cache.applySessionConfig(session.id, { effort: 'max' })
        expect(cache.getSession(session.id)?.effort).toBe('max')
        expect(store.sessions.getSession(session.id)?.effort).toBe('max')

        cache.applySessionConfig(session.id, { effort: null })
        expect(cache.getSession(session.id)?.effort).toBeNull()
        expect(store.sessions.getSession(session.id)?.effort).toBeNull()
    })

    it('persists applied session model reasoning effort updates, including clear-to-default', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-reasoning-config',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4',
            undefined,
            'high'
        )

        cache.applySessionConfig(session.id, { modelReasoningEffort: 'xhigh' })
        expect(cache.getSession(session.id)?.modelReasoningEffort).toBe('xhigh')
        expect(store.sessions.getSession(session.id)?.modelReasoningEffort).toBe('xhigh')

        cache.applySessionConfig(session.id, { modelReasoningEffort: null })
        expect(cache.getSession(session.id)?.modelReasoningEffort).toBeNull()
        expect(store.sessions.getSession(session.id)?.modelReasoningEffort).toBeNull()
    })

    it('persists keepalive effort changes, including clearing the effort', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-effort-heartbeat',
            { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
            null,
            'default',
            'sonnet',
            'high'
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            effort: null
        })

        expect(cache.getSession(session.id)?.effort).toBeNull()
        expect(store.sessions.getSession(session.id)?.effort).toBeNull()
    })

    it('persists keepalive model reasoning effort changes, including clearing the value', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-reasoning-heartbeat',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4',
            undefined,
            'high'
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            modelReasoningEffort: null
        })

        expect(cache.getSession(session.id)?.modelReasoningEffort).toBeNull()
        expect(store.sessions.getSession(session.id)?.modelReasoningEffort).toBeNull()
    })

    it('tracks collaboration mode updates in memory from config and keepalive', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-collaboration-mode',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default',
            'gpt-5.4'
        )

        cache.applySessionConfig(session.id, { collaborationMode: 'plan' })
        expect(cache.getSession(session.id)?.collaborationMode).toBe('plan')

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            collaborationMode: 'default'
        })
        expect(cache.getSession(session.id)?.collaborationMode).toBe('default')
    })

    it('touches session updatedAt when new message activity is recorded', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-message-activity',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const activityAt = session.updatedAt + 60_000

        cache.recordSessionActivity(session.id, activityAt)

        expect(store.sessions.getSession(session.id)?.updatedAt).toBe(activityAt)
        expect(cache.getSession(session.id)?.updatedAt).toBe(activityAt)
        expect(events).toContainEqual({
            type: 'session-updated',
            sessionId: session.id,
            namespace: 'default',
            data: { updatedAt: activityAt }
        })
    })

    it('touches session updatedAt when web sends a message through sync engine', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            { of: () => ({ to: () => ({ emit() {} }) }) } as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-web-message-activity',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                null,
                'default'
            )
            const before = store.sessions.getSession(session.id)?.updatedAt ?? 0

            await new Promise((resolve) => setTimeout(resolve, 2))
            await engine.sendMessage(session.id, { text: 'hello' })

            const after = store.sessions.getSession(session.id)?.updatedAt ?? 0
            expect(after).toBeGreaterThan(before)
            expect(engine.getSession(session.id)?.updatedAt).toBe(after)
        } finally {
            engine.stop()
        }
    })

    it('reports session activity when CLI receives a turn-ready event over socket', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession(
            'session-cli-message-activity',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const handlers = new Map<string, (payload: unknown) => void>()
        const activity: Array<{ sessionId: string; updatedAt: number }> = []

        registerSessionHandlers({
            on: (event: string, handler: (payload: unknown) => void) => {
                handlers.set(event, handler)
            },
            to: () => ({ emit() {} })
        } as never, {
            store,
            resolveSessionAccess: (sessionId) => {
                const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
                return stored ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => {},
            onSessionActivity: (sessionId, updatedAt) => {
                activity.push({ sessionId, updatedAt })
            }
        })

        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: {
                    type: 'event',
                    data: { type: 'ready' }
                }
            })
        })

        expect(activity).toHaveLength(1)
        expect(activity[0].sessionId).toBe(session.id)
        expect(activity[0].updatedAt).toBe(store.messages.getMessages(session.id, 1)[0]?.createdAt)
    })

    it('passes plain CLI agent text to the Team auto-report bridge', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession(
            'session-cli-team-auto-report',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const handlers = new Map<string, (payload: unknown) => void>()
        const agentTexts: Array<{ namespace: string; sessionId: string; text: string; requestId?: string | null }> = []

        registerSessionHandlers({
            on: (event: string, handler: (payload: unknown) => void) => {
                handlers.set(event, handler)
            },
            to: () => ({ emit() {} })
        } as never, {
            store,
            resolveSessionAccess: (sessionId) => {
                const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
                return stored ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => {},
            onAgentTextMessage: (input) => {
                agentTexts.push(input)
            }
        })

        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: '[HAPI_TEAM_MENTION] hello' },
            meta: {
                sentFrom: 'team-chat',
                teamMentionRequestId: 'request-1',
                teamChatId: 'team-1',
                sourceMessageId: 'message-1'
            }
        })

        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'message',
                        message: 'Reply from SIM to Team Chat'
                    }
                }
            })
        })

        expect(agentTexts).toEqual([{
            namespace: 'default',
            sessionId: session.id,
            text: 'Reply from SIM to Team Chat',
            requestId: 'request-1'
        }])
    })

    it('passes Codex data.text agent replies to the Team auto-report bridge', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'session-cli-team-auto-report-text',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const handlers = new Map<string, (payload: unknown) => void>()
        const agentTexts: string[] = []

        registerSessionHandlers({
            on: (event: string, handler: (payload: unknown) => void) => {
                handlers.set(event, handler)
            },
            to: () => ({ emit() {} })
        } as never, {
            store,
            resolveSessionAccess: (sessionId) => {
                const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
                return stored ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => {},
            onAgentTextMessage: (input) => {
                agentTexts.push(input.text)
            }
        })

        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: '[HAPI_TEAM_MENTION] hello' },
            meta: { sentFrom: 'team-chat', teamMentionRequestId: 'request-text', teamChatId: 'team-1', sourceMessageId: 'message-1' }
        })

        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: { type: 'codex', data: { type: 'message', text: 'Reply from data.text' } }
            })
        })

        expect(agentTexts).toEqual(['Reply from data.text'])
    })

    it('does not auto-report plain agent text when latest user turn is not a Team mention', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const session = cache.getOrCreateSession(
            'session-cli-private-after-team-mention',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const handlers = new Map<string, (payload: unknown) => void>()
        const agentTexts: Array<{ namespace: string; sessionId: string; text: string; requestId?: string | null }> = []

        registerSessionHandlers({
            on: (event: string, handler: (payload: unknown) => void) => {
                handlers.set(event, handler)
            },
            to: () => ({ emit() {} })
        } as never, {
            store,
            resolveSessionAccess: (sessionId) => {
                const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
                return stored ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => {},
            onAgentTextMessage: (input) => {
                agentTexts.push(input)
            }
        })

        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: '[HAPI_TEAM_MENTION] hello' },
            meta: { sentFrom: 'team-chat', teamMentionRequestId: 'request-1', teamChatId: 'team-1', sourceMessageId: 'message-1' }
        })
        store.messages.addMessage(session.id, {
            role: 'user',
            content: { type: 'text', text: 'private follow-up' },
            meta: { sentFrom: 'webapp' }
        })

        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: { type: 'codex', data: { type: 'message', message: 'Private reply' } }
            })
        })

        expect(agentTexts).toEqual([])
    })

    it('does not report session activity for CLI tool messages', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const session = cache.getOrCreateSession(
            'session-cli-tool-activity',
            { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
            null,
            'default'
        )
        const handlers = new Map<string, (payload: unknown) => void>()
        const activity: Array<{ sessionId: string; updatedAt: number }> = []

        registerSessionHandlers({
            on: (event: string, handler: (payload: unknown) => void) => {
                handlers.set(event, handler)
            },
            to: () => ({ emit() {} })
        } as never, {
            store,
            resolveSessionAccess: (sessionId) => {
                const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
                return stored ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => {},
            onSessionActivity: (sessionId, updatedAt) => {
                activity.push({ sessionId, updatedAt })
            }
        })

        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call',
                        name: 'CodexBash',
                        callId: 'call-1',
                        input: { cmd: 'date' }
                    }
                }
            })
        })
        handlers.get('message')?.({
            sid: session.id,
            message: JSON.stringify({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call-result',
                        callId: 'call-1',
                        output: { stdout: 'Sat Apr 25' }
                    }
                }
            })
        })

        expect(activity).toHaveLength(0)
    })

    it('marks archived session inactive immediately while kill is still pending and calls terminal close-all', async () => {
        const store = new Store(':memory:')
        const closeAllCalls: Array<{ namespace: string; sessionId: string }> = []
        let resolveKill!: () => void
        const pendingKill = new Promise<void>((resolve) => {
            resolveKill = resolve
        })
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            (input) => {
                closeAllCalls.push(input)
            }
        )

        try {
            const session = engine.getOrCreateSession(
                'session-archive-race',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                null,
                'team-a'
            )
            engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            expect(engine.getSession(session.id)?.active).toBe(true)
            ;(engine as any).rpcGateway.killSession = () => pendingKill

            const archivePromise = engine.archiveSession(session.id)

            expect(engine.getSession(session.id)?.active).toBe(false)
            expect(closeAllCalls).toEqual([{ namespace: 'team-a', sessionId: session.id }])

            resolveKill()
            await archivePromise
            expect(engine.getSession(session.id)?.active).toBe(false)
        } finally {
            engine.stop()
        }
    })

    it('rejects terminal create through handler while archive kill is still pending', async () => {
        const store = new Store(':memory:')
        let resolveKill!: () => void
        const pendingKill = new Promise<void>((resolve) => {
            resolveKill = resolve
        })
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            () => {}
        )
        const io = new TerminalFakeServer()
        const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
        const terminalSocket = new TerminalFakeSocket('terminal-socket')
        terminalSocket.data.namespace = 'team-a'
        const cliSocket = new TerminalFakeSocket('cli-socket')
        cliSocket.data.namespace = 'team-a'
        const cliNamespace = io.of('/cli')
        cliNamespace.sockets.set(cliSocket.id, cliSocket)
        cliNamespace.adapter.rooms.set('session:session-archive-handler-race', new Set([cliSocket.id]))

        try {
            const session = engine.getOrCreateSession(
                'session-archive-handler-race',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                null,
                'team-a'
            )
            engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            registerTerminalHandlers(terminalSocket as unknown as SocketWithData, {
                io: io as unknown as SocketServer,
                getSession: (sessionId) => engine.getSession(sessionId) ?? null,
                getMachine: () => null,
                terminalRegistry,
                maxTerminalsPerSocket: 4,
                maxTerminalsPerSession: 3,
                capabilityResolver: () => 'manage'
            })
            ;(engine as any).rpcGateway.killSession = () => pendingKill

            const archivePromise = engine.archiveSession(session.id)
            terminalSocket.trigger('terminal:create', {
                sessionId: session.id,
                terminalId: 'terminal-after-archive',
                cols: 80,
                rows: 24
            })

            expect(lastTerminalEmit(terminalSocket, 'terminal:error')?.data).toEqual({
                terminalId: 'terminal-after-archive',
                message: 'Session is inactive or unavailable.'
            })
            expect(lastTerminalEmit(cliSocket, 'terminal:open')).toBeUndefined()

            resolveKill()
            await archivePromise
        } finally {
            engine.stop()
        }
    })

    it('keeps archive best-effort when terminal cleanup and kill throw after early inactive', async () => {
        const store = new Store(':memory:')
        let closeAllCalls = 0
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            () => {
                closeAllCalls += 1
                throw new Error('close-all failed')
            }
        )

        try {
            const session = engine.getOrCreateSession(
                'session-archive-offline',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                null,
                'team-a'
            )
            engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            ;(engine as any).rpcGateway.killSession = async () => {
                throw new Error('CLI offline')
            }

            await engine.archiveSession(session.id)

            expect(closeAllCalls).toBe(1)
            expect(engine.getSession(session.id)?.active).toBe(false)
        } finally {
            engine.stop()
        }
    })

    it('passes the stored model when respawning a resumed session', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-model-resume',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexSessionId: 'codex-thread-1'
                },
                null,
                'default',
                'gpt-5.4'
            )
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            let capturedModel: string | undefined
            let capturedModelReasoningEffort: string | undefined
            let capturedEffort: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                _machineId: string,
                _directory: string,
                _agent: string,
                model?: string,
                modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: string,
                _worktreeName?: string,
                _resumeSessionId?: string,
                effort?: string
            ) => {
                capturedModel = model
                capturedModelReasoningEffort = modelReasoningEffort
                capturedEffort = effort
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedModel).toBe('gpt-5.4')
            expect(capturedModelReasoningEffort).toBeUndefined()
            expect(capturedEffort).toBeUndefined()
        } finally {
            engine.stop()
        }
    })

    it('passes the stored model reasoning effort when respawning a resumed Codex session', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-model-reasoning-resume',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexSessionId: 'codex-thread-1'
                },
                null,
                'default',
                'gpt-5.4',
                undefined,
                'xhigh'
            )
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            let capturedModelReasoningEffort: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                _machineId: string,
                _directory: string,
                _agent: string,
                _model?: string,
                modelReasoningEffort?: string
            ) => {
                capturedModelReasoningEffort = modelReasoningEffort
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedModelReasoningEffort).toBe('xhigh')
        } finally {
            engine.stop()
        }
    })

    it('passes resume session ID to rpc gateway when resuming claude session', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-claude-resume',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'claude',
                    claudeSessionId: 'claude-session-1'
                },
                null,
                'default',
                'sonnet'
            )
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            let capturedResumeSessionId: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                _machineId: string,
                _directory: string,
                _agent: string,
                _model?: string,
                _modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                resumeSessionId?: string
            ) => {
                capturedResumeSessionId = resumeSessionId
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedResumeSessionId).toBe('claude-session-1')
        } finally {
            engine.stop()
        }
    })

    it('passes resume session ID to rpc gateway when resuming a grok session', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-grok-resume',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'grok',
                    grokSessionId: 'grok-session-1'
                },
                null,
                'default'
            )
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            let capturedResumeSessionId: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                _machineId: string,
                _directory: string,
                _agent: string,
                _model?: string,
                _modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                resumeSessionId?: string
            ) => {
                capturedResumeSessionId = resumeSessionId
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedResumeSessionId).toBe('grok-session-1')
        } finally {
            engine.stop()
        }
    })

    it('passes the cached permissionMode when respawning a resumed session', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        try {
            const session = engine.getOrCreateSession(
                'session-permission-resume',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'claude',
                    claudeSessionId: 'claude-session-perm'
                },
                null,
                'default',
                'sonnet'
            )
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            engine.handleSessionAlive({
                sid: session.id,
                permissionMode: 'bypassPermissions',
                time: Date.now()
            })
            engine.handleSessionEnd({ sid: session.id, time: Date.now() })

            let capturedPermissionMode: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                _machineId: string,
                _directory: string,
                _agent: string,
                _model?: string,
                _modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: string,
                _worktreeName?: string,
                _resumeSessionId?: string,
                _effort?: string,
                permissionMode?: string
            ) => {
                capturedPermissionMode = permissionMode
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedPermissionMode).toBe('bypassPermissions')
        } finally {
            engine.stop()
        }
    })

    describe('session dedup by agent session ID', () => {
        it('merges duplicate when codexSessionId collides', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'default'
            )

            // Add a message to s1
            store.messages.addMessage(s1.id, { type: 'text', text: 'hello from s1' }, 'local-1')

            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'default'
            )

            expect(s1.id).not.toBe(s2.id)

            await cache.deduplicateByAgentSessionId(s2.id)

            expect(cache.getSession(s1.id)).toBeUndefined()
            expect(cache.getSession(s2.id)).toBeDefined()

            const messages = store.messages.getMessages(s2.id, 100)
            expect(messages.length).toBeGreaterThanOrEqual(1)
        })

        it('preserves sessions with different agent session IDs', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'default'
            )
            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-Y' },
                null,
                'default'
            )

            await cache.deduplicateByAgentSessionId(s2.id)

            expect(cache.getSession(s1.id)).toBeDefined()
            expect(cache.getSession(s2.id)).toBeDefined()
        })

        it('does not merge across namespaces', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'ns1'
            )
            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'ns2'
            )

            await cache.deduplicateByAgentSessionId(s2.id)

            expect(cache.getSession(s1.id)).toBeDefined()
            expect(cache.getSession(s2.id)).toBeDefined()
        })

        it('no-op when session has no agent session ID', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                null,
                'default'
            )

            await cache.deduplicateByAgentSessionId(s1.id)

            expect(cache.getSession(s1.id)).toBeDefined()
        })

        it('does not move history while duplicate sessions are both active', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                {
                    requests: { 'req-from-active-duplicate': { tool: 'Bash', arguments: {} } },
                    completedRequests: {}
                },
                'default'
            )

            store.messages.addMessage(s1.id, { type: 'text', text: 'history from s1' }, 'local-s1')
            cache.handleSessionAlive({ sid: s1.id, time: Date.now(), thinking: false })

            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                {
                    requests: { 'req-from-target': { tool: 'Read', arguments: {} } },
                    completedRequests: {}
                },
                'default'
            )
            store.messages.addMessage(s2.id, { type: 'text', text: 'history from s2' }, 'local-s2')
            cache.handleSessionAlive({ sid: s2.id, time: Date.now() + 1000, thinking: false })

            await cache.deduplicateByAgentSessionId(s2.id)

            // Both live session records keep their own histories until one of the
            // duplicates becomes inactive. The web may still be showing either
            // active session id, so the hub must not pick a canonical target yet.
            expect(cache.getSession(s1.id)).toBeDefined()
            expect(cache.getSession(s2.id)).toBeDefined()
            expect(store.messages.getMessages(s1.id, 100).map((message) => (message.content as { text?: string }).text)).toEqual([
                'history from s1'
            ])
            expect(store.messages.getMessages(s2.id, 100).map((message) => (message.content as { text?: string }).text)).toEqual([
                'history from s2'
            ])
            expect(events.some((event) => event.type === 'messages-invalidated')).toBe(false)

            const sourceRequests = cache.getSession(s1.id)?.agentState?.requests ?? {}
            const targetRequests = cache.getSession(s2.id)?.agentState?.requests ?? {}
            expect(sourceRequests['req-from-active-duplicate']).toBeDefined()
            expect(targetRequests['req-from-active-duplicate']).toBeUndefined()
            expect(targetRequests['req-from-target']).toBeDefined()
        })

        it('invalidates both sessions for history-only merges', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                {
                    requests: { 'req-from-source': { tool: 'Bash', arguments: {} } },
                    completedRequests: {}
                },
                'default'
            )
            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
                {
                    requests: { 'req-from-target': { tool: 'Read', arguments: {} } },
                    completedRequests: {}
                },
                'default'
            )

            store.messages.addMessage(s1.id, { type: 'text', text: 'history from s1' }, 'local-s1')
            store.messages.addMessage(s2.id, { type: 'text', text: 'history from s2' }, 'local-s2')

            await cache.mergeSessionHistory(s1.id, s2.id, 'default', { mergeAgentState: false })

            expect(store.messages.getMessages(s1.id, 100)).toHaveLength(0)
            expect(store.messages.getMessages(s2.id, 100).map((message) => (message.content as { text?: string }).text)).toEqual([
                'history from s1',
                'history from s2'
            ])
            expect(events).toContainEqual({ type: 'messages-invalidated', sessionId: s1.id, namespace: 'default' })
            expect(events).toContainEqual({ type: 'messages-invalidated', sessionId: s2.id, namespace: 'default' })

            const sourceRequests = cache.getSession(s1.id)?.agentState?.requests ?? {}
            const targetRequests = cache.getSession(s2.id)?.agentState?.requests ?? {}
            expect(sourceRequests['req-from-source']).toBeDefined()
            expect(targetRequests['req-from-source']).toBeUndefined()
            expect(targetRequests['req-from-target']).toBeDefined()
        })

        it('merges duplicate after it becomes inactive via session-end', async () => {
            const store = new Store(':memory:')
            const engine = new SyncEngine(
                store,
                {} as never,
                new RpcRegistry(),
                { broadcast() {} } as never
            )

            try {
                const s1 = engine.getOrCreateSession(
                    'tag-1',
                    { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                    null,
                    'default'
                )
                const s2 = engine.getOrCreateSession(
                    'tag-2',
                    { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                    null,
                    'default'
                )

                // Mark s1 as active
                engine.handleSessionAlive({ sid: s1.id, time: Date.now() })

                // s1 is active, so dedup keeps its live record around
                const events: SyncEvent[] = []
                const cache = (engine as any).sessionCache as SessionCache
                await cache.deduplicateByAgentSessionId(s2.id)
                expect(cache.getSession(s1.id)).toBeDefined()

                // Now s1 ends — handleSessionEnd should trigger dedup retry
                engine.handleSessionEnd({ sid: s1.id, time: Date.now() })

                // Give the fire-and-forget dedup a tick to complete
                await new Promise((r) => setTimeout(r, 50))

                // One of them should be merged away
                const s1Exists = cache.getSession(s1.id)
                const s2Exists = cache.getSession(s2.id)
                expect(!s1Exists || !s2Exists).toBe(true)
            } finally {
                engine.stop()
            }
        })

        it('merges duplicate after inactivity timeout expires it', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'default'
            )
            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                null,
                'default'
            )

            // Mark both duplicates active. The older live record should keep
            // existing while active, because its socket may still send keepalives.
            const now = Date.now()
            cache.handleSessionAlive({ sid: s1.id, time: now })
            cache.handleSessionAlive({ sid: s2.id, time: now })

            // s1 is active — dedup only moves history and keeps the record.
            await cache.deduplicateByAgentSessionId(s2.id)
            expect(cache.getSession(s1.id)).toBeDefined()
            expect(cache.getSession(s2.id)).toBeDefined()

            // Simulate only s1 passing beyond the 30s timeout.
            cache.getSession(s1.id)!.activeAt = now - 31_000
            const expired = cache.expireInactive(now)
            expect(expired).toContain(s1.id)
            expect(expired).not.toContain(s2.id)

            // Now s1 is inactive — dedup should merge it
            await cache.deduplicateByAgentSessionId(s2.id)
            // Exactly one session should survive after dedup; which one is the
            // target depends on activeAt/updatedAt ordering, which can vary by
            // millisecond timing in CI.
            const remaining = [cache.getSession(s1.id), cache.getSession(s2.id)].filter(Boolean)
            expect(remaining).toHaveLength(1)
        })

        it('deep-merges agentState and filters completed requests', async () => {
            const store = new Store(':memory:')
            const events: SyncEvent[] = []
            const cache = new SessionCache(store, createPublisher(events))

            const s1 = cache.getOrCreateSession(
                'tag-1',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                {
                    requests: {
                        'req-1': { tool: 'Bash', arguments: {} },
                        'req-2': { tool: 'Bash', arguments: {} }
                    },
                    completedRequests: {}
                },
                'default'
            )
            const s2 = cache.getOrCreateSession(
                'tag-2',
                { path: '/tmp/project', host: 'localhost', flavor: 'codex', codexSessionId: 'thread-X' },
                {
                    requests: {
                        'req-3': { tool: 'Bash', arguments: {} }
                    },
                    completedRequests: {
                        'req-1': { tool: 'Bash', arguments: {}, status: 'approved' }
                    }
                },
                'default'
            )

            await cache.deduplicateByAgentSessionId(s2.id)

            const session = cache.getSession(s2.id)
            expect(session).toBeDefined()
            const state = session!.agentState!

            // req-1 was completed in s2 — should NOT appear in requests
            expect(state.requests?.['req-1']).toBeUndefined()
            // req-2 and req-3 are still pending
            expect(state.requests?.['req-2']).toBeDefined()
            expect(state.requests?.['req-3']).toBeDefined()
            // completedRequests has req-1
            expect(state.completedRequests?.['req-1']).toBeDefined()
        })
    })
})

describe('crash recovery flow', () => {
    it('markThreadCrashed sets session inactive without setting session end reason', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'crash-test',
            { path: '/tmp/test', host: 'test', flavor: 'codex', codexSessionId: 'cs-1' },
            {},
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now() })
        expect(cache.getSession(session.id)?.active).toBe(true)

        cache.markThreadCrashed(session.id)
        expect(cache.getSession(session.id)?.active).toBe(false)

        const updateEvents = events.filter(e => e.type === 'session-updated' && e.sessionId === session.id)
        const lastUpdate = updateEvents[updateEvents.length - 1]
        expect((lastUpdate as any)?.data).toMatchObject({ active: false, thinking: false })
    })

    it('is a no-op when session is already inactive', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'inactive-test',
            { path: '/tmp/test', host: 'test', flavor: 'codex' },
            {},
            'default'
        )
        const eventCountBefore = events.length
        cache.markThreadCrashed(session.id)
        expect(events.length).toBe(eventCountBefore)
    })

    it('is a no-op for non-existent session', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const eventCountBefore = events.length
        cache.markThreadCrashed('non-existent-id')
        expect(events.length).toBe(eventCountBefore)
    })

    it('markThreadCrashed then handleSessionAlive makes session active again', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'crash-reactivate',
            { path: '/tmp/test', host: 'test', flavor: 'codex', codexSessionId: 'cs-ra' },
            {},
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now() })
        expect(cache.getSession(session.id)?.active).toBe(true)

        cache.markThreadCrashed(session.id)
        expect(cache.getSession(session.id)?.active).toBe(false)

        // In production stopKeepAlive() prevents this, but at the SessionCache
        // unit level, handleSessionAlive will re-activate a crashed session.
        // This tests that markThreadCrashed doesn't permanently lock the session.
        cache.handleSessionAlive({ sid: session.id, time: Date.now() })
        expect(cache.getSession(session.id)?.active).toBe(true)
    })

    it('session-end with terminated blocks auto-resume but crash does not', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'crash-vs-end',
            { path: '/tmp/test', host: 'test', flavor: 'codex', codexSessionId: 'cs-ve', machineId: 'm1' },
            {},
            'default'
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now() })

        // After crash: session is inactive, ready for auto-resume
        cache.markThreadCrashed(session.id)
        expect(cache.getSession(session.id)?.active).toBe(false)

        // After end: session is inactive. At SyncEngine level,
        // handleSessionEnd would set sessionEndReasons='terminated' → blocks auto-resume.
        // At SessionCache level, both paths just set active=false.
        cache.handleSessionAlive({ sid: session.id, time: Date.now() })
        cache.handleSessionEnd({ sid: session.id, time: Date.now() })
        expect(cache.getSession(session.id)?.active).toBe(false)
    })

    describe('handleSessionCrashed with upstream API corruption', () => {
        const codexError = JSON.stringify({
            error: {
                message: '[400]: {"type":"error","error":{"type":"invalid_request_error","message":"invalid params, messages.19.content.1.tool_use.input: Input should be a valid dictionary (2013)"}}',
                type: 'invalid_request_error',
                code: 'bad_request'
            }
        })

        function setupCodexSession(): { store: Store; engine: SyncEngine; sessionId: string } {
            const store = new Store(':memory:')
            const engine = new SyncEngine(
                store,
                { of: () => ({ to: () => ({ emit() {} }) }) } as never,
                new RpcRegistry(),
                { broadcast() {} } as never
            )
            const session = engine.getOrCreateSession(
                'crash-corrupt',
                { path: '/tmp/test', host: 'test', flavor: 'codex', codexSessionId: 'cs-bad', machineId: 'm1' },
                null,
                'default'
            )
            engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            return { store, engine, sessionId: session.id }
        }

        it('clears codexSessionId when error indicates tool_use.input corruption', () => {
            const { store, engine, sessionId } = setupCodexSession()
            try {
                engine.handleSessionCrashed(sessionId, codexError)

                const stored = store.sessions.getSession(sessionId)
                expect((stored?.metadata as { codexSessionId?: string } | null)?.codexSessionId ?? null).toBeNull()
            } finally {
                engine.stop()
            }
        })

        it('does not clear codexSessionId when error is unrelated (e.g. network)', () => {
            const { store, engine, sessionId } = setupCodexSession()
            try {
                engine.handleSessionCrashed(sessionId, 'Connection reset by peer')

                const stored = store.sessions.getSession(sessionId)
                expect((stored?.metadata as { codexSessionId?: string } | null)?.codexSessionId).toBe('cs-bad')
            } finally {
                engine.stop()
            }
        })

        it('does not clear codexSessionId when error matches only one marker (false positive guard)', () => {
            const { store, engine, sessionId } = setupCodexSession()
            try {
                // Has invalid_request_error but no tool_use.input marker
                engine.handleSessionCrashed(sessionId, 'invalid_request_error: something else')

                const stored = store.sessions.getSession(sessionId)
                expect((stored?.metadata as { codexSessionId?: string } | null)?.codexSessionId).toBe('cs-bad')
            } finally {
                engine.stop()
            }
        })

        it('does nothing when error is missing', () => {
            const { store, engine, sessionId } = setupCodexSession()
            try {
                engine.handleSessionCrashed(sessionId)

                const stored = store.sessions.getSession(sessionId)
                expect((stored?.metadata as { codexSessionId?: string } | null)?.codexSessionId).toBe('cs-bad')
            } finally {
                engine.stop()
            }
        })

        it('marks session inactive regardless of error content', () => {
            const { store, engine, sessionId } = setupCodexSession()
            try {
                engine.handleSessionCrashed(sessionId, 'Any error message')

                const stored = store.sessions.getSession(sessionId)
                expect(stored?.active).toBe(false)
            } finally {
                engine.stop()
            }
        })
    })
})
