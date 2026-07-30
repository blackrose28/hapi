import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveApiCacheScope } from '@/api/client'
import { shouldReconnectOnVisibilityRestore } from './useSSE'
import { useSSE } from './useSSE'

class MockEventSource {
    static instances: MockEventSource[] = []
    static readonly CLOSED = 2

    readonly url: string
    readyState = 1
    onmessage: ((message: MessageEvent<string>) => void) | null = null
    onopen: (() => void) | null = null
    onerror: ((error: Event) => void) | null = null

    constructor(url: string | URL) {
        this.url = String(url)
        MockEventSource.instances.push(this)
    }

    close = vi.fn()

    emit(event: unknown): void {
        this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
    }
}

function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children)
    }
}

afterEach(() => {
    MockEventSource.instances = []
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('SSE visibility recovery', () => {
    it('does not reconnect just because the app returned from a hidden state when the stream is fresh', () => {
        expect(shouldReconnectOnVisibilityRestore({
            hiddenAt: 1_000,
            lastActivityAt: 9_000,
            now: 10_000,
            heartbeatStaleMs: 90_000,
        })).toBe(false)
    })

    it('reconnects when heartbeat is stale even if the hidden transition was missed', () => {
        expect(shouldReconnectOnVisibilityRestore({
            hiddenAt: null,
            lastActivityAt: 1_000,
            now: 100_000,
            heartbeatStaleMs: 90_000,
        })).toBe(true)
    })

    it('keeps a fresh visible connection open', () => {
        expect(shouldReconnectOnVisibilityRestore({
            hiddenAt: null,
            lastActivityAt: 95_000,
            now: 100_000,
            heartbeatStaleMs: 90_000,
        })).toBe(false)
    })
})

describe('SSE terminal snippet invalidation', () => {
    it('invalidates terminal snippets and still forwards the event', async () => {
        vi.stubGlobal('EventSource', MockEventSource)
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
        const onEvent = vi.fn()
        const cacheScopeId = 'org-a:member-a'
        const baseUrl = 'http://localhost'
        renderHook(
            () => useSSE({
                enabled: true,
                cacheScopeId,
                baseUrl,
                onEvent
            }),
            { wrapper: createWrapper(queryClient) }
        )
        const event = {
            type: 'terminal-snippets-updated',
            namespace: 'default'
        } as const

        act(() => {
            MockEventSource.instances[0]?.emit(event)
        })

        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({
                queryKey: ['terminal-snippets', deriveApiCacheScope(baseUrl, cacheScopeId)],
                exact: true
            })
        })
        expect(invalidate).toHaveBeenCalledTimes(1)
        expect(invalidate).not.toHaveBeenCalledWith({
            queryKey: ['terminal-snippets', deriveApiCacheScope(
                baseUrl,
                'org-b:member-b'
            )],
            exact: true
        })
        expect(onEvent).toHaveBeenCalledWith(event)
    })

    it('does not invalidate terminal snippets for unrelated events', () => {
        vi.stubGlobal('EventSource', MockEventSource)
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
        const onEvent = vi.fn()
        renderHook(
            () => useSSE({
                enabled: true,
                cacheScopeId: 'org-a:member-a',
                baseUrl: 'http://localhost',
                onEvent
            }),
            { wrapper: createWrapper(queryClient) }
        )
        const event = {
            type: 'connection-changed',
            data: { subscriptionId: 'subscription-1' }
        } as const

        act(() => {
            MockEventSource.instances[0]?.emit(event)
        })

        expect(invalidate).not.toHaveBeenCalled()
        expect(onEvent).toHaveBeenCalledWith(event)
    })
})
