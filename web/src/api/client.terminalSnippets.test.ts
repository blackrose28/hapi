import type { TerminalSnippet } from '@hapi/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, deriveApiCacheScope } from './client'

function snippet(overrides: Partial<TerminalSnippet> = {}): TerminalSnippet {
    return {
        id: 'snippet-1',
        name: 'List files',
        command: 'ls -la',
        description: null,
        createdAt: 10,
        updatedAt: 10,
        ...overrides
    }
}

function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body
    } as Response
}

describe('ApiClient terminal snippet methods', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('uses the terminal snippet CRUD endpoints and encodes snippet IDs', async () => {
        const created = snippet()
        const updated = snippet({ name: 'List all files', updatedAt: 20 })
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(jsonResponse({ snippets: [created] }))
            .mockResolvedValueOnce(jsonResponse({ snippet: created }))
            .mockResolvedValueOnce(jsonResponse({ snippet: updated }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }))
        const api = new ApiClient()
        const input = {
            name: 'List files',
            command: 'ls -la',
            description: null
        }

        await expect(api.getTerminalSnippets()).resolves.toEqual({ snippets: [created] })
        await expect(api.createTerminalSnippet(input)).resolves.toEqual({ snippet: created })
        await expect(api.updateTerminalSnippet('snippet/with space', input)).resolves.toEqual({ snippet: updated })
        await expect(api.deleteTerminalSnippet('snippet/with space')).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/terminal-snippets', expect.any(Object))
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/terminal-snippets', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(input)
        }))
        expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/terminal-snippets/snippet%2Fwith%20space', expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify(input)
        }))
        expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/terminal-snippets/snippet%2Fwith%20space', expect.objectContaining({
            method: 'DELETE'
        }))
    })

    it.each([
        {
            method: 'GET',
            body: { snippets: [{ id: '', name: 'Bad', command: 'pwd', description: null, createdAt: 1, updatedAt: 1 }] },
            call: (api: ApiClient) => api.getTerminalSnippets()
        },
        {
            method: 'POST',
            body: { snippet: { ...snippet(), updatedAt: -1 } },
            call: (api: ApiClient) => api.createTerminalSnippet({ name: 'List files', command: 'ls -la' })
        },
        {
            method: 'PATCH',
            body: { snippet: { ...snippet(), description: 42 } },
            call: (api: ApiClient) => api.updateTerminalSnippet('snippet-1', { name: 'List files', command: 'ls -la' })
        }
    ])('rejects an invalid $method response payload', async ({ body, call }) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body))

        await expect(call(new ApiClient())).rejects.toBeDefined()
    })

    it('derives a stable non-secret cache scope from normalized Hub URL and scope id', () => {
        const scope = deriveApiCacheScope('https://hub.example.com/', 'org-a:member-a')

        expect(scope).toBe(deriveApiCacheScope('https://hub.example.com', 'org-a:member-a'))
        expect(scope).toBe(new ApiClient({
            baseUrl: 'https://hub.example.com/',
            cacheScopeId: 'org-a:member-a'
        }).cacheScope)
        expect(scope).not.toBe(deriveApiCacheScope(
            'https://hub.example.com',
            'org-b:member-b'
        ))
        expect(scope).not.toBe(deriveApiCacheScope(
            'https://other.example.com',
            'org-a:member-a'
        ))
        expect(deriveApiCacheScope('https://hub.example.com', undefined))
            .toContain('unknown')
    })
})
