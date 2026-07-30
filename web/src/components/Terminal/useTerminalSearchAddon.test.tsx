import { act, renderHook, waitFor } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    EMPTY_TERMINAL_SEARCH_RESULTS,
    EMPTY_TERMINAL_SEARCH_STATE,
    TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
    type TerminalSearchController,
    type TerminalSearchOptions,
} from './terminalSearch'
import {
    terminalSearchAddonLoader,
    useTerminalSearchAddon,
} from './useTerminalSearchAddon'

type ResultEvent = { resultIndex: number; resultCount: number }

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function createTerminal() {
    return {
        loadAddon: vi.fn(),
    } as unknown as Terminal
}

function createAddon() {
    let resultListener: ((event: ResultEvent) => void) | null = null
    const resultSubscriptionDispose = vi.fn(() => {
        resultListener = null
    })
    return {
        addon: {
            dispose: vi.fn(),
            clearDecorations: vi.fn(),
            findNext: vi.fn(() => true),
            findPrevious: vi.fn(() => true),
            onDidChangeResults: vi.fn((listener: (event: ResultEvent) => void) => {
                resultListener = listener
                return { dispose: resultSubscriptionDispose }
            }),
        },
        emit: (event: ResultEvent) => resultListener?.(event),
        resultSubscriptionDispose,
    }
}

async function waitUntilReady(result: {
    current: ReturnType<typeof useTerminalSearchAddon>
}): Promise<TerminalSearchController> {
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready' || !result.current.controller) {
        throw new Error('Expected ready search state')
    }
    return result.current.controller
}

describe('useTerminalSearchAddon', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('stays idle until activated and lazily loads only once for the same terminal', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        const load = vi.spyOn(terminalSearchAddonLoader, 'load').mockResolvedValue(fixture.addon)
        const rendered = renderHook(
            ({ active }) => useTerminalSearchAddon({ terminal, active }),
            { initialProps: { active: false } },
        )

        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)
        expect(load).not.toHaveBeenCalled()

        rendered.rerender({ active: true })
        await waitUntilReady(rendered.result)
        rendered.rerender({ active: true })

        expect(load).toHaveBeenCalledOnce()
        expect(terminal.loadAddon).toHaveBeenCalledOnce()
    })

    it('clears while inactive and reuses the live addon when reopened', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        const load = vi.spyOn(terminalSearchAddonLoader, 'load').mockResolvedValue(fixture.addon)
        const rendered = renderHook(
            ({ active }) => useTerminalSearchAddon({ terminal, active }),
            { initialProps: { active: true } },
        )
        await waitUntilReady(rendered.result)

        rendered.rerender({ active: false })
        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)
        expect(fixture.addon.clearDecorations).toHaveBeenCalledOnce()
        expect(fixture.addon.dispose).not.toHaveBeenCalled()

        rendered.rerender({ active: true })
        await waitUntilReady(rendered.result)
        expect(load).toHaveBeenCalledOnce()
        expect(terminal.loadAddon).toHaveBeenCalledOnce()
    })

    it('forwards search flags with fixed decorations and clears empty queries', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load').mockResolvedValue(fixture.addon)
        const rendered = renderHook(() => useTerminalSearchAddon({
            terminal,
            active: true,
        }))
        const controller = await waitUntilReady(rendered.result)
        const options: TerminalSearchOptions = {
            caseSensitive: true,
            incremental: true,
        }

        expect(controller.findNext('needle', options)).toBe(true)
        expect(fixture.addon.findNext).toHaveBeenCalledWith('needle', {
            caseSensitive: true,
            incremental: true,
            decorations: expect.objectContaining({
                matchOverviewRuler: expect.any(String),
                activeMatchColorOverviewRuler: expect.any(String),
            }),
        })
        expect(controller.findPrevious('needle', options)).toBe(true)
        expect(fixture.addon.findPrevious).toHaveBeenCalledWith('needle', {
            caseSensitive: true,
            incremental: true,
            decorations: expect.any(Object),
        })

        expect(controller.findNext('', options)).toBe(false)
        expect(controller.findPrevious('', options)).toBe(false)
        expect(fixture.addon.findNext).toHaveBeenCalledTimes(1)
        expect(fixture.addon.findPrevious).toHaveBeenCalledTimes(1)
        expect(fixture.addon.clearDecorations).toHaveBeenCalledTimes(2)
    })

    it('normalizes result events, including xterm highlight overflow at exactly 1000', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load').mockResolvedValue(fixture.addon)
        const rendered = renderHook(() => useTerminalSearchAddon({
            terminal,
            active: true,
        }))
        const controller = await waitUntilReady(rendered.result)
        const listener = vi.fn()
        const unsubscribe = controller.subscribe(listener)

        fixture.emit({ resultIndex: 2, resultCount: 5 })
        expect(listener).toHaveBeenLastCalledWith({
            resultIndex: 2,
            resultCount: 5,
            limitExceeded: false,
        })

        fixture.emit({
            resultIndex: 0,
            resultCount: TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
        })
        expect(listener).toHaveBeenLastCalledWith({
            resultIndex: 0,
            resultCount: 1_000,
            limitExceeded: true,
        })

        unsubscribe()
        fixture.emit({ resultIndex: -1, resultCount: 0 })
        expect(listener).toHaveBeenCalledTimes(2)
    })

    it('emits empty results when the controller is cleared', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load').mockResolvedValue(fixture.addon)
        const rendered = renderHook(() => useTerminalSearchAddon({
            terminal,
            active: true,
        }))
        const controller = await waitUntilReady(rendered.result)
        const listener = vi.fn()
        controller.subscribe(listener)

        controller.clear()

        expect(fixture.addon.clearDecorations).toHaveBeenCalledOnce()
        expect(listener).toHaveBeenCalledWith(EMPTY_TERMINAL_SEARCH_RESULTS)
    })

    it('disposes the result subscription and addon once on replacement and unmount', async () => {
        const firstTerminal = createTerminal()
        const secondTerminal = createTerminal()
        const first = createAddon()
        const second = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load')
            .mockResolvedValueOnce(first.addon)
            .mockResolvedValueOnce(second.addon)
        const rendered = renderHook(
            ({ terminal }) => useTerminalSearchAddon({ terminal, active: true }),
            { initialProps: { terminal: firstTerminal } },
        )
        const firstController = await waitUntilReady(rendered.result)

        rendered.rerender({ terminal: secondTerminal })
        const secondController = await waitUntilReady(rendered.result)
        expect(first.resultSubscriptionDispose).toHaveBeenCalledOnce()
        expect(first.addon.dispose).toHaveBeenCalledOnce()
        expect(secondTerminal.loadAddon).toHaveBeenCalledOnce()

        const staleReplacementListener = vi.fn()
        const staleReplacementUnsubscribe = firstController.subscribe(staleReplacementListener)
        expect(firstController.findNext('stale', {
            caseSensitive: false,
            incremental: false,
        })).toBe(false)
        expect(firstController.findPrevious('stale', {
            caseSensitive: false,
            incremental: false,
        })).toBe(false)
        firstController.clear()
        staleReplacementUnsubscribe()
        staleReplacementUnsubscribe()
        expect(first.addon.findNext).not.toHaveBeenCalled()
        expect(first.addon.findPrevious).not.toHaveBeenCalled()
        expect(first.addon.clearDecorations).not.toHaveBeenCalled()
        expect(staleReplacementListener).not.toHaveBeenCalled()

        rendered.unmount()
        expect(second.resultSubscriptionDispose).toHaveBeenCalledOnce()
        expect(second.addon.dispose).toHaveBeenCalledOnce()
        expect(first.addon.dispose).toHaveBeenCalledOnce()

        const staleUnmountListener = vi.fn()
        const staleUnmountUnsubscribe = secondController.subscribe(staleUnmountListener)
        expect(secondController.findNext('stale', {
            caseSensitive: false,
            incremental: false,
        })).toBe(false)
        expect(secondController.findPrevious('stale', {
            caseSensitive: false,
            incremental: false,
        })).toBe(false)
        secondController.clear()
        staleUnmountUnsubscribe()
        staleUnmountUnsubscribe()
        expect(second.addon.findNext).not.toHaveBeenCalled()
        expect(second.addon.findPrevious).not.toHaveBeenCalled()
        expect(second.addon.clearDecorations).not.toHaveBeenCalled()
        expect(staleUnmountListener).not.toHaveBeenCalled()
    })

    it('disposes a delayed addon without loading it after unmount', async () => {
        const terminal = createTerminal()
        const pending = deferred<ReturnType<typeof createAddon>['addon']>()
        const fixture = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load').mockReturnValue(pending.promise)
        const rendered = renderHook(() => useTerminalSearchAddon({
            terminal,
            active: true,
        }))
        expect(rendered.result.current.status).toBe('loading')

        rendered.unmount()
        await act(async () => pending.resolve(fixture.addon))

        expect(fixture.addon.dispose).toHaveBeenCalledOnce()
        expect(terminal.loadAddon).not.toHaveBeenCalled()
    })

    it('disposes stale delayed loads on replacement and loads only the new terminal', async () => {
        const firstTerminal = createTerminal()
        const secondTerminal = createTerminal()
        const firstPending = deferred<ReturnType<typeof createAddon>['addon']>()
        const secondPending = deferred<ReturnType<typeof createAddon>['addon']>()
        const first = createAddon()
        const second = createAddon()
        vi.spyOn(terminalSearchAddonLoader, 'load')
            .mockReturnValueOnce(firstPending.promise)
            .mockReturnValueOnce(secondPending.promise)
        const rendered = renderHook(
            ({ terminal }) => useTerminalSearchAddon({ terminal, active: true }),
            { initialProps: { terminal: firstTerminal } },
        )

        rendered.rerender({ terminal: secondTerminal })
        await act(async () => firstPending.resolve(first.addon))
        expect(first.addon.dispose).toHaveBeenCalledOnce()
        expect(firstTerminal.loadAddon).not.toHaveBeenCalled()

        await act(async () => secondPending.resolve(second.addon))
        await waitUntilReady(rendered.result)
        expect(secondTerminal.loadAddon).toHaveBeenCalledWith(second.addon)
    })

    it('reports a safe load error and retries without duplicate live addons', async () => {
        const terminal = createTerminal()
        const fixture = createAddon()
        const pending = deferred<ReturnType<typeof createAddon>['addon']>()
        const load = vi.spyOn(terminalSearchAddonLoader, 'load')
            .mockRejectedValueOnce(new Error('search unavailable'))
            .mockReturnValueOnce(pending.promise)
        const rendered = renderHook(
            ({ active }) => useTerminalSearchAddon({ terminal, active }),
            { initialProps: { active: true } },
        )
        await waitFor(() => expect(rendered.result.current.status).toBe('error'))
        expect(rendered.result.current.error).toBe('search unavailable')
        expect(rendered.result.current.retry).toEqual(expect.any(Function))

        act(() => rendered.result.current.retry?.())
        rendered.rerender({ active: true })
        expect(rendered.result.current.status).toBe('loading')
        expect(load).toHaveBeenCalledTimes(2)

        await act(async () => pending.resolve(fixture.addon))
        await waitUntilReady(rendered.result)
        expect(terminal.loadAddon).toHaveBeenCalledOnce()
        expect(fixture.addon.onDidChangeResults).toHaveBeenCalledOnce()
    })

    it('keeps idle after a delayed loader failure while closed and retries on reopen', async () => {
        const terminal = createTerminal()
        const pending = deferred<ReturnType<typeof createAddon>['addon']>()
        const fixture = createAddon()
        const load = vi.spyOn(terminalSearchAddonLoader, 'load')
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce(fixture.addon)
        const rendered = renderHook(
            ({ active }) => useTerminalSearchAddon({ terminal, active }),
            { initialProps: { active: true } },
        )

        rendered.rerender({ active: false })
        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)
        await act(async () => pending.reject(new Error('stale loader failure')))
        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)

        rendered.rerender({ active: true })
        await waitUntilReady(rendered.result)
        expect(load).toHaveBeenCalledTimes(2)
        expect(terminal.loadAddon).toHaveBeenCalledOnce()
    })

    it('keeps idle after loadAddon throws while closed and retries on reopen', async () => {
        const terminal = createTerminal()
        const pending = deferred<ReturnType<typeof createAddon>['addon']>()
        const stale = createAddon()
        const retry = createAddon()
        const load = vi.spyOn(terminalSearchAddonLoader, 'load')
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce(retry.addon)
        vi.mocked(terminal.loadAddon)
            .mockImplementationOnce(() => {
                throw new Error('stale loadAddon failure')
            })
        const rendered = renderHook(
            ({ active }) => useTerminalSearchAddon({ terminal, active }),
            { initialProps: { active: true } },
        )

        rendered.rerender({ active: false })
        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)
        await act(async () => pending.resolve(stale.addon))
        expect(rendered.result.current).toEqual(EMPTY_TERMINAL_SEARCH_STATE)
        expect(stale.addon.dispose).toHaveBeenCalledOnce()

        rendered.rerender({ active: true })
        await waitUntilReady(rendered.result)
        expect(load).toHaveBeenCalledTimes(2)
        expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    })

    it('does not expose unsafe thrown values in load errors', async () => {
        const terminal = createTerminal()
        vi.spyOn(terminalSearchAddonLoader, 'load').mockRejectedValue({ secret: 'token' })
        const rendered = renderHook(() => useTerminalSearchAddon({
            terminal,
            active: true,
        }))

        await waitFor(() => expect(rendered.result.current.status).toBe('error'))
        expect(rendered.result.current.error).toBe('Unable to load terminal search')
    })
})
