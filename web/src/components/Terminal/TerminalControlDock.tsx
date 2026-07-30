import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ApiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'
import { useTranslation } from '@/lib/use-translation'
import {
    ADVANCED_KEY_GROUPS,
    type QuickInput,
} from './terminalControls'
import { TerminalKeyComposer } from './TerminalKeyComposer'
import { TerminalSearchPanel } from './TerminalSearchPanel'
import { TerminalHistoryPanel } from './TerminalHistoryPanel'
import { TerminalSnippetPanel } from './TerminalSnippetPanel'
import type { TerminalSearchState } from './terminalSearch'
import type { TerminalHistoryState } from './useTerminalHistory'

export type TerminalDockTool = 'snippets' | 'search' | 'history' | 'keys' | 'more'
export type TerminalDockAction = 'paste' | TerminalDockTool

export type TerminalControlDockProps = {
    api: ApiClient | null
    terminalContextKey: string | null
    disabled: boolean
    activeTool: TerminalDockTool | null
    onActiveToolChange: (tool: TerminalDockTool | null) => void
    searchMounted: boolean
    onSearchClose: () => void
    searchState: TerminalSearchState
    historyState: TerminalHistoryState
    onHistoryOpen: () => void
    onHistoryRefresh: () => void
    onHistoryClose: () => void
    onQuickInput: (sequence: string) => boolean
    onWritePlainInput: (text: string) => boolean
}

function toggleTool(
    current: TerminalDockTool | null,
    next: TerminalDockTool,
    onChange: (tool: TerminalDockTool | null) => void,
): void {
    onChange(current === next ? null : next)
}

export function TerminalToolIcon({ tool }: { tool: TerminalDockAction }) {
    const paths: Record<TerminalDockAction, React.ReactNode> = {
        paste: (
            <>
                <path d="M6.5 5.5h5a2 2 0 0 1 2 2v7h-9v-7a2 2 0 0 1 2-2Z" />
                <path d="M7 5V3.5h4V5M7 9h4M7 12h4" />
            </>
        ),
        snippets: (
            <>
                <path d="m6.5 5-3.5 4 3.5 4M11.5 5 15 9l-3.5 4" />
                <path d="m10 3-2 12" />
            </>
        ),
        search: (
            <>
                <circle cx="8" cy="8" r="4.5" />
                <path d="m11.5 11.5 3.5 3.5" />
            </>
        ),
        history: (
            <>
                <path d="M3.5 8.5a5.5 5.5 0 1 0 1.6-3.9L3.5 6" />
                <path d="M3.5 3v3h3M9 5.5V9l2.5 1.5" />
            </>
        ),
        keys: (
            <>
                <rect x="2.5" y="4.5" width="13" height="9" rx="1.5" />
                <path d="M5 7h.01M8 7h.01M11 7h.01M14 7h.01M5 10h.01M8 10h.01M11 10h3M5 12h6" />
            </>
        ),
        more: (
            <>
                <circle cx="4" cy="9" r=".75" fill="currentColor" stroke="none" />
                <circle cx="9" cy="9" r=".75" fill="currentColor" stroke="none" />
                <circle cx="14" cy="9" r=".75" fill="currentColor" stroke="none" />
            </>
        ),
    }

    return (
        <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[tool]}
        </svg>
    )
}

function DockButton(props: {
    tool: TerminalDockAction
    label: string
    active?: boolean
    disabled?: boolean
    onClick?: () => void
}) {
    return (
        <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.active ?? undefined}
            disabled={props.disabled}
            onClick={props.onClick}
            className={`flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10px] font-medium leading-tight transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-35 ${
                props.active
                    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
            }`}
        >
            <TerminalToolIcon tool={props.tool} />
            <span>{props.label}</span>
        </button>
    )
}

function HelperKeyButton(props: {
    input: QuickInput
    disabled: boolean
    onQuickInput: (sequence: string) => boolean
}) {
    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
    }

    const handleClick = () => {
        props.onQuickInput(props.input.sequence ?? '')
    }

    return (
        <button
            type="button"
            aria-label={props.input.description}
            disabled={props.disabled}
            onPointerDown={handlePointerDown}
            onClick={handleClick}
            className="min-h-12 min-w-12 rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {props.input.label}
        </button>
    )
}

function AdvancedKeyGroups(props: {
    disabled: boolean
    onQuickInput: (sequence: string) => boolean
}) {
    const { t } = useTranslation()
    const groupLabels = {
        Navigation: t('terminal.controls.navigation'),
        'Function keys': t('terminal.controls.functionKeys'),
        Symbols: t('terminal.controls.symbols'),
    }

    return (
        <div className="space-y-3">
            {ADVANCED_KEY_GROUPS.filter((group) => group.label in groupLabels).map((group) => (
                <section key={group.label} className="space-y-1.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                        {groupLabels[group.label as keyof typeof groupLabels]}
                    </h3>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                        {group.keys.map((input) => (
                            <HelperKeyButton
                                key={input.label}
                                input={input}
                                disabled={props.disabled}
                                onQuickInput={props.onQuickInput}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}

function ManualPasteDialog(props: {
    open: boolean
    text: string
    onTextChange: (text: string) => void
    onOpenChange: (open: boolean) => void
    onSubmit: () => void
}) {
    const { t } = useTranslation()

    return (
        <AppDialog open={props.open} onOpenChange={props.onOpenChange}>
            <AppDialogContent presentation="alert" className="max-w-md">
                <AppDialogHeader
                    title={t('terminal.paste.fallbackTitle')}
                    subtitle={t('terminal.paste.fallbackDescription')}
                />
                <AppDialogBody className="p-4">
                    <textarea
                        value={props.text}
                        onChange={(event) => props.onTextChange(event.target.value)}
                        placeholder={t('terminal.paste.placeholder')}
                        className="min-h-32 w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        autoCapitalize="none"
                        autoCorrect="off"
                    />
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" onClick={props.onSubmit} disabled={!props.text.trim()}>
                        {t('button.paste')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}

export function TerminalControlDock(props: TerminalControlDockProps) {
    const { t } = useTranslation()
    const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
    const [manualPasteText, setManualPasteText] = useState('')
    const [pasteFeedback, setPasteFeedback] = useState(false)
    const [snippetAnnouncement, setSnippetAnnouncement] = useState(0)
    const [historyAnnouncement, setHistoryAnnouncement] = useState(0)
    const [keysMounted, setKeysMounted] = useState(props.activeTool === 'keys')
    const pasteFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const snippetFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const historyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const historyLifecycleRef = useRef<{ active: boolean; terminalContextKey: string | null }>({
        active: false,
        terminalContextKey: props.terminalContextKey,
    })

    useEffect(() => () => {
        if (pasteFeedbackTimer.current) {
            clearTimeout(pasteFeedbackTimer.current)
        }
    }, [])

    useEffect(() => {
        if (props.activeTool === 'keys') {
            setKeysMounted(true)
        }
    }, [props.activeTool])

    useEffect(() => {
        setSnippetAnnouncement(0)
        setHistoryAnnouncement(0)
        if (snippetFeedbackTimer.current) {
            clearTimeout(snippetFeedbackTimer.current)
            snippetFeedbackTimer.current = null
        }
        return () => {
            if (snippetFeedbackTimer.current) {
                clearTimeout(snippetFeedbackTimer.current)
                snippetFeedbackTimer.current = null
            }
            if (historyFeedbackTimer.current) {
                clearTimeout(historyFeedbackTimer.current)
                historyFeedbackTimer.current = null
            }
        }
    }, [props.terminalContextKey])

    useEffect(() => {
        const previous = historyLifecycleRef.current
        const active = props.activeTool === 'history'
        const terminalChanged = previous.terminalContextKey !== props.terminalContextKey
        if (active && (!previous.active || terminalChanged)) {
            props.onHistoryOpen()
        } else if (!active && previous.active) {
            props.onHistoryClose()
        }
        historyLifecycleRef.current = {
            active,
            terminalContextKey: props.terminalContextKey,
        }
    }, [
        props.activeTool,
        props.onHistoryClose,
        props.onHistoryOpen,
        props.terminalContextKey,
    ])

    const announcePaste = useCallback(() => {
        if (pasteFeedbackTimer.current) {
            clearTimeout(pasteFeedbackTimer.current)
        }
        setPasteFeedback(true)
        pasteFeedbackTimer.current = setTimeout(() => {
            setPasteFeedback(false)
            pasteFeedbackTimer.current = null
        }, 1200)
    }, [])

    const handlePasteAction = useCallback(async () => {
        if (props.disabled) {
            return
        }
        const readClipboard = navigator.clipboard?.readText
        if (readClipboard) {
            try {
                const clipboardText = await readClipboard.call(navigator.clipboard)
                if (!clipboardText) {
                    return
                }
                if (props.onWritePlainInput(clipboardText)) {
                    announcePaste()
                    return
                }
            } catch {
                // Fall through to manual paste.
            }
        }
        setManualPasteText('')
        setPasteDialogOpen(true)
    }, [announcePaste, props])

    const handleManualPasteSubmit = useCallback(() => {
        if (!manualPasteText.trim()) {
            return
        }
        if (props.onWritePlainInput(manualPasteText)) {
            setPasteDialogOpen(false)
            setManualPasteText('')
            announcePaste()
        }
    }, [announcePaste, manualPasteText, props])

    const handlePasteDialogOpenChange = useCallback((open: boolean) => {
        setPasteDialogOpen(open)
        if (!open) {
            setManualPasteText('')
        }
    }, [])

    const announceSnippetInsert = useCallback(() => {
        if (snippetFeedbackTimer.current) {
            clearTimeout(snippetFeedbackTimer.current)
        }
        setSnippetAnnouncement((current) => current + 1)
        snippetFeedbackTimer.current = setTimeout(() => {
            setSnippetAnnouncement(0)
            snippetFeedbackTimer.current = null
        }, 1200)
    }, [])

    const announceHistoryInsert = useCallback(() => {
        if (historyFeedbackTimer.current) {
            clearTimeout(historyFeedbackTimer.current)
        }
        setHistoryAnnouncement((current) => current + 1)
        historyFeedbackTimer.current = setTimeout(() => {
            setHistoryAnnouncement(0)
            historyFeedbackTimer.current = null
        }, 1200)
    }, [])

    return (
        <div className="relative z-30 shrink-0 lg:pointer-events-none lg:absolute lg:inset-0">
            {props.activeTool === 'snippets' ? (
                <section
                    role="region"
                    aria-label={`${t('terminal.controls.snippets')} · ${t('terminal.snippets.insertOnly')}`}
                    className="pointer-events-auto absolute bottom-full left-2 right-2 mb-2 lg:bottom-auto lg:left-auto lg:right-2 lg:top-10 lg:mb-0 lg:w-[480px] lg:max-w-[calc(100%-1rem)]"
                >
                    <TerminalSnippetPanel
                        api={props.api}
                        disabled={props.disabled}
                        onInsert={props.onWritePlainInput}
                        onInserted={announceSnippetInsert}
                        onClose={() => props.onActiveToolChange(null)}
                    />
                </section>
            ) : null}

            {props.searchMounted ? (
                <section
                    hidden={props.activeTool !== 'search'}
                    role="region"
                    aria-label={t('terminal.controls.search')}
                    className="pointer-events-auto absolute bottom-full left-2 right-2 mb-2 lg:bottom-auto lg:left-auto lg:right-2 lg:top-10 lg:mb-0 lg:w-[520px] lg:max-w-[calc(100%-1rem)]"
                >
                    <TerminalSearchPanel
                        state={props.searchState}
                        onClose={props.onSearchClose}
                    />
                </section>
            ) : null}

            {props.activeTool === 'history' ? (
                <section
                    role="region"
                    aria-label={`${t('terminal.controls.history')} · ${t('terminal.history.insertOnly')}`}
                    className="pointer-events-auto absolute bottom-full left-2 right-2 mb-2 lg:bottom-auto lg:left-auto lg:right-2 lg:top-10 lg:mb-0 lg:w-[480px] lg:max-w-[calc(100%-1rem)]"
                >
                    <TerminalHistoryPanel
                        state={props.historyState}
                        disabled={props.disabled}
                        onRefresh={props.onHistoryRefresh}
                        onInsert={props.onWritePlainInput}
                        onInserted={announceHistoryInsert}
                        onClose={() => props.onActiveToolChange(null)}
                    />
                </section>
            ) : null}

            {keysMounted ? (
                <section
                    hidden={props.activeTool !== 'keys'}
                    role="region"
                    aria-label={t('terminal.controls.keysPanel')}
                    className="absolute bottom-full left-2 right-2 mb-2 transition-[opacity,transform] duration-150 motion-reduce:transition-none lg:hidden"
                >
                    <TerminalKeyComposer
                        terminalContextKey={props.terminalContextKey}
                        disabled={props.disabled}
                        visible={props.activeTool === 'keys'}
                        onSend={props.onQuickInput}
                    />
                </section>
            ) : null}

            {props.activeTool === 'more' ? (
                <section
                    role="region"
                    aria-label={t('terminal.controls.morePanel')}
                    className="absolute bottom-full left-2 right-2 mb-2 max-h-[48vh] overflow-y-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-3 shadow-xl backdrop-blur transition-[opacity,transform] duration-150 motion-reduce:transition-none lg:hidden"
                >
                    <AdvancedKeyGroups
                        disabled={props.disabled}
                        onQuickInput={props.onQuickInput}
                    />
                </section>
            ) : null}

            <div
                role="toolbar"
                aria-label={t('terminal.controls.toolbar')}
                className="grid min-h-[calc(56px+env(safe-area-inset-bottom))] grid-cols-6 border-t border-[var(--app-border)] bg-[var(--app-bg)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
            >
                <DockButton
                    tool="paste"
                    label={t('terminal.controls.paste')}
                    disabled={props.disabled}
                    onClick={() => void handlePasteAction()}
                />
                <DockButton
                    tool="snippets"
                    label={t('terminal.controls.snippets')}
                    active={props.activeTool === 'snippets'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(
                        props.activeTool,
                        'snippets',
                        props.onActiveToolChange,
                    )}
                />
                <DockButton
                    tool="search"
                    label={t('terminal.controls.search')}
                    active={props.activeTool === 'search'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(
                        props.activeTool,
                        'search',
                        props.onActiveToolChange,
                    )}
                />
                <DockButton
                    tool="history"
                    label={t('terminal.controls.history')}
                    active={props.activeTool === 'history'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(
                        props.activeTool,
                        'history',
                        props.onActiveToolChange,
                    )}
                />
                <DockButton
                    tool="keys"
                    label={t('terminal.controls.keys')}
                    active={props.activeTool === 'keys'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(props.activeTool, 'keys', props.onActiveToolChange)}
                />
                <DockButton
                    tool="more"
                    label={t('terminal.controls.more')}
                    active={props.activeTool === 'more'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(props.activeTool, 'more', props.onActiveToolChange)}
                />
            </div>

            <ManualPasteDialog
                open={pasteDialogOpen}
                text={manualPasteText}
                onTextChange={setManualPasteText}
                onOpenChange={handlePasteDialogOpenChange}
                onSubmit={handleManualPasteSubmit}
            />
            {pasteFeedback ? (
                <span role="status" className="sr-only">
                    {t('terminal.controls.pasted')}
                </span>
            ) : null}
            {snippetAnnouncement > 0 ? (
                <span key={snippetAnnouncement} role="status" className="sr-only">
                    {t('terminal.snippets.inserted')}
                </span>
            ) : null}
            {historyAnnouncement > 0 ? (
                <span key={historyAnnouncement} role="status" className="sr-only">
                    {t('terminal.history.inserted')}
                </span>
            ) : null}
        </div>
    )
}
