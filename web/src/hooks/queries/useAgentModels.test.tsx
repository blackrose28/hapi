import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CLAUDE_MODEL_PRESETS } from '@hapi/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useAgentModels } from './useAgentModels'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useAgentModels', () => {
    it('uses the machine endpoint and returns a dynamic catalog', async () => {
        const getMachineAgentModels = vi.fn(async () => ({
            status: 'dynamic' as const,
            models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
            source: 'gateway:example.test/v1'
        }))
        const api = { getMachineAgentModels } as unknown as ApiClient

        const { result } = renderHook(() => useAgentModels({
            api,
            agent: 'claude',
            machineId: 'machine-1',
            cwd: '/repo',
            enabled: true
        }), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.status).toBe('dynamic'))
        expect(result.current.models).toEqual([
            { id: 'claude-custom', displayName: 'Claude Custom' }
        ])
        expect(result.current.error).toBeNull()
        expect(getMachineAgentModels).toHaveBeenCalledWith('machine-1', 'claude', '/repo')
    })

    it('prefers the session endpoint when a session is provided', async () => {
        const getSessionAgentModels = vi.fn(async () => ({
            status: 'unsupported' as const,
            models: [{ id: 'sonnet', displayName: 'Sonnet' }],
            source: 'static'
        }))
        const api = { getSessionAgentModels } as unknown as ApiClient

        const { result } = renderHook(() => useAgentModels({
            api,
            agent: 'claude',
            sessionId: 'session-1',
            machineId: 'machine-1',
            enabled: true
        }), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.status).toBe('unsupported'))
        expect(result.current.error).toBeNull()
        expect(getSessionAgentModels).toHaveBeenCalledWith('session-1', 'claude')
    })

    it('surfaces failed catalog status without losing fallback models', async () => {
        const api = {
            getSessionAgentModels: vi.fn(async () => ({
                status: 'failed' as const,
                models: [{ id: 'sonnet', displayName: 'Sonnet' }],
                source: 'gateway:example.test/v1',
                error: 'Agent model discovery failed'
            }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useAgentModels({
            api,
            agent: 'claude',
            sessionId: 'session-1',
            enabled: true
        }), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.status).toBe('failed'))
        expect(result.current.models).toEqual([{ id: 'sonnet', displayName: 'Sonnet' }])
        expect(result.current.error).toBe('Agent model discovery failed')
    })

    it('uses shared Claude presets when transport fails', async () => {
        const api = {
            getMachineAgentModels: vi.fn(async () => {
                throw new Error('Network unavailable')
            })
        } as unknown as ApiClient

        const { result } = renderHook(() => useAgentModels({
            api,
            agent: 'claude',
            machineId: 'machine-1',
            enabled: true
        }), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.error).toBe('Network unavailable'))
        expect(result.current.status).toBe('failed')
        expect(result.current.models.map((model) => model.id)).toEqual(CLAUDE_MODEL_PRESETS)
    })
})
