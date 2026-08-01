import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalState } from '@hapi/protocol'
import {
    TerminalControlDock,
    TerminalToolIcon,
    type TerminalDockTool,
} from '@/components/Terminal/TerminalControlDock'
import { TerminalView } from '@/components/Terminal/TerminalView'
import { useTerminalQuickInput } from '@/components/Terminal/terminalControls'
import {
    EMPTY_TERMINAL_SEARCH_STATE,
    type TerminalSearchState,
} from '@/components/Terminal/terminalSearch'
import { useTerminalHistory } from '@/components/Terminal/useTerminalHistory'
import {
    AppDialog,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'
import { useSessionTerminalSocket } from '@/hooks/useTerminalSocket'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { randomId } from '@/lib/randomId'

export type SessionTerminalTabsProps = {
    sessionId: string
    active: boolean
    terminalSupported: boolean
    interactionActive?: boolean
    cwd?: string
    compactFontSize?: boolean
    className?: string
}

const LIVE_STATUSES = new Set<TerminalState['status']>(['running', 'detached', 'warning_idle', 'warning_age'])
const UI_BUFFER_LIMIT = 50_000

function isLiveTerminal(terminal: TerminalState): boolean {
    return LIVE_STATUSES.has(terminal.status)
}

function isVisibleTerminalTab(terminal: TerminalState): boolean {
    return terminal.status !== 'closed_user' && terminal.closeReason !== 'user_close'
}

function warningReason(terminal: TerminalState): 'idle' | 'age' | null {
    if (terminal.status === 'warning_idle') return 'idle'
    if (terminal.status === 'warning_age') return 'age'
    return null
}

function closeReasonCopy(terminal: TerminalState, t: (key: string) => string): string {
    switch (terminal.closeReason) {
        case 'idle_timeout':
            return t('terminal.closed.idle')
        case 'hard_timeout':
            return t('terminal.closed.age')
        case 'user_close':
            return t('terminal.closed.user')
        case 'archive':
            return t('terminal.closed.archive')
        case 'process_exit':
            return t('terminal.closed.exited')
        case 'cli_lost':
            return t('terminal.closed.lost')
        case 'spawn_error':
            return t('terminal.closed.spawn')
        default:
            break
    }
    switch (terminal.status) {
        case 'closed_idle':
            return t('terminal.closed.idle')
        case 'closed_age':
            return t('terminal.closed.age')
        case 'closed_user':
            return t('terminal.closed.user')
        case 'closed_archive':
            return t('terminal.closed.archive')
        case 'exited':
            return t('terminal.closed.exited')
        case 'lost':
            return t('terminal.closed.lost')
        default:
            return t('terminal.closed.generic')
    }
}

function appendBounded(current: string, next: string): string {
    const combined = `${current}${next}`
    if (combined.length <= UI_BUFFER_LIMIT) {
        return combined
    }
    return combined.slice(-UI_BUFFER_LIMIT)
}

function isDesktopTerminalViewport(): boolean {
    return typeof window.matchMedia !== 'function'
        || window.matchMedia('(min-width: 1024px)').matches
}

export function SessionTerminalTabs(props: SessionTerminalTabsProps) {
    const { baseUrl, api } = useAppContext()
    const { t } = useTranslation()
    const controller = useSessionTerminalSocket({ baseUrl, sessionId: props.sessionId })
    const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
    const [activeDockTool, setActiveDockTool] = useState<TerminalDockTool | null>(null)
    const [searchMounted, setSearchMounted] = useState(false)
    const [searchState, setSearchState] = useState<TerminalSearchState>(
        EMPTY_TERMINAL_SEARCH_STATE,
    )
    const [pendingCloseTerminalId, setPendingCloseTerminalId] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)
    const [createPending, setCreatePending] = useState(false)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const bootstrapRequestedRef = useRef(false)
    const pendingCreateTerminalIdRef = useRef<string | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const inputDisposableRef = useRef<{ dispose: () => void } | null>(null)
    const buffersRef = useRef<Map<string, string>>(new Map())
    const attachedTerminalIdsRef = useRef<Set<string>>(new Set())
    const reconnectAttachPendingRef = useRef(false)

    const visibleTerminals = useMemo(
        () => controller.terminals.filter(isVisibleTerminalTab),
        [controller.terminals]
    )
    const liveTerminals = useMemo(() => visibleTerminals.filter(isLiveTerminal), [visibleTerminals])
    const liveCount = liveTerminals.length
    const selectedTerminal = useMemo(
        () => visibleTerminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? null,
        [activeTerminalId, visibleTerminals]
    )
    const displayTerminal = selectedTerminal ?? liveTerminals[0] ?? visibleTerminals[0] ?? null
    const activeLiveTerminal = displayTerminal && isLiveTerminal(displayTerminal) ? displayTerminal : null
    const selectedIsLive = Boolean(activeLiveTerminal)
    const activeWarning = activeLiveTerminal ? warningReason(activeLiveTerminal) : null
    const canUseTerminal = props.active && props.terminalSupported
    const interactionActive = props.interactionActive ?? true
    const terminalSocketConnected = controller.state.status === 'connected'
    const quickInputDisabled = !canUseTerminal || !selectedIsLive || controller.state.status !== 'connected'
    const dockDisabled = quickInputDisabled || !interactionActive
    const historyTerminalId = dockDisabled
        ? null
        : (activeLiveTerminal?.terminalId ?? null)
    const requestHistory = useCallback((requestId: string, limit: number) => {
        if (!historyTerminalId) {
            return false
        }
        return controller.requestHistory(historyTerminalId, requestId, limit)
    }, [controller.requestHistory, historyTerminalId])
    const history = useTerminalHistory({
        terminalContextKey: historyTerminalId
            ? `${props.sessionId}:${historyTerminalId}`
            : null,
        terminalId: historyTerminalId,
        request: requestHistory,
        subscribe: controller.onHistory,
    })
    const quickInput = useTerminalQuickInput({
        disabled: quickInputDisabled,
        write: (data) => {
            const terminalId = activeLiveTerminal?.terminalId
            if (terminalId) {
                return controller.write(terminalId, data)
            }
            return false
        }
    })
    const searchStateRef = useRef<TerminalSearchState>(EMPTY_TERMINAL_SEARCH_STATE)
    const searchGenerationRef = useRef(0)
    const searchIdentity = dockDisabled
        ? null
        : (activeLiveTerminal?.terminalId ?? null)
    const activeSearchIdentityRef = useRef(searchIdentity)
    activeSearchIdentityRef.current = searchIdentity
    const terminalDataHandlerRef = useRef(quickInput.writeTerminalData)
    terminalDataHandlerRef.current = quickInput.writeTerminalData

    const clearSearch = useCallback((closeTool = true) => {
        searchGenerationRef.current += 1
        searchStateRef.current.controller?.clear()
        searchStateRef.current = EMPTY_TERMINAL_SEARCH_STATE
        setSearchState(EMPTY_TERMINAL_SEARCH_STATE)
        setSearchMounted(false)
        if (closeTool) {
            setActiveDockTool(null)
        }
    }, [])

    useEffect(() => {
        clearSearch()
    }, [clearSearch, searchIdentity])

    const dismissDockTool = useCallback(() => {
        if (activeDockTool !== 'search') {
            setActiveDockTool(null)
        }
    }, [activeDockTool])

    const handleActiveDockToolChange = useCallback((tool: TerminalDockTool | null) => {
        if (tool === 'search') {
            setSearchMounted(true)
        }
        setActiveDockTool(tool)
    }, [])

    useEffect(() => {
        if (!canUseTerminal || !interactionActive) return
        const handleKeyDown = (event: KeyboardEvent) => {
            const editable = event.target instanceof HTMLElement
                && (
                    event.target.isContentEditable
                    || event.target.matches('input, textarea, select')
                )
            if (
                isDesktopTerminalViewport()
                && !editable
                && (event.ctrlKey || event.metaKey)
                && event.key.toLowerCase() === 'f'
            ) {
                event.preventDefault()
                if (activeDockTool !== 'search') {
                    handleActiveDockToolChange('search')
                }
                return
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [
        activeDockTool,
        canUseTerminal,
        handleActiveDockToolChange,
        interactionActive,
    ])

    const searchEnabled = searchMounted && searchIdentity !== null
    const searchCallbackIdentity = searchIdentity
    const searchCallbackGeneration = searchGenerationRef.current
    const handleSearchStateChange = useCallback((nextState: TerminalSearchState) => {
        if (
            !searchEnabled
            || !searchCallbackIdentity
            || activeSearchIdentityRef.current !== searchCallbackIdentity
            || searchGenerationRef.current !== searchCallbackGeneration
        ) {
            nextState.controller?.clear()
            return
        }
        const previousController = searchStateRef.current.controller
        if (previousController && previousController !== nextState.controller) {
            previousController.clear()
        }
        searchStateRef.current = nextState
        setSearchState(nextState)
    }, [searchCallbackGeneration, searchCallbackIdentity, searchEnabled])

    useEffect(() => () => {
        searchGenerationRef.current += 1
        searchStateRef.current.controller?.clear()
        searchStateRef.current = EMPTY_TERMINAL_SEARCH_STATE
    }, [])

    useEffect(() => {
        if (!props.active || !props.terminalSupported) {
            controller.disconnect()
            return
        }
        controller.connect()
        return () => {
            inputDisposableRef.current?.dispose()
            inputDisposableRef.current = null
            terminalRef.current = null
            controller.disconnect()
        }
    }, [controller.connect, controller.disconnect, props.active, props.terminalSupported, props.sessionId])

    useEffect(() => {
        controller.onOutput((terminalId, data) => {
            buffersRef.current.set(terminalId, appendBounded(buffersRef.current.get(terminalId) ?? '', data))
            if (terminalId === activeTerminalId) {
                terminalRef.current?.write(data)
            }
        })
    }, [activeTerminalId, controller.onOutput])

    useEffect(() => {
        controller.onExit((terminalId, code) => {
            const message = `\r\n[process exited${code !== null ? ` with code ${code}` : ''}]`
            buffersRef.current.set(terminalId, appendBounded(buffersRef.current.get(terminalId) ?? '', message))
            if (terminalId === activeTerminalId) {
                terminalRef.current?.write(message)
            }
        })
    }, [activeTerminalId, controller.onExit])

    useEffect(() => {
        bootstrapRequestedRef.current = false
        pendingCreateTerminalIdRef.current = null
        attachedTerminalIdsRef.current.clear()
        buffersRef.current.clear()
        setCreatePending(false)
        setActiveTerminalId(null)
        setCreateError(null)
        controller.clearLastError()
    }, [controller.clearLastError, props.sessionId])

    useEffect(() => {
        const pendingTerminalId = pendingCreateTerminalIdRef.current
        const pendingTerminalListed = pendingTerminalId
            ? controller.terminals.some((terminal) => terminal.terminalId === pendingTerminalId)
            : false
        if (pendingTerminalListed) {
            pendingCreateTerminalIdRef.current = null
            bootstrapRequestedRef.current = false
            setCreatePending(false)
        } else if (!pendingTerminalId && controller.terminals.length > 0) {
            bootstrapRequestedRef.current = false
            setCreatePending(false)
        }
        setActiveTerminalId((activeId) => {
            const current = activeId
                ? visibleTerminals.find((terminal) => terminal.terminalId === activeId) ?? null
                : null
            if (current) {
                return current.terminalId
            }
            if (activeId && activeId === pendingCreateTerminalIdRef.current) {
                return activeId
            }
            return liveTerminals[0]?.terminalId ?? visibleTerminals[0]?.terminalId ?? null
        })
    }, [controller.terminals, liveTerminals, visibleTerminals])

    useEffect(() => {
        if (controller.lastError) {
            const pendingTerminalId = pendingCreateTerminalIdRef.current
            pendingCreateTerminalIdRef.current = null
            setCreatePending(false)
            if (pendingTerminalId) {
                setActiveTerminalId((activeId) => (
                    activeId === pendingTerminalId
                        ? (liveTerminals[0]?.terminalId ?? visibleTerminals[0]?.terminalId ?? null)
                        : activeId
                ))
            }
        }
    }, [controller.lastError, liveTerminals, visibleTerminals])

    const createTerminal = useCallback((replay = true, sizeFallback?: { cols: number; rows: number }) => {
        if (!canUseTerminal || !terminalSocketConnected) {
            return
        }
        if (createPending) {
            return
        }
        if (liveCount >= 3) {
            setCreateError(t('terminal.limit.full'))
            return
        }
        const size = lastSizeRef.current ?? sizeFallback
        if (!size) {
            setCreateError('Waiting for terminal size before creating a terminal.')
            return
        }
        const terminalId = randomId()
        setCreateError(null)
        controller.clearLastError()
        const accepted = controller.create({ terminalId, cols: size.cols, rows: size.rows, cwd: props.cwd, replay })
        if (!accepted) {
            return
        }
        pendingCreateTerminalIdRef.current = terminalId
        attachedTerminalIdsRef.current.add(terminalId)
        setCreatePending(true)
        setActiveTerminalId(terminalId)
        controller.subscribe()
    }, [canUseTerminal, controller.clearLastError, controller.create, controller.subscribe, createPending, liveCount, props.cwd, t, terminalSocketConnected])

    const bootstrapTerminal = useCallback((size: { cols: number; rows: number }) => {
        if (
            !canUseTerminal
            || !terminalSocketConnected
            || !controller.listLoaded
            || controller.terminals.length > 0
            || bootstrapRequestedRef.current
        ) {
            return
        }
        const terminalId = randomId()
        controller.clearLastError()
        const accepted = controller.create({
            terminalId,
            cols: size.cols,
            rows: size.rows,
            cwd: props.cwd,
            replay: true
        })
        if (!accepted) {
            return
        }
        bootstrapRequestedRef.current = true
        pendingCreateTerminalIdRef.current = terminalId
        attachedTerminalIdsRef.current.add(terminalId)
        setCreatePending(true)
        setActiveTerminalId(terminalId)
    }, [
        canUseTerminal,
        controller.clearLastError,
        controller.create,
        controller.listLoaded,
        controller.terminals.length,
        props.cwd,
        terminalSocketConnected
    ])

    useEffect(() => {
        const size = lastSizeRef.current
        if (size) {
            bootstrapTerminal(size)
        }
    }, [bootstrapTerminal])

    const handleResize = useCallback((cols: number, rows: number) => {
        const size = { cols, rows }
        lastSizeRef.current = size
        if (!terminalSocketConnected) {
            return
        }
        if (activeLiveTerminal) {
            if (!attachedTerminalIdsRef.current.has(activeLiveTerminal.terminalId)) {
                const accepted = controller.create({ terminalId: activeLiveTerminal.terminalId, cols, rows, cwd: props.cwd, replay: true })
                if (accepted) {
                    attachedTerminalIdsRef.current.add(activeLiveTerminal.terminalId)
                }
                return
            }
            controller.resize(activeLiveTerminal.terminalId, cols, rows)
            return
        }
        bootstrapTerminal(size)
    }, [activeLiveTerminal, bootstrapTerminal, controller.create, controller.resize, props.cwd, terminalSocketConnected])

    useEffect(() => {
        if (!terminalSocketConnected) {
            attachedTerminalIdsRef.current.clear()
            reconnectAttachPendingRef.current = true
            return
        }
        const size = lastSizeRef.current
        if (
            !reconnectAttachPendingRef.current
            || !size
            || !activeLiveTerminal
            || attachedTerminalIdsRef.current.has(activeLiveTerminal.terminalId)
        ) {
            return
        }
        const accepted = controller.create({
            terminalId: activeLiveTerminal.terminalId,
            cols: size.cols,
            rows: size.rows,
            cwd: props.cwd,
            replay: true,
        })
        if (accepted) {
            attachedTerminalIdsRef.current.add(activeLiveTerminal.terminalId)
            reconnectAttachPendingRef.current = false
        }
    }, [activeLiveTerminal, controller.create, props.cwd, terminalSocketConnected])

    const handleTerminalMount = useCallback((terminal: Terminal) => {
        terminalRef.current = terminal
        inputDisposableRef.current?.dispose()
        inputDisposableRef.current = terminal.onData((data) => terminalDataHandlerRef.current(data))
        if (activeTerminalId) {
            const buffered = buffersRef.current.get(activeTerminalId)
            if (buffered) {
                terminal.write(buffered)
            }
        }
        terminal.focus()
    }, [activeTerminalId])

    const closeTarget = pendingCloseTerminalId
        ? controller.terminals.find((terminal) => terminal.terminalId === pendingCloseTerminalId)
        : null

    const statusColor = controller.state.status === 'connected'
        ? 'bg-emerald-500'
        : controller.state.status === 'connecting'
            ? 'bg-amber-500'
            : controller.state.status === 'error'
                ? 'bg-red-500'
                : 'bg-[var(--app-hint)]'
    const statusSummary = (
        <div
            data-testid="terminal-connection-status"
            className="flex shrink-0 items-center gap-2 border-l border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1"
        >
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
            <span className="text-[10px] text-[var(--app-hint)]">{controller.state.status}</span>
            <span className="rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">{liveCount}/3</span>
        </div>
    )
    const hasStatusMessage = Boolean(
        createError
        || controller.lastError
        || (controller.terminals.length === 0 && controller.recoveryReason === 'cli_lost')
        || !props.terminalSupported
        || !props.active
    )

    return (
        <div className={`relative flex h-full min-h-0 flex-col bg-[var(--app-bg)] ${props.className ?? ''}`}>
            <div
                data-testid="terminal-tabs-status-row"
                className="flex shrink-0 items-stretch overflow-hidden border-b border-[var(--app-border)]"
            >
                <div
                    role="group"
                    aria-label="Terminal tabs"
                    className="flex min-w-0 flex-1 items-center overflow-x-auto"
                >
                    {visibleTerminals.map((terminal) => {
                        const isSelected = terminal.terminalId === activeTerminalId
                        const warning = warningReason(terminal)
                        return (
                            <div key={terminal.terminalId} className={`flex items-center gap-1 border-l border-[var(--app-border)] px-2 py-1 text-xs ${isSelected ? 'bg-[var(--app-bg)] text-[#818cf8]' : 'text-[var(--app-hint)]'}`}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (terminal.terminalId !== activeTerminalId) {
                                            clearSearch()
                                        }
                                        setActiveTerminalId(terminal.terminalId)
                                    }}
                                    className="max-w-[140px] truncate hover:text-[var(--app-fg)]"
                                >
                                    {terminal.label}
                                </button>
                                {warning ? (
                                    <span aria-label={t(warning === 'idle' ? 'terminal.warning.badge.idle' : 'terminal.warning.badge.age')} className="text-[10px] text-amber-500">⚠</span>
                                ) : null}
                                {isLiveTerminal(terminal) ? (
                                    <button
                                        type="button"
                                        aria-label={`Close terminal ${terminal.terminalId}`}
                                        className="text-[10px] hover:text-red-500"
                                        onClick={() => setPendingCloseTerminalId(terminal.terminalId)}
                                    >
                                        ✕
                                    </button>
                                ) : null}
                            </div>
                        )
                    })}
                    <button
                        type="button"
                        aria-label={t('terminal.new')}
                        disabled={!canUseTerminal || !terminalSocketConnected || liveCount >= 3 || createPending}
                        onClick={() => createTerminal(true)}
                        className="shrink-0 border-l border-[var(--app-border)] px-3 py-1 text-sm text-[var(--app-hint)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                        title={liveCount >= 3 ? t('terminal.limit.full') : t('terminal.new')}
                    >
                        +
                    </button>
                </div>
                <button
                    type="button"
                    aria-label={t('terminal.search.title')}
                    aria-pressed={activeDockTool === 'search'}
                    disabled={dockDisabled}
                    onClick={() => handleActiveDockToolChange(
                        activeDockTool === 'search' ? null : 'search',
                    )}
                    title={t('terminal.controls.search')}
                    className={`hidden min-h-8 min-w-8 place-items-center border-l border-[var(--app-border)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:grid ${
                        activeDockTool === 'search'
                            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    }`}
                >
                    <TerminalToolIcon tool="search" />
                </button>
                <button
                    type="button"
                    aria-label={t('terminal.snippets.title')}
                    aria-pressed={activeDockTool === 'snippets'}
                    disabled={dockDisabled}
                    onClick={() => handleActiveDockToolChange(
                        activeDockTool === 'snippets' ? null : 'snippets',
                    )}
                    title={t('terminal.controls.snippets')}
                    className={`hidden min-h-8 min-w-8 place-items-center border-l border-[var(--app-border)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:grid ${
                        activeDockTool === 'snippets'
                            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    }`}
                >
                    <TerminalToolIcon tool="snippets" />
                </button>
                <button
                    type="button"
                    aria-label={t('terminal.controls.history')}
                    aria-pressed={activeDockTool === 'history'}
                    disabled={dockDisabled}
                    onClick={() => handleActiveDockToolChange(
                        activeDockTool === 'history' ? null : 'history',
                    )}
                    title={t('terminal.controls.history')}
                    className={`hidden min-h-8 min-w-8 place-items-center border-l border-[var(--app-border)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:grid ${
                        activeDockTool === 'history'
                            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    }`}
                >
                    <TerminalToolIcon tool="history" />
                </button>
                {statusSummary}
            </div>

            {hasStatusMessage ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1">
                    {createError ? <span className="truncate text-[10px] text-red-500">{createError}</span> : null}
                    {controller.lastError ? <span className="truncate text-[10px] text-red-500">{controller.lastError}</span> : null}
                    {controller.terminals.length === 0 && controller.recoveryReason === 'cli_lost' ? (
                        <span className="truncate text-[10px] text-amber-500">{t('terminal.recovery.cliLost')}</span>
                    ) : null}
                    {!props.terminalSupported ? <span className="text-[10px] text-red-500">{t('terminal.unsupported')}</span> : null}
                    {!props.active ? <span className="text-[10px] text-[var(--app-hint)]">{t('terminal.inactive')}</span> : null}
                </div>
            ) : null}

            <div
                data-testid="terminal-surface"
                onPointerDownCapture={dismissDockTool}
                className="min-h-0 flex-1 overflow-hidden p-2"
            >
                {activeWarning ? (
                    <div role="status" className="mb-2 flex items-center justify-between gap-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                        <span>{t(activeWarning === 'idle' ? 'terminal.warning.idle' : 'terminal.warning.age')}</span>
                        {activeWarning === 'idle' && activeLiveTerminal ? (
                            <button
                                type="button"
                                onClick={() => controller.keepalive(activeLiveTerminal.terminalId)}
                                className="shrink-0 rounded border border-amber-500/40 px-2 py-1 text-xs font-medium text-[var(--app-fg)]"
                            >
                                {t('terminal.keep')}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {liveCount === 0 && visibleTerminals.length > 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto rounded border border-[var(--app-border)] p-4 text-center text-sm text-[var(--app-hint)]">
                        {visibleTerminals.map((terminal) => (
                            <div key={terminal.terminalId} className="flex flex-col items-center gap-2">
                                <div>{closeReasonCopy(terminal, t)}</div>
                                <button
                                    type="button"
                                    disabled={!canUseTerminal}
                                    onClick={() => createTerminal(true, { cols: terminal.cols, rows: terminal.rows })}
                                    className="rounded border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)] disabled:opacity-50"
                                >
                                    {t('terminal.createNew')}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : displayTerminal && !selectedIsLive ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 rounded border border-[var(--app-border)] p-4 text-center text-sm text-[var(--app-hint)]">
                        <div>{closeReasonCopy(displayTerminal, t)}</div>
                        <button
                            type="button"
                            disabled={!canUseTerminal}
                            onClick={() => createTerminal(true, { cols: displayTerminal.cols, rows: displayTerminal.rows })}
                            className="rounded border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)] disabled:opacity-50"
                        >
                            {t('terminal.createNew')}
                        </button>
                    </div>
                ) : props.terminalSupported ? (
                    <TerminalView
                        key={activeTerminalId ?? 'bootstrap'}
                        onMount={handleTerminalMount}
                        onResize={handleResize}
                        compactFontSize={props.compactFontSize}
                        mobileInteractionEnabled={!dockDisabled}
                        dismissMobileInteraction={
                            activeDockTool !== null || !interactionActive
                        }
                        searchActive={searchEnabled}
                        onSearchStateChange={handleSearchStateChange}
                        className={controller.terminals.length === 0 ? 'opacity-0' : 'h-full w-full'}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center rounded border border-[var(--app-border)] text-sm text-[var(--app-hint)]">
                        {t('terminal.unsupported')}
                    </div>
                )}
            </div>

            <TerminalControlDock
                api={api}
                terminalContextKey={
                    dockDisabled ? null : (activeLiveTerminal?.terminalId ?? null)
                }
                disabled={dockDisabled}
                activeTool={activeDockTool}
                onActiveToolChange={handleActiveDockToolChange}
                searchMounted={searchMounted}
                onSearchClose={() => clearSearch()}
                searchState={searchState}
                historyState={history.state}
                onHistoryOpen={history.open}
                onHistoryRefresh={history.refresh}
                onHistoryClose={history.close}
                onQuickInput={quickInput.sendQuickInput}
                onWritePlainInput={quickInput.writePlainInput}
            />

            <AppDialog open={pendingCloseTerminalId !== null} onOpenChange={(open) => !open && setPendingCloseTerminalId(null)}>
                <AppDialogContent presentation="alert" className="max-w-md">
                    <AppDialogHeader
                        title={t('terminal.close.confirmTitle')}
                        subtitle={t('terminal.close.confirmDescription')}
                    />
                    <AppDialogFooter>
                        <button
                            type="button"
                            className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm"
                            onClick={() => setPendingCloseTerminalId(null)}
                        >
                            {t('button.cancel')}
                        </button>
                        <button
                            type="button"
                            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white"
                            onClick={() => {
                                if (closeTarget) {
                                    controller.closeOne(closeTarget.terminalId)
                                }
                                setPendingCloseTerminalId(null)
                            }}
                        >
                            {t('terminal.close.confirmAction')}
                        </button>
                    </AppDialogFooter>
                </AppDialogContent>
            </AppDialog>
        </div>
    )
}
