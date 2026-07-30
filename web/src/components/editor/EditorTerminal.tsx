import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { ApiClient } from '@/api/client'
import {
    TerminalControlDock,
    TerminalToolIcon,
    type TerminalDockTool,
} from '@/components/Terminal/TerminalControlDock'
import { TerminalView } from '@/components/Terminal/TerminalView'
import { SessionTerminalTabs } from '@/components/Terminal/SessionTerminalTabs'
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
import { useAppContext } from '@/lib/app-context'
import type { EditorTab } from '@/hooks/useEditorState'
import { useSession } from '@/hooks/queries/useSession'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useTerminalSocket } from '@/hooks/useTerminalSocket'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'
import { useTranslation } from '@/lib/use-translation'


function EditorSessionTerminalBody(props: {
    api: ApiClient | null
    tab: EditorTab
    interactionActive: boolean
    compactFontSize?: boolean
}) {
    const sessionId = props.tab.sessionId ?? null
    const { session, isLoading } = useSession(props.api, sessionId)
    const terminalSupported = isRemoteTerminalSupported(session?.metadata)

    if (!sessionId) {
        return null
    }

    if (isLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[var(--app-hint)]">
                Loading terminal session...
            </div>
        )
    }

    if (!session) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[var(--app-hint)]">
                Terminal session is unavailable.
            </div>
        )
    }

    return (
        <SessionTerminalTabs
            sessionId={sessionId}
            active={Boolean(session.active)}
            terminalSupported={terminalSupported}
            interactionActive={props.interactionActive}
            cwd={session.metadata?.path}
            compactFontSize={props.compactFontSize}
            className="min-h-0 flex-1"
        />
    )
}

function EditorTerminalBody(props: {
    api: ApiClient | null
    tab: EditorTab
    isActive: boolean
    onAddToChat?: (text: string) => void
    onRegisterClose?: (tabId: string, close: (() => void) | null) => void
    compactFontSize?: boolean
    mobileMode?: boolean
}) {
    const { baseUrl } = useAppContext()
    const { t } = useTranslation()
    const isDockViewport = useMediaQuery('(max-width: 1023px)')
    const sessionId = props.tab.sessionId ?? null
    const machineId = props.tab.machineId ?? null
    const cwd = props.tab.cwd ?? undefined
    const { session, isLoading } = useSession(props.api, sessionId)
    const terminalSupported = sessionId ? isRemoteTerminalSupported(session?.metadata) : true
    const terminalRef = useRef<Terminal | null>(null)
    const inputDisposableRef = useRef<{ dispose: () => void } | null>(null)
    const selectionDisposeRef = useRef<() => void>(() => {})
    const connectOnceRef = useRef(false)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null)
    const [terminalSelection, setTerminalSelection] = useState<string | null>(null)
    const [terminalMousePos, setTerminalMousePos] = useState<{ x: number; y: number } | null>(null)
    const [activeDockTool, setActiveDockTool] = useState<TerminalDockTool | null>(null)
    const [searchMounted, setSearchMounted] = useState(false)
    const [searchState, setSearchState] = useState<TerminalSearchState>(
        EMPTY_TERMINAL_SEARCH_STATE,
    )
    const terminalContainerRef = useRef<HTMLDivElement | null>(null)

    const {
        state: terminalState,
        connect,
        write,
        resize,
        disconnect,
        close,
        onOutput,
        onExit,
        requestHistory,
        onHistory,
    } = useTerminalSocket({
        baseUrl,
        sessionId: sessionId ?? '',
        machineId: machineId ?? '',
        cwd,
        terminalId: props.tab.id
    })
    const canUseTerminal = terminalSupported && Boolean(machineId || session?.active)
    const quickInputDisabled = !canUseTerminal || terminalState.status !== 'connected'
    const quickInput = useTerminalQuickInput({
        disabled: quickInputDisabled,
        write,
    })
    const searchStateRef = useRef<TerminalSearchState>(EMPTY_TERMINAL_SEARCH_STATE)
    const searchGenerationRef = useRef(0)
    const searchIdentity = props.isActive && !quickInputDisabled
        ? props.tab.id
        : null
    const activeSearchIdentityRef = useRef(searchIdentity)
    activeSearchIdentityRef.current = searchIdentity

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

    const handleActiveDockToolChange = useCallback((tool: TerminalDockTool | null) => {
        if (tool === 'search') {
            setSearchMounted(true)
        }
        setActiveDockTool(tool)
    }, [])

    const dismissDockTool = useCallback(() => {
        if (activeDockTool !== 'search') {
            setActiveDockTool(null)
        }
    }, [activeDockTool])

    const historyTerminalId = props.isActive && !quickInputDisabled
        ? props.tab.id
        : null
    const requestTerminalHistory = useCallback((requestId: string, limit: number) => (
        historyTerminalId
            ? requestHistory(requestId, limit)
            : false
    ), [historyTerminalId, requestHistory])
    const history = useTerminalHistory({
        terminalContextKey: historyTerminalId,
        terminalId: historyTerminalId,
        request: requestTerminalHistory,
        subscribe: onHistory,
    })

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
        props.onRegisterClose?.(props.tab.id, close)
        return () => props.onRegisterClose?.(props.tab.id, null)
    }, [close, props.onRegisterClose, props.tab.id])

    useEffect(() => {
        onOutput((data) => {
            terminalRef.current?.write(data)
        })
    }, [onOutput])

    useEffect(() => {
        onExit((code, signal) => {
            setExitInfo({ code, signal })
            terminalRef.current?.write(`\r\n[process exited${code !== null ? ` with code ${code}` : ''}]`)
        })
    }, [onExit])

    const handleTerminalMount = useCallback((terminal: Terminal) => {
        terminalRef.current = terminal
        inputDisposableRef.current?.dispose()

        // Dispose previous selection + mouse listeners
        selectionDisposeRef.current()

        // Selection tracking for "Add to chat"
        const selectionDisposable = terminal.onSelectionChange(() => {
            const sel = terminal.getSelection()
            setTerminalSelection(sel || null)
        })

        // Track mouse position on terminal element (xterm captures mouse events,
        // so we can't rely on wrapper div onMouseUp)
        const termElement = terminal.element
        if (!termElement) return

        const handleMouseUp = (e: MouseEvent) => {
            const rect = termElement.getBoundingClientRect()
            setTerminalMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }
        termElement.addEventListener('mouseup', handleMouseUp)

        selectionDisposeRef.current = () => {
            selectionDisposable.dispose()
            termElement.removeEventListener('mouseup', handleMouseUp)
            setTerminalSelection(null)
            setTerminalMousePos(null)
        }

        inputDisposableRef.current = terminal.onData(quickInput.writeTerminalData)
        if (!isDockViewport) {
            terminal.focus()
        }
    }, [isDockViewport, quickInput.writeTerminalData])

    const handleResize = useCallback((cols: number, rows: number) => {
        lastSizeRef.current = { cols, rows }
        const isScopeActive = machineId ? true : Boolean(session?.active)
        if ((!sessionId && !machineId) || !isScopeActive || !terminalSupported) {
            return
        }
        if (!connectOnceRef.current) {
            connectOnceRef.current = true
            connect(cols, rows)
            return
        }
        resize(cols, rows)
    }, [connect, machineId, resize, session?.active, sessionId, terminalSupported])

    useEffect(() => {
        const isScopeActive = machineId ? true : Boolean(session?.active)
        if ((!sessionId && !machineId) || !isScopeActive || !terminalSupported || connectOnceRef.current) {
            return
        }
        const size = lastSizeRef.current
        if (!size) {
            return
        }
        connectOnceRef.current = true
        connect(size.cols, size.rows)
    }, [connect, machineId, session?.active, sessionId, terminalSupported])

    useEffect(() => {
        if (terminalState.status === 'connecting' || terminalState.status === 'connected') {
            setExitInfo(null)
        }
    }, [terminalState.status])

    useEffect(() => {
        if ((sessionId && session?.active === false) || !terminalSupported) {
            disconnect()
            connectOnceRef.current = false
        }
    }, [disconnect, session?.active, sessionId, terminalSupported])

    useEffect(() => {
        return () => {
            inputDisposableRef.current?.dispose()
            selectionDisposeRef.current()
            connectOnceRef.current = false
            disconnect()
        }
    }, [disconnect])

    if (!sessionId && !machineId) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[var(--app-hint)]">
                Select or create a session to use terminal
            </div>
        )
    }

    if (sessionId && isLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[var(--app-hint)]">
                Loading terminal session...
            </div>
        )
    }

    const status = terminalState.status
    const errorMessage = sessionId && !session
        ? 'Terminal session is unavailable.'
        : !terminalSupported
        ? 'Remote terminal is not supported on this host.'
        : terminalState.status === 'error'
          ? terminalState.error
          : session?.active === false
            ? 'Session is inactive. Terminal is unavailable.'
            : null

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1 text-[10px] text-[var(--app-hint)]">
                <span className={`h-2 w-2 rounded-full ${
                    status === 'connected'
                        ? 'bg-emerald-500'
                        : status === 'connecting'
                          ? 'bg-amber-500'
                          : status === 'error'
                            ? 'bg-red-500'
                            : 'bg-[var(--app-hint)]'
                }`} />
                <span>{status}</span>
                {exitInfo ? (
                    <span>
                        exited{exitInfo.code !== null ? ` with code ${exitInfo.code}` : ''}
                        {exitInfo.signal ? ` (${exitInfo.signal})` : ''}
                    </span>
                ) : null}
                <div className="ml-auto hidden items-stretch lg:flex">
                    {(['search', 'snippets', 'history'] as const).map((tool) => (
                        <button
                            key={tool}
                            type="button"
                            aria-label={t(`terminal.controls.${tool}`)}
                            aria-pressed={activeDockTool === tool}
                            disabled={quickInputDisabled}
                            onClick={() => handleActiveDockToolChange(
                                activeDockTool === tool ? null : tool,
                            )}
                            className={`grid min-h-8 min-w-8 place-items-center border-l border-[var(--app-border)] transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${
                                activeDockTool === tool
                                    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                            }`}
                        >
                            <TerminalToolIcon tool={tool} />
                        </button>
                    ))}
                </div>
            </div>
            {errorMessage ? (
                <div className="border-b border-[var(--app-border)] px-2 py-1 text-xs text-red-500">
                    {errorMessage}
                </div>
            ) : null}
            <div
                ref={terminalContainerRef}
                data-testid="terminal-surface"
                onPointerDownCapture={dismissDockTool}
                className="relative min-h-0 flex-1 overflow-hidden p-2"
            >
                {canUseTerminal ? (
                    <TerminalView
                        onMount={handleTerminalMount}
                        onResize={handleResize}
                        className="h-full w-full"
                        compactFontSize={props.compactFontSize}
                        mobileInteractionEnabled={
                            props.isActive && !quickInputDisabled
                        }
                        dismissMobileInteraction={
                            activeDockTool !== null || !props.isActive
                        }
                        searchActive={searchEnabled}
                        onSearchStateChange={handleSearchStateChange}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center rounded border border-[var(--app-border)] text-xs text-[var(--app-hint)]">
                        {errorMessage}
                    </div>
                )}
                {terminalSelection && terminalMousePos && props.onAddToChat && (
                    <button
                        type="button"
                        aria-label="Add selection to chat"
                        className="absolute z-20 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300 shadow-md hover:bg-violet-500 hover:text-white hover:border-violet-400 transition-colors"
                        style={{
                            top: Math.max(0, terminalMousePos.y - 28) + 'px',
                            left: Math.max(0, terminalMousePos.x - 45) + 'px',
                        }}
                        onClick={() => {
                            if (terminalSelection && props.onAddToChat) {
                                props.onAddToChat(terminalSelection)
                            }
                            setTerminalSelection(null)
                            setTerminalMousePos(null)
                        }}
                    >
                        Add to chat
                    </button>
                )}
            </div>
            <TerminalControlDock
                api={props.api}
                terminalContextKey={
                    quickInputDisabled || !props.isActive ? null : props.tab.id
                }
                disabled={quickInputDisabled}
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
        </div>
    )
}

export function EditorTerminal(props: {
    api: ApiClient | null
    tabs: EditorTab[]
    activeTabId: string | null
    isCollapsed: boolean
    onSelectTab: (tabId: string) => void
    onCloseTab: (tabId: string) => void
    onOpenTerminal: () => void
    onToggleCollapsed: () => void
    onAddToChat?: (text: string) => void
    onRegisterTerminalClose?: (tabId: string, close: (() => void) | null) => void
    mobileMode?: boolean
}) {
    const closeByTerminalIdRef = useRef<Map<string, () => void>>(new Map())
    const [pendingCloseTerminalId, setPendingCloseTerminalId] = useState<string | null>(null)
    const terminalTabs = useMemo(
        () => props.tabs.filter((tab) => tab.type === 'terminal'),
        [props.tabs]
    )
    const legacyTerminalTabs = useMemo(
        () => terminalTabs.filter((tab) => !tab.sessionId),
        [terminalTabs]
    )
    const activeTerminal = terminalTabs.find((tab) => tab.id === props.activeTabId) ?? terminalTabs[0] ?? null
    const activeSessionTerminal = activeTerminal?.sessionId ? activeTerminal : null
    const activeMachineTerminal = activeTerminal?.machineId ? activeTerminal : null
    const handleRegisterClose = useCallback((tabId: string, close: (() => void) | null) => {
        if (!close) {
            closeByTerminalIdRef.current.delete(tabId)
            props.onRegisterTerminalClose?.(tabId, null)
            return
        }
        closeByTerminalIdRef.current.set(tabId, close)
        props.onRegisterTerminalClose?.(tabId, close)
    }, [props.onRegisterTerminalClose])
    const closeTerminalNow = useCallback((tabId: string) => {
        const tab = terminalTabs.find((item) => item.id === tabId)
        if (!tab?.sessionId) {
            closeByTerminalIdRef.current.get(tabId)?.()
            closeByTerminalIdRef.current.delete(tabId)
        }
        props.onCloseTab(tabId)
    }, [props.onCloseTab, terminalTabs])
    const handleCloseTerminal = useCallback((tabId: string) => {
        const tab = terminalTabs.find((item) => item.id === tabId)
        if (props.mobileMode && !tab?.sessionId) {
            setPendingCloseTerminalId(tabId)
            return
        }
        closeTerminalNow(tabId)
    }, [closeTerminalNow, props.mobileMode, terminalTabs])

    return (
        <div className="flex h-full min-h-0 flex-col border-t border-[var(--app-border)] bg-[var(--app-bg)]">
            <div
                className={`flex h-8 shrink-0 items-center border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] ${
                    props.mobileMode ? '' : 'cursor-pointer'
                }`}
                onClick={(event) => {
                    const target = event.target
                    if (
                        props.mobileMode
                        || (
                            target instanceof Element
                            && target.closest('button, [data-terminal-header-control]')
                        )
                    ) {
                        return
                    }
                    props.onToggleCollapsed()
                }}
            >
                {!props.mobileMode ? (
                    <button
                        type="button"
                        aria-label={props.isCollapsed ? 'Expand terminal' : 'Collapse terminal'}
                        className="flex h-full w-7 items-center justify-center text-xs text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        onClick={() => props.onToggleCollapsed()}
                        title={props.isCollapsed ? 'Expand terminal' : 'Collapse terminal'}
                    >
                        {props.isCollapsed ? '›' : '⌄'}
                    </button>
                ) : null}
                <div className="px-2 text-xs font-medium text-[var(--app-hint)]">Terminal</div>
                {activeSessionTerminal ? (
                    <div className="min-w-0 flex-1" />
                ) : (
                    <div
                        data-terminal-header-control
                        className="flex min-w-0 flex-1 items-center overflow-x-auto"
                    >
                        {legacyTerminalTabs.map((tab) => {
                            const isActive = tab.id === activeTerminal?.id
                            return (
                                <div
                                    key={tab.id}
                                    className={`flex items-center gap-1 border-l border-[var(--app-border)] px-2 py-1 text-xs ${
                                        isActive ? 'bg-[var(--app-bg)] text-[#818cf8]' : 'text-[var(--app-hint)]'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        aria-label={`Select terminal ${tab.label}`}
                                        className="max-w-[140px] truncate hover:text-[var(--app-fg)]"
                                        onClick={() => props.onSelectTab(tab.id)}
                                    >
                                        {tab.label}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Close terminal ${tab.label}`}
                                        className="text-[10px] hover:text-[var(--app-fg)]"
                                        onClick={() => handleCloseTerminal(tab.id)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
                {!props.mobileMode && !activeSessionTerminal ? (
                    <button
                        type="button"
                        aria-label="Open terminal"
                        className="h-full px-3 text-sm text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        onClick={() => props.onOpenTerminal()}
                        title="Open terminal"
                    >
                        +
                    </button>
                ) : null}
            </div>

            {terminalTabs.length > 0 ? (
                <div className={`min-h-0 flex-1 overflow-hidden ${props.isCollapsed && !props.mobileMode ? 'hidden' : ''}`}>
                    {activeSessionTerminal ? (
                        <div className="h-full min-h-0">
                            <EditorSessionTerminalBody
                                api={props.api}
                                tab={activeSessionTerminal}
                                interactionActive={
                                    Boolean(props.mobileMode)
                                    || !props.isCollapsed
                                }
                                compactFontSize={props.mobileMode}
                            />
                        </div>
                    ) : null}
                    {terminalTabs.filter((tab) => tab.machineId).map((tab) => {
                        const isActive = tab.id === activeMachineTerminal?.id
                        return (
                            <div key={tab.id} className={`h-full min-h-0 ${isActive ? 'block' : 'hidden'}`}>
                                <EditorTerminalBody
                                    api={props.api}
                                    tab={tab}
                                    isActive={
                                        isActive
                                        && (Boolean(props.mobileMode) || !props.isCollapsed)
                                    }
                                    onAddToChat={props.onAddToChat}
                                    onRegisterClose={handleRegisterClose}
                                    compactFontSize={props.mobileMode}
                                    mobileMode={props.mobileMode}
                                />
                            </div>
                        )
                    })}
                </div>
            ) : !props.isCollapsed || props.mobileMode ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[var(--app-hint)]">
                    <div>No terminal open</div>
                </div>
            ) : null}

            <AppDialog
                open={pendingCloseTerminalId !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingCloseTerminalId(null)
                    }
                }}
            >
                <AppDialogContent presentation="alert" className="max-w-md">
                    <AppDialogHeader
                        title="Close terminal?"
                        subtitle="This will stop the running process and close the terminal tab."
                    />
                    <AppDialogFooter className="mx-auto grid w-full max-w-md grid-cols-2">
                            <button
                                type="button"
                                className="w-full rounded border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                onClick={() => setPendingCloseTerminalId(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                                onClick={() => {
                                    if (!pendingCloseTerminalId) {
                                        return
                                    }
                                    closeTerminalNow(pendingCloseTerminalId)
                                    setPendingCloseTerminalId(null)
                                }}
                            >
                                Stop process and close
                            </button>
                    </AppDialogFooter>
                </AppDialogContent>
            </AppDialog>
        </div>
    )
}
