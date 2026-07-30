import { describe, expect, it } from 'bun:test'
import {
    TERMINAL_SNIPPET_COMMAND_MAX_LENGTH,
    TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH,
    TERMINAL_SNIPPET_NAME_MAX_LENGTH,
    TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE,
    TerminalSnippetResponseSchema,
    TerminalSnippetsResponseSchema,
    type SyncEvent
} from '@hapi/protocol'
import { Hono } from 'hono'

import type { SSEManager } from '../../sse/sseManager'
import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createTerminalSnippetsRoutes } from './terminalSnippets'

function createApp(
    namespace: string,
    store: Store,
    getSseManager: () => SSEManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createTerminalSnippetsRoutes(store, getSseManager))
    return app
}

function createSseRecorder(): {
    events: SyncEvent[]
    manager: SSEManager
} {
    const events: SyncEvent[] = []
    return {
        events,
        manager: {
            broadcast(event: SyncEvent) {
                events.push(event)
            }
        } as SSEManager
    }
}

async function jsonRequest(
    app: Hono<WebAppEnv>,
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown
): Promise<Response> {
    return app.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    })
}

describe('terminal snippet routes', () => {
    it('supports namespace-scoped CRUD, normalizes content, preserves create order, and publishes exact invalidations', async () => {
        const store = new Store(':memory:')
        const { events, manager } = createSseRecorder()
        const app = createApp('ns-a', store, () => manager)
        const older = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'Older',
            command: 'echo older',
            description: null,
            now: 100
        })

        const createResponse = await jsonRequest(app, '/api/terminal-snippets', 'POST', {
            name: '  List files  ',
            command: 'find . -type f',
            description: '  Common files  ',
            namespace: 'ns-b',
            id: 'client-controlled',
            createdAt: 1,
            updatedAt: 1
        })
        expect(createResponse.status).toBe(201)
        const createdBody = TerminalSnippetResponseSchema.parse(await createResponse.json())
        expect(createdBody.snippet).toMatchObject({
            name: 'List files',
            command: 'find . -type f',
            description: 'Common files'
        })
        expect(createdBody.snippet.id).not.toBe('client-controlled')
        expect('namespace' in createdBody.snippet).toBe(false)

        const firstListResponse = await app.request('/api/terminal-snippets')
        expect(firstListResponse.status).toBe(200)
        const firstList = TerminalSnippetsResponseSchema.parse(await firstListResponse.json())
        expect(firstList.snippets.map(snippet => snippet.id)).toEqual([
            createdBody.snippet.id,
            older.id
        ])
        expect(firstList.snippets.every(snippet => !('namespace' in snippet))).toBe(true)

        const updateResponse = await jsonRequest(
            app,
            `/api/terminal-snippets/${createdBody.snippet.id}`,
            'PATCH',
            {
                name: '  List tracked files  ',
                command: 'git ls-files',
                description: '   ',
                namespace: 'ns-b',
                id: older.id,
                createdAt: 0,
                updatedAt: 0
            }
        )
        expect(updateResponse.status).toBe(200)
        const updatedBody = TerminalSnippetResponseSchema.parse(await updateResponse.json())
        expect(updatedBody.snippet).toMatchObject({
            id: createdBody.snippet.id,
            name: 'List tracked files',
            command: 'git ls-files',
            description: null,
            createdAt: createdBody.snippet.createdAt
        })
        expect('namespace' in updatedBody.snippet).toBe(false)

        const secondListResponse = await app.request('/api/terminal-snippets')
        const secondList = TerminalSnippetsResponseSchema.parse(await secondListResponse.json())
        expect(secondList.snippets.map(snippet => snippet.id)).toEqual([
            createdBody.snippet.id,
            older.id
        ])

        const deleteResponse = await app.request(
            `/api/terminal-snippets/${createdBody.snippet.id}`,
            { method: 'DELETE' }
        )
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toEqual({ ok: true })
        expect(store.terminalSnippets.list('ns-a').map(snippet => snippet.id)).toEqual([older.id])

        expect(events).toEqual([
            { type: 'terminal-snippets-updated', namespace: 'ns-a' },
            { type: 'terminal-snippets-updated', namespace: 'ns-a' },
            { type: 'terminal-snippets-updated', namespace: 'ns-a' }
        ])
    })

    it('does not expose or mutate snippets owned by another namespace', async () => {
        const store = new Store(':memory:')
        const { events, manager } = createSseRecorder()
        const snippetA = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'A',
            command: 'echo a',
            description: null
        })
        const snippetB = store.terminalSnippets.create({
            namespace: 'ns-b',
            name: 'B',
            command: 'echo b',
            description: null
        })
        const app = createApp('ns-a', store, () => manager)

        const listResponse = await app.request('/api/terminal-snippets')
        const listBody = TerminalSnippetsResponseSchema.parse(await listResponse.json())
        expect(listBody.snippets.map(snippet => snippet.id)).toEqual([snippetA.id])

        const updateResponse = await jsonRequest(
            app,
            `/api/terminal-snippets/${snippetB.id}`,
            'PATCH',
            { name: 'Changed', command: 'echo changed', description: null }
        )
        expect(updateResponse.status).toBe(404)
        expect(await updateResponse.json()).toEqual({ error: 'Terminal snippet not found' })

        const deleteResponse = await app.request(
            `/api/terminal-snippets/${snippetB.id}`,
            { method: 'DELETE' }
        )
        expect(deleteResponse.status).toBe(404)
        expect(await deleteResponse.json()).toEqual({ error: 'Terminal snippet not found' })

        const missingUpdateResponse = await jsonRequest(
            app,
            '/api/terminal-snippets/missing',
            'PATCH',
            { name: 'Missing', command: 'echo missing', description: null }
        )
        expect(missingUpdateResponse.status).toBe(404)

        const missingDeleteResponse = await app.request(
            '/api/terminal-snippets/missing',
            { method: 'DELETE' }
        )
        expect(missingDeleteResponse.status).toBe(404)

        expect(store.terminalSnippets.list('ns-b')).toEqual([snippetB])
        expect(events).toEqual([])
    })

    it('rejects malformed and invalid create bodies without mutation or invalidation', async () => {
        const store = new Store(':memory:')
        const { events, manager } = createSseRecorder()
        const app = createApp('ns-a', store, () => manager)
        const invalidBodies = [
            {},
            { name: '', command: 'echo ok' },
            { name: '   ', command: 'echo ok' },
            { name: 'Valid', command: '' },
            { name: 'Valid', command: '   ' },
            { name: 'n'.repeat(TERMINAL_SNIPPET_NAME_MAX_LENGTH + 1), command: 'echo ok' },
            { name: 'Valid', command: 'c'.repeat(TERMINAL_SNIPPET_COMMAND_MAX_LENGTH + 1) },
            {
                name: 'Valid',
                command: 'echo ok',
                description: 'd'.repeat(TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH + 1)
            }
        ]

        const malformedResponse = await app.request('/api/terminal-snippets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"name":'
        })
        expect(malformedResponse.status).toBe(400)

        for (const body of invalidBodies) {
            const response = await jsonRequest(app, '/api/terminal-snippets', 'POST', body)
            expect(response.status).toBe(400)
        }

        expect(store.terminalSnippets.list('ns-a')).toEqual([])
        expect(events).toEqual([])
    })

    it('rejects an invalid update without changing the snippet or publishing', async () => {
        const store = new Store(':memory:')
        const { events, manager } = createSseRecorder()
        const existing = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'Original',
            command: 'echo original',
            description: null
        })
        const app = createApp('ns-a', store, () => manager)

        const response = await jsonRequest(
            app,
            `/api/terminal-snippets/${existing.id}`,
            'PATCH',
            { name: '   ', command: 'echo changed', description: null }
        )

        expect(response.status).toBe(400)
        expect(store.terminalSnippets.list('ns-a')).toEqual([existing])
        expect(events).toEqual([])
    })

    it('returns a stable conflict code at the namespace quota while another namespace remains independent', async () => {
        const store = new Store(':memory:')
        const { events, manager } = createSseRecorder()
        for (let index = 0; index < TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE; index++) {
            store.terminalSnippets.create({
                namespace: 'ns-a',
                name: `Snippet ${index}`,
                command: `echo ${index}`,
                description: null,
                now: index
            })
        }

        const appA = createApp('ns-a', store, () => manager)
        const rejectedResponse = await jsonRequest(
            appA,
            '/api/terminal-snippets',
            'POST',
            { name: 'One too many', command: 'echo rejected', description: null }
        )
        expect(rejectedResponse.status).toBe(409)
        expect(await rejectedResponse.json()).toEqual({
            error: 'TERMINAL_SNIPPET_LIMIT_REACHED'
        })
        expect(events).toEqual([])

        const appB = createApp('ns-b', store, () => manager)
        const acceptedResponse = await jsonRequest(
            appB,
            '/api/terminal-snippets',
            'POST',
            { name: 'Independent', command: 'echo accepted', description: null }
        )
        expect(acceptedResponse.status).toBe(201)
        expect(events).toEqual([
            { type: 'terminal-snippets-updated', namespace: 'ns-b' }
        ])
    })

    it('allows successful mutations when no SSE manager is available', async () => {
        const store = new Store(':memory:')
        const app = createApp('ns-a', store, () => null)

        const response = await jsonRequest(
            app,
            '/api/terminal-snippets',
            'POST',
            { name: 'No manager', command: 'echo ok', description: null }
        )

        expect(response.status).toBe(201)
        expect(TerminalSnippetResponseSchema.parse(await response.json()).snippet.name).toBe('No manager')
        expect(store.terminalSnippets.list('ns-a')).toHaveLength(1)
    })

    it('keeps a committed mutation successful when broadcasting throws synchronously', async () => {
        const store = new Store(':memory:')
        let broadcastCalls = 0
        const manager = {
            broadcast(_event: SyncEvent): void {
                broadcastCalls += 1
                throw new Error('notification failed')
            }
        } as SSEManager
        const app = createApp('ns-a', store, () => manager)

        const response = await jsonRequest(
            app,
            '/api/terminal-snippets',
            'POST',
            { name: 'Committed', command: 'echo committed', description: null }
        )

        expect(response.status).toBe(201)
        expect(store.terminalSnippets.list('ns-a')).toHaveLength(1)
        expect(broadcastCalls).toBe(1)
    })
})
