import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from './TerminalView'

const mocks = vi.hoisted(() => {
    const cursorDispose = vi.fn()
    const selectionDispose = vi.fn()
    const resizeDispose = vi.fn()
    const terminal = {
        cols: 80,
        rows: 10,
        element: null as HTMLElement | null,
        textarea: null as HTMLTextAreaElement | null,
        options: { fontFamily: '' },
        buffer: {
            active: {
                viewportY: 0,
                baseY: 0,
                cursorX: 4,
                cursorY: 2,
                length: 10,
                getLine: vi.fn(),
            },
        },
        loadAddon: vi.fn(),
        open: vi.fn(),
        refresh: vi.fn(),
        scrollLines: vi.fn(),
        clearSelection: vi.fn(),
        blur: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        selectAll: vi.fn(),
        getSelection: vi.fn(() => ''),
        getSelectionPosition: vi.fn(),
        onCursorMove: vi.fn(() => ({ dispose: cursorDispose })),
        onSelectionChange: vi.fn(() => ({ dispose: selectionDispose })),
        onResize: vi.fn(() => ({ dispose: resizeDispose })),
        dispose: vi.fn(),
    }
    const emptySearchState = {
        status: 'idle' as const,
        controller: null,
        error: null,
        retry: null,
    }
    const readySearchState = {
        status: 'ready' as const,
        controller: {
            findNext: vi.fn(),
            findPrevious: vi.fn(),
            clear: vi.fn(),
            subscribe: vi.fn(() => vi.fn()),
        },
        error: null,
        retry: null,
    }

    return {
        terminal,
        emptySearchState,
        readySearchState,
        useTerminalSearchAddon: vi.fn(),
        cursorDispose,
        selectionDispose,
        resizeDispose,
        fit: vi.fn(),
        fitDispose: vi.fn(),
        webLinksDispose: vi.fn(),
        canvasDispose: vi.fn(),
        observerDisconnect: vi.fn(),
    }
})

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(function Terminal() {
        return mocks.terminal
    }),
}))

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(function FitAddon() {
        return {
            fit: mocks.fit,
            dispose: mocks.fitDispose,
        }
    }),
}))

vi.mock('@xterm/addon-web-links', () => ({
    WebLinksAddon: vi.fn(function WebLinksAddon() {
        return { dispose: mocks.webLinksDispose }
    }),
}))

vi.mock('@xterm/addon-canvas', () => ({
    CanvasAddon: vi.fn(function CanvasAddon() {
        return { dispose: mocks.canvasDispose }
    }),
}))

vi.mock('./useTerminalSearchAddon', () => ({
    useTerminalSearchAddon: mocks.useTerminalSearchAddon,
}))

vi.mock('@/lib/terminalFont', () => ({
    ensureBuiltinFontLoaded: vi.fn().mockResolvedValue(false),
    getFontProvider: () => ({
        getFontFamily: () => 'monospace',
    }),
}))

vi.mock('@/hooks/useTerminalFontSize', () => ({
    getCompactTerminalFontSize: () => 12,
    getInitialTerminalFontSize: () => 14,
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'terminal.interaction.choice': 'Terminal action',
            'terminal.interaction.input': 'Input',
            'terminal.interaction.enter': 'Enter',
            'terminal.interaction.select': 'Select',
            'terminal.interaction.selectionToolbar': 'Selection actions',
            'terminal.interaction.selectionStart': 'Selection start',
            'terminal.interaction.selectionEnd': 'Selection end',
            'terminal.interaction.copy': 'Copy',
            'terminal.interaction.selectAll': 'Select all',
            'terminal.interaction.cancel': 'Cancel',
            'terminal.interaction.copied': 'Copied',
            'terminal.interaction.copyFailed': 'Could not copy',
        }[key] ?? key),
    }),
}))

describe('TerminalView mobile interaction integration', () => {
    let mobile = true

    beforeEach(() => {
        vi.clearAllMocks()
        mobile = true
        mocks.terminal.element = null
        mocks.terminal.textarea = null
        mocks.useTerminalSearchAddon.mockImplementation(
            ({ terminal }: { terminal: unknown }) => (
                terminal ? mocks.readySearchState : mocks.emptySearchState
            ),
        )
        mocks.terminal.open.mockImplementation((host: HTMLElement) => {
            const terminalElement = document.createElement('div')
            terminalElement.className = 'xterm'
            const screenElement = document.createElement('div')
            screenElement.className = 'xterm-screen'
            screenElement.getBoundingClientRect = () => ({
                x: 0,
                y: 0,
                top: 0,
                right: 320,
                bottom: 200,
                left: 0,
                width: 320,
                height: 200,
                toJSON: () => ({}),
            })
            const textarea = document.createElement('textarea')
            terminalElement.append(screenElement, textarea)
            host.appendChild(terminalElement)
            mocks.terminal.element = terminalElement
            mocks.terminal.textarea = textarea
        })

        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: mobile,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })))
        vi.stubGlobal('ResizeObserver', class ResizeObserver {
            observe() {}
            disconnect() {
                mocks.observerDisconnect()
            }
        })
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0)
            return 1
        })
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    function tapTerminal() {
        const terminalElement = mocks.terminal.element
        expect(terminalElement).not.toBeNull()
        fireEvent.touchStart(terminalElement!, {
            touches: [{ identifier: 1, clientX: 100, clientY: 120 }],
        })
        fireEvent.touchEnd(terminalElement!, {
            changedTouches: [{ identifier: 1, clientX: 100, clientY: 120 }],
        })
    }

    it('opens xterm in its own host and defers mobile actions until after the tap task', async () => {
        const rendered = render(<TerminalView />)

        const root = rendered.container.firstElementChild
        const host = mocks.terminal.element?.parentElement
        expect(root).toHaveClass('relative', 'overflow-hidden')
        expect(host).not.toBe(root)
        expect(host).toHaveClass('h-full', 'w-full')
        expect(mocks.terminal.textarea).toHaveProperty('readOnly', true)
        expect(screen.queryByRole('toolbar', { name: 'Terminal action' })).not.toBeInTheDocument()

        tapTerminal()

        expect(screen.queryByRole('toolbar', { name: 'Terminal action' })).not.toBeInTheDocument()
        expect(await screen.findByRole('toolbar', { name: 'Terminal action' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Input' }))
        expect(mocks.terminal.textarea).toHaveProperty('readOnly', false)
        expect(screen.queryByRole('toolbar', { name: 'Terminal action' })).not.toBeInTheDocument()
    })

    it('leaves the xterm textarea writable on desktop', () => {
        mobile = false

        render(<TerminalView />)
        tapTerminal()

        expect(mocks.terminal.textarea).toHaveProperty('readOnly', false)
        expect(screen.queryByRole('toolbar', { name: 'Terminal action' })).not.toBeInTheDocument()
        expect(mocks.terminal.onCursorMove).not.toHaveBeenCalled()
    })

    it('uses the dedicated high-contrast terminal selection color', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: (property: string) => (
                property === '--app-terminal-selection-bg'
                    ? 'rgba(79, 70, 229, 0.36)'
                    : ''
            ),
        } as CSSStyleDeclaration)

        render(<TerminalView />)

        expect(vi.mocked(Terminal)).toHaveBeenCalledWith(expect.objectContaining({
            theme: expect.objectContaining({
                selectionBackground: 'rgba(79, 70, 229, 0.36)',
            }),
        }))
    })

    it('enables the proposed xterm API required by search decorations', () => {
        render(<TerminalView />)

        expect(vi.mocked(Terminal)).toHaveBeenCalledWith(expect.objectContaining({
            allowProposedApi: true,
        }))
    })

    it('clears a visible mobile choice when dismissal is requested', async () => {
        const rendered = render(<TerminalView dismissMobileInteraction={false} />)
        tapTerminal()
        expect(await screen.findByRole('toolbar', { name: 'Terminal action' })).toBeInTheDocument()

        rendered.rerender(<TerminalView dismissMobileInteraction={true} />)

        expect(screen.queryByRole('toolbar', { name: 'Terminal action' })).not.toBeInTheDocument()
        expect(mocks.terminal.clearSelection).toHaveBeenCalled()
    })

    it('disposes xterm resources and controller subscriptions once on unmount', () => {
        const rendered = render(<TerminalView />)

        expect(mocks.terminal.onCursorMove).toHaveBeenCalledOnce()
        expect(mocks.terminal.onSelectionChange).toHaveBeenCalledOnce()
        expect(mocks.terminal.onResize).toHaveBeenCalledOnce()

        rendered.unmount()

        expect(mocks.cursorDispose).toHaveBeenCalledOnce()
        expect(mocks.selectionDispose).toHaveBeenCalledOnce()
        expect(mocks.resizeDispose).toHaveBeenCalledOnce()
        expect(mocks.terminal.dispose).toHaveBeenCalledOnce()
        expect(mocks.fitDispose).toHaveBeenCalledOnce()
        expect(mocks.webLinksDispose).toHaveBeenCalledOnce()
        expect(mocks.canvasDispose).toHaveBeenCalledOnce()
        expect(mocks.observerDisconnect).toHaveBeenCalledOnce()
    })

    it('publishes the owned terminal search state and resets it on cleanup', () => {
        const onSearchStateChange = vi.fn()
        const rendered = render(
            <TerminalView
                searchActive
                onSearchStateChange={onSearchStateChange}
            />,
        )

        expect(mocks.useTerminalSearchAddon).toHaveBeenLastCalledWith({
            terminal: mocks.terminal,
            active: true,
        })
        expect(onSearchStateChange).toHaveBeenLastCalledWith(mocks.readySearchState)

        rendered.unmount()

        expect(onSearchStateChange).toHaveBeenLastCalledWith(mocks.emptySearchState)
    })
})
