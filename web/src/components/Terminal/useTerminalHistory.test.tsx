import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalHistoryResult } from '@hapi/protocol'
import { useTerminalHistory } from './useTerminalHistory'

describe('useTerminalHistory', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('loads matching history and ignores stale responses', () => {
        let listener: ((result: TerminalHistoryResult) => void) | null = null
        const request = vi.fn<(requestId: string, limit: number) => boolean>(() => true)
        const { result } = renderHook(() => useTerminalHistory({
            terminalContextKey: 'session-1:terminal-1',
            terminalId: 'terminal-1',
            request,
            subscribe: (handler) => {
                listener = handler
            }
        }))

        act(() => result.current.open())
        expect(result.current.state).toEqual({ status: 'loading', entries: [] })
        expect(request).toHaveBeenCalledWith(expect.any(String), 100)
        const firstRequestId = request.mock.calls[0]![0]

        act(() => result.current.refresh())
        const secondRequestId = request.mock.calls[1]![0]
        expect(secondRequestId).not.toBe(firstRequestId)

        act(() => listener?.({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: firstRequestId,
            status: 'ok',
            entries: [{ index: 1, command: 'stale' }]
        }))
        expect(result.current.state).toEqual({ status: 'loading', entries: [] })

        act(() => listener?.({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: secondRequestId,
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 2, command: 'git status' }]
        }))
        expect(result.current.state).toEqual({
            status: 'ready',
            entries: [{ index: 2, command: 'git status' }]
        })
    })

    it('maps unsupported, not-ready and request failures to explicit UI states', () => {
        let listener: ((result: TerminalHistoryResult) => void) | null = null
        const request = vi.fn<(requestId: string, limit: number) => boolean>(() => true)
        const { result } = renderHook(() => useTerminalHistory({
            terminalContextKey: 'machine-1:terminal-1',
            terminalId: 'terminal-1',
            request,
            subscribe: (handler) => {
                listener = handler
            }
        }))

        act(() => result.current.open())
        const requestId = request.mock.calls[0]![0]
        act(() => listener?.({
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId,
            status: 'unsupported_shell',
            shell: 'zsh',
            entries: []
        }))
        expect(result.current.state).toEqual({
            status: 'unsupported',
            entries: [],
            shell: 'zsh'
        })

        act(() => result.current.refresh())
        const retryId = request.mock.calls[1]![0]
        act(() => listener?.({
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: retryId,
            status: 'not_ready',
            shell: 'bash',
            entries: []
        }))
        expect(result.current.state).toEqual({
            status: 'error',
            entries: [],
            message: 'not_ready'
        })

        request.mockReturnValue(false)
        act(() => result.current.refresh())
        expect(result.current.state).toEqual({
            status: 'error',
            entries: [],
            message: 'request_failed'
        })
    })

    it('resets when closed or when terminal identity changes', () => {
        let listener: ((result: TerminalHistoryResult) => void) | null = null
        const request = vi.fn<(requestId: string, limit: number) => boolean>(() => true)
        const rendered = renderHook((props: { key: string; terminalId: string }) => useTerminalHistory({
            terminalContextKey: props.key,
            terminalId: props.terminalId,
            request,
            subscribe: (handler) => {
                listener = handler
            }
        }), {
            initialProps: { key: 'session-1:terminal-1', terminalId: 'terminal-1' }
        })

        act(() => rendered.result.current.open())
        rendered.rerender({ key: 'session-1:terminal-2', terminalId: 'terminal-2' })
        expect(rendered.result.current.state).toEqual({ status: 'idle', entries: [] })

        const oldRequestId = request.mock.calls[0]![0]
        act(() => listener?.({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: oldRequestId,
            status: 'ok',
            entries: [{ index: 1, command: 'old' }]
        }))
        expect(rendered.result.current.state).toEqual({ status: 'idle', entries: [] })

        act(() => rendered.result.current.open())
        act(() => rendered.result.current.close())
        expect(rendered.result.current.state).toEqual({ status: 'idle', entries: [] })
    })

    it('leaves loading state when the private Hub correlation expires', () => {
        vi.useFakeTimers()
        const request = vi.fn<(requestId: string, limit: number) => boolean>(() => true)
        const { result } = renderHook(() => useTerminalHistory({
            terminalContextKey: 'session-1:terminal-1',
            terminalId: 'terminal-1',
            request,
            subscribe: () => {},
        }))

        act(() => result.current.open())
        expect(result.current.state.status).toBe('loading')

        act(() => vi.advanceTimersByTime(10_001))
        expect(result.current.state).toEqual({
            status: 'error',
            entries: [],
            message: 'request_failed',
        })
    })
})
