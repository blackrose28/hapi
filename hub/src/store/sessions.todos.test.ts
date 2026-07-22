import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('session todo persistence', () => {
    it('applies a different snapshot at the same timestamp and increments seq once', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('todos', {}, null, 'default')
        const first = [{ id: '1', content: 'One', status: 'pending', priority: 'medium' }]
        const second = [{ id: '2', content: 'Two', status: 'completed', priority: 'high' }]

        expect(store.sessions.setSessionTodos(session.id, first, 100, 'default')).toBe('applied')
        const seqAfterApply = store.sessions.getSession(session.id)?.seq

        expect(store.sessions.setSessionTodos(session.id, second, 100, 'default')).toBe('applied')
        expect(store.sessions.getSession(session.id)).toMatchObject({
            todos: second,
            todosUpdatedAt: 100,
            seq: (seqAfterApply ?? 0) + 1
        })
    })

    it('keeps seq unchanged for identical snapshots at the same timestamp', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('todos', {}, null, 'default')
        const todos = [{ id: '1', content: 'One', status: 'pending', priority: 'medium' }]

        expect(store.sessions.setSessionTodos(session.id, todos, 100, 'default')).toBe('applied')
        const seqAfterApply = store.sessions.getSession(session.id)?.seq

        expect(store.sessions.setSessionTodos(session.id, todos, 100, 'default')).toBe('unchanged')
        expect(store.sessions.getSession(session.id)?.seq).toBe(seqAfterApply)
    })

    it.each([
        ['identical', [{ id: '1', content: 'One', status: 'pending', priority: 'medium' }]],
        ['different', [{ id: '2', content: 'Two', status: 'completed', priority: 'high' }]]
    ])('rejects an older %s snapshot without incrementing seq', (_label, olderTodos) => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('todos', {}, null, 'default')
        const current = [{ id: '1', content: 'One', status: 'pending', priority: 'medium' }]

        expect(store.sessions.setSessionTodos(session.id, current, 100, 'default')).toBe('applied')
        const seqAfterApply = store.sessions.getSession(session.id)?.seq

        expect(store.sessions.setSessionTodos(session.id, olderTodos, 99, 'default')).toBe('stale')
        expect(store.sessions.getSession(session.id)).toMatchObject({
            todos: current,
            todosUpdatedAt: 100,
            seq: seqAfterApply
        })
    })

    it('returns error for a missing session', () => {
        const store = new Store(':memory:')

        expect(store.sessions.setSessionTodos('missing', [], 102, 'default')).toBe('error')
    })
})
