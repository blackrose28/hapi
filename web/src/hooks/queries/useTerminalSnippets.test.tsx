import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type {
    CreateTerminalSnippetInput,
    TerminalSnippet,
    UpdateTerminalSnippetInput
} from '@hapi/protocol'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { useTerminalSnippets } from './useTerminalSnippets'

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

function createHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return { queryClient, wrapper }
}

function apiMock(overrides: {
    cacheScope?: string
    getTerminalSnippets?: () => Promise<{ snippets: TerminalSnippet[] }>
    createTerminalSnippet?: (input: CreateTerminalSnippetInput) => Promise<{ snippet: TerminalSnippet }>
    updateTerminalSnippet?: (id: string, input: UpdateTerminalSnippetInput) => Promise<{ snippet: TerminalSnippet }>
    deleteTerminalSnippet?: (id: string) => Promise<void>
} = {}): ApiClient {
    return {
        cacheScope: 'hub-a::ns-a',
        getTerminalSnippets: vi.fn(async () => ({ snippets: [] })),
        createTerminalSnippet: vi.fn(),
        updateTerminalSnippet: vi.fn(),
        deleteTerminalSnippet: vi.fn(),
        ...overrides
    } as unknown as ApiClient
}

describe('useTerminalSnippets', () => {
    it('does not fetch with a null API or while disabled', () => {
        const disabledApi = apiMock()
        const nullHarness = createHarness()
        const disabledHarness = createHarness()

        renderHook(() => useTerminalSnippets(null, true), { wrapper: nullHarness.wrapper })
        const { result } = renderHook(
            () => useTerminalSnippets(disabledApi, false),
            { wrapper: disabledHarness.wrapper }
        )

        expect(disabledApi.getTerminalSnippets).not.toHaveBeenCalled()
        expect(result.current.snippets).toEqual([])
        expect(result.current.isLoading).toBe(false)
        expect(result.current.error).toBeNull()
    })

    it('fetches once when enabled and exposes server-ordered snippets', async () => {
        const snippets = [
            snippet({ id: 'newer', name: 'Newer' }),
            snippet({ id: 'older', name: 'Older' })
        ]
        const api = apiMock({
            getTerminalSnippets: vi.fn(async () => ({ snippets }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ enabled }) => useTerminalSnippets(api, enabled),
            {
                initialProps: { enabled: false },
                wrapper: harness.wrapper
            }
        )

        expect(api.getTerminalSnippets).not.toHaveBeenCalled()
        rerender({ enabled: true })

        await waitFor(() => {
            expect(result.current.snippets).toEqual(snippets)
        })
        expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1)
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(api.cacheScope)
        )).toEqual({ snippets })
    })

    it('refetches a complete list after create succeeds without a usable cache', async () => {
        const created = snippet({ id: 'created', name: 'Created' })
        const existing = snippet({ id: 'existing', name: 'Existing' })
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockRejectedValueOnce(new Error('load failed'))
                .mockResolvedValueOnce({ snippets: [created, existing] }),
            createTerminalSnippet: vi.fn(async () => ({ snippet: created }))
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )

        await waitFor(() => expect(result.current.error).toBe('load failed'))

        await act(async () => {
            const response = await result.current.createSnippet({
                name: created.name,
                command: created.command
            })
            await result.current.ensureCreatedSnippetVisible(response)
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([created, existing])
        })
        expect(api.getTerminalSnippets).toHaveBeenCalledTimes(2)
    })

    it('does not render or reuse snippets when the authenticated cache scope changes', async () => {
        const namespaceA = snippet({ id: 'ns-a', name: 'Namespace A' })
        const namespaceB = snippet({ id: 'ns-b', name: 'Namespace B' })
        const apiA = apiMock({
            cacheScope: 'hub::ns-a',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [namespaceA] }))
        })
        const apiB = apiMock({
            cacheScope: 'hub::ns-b',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [namespaceB] }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ api }) => useTerminalSnippets(api, true),
            {
                initialProps: { api: apiA },
                wrapper: harness.wrapper
            }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([namespaceA]))

        rerender({ api: apiB })

        expect(result.current.snippets).not.toEqual([namespaceA])
        await waitFor(() => expect(result.current.snippets).toEqual([namespaceB]))
        expect(apiA.getTerminalSnippets).toHaveBeenCalledTimes(1)
        expect(apiB.getTerminalSnippets).toHaveBeenCalledTimes(1)
    })

    it('reconciles a deferred create with its invocation scope after switching APIs', async () => {
        let resolveCreate!: (value: { snippet: TerminalSnippet }) => void
        const createPromise = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveCreate = resolve
        })
        const existingA = snippet({
            id: 'existing-a',
            name: 'Existing A',
            createdAt: 10,
            updatedAt: 10
        })
        const createdA = snippet({
            id: 'created-a',
            name: 'Created A',
            createdAt: 20,
            updatedAt: 20
        })
        const existingB = snippet({ id: 'existing-b', name: 'Existing B' })
        const apiA = apiMock({
            cacheScope: 'hub::ns-a',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingA] })),
            createTerminalSnippet: vi.fn(() => createPromise)
        })
        const apiB = apiMock({
            cacheScope: 'hub::ns-b',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingB] }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ api }) => useTerminalSnippets(api, true),
            {
                initialProps: { api: apiA },
                wrapper: harness.wrapper
            }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([existingA]))

        let mutation!: Promise<TerminalSnippet>
        act(() => {
            mutation = result.current.createSnippet({
                name: createdA.name,
                command: createdA.command
            })
        })
        rerender({ api: apiB })
        await waitFor(() => expect(result.current.snippets).toEqual([existingB]))

        await act(async () => {
            resolveCreate({ snippet: createdA })
            await mutation
        })

        expect(result.current.snippets).toEqual([existingB])
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiA.cacheScope)
        )).toEqual({ snippets: [createdA, existingA] })
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiB.cacheScope)
        )).toEqual({ snippets: [existingB] })
    })

    it('reconciles a deferred update with its invocation scope after switching APIs', async () => {
        let resolveUpdate!: (value: { snippet: TerminalSnippet }) => void
        const updatePromise = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveUpdate = resolve
        })
        const existingA = snippet({ id: 'shared', name: 'Namespace A' })
        const updatedA = snippet({
            id: 'shared',
            name: 'Updated namespace A',
            updatedAt: 20
        })
        const existingB = snippet({ id: 'shared', name: 'Namespace B' })
        const apiA = apiMock({
            cacheScope: 'hub::ns-a',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingA] })),
            updateTerminalSnippet: vi.fn(() => updatePromise)
        })
        const apiB = apiMock({
            cacheScope: 'hub::ns-b',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingB] }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ api }) => useTerminalSnippets(api, true),
            {
                initialProps: { api: apiA },
                wrapper: harness.wrapper
            }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([existingA]))

        let mutation!: Promise<TerminalSnippet>
        act(() => {
            mutation = result.current.updateSnippet(existingA.id, {
                name: updatedA.name,
                command: updatedA.command
            })
        })
        rerender({ api: apiB })
        await waitFor(() => expect(result.current.snippets).toEqual([existingB]))

        await act(async () => {
            resolveUpdate({ snippet: updatedA })
            await mutation
        })

        expect(result.current.snippets).toEqual([existingB])
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiA.cacheScope)
        )).toEqual({ snippets: [updatedA] })
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiB.cacheScope)
        )).toEqual({ snippets: [existingB] })
    })

    it('reconciles a deferred delete with its invocation scope after switching APIs', async () => {
        let resolveDelete!: () => void
        const deletePromise = new Promise<void>((resolve) => {
            resolveDelete = resolve
        })
        const existingA = snippet({ id: 'shared', name: 'Namespace A' })
        const existingB = snippet({ id: 'shared', name: 'Namespace B' })
        const apiA = apiMock({
            cacheScope: 'hub::ns-a',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingA] })),
            deleteTerminalSnippet: vi.fn(() => deletePromise)
        })
        const apiB = apiMock({
            cacheScope: 'hub::ns-b',
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existingB] }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ api }) => useTerminalSnippets(api, true),
            {
                initialProps: { api: apiA },
                wrapper: harness.wrapper
            }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([existingA]))

        let mutation!: Promise<void>
        act(() => {
            mutation = result.current.deleteSnippet(existingA.id)
        })
        rerender({ api: apiB })
        await waitFor(() => expect(result.current.snippets).toEqual([existingB]))

        await act(async () => {
            resolveDelete()
            await mutation
        })

        expect(result.current.snippets).toEqual([existingB])
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiA.cacheScope)
        )).toEqual({ snippets: [] })
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(apiB.cacheScope)
        )).toEqual({ snippets: [existingB] })
    })

    it('prepends a created snippet to the current cache after server success', async () => {
        const existing = snippet({ id: 'existing' })
        const created = snippet({
            id: 'created',
            name: 'Created',
            createdAt: 20,
            updatedAt: 20
        })
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockResolvedValueOnce({ snippets: [existing] })
                .mockResolvedValue({ snippets: [created, existing] }),
            createTerminalSnippet: vi.fn(async () => ({ snippet: created }))
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([existing]))

        await act(async () => {
            await result.current.createSnippet({
                name: created.name,
                command: created.command
            })
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([created, existing])
        })
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(api.cacheScope)
        )).toEqual({
            snippets: [created, existing]
        })
    })

    it('upserts a created snippet when an SSE refetch cached it before the mutation response', async () => {
        const created = snippet({ id: 'created', name: 'Created' })
        const api = apiMock({
            getTerminalSnippets: vi.fn(async () => ({ snippets: [created] })),
            createTerminalSnippet: vi.fn(async () => ({ snippet: created }))
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([created]))

        await act(async () => {
            await result.current.createSnippet({
                name: created.name,
                command: created.command
            })
        })

        await waitFor(() => expect(result.current.snippets).toEqual([created]))
        expect(result.current.snippets.filter((item) => item.id === created.id)).toHaveLength(1)
    })

    it('does not create a partial list cache before the lazy query is enabled', async () => {
        const created = snippet({ id: 'created', name: 'Created' })
        const existing = snippet({ id: 'existing', name: 'Existing', createdAt: 5, updatedAt: 5 })
        const api = apiMock({
            getTerminalSnippets: vi.fn(async () => ({ snippets: [created, existing] })),
            createTerminalSnippet: vi.fn(async () => ({ snippet: created }))
        })
        const harness = createHarness()
        const { result, rerender } = renderHook(
            ({ enabled }) => useTerminalSnippets(api, enabled),
            {
                initialProps: { enabled: false },
                wrapper: harness.wrapper
            }
        )

        await act(async () => {
            await result.current.createSnippet({
                name: created.name,
                command: created.command
            })
        })
        expect(api.getTerminalSnippets).not.toHaveBeenCalled()
        expect(
            harness.queryClient
                .getQueriesData({ queryKey: ['terminal-snippets'] })
                .every(([, data]) => data === undefined)
        ).toBe(true)

        rerender({ enabled: true })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([created, existing])
        })
        expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1)
    })

    it('sorts concurrent create responses by server timestamp and deterministic ID order', async () => {
        let resolveA!: (value: { snippet: TerminalSnippet }) => void
        let resolveB!: (value: { snippet: TerminalSnippet }) => void
        const promiseA = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveA = resolve
        })
        const promiseB = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveB = resolve
        })
        const sameTimestampExisting = snippet({
            id: 'c',
            name: 'Existing C',
            createdAt: 30,
            updatedAt: 30
        })
        const createdA = snippet({
            id: 'a',
            name: 'Created A',
            createdAt: 30,
            updatedAt: 30
        })
        const createdB = snippet({
            id: 'b',
            name: 'Created B',
            createdAt: 40,
            updatedAt: 40
        })
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockResolvedValueOnce({ snippets: [sameTimestampExisting] })
                .mockResolvedValueOnce({
                    snippets: [createdB, sameTimestampExisting]
                })
                .mockResolvedValue({
                    snippets: [createdB, sameTimestampExisting, createdA]
                }),
            createTerminalSnippet: vi.fn()
                .mockReturnValueOnce(promiseA)
                .mockReturnValueOnce(promiseB)
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => {
            expect(result.current.snippets).toEqual([sameTimestampExisting])
        })

        let createA!: Promise<TerminalSnippet>
        let createB!: Promise<TerminalSnippet>
        act(() => {
            createA = result.current.createSnippet({
                name: createdA.name,
                command: createdA.command
            })
            createB = result.current.createSnippet({
                name: createdB.name,
                command: createdB.command
            })
        })
        await act(async () => {
            resolveB({ snippet: createdB })
            await createB
        })
        await act(async () => {
            resolveA({ snippet: createdA })
            await createA
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([
                createdB,
                sameTimestampExisting,
                createdA
            ])
        })
    })

    it('replaces an updated snippet without changing its position', async () => {
        const first = snippet({ id: 'first', name: 'First' })
        const second = snippet({ id: 'second', name: 'Second' })
        const updated = { ...second, name: 'Updated second', updatedAt: 20 }
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockResolvedValueOnce({ snippets: [first, second] })
                .mockResolvedValue({ snippets: [first, updated] }),
            updateTerminalSnippet: vi.fn(async () => ({ snippet: updated }))
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([first, second]))

        await act(async () => {
            await result.current.updateSnippet(second.id, {
                name: updated.name,
                command: updated.command
            })
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([first, updated])
        })
    })

    it('refetches after a deferred update so its stale response cannot overwrite newer authoritative data', async () => {
        let resolveUpdate!: (value: { snippet: TerminalSnippet }) => void
        const updatePromise = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveUpdate = resolve
        })
        const original = snippet({ name: 'Original', updatedAt: 10 })
        const staleMutationResponse = snippet({
            name: 'Client one',
            updatedAt: 20
        })
        const newerAuthoritative = snippet({
            name: 'Client two',
            updatedAt: 30
        })
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockResolvedValueOnce({ snippets: [original] })
                .mockResolvedValue({ snippets: [newerAuthoritative] }),
            updateTerminalSnippet: vi.fn(() => updatePromise)
        })
        const harness = createHarness()
        const queryKey = queryKeys.terminalSnippets(api.cacheScope)
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([original]))

        let mutation!: Promise<TerminalSnippet>
        act(() => {
            mutation = result.current.updateSnippet(original.id, {
                name: staleMutationResponse.name,
                command: staleMutationResponse.command
            })
        })
        await act(async () => {
            await harness.queryClient.invalidateQueries({
                queryKey,
                exact: true
            })
        })
        await waitFor(() => {
            expect(result.current.snippets).toEqual([newerAuthoritative])
        })

        await act(async () => {
            resolveUpdate({ snippet: staleMutationResponse })
            await mutation
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([newerAuthoritative])
        })
        expect(harness.queryClient.getQueryData(queryKey)).toEqual({
            snippets: [newerAuthoritative]
        })
        expect(api.getTerminalSnippets).toHaveBeenCalledTimes(3)
    })

    it('removes a deleted snippet from the current cache', async () => {
        const first = snippet({ id: 'first', name: 'First' })
        const second = snippet({ id: 'second', name: 'Second' })
        const api = apiMock({
            getTerminalSnippets: vi.fn()
                .mockResolvedValueOnce({ snippets: [first, second] })
                .mockResolvedValue({ snippets: [second] }),
            deleteTerminalSnippet: vi.fn(async () => undefined)
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([first, second]))

        await act(async () => {
            await result.current.deleteSnippet(first.id)
        })

        await waitFor(() => {
            expect(result.current.snippets).toEqual([second])
        })
    })

    it('keeps the cached list unchanged and rejects a failed mutation', async () => {
        const existing = snippet()
        const failure = new Error('create failed')
        const api = apiMock({
            getTerminalSnippets: vi.fn(async () => ({ snippets: [existing] })),
            createTerminalSnippet: vi.fn(async () => {
                throw failure
            })
        })
        const harness = createHarness()
        const { result } = renderHook(
            () => useTerminalSnippets(api, true),
            { wrapper: harness.wrapper }
        )
        await waitFor(() => expect(result.current.snippets).toEqual([existing]))

        await expect(result.current.createSnippet({
            name: 'Will fail',
            command: 'false'
        })).rejects.toBe(failure)

        expect(result.current.snippets).toEqual([existing])
        expect(harness.queryClient.getQueryData(
            queryKeys.terminalSnippets(api.cacheScope)
        )).toEqual({
            snippets: [existing]
        })
    })

    it('guards mutations when the API is unavailable', async () => {
        const { result } = renderHook(
            () => useTerminalSnippets(null, true),
            { wrapper: createHarness().wrapper }
        )
        const input = { name: 'List files', command: 'ls' }

        await expect(result.current.createSnippet(input)).rejects.toThrow('API unavailable')
        await expect(result.current.updateSnippet('snippet-1', input)).rejects.toThrow('API unavailable')
        await expect(result.current.deleteSnippet('snippet-1')).rejects.toThrow('API unavailable')
    })

    it('reports pending while any snippet mutation is running', async () => {
        let resolveCreate!: (value: { snippet: TerminalSnippet }) => void
        const createPromise = new Promise<{ snippet: TerminalSnippet }>((resolve) => {
            resolveCreate = resolve
        })
        const created = snippet({ id: 'created' })
        const api = apiMock({
            createTerminalSnippet: vi.fn(() => createPromise)
        })
        const { result } = renderHook(
            () => useTerminalSnippets(api, false),
            { wrapper: createHarness().wrapper }
        )

        let mutation!: Promise<TerminalSnippet>
        act(() => {
            mutation = result.current.createSnippet({
                name: created.name,
                command: created.command
            })
        })
        await waitFor(() => expect(result.current.isPending).toBe(true))

        await act(async () => {
            resolveCreate({ snippet: created })
            await mutation
        })
        await waitFor(() => expect(result.current.isPending).toBe(false))
    })
})
