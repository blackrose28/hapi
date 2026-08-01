import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRequestMock = vi.fn()
const closeMock = vi.fn().mockResolvedValue(undefined)
const transportConstructor = vi.fn()

vi.mock('@/agent/backends/acp/AcpStdioTransport', () => ({
    AcpStdioTransport: class {
        sendRequest = sendRequestMock
        close = closeMock
        constructor(opts: { command: string; args?: string[] }) {
            transportConstructor(opts)
        }
    }
}))

import { listGrokModelsForCwd, _resetGrokModelsCacheForTests } from './grokModels'

describe('listGrokModelsForCwd', () => {
    beforeEach(() => {
        _resetGrokModelsCacheForTests()
        sendRequestMock.mockReset()
        closeMock.mockClear()
        transportConstructor.mockClear()
    })

    afterEach(() => {
        _resetGrokModelsCacheForTests()
    })

    it('returns success false when cwd is empty', async () => {
        const result = await listGrokModelsForCwd('')
        expect(result).toEqual({ success: false, error: 'cwd is required' })
        expect(sendRequestMock).not.toHaveBeenCalled()
    })

    it('spawns grok scoped to the requested cwd, runs initialize and session/new, returns availableModels', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({
                sessionId: 'sess-1',
                models: {
                    availableModels: [
                        { modelId: 'grok-4.5', name: 'Grok 4.5' },
                        { modelId: 'grok-4.5-fast', name: 'Grok 4.5 Fast' }
                    ],
                    currentModelId: 'grok-4.5'
                }
            })

        const result = await listGrokModelsForCwd('/home/user/project')

        // --cwd must be passed at process start (not just via session/new) so
        // Grok discovers the correct project rules/plugins for the requested
        // directory — this is the cwd-scoping fix upstream squashed into the
        // Grok Build support commit.
        expect(transportConstructor).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'grok', args: ['--cwd', '/home/user/project', 'agent', 'stdio'] })
        )
        expect(sendRequestMock).toHaveBeenNthCalledWith(
            1,
            'initialize',
            expect.objectContaining({ protocolVersion: 1 }),
            expect.any(Object)
        )
        expect(sendRequestMock).toHaveBeenNthCalledWith(
            2,
            'session/new',
            expect.objectContaining({ cwd: '/home/user/project', mcpServers: [] }),
            expect.any(Object)
        )
        expect(result.success).toBe(true)
        expect(result.availableModels).toEqual([
            { modelId: 'grok-4.5', name: 'Grok 4.5' },
            { modelId: 'grok-4.5-fast', name: 'Grok 4.5 Fast' }
        ])
        expect(result.currentModelId).toBe('grok-4.5')
        expect(closeMock).toHaveBeenCalled()
    })

    it('scopes discovery to a different cwd on each call (not a shared/global probe)', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({ models: { availableModels: [{ modelId: 'a' }], currentModelId: 'a' } })
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({ models: { availableModels: [{ modelId: 'b' }], currentModelId: 'b' } })

        await listGrokModelsForCwd('/project/one')
        await listGrokModelsForCwd('/project/two')

        expect(transportConstructor).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ args: ['--cwd', '/project/one', 'agent', 'stdio'] })
        )
        expect(transportConstructor).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ args: ['--cwd', '/project/two', 'agent', 'stdio'] })
        )
    })

    it('returns empty availableModels when session/new omits the models block', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({ sessionId: 'sess-2' })

        const result = await listGrokModelsForCwd('/tmp/proj')

        expect(result.success).toBe(true)
        expect(result.availableModels).toEqual([])
        expect(result.currentModelId).toBeNull()
    })

    it('extracts Grok effort options from ACP configOptions', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({
                sessionId: 'sess-effort',
                models: {
                    availableModels: [{ modelId: 'grok-4.5' }],
                    currentModelId: 'grok-4.5'
                },
                configOptions: [
                    {
                        id: 'effort',
                        currentValue: 'high',
                        options: [
                            { value: 'low', name: 'Low' },
                            { value: 'medium', name: 'Medium' },
                            { value: 'high', name: 'High' }
                        ]
                    }
                ]
            })

        const result = await listGrokModelsForCwd('/effort/cwd')

        expect(result.success).toBe(true)
        expect(result.availableEfforts).toEqual([
            { effortId: 'low', name: 'Low' },
            { effortId: 'medium', name: 'Medium' },
            { effortId: 'high', name: 'High' }
        ])
        expect(result.currentEffortId).toBe('high')
    })

    it('reads availableModels from top-level fields too (alternate response shape)', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({
                sessionId: 'sess-3',
                availableModels: [
                    { modelId: 'grok-code-fast', name: 'Grok Code Fast' }
                ],
                currentModelId: 'grok-code-fast'
            })

        const result = await listGrokModelsForCwd('/p/another')

        expect(result.success).toBe(true)
        expect(result.availableModels).toEqual([
            { modelId: 'grok-code-fast', name: 'Grok Code Fast' }
        ])
    })

    it('caches the result for the same cwd within the TTL', async () => {
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockResolvedValueOnce({
                models: { availableModels: [{ modelId: 'a/b', name: 'A/B' }], currentModelId: 'a/b' }
            })

        await listGrokModelsForCwd('/cache/cwd')
        await listGrokModelsForCwd('/cache/cwd')

        expect(transportConstructor).toHaveBeenCalledTimes(1)
        expect(sendRequestMock).toHaveBeenCalledTimes(2)
    })

    it('coalesces concurrent probes for the same cwd into a single transport spawn', async () => {
        let resolveSecond: (value: unknown) => void = () => undefined
        sendRequestMock
            .mockResolvedValueOnce({ protocolVersion: 1 })
            .mockImplementationOnce(() => new Promise((res) => { resolveSecond = res }))

        const inflight1 = listGrokModelsForCwd('/inflight/cwd')
        const inflight2 = listGrokModelsForCwd('/inflight/cwd')

        // Allow microtasks to schedule the second sendRequest
        await new Promise((resolve) => setImmediate(resolve))
        resolveSecond({
            models: { availableModels: [{ modelId: 'a/b' }], currentModelId: 'a/b' }
        })

        const [r1, r2] = await Promise.all([inflight1, inflight2])

        expect(transportConstructor).toHaveBeenCalledTimes(1)
        expect(r1).toEqual(r2)
        expect(r1.success).toBe(true)
    })

    it('reports a failure when the spawn rejects', async () => {
        sendRequestMock.mockRejectedValueOnce(new Error('Failed to spawn grok: ENOENT'))

        const result = await listGrokModelsForCwd('/missing/binary')

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to spawn grok')
        expect(closeMock).toHaveBeenCalled()
    })
})
