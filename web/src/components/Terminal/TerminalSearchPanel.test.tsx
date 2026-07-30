import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    TerminalSearchController,
    TerminalSearchResults,
    TerminalSearchState,
} from './terminalSearch'
import { TerminalSearchPanel } from './TerminalSearchPanel'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        locale: 'en',
        t: (key: string) => key,
    }),
}))

type ControllerFixture = {
    controller: TerminalSearchController
    clear: ReturnType<typeof vi.fn>
    findNext: ReturnType<typeof vi.fn>
    findPrevious: ReturnType<typeof vi.fn>
    unsubscribe: ReturnType<typeof vi.fn>
    emit: (results: TerminalSearchResults) => void
}

function controllerFixture(): ControllerFixture {
    const listeners = new Set<(results: TerminalSearchResults) => void>()
    const clear = vi.fn()
    const findNext = vi.fn(() => true)
    const findPrevious = vi.fn(() => true)
    const unsubscribe = vi.fn()
    const controller: TerminalSearchController = {
        clear,
        findNext,
        findPrevious,
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
                unsubscribe()
            }
        },
    }
    return {
        controller,
        clear,
        findNext,
        findPrevious,
        unsubscribe,
        emit(results) {
            for (const listener of listeners) listener(results)
        },
    }
}

function readyState(controller: TerminalSearchController): TerminalSearchState {
    return {
        status: 'ready',
        controller,
        error: null,
        retry: null,
    }
}

function renderReady(overrides: {
    fixture?: ControllerFixture
    onClose?: () => void
} = {}) {
    const fixture = overrides.fixture ?? controllerFixture()
    const onClose = overrides.onClose ?? vi.fn()
    const result = render(
        <TerminalSearchPanel
            state={readyState(fixture.controller)}
            onClose={onClose}
        />,
    )
    return { ...result, fixture, onClose }
}

function searchbox(): HTMLInputElement {
    return screen.getByRole('searchbox', {
        name: 'terminal.search.input',
    }) as HTMLInputElement
}

function advance(milliseconds: number) {
    act(() => {
        vi.advanceTimersByTime(milliseconds)
    })
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
})

describe('TerminalSearchPanel search input', () => {
    it('opens without focusing or searching and configures mobile-safe text entry', () => {
        const { fixture } = renderReady()
        const input = searchbox()

        expect(input).not.toHaveFocus()
        expect(input).not.toHaveAttribute('autofocus')
        expect(input).toHaveAttribute('maxlength', '256')
        expect(input).toHaveAttribute('autocapitalize', 'none')
        expect(input).toHaveAttribute('autocorrect', 'off')
        expect(input).toHaveAttribute('spellcheck', 'false')
        expect(input).toHaveAttribute('enterkeyhint', 'search')
        expect(fixture.findNext).not.toHaveBeenCalled()
        expect(fixture.findPrevious).not.toHaveBeenCalled()
    })

    it('debounces incremental search for exactly 150ms', () => {
        const { fixture } = renderReady()

        fireEvent.change(searchbox(), { target: { value: 'needle' } })
        advance(149)
        expect(fixture.findNext).not.toHaveBeenCalled()

        advance(1)
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
        expect(fixture.findNext).toHaveBeenCalledWith('needle', {
            caseSensitive: false,
            incremental: true,
        })
    })

    it('submits immediately from the mobile Search key and cancels debounce', () => {
        const { fixture } = renderReady()

        fireEvent.change(searchbox(), { target: { value: 'needle' } })
        fireEvent.submit(searchbox().closest('form')!)

        expect(fixture.findNext).toHaveBeenCalledOnce()
        expect(fixture.findNext).toHaveBeenCalledWith('needle', {
            caseSensitive: false,
            incremental: false,
        })
        advance(150)
        expect(fixture.findNext).toHaveBeenCalledOnce()
    })

    it('waits for IME composition to end before starting one debounce', () => {
        const { fixture } = renderReady()
        const input = searchbox()

        fireEvent.compositionStart(input)
        fireEvent.change(input, { target: { value: '日本' } })
        advance(500)
        expect(fixture.findNext).not.toHaveBeenCalled()

        fireEvent.compositionEnd(input, { data: '日本' })
        advance(149)
        expect(fixture.findNext).not.toHaveBeenCalled()
        advance(1)
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
        expect(fixture.findNext).toHaveBeenCalledWith('日本', {
            caseSensitive: false,
            incremental: true,
        })
    })

    it.each(['loading', 'idle'] as const)(
        'resets interrupted IME composition after becoming %s',
        (status) => {
            const { fixture, rerender } = renderReady()
            const input = searchbox()

            fireEvent.compositionStart(input)
            fireEvent.change(input, { target: { value: '未確定' } })
            rerender(
                <TerminalSearchPanel
                    state={{
                        status,
                        controller: null,
                        error: null,
                        retry: null,
                    }}
                    onClose={vi.fn()}
                />,
            )
            rerender(
                <TerminalSearchPanel
                    state={readyState(fixture.controller)}
                    onClose={vi.fn()}
                />,
            )

            fireEvent.change(searchbox(), { target: { value: 'ready' } })
            advance(150)

            expect(fixture.findNext).toHaveBeenCalledTimes(1)
            expect(fixture.findNext).toHaveBeenCalledWith('ready', {
                caseSensitive: false,
                incremental: true,
            })
        },
    )

    it('hard-truncates programmatic input to 256 characters', () => {
        const { fixture } = renderReady()
        const longQuery = 'x'.repeat(300)

        fireEvent.change(searchbox(), { target: { value: longQuery } })

        expect(searchbox()).toHaveValue('x'.repeat(256))
        advance(150)
        expect(fixture.findNext).toHaveBeenCalledWith('x'.repeat(256), {
            caseSensitive: false,
            incremental: true,
        })
    })
})

describe('TerminalSearchPanel controls', () => {
    it('reruns a non-empty query immediately when case sensitivity changes', () => {
        const { fixture } = renderReady()
        fireEvent.change(searchbox(), { target: { value: 'Needle' } })
        advance(150)
        fixture.findNext.mockClear()

        const toggle = screen.getByRole('button', {
            name: 'terminal.search.caseSensitive',
        })
        expect(toggle).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(toggle)

        expect(toggle).toHaveAttribute('aria-pressed', 'true')
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
        expect(fixture.findNext).toHaveBeenCalledWith('Needle', {
            caseSensitive: true,
            incremental: true,
        })
        advance(150)
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
    })

    it('defers a case-sensitive IME query until composition ends', () => {
        const { fixture } = renderReady()
        const input = searchbox()
        const toggle = screen.getByRole('button', {
            name: 'terminal.search.caseSensitive',
        })

        fireEvent.compositionStart(input)
        fireEvent.change(input, { target: { value: '未確定' } })
        fireEvent.click(toggle)

        expect(toggle).toHaveAttribute('aria-pressed', 'true')
        advance(500)
        expect(fixture.findNext).not.toHaveBeenCalled()

        fireEvent.change(input, { target: { value: '確定' } })
        fireEvent.compositionEnd(input, { data: '確定' })
        expect(fixture.findNext).not.toHaveBeenCalled()
        advance(149)
        expect(fixture.findNext).not.toHaveBeenCalled()
        advance(1)
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
        expect(fixture.findNext).toHaveBeenCalledWith('確定', {
            caseSensitive: true,
            incremental: true,
        })
        advance(500)
        expect(fixture.findNext).toHaveBeenCalledTimes(1)
    })

    it('disables previous and next navigation during IME composition', () => {
        const { fixture } = renderReady()
        const input = searchbox()
        const previous = screen.getByRole('button', {
            name: 'terminal.search.previous',
        })
        const next = screen.getByRole('button', {
            name: 'terminal.search.next',
        })

        fireEvent.compositionStart(input)
        fireEvent.change(input, { target: { value: '未確定' } })

        expect(previous).toBeDisabled()
        expect(next).toBeDisabled()
        fireEvent.click(previous)
        fireEvent.click(next)
        expect(fixture.findPrevious).not.toHaveBeenCalled()
        expect(fixture.findNext).not.toHaveBeenCalled()
    })

    it('navigates previous and next immediately with non-incremental search', () => {
        const { fixture } = renderReady()
        const previous = screen.getByRole('button', {
            name: 'terminal.search.previous',
        })
        const next = screen.getByRole('button', {
            name: 'terminal.search.next',
        })

        expect(previous).toBeDisabled()
        expect(next).toBeDisabled()
        fireEvent.change(searchbox(), { target: { value: 'needle' } })
        expect(previous).toBeEnabled()
        expect(next).toBeEnabled()

        fireEvent.click(previous)
        fireEvent.click(next)

        expect(fixture.findPrevious).toHaveBeenCalledWith('needle', {
            caseSensitive: false,
            incremental: false,
        })
        expect(fixture.findNext).toHaveBeenCalledWith('needle', {
            caseSensitive: false,
            incremental: false,
        })
    })

    it('shows a one-based match index and the overflow count', () => {
        const { fixture } = renderReady()

        expect(screen.getByText('0/0')).toBeVisible()
        act(() => {
            fixture.emit({
                resultIndex: 0,
                resultCount: 23,
                limitExceeded: false,
            })
        })
        expect(screen.getByText('1/23')).toBeVisible()

        act(() => {
            fixture.emit({
                resultIndex: 999,
                resultCount: 1_000,
                limitExceeded: true,
            })
        })
        expect(screen.getByText('1000+')).toBeVisible()
        expect(screen.queryByText('1000/1000+')).not.toBeInTheDocument()
    })

    it('clears decorations and result count immediately for an empty query', () => {
        const { fixture } = renderReady()
        fireEvent.change(searchbox(), { target: { value: 'needle' } })
        act(() => {
            fixture.emit({
                resultIndex: 2,
                resultCount: 4,
                limitExceeded: false,
            })
        })
        expect(screen.getByText('3/4')).toBeVisible()

        fireEvent.change(searchbox(), { target: { value: '' } })

        expect(fixture.clear).toHaveBeenCalledTimes(1)
        expect(screen.getByText('0/0')).toBeVisible()
        expect(screen.getByRole('button', {
            name: 'terminal.search.previous',
        })).toBeDisabled()
        expect(screen.getByRole('button', {
            name: 'terminal.search.next',
        })).toBeDisabled()
        advance(150)
        expect(fixture.findNext).not.toHaveBeenCalled()
    })
})

describe('TerminalSearchPanel lifecycle', () => {
    it('disposes the result subscription when the controller changes and on unmount', () => {
        const first = controllerFixture()
        const second = controllerFixture()
        const { rerender, unmount } = renderReady({ fixture: first })

        rerender(
            <TerminalSearchPanel
                state={readyState(second.controller)}
                onClose={vi.fn()}
            />,
        )
        expect(first.unsubscribe).toHaveBeenCalledTimes(1)
        expect(screen.getByText('0/0')).toBeVisible()

        unmount()
        expect(second.unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('cancels pending searches on controller change and unmount', () => {
        const first = controllerFixture()
        const second = controllerFixture()
        const { rerender, unmount } = renderReady({ fixture: first })

        fireEvent.change(searchbox(), { target: { value: 'first' } })
        rerender(
            <TerminalSearchPanel
                state={readyState(second.controller)}
                onClose={vi.fn()}
            />,
        )
        advance(150)
        expect(first.findNext).not.toHaveBeenCalled()
        expect(second.findNext).not.toHaveBeenCalled()

        fireEvent.change(searchbox(), { target: { value: 'second' } })
        unmount()
        advance(150)
        expect(second.findNext).not.toHaveBeenCalled()
    })

    it('closes without allowing a pending callback to search after unmount', () => {
        const fixture = controllerFixture()
        function Host() {
            const [open, setOpen] = useState(true)
            return open ? (
                <TerminalSearchPanel
                    state={readyState(fixture.controller)}
                    onClose={() => setOpen(false)}
                />
            ) : null
        }

        render(<Host />)
        fireEvent.change(searchbox(), { target: { value: 'needle' } })
        fireEvent.click(screen.getByRole('button', {
            name: 'terminal.search.close',
        }))
        advance(150)

        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
        expect(fixture.findNext).not.toHaveBeenCalled()
        expect(fixture.unsubscribe).toHaveBeenCalledTimes(1)
    })
})

describe('TerminalSearchPanel availability and accessibility', () => {
    it('shows loading while keeping close available', () => {
        const onClose = vi.fn()
        render(
            <TerminalSearchPanel
                state={{
                    status: 'loading',
                    controller: null,
                    error: null,
                    retry: null,
                }}
                onClose={onClose}
            />,
        )

        expect(screen.getByRole('status')).toHaveTextContent('terminal.search.loading')
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', {
            name: 'terminal.search.close',
        }))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows a retryable error and invokes retry', () => {
        const retry = vi.fn()
        const onClose = vi.fn()
        render(
            <TerminalSearchPanel
                state={{
                    status: 'error',
                    controller: null,
                    error: 'Search failed',
                    retry,
                }}
                onClose={onClose}
            />,
        )

        expect(screen.getByRole('alert')).toHaveTextContent('Search failed')
        fireEvent.click(screen.getByRole('button', {
            name: 'terminal.search.retry',
        }))
        expect(retry).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', {
            name: 'terminal.search.close',
        })).toBeEnabled()
    })

    it('uses a labelled floating region, reduced-motion styling, and 44px targets', () => {
        renderReady()

        const region = screen.getByRole('region', {
            name: 'terminal.search.title',
        })
        expect(region).toHaveClass('motion-reduce:transition-none')
        expect(region.tagName).toBe('FORM')
        expect(region).toHaveClass(
            'grid',
            'grid-cols-[minmax(0,1fr)_44px]',
            'lg:flex',
        )
        expect(screen.getByTestId('terminal-search-controls')).toHaveClass(
            'col-span-2',
            'lg:contents',
        )
        expect(region.className).toContain('bg-[var(--app-bg)]')
        expect(searchbox()).toHaveClass('min-h-11')
        for (const button of screen.getAllByRole('button')) {
            expect(button).toHaveAttribute('type', 'button')
            expect(button).toHaveClass('min-h-11')
            expect(button).toHaveClass('min-w-11')
        }
    })
})
