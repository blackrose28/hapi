import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalState } from '@hapi/protocol'
import { en, viVN, zhCN } from '@/lib/locales'
import { SessionTerminalTabs } from './SessionTerminalTabs'
import {
    EMPTY_TERMINAL_SEARCH_STATE,
    type TerminalSearchController,
    type TerminalSearchState,
} from './terminalSearch'

vi.mock('@/components/Terminal/TerminalSnippetPanel', () => ({
    TerminalSnippetPanel: (props: {
        api: unknown
        disabled: boolean
        onInsert: (command: string) => boolean
        onClose: () => void
        onInserted?: () => void
    }) => {
        const [search, setSearch] = useState('')
        const [editing, setEditing] = useState(false)
        return (
            <section role="region" aria-label="Snippet content" data-api={String(Boolean(props.api))}>
                <input
                    aria-label="Search snippets"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <button type="button" onClick={() => setEditing(true)}>New</button>
                {editing ? <input aria-label="Name" /> : null}
                <button
                    type="button"
                    onClick={() => {
                        if (props.onInsert('git status --short')) {
                            props.onInserted?.()
                            props.onClose()
                        }
                    }}
                >
                    Insert Git status
                </button>
            </section>
        )
    },
}))

vi.mock('@/components/Terminal/TerminalSearchPanel', () => ({
    TerminalSearchPanel: function TerminalSearchPanel(props: {
        state: TerminalSearchState
        onClose: () => void
    }) {
        const [query, setQuery] = useState('')
        return (
            <section
                role="region"
                aria-label="Search terminal output"
                data-search-status={props.state.status}
            >
                <input
                    aria-label="Search terminal output"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <button type="button" onClick={props.onClose}>Close search</button>
            </section>
        )
    },
}))

var mocks: {
    controller: null | {
        state: { status: 'idle' | 'connecting' | 'connected' | 'error'; error?: string }
        lastError: string | null
        recoveryReason: 'cli_lost' | null
        listLoaded: boolean
        terminals: TerminalState[]
        connect: ReturnType<typeof vi.fn>
        disconnect: ReturnType<typeof vi.fn>
        subscribe: ReturnType<typeof vi.fn>
        create: ReturnType<typeof vi.fn>
        write: ReturnType<typeof vi.fn>
        resize: ReturnType<typeof vi.fn>
        closeOne: ReturnType<typeof vi.fn>
        keepalive: ReturnType<typeof vi.fn>
        onOutput: ReturnType<typeof vi.fn>
        onExit: ReturnType<typeof vi.fn>
        onWarning: ReturnType<typeof vi.fn>
        requestHistory: ReturnType<typeof vi.fn>
        onHistory: ReturnType<typeof vi.fn>
        clearLastError: ReturnType<typeof vi.fn>
    }
    terminalMounts: Array<{
        onMount?: (terminal: unknown) => void
        onResize?: (cols: number, rows: number) => void
        mobileInteractionEnabled?: boolean
        dismissMobileInteraction?: boolean
        searchActive?: boolean
        onSearchStateChange?: (state: TerminalSearchState) => void
    }>
    autoMountTerminal: null | (() => unknown)
    emittedEvents: string[]
} = {
    controller: null,
    terminalMounts: [],
    autoMountTerminal: null,
    emittedEvents: []
}


vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        token: 'token-1',
        baseUrl: 'http://hub.local',
        api: { cacheScope: 'session-test' },
    })
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useSessionTerminalSocket: () => mocks.controller
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: (props: {
        onMount?: (terminal: unknown) => void
        onResize?: (cols: number, rows: number) => void
        mobileInteractionEnabled?: boolean
        dismissMobileInteraction?: boolean
        searchActive?: boolean
        onSearchStateChange?: (state: TerminalSearchState) => void
    }) => {
        mocks.terminalMounts.push(props)
        useEffect(() => {
            const terminal = mocks.autoMountTerminal?.()
            if (terminal) {
                props.onMount?.(terminal)
            }
        }, [])
        return <div data-testid="terminal-view" />
    }
}))


vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'button.paste': 'Paste',
            'button.cancel': 'Cancel',
            'terminal.paste.fallbackTitle': 'Paste input',
            'terminal.paste.fallbackDescription': 'Clipboard read is unavailable. Paste your text below.',
            'terminal.paste.placeholder': 'Paste terminal input here…',
            'terminal.controls.toolbar': 'Terminal controls',
            'terminal.controls.paste': 'Paste',
            'terminal.controls.snippets': 'Snippets',
            'terminal.controls.search': 'Search',
            'terminal.controls.history': 'History',
            'terminal.controls.keys': 'Keys',
            'terminal.controls.more': 'More',
            'terminal.controls.pasted': 'Pasted',
            'terminal.controls.keysPanel': 'Terminal helper keys',
            'terminal.controls.morePanel': 'More terminal keys',
            'terminal.controls.navigation': 'Navigation',
            'terminal.controls.functionKeys': 'Function keys',
            'terminal.controls.symbols': 'Symbols',
            'terminal.lifecycle.hint': 'Closing this window only detaches. Terminals live with the session and stop only when you close them, archive the session, or timeout limits apply.',
            'terminal.limit.full': 'Close an existing terminal before creating another.',
            'terminal.new': 'New terminal',
            'terminal.close.confirmTitle': 'Stop terminal process?',
            'terminal.close.confirmDescription': 'Stop process and close this terminal tab?',
            'terminal.close.confirmAction': 'Stop process and close',
            'terminal.keep': 'Keep terminal',
            'terminal.warning.idle': 'Terminal is idle and will stop soon unless activity resumes.',
            'terminal.warning.age': 'Terminal is near its maximum lifetime hard limit and will stop soon.',
            'terminal.warning.badge.idle': 'Idle warning',
            'terminal.warning.badge.age': 'Age warning',
            'terminal.closed.idle': 'Closed after idle timeout.',
            'terminal.closed.age': 'Closed after hard timeout.',
            'terminal.closed.user': 'Closed by user.',
            'terminal.closed.archive': 'Closed because session was archived.',
            'terminal.closed.exited': 'Process exited.',
            'terminal.closed.lost': 'CLI connection was lost.',
            'terminal.recovery.cliLost': 'CLI restarted or disconnected. Previous terminals may be lost.',
            'terminal.closed.spawn': 'CLI could not spawn this terminal.',
            'terminal.closed.generic': 'Terminal is closed.',
            'terminal.createNew': 'Create new terminal',
            'terminal.unsupported': 'Remote terminal is not supported on this host.',
            'terminal.inactive': 'Session is inactive. Terminal is unavailable.',
            'terminal.history.title': 'History',
            'terminal.history.insertOnly': 'Insert only · does not run',
            'terminal.history.count': '1 command',
            'terminal.history.searchPlaceholder': 'Search history',
            'terminal.history.refresh': 'Refresh history',
            'terminal.history.close': 'Close history',
            'terminal.history.loading': 'Loading history…',
            'terminal.history.empty': 'No commands yet.',
            'terminal.history.noMatches': 'No matching commands.',
            'terminal.history.unsupported': 'Unsupported shell.',
            'terminal.history.notReady': 'History not ready.',
            'terminal.history.error': 'History failed.',
            'terminal.history.retry': 'Retry history',
            'terminal.history.insert': 'Insert history command',
            'terminal.history.inserted': 'Inserted · not executed',
            'terminal.history.insertFailed': 'Could not insert command.',
        }[key] ?? key)
    })
}))

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: ({ onClick }: { onClick: () => void }) => ({ onClick })
}))

function state(id: string, status: TerminalState['status'] = 'running', closeReason: TerminalState['closeReason'] = null): TerminalState {
    return {
        scopeType: 'session',
        sessionId: 'session-1',
        terminalId: id,
        label: id,
        cwd: '/repo',
        cols: 80,
        rows: 24,
        status,
        closeReason,
        createdAt: 1,
        lastActivityAt: 1,
        idleWarningAt: null,
        hardExpiresAt: 2
    }
}

function makeController(terminals: TerminalState[] = []) {
    return {
        state: { status: 'connected' as const },
        lastError: null,
        recoveryReason: null,
        listLoaded: true,
        terminals,
        connect: vi.fn(),
        disconnect: vi.fn(),
        subscribe: vi.fn(),
        create: vi.fn((input) => {
            mocks.emittedEvents.push(`terminal:create:${input.terminalId}`)
            return true
        }),
        write: vi.fn(() => true),
        resize: vi.fn(),
        closeOne: vi.fn((terminalId: string) => mocks.emittedEvents.push(`terminal:close:${terminalId}`)),
        keepalive: vi.fn(),
        onOutput: vi.fn(),
        onExit: vi.fn(),
        onWarning: vi.fn(),
        requestHistory: vi.fn(() => true),
        onHistory: vi.fn(),
        clearLastError: vi.fn()
    }
}

function searchController(): TerminalSearchController {
    return {
        findNext: vi.fn(() => true),
        findPrevious: vi.fn(() => true),
        clear: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
    }
}

function readySearchState(controller = searchController()): TerminalSearchState {
    return {
        status: 'ready',
        controller,
        error: null,
        retry: null,
    }
}

function renderTabs(props: Partial<React.ComponentProps<typeof SessionTerminalTabs>> = {}) {
    return render(
        <SessionTerminalTabs
            sessionId="session-1"
            active={true}
            terminalSupported={true}
            {...props}
        />
    )
}

function setDesktopViewport(desktop: boolean) {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)' ? desktop : !desktop,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })))
}

describe('SessionTerminalTabs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.terminalMounts = []
        mocks.autoMountTerminal = null
        mocks.emittedEvents = []
        mocks.controller = makeController()
        setDesktopViewport(true)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('marks the terminal control dock as mobile and tablet only', () => {
        mocks.controller = makeController([state('t1')])

        renderTabs()

        expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toHaveClass('lg:hidden')
    })

    it('closes the active dock panel when terminal content is tapped', () => {
        mocks.controller = makeController([state('t1')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        expect(screen.getByRole('region', { name: 'More terminal keys' })).toBeInTheDocument()

        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
        expect(screen.queryByRole('region', { name: 'More terminal keys' })).not.toBeInTheDocument()
    })

    it('clears the selected dock tool when the session terminal tab changes', () => {
        mocks.controller = makeController([state('t1'), state('t2')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        fireEvent.click(screen.getByRole('button', { name: 't2' }))

        expect(screen.queryByRole('region', { name: 'More terminal keys' })).not.toBeInTheDocument()
    })

    it('routes a snippet exactly to the active session terminal without focusing xterm', () => {
        const focus = vi.fn()
        mocks.autoMountTerminal = () => ({
            focus,
            write: vi.fn(),
            onData: vi.fn(() => ({ dispose: vi.fn() })),
        })
        mocks.controller = makeController([state('t1')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(screen.getByRole('region', { name: 'Snippet content' })).toHaveAttribute(
            'data-api',
            'true',
        )
        expect(mocks.terminalMounts.at(-1)?.dismissMobileInteraction).toBe(true)
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))

        expect(mocks.controller.write).toHaveBeenCalledWith('t1', 'git status --short')
        expect(mocks.controller.write.mock.calls[0][1]).not.toMatch(/[\r\n]/)
        expect(focus).not.toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('terminal.snippets.inserted')
    })

    it('closes Snippets when session terminal content is tapped or its tab changes', () => {
        mocks.controller = makeController([state('t1'), state('t2')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(screen.getByRole('region', { name: 'Snippet content' })).toBeVisible()
        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 't2' }))
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
    })

    it('drops stale Snippets state when the active session terminal disconnects', () => {
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Search snippets' }), {
            target: { value: 'stale search' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible()

        mocks.controller = {
            ...mocks.controller,
            state: { status: 'idle' as const },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        mocks.controller = {
            ...mocks.controller,
            state: { status: 'connected' as const },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(screen.getByRole('textbox', { name: 'Search snippets' })).toHaveValue('')
        expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    })

    it('clears snippet feedback when switching session terminal context', () => {
        mocks.controller = makeController([state('t1'), state('t2')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
        expect(screen.getByRole('status')).toHaveTextContent('terminal.snippets.inserted')

        fireEvent.click(screen.getByRole('button', { name: 't2' }))

        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('coordinates mobile terminal interaction with terminal availability and dock tools', () => {
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()

        expect(mocks.terminalMounts.at(-1)).toMatchObject({
            mobileInteractionEnabled: true,
            dismissMobileInteraction: false,
        })

        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        expect(mocks.terminalMounts.at(-1)).toMatchObject({
            mobileInteractionEnabled: true,
            dismissMobileInteraction: true,
        })

        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={false}
                terminalSupported={true}
            />,
        )
        expect(mocks.terminalMounts.at(-1)?.mobileInteractionEnabled).toBe(false)
    })

    it('opens Search and Snippets from desktop header controls', () => {
        mocks.controller = makeController([state('t1')])
        renderTabs()

        const search = screen.getByRole('button', {
            name: 'terminal.search.title',
        })
        const snippets = screen.getByRole('button', {
            name: 'terminal.snippets.title',
        })
        expect(search).toHaveClass('hidden', 'lg:grid')
        expect(snippets).toHaveClass('hidden', 'lg:grid')

        fireEvent.click(search)
        expect(search).toHaveAttribute('aria-pressed', 'true')
        expect(search).toHaveClass('bg-violet-500/10')
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(true)
        fireEvent.change(screen.getByRole('textbox', {
            name: 'Search terminal output',
        }), {
            target: { value: 'needle' },
        })

        fireEvent.click(snippets)
        expect(snippets).toHaveAttribute('aria-pressed', 'true')
        expect(snippets).toHaveClass('bg-violet-500/10')
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(true)
        expect(screen.getByRole('region', { name: 'Snippet content' }))
            .toBeInTheDocument()

        fireEvent.click(search)
        expect(screen.getByRole('textbox', {
            name: 'Search terminal output',
        })).toHaveValue('needle')
    })

    it('loads desktop History and inserts the selected command without Enter', () => {
        setDesktopViewport(true)
        mocks.controller = makeController([state('t1')])
        renderTabs()

        fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]!)

        expect(mocks.controller.requestHistory).toHaveBeenCalledWith(
            't1',
            expect.any(String),
            100,
        )
        const historyListener = mocks.controller.onHistory.mock.calls.at(-1)?.[0]
        act(() => historyListener?.({
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: mocks.controller?.requestHistory.mock.calls.at(-1)?.[1],
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 4, command: 'git status' }],
        }))

        fireEvent.click(screen.getByRole('button', {
            name: 'Insert history command',
        }))
        expect(mocks.controller.write).toHaveBeenCalledWith('t1', 'git status')
        expect(mocks.controller.write).not.toHaveBeenCalledWith('t1', 'git status\r')
    })

    it('scopes desktop Search shortcut without handling Escape', () => {
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()

        const openEvent = new KeyboardEvent('keydown', {
            key: 'f',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        })
        act(() => document.dispatchEvent(openEvent))
        expect(openEvent.defaultPrevented).toBe(true)
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(true)

        const controller = searchController()
        act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.(
            readySearchState(controller),
        ))
        const repeatedOpenEvent = new KeyboardEvent('keydown', {
            key: 'f',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        })
        act(() => document.dispatchEvent(repeatedOpenEvent))
        expect(controller.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'ready')

        const closeEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        })
        act(() => document.dispatchEvent(closeEvent))
        expect(closeEvent.defaultPrevented).toBe(false)
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(true)
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toBeVisible()

        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
                interactionActive={false}
            />,
        )
        const inactiveEvent = new KeyboardEvent('keydown', {
            key: 'f',
            metaKey: true,
            bubbles: true,
            cancelable: true,
        })
        act(() => document.dispatchEvent(inactiveEvent))
        expect(inactiveEvent.defaultPrevented).toBe(false)
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(false)
    })

    it('retains desktop Search on icon toggle and clears it from the panel close button', () => {
        const focus = vi.fn()
        mocks.autoMountTerminal = () => ({
            focus,
            write: vi.fn(),
            onData: vi.fn(() => ({ dispose: vi.fn() })),
        })
        mocks.controller = makeController([state('t1')])
        renderTabs()

        const desktopSearch = screen.getByRole('button', {
            name: 'terminal.search.title',
        })
        fireEvent.click(desktopSearch)
        expect(mocks.terminalMounts.at(-1)).toMatchObject({
            searchActive: true,
            dismissMobileInteraction: true,
        })

        act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.({
            status: 'loading',
            controller: null,
            error: null,
            retry: null,
        }))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'loading')

        act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.({
            status: 'error',
            controller: null,
            error: 'failed',
            retry: vi.fn(),
        }))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'error')

        const controller = searchController()
        act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.(
            readySearchState(controller),
        ))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'ready')

        fireEvent.change(screen.getByRole('textbox', {
            name: 'Search terminal output',
        }), {
            target: { value: 'needle' },
        })
        fireEvent.click(desktopSearch)
        expect(controller.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', {
            name: 'Search terminal output',
            hidden: true,
        }).parentElement).toHaveAttribute('hidden')
        expect(mocks.terminalMounts.at(-1)).toMatchObject({
            searchActive: true,
            dismissMobileInteraction: false,
        })

        fireEvent.click(desktopSearch)
        expect(screen.getByRole('textbox', {
            name: 'Search terminal output',
        })).toHaveValue('needle')
        fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
        expect(controller.clear).toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: 'Search terminal output' }))
            .not.toBeInTheDocument()
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(false)
        expect(focus).not.toHaveBeenCalled()
    })

    it('keeps desktop Search open when terminal content is clicked', () => {
        mocks.controller = makeController([state('t1')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', {
            name: 'terminal.search.title',
        }))
        const controller = searchController()
        act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.(
            readySearchState(controller),
        ))

        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))

        expect(controller.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toBeVisible()

        fireEvent.click(screen.getByRole('button', { name: 't1' }))
        expect(controller.clear).not.toHaveBeenCalled()
    })

    it('retains mobile Search on body tap and toggle but clears on tab change, disconnect, and unmount', () => {
        setDesktopViewport(false)
        mocks.controller = makeController([state('t1'), state('t2')])
        const rendered = renderTabs()
        const openReadySearch = () => {
            fireEvent.click(screen.getByRole('button', { name: 'Search' }))
            const controller = searchController()
            act(() => mocks.terminalMounts.at(-1)?.onSearchStateChange?.(
                readySearchState(controller),
            ))
            return controller
        }

        const bodyController = openReadySearch()
        fireEvent.change(screen.getByRole('textbox', {
            name: 'Search terminal output',
        }), {
            target: { value: 'needle' },
        })
        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
        expect(bodyController.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toBeVisible()

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(bodyController.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', {
            name: 'Search terminal output',
            hidden: true,
        }).parentElement).toHaveAttribute('hidden')

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(screen.getByRole('textbox', {
            name: 'Search terminal output',
        })).toHaveValue('needle')

        fireEvent.click(screen.getByRole('button', { name: 't2' }))
        expect(bodyController.clear).toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: 'Search terminal output' }))
            .not.toBeInTheDocument()

        const disconnectController = openReadySearch()
        mocks.controller = {
            ...mocks.controller,
            state: { status: 'idle' as const },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )
        expect(disconnectController.clear).toHaveBeenCalled()

        mocks.controller = {
            ...mocks.controller,
            state: { status: 'connected' as const },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )
        const unmountController = openReadySearch()
        rendered.unmount()
        expect(unmountController.clear).toHaveBeenCalled()
    })

    it('ignores stale Search state published by the previous session terminal tab', () => {
        mocks.controller = makeController([state('t1'), state('t2')])
        renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        const oldCallback = mocks.terminalMounts.at(-1)?.onSearchStateChange
        const oldController = searchController()
        act(() => oldCallback?.(readySearchState(oldController)))

        const mountsBeforeSwitch = mocks.terminalMounts.length
        fireEvent.click(screen.getByRole('button', { name: 't2' }))
        expect(oldController.clear).toHaveBeenCalled()
        expect(mocks.terminalMounts.slice(mountsBeforeSwitch)[0]?.searchActive).toBe(false)

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', EMPTY_TERMINAL_SEARCH_STATE.status)

        const staleController = searchController()
        act(() => oldCallback?.(readySearchState(staleController)))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', EMPTY_TERMINAL_SEARCH_STATE.status)
        expect(staleController.clear).toHaveBeenCalled()
    })

    it('clears Search on editor collapse without disconnecting transport or dropping output', () => {
        const terminalWrite = vi.fn()
        mocks.autoMountTerminal = () => ({
            focus: vi.fn(),
            write: terminalWrite,
            onData: vi.fn(() => ({ dispose: vi.fn() })),
        })
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        const oldCallback = mocks.terminalMounts.at(-1)?.onSearchStateChange
        const outputCallback = mocks.controller.onOutput.mock.calls.at(-1)?.[0] as
            | ((terminalId: string, data: string) => void)
            | undefined
        const oldController = searchController()
        act(() => oldCallback?.(readySearchState(oldController)))

        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
                interactionActive={false}
            />,
        )
        expect(oldController.clear).toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: 'Search terminal output' }))
            .not.toBeInTheDocument()
        expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(false)
        expect(mocks.controller.disconnect).not.toHaveBeenCalled()

        act(() => outputCallback?.('t1', 'output while collapsed'))
        expect(terminalWrite).toHaveBeenCalledWith('output while collapsed')

        const staleController = searchController()
        act(() => oldCallback?.(readySearchState(staleController)))
        expect(staleController.clear).toHaveBeenCalled()

        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
                interactionActive={true}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', EMPTY_TERMINAL_SEARCH_STATE.status)
    })

    it('renders count n/3 from CLI list', () => {
        mocks.controller = makeController([state('t1', 'running'), state('t2', 'detached')])

        renderTabs()

        expect(screen.getByText('2/3')).toBeInTheDocument()
    })

    it('keeps scrollable tabs left and connection status fixed right on one row', () => {
        mocks.controller = makeController([state('t1'), state('t2')])

        renderTabs()

        const row = screen.getByTestId('terminal-tabs-status-row')
        const tabs = screen.getByRole('group', { name: 'Terminal tabs' })
        const status = screen.getByTestId('terminal-connection-status')

        expect(tabs.parentElement).toBe(row)
        expect(status.parentElement).toBe(row)
        expect(tabs).toHaveClass('min-w-0', 'flex-1', 'overflow-x-auto')
        expect(status).toHaveClass('shrink-0')
        expect(status).toHaveTextContent('connected')
        expect(status).toHaveTextContent('2/3')
    })

    it('places new-terminal button directly after the latest terminal tab', () => {
        mocks.controller = makeController([state('t1'), state('t2')])

        renderTabs()

        const tabList = screen.getByRole('group', { name: 'Terminal tabs' })
        const addButton = screen.getByRole('button', { name: 'New terminal' })
        expect(addButton.parentElement).toBe(tabList)
        expect(tabList.lastElementChild).toBe(addButton)
    })

    it('disables plus at 3/3 with tooltip', () => {
        mocks.controller = makeController([state('t1'), state('t2'), state('t3')])

        renderTabs()

        const addButton = screen.getByRole('button', { name: 'New terminal' })
        expect(addButton).toBeDisabled()
        expect(addButton).toHaveAttribute('title', 'Close an existing terminal before creating another.')
    })


    it('renders idle warning banner and tab badge from terminal list state', () => {
        mocks.controller = makeController([state('t1', 'warning_idle')])

        renderTabs()

        expect(screen.getByRole('status')).toHaveTextContent('Terminal is idle')
        expect(screen.getByLabelText('Idle warning')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Keep terminal' })).toBeInTheDocument()
    })

    it('keeps terminal through keepalive without writing shell input', () => {
        mocks.controller = makeController([state('t1', 'warning_idle')])

        renderTabs()
        fireEvent.click(screen.getByRole('button', { name: 'Keep terminal' }))

        expect(mocks.controller.keepalive).toHaveBeenCalledWith('t1')
        expect(mocks.controller.write).not.toHaveBeenCalled()
    })

    it('renders age warning without keep button', () => {
        mocks.controller = makeController([state('t1', 'warning_age')])

        renderTabs()

        expect(screen.getByRole('status')).toHaveTextContent('maximum lifetime hard limit')
        expect(screen.getByLabelText('Age warning')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Keep terminal' })).not.toBeInTheDocument()
    })

    it('does not expose or emit close-all from web hook/controller', () => {
        mocks.controller = makeController([state('t1')])

        renderTabs()
        expect(mocks.controller).not.toHaveProperty('closeAll')
        expect(mocks.emittedEvents).not.toContain('terminal:close-all')
    })

    it('unmount closes Snippets, disconnects, and does not close the terminal', () => {
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(screen.getByRole('region', { name: 'Snippet content' })).toBeVisible()

        rendered.unmount()

        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
        expect(mocks.controller.disconnect).toHaveBeenCalledTimes(1)
        expect(mocks.controller.closeOne).not.toHaveBeenCalled()
    })

    it('explicit close requires confirm and closes only selected terminal', () => {
        mocks.controller = makeController([state('t1'), state('t2')])

        renderTabs()
        fireEvent.click(screen.getByRole('button', { name: 'Close terminal t2' }))

        expect(screen.getByRole('dialog', { name: 'Stop terminal process?' }))
            .toHaveAttribute('data-app-dialog-presentation', 'alert')
        fireEvent.click(screen.getByRole('button', { name: 'Stop process and close' }))

        expect(mocks.controller.closeOne).toHaveBeenCalledTimes(1)
        expect(mocks.controller.closeOne).toHaveBeenCalledWith('t2')
        expect(mocks.controller.closeOne).not.toHaveBeenCalledWith('t1')
    })

    it('removes a user-closed terminal tab and switches to the remaining live terminal', () => {
        mocks.controller = makeController([state('t1'), state('t2')])
        const rendered = renderTabs()

        expect(screen.getByText('t1')).toBeInTheDocument()
        expect(screen.getByText('t2')).toBeInTheDocument()

        mocks.controller = {
            ...mocks.controller,
            terminals: [
                state('t1', 'closed_user', 'user_close'),
                state('t2', 'running')
            ]
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(screen.queryByText('t1')).not.toBeInTheDocument()
        expect(screen.getByText('t2')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 't2' }).parentElement).toHaveClass('text-[#818cf8]')
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
        expect(screen.queryByText('Closed by user.')).not.toBeInTheDocument()
    })

    it('does not render closed-state cards for user-closed terminal records', () => {
        mocks.controller = makeController([
            state('t1', 'closed_user', 'user_close'),
            state('t2', 'closed_user', 'user_close'),
            state('t3', 'closed_user', 'user_close')
        ])

        renderTabs()

        expect(screen.queryByText('Closed by user.')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Create new terminal' })).not.toBeInTheDocument()
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    })

    it('selects the first remaining visible tab when a user-closed record comes first', () => {
        mocks.controller = makeController([
            state('user-closed', 'closed_user', 'user_close'),
            state('timed-out', 'closed_idle', 'idle_timeout')
        ])

        renderTabs()

        expect(screen.queryByText('user-closed')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'timed-out' }).parentElement).toHaveClass('text-[#818cf8]')
        expect(screen.getByText('Closed after idle timeout.')).toBeInTheDocument()
    })



    it('reattaches an existing listed live terminal on first resize before resizing', () => {
        mocks.controller = makeController([state('t1', 'detached')])

        renderTabs()
        mocks.terminalMounts.at(-1)?.onResize?.(100, 30)
        mocks.terminalMounts.at(-1)?.onResize?.(120, 40)

        expect(mocks.controller.create).toHaveBeenCalledTimes(1)
        expect(mocks.controller.create).toHaveBeenCalledWith({
            terminalId: 't1',
            cols: 100,
            rows: 30,
            cwd: undefined,
            replay: true
        })
        expect(mocks.controller.resize).toHaveBeenCalledWith('t1', 120, 40)
    })

    it('reattaches the active terminal after the session socket reconnects', () => {
        mocks.controller = makeController([state('t1', 'running')])
        const rendered = renderTabs()

        mocks.terminalMounts.at(-1)?.onResize?.(100, 30)
        expect(mocks.controller.create).toHaveBeenCalledTimes(1)

        mocks.controller = {
            ...mocks.controller,
            state: { status: 'error' as const, error: 'Disconnected' },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )
        mocks.controller = {
            ...mocks.controller,
            state: { status: 'connected' as const },
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />,
        )

        expect(mocks.controller.create).toHaveBeenCalledTimes(2)
        expect(mocks.controller.create).toHaveBeenLastCalledWith({
            terminalId: 't1',
            cols: 100,
            rows: 30,
            cwd: undefined,
            replay: true,
        })
    })

    it('blocks rapid plus clicks while create is pending', () => {
        mocks.controller = makeController([state('t1', 'running')])

        renderTabs()
        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)
        fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
        fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))

        expect(mocks.controller.create).toHaveBeenCalledTimes(2)
        expect(mocks.controller.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ terminalId: 't1', replay: true }))
    })

    it('restores buffered output only once when switching terminal tabs', () => {
        const mountedTerminals: Array<{
            write: ReturnType<typeof vi.fn>
            clear: ReturnType<typeof vi.fn>
            onData: ReturnType<typeof vi.fn>
        }> = []
        mocks.autoMountTerminal = () => {
            const terminal = {
                write: vi.fn(),
                clear: vi.fn(),
                onData: vi.fn(() => ({ dispose: vi.fn() }))
            }
            mountedTerminals.push(terminal)
            return terminal
        }
        mocks.controller = makeController([state('t1'), state('t2')])

        renderTabs()
        const outputHandler = mocks.controller.onOutput.mock.calls.at(-1)?.[0] as
            | ((terminalId: string, data: string) => void)
            | undefined
        act(() => outputHandler?.('t2', 'prompt$ '))

        fireEvent.click(screen.getByRole('button', { name: 't2' }))

        const switchedTerminal = mountedTerminals.at(-1)
        expect(switchedTerminal?.write).toHaveBeenCalledTimes(1)
        expect(switchedTerminal?.write).toHaveBeenCalledWith('prompt$ ')
    })

    it('keeps a new terminal pending and selected across a stale cached list', () => {
        const inputHandlers: Array<(data: string) => void> = []
        mocks.autoMountTerminal = () => ({
            write: vi.fn(),
            onData: vi.fn((handler: (data: string) => void) => {
                inputHandlers.push(handler)
                return { dispose: vi.fn() }
            })
        })
        mocks.controller = makeController([state('t1')])
        const rendered = renderTabs()
        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)

        fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
        const createdTerminalId = mocks.controller.create.mock.calls.at(-1)?.[0]?.terminalId as string

        mocks.controller = {
            ...mocks.controller,
            terminals: [state('t1')]
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(screen.getByRole('button', { name: 'New terminal' })).toBeDisabled()

        mocks.controller = {
            ...mocks.controller,
            terminals: [state('t1'), state(createdTerminalId)]
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(screen.getByRole('button', { name: createdTerminalId }).parentElement).toHaveClass('text-[#818cf8]')
        act(() => inputHandlers.at(-1)?.('pwd\r'))
        expect(mocks.controller.write).toHaveBeenLastCalledWith(createdTerminalId, 'pwd\r')
    })

    it('does not create or leave pending while the terminal socket is still connecting', () => {
        mocks.controller = {
            ...makeController([]),
            state: { status: 'connecting' as const },
            create: vi.fn(() => false)
        }

        renderTabs()
        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)
        expect(screen.getByRole('button', { name: 'New terminal' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))

        expect(mocks.controller.create).not.toHaveBeenCalled()
    })

    it('does not bootstrap a new terminal before the first session terminal list arrives', () => {
        mocks.controller = {
            ...makeController([]),
            listLoaded: false
        }

        renderTabs()
        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)

        expect(mocks.controller.create).not.toHaveBeenCalled()
    })

    it('bootstraps after the empty terminal list arrives without requiring another resize', () => {
        mocks.controller = {
            ...makeController([]),
            state: { status: 'connecting' as const },
            listLoaded: false
        }
        const rendered = renderTabs()

        mocks.terminalMounts.at(-1)?.onResize?.(120, 36)
        expect(mocks.controller.create).not.toHaveBeenCalled()

        mocks.controller = {
            ...mocks.controller,
            state: { status: 'connected' as const },
            listLoaded: true
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(mocks.controller.create).toHaveBeenCalledTimes(1)
        expect(mocks.controller.create).toHaveBeenCalledWith({
            terminalId: expect.any(String),
            cols: 120,
            rows: 36,
            cwd: undefined,
            replay: true
        })
    })

    it('prefers first live terminal when closed terminal appears before running terminal', () => {
        mocks.controller = makeController([
            state('closed-first', 'closed_idle', 'idle_timeout'),
            state('live-second', 'running')
        ])

        renderTabs()

        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
        expect(screen.queryByText(/Closed after idle timeout/)).not.toBeInTheDocument()
    })



    it('keeps selected terminal when it becomes closed and shows reason with CTA', () => {
        mocks.controller = makeController([state('t1', 'running'), state('t2', 'running')])
        const rendered = renderTabs()

        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)
        expect(mocks.controller.create).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 't1' }))

        mocks.controller = {
            ...mocks.controller,
            terminals: [state('t1', 'closed_idle', 'idle_timeout'), state('t2', 'running')]
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(screen.getByText('Closed after idle timeout.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Create new terminal' })).toBeInTheDocument()
        expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    })

    it('switches to first live terminal only when selected terminal is removed', () => {
        mocks.controller = makeController([state('t1', 'running'), state('t2', 'running')])
        const rendered = renderTabs()

        mocks.terminalMounts.at(-1)?.onResize?.(80, 24)
        expect(mocks.controller.create).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 't1' }))

        mocks.controller = {
            ...mocks.controller,
            terminals: [state('t2', 'running')]
        }
        rendered.rerender(
            <SessionTerminalTabs
                sessionId="session-1"
                active={true}
                terminalSupported={true}
            />
        )

        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
        mocks.terminalMounts.at(-1)?.onResize?.(100, 30)
        expect(mocks.controller.create).toHaveBeenCalledWith({
            terminalId: 't2',
            cols: 100,
            rows: 30,
            cwd: undefined,
            replay: true
        })
    })

    it('renders last terminal error without hiding connected terminal UI', () => {
        mocks.controller = { ...makeController([state('t1', 'running')]), lastError: 'Too many terminals open (max 3).' }

        renderTabs()

        expect(screen.getByText('Too many terminals open (max 3).')).toBeInTheDocument()
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    })

    it('renders closed idle/age/lost terminal reason with create new CTA', () => {
        mocks.controller = makeController([
            state('idle-old', 'closed_idle', 'idle_timeout'),
            state('age-old', 'closed_age', 'hard_timeout'),
            state('lost-one', 'lost', 'cli_lost')
        ])

        renderTabs()

        expect(screen.getByText('Closed after idle timeout.')).toBeInTheDocument()
        expect(screen.getByText('Closed after hard timeout.')).toBeInTheDocument()
        expect(screen.getByText('CLI connection was lost.')).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Create new terminal' })).toHaveLength(3)
    })

    it('renders session-level CLI lost recovery banner without terminal metadata', () => {
        mocks.controller = { ...makeController([]), recoveryReason: 'cli_lost' }

        renderTabs()

        expect(screen.getByText('CLI restarted or disconnected. Previous terminals may be lost.')).toBeInTheDocument()
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    })

    it('creates a new terminal from closed-only CTA using closed terminal size', () => {
        mocks.controller = makeController([{
            ...state('idle-old', 'closed_idle', 'idle_timeout'),
            cols: 132,
            rows: 43
        }])

        renderTabs()
        fireEvent.click(screen.getByRole('button', { name: 'Create new terminal' }))

        expect(mocks.controller.create).toHaveBeenCalledTimes(1)
        expect(mocks.controller.create).toHaveBeenCalledWith({
            terminalId: expect.any(String),
            cols: 132,
            rows: 43,
            cwd: undefined,
            replay: true
        })
        expect(screen.queryByText('Waiting for terminal size before creating a terminal.')).not.toBeInTheDocument()
    })

    it('has terminal lifecycle and mobile interaction locale coverage in en vi and zh', () => {
        const keys = [
            'terminal.controls.keys',
            'terminal.controls.keysPanel',
            'terminal.interaction.choice',
            'terminal.interaction.input',
            'terminal.interaction.enter',
            'terminal.interaction.select',
            'terminal.interaction.selectionToolbar',
            'terminal.interaction.selectionStart',
            'terminal.interaction.selectionEnd',
            'terminal.interaction.copy',
            'terminal.interaction.selectAll',
            'terminal.interaction.cancel',
            'terminal.interaction.copied',
            'terminal.interaction.copyFailed',
            'terminal.lifecycle.hint',
            'terminal.limit.full',
            'terminal.new',
            'terminal.close.confirmTitle',
            'terminal.close.confirmDescription',
            'terminal.close.confirmAction',
            'terminal.keep',
            'terminal.warning.idle',
            'terminal.warning.age',
            'terminal.warning.badge.idle',
            'terminal.warning.badge.age',
            'terminal.closed.idle',
            'terminal.closed.age',
            'terminal.closed.user',
            'terminal.closed.archive',
            'terminal.closed.exited',
            'terminal.closed.lost',
            'terminal.recovery.cliLost',
            'terminal.closed.spawn',
            'terminal.closed.generic',
            'terminal.createNew',
            'terminal.unsupported',
            'terminal.inactive',
            'button.cancel'
        ] as const

        for (const key of keys) {
            expect(en[key]).toBeTruthy()
            expect(viVN[key]).toBeTruthy()
            expect(zhCN[key]).toBeTruthy()
        }
    })
})
