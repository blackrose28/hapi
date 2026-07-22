import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidRender } from './use-mermaid-render'
import { renderMermaid } from './mermaid-renderer'

vi.mock('./mermaid-renderer', () => ({ renderMermaid: vi.fn() }))
const mockedRender = vi.mocked(renderMermaid)

describe('useMermaidRender', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mockedRender.mockReset()
    })

    it('debounces streaming by 250 ms and renders final content immediately', async () => {
        mockedRender.mockResolvedValue('<svg id="ok"></svg>')
        const { rerender, result } = renderHook(
            ({ code, streaming }) => useMermaidRender({
                id: 'm-1', code, theme: 'dark', streaming, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart L', streaming: true } },
        )
        expect(mockedRender).not.toHaveBeenCalled()
        await act(async () => { vi.advanceTimersByTime(249) })
        expect(mockedRender).not.toHaveBeenCalled()
        rerender({ code: 'flowchart LR\nA-->B', streaming: false })
        await act(async () => { await Promise.resolve() })
        expect(mockedRender).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'flowchart LR\nA-->B' }))
        expect(result.current.svg).toBe('<svg id="ok"></svg>')
    })

    it('keeps the last good SVG while a streaming revision is pending', async () => {
        mockedRender.mockResolvedValueOnce('<svg id="first"></svg>')
        const { rerender, result } = renderHook(
            ({ code, streaming }) => useMermaidRender({
                id: 'm-1', code, theme: 'light', streaming, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart LR\nA-->B', streaming: false } },
        )
        await act(async () => { await Promise.resolve() })
        rerender({ code: 'flowchart LR\nA-->B\nB-->C', streaming: true })
        expect(result.current.svg).toBe('<svg id="first"></svg>')
    })

    it('uses a unique Mermaid DOM id for every render attempt', async () => {
        mockedRender.mockResolvedValue('<svg></svg>')
        const { rerender } = renderHook(
            ({ code }) => useMermaidRender({
                id: 'm-1', code, theme: 'light', streaming: false, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart LR\nA-->B' } },
        )
        await act(async () => { await Promise.resolve() })
        const firstId = mockedRender.mock.calls[0]?.[0].id

        rerender({ code: 'flowchart LR\nA-->C' })
        await act(async () => { await Promise.resolve() })
        const secondId = mockedRender.mock.calls[1]?.[0].id

        expect(firstId).toBeDefined()
        expect(secondId).toBeDefined()
        expect(secondId).not.toBe(firstId)
    })

    it('does not let an older render overwrite a newer result', async () => {
        let resolveFirst: ((svg: string) => void) | undefined
        let resolveSecond: ((svg: string) => void) | undefined
        mockedRender
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
        const { rerender, result } = renderHook(
            ({ code }) => useMermaidRender({
                id: 'm-1', code, theme: 'light', streaming: false, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart LR\nA-->B' } },
        )
        rerender({ code: 'flowchart LR\nA-->C' })

        await act(async () => { resolveSecond?.('<svg id="new"></svg>') })
        expect(result.current.svg).toBe('<svg id="new"></svg>')
        await act(async () => { resolveFirst?.('<svg id="old"></svg>') })
        expect(result.current.svg).toBe('<svg id="new"></svg>')
    })

    it('ignores AbortError but exposes a settled syntax error', async () => {
        mockedRender.mockRejectedValueOnce(new DOMException('stale', 'AbortError'))
        const { rerender, result } = renderHook(
            ({ retryKey }) => useMermaidRender({
                id: 'm-1', code: 'invalid', theme: 'light', streaming: false, retryKey,
            }),
            { initialProps: { retryKey: 0 } },
        )
        await act(async () => { await Promise.resolve() })
        expect(result.current.error).toBeNull()
        mockedRender.mockRejectedValueOnce(new Error('Parse error'))
        rerender({ retryKey: 1 })
        await act(async () => { await Promise.resolve() })
        expect(result.current.error).toBeInstanceOf(Error)
    })
})
