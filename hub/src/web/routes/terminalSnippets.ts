import {
    CreateTerminalSnippetInputSchema,
    TerminalSnippetResponseSchema,
    TerminalSnippetSchema,
    TerminalSnippetsResponseSchema,
    UpdateTerminalSnippetInputSchema
} from '@hapi/protocol'
import { Hono, type Context } from 'hono'

import type { SSEManager } from '../../sse/sseManager'
import type { Store, StoredTerminalSnippet } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

function toPublicSnippet(snippet: StoredTerminalSnippet) {
    return TerminalSnippetSchema.parse({
        id: snippet.id,
        name: snippet.name,
        command: snippet.command,
        description: snippet.description,
        createdAt: snippet.createdAt,
        updatedAt: snippet.updatedAt
    })
}

function terminalSnippetErrorResponse(
    c: Context<WebAppEnv>,
    error: unknown
): Response {
    if (error instanceof Error && error.message === 'TERMINAL_SNIPPET_LIMIT_REACHED') {
        return c.json({ error: 'TERMINAL_SNIPPET_LIMIT_REACHED' }, 409)
    }
    if (error instanceof Error && error.message === 'TERMINAL_SNIPPET_NOT_FOUND') {
        return c.json({ error: 'Terminal snippet not found' }, 404)
    }
    throw error
}

export function createTerminalSnippetsRoutes(
    store: Store,
    getSseManager: () => SSEManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const broadcastUpdate = (namespace: string): void => {
        try {
            getSseManager()?.broadcast({
                type: 'terminal-snippets-updated',
                namespace
            })
        } catch {
            // Mutations are already committed; invalidation is best-effort.
        }
    }

    app.get('/terminal-snippets', (c) => {
        const snippets = store.terminalSnippets
            .list(c.get('namespace'))
            .map(toPublicSnippet)
        const response = TerminalSnippetsResponseSchema.parse({ snippets })
        return c.json(response)
    })

    app.post('/terminal-snippets', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = CreateTerminalSnippetInputSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        let storedSnippet: StoredTerminalSnippet
        try {
            storedSnippet = store.terminalSnippets.create({
                namespace,
                ...parsed.data
            })
        } catch (error) {
            return terminalSnippetErrorResponse(c, error)
        }

        const snippet = toPublicSnippet(storedSnippet)
        const response = TerminalSnippetResponseSchema.parse({ snippet })
        broadcastUpdate(namespace)
        return c.json(response, 201)
    })

    app.patch('/terminal-snippets/:id', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = UpdateTerminalSnippetInputSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        let storedSnippet: StoredTerminalSnippet
        try {
            storedSnippet = store.terminalSnippets.update({
                namespace,
                id: c.req.param('id'),
                ...parsed.data
            })
        } catch (error) {
            return terminalSnippetErrorResponse(c, error)
        }

        const snippet = toPublicSnippet(storedSnippet)
        const response = TerminalSnippetResponseSchema.parse({ snippet })
        broadcastUpdate(namespace)
        return c.json(response)
    })

    app.delete('/terminal-snippets/:id', (c) => {
        const namespace = c.get('namespace')
        const deleted = store.terminalSnippets.delete(namespace, c.req.param('id'))
        if (!deleted) {
            return c.json({ error: 'Terminal snippet not found' }, 404)
        }

        broadcastUpdate(namespace)
        return c.json({ ok: true })
    })

    return app
}
