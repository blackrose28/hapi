import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    TerminalControlDock,
    type TerminalControlDockProps,
} from './TerminalControlDock'
import {
    EMPTY_TERMINAL_SEARCH_STATE,
    type TerminalSearchController,
    type TerminalSearchState,
} from './terminalSearch'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string | number>) => ({
            'button.cancel': 'Cancel',
            'button.paste': 'Paste',
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
            'terminal.search.title': 'Search terminal output',
            'terminal.search.input': 'Search terminal output',
            'terminal.search.caseSensitive': 'Match case',
            'terminal.search.previous': 'Previous match',
            'terminal.search.next': 'Next match',
            'terminal.search.close': 'Close search',
            'terminal.search.loading': 'Loading search…',
            'terminal.search.unavailable': 'Search unavailable',
            'terminal.search.error': 'Search failed',
            'terminal.search.retry': 'Retry search',
            'terminal.snippets.title': 'Snippets',
            'terminal.snippets.insertOnly': 'Insert only · does not run',
            'terminal.snippets.new': 'New',
            'terminal.snippets.close': 'Close snippets',
            'terminal.snippets.search': 'Search snippets',
            'terminal.snippets.tabs': 'Snippet sources',
            'terminal.snippets.builtIn': 'Built-in',
            'terminal.snippets.mySnippets': 'My snippets',
            'terminal.snippets.insert': 'Insert',
            'terminal.snippets.insertFailed': 'Could not insert the snippet.',
            'terminal.snippets.inserted': 'Inserted · not executed',
            'terminal.snippets.group.navigation': 'Navigation',
            'terminal.snippets.group.git': 'Git',
            'terminal.snippets.group.system': 'System',
            'terminal.snippets.builtin.pwd.name': 'Working directory',
            'terminal.snippets.builtin.pwd.description': 'Show the current directory.',
            'terminal.snippets.builtin.list.name': 'List files',
            'terminal.snippets.builtin.list.description': 'List all files with details.',
            'terminal.snippets.builtin.clear.name': 'Clear terminal',
            'terminal.snippets.builtin.clear.description': 'Clear the terminal screen.',
            'terminal.snippets.builtin.gitStatus.name': 'Git status',
            'terminal.snippets.builtin.gitStatus.description': 'Show a concise working tree status.',
            'terminal.snippets.builtin.gitDiff.name': 'Git diff',
            'terminal.snippets.builtin.gitDiff.description': 'Show unstaged changes.',
            'terminal.snippets.builtin.gitLog.name': 'Recent commits',
            'terminal.snippets.builtin.gitLog.description': 'Show the ten latest commits.',
            'terminal.snippets.builtin.processes.name': 'Processes',
            'terminal.snippets.builtin.processes.description': 'Show running processes.',
            'terminal.snippets.builtin.disk.name': 'Disk usage',
            'terminal.snippets.builtin.disk.description': 'Show filesystem disk usage.',
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
        }[key] ?? key),
        locale: 'en',
    }),
}))

const defaultProps: TerminalControlDockProps = {
    api: null,
    terminalContextKey: 'terminal-1',
    disabled: false,
    activeTool: null,
    onActiveToolChange: vi.fn(),
    searchMounted: false,
    onSearchClose: vi.fn(),
    searchState: EMPTY_TERMINAL_SEARCH_STATE,
    historyState: { status: 'idle', entries: [] },
    onHistoryOpen: vi.fn(),
    onHistoryRefresh: vi.fn(),
    onHistoryClose: vi.fn(),
    onQuickInput: vi.fn(() => true),
    onWritePlainInput: vi.fn(() => true),
}

function makeReadySearchState(): TerminalSearchState {
    return {
        status: 'ready',
        controller: {
            findNext: vi.fn(() => true),
            findPrevious: vi.fn(() => true),
            clear: vi.fn(),
            subscribe: vi.fn(() => () => undefined),
        },
        error: null,
        retry: null,
    }
}

function makeDock(overrides: Partial<TerminalControlDockProps> = {}) {
    return <TerminalControlDock {...defaultProps} {...overrides} />
}

function renderDock(overrides: Partial<TerminalControlDockProps> = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return render(makeDock(overrides), { wrapper })
}

function ControlledDock(props: {
    onWritePlainInput: (text: string) => boolean
    onQuickInput?: (sequence: string) => boolean
    terminalContextKey?: string | null
}) {
    const [activeTool, setActiveTool] = useState<TerminalControlDockProps['activeTool']>(null)
    const dockProps = {
        ...defaultProps,
        terminalContextKey: props.terminalContextKey ?? 'terminal-1',
        activeTool,
        onActiveToolChange: setActiveTool,
        onWritePlainInput: props.onWritePlainInput,
        onQuickInput: props.onQuickInput ?? defaultProps.onQuickInput,
    } as TerminalControlDockProps
    return (
        <TerminalControlDock {...dockProps} />
    )
}

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('TerminalControlDock', () => {
    it('renders a slim six-item dock with Search, Snippets, and History enabled', () => {
        renderDock()

        expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toHaveClass(
            'min-h-[calc(56px+env(safe-area-inset-bottom))]',
            'pb-[env(safe-area-inset-bottom)]',
            'lg:hidden',
        )
        expect(
            screen.getByRole('toolbar', { name: 'Terminal controls' }).parentElement,
        ).not.toHaveClass('lg:hidden')
        expect(screen.getAllByRole('button')).toEqual(expect.arrayContaining([
            expect.objectContaining({ textContent: 'Paste' }),
            expect.objectContaining({ textContent: 'Snippets' }),
            expect.objectContaining({ textContent: 'Search' }),
            expect.objectContaining({ textContent: 'History' }),
            expect.objectContaining({ textContent: 'Keys' }),
            expect.objectContaining({ textContent: 'More' }),
        ]))
        expect(screen.getByRole('button', { name: 'Snippets' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'History' })).toBeEnabled()
    })

    it('opens Search in a floating region without a dialog or automatic focus', () => {
        const onActiveToolChange = vi.fn()
        const controller: TerminalSearchController = {
            findNext: vi.fn(() => true),
            findPrevious: vi.fn(() => true),
            clear: vi.fn(),
            subscribe: vi.fn(() => () => undefined),
        }
        const readyState: TerminalSearchState = {
            status: 'ready',
            controller,
            error: null,
            retry: null,
        }
        const rendered = renderDock({ onActiveToolChange, searchState: readyState })

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(onActiveToolChange).toHaveBeenCalledWith('search')

        rendered.rerender(makeDock({
            activeTool: 'search',
            onActiveToolChange,
            searchMounted: true,
            searchState: readyState,
        }))

        const panel = screen.getByRole('region', { name: 'Search terminal output' })
        expect(panel.parentElement).toHaveAttribute('role', 'region')
        expect(panel.parentElement).toHaveClass(
            'absolute',
            'lg:top-10',
            'lg:w-[520px]',
        )
        expect(
            screen.getAllByRole('region', { name: 'Search terminal output' }),
        ).toHaveLength(1)
        expect(screen.queryByRole('dialog', { name: 'Search terminal output' }))
            .not.toBeInTheDocument()
        expect(screen.getByRole('searchbox', { name: 'Search terminal output' }))
            .not.toHaveFocus()

        fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
        expect(defaultProps.onSearchClose).toHaveBeenCalledOnce()
        expect(onActiveToolChange).not.toHaveBeenCalledWith(null)
    })

    it('keeps the Search panel state mounted while another desktop tool is visible', () => {
        const readyState = makeReadySearchState()
        const rendered = renderDock({
            activeTool: 'search',
            searchMounted: true,
            searchState: readyState,
        })

        fireEvent.change(screen.getByRole('searchbox', {
            name: 'Search terminal output',
        }), {
            target: { value: 'needle' },
        })

        rendered.rerender(makeDock({
            activeTool: 'snippets',
            searchMounted: true,
            searchState: readyState,
        }))

        const hiddenPanel = screen.getByRole('region', {
            name: 'Search terminal output',
            hidden: true,
        }).parentElement
        expect(hiddenPanel).toHaveAttribute('hidden')

        rendered.rerender(makeDock({
            activeTool: 'search',
            searchMounted: true,
            searchState: readyState,
        }))
        expect(screen.getByRole('searchbox', {
            name: 'Search terminal output',
        })).toHaveValue('needle')
    })

    it('bridges Search loading, error, and ready states without changing dock behavior', () => {
        const retry = vi.fn()
        const controller: TerminalSearchController = {
            findNext: vi.fn(() => true),
            findPrevious: vi.fn(() => true),
            clear: vi.fn(),
            subscribe: vi.fn(() => () => undefined),
        }
        const rendered = renderDock({
            activeTool: 'search',
            searchMounted: true,
            searchState: {
                status: 'loading',
                controller: null,
                error: null,
                retry: null,
            },
        })

        expect(screen.getByRole('status')).toHaveTextContent('Loading search…')

        rendered.rerender(makeDock({
            activeTool: 'search',
            searchMounted: true,
            searchState: {
                status: 'error',
                controller: null,
                error: 'Addon failed',
                retry,
            },
        }))
        expect(screen.getByRole('alert')).toHaveTextContent('Addon failed')
        fireEvent.click(screen.getByRole('button', { name: 'Retry search' }))
        expect(retry).toHaveBeenCalledTimes(1)

        rendered.rerender(makeDock({
            activeTool: 'search',
            searchMounted: true,
            searchState: {
                status: 'ready',
                controller,
                error: null,
                retry: null,
            },
        }))
        expect(screen.getByRole('searchbox', { name: 'Search terminal output' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'History' })).toBeEnabled()
    })

    it('opens History in the shared anchored layer and inserts without executing', () => {
        const onActiveToolChange = vi.fn()
        const onHistoryOpen = vi.fn()
        const onWritePlainInput = vi.fn(() => true)
        const rendered = renderDock({
            onActiveToolChange,
            onHistoryOpen,
            onWritePlainInput,
        })

        fireEvent.click(screen.getByRole('button', { name: 'History' }))
        expect(onActiveToolChange).toHaveBeenCalledWith('history')

        rendered.rerender(makeDock({
            activeTool: 'history',
            onActiveToolChange,
            onHistoryOpen,
            onWritePlainInput,
            historyState: {
                status: 'ready',
                entries: [{ index: 9, command: 'git status' }],
            },
        }))

        expect(onHistoryOpen).toHaveBeenCalledOnce()
        const panel = screen.getByRole('region', { name: 'History' })
        expect(panel.parentElement).toHaveClass('absolute', 'lg:top-10', 'lg:w-[480px]')
        fireEvent.click(screen.getByRole('button', { name: 'Insert history command' }))
        expect(onWritePlainInput).toHaveBeenCalledWith('git status')
        expect(onWritePlainInput).not.toHaveBeenCalledWith('git status\r')
        expect(onActiveToolChange).toHaveBeenCalledWith(null)
    })

    it('opens Snippets in a floating region rather than a dialog', () => {
        const onActiveToolChange = vi.fn()
        const rendered = renderDock({ onActiveToolChange })

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(onActiveToolChange).toHaveBeenCalledWith('snippets')

        rendered.rerender(makeDock({
            activeTool: 'snippets',
            onActiveToolChange,
        }))

        const panel = screen.getByRole('region', { name: 'Snippets' })
        expect(panel.parentElement).toHaveAttribute('role', 'region')
        expect(panel.parentElement).toHaveClass(
            'absolute',
            'lg:top-10',
            'lg:w-[480px]',
        )
        expect(screen.queryByRole('dialog', { name: 'Snippets' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        expect(onActiveToolChange).toHaveBeenLastCalledWith(null)
    })

    it('inserts an exact snippet without executing it and keeps feedback after closing', () => {
        const onWritePlainInput = vi.fn<(text: string) => boolean>(() => true)
        const queryClient = new QueryClient()
        render(
            <QueryClientProvider client={queryClient}>
                <ControlledDock onWritePlainInput={onWritePlainInput} />
            </QueryClientProvider>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))

        expect(onWritePlainInput).toHaveBeenCalledWith('git status --short')
        expect(onWritePlainInput.mock.calls[0][0]).not.toMatch(/[\r\n]/)
        expect(screen.queryByRole('region', { name: 'Snippets' })).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Inserted · not executed')
    })

    it('keeps Snippets open when inserting into the terminal fails', () => {
        const onWritePlainInput = vi.fn(() => false)
        const queryClient = new QueryClient()
        render(
            <QueryClientProvider client={queryClient}>
                <ControlledDock onWritePlainInput={onWritePlainInput} />
            </QueryClientProvider>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Working directory' }))

        expect(onWritePlainInput).toHaveBeenCalledWith('pwd')
        expect(screen.getByRole('region', { name: 'Snippets' })).toBeVisible()
        expect(screen.getByRole('status')).toHaveTextContent('Could not insert the snippet.')
    })

    it('cleans up live snippet feedback when the dock unmounts', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
        const queryClient = new QueryClient()
        const rendered = render(
            <QueryClientProvider client={queryClient}>
                <ControlledDock onWritePlainInput={() => true} />
            </QueryClientProvider>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
        expect(screen.getByRole('status')).toHaveTextContent('Inserted · not executed')

        const feedbackTimer = setTimeoutSpy.mock.results.find((_, index) => (
            setTimeoutSpy.mock.calls[index]?.[1] === 1200
        ))?.value
        expect(feedbackTimer).toBeDefined()

        rendered.unmount()

        expect(clearTimeoutSpy).toHaveBeenCalledWith(feedbackTimer)
        act(() => vi.runOnlyPendingTimers())
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Snippets' })).not.toBeInTheDocument()
    })

    it('publishes a distinct live-region node for every rapid successful insert', () => {
        const queryClient = new QueryClient()
        render(
            <QueryClientProvider client={queryClient}>
                <ControlledDock onWritePlainInput={() => true} />
            </QueryClientProvider>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
        const firstAnnouncement = screen.getByRole('status')

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
        const secondAnnouncement = screen.getByRole('status')

        expect(secondAnnouncement).toHaveTextContent('Inserted · not executed')
        expect(secondAnnouncement).not.toBe(firstAnnouncement)
    })

    it('clears snippet feedback and its timer when terminal context changes', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
        const queryClient = new QueryClient()
        const rendered = render(
            <QueryClientProvider client={queryClient}>
                <ControlledDock
                    terminalContextKey="terminal-1"
                    onWritePlainInput={() => true}
                />
            </QueryClientProvider>,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
        const feedbackTimer = setTimeoutSpy.mock.results.find((_, index) => (
            setTimeoutSpy.mock.calls[index]?.[1] === 1200
        ))?.value
        expect(screen.getByRole('status')).toHaveTextContent('Inserted · not executed')

        rendered.rerender(
            <QueryClientProvider client={queryClient}>
                <ControlledDock
                    terminalContextKey="terminal-2"
                    onWritePlainInput={() => true}
                />
            </QueryClientProvider>,
        )

        expect(clearTimeoutSpy).toHaveBeenCalledWith(feedbackTimer)
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        act(() => vi.runOnlyPendingTimers())
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('opens an anchored panel instead of a dialog and toggles it closed', () => {
        const onActiveToolChange = vi.fn()
        const { rerender } = renderDock({ activeTool: null, onActiveToolChange })

        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        expect(onActiveToolChange).toHaveBeenCalledWith('more')

        rerender(makeDock({ activeTool: 'more', onActiveToolChange }))
        expect(screen.getByRole('region', { name: 'More terminal keys' })).toHaveClass('absolute')
        expect(screen.queryByRole('dialog', { name: 'More terminal keys' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'More' }))
        expect(onActiveToolChange).toHaveBeenLastCalledWith(null)
    })

    it('opens the Keys helper panel', () => {
        const onActiveToolChange = vi.fn()
        const rendered = renderDock({ onActiveToolChange })

        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))

        expect(onActiveToolChange).toHaveBeenCalledWith('keys')
        rendered.rerender(makeDock({
            activeTool: 'keys',
            onActiveToolChange,
        }))
        expect(screen.getByRole('region', { name: 'Terminal helper keys' })).toBeVisible()
    })

    it('pastes directly without summoning manual input', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockResolvedValue('pwd') },
        })
        const onWritePlainInput = vi.fn(() => true)
        renderDock({ onWritePlainInput })

        fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

        await waitFor(() => expect(onWritePlainInput).toHaveBeenCalledWith('pwd'))
        expect(screen.queryByRole('dialog', { name: 'Paste input' })).not.toBeInTheDocument()
    })

    it('keeps Paste immediate and falls back to manual input', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
        })
        const onActiveToolChange = vi.fn()
        renderDock({ onActiveToolChange })

        fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
        expect(await screen.findByRole('dialog', { name: 'Paste input' })).toBeInTheDocument()
        expect(onActiveToolChange).not.toHaveBeenCalled()
    })

    it('submits manual paste input', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
        })
        const onWritePlainInput = vi.fn(() => true)
        renderDock({ onWritePlainInput })

        fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
        const dialog = await screen.findByRole('dialog', { name: 'Paste input' })
        fireEvent.change(within(dialog).getByPlaceholderText('Paste terminal input here…'), {
            target: { value: 'pwd' },
        })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Paste' }))

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste input' })).not.toBeInTheDocument())
        expect(onWritePlainInput).toHaveBeenCalledWith('pwd')
    })

    it('opens the key composer without writing to the terminal', () => {
        const onQuickInput = vi.fn(() => true)
        renderDock({ activeTool: 'keys', onQuickInput })

        expect(screen.getByText('Saved · 0')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Add key' }))

        expect(screen.getByRole('dialog', { name: 'Choose keys' })).toBeInTheDocument()
        expect(onQuickInput).not.toHaveBeenCalled()
    })

    it('writes a composed chord only after Send', () => {
        const onQuickInput = vi.fn(() => true)
        renderDock({ activeTool: 'keys', onQuickInput })

        fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
        fireEvent.click(screen.getByRole('button', { name: 'Shift' }))
        fireEvent.click(screen.getByRole('tab', { name: 'F1–F12' }))
        fireEvent.click(screen.getByRole('button', { name: 'F10' }))
        fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))

        expect(onQuickInput).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))
        expect(onQuickInput).toHaveBeenCalledWith('\x1b[21;6~')
    })

    it('keeps the composer draft when Keys is toggled closed and open', () => {
        render(
            <ControlledDock
                onWritePlainInput={() => true}
                onQuickInput={() => true}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
        fireEvent.click(screen.getByRole('tab', { name: 'F1–F12' }))
        fireEvent.click(screen.getByRole('button', { name: 'F10' }))
        fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))

        expect(screen.getByText('F10')).toBeInTheDocument()
    })

    it('announces a successful direct paste without selecting a tool', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { readText: vi.fn().mockResolvedValue('pwd') },
        })
        const onWritePlainInput = vi.fn(() => true)
        const onActiveToolChange = vi.fn()
        renderDock({ onWritePlainInput, onActiveToolChange })

        fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
        expect(await screen.findByRole('status')).toHaveTextContent('Pasted')
        expect(onWritePlainInput).toHaveBeenCalledWith('pwd')
        expect(onActiveToolChange).not.toHaveBeenCalled()
    })
})
