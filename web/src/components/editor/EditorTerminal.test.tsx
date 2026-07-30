import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorTab } from '@/hooks/useEditorState'
import { EditorTerminal } from './EditorTerminal'
import {
    EMPTY_TERMINAL_SEARCH_STATE,
    type TerminalSearchController,
    type TerminalSearchState,
} from '@/components/Terminal/terminalSearch'

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

var mocks = {
    useSession: vi.fn(),
    useTerminalSocket: vi.fn(),
    isRemoteTerminalSupported: vi.fn(),
    onMountTerminal: vi.fn(),
    onResizeTerminal: vi.fn(),
    terminalViewProps: [] as Array<{
        compactFontSize?: boolean
        mobileInteractionEnabled?: boolean
        dismissMobileInteraction?: boolean
        searchActive?: boolean
        onSearchStateChange?: (state: TerminalSearchState) => void
    }>,
    sessionTabsProps: [] as unknown[],
    disconnectsByTerminalId: new Map<string, ReturnType<typeof vi.fn>>(),
    closesByTerminalId: new Map<string, ReturnType<typeof vi.fn>>(),
    writesByTerminalId: new Map<string, ReturnType<typeof vi.fn>>(),
    terminalStatusesById: new Map<string, string>(),
    historyListenersByTerminalId: new Map<string, (payload: unknown) => void>(),
    historyRequestsByTerminalId: new Map<string, ReturnType<typeof vi.fn>>(),
}

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ token: 'token-1', baseUrl: 'http://hub.local' })
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string | number>) => ({
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
            'terminal.keys.saved': `Saved · ${values?.count ?? 0}`,
            'terminal.keys.manage': 'Manage',
            'terminal.keys.emptySaved': 'No saved combinations yet.',
            'terminal.keys.combination': 'Key combination',
            'terminal.keys.empty': 'No key selected',
            'terminal.keys.groups': 'Key groups',
            'terminal.keys.add': 'Add key',
            'terminal.keys.save': 'Save',
            'terminal.keys.savedSuccess': 'Combination saved.',
            'terminal.keys.clear': 'Clear all',
            'terminal.keys.send': 'Send',
            'terminal.keys.remove': `Remove ${values?.key ?? ''}`,
            'terminal.keys.pickTitle': 'Choose keys',
            'terminal.keys.pickSubtitle': 'Compose a terminal key chord',
            'terminal.keys.apply': 'Apply combination',
            'terminal.keys.basic': 'Basic',
            'terminal.keys.alphanumeric': 'Letters & numbers',
            'terminal.keys.function': 'F1–F12',
            'terminal.keys.symbol': 'Symbols',
            'terminal.keys.savedTitle': 'Saved combinations',
            'terminal.keys.savedSubtitle': `${values?.count ?? 0} on this device`,
            'terminal.keys.load': 'Load',
            'terminal.keys.delete': 'Delete',
            'terminal.keys.deleted': 'Combination deleted.',
            'terminal.keys.undo': 'Undo',
            'terminal.keys.localOnly': 'Stored only on this device',
            'terminal.keys.duplicate': 'This combination is already saved.',
            'terminal.keys.limit': 'Limit reached.',
            'terminal.keys.unavailable': 'Storage unavailable.',
            'terminal.keys.unsupported': 'Unsupported combination.',
            'terminal.keys.sendFailed': 'Could not send.',
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

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: (...args: unknown[]) => mocks.useSession(...args)
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: (...args: unknown[]) => mocks.useTerminalSocket(...args)
}))

vi.mock('@/utils/terminalSupport', () => ({
    isRemoteTerminalSupported: (...args: unknown[]) => mocks.isRemoteTerminalSupported(...args)
}))

vi.mock('@/components/Terminal/SessionTerminalTabs', () => ({
    SessionTerminalTabs: (props: unknown) => {
        mocks.sessionTabsProps.push(props)
        return <div data-testid="session-terminal-tabs" />
    }
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: (props: {
        onMount?: (terminal: unknown) => void
        onResize?: (cols: number, rows: number) => void
        compactFontSize?: boolean
        mobileInteractionEnabled?: boolean
        dismissMobileInteraction?: boolean
        searchActive?: boolean
        onSearchStateChange?: (state: TerminalSearchState) => void
    }) => {
        mocks.terminalViewProps.push({
            compactFontSize: props.compactFontSize,
            mobileInteractionEnabled: props.mobileInteractionEnabled,
            dismissMobileInteraction: props.dismissMobileInteraction,
            searchActive: props.searchActive,
            onSearchStateChange: props.onSearchStateChange,
        })
        mocks.onMountTerminal(props.onMount)
        mocks.onResizeTerminal(props.onResize)
        return (
            <div
                data-testid="terminal-view"
                data-mobile-interaction-enabled={String(props.mobileInteractionEnabled)}
                data-dismiss-mobile-interaction={String(props.dismissMobileInteraction)}
            />
        )
    }
}))

const tabs: EditorTab[] = [
    { id: 'file-1', type: 'file', path: '/repo/src/App.tsx', label: 'App.tsx' },
    { id: 'term-1', type: 'terminal', label: 'Terminal: bash', shell: 'bash', sessionId: 'session-1' },
    { id: 'term-2', type: 'terminal', label: 'Terminal: zsh', shell: 'zsh', sessionId: 'session-1' }
]

function pressQuickKey(name: string): void {
    fireEvent.click(screen.getByRole('button', { name }))
}

function mountLastTerminal() {
    const focus = vi.fn()
    const onData = vi.fn(() => ({ dispose: vi.fn() }))
    const onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }))
    const getSelection = vi.fn(() => '')
    const element = document.createElement('div')
    const mount = mocks.onMountTerminal.mock.calls.at(-1)?.[0] as ((terminal: unknown) => void) | undefined
    mount?.({ focus, onData, onSelectionChange, getSelection, element })
    return { focus }
}

function expectTerminalWrite(terminalId: string, text: string): void {
    const matchingWrites = mocks.useTerminalSocket.mock.results.flatMap((result, index) => {
        const options = mocks.useTerminalSocket.mock.calls[index]?.[0] as { terminalId?: string } | undefined
        if (options?.terminalId !== terminalId) {
            return []
        }
        return [(result.value as { write: ReturnType<typeof vi.fn> }).write]
    })

    expect(matchingWrites.some((write) => (
        write.mock.calls.some(([data]) => data === text)
    ))).toBe(true)
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

function renderMachineTerminal(overrides: Partial<React.ComponentProps<typeof EditorTerminal>> = {}) {
    return render(
        <EditorTerminal
            tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
            activeTabId="term-machine"
            isCollapsed={false}
            api={null}
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            onOpenTerminal={vi.fn()}
            onToggleCollapsed={vi.fn()}
            {...overrides}
        />
    )
}

function setDockViewport(matches: boolean): void {
    window.matchMedia = vi.fn((query: string) => ({
        matches: query === '(max-width: 1023px)' ? matches : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
}

describe('EditorTerminal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setDockViewport(false)
        mocks.terminalViewProps = []
        mocks.sessionTabsProps = []
        mocks.useSession.mockReturnValue({
            session: { id: 'session-1', active: true, metadata: { os: 'linux', path: '/repo', host: 'dev' } },
            isLoading: false,
            error: null,
            refetch: vi.fn()
        })
        mocks.disconnectsByTerminalId.clear()
        mocks.closesByTerminalId.clear()
        mocks.writesByTerminalId.clear()
        mocks.terminalStatusesById.clear()
        mocks.historyListenersByTerminalId.clear()
        mocks.historyRequestsByTerminalId.clear()
        mocks.useTerminalSocket.mockImplementation((options: { terminalId: string }) => {
            const disconnect = vi.fn()
            const close = vi.fn()
            const write = vi.fn(() => true)
            const requestHistory = mocks.historyRequestsByTerminalId.get(options.terminalId)
                ?? vi.fn(() => true)
            mocks.disconnectsByTerminalId.set(options.terminalId, disconnect)
            mocks.closesByTerminalId.set(options.terminalId, close)
            mocks.writesByTerminalId.set(options.terminalId, write)
            mocks.historyRequestsByTerminalId.set(options.terminalId, requestHistory)
            return {
            state: {
                status: mocks.terminalStatusesById.get(options.terminalId)
                    ?? 'connected',
            },
            connect: vi.fn(),
            write,
            resize: vi.fn(),
            disconnect,
            close,
            onOutput: vi.fn(),
            onExit: vi.fn(),
            requestHistory,
            onHistory: vi.fn((handler) => {
                mocks.historyListenersByTerminalId.set(options.terminalId, handler)
            })
            }
        })
        mocks.isRemoteTerminalSupported.mockReturnValue(true)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('shows an empty state when no terminal tabs exist', () => {
        render(
            <EditorTerminal
                tabs={[tabs[0]]}
                activeTabId="file-1"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.getByText('No terminal open')).toBeInTheDocument()
    })

    it('renders only the shared session terminal strip in agent mode', () => {
        const onSelectTab = vi.fn()
        const onCloseTab = vi.fn()
        const onOpenTerminal = vi.fn()
        const onToggleCollapsed = vi.fn()

        render(
            <EditorTerminal
                tabs={tabs}
                activeTabId="term-2"
                isCollapsed={false}
                api={null}
                onSelectTab={onSelectTab}
                onCloseTab={onCloseTab}
                onOpenTerminal={onOpenTerminal}
                onToggleCollapsed={onToggleCollapsed}
            />
        )

        expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
        expect(screen.queryByText('Terminal: bash')).not.toBeInTheDocument()
        expect(screen.queryByText('Terminal: zsh')).not.toBeInTheDocument()
        expect(screen.getAllByTestId('session-terminal-tabs')).toHaveLength(1)
        expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
        expect(mocks.sessionTabsProps[0]).toEqual(expect.objectContaining({
            sessionId: 'session-1',
            active: true,
            terminalSupported: true
        }))
        expect(mocks.useTerminalSocket).not.toHaveBeenCalled()

        expect(screen.queryByRole('button', { name: /^Select terminal / })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Close terminal / })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open terminal' })).not.toBeInTheDocument()
        expect(onSelectTab).not.toHaveBeenCalled()
        expect(onCloseTab).not.toHaveBeenCalled()
        expect(onOpenTerminal).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal' }))
        expect(onToggleCollapsed).toHaveBeenCalledWith()
    })

    it('renders one shared component for multiple editor session terminal tabs', () => {
        const { rerender } = render(
            <EditorTerminal
                tabs={tabs}
                activeTabId="term-1"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.getAllByTestId('session-terminal-tabs')).toHaveLength(1)
        expect(mocks.useTerminalSocket).not.toHaveBeenCalled()

        rerender(
            <EditorTerminal
                tabs={tabs}
                activeTabId="term-2"
                isCollapsed={true}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.getAllByTestId('session-terminal-tabs')).toHaveLength(1)
        expect(mocks.useTerminalSocket).not.toHaveBeenCalled()
    })

    it('pauses only shared session interaction while its desktop editor is collapsed', () => {
        const commonProps = {
            tabs: [tabs[1]],
            activeTabId: 'term-1',
            api: null,
            onSelectTab: vi.fn(),
            onCloseTab: vi.fn(),
            onOpenTerminal: vi.fn(),
            onToggleCollapsed: vi.fn(),
        }
        const rendered = render(
            <EditorTerminal {...commonProps} isCollapsed={false} />,
        )

        expect(mocks.sessionTabsProps.at(-1)).toEqual(expect.objectContaining({
            active: true,
            interactionActive: true,
        }))

        rendered.rerender(
            <EditorTerminal {...commonProps} isCollapsed={true} />,
        )
        expect(mocks.sessionTabsProps.at(-1)).toEqual(expect.objectContaining({
            active: true,
            interactionActive: false,
        }))

        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                isCollapsed={true}
                mobileMode={true}
            />,
        )
        expect(mocks.sessionTabsProps.at(-1)).toEqual(expect.objectContaining({
            active: true,
            interactionActive: true,
        }))
    })

    it('connects machine-scoped terminals without session lookup', () => {
        render(
            <EditorTerminal
                tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
                activeTabId="term-machine"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(mocks.useSession).toHaveBeenCalledWith(null, null)
        expect(mocks.useTerminalSocket).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            cwd: '/repo',
            sessionId: '',
            terminalId: 'term-machine'
        }))
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
        expect(screen.queryByTestId('session-terminal-tabs')).not.toBeInTheDocument()
        expect(mocks.sessionTabsProps).toHaveLength(0)
        expect(screen.queryByText(/\b[0-9]+\/3\b/)).not.toBeInTheDocument()
    })

    it('enables mobile interaction only for the active editor terminal body', () => {
        const machineTabs: EditorTab[] = [
            { id: 'term-machine-1', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' },
            { id: 'term-machine-2', type: 'terminal', label: 'Terminal: zsh', shell: 'zsh', machineId: 'machine-1', cwd: '/repo' },
        ]
        const commonProps = {
            tabs: machineTabs,
            isCollapsed: false,
            api: null,
            onSelectTab: vi.fn(),
            onCloseTab: vi.fn(),
            onOpenTerminal: vi.fn(),
            onToggleCollapsed: vi.fn(),
        }
        const { rerender } = render(
            <EditorTerminal {...commonProps} activeTabId="term-machine-1" />,
        )

        let terminalViews = screen.getAllByTestId('terminal-view')
        expect(terminalViews[0]).toHaveAttribute('data-mobile-interaction-enabled', 'true')
        expect(terminalViews[0]).toHaveAttribute('data-dismiss-mobile-interaction', 'false')
        expect(terminalViews[1]).toHaveAttribute('data-mobile-interaction-enabled', 'false')
        expect(terminalViews[1]).toHaveAttribute('data-dismiss-mobile-interaction', 'true')

        rerender(
            <EditorTerminal {...commonProps} activeTabId="term-machine-2" />,
        )

        terminalViews = screen.getAllByTestId('terminal-view')
        expect(terminalViews[0]).toHaveAttribute('data-mobile-interaction-enabled', 'false')
        expect(terminalViews[0]).toHaveAttribute('data-dismiss-mobile-interaction', 'true')
        expect(terminalViews[1]).toHaveAttribute('data-mobile-interaction-enabled', 'true')
        expect(terminalViews[1]).toHaveAttribute('data-dismiss-mobile-interaction', 'false')
    })

    it('dismisses active terminal interaction when an editor dock tool opens', () => {
        renderMachineTerminal({ mobileMode: true })

        expect(screen.getByTestId('terminal-view')).toHaveAttribute(
            'data-dismiss-mobile-interaction',
            'false',
        )
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))

        expect(screen.getByTestId('terminal-view')).toHaveAttribute(
            'data-dismiss-mobile-interaction',
            'true',
        )
    })

    it('bridges machine terminal Search state and clears it without focusing xterm', () => {
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })
        const { focus } = mountLastTerminal()

        fireEvent.click(screen.getAllByRole('button', { name: 'Search' }).at(-1)!)
        expect(mocks.terminalViewProps.at(-1)).toMatchObject({
            searchActive: true,
            dismissMobileInteraction: true,
        })

        act(() => mocks.terminalViewProps.at(-1)?.onSearchStateChange?.({
            status: 'loading',
            controller: null,
            error: null,
            retry: null,
        }))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'loading')

        const controller = searchController()
        act(() => mocks.terminalViewProps.at(-1)?.onSearchStateChange?.(
            readySearchState(controller),
        ))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', 'ready')

        fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
        expect(controller.clear).toHaveBeenCalled()
        expect(mocks.terminalViewProps.at(-1)).toMatchObject({
            searchActive: false,
            dismissMobileInteraction: false,
        })
        const closedController = searchController()
        act(() => mocks.terminalViewProps.at(-1)?.onSearchStateChange?.(
            readySearchState(closedController),
        ))
        expect(closedController.clear).toHaveBeenCalled()
        expect(focus).not.toHaveBeenCalled()
    })

    it('offers desktop History beside Search and Snippets and inserts without Enter', () => {
        renderMachineTerminal()

        expect(screen.getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(0)
        expect(screen.getAllByRole('button', { name: 'Snippets' }).length).toBeGreaterThan(0)
        fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]!)

        const requestHistory = mocks.historyRequestsByTerminalId.get('term-machine')
        expect(requestHistory).toHaveBeenCalledWith(expect.any(String), 100)
        const requestId = requestHistory?.mock.calls.at(-1)?.[0]
        act(() => mocks.historyListenersByTerminalId.get('term-machine')?.({
            machineId: 'machine-1',
            terminalId: 'term-machine',
            requestId,
            status: 'ok',
            shell: 'bash',
            entries: [{ index: 5, command: 'pwd' }],
        }))

        fireEvent.click(screen.getByRole('button', {
            name: 'Insert history command',
        }))
        expectTerminalWrite('term-machine', 'pwd')
        expect(mocks.useTerminalSocket.mock.results.some((result, index) => {
            const options = mocks.useTerminalSocket.mock.calls[index]?.[0] as { terminalId?: string }
            return options.terminalId === 'term-machine'
                && (result.value as { write: ReturnType<typeof vi.fn> }).write
                    .mock.calls.some(([data]) => data === 'pwd\r')
        })).toBe(false)
    })

    it('retains machine Search on mobile body tap and toggle', () => {
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })

        fireEvent.click(screen.getAllByRole('button', { name: 'Search' }).at(-1)!)
        const controller = searchController()
        act(() => mocks.terminalViewProps.at(-1)?.onSearchStateChange?.(
            readySearchState(controller),
        ))
        fireEvent.change(screen.getByRole('textbox', {
            name: 'Search terminal output',
        }), {
            target: { value: 'needle' },
        })

        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
        expect(controller.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toBeVisible()

        fireEvent.click(screen.getAllByRole('button', { name: 'Search' }).at(-1)!)
        expect(controller.clear).not.toHaveBeenCalled()
        expect(screen.getByRole('region', {
            name: 'Search terminal output',
            hidden: true,
        }).parentElement).toHaveAttribute('hidden')

        fireEvent.click(screen.getAllByRole('button', { name: 'Search' }).at(-1)!)
        expect(screen.getByRole('textbox', {
            name: 'Search terminal output',
        })).toHaveValue('needle')
    })

    it('clears machine Search on tab switch, collapse, disconnect, and unmount', () => {
        const machineTabs: EditorTab[] = [
            { id: 'term-machine-1', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' },
            { id: 'term-machine-2', type: 'terminal', label: 'Terminal: zsh', shell: 'zsh', machineId: 'machine-1', cwd: '/repo' },
        ]
        const commonProps = {
            tabs: machineTabs,
            isCollapsed: false,
            api: null,
            onSelectTab: vi.fn(),
            onCloseTab: vi.fn(),
            onOpenTerminal: vi.fn(),
            onToggleCollapsed: vi.fn(),
        }
        const rendered = render(
            <EditorTerminal {...commonProps} activeTabId="term-machine-1" />,
        )
        const openReadySearch = () => {
            fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0])
            const controller = searchController()
            act(() => mocks.terminalViewProps.at(-2)?.onSearchStateChange?.(
                readySearchState(controller),
            ))
            return controller
        }

        const tabController = openReadySearch()
        rendered.rerender(
            <EditorTerminal {...commonProps} activeTabId="term-machine-2" />,
        )
        expect(tabController.clear).toHaveBeenCalled()

        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                activeTabId="term-machine-1"
                isCollapsed={false}
            />,
        )
        const collapseController = openReadySearch()
        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                activeTabId="term-machine-1"
                isCollapsed={true}
            />,
        )
        expect(collapseController.clear).toHaveBeenCalled()

        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                activeTabId="term-machine-1"
                isCollapsed={false}
            />,
        )
        const disconnectController = openReadySearch()
        mocks.terminalStatusesById.set('term-machine-1', 'disconnected')
        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                activeTabId="term-machine-1"
                isCollapsed={false}
            />,
        )
        expect(disconnectController.clear).toHaveBeenCalled()

        mocks.terminalStatusesById.set('term-machine-1', 'connected')
        rendered.rerender(
            <EditorTerminal
                {...commonProps}
                activeTabId="term-machine-1"
                isCollapsed={false}
            />,
        )
        const unmountController = openReadySearch()
        rendered.unmount()
        expect(unmountController.clear).toHaveBeenCalled()
    })

    it('ignores stale Search state from an inactive editor terminal view', () => {
        const machineTabs: EditorTab[] = [
            { id: 'term-machine-1', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' },
            { id: 'term-machine-2', type: 'terminal', label: 'Terminal: zsh', shell: 'zsh', machineId: 'machine-1', cwd: '/repo' },
        ]
        const commonProps = {
            tabs: machineTabs,
            isCollapsed: false,
            api: null,
            onSelectTab: vi.fn(),
            onCloseTab: vi.fn(),
            onOpenTerminal: vi.fn(),
            onToggleCollapsed: vi.fn(),
        }
        const rendered = render(
            <EditorTerminal {...commonProps} activeTabId="term-machine-1" />,
        )

        fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0])
        const oldCallback = mocks.terminalViewProps.at(-2)?.onSearchStateChange
        const oldController = searchController()
        act(() => oldCallback?.(readySearchState(oldController)))

        const viewsBeforeSwitch = mocks.terminalViewProps.length
        rendered.rerender(
            <EditorTerminal {...commonProps} activeTabId="term-machine-2" />,
        )
        expect(oldController.clear).toHaveBeenCalled()
        expect(mocks.terminalViewProps.slice(viewsBeforeSwitch)[0]?.searchActive).toBe(false)
        fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[1])
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', EMPTY_TERMINAL_SEARCH_STATE.status)

        const staleController = searchController()
        act(() => oldCallback?.(readySearchState(staleController)))
        expect(screen.getByRole('region', { name: 'Search terminal output' }))
            .toHaveAttribute('data-search-status', EMPTY_TERMINAL_SEARCH_STATE.status)
        expect(staleController.clear).toHaveBeenCalled()
    })

    it('routes a snippet exactly through the active editor terminal without focusing xterm', () => {
        const api = { cacheScope: 'test' } as React.ComponentProps<typeof EditorTerminal>['api']
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true, api })
        const { focus } = mountLastTerminal()

        fireEvent.click(screen.getAllByRole('button', { name: 'Snippets' })[0])
        expect(screen.getByRole('region', { name: 'Snippet content' })).toHaveAttribute(
            'data-api',
            'true',
        )
        expect(screen.getByTestId('terminal-view')).toHaveAttribute(
            'data-dismiss-mobile-interaction',
            'true',
        )
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))

        expectTerminalWrite('term-machine', 'git status --short')
        expect(focus).not.toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('terminal.snippets.inserted')
    })

    it('closes the active Snippets panel when switching editor terminal tabs', () => {
        const machineTabs: EditorTab[] = [
            { id: 'term-machine-1', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' },
            { id: 'term-machine-2', type: 'terminal', label: 'Terminal: zsh', shell: 'zsh', machineId: 'machine-1', cwd: '/repo' },
        ]
        const commonProps = {
            tabs: machineTabs,
            isCollapsed: false,
            api: null,
            onSelectTab: vi.fn(),
            onCloseTab: vi.fn(),
            onOpenTerminal: vi.fn(),
            onToggleCollapsed: vi.fn(),
        }
        const rendered = render(
            <EditorTerminal {...commonProps} activeTabId="term-machine-1" />,
        )

        fireEvent.click(screen.getAllByRole('button', { name: 'Snippets' })[0])
        expect(screen.getByRole('region', { name: 'Snippet content' })).toBeVisible()

        rendered.rerender(
            <EditorTerminal {...commonProps} activeTabId="term-machine-2" />,
        )

        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        rendered.rerender(
            <EditorTerminal {...commonProps} activeTabId="term-machine-1" />,
        )
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
    })

    it('drops stale Snippets state when the active editor terminal disconnects', () => {
        const props = { mobileMode: true }
        const rendered = renderMachineTerminal(props)

        fireEvent.click(screen.getAllByRole('button', { name: 'Snippets' }).at(-1)!)
        fireEvent.change(screen.getByRole('textbox', { name: 'Search snippets' }), {
            target: { value: 'stale search' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible()

        mocks.terminalStatusesById.set('term-machine', 'disconnected')
        rendered.rerender(
            <EditorTerminal
                tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
                activeTabId="term-machine"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
                {...props}
            />,
        )
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        mocks.terminalStatusesById.set('term-machine', 'connected')
        rendered.rerender(
            <EditorTerminal
                tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
                activeTabId="term-machine"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
                {...props}
            />,
        )
        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()

        fireEvent.click(screen.getAllByRole('button', { name: 'Snippets' }).at(-1)!)
        expect(screen.getByRole('textbox', { name: 'Search snippets' })).toHaveValue('')
        expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    })

    it('unmount closes the active editor Snippets panel and disconnects its terminal', () => {
        const rendered = renderMachineTerminal({ mobileMode: true })
        const disconnect = mocks.disconnectsByTerminalId.get('term-machine')

        fireEvent.click(screen.getAllByRole('button', { name: 'Snippets' }).at(-1)!)
        expect(screen.getByRole('region', { name: 'Snippet content' })).toBeVisible()

        rendered.unmount()

        expect(screen.queryByRole('region', { name: 'Snippet content' })).not.toBeInTheDocument()
        expect(disconnect).toHaveBeenCalledTimes(1)
    })

    it('disables terminal interaction while the editor terminal is disconnected', () => {
        const props = {
            mobileMode: true,
        }
        mocks.terminalStatusesById.set('term-machine', 'disconnected')
        const { rerender } = renderMachineTerminal(props)

        expect(screen.getByTestId('terminal-view')).toHaveAttribute(
            'data-mobile-interaction-enabled',
            'false',
        )

        mocks.terminalStatusesById.set('term-machine', 'connected')
        rerender(
            <EditorTerminal
                tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
                activeTabId="term-machine"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
                {...props}
            />,
        )

        expect(screen.getByTestId('terminal-view')).toHaveAttribute(
            'data-mobile-interaction-enabled',
            'true',
        )
    })

    it('keeps a mixed active machine editor terminal on the legacy hook path', () => {
        const onOpenTerminal = vi.fn()

        render(
            <EditorTerminal
                tabs={[
                    { id: 'term-session', type: 'terminal', label: 'Terminal: session', shell: 'bash', sessionId: 'session-1' },
                    { id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }
                ]}
                activeTabId="term-machine"
                isCollapsed={false}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={onOpenTerminal}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
        expect(screen.queryByTestId('session-terminal-tabs')).not.toBeInTheDocument()
        expect(mocks.useTerminalSocket).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            sessionId: '',
            cwd: '/repo',
            terminalId: 'term-machine'
        }))
        expect(screen.queryByText(/\b[0-9]+\/3\b/)).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
        expect(onOpenTerminal).toHaveBeenCalledWith()
    })

    it('hides terminal body content when collapsed and exposes expand action', () => {
        render(
            <EditorTerminal
                tabs={tabs}
                activeTabId="term-2"
                isCollapsed={true}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.queryAllByTestId('session-terminal-tabs')).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Expand terminal' })).toBeInTheDocument()
    })

    it('toggles the desktop panel from the terminal header background', () => {
        const onToggleCollapsed = vi.fn()
        renderMachineTerminal({ onToggleCollapsed })

        fireEvent.click(screen.getByText('Terminal'))
        fireEvent.click(screen.getByText('Terminal'))

        expect(onToggleCollapsed).toHaveBeenCalledTimes(2)
    })

    it('does not toggle the panel from terminal header controls', () => {
        const onToggleCollapsed = vi.fn()
        const onSelectTab = vi.fn()
        const onCloseTab = vi.fn()
        const onOpenTerminal = vi.fn()
        renderMachineTerminal({
            onToggleCollapsed,
            onSelectTab,
            onCloseTab,
            onOpenTerminal,
        })

        fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal' }))
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1)

        const selectTab = screen.getByRole('button', { name: 'Select terminal Terminal: bash' })
        fireEvent.click(selectTab)
        fireEvent.click(selectTab.parentElement!)
        fireEvent.click(screen.getByRole('button', { name: 'Close terminal Terminal: bash' }))
        fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))

        expect(onSelectTab).toHaveBeenCalledWith('term-machine')
        expect(onCloseTab).toHaveBeenCalledWith('term-machine')
        expect(onOpenTerminal).toHaveBeenCalledTimes(1)
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
    })

    it('does not add terminal header collapse behavior on mobile', () => {
        const onToggleCollapsed = vi.fn()
        renderMachineTerminal({ mobileMode: true, onToggleCollapsed })

        fireEvent.click(screen.getByText('Terminal'))

        expect(onToggleCollapsed).not.toHaveBeenCalled()
    })

    it('hides chrome-only controls and uses compact terminal font in mobile mode', () => {
        render(
            <EditorTerminal
                tabs={[tabs[1]]}
                activeTabId="term-1"
                isCollapsed={true}
                mobileMode={true}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={vi.fn()}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.queryByRole('button', { name: 'Expand terminal' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Collapse terminal' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open terminal' })).not.toBeInTheDocument()
        expect(mocks.sessionTabsProps[0]).toEqual(expect.objectContaining({ compactFontSize: true }))
    })

    it('confirms before closing a mobile terminal', () => {
        const onCloseTab = vi.fn()

        render(
            <EditorTerminal
                tabs={[{ id: 'term-machine', type: 'terminal', label: 'Terminal: bash', shell: 'bash', machineId: 'machine-1', cwd: '/repo' }]}
                activeTabId="term-machine"
                isCollapsed={true}
                mobileMode={true}
                api={null}
                onSelectTab={vi.fn()}
                onCloseTab={onCloseTab}
                onOpenTerminal={vi.fn()}
                onToggleCollapsed={vi.fn()}
            />
        )

        expect(screen.getAllByTestId('terminal-view')).toHaveLength(1)

        fireEvent.click(screen.getByRole('button', { name: 'Close terminal Terminal: bash' }))

        const dialog = screen.getByRole('dialog', { name: 'Close terminal?' })
        expect(dialog).toBeInTheDocument()
        expect(dialog).toHaveAttribute('data-app-dialog-presentation', 'alert')
        expect(dialog).not.toHaveClass('bottom-0', 'rounded-t-xl')
        expect(screen.getByRole('button', { name: 'Stop process and close' })).toHaveClass('w-full', 'py-2')
        const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement
        expect(within(footer!).getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Cancel',
            'Stop process and close',
        ])
        expect(footer).toHaveClass('grid', 'grid-cols-2')
        expect(onCloseTab).not.toHaveBeenCalled()
        expect(mocks.closesByTerminalId.get('term-machine')).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        expect(screen.queryByRole('dialog', { name: 'Close terminal?' })).not.toBeInTheDocument()
        expect(onCloseTab).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Close terminal Terminal: bash' }))
        const closeTerminal = mocks.closesByTerminalId.get('term-machine')
        fireEvent.click(screen.getByRole('button', { name: 'Stop process and close' }))

        expect(closeTerminal).toHaveBeenCalled()
        expect(onCloseTab).toHaveBeenCalledWith('term-machine')
    })

    it('shows the mobile terminal dock and sends a composed key only on Send', () => {
        renderMachineTerminal({ mobileMode: true })

        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
        fireEvent.click(screen.getByRole('button', { name: 'Tab' }))
        fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))

        expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toBeInTheDocument()
        expect(mocks.writesByTerminalId.get('term-machine')).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))
        expectTerminalWrite('term-machine', '\t')
    })

    it('does not focus xterm from the mobile Keys action', () => {
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })
        const { focus } = mountLastTerminal()

        expect(focus).not.toHaveBeenCalled()
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))

        expect(focus).not.toHaveBeenCalled()
    })

    it('does not focus xterm during direct Paste', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockResolvedValue('pwd') },
        })
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })
        const { focus } = mountLastTerminal()

        const pasteButton = screen.getByRole('button', { name: 'Paste' })
        fireEvent.pointerDown(pasteButton)
        fireEvent.click(pasteButton)

        await waitFor(() => expectTerminalWrite('term-machine', 'pwd'))
        expect(focus).not.toHaveBeenCalled()
        expect(screen.queryByRole('dialog', { name: 'Paste input' })).not.toBeInTheDocument()
    })

    it('does not focus xterm when manual Paste is cancelled or submitted', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
        })
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })
        const { focus } = mountLastTerminal()

        const pasteButton = screen.getByRole('button', { name: 'Paste' })
        fireEvent.pointerDown(pasteButton)
        fireEvent.click(pasteButton)
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Paste input' }))
            .getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste input' })).not.toBeInTheDocument())
        expect(focus).not.toHaveBeenCalled()

        fireEvent.pointerDown(pasteButton)
        fireEvent.click(pasteButton)
        const dialog = await screen.findByRole('dialog', { name: 'Paste input' })
        fireEvent.change(within(dialog).getByPlaceholderText('Paste terminal input here…'), {
            target: { value: 'pwd' },
        })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Paste' }))

        await waitFor(() => expectTerminalWrite('term-machine', 'pwd'))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste input' })).not.toBeInTheDocument())
        expect(focus).not.toHaveBeenCalled()
    })

    it('keeps the dock available below lg when editor mobile mode is false', () => {
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: false })
        const { focus } = mountLastTerminal()

        expect(focus).not.toHaveBeenCalled()
        expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toHaveClass('lg:hidden')
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Keys' }))

        expect(focus).not.toHaveBeenCalled()
    })

    it('preserves automatic terminal focus at desktop width', () => {
        setDockViewport(false)
        renderMachineTerminal({ mobileMode: false })
        const { focus } = mountLastTerminal()

        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('does not refocus xterm while composing and sending mobile keys', () => {
        setDockViewport(true)
        renderMachineTerminal({ mobileMode: true })
        const terminal = mountLastTerminal()

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        terminal.focus.mockClear()

        fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
        fireEvent.click(screen.getByRole('button', { name: 'Esc' }))
        fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))

        expectTerminalWrite('term-machine', '\u001b')
        expect(terminal.focus).not.toHaveBeenCalled()
    })

    it('closes the dock panel from terminal content without blurring the native input', () => {
        renderMachineTerminal({ mobileMode: true })
        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        expect(screen.getByRole('region', { name: 'More terminal keys' })).toBeInTheDocument()

        const terminalInput = document.createElement('textarea')
        document.body.appendChild(terminalInput)
        terminalInput.focus()
        expect(document.activeElement).toBe(terminalInput)

        fireEvent.pointerDown(screen.getByTestId('terminal-surface'))

        expect(screen.queryByRole('region', { name: 'More terminal keys' })).not.toBeInTheDocument()
        expect(document.activeElement).toBe(terminalInput)
        terminalInput.remove()
    })

    it('opens advanced keys in an anchored More panel', () => {
        renderMachineTerminal({ mobileMode: true })
        expect(screen.queryByRole('button', { name: 'F1' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'More' }))

        expect(screen.getByRole('region', { name: 'More terminal keys' })).toHaveClass('absolute')
        expect(screen.queryByRole('dialog', { name: 'More terminal keys' })).not.toBeInTheDocument()
        for (const key of ['F1', 'F6', 'F12', 'Home', 'End', 'PgUp', 'PgDn']) {
            expect(screen.getByRole('button', { name: key })).toBeInTheDocument()
        }

        pressQuickKey('F5')
        expectTerminalWrite('term-machine', '\u001b[15~')
    })

    it('offers modifiers, navigation, and function keys in the shared picker sheet', () => {
        renderMachineTerminal({ mobileMode: true })
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))

        const keyboardPanel = screen.getByRole('region', { name: 'Terminal helper keys' })
        expect(within(keyboardPanel).getByRole('button', { name: 'Add key' })).toBeInTheDocument()
        fireEvent.click(within(keyboardPanel).getByRole('button', { name: 'Add key' }))

        const picker = screen.getByRole('dialog', { name: 'Choose keys' })
        expect(picker).toHaveAttribute('data-app-dialog-presentation', 'sheet')
        for (const key of ['Ctrl', 'Alt', 'Shift', 'Esc', 'Tab']) {
            expect(within(picker).getByRole('button', { name: key })).toBeInTheDocument()
        }
        for (const key of ['←', '↑', '↓', '→']) {
            expect(within(picker).getByRole('button', { name: key })).toBeInTheDocument()
        }

        fireEvent.click(within(picker).getByRole('tab', { name: 'F1–F12' }))
        expect(within(picker).getByRole('button', { name: 'F1' })).toBeInTheDocument()
        expect(within(picker).queryByRole('button', { name: 'Esc' })).not.toBeInTheDocument()
    })
})
