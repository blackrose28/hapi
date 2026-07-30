import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
    CreateTerminalSnippetInput,
    TerminalSnippet,
    UpdateTerminalSnippetInput,
} from '@hapi/protocol'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { TerminalSnippetPanel, type TerminalSnippetPanelProps } from './TerminalSnippetPanel'
import { TERMINAL_SNIPPET_CATALOG } from './terminalSnippetCatalog'

const translations: Record<string, string> = {
    'button.cancel': 'Cancel',
    'dialog.error.default': 'Operation failed',
    'terminal.snippets.title': 'Snippets',
    'terminal.snippets.insertOnly': 'Insert only · does not run',
    'terminal.snippets.new': 'New',
    'terminal.snippets.close': 'Close snippets',
    'terminal.snippets.search': 'Search snippets',
    'terminal.snippets.tabs': 'Snippet sources',
    'terminal.snippets.builtIn': 'Built-in',
    'terminal.snippets.mySnippets': 'My snippets',
    'terminal.snippets.insert': 'Insert',
    'terminal.snippets.edit': 'Edit',
    'terminal.snippets.delete': 'Delete',
    'terminal.snippets.loading': 'Loading snippets…',
    'terminal.snippets.retry': 'Retry',
    'terminal.snippets.empty': 'No saved snippets yet.',
    'terminal.snippets.noResults': 'No snippets match your search.',
    'terminal.snippets.unavailable': 'Saved snippets are unavailable.',
    'terminal.snippets.insertFailed': 'Could not insert the snippet.',
    'terminal.snippets.inserted': 'Inserted · not executed',
    'terminal.snippets.editor.newTitle': 'New snippet',
    'terminal.snippets.editor.editTitle': 'Edit snippet',
    'terminal.snippets.editor.name': 'Name',
    'terminal.snippets.editor.command': 'Command',
    'terminal.snippets.editor.description': 'Description (optional)',
    'terminal.snippets.editor.secretWarning': 'Plain text only. Do not store passwords, tokens, or secrets.',
    'terminal.snippets.editor.save': 'Save',
    'terminal.snippets.editor.saving': 'Saving…',
    'terminal.snippets.editor.back': 'Back to snippets',
    'terminal.snippets.deleteTitle': 'Delete snippet',
    'terminal.snippets.deleteDescription': 'Delete “{name}”? This cannot be undone.',
    'terminal.snippets.deleting': 'Deleting…',
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
}

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        locale: 'en',
        t: (key: string, params?: Record<string, string | number>) => {
            const value = translations[key] ?? key
            return value.replace(/\{(\w+)\}/g, (match, name) => (
                params?.[name] === undefined ? match : String(params[name])
            ))
        },
    }),
}))

function snippet(overrides: Partial<TerminalSnippet> = {}): TerminalSnippet {
    return {
        id: 'snippet-1',
        name: 'Deploy app',
        command: 'bun run deploy',
        description: 'Ship the current build',
        createdAt: 20,
        updatedAt: 20,
        ...overrides,
    }
}

function apiMock(overrides: {
    getTerminalSnippets?: () => Promise<{ snippets: TerminalSnippet[] }>
    createTerminalSnippet?: (
        input: CreateTerminalSnippetInput,
    ) => Promise<{ snippet: TerminalSnippet }>
    updateTerminalSnippet?: (
        id: string,
        input: UpdateTerminalSnippetInput,
    ) => Promise<{ snippet: TerminalSnippet }>
    deleteTerminalSnippet?: (id: string) => Promise<void>
} = {}): ApiClient {
    return {
        cacheScope: 'hub::namespace',
        getTerminalSnippets: vi.fn(async () => ({ snippets: [] })),
        createTerminalSnippet: vi.fn(),
        updateTerminalSnippet: vi.fn(),
        deleteTerminalSnippet: vi.fn(),
        ...overrides,
    } as unknown as ApiClient
}

function createHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return { queryClient, wrapper }
}

const defaultProps: TerminalSnippetPanelProps = {
    api: null,
    disabled: false,
    onInsert: vi.fn(() => true),
    onClose: vi.fn(),
}

function renderPanel(overrides: Partial<TerminalSnippetPanelProps> = {}) {
    const harness = createHarness()
    const result = render(
        <TerminalSnippetPanel {...defaultProps} {...overrides} />,
        { wrapper: harness.wrapper },
    )
    return { ...result, ...harness }
}

function openCustomTab() {
    fireEvent.click(screen.getByRole('tab', { name: 'My snippets' }))
}

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('TerminalSnippetPanel built-in catalog', () => {
    it('renders the exact grouped catalog without requesting custom snippets', () => {
        const api = apiMock()
        renderPanel({ api })

        expect(TERMINAL_SNIPPET_CATALOG.map((item) => [item.group, item.command])).toEqual([
            ['navigation', 'pwd'],
            ['navigation', 'ls -la'],
            ['navigation', 'clear'],
            ['git', 'git status --short'],
            ['git', 'git diff'],
            ['git', 'git log --oneline -10'],
            ['system', 'ps aux'],
            ['system', 'df -h'],
        ])
        expect(screen.getAllByTestId('snippet-command').map((node) => node.textContent)).toEqual(
            TERMINAL_SNIPPET_CATALOG.map((item) => item.command),
        )
        expect(screen.getByRole('heading', { name: 'Navigation' })).toBeVisible()
        expect(screen.getByRole('heading', { name: 'Git' })).toBeVisible()
        expect(screen.getByRole('heading', { name: 'System' })).toBeVisible()
        expect(api.getTerminalSnippets).not.toHaveBeenCalled()
    })

    it('gives every built-in insert action a distinct accessible name', () => {
        renderPanel()

        expect(screen.queryByRole('button', { name: 'Insert' })).not.toBeInTheDocument()
        for (const item of TERMINAL_SNIPPET_CATALOG) {
            expect(screen.getByRole('button', {
                name: `Insert ${translations[item.nameKey]}`,
            })).toBeVisible()
        }
    })

    it('inserts the exact command without a newline, announces through callback, then closes', () => {
        const onInsert = vi.fn<(command: string) => boolean>(() => true)
        const onInserted = vi.fn()
        const onClose = vi.fn()
        renderPanel({ onInsert, onInserted, onClose })

        const row = screen.getByText('git status --short').closest('[data-snippet-row]')
        fireEvent.click(within(row as HTMLElement).getByRole('button', {
            name: 'Insert Git status',
        }))

        expect(onInsert).toHaveBeenCalledWith('git status --short')
        expect(onInsert.mock.calls[0][0]).not.toMatch(/[\r\n]/)
        expect(onInserted).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('keeps the panel open and shows a nonblocking error when insertion fails', () => {
        const onClose = vi.fn()
        renderPanel({ onInsert: vi.fn(() => false), onClose })

        const row = screen.getByText('pwd').closest('[data-snippet-row]')
        fireEvent.click(within(row as HTMLElement).getByRole('button', {
            name: 'Insert Working directory',
        }))

        expect(onClose).not.toHaveBeenCalled()
        expect(screen.getByRole('status')).toHaveTextContent('Could not insert the snippet.')
        expect(screen.getByRole('region', { name: 'Snippets' })).toBeVisible()
    })

    it('filters the active built-in tab across translated name, command, and description', () => {
        renderPanel()
        const search = screen.getByRole('searchbox', { name: 'Search snippets' })

        fireEvent.change(search, { target: { value: 'LATEST COMMITS' } })
        expect(screen.getByText('git log --oneline -10')).toBeVisible()
        expect(screen.queryByText('pwd')).not.toBeInTheDocument()

        fireEvent.change(search, { target: { value: 'DF -H' } })
        expect(screen.getByText('df -h')).toBeVisible()

        fireEvent.change(search, { target: { value: 'working DIRECTORY' } })
        expect(screen.getByText('pwd')).toBeVisible()
    })
})

describe('TerminalSnippetPanel custom loading', () => {
    it('associates tabs with panels and supports roving keyboard selection', async () => {
        const api = apiMock()
        renderPanel({ api })
        const builtIn = screen.getByRole('tab', { name: 'Built-in' })
        const custom = screen.getByRole('tab', { name: 'My snippets' })

        expect(builtIn.id).not.toBe('')
        expect(custom.id).not.toBe('')
        expect(builtIn).toHaveAttribute('aria-controls')
        expect(custom).toHaveAttribute('aria-controls')
        const builtInPanel = document.getElementById(
            builtIn.getAttribute('aria-controls') ?? '',
        ) as HTMLElement
        const customPanel = document.getElementById(
            custom.getAttribute('aria-controls') ?? '',
        ) as HTMLElement
        expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
        expect(builtInPanel).toHaveAttribute('aria-labelledby', builtIn.id)
        expect(customPanel).toHaveAttribute('aria-labelledby', custom.id)
        expect(builtInPanel).toBeVisible()
        expect(customPanel).not.toBeVisible()

        builtIn.focus()
        fireEvent.keyDown(builtIn, { key: 'ArrowRight' })
        expect(custom).toHaveFocus()
        expect(custom).toHaveAttribute('aria-selected', 'true')
        expect(document.getElementById(
            builtIn.getAttribute('aria-controls') ?? '',
        )).toBe(builtInPanel)
        expect(document.getElementById(
            custom.getAttribute('aria-controls') ?? '',
        )).toBe(customPanel)
        expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
        expect(builtInPanel).not.toBeVisible()
        expect(customPanel).toBeVisible()
        expect(screen.getByRole('tabpanel')).toBe(customPanel)
        expect(customPanel).toHaveAttribute(
            'aria-labelledby',
            custom.id,
        )
        await waitFor(() => expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1))

        fireEvent.keyDown(custom, { key: 'ArrowRight' })
        expect(builtIn).toHaveFocus()
        expect(builtIn).toHaveAttribute('aria-selected', 'true')

        fireEvent.keyDown(builtIn, { key: 'ArrowLeft' })
        expect(custom).toHaveFocus()
        expect(custom).toHaveAttribute('aria-selected', 'true')

        fireEvent.keyDown(custom, { key: 'Home' })
        expect(builtIn).toHaveFocus()
        expect(builtIn).toHaveAttribute('aria-selected', 'true')

        fireEvent.keyDown(builtIn, { key: 'End' })
        expect(custom).toHaveFocus()
        expect(custom).toHaveAttribute('aria-selected', 'true')
        expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1)
    })

    it('starts one lazy request on the first custom-tab selection and retains enablement', async () => {
        const api = apiMock()
        renderPanel({ api })

        expect(api.getTerminalSnippets).not.toHaveBeenCalled()
        openCustomTab()
        await waitFor(() => expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('tab', { name: 'Built-in' }))
        openCustomTab()
        await waitFor(() => expect(api.getTerminalSnippets).toHaveBeenCalledTimes(1))
    })

    it('shows custom load errors with retry while built-ins remain usable', async () => {
        const getTerminalSnippets = vi.fn()
            .mockRejectedValueOnce(new Error('Hub offline'))
            .mockResolvedValueOnce({ snippets: [] })
        renderPanel({ api: apiMock({ getTerminalSnippets }) })

        openCustomTab()
        expect(await screen.findByRole('alert')).toHaveTextContent('Hub offline')
        expect(screen.queryByText('No saved snippets yet.')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'Built-in' }))
        expect(screen.getByText('pwd')).toBeVisible()
        fireEvent.click(screen.getByRole('tab', { name: 'My snippets' }))
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(getTerminalSnippets).toHaveBeenCalledTimes(2))
        expect(await screen.findByText('No saved snippets yet.')).toBeVisible()
    })

    it('keeps cached custom rows visible when a background load fails', async () => {
        const cached = snippet()
        const api = apiMock({
            getTerminalSnippets: vi.fn(async () => {
                throw new Error('Refresh failed')
            }),
        })
        const harness = createHarness()
        harness.queryClient.setQueryData(
            queryKeys.terminalSnippets(api.cacheScope),
            { snippets: [cached] },
        )
        render(
            <TerminalSnippetPanel {...defaultProps} api={api} />,
            { wrapper: harness.wrapper },
        )

        openCustomTab()

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed')
        })
        expect(screen.getByText(cached.name)).toBeVisible()
    })

    it('shows API-unavailable and empty custom states', async () => {
        const unavailable = renderPanel({ api: null })
        openCustomTab()
        expect(screen.getByText('Saved snippets are unavailable.')).toBeVisible()
        unavailable.unmount()

        renderPanel({ api: apiMock() })
        openCustomTab()
        expect(await screen.findByText('No saved snippets yet.')).toBeVisible()
    })

    it('filters custom snippets without changing server order', async () => {
        const snippets = [
            snippet({ id: 'new', name: 'Deploy app', createdAt: 20 }),
            snippet({
                id: 'old',
                name: 'Inspect service',
                command: 'systemctl status hapi',
                description: 'Production diagnostics',
                createdAt: 10,
            }),
        ]
        renderPanel({
            api: apiMock({
                getTerminalSnippets: vi.fn(async () => ({ snippets })),
            }),
        })
        openCustomTab()
        await screen.findByText('Deploy app')

        expect(screen.getAllByTestId('custom-snippet-name').map((node) => node.textContent)).toEqual([
            'Deploy app',
            'Inspect service',
        ])
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'PRODUCTION DIAGNOSTICS' },
        })
        expect(screen.queryByText('Deploy app')).not.toBeInTheDocument()
        expect(screen.getByText('Inspect service')).toBeVisible()
    })
})

describe('TerminalSnippetPanel editor', () => {
    it('refetches a missing list after create succeeds and shows the full server list', async () => {
        const created = snippet({ id: 'created', name: 'Created after error' })
        const existing = snippet({
            id: 'existing',
            name: 'Existing server snippet',
            createdAt: 10,
            updatedAt: 10,
        })
        const getTerminalSnippets = vi.fn()
            .mockRejectedValueOnce(new Error('Initial load failed'))
            .mockResolvedValueOnce({ snippets: [created, existing] })
        const createTerminalSnippet = vi.fn(async () => ({ snippet: created }))
        renderPanel({
            api: apiMock({ getTerminalSnippets, createTerminalSnippet }),
        })

        openCustomTab()
        expect(await screen.findByRole('alert')).toHaveTextContent('Initial load failed')
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: created.name },
        })
        fireEvent.change(screen.getByLabelText('Command'), {
            target: { value: created.command },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(createTerminalSnippet).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(getTerminalSnippets).toHaveBeenCalledTimes(2))
        expect(await screen.findByText(created.name)).toBeVisible()
        expect(screen.getByText(existing.name)).toBeVisible()
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    })

    it('returns to the errored list when post-create refetch fails without resubmitting', async () => {
        const created = snippet({ id: 'created', name: 'Created once' })
        const getTerminalSnippets = vi.fn()
            .mockRejectedValueOnce(new Error('Initial load failed'))
            .mockRejectedValueOnce(new Error('Refresh failed'))
            .mockRejectedValueOnce(new Error('Refresh failed'))
            .mockResolvedValueOnce({ snippets: [created] })
        const createTerminalSnippet = vi.fn(async () => ({ snippet: created }))
        renderPanel({
            api: apiMock({ getTerminalSnippets, createTerminalSnippet }),
        })

        openCustomTab()
        expect(await screen.findByRole('alert')).toHaveTextContent('Initial load failed')
        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: created.name },
        })
        fireEvent.change(screen.getByLabelText('Command'), {
            target: { value: created.command },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed')
        expect(getTerminalSnippets).toHaveBeenCalledTimes(3)
        expect(createTerminalSnippet).toHaveBeenCalledTimes(1)
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(await screen.findByText(created.name)).toBeVisible()
        expect(createTerminalSnippet).toHaveBeenCalledTimes(1)
    })

    it('creates a snippet, updates the cache, and returns to the custom list', async () => {
        const created = snippet({ id: 'created', name: 'Restart app' })
        const createTerminalSnippet = vi.fn(async () => ({ snippet: created }))
        renderPanel({ api: apiMock({ createTerminalSnippet }) })

        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        expect(screen.getByRole('tab', { name: 'My snippets' })).toHaveAttribute('aria-selected', 'true')
        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: '  Restart app  ' },
        })
        fireEvent.change(screen.getByLabelText('Command'), {
            target: { value: 'bun run deploy' },
        })
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: '  Ship the current build  ' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(createTerminalSnippet).toHaveBeenCalledWith({
            name: 'Restart app',
            command: 'bun run deploy',
            description: 'Ship the current build',
        }))
        expect(await screen.findByText('Restart app')).toBeVisible()
    })

    it('preserves every editor value and prevents repeat submits when save fails or is pending', async () => {
        let rejectCreate!: (error: Error) => void
        const createPromise = new Promise<{ snippet: TerminalSnippet }>((_resolve, reject) => {
            rejectCreate = reject
        })
        const createTerminalSnippet = vi.fn(() => createPromise)
        renderPanel({ api: apiMock({ createTerminalSnippet }) })

        fireEvent.click(screen.getByRole('button', { name: 'New' }))
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keep name' } })
        fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo secretless' } })
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: 'Keep description' },
        })
        const save = screen.getByRole('button', { name: 'Save' })
        fireEvent.click(save)
        fireEvent.click(save)

        await waitFor(() => expect(createTerminalSnippet).toHaveBeenCalledTimes(1))
        expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
        rejectCreate(new Error('Save failed'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
        expect(screen.getByLabelText('Name')).toHaveValue('Keep name')
        expect(screen.getByLabelText('Command')).toHaveValue('echo secretless')
        expect(screen.getByLabelText('Description (optional)')).toHaveValue('Keep description')
    })

    it('populates edit fields and updates the row in place', async () => {
        const first = snippet({ id: 'first', name: 'First', createdAt: 20 })
        const second = snippet({ id: 'second', name: 'Second', createdAt: 10 })
        const updated = { ...first, name: 'First updated', updatedAt: 30 }
        const updateTerminalSnippet = vi.fn(async () => ({ snippet: updated }))
        renderPanel({
            api: apiMock({
                getTerminalSnippets: vi.fn()
                    .mockResolvedValueOnce({ snippets: [first, second] })
                    .mockResolvedValue({ snippets: [updated, second] }),
                updateTerminalSnippet,
            }),
        })
        openCustomTab()
        await screen.findByText('First')
        const firstRow = screen.getByText('First').closest('[data-snippet-row]')
        fireEvent.click(within(firstRow as HTMLElement).getByRole('button', { name: 'Edit First' }))

        expect(screen.getByLabelText('Name')).toHaveValue('First')
        expect(screen.getByLabelText('Command')).toHaveValue(first.command)
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First updated' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(updateTerminalSnippet).toHaveBeenCalledWith('first', {
            name: 'First updated',
            command: first.command,
            description: first.description,
        }))
        expect(screen.getAllByTestId('custom-snippet-name').map((node) => node.textContent)).toEqual([
            'First updated',
            'Second',
        ])
    })

    it('sets editor limits and safe command-text input attributes', () => {
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'New' }))

        expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '80')
        expect(screen.getByLabelText('Command')).toHaveAttribute('maxlength', '8192')
        expect(screen.getByLabelText('Command')).toHaveAttribute('autocapitalize', 'none')
        expect(screen.getByLabelText('Command')).toHaveAttribute('autocorrect', 'off')
        expect(screen.getByLabelText('Command')).toHaveAttribute('spellcheck', 'false')
        expect(screen.getByLabelText('Description (optional)')).toHaveAttribute('maxlength', '240')
        expect(screen.getByText(/Do not store passwords, tokens, or secrets/)).toBeVisible()
    })

    it('uses a compact mobile grid while preserving the spacious desktop layout', () => {
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: 'New' }))

        const nameField = screen.getByLabelText('Name').closest('[data-editor-field]')
        const command = screen.getByLabelText('Command')
        const commandField = command.closest('[data-editor-field]')
        const description = screen.getByLabelText('Description (optional)')
        const descriptionField = description.closest('[data-editor-field]')
        const save = screen.getByRole('button', { name: 'Save' })

        expect(nameField).toHaveClass('col-span-2', 'sm:col-span-1', 'order-1')
        expect(descriptionField).toHaveClass(
            'col-span-3',
            'sm:col-span-1',
            'order-2',
            'sm:order-3',
        )
        expect(commandField).toHaveClass(
            'col-span-5',
            'sm:col-span-1',
            'order-3',
            'sm:order-2',
        )
        expect(command).toHaveAttribute('rows', '3')
        expect(command).toHaveClass('resize-none', 'sm:resize-y')
        expect(description).toHaveAttribute('rows', '1')
        expect(description).toHaveClass('resize-none', 'sm:resize-y')
        expect(save).toHaveClass('w-full', 'sm:w-auto')
    })
})

describe('TerminalSnippetPanel deletion and accessibility', () => {
    it('opens the shared destructive dialog and removes a confirmed snippet', async () => {
        const saved = snippet()
        const deleteTerminalSnippet = vi.fn(async () => undefined)
        renderPanel({
            api: apiMock({
                getTerminalSnippets: vi.fn()
                    .mockResolvedValueOnce({ snippets: [saved] })
                    .mockResolvedValue({ snippets: [] }),
                deleteTerminalSnippet,
            }),
        })
        openCustomTab()
        const name = await screen.findByText(saved.name)
        const row = name.closest('[data-snippet-row]') as HTMLElement
        const buttons = within(row).getAllByRole('button')

        expect(buttons).toHaveLength(3)
        expect(row.querySelector('button button')).toBeNull()
        expect(buttons.every((button) => button.parentElement === buttons[0].parentElement)).toBe(true)
        fireEvent.click(within(row).getByRole('button', { name: `Delete ${saved.name}` }))

        const dialog = screen.getByRole('dialog', { name: 'Delete snippet' })
        expect(within(dialog).getByText(`Delete “${saved.name}”? This cannot be undone.`)).toBeVisible()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(deleteTerminalSnippet).toHaveBeenCalledWith(saved.id))
        await waitFor(() => expect(screen.queryByText(saved.name)).not.toBeInTheDocument())
    })

    it('keeps the delete dialog open and displays a deletion failure', async () => {
        const saved = snippet()
        renderPanel({
            api: apiMock({
                getTerminalSnippets: vi.fn(async () => ({ snippets: [saved] })),
                deleteTerminalSnippet: vi.fn(async () => {
                    throw new Error('Delete denied')
                }),
            }),
        })
        openCustomTab()
        const row = (await screen.findByText(saved.name)).closest('[data-snippet-row]')
        fireEvent.click(within(row as HTMLElement).getByRole('button', { name: `Delete ${saved.name}` }))
        const dialog = screen.getByRole('dialog', { name: 'Delete snippet' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

        expect(await within(dialog).findByText('Delete denied')).toBeVisible()
        expect(screen.getByRole('dialog', { name: 'Delete snippet' })).toBeVisible()
    })

    it('locks the delete target and every dismissal path while deletion is pending', async () => {
        let resolveDelete!: () => void
        const deletePromise = new Promise<void>((resolve) => {
            resolveDelete = resolve
        })
        const first = snippet({ id: 'first', name: 'First snippet' })
        const second = snippet({ id: 'second', name: 'Second snippet' })
        const deleteTerminalSnippet = vi.fn(() => deletePromise)
        renderPanel({
            api: apiMock({
                getTerminalSnippets: vi.fn(async () => ({
                    snippets: [first, second],
                })),
                deleteTerminalSnippet,
            }),
        })
        openCustomTab()
        const firstRow = (await screen.findByText(first.name)).closest('[data-snippet-row]')
        fireEvent.click(within(firstRow as HTMLElement).getByRole('button', {
            name: `Delete ${first.name}`,
        }))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
            name: 'Delete',
        }))

        await waitFor(() => expect(deleteTerminalSnippet).toHaveBeenCalledWith(first.id))
        const close = within(screen.getByRole('dialog')).getByRole('button', {
            name: 'Close',
        })
        expect(close).toBeDisabled()
        fireEvent.click(close)
        fireEvent.keyDown(document, { key: 'Escape' })
        fireEvent.pointerDown(document.body)

        const pendingDialog = screen.getByRole('dialog', { name: 'Delete snippet' })
        expect(within(pendingDialog).getByText(
            `Delete “${first.name}”? This cannot be undone.`,
        )).toBeVisible()
        expect(screen.queryByText(
            `Delete “${second.name}”? This cannot be undone.`,
        )).not.toBeInTheDocument()

        resolveDelete()
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Delete snippet' }))
                .not.toBeInTheDocument()
        })

        const secondRow = screen.getByText(second.name).closest('[data-snippet-row]')
        fireEvent.click(within(secondRow as HTMLElement).getByRole('button', {
            name: `Delete ${second.name}`,
        }))
        expect(within(screen.getByRole('dialog')).getByText(
            `Delete “${second.name}”? This cannot be undone.`,
        )).toBeVisible()
    })

    it('uses tab semantics, a polite live region, reachable 44px actions, and disables insertion', () => {
        const onInsert = vi.fn(() => true)
        renderPanel({ disabled: true, onInsert })

        expect(screen.getByRole('tablist', { name: 'Snippet sources' })).toBeVisible()
        expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
        const insertButtons = screen.getAllByRole('button', { name: /^Insert / })
        expect(insertButtons[0]).toHaveClass('min-h-11', 'min-w-11')
        expect(insertButtons[0]).toBeDisabled()
        fireEvent.click(insertButtons[0])
        expect(onInsert).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Close snippets' })).toHaveClass('min-h-11', 'min-w-11')
    })
})
