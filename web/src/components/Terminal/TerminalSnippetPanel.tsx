import {
    useId,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
} from 'react'
import type { TerminalSnippet } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTerminalSnippets } from '@/hooks/queries/useTerminalSnippets'
import { useTranslation } from '@/lib/use-translation'
import {
    TerminalSnippetEditor,
    type TerminalSnippetEditorState,
} from './TerminalSnippetEditor'
import {
    TERMINAL_SNIPPET_CATALOG,
    type TerminalSnippetCatalogGroup,
} from './terminalSnippetCatalog'

export type TerminalSnippetPanelProps = {
    api: ApiClient | null
    disabled: boolean
    onInsert: (command: string) => boolean
    onClose: () => void
    onInserted?: () => void
}

type ActiveTab = 'built-in' | 'custom'

const TAB_ORDER: readonly ActiveTab[] = ['built-in', 'custom']

const GROUP_ORDER: readonly TerminalSnippetCatalogGroup[] = [
    'navigation',
    'git',
    'system',
]

const GROUP_KEYS: Record<TerminalSnippetCatalogGroup, string> = {
    navigation: 'terminal.snippets.group.navigation',
    git: 'terminal.snippets.group.git',
    system: 'terminal.snippets.group.system',
}

const emptyEditor = (): TerminalSnippetEditorState => ({
    mode: 'create',
    name: '',
    command: '',
    description: '',
})

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback
}

function ActionIcon({ children }: { children: ReactNode }) {
    return (
        <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-xs font-semibold text-violet-600 dark:text-violet-300"
        >
            {children}
        </span>
    )
}

function SnippetActionButton(props: {
    label: string
    disabled?: boolean
    onClick: () => void
    children: ReactNode
    destructive?: boolean
}) {
    return (
        <button
            type="button"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className={`min-h-11 min-w-11 rounded-lg px-2 text-xs font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 ${
                props.destructive
                    ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                    : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
            }`}
        >
            {props.children}
        </button>
    )
}

function matchesSearch(values: Array<string | null>, query: string, locale: string): boolean {
    if (!query) return true
    return values.some((value) => (
        value?.toLocaleLowerCase(locale).includes(query) ?? false
    ))
}

export function TerminalSnippetPanel(props: TerminalSnippetPanelProps) {
    const { t, locale } = useTranslation()
    const [activeTab, setActiveTab] = useState<ActiveTab>('built-in')
    const [customEnabled, setCustomEnabled] = useState(false)
    const [search, setSearch] = useState('')
    const [editor, setEditor] = useState<TerminalSnippetEditorState | null>(null)
    const [editorError, setEditorError] = useState<string | null>(null)
    const [insertStatus, setInsertStatus] = useState('')
    const [deleteTarget, setDeleteTarget] = useState<TerminalSnippet | null>(null)
    const savingRef = useRef(false)
    const tabIdPrefix = useId()
    const tabRefs = useRef<Record<ActiveTab, HTMLButtonElement | null>>({
        'built-in': null,
        custom: null,
    })
    const {
        snippets,
        isLoading,
        error,
        refetch,
        createSnippet,
        ensureCreatedSnippetVisible,
        updateSnippet,
        deleteSnippet,
        isPending,
    } = useTerminalSnippets(props.api, customEnabled)

    const normalizedSearch = search.trim().toLocaleLowerCase(locale)
    const builtIns = useMemo(() => (
        TERMINAL_SNIPPET_CATALOG.filter((item) => matchesSearch(
            [t(item.nameKey), item.command, t(item.descriptionKey)],
            normalizedSearch,
            locale,
        ))
    ), [locale, normalizedSearch, t])
    const customSnippets = useMemo(() => (
        snippets.filter((item) => matchesSearch(
            [item.name, item.command, item.description],
            normalizedSearch,
            locale,
        ))
    ), [locale, normalizedSearch, snippets])

    const selectTab = (tab: ActiveTab) => {
        setActiveTab(tab)
        setEditor(null)
        setEditorError(null)
        setInsertStatus('')
        if (tab === 'custom') setCustomEnabled(true)
    }

    const selectTabFromKeyboard = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentTab: ActiveTab,
    ) => {
        const currentIndex = TAB_ORDER.indexOf(currentTab)
        let nextTab: ActiveTab | null = null
        if (event.key === 'ArrowRight') {
            nextTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length]
        } else if (event.key === 'ArrowLeft') {
            nextTab = TAB_ORDER[
                (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
            ]
        } else if (event.key === 'Home') {
            nextTab = TAB_ORDER[0]
        } else if (event.key === 'End') {
            nextTab = TAB_ORDER[TAB_ORDER.length - 1]
        }
        if (!nextTab) return
        event.preventDefault()
        selectTab(nextTab)
        tabRefs.current[nextTab]?.focus()
    }

    const startCreate = () => {
        setActiveTab('custom')
        setCustomEnabled(true)
        setEditor(emptyEditor())
        setEditorError(null)
        setInsertStatus('')
    }

    const startEdit = (snippet: TerminalSnippet) => {
        setActiveTab('custom')
        setCustomEnabled(true)
        setEditor({
            mode: 'edit',
            id: snippet.id,
            name: snippet.name,
            command: snippet.command,
            description: snippet.description ?? '',
        })
        setEditorError(null)
        setInsertStatus('')
    }

    const insert = (command: string) => {
        if (props.disabled) return
        setInsertStatus('')
        if (!props.onInsert(command)) {
            setInsertStatus(t('terminal.snippets.insertFailed'))
            return
        }
        setInsertStatus(t('terminal.snippets.inserted'))
        props.onInserted?.()
        props.onClose()
    }

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!editor || !props.api || savingRef.current) return
        savingRef.current = true
        setEditorError(null)
        let createdSnippet: TerminalSnippet | null = null
        const input = {
            name: editor.name.trim(),
            command: editor.command,
            description: editor.description.trim() || null,
        }
        try {
            if (editor.mode === 'edit' && editor.id) {
                await updateSnippet(editor.id, input)
            } else {
                createdSnippet = await createSnippet(input)
            }
        } catch (saveError) {
            setEditorError(errorMessage(saveError, t('dialog.error.default')))
            return
        } finally {
            savingRef.current = false
        }
        setEditor(null)
        if (createdSnippet) {
            try {
                await ensureCreatedSnippetVisible(createdSnippet)
            } catch {
                // The query exposes refresh failures in the custom list.
            }
        }
    }

    const updateEditor = (
        field: 'name' | 'command' | 'description',
        value: string,
    ) => {
        setEditor((current) => current ? { ...current, [field]: value } : current)
    }

    return (
        <>
            <section
                role="region"
                aria-label={t('terminal.snippets.title')}
                className="flex max-h-[min(70vh,34rem)] min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-xl"
            >
                <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold">
                            {t('terminal.snippets.title')}
                        </h2>
                        <p className="truncate text-[11px] text-[var(--app-hint)]">
                            {t('terminal.snippets.insertOnly')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={startCreate}
                        className="min-h-11 min-w-11 rounded-lg px-3 text-xs font-semibold text-violet-600 transition-colors motion-reduce:transition-none hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300"
                    >
                        {t('terminal.snippets.new')}
                    </button>
                    <button
                        type="button"
                        aria-label={t('terminal.snippets.close')}
                        onClick={props.onClose}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-lg text-[var(--app-hint)] transition-colors motion-reduce:transition-none hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div className="shrink-0 space-y-2 border-b border-[var(--app-border)] p-3">
                    <label className="block">
                        <span className="sr-only">{t('terminal.snippets.search')}</span>
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            aria-label={t('terminal.snippets.search')}
                            placeholder={t('terminal.snippets.search')}
                            className="min-h-11 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)] focus-visible:ring-2 focus-visible:ring-violet-500"
                        />
                    </label>
                    <div
                        role="tablist"
                        aria-label={t('terminal.snippets.tabs')}
                        className="grid grid-cols-2 rounded-xl bg-[var(--app-secondary-bg)] p-1"
                    >
                        <TabButton
                            id={`${tabIdPrefix}-built-in-tab`}
                            controls={`${tabIdPrefix}-built-in-panel`}
                            active={activeTab === 'built-in'}
                            buttonRef={(node) => {
                                tabRefs.current['built-in'] = node
                            }}
                            onClick={() => selectTab('built-in')}
                            onKeyDown={(event) => {
                                selectTabFromKeyboard(event, 'built-in')
                            }}
                        >
                            {t('terminal.snippets.builtIn')}
                        </TabButton>
                        <TabButton
                            id={`${tabIdPrefix}-custom-tab`}
                            controls={`${tabIdPrefix}-custom-panel`}
                            active={activeTab === 'custom'}
                            buttonRef={(node) => {
                                tabRefs.current.custom = node
                            }}
                            onClick={() => selectTab('custom')}
                            onKeyDown={(event) => {
                                selectTabFromKeyboard(event, 'custom')
                            }}
                        >
                            {t('terminal.snippets.mySnippets')}
                        </TabButton>
                    </div>
                </div>

                <div
                    role="tabpanel"
                    id={`${tabIdPrefix}-built-in-panel`}
                    aria-labelledby={`${tabIdPrefix}-built-in-tab`}
                    hidden={activeTab !== 'built-in'}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
                >
                    <BuiltInList
                        items={builtIns}
                        disabled={props.disabled}
                        onInsert={insert}
                    />
                </div>
                <div
                    role="tabpanel"
                    id={`${tabIdPrefix}-custom-panel`}
                    aria-labelledby={`${tabIdPrefix}-custom-tab`}
                    hidden={activeTab !== 'custom'}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
                >
                    {editor ? (
                        <TerminalSnippetEditor
                            editor={editor}
                            error={editorError}
                            isPending={isPending}
                            apiAvailable={Boolean(props.api)}
                            onChange={updateEditor}
                            onBack={() => {
                                setEditor(null)
                                setEditorError(null)
                            }}
                            onSubmit={save}
                        />
                    ) : (
                        <CustomList
                            api={props.api}
                            snippets={customSnippets}
                            hasAnySnippets={snippets.length > 0}
                            isLoading={isLoading}
                            error={error}
                            disabled={props.disabled}
                            onRetry={() => void refetch()}
                            onInsert={insert}
                            onEdit={startEdit}
                            onDelete={setDeleteTarget}
                        />
                    )}
                </div>

                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className={`shrink-0 px-3 text-xs ${
                        insertStatus
                            ? 'border-t border-[var(--app-border)] py-2 text-red-600 dark:text-red-400'
                            : 'sr-only'
                    }`}
                >
                    {insertStatus}
                </div>
            </section>

            <ConfirmDialog
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title={t('terminal.snippets.deleteTitle')}
                description={t('terminal.snippets.deleteDescription', {
                    name: deleteTarget?.name ?? '',
                })}
                confirmLabel={t('terminal.snippets.delete')}
                confirmingLabel={t('terminal.snippets.deleting')}
                onConfirm={async () => {
                    if (!deleteTarget) return
                    await deleteSnippet(deleteTarget.id)
                }}
                isPending={isPending}
                destructive
            />
        </>
    )
}

function TabButton(props: {
    id: string
    controls: string
    active: boolean
    buttonRef: (node: HTMLButtonElement | null) => void
    onClick: () => void
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
    children: ReactNode
}) {
    return (
        <button
            type="button"
            role="tab"
            id={props.id}
            aria-controls={props.controls}
            aria-selected={props.active}
            tabIndex={props.active ? 0 : -1}
            ref={props.buttonRef}
            onClick={props.onClick}
            onKeyDown={props.onKeyDown}
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                props.active
                    ? 'bg-[var(--app-bg)] text-[var(--app-fg)] shadow-sm'
                    : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'
            }`}
        >
            {props.children}
        </button>
    )
}

function BuiltInList(props: {
    items: typeof TERMINAL_SNIPPET_CATALOG[number][]
    disabled: boolean
    onInsert: (command: string) => void
}) {
    const { t } = useTranslation()
    if (props.items.length === 0) {
        return <EmptyState>{t('terminal.snippets.noResults')}</EmptyState>
    }
    return (
        <div className="space-y-4">
            {GROUP_ORDER.map((group) => {
                const items = props.items.filter((item) => item.group === group)
                if (items.length === 0) return null
                return (
                    <section key={group} className="space-y-1.5">
                        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                            {t(GROUP_KEYS[group])}
                        </h3>
                        <div className="space-y-1">
                            {items.map((item) => (
                                <div
                                    key={item.id}
                                    data-snippet-row=""
                                    className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-2"
                                >
                                    <ActionIcon>&gt;_</ActionIcon>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                            {t(item.nameKey)}
                                        </p>
                                        <code
                                            data-testid="snippet-command"
                                            className="block truncate text-xs text-[var(--app-hint)]"
                                        >
                                            {item.command}
                                        </code>
                                        <p className="truncate text-[11px] text-[var(--app-hint)]">
                                            {t(item.descriptionKey)}
                                        </p>
                                    </div>
                                    <SnippetActionButton
                                        label={`${t('terminal.snippets.insert')} ${t(item.nameKey)}`}
                                        disabled={props.disabled}
                                        onClick={() => props.onInsert(item.command)}
                                    >
                                        {t('terminal.snippets.insert')}
                                    </SnippetActionButton>
                                </div>
                            ))}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}

function CustomList(props: {
    api: ApiClient | null
    snippets: TerminalSnippet[]
    hasAnySnippets: boolean
    isLoading: boolean
    error: string | null
    disabled: boolean
    onRetry: () => void
    onInsert: (command: string) => void
    onEdit: (snippet: TerminalSnippet) => void
    onDelete: (snippet: TerminalSnippet) => void
}) {
    const { t } = useTranslation()
    if (!props.api) {
        return <EmptyState>{t('terminal.snippets.unavailable')}</EmptyState>
    }
    if (props.isLoading && !props.hasAnySnippets) {
        return <EmptyState>{t('terminal.snippets.loading')}</EmptyState>
    }
    return (
        <div className="space-y-2">
            {props.error ? (
                <div
                    role="alert"
                    className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400"
                >
                    <span className="min-w-0 flex-1">{props.error}</span>
                    <SnippetActionButton
                        label={t('terminal.snippets.retry')}
                        onClick={props.onRetry}
                    >
                        {t('terminal.snippets.retry')}
                    </SnippetActionButton>
                </div>
            ) : null}
            {!props.error && props.snippets.length === 0 ? (
                <EmptyState>
                    {props.hasAnySnippets
                        ? t('terminal.snippets.noResults')
                        : t('terminal.snippets.empty')}
                </EmptyState>
            ) : props.snippets.map((snippet) => (
                <div
                    key={snippet.id}
                    data-snippet-row=""
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-2"
                >
                    <ActionIcon>$</ActionIcon>
                    <div className="min-w-0 flex-1">
                        <p
                            data-testid="custom-snippet-name"
                            className="truncate text-sm font-medium"
                        >
                            {snippet.name}
                        </p>
                        <code className="block truncate text-xs text-[var(--app-hint)]">
                            {snippet.command}
                        </code>
                        {snippet.description ? (
                            <p className="truncate text-[11px] text-[var(--app-hint)]">
                                {snippet.description}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center">
                        <SnippetActionButton
                            label={`${t('terminal.snippets.insert')} ${snippet.name}`}
                            disabled={props.disabled}
                            onClick={() => props.onInsert(snippet.command)}
                        >
                            {t('terminal.snippets.insert')}
                        </SnippetActionButton>
                        <SnippetActionButton
                            label={`${t('terminal.snippets.edit')} ${snippet.name}`}
                            onClick={() => props.onEdit(snippet)}
                        >
                            {t('terminal.snippets.edit')}
                        </SnippetActionButton>
                        <SnippetActionButton
                            label={`${t('terminal.snippets.delete')} ${snippet.name}`}
                            onClick={() => props.onDelete(snippet)}
                            destructive
                        >
                            {t('terminal.snippets.delete')}
                        </SnippetActionButton>
                    </div>
                </div>
            ))}
        </div>
    )
}

function EmptyState({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-xl border border-dashed border-[var(--app-border)] px-3 py-8 text-center text-sm text-[var(--app-hint)]">
            {children}
        </p>
    )
}
