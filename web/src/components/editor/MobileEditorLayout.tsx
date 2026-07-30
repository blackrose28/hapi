import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { EditorTab } from '@/hooks/useEditorState'
import type { SessionSummary } from '@/types/api'
import type { EditorTreeItem } from '@/types/editor'
import { EditorChatPanel } from './EditorChatPanel'
import { EditorFileTree } from './EditorFileTree'
import { EditorGitPanel } from './EditorGitPanel'
import { EditorTabs } from './EditorTabs'
import { EditorTerminal } from './EditorTerminal'
import { useTranslation } from '@/lib/use-translation'
import { getArchiveSessionDescription } from '@/lib/archiveConfirmation'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'

export type MobileEditorView = 'files' | 'editor' | 'git' | 'chat' | 'terminal'

type MobileEditorLayoutProps = {
    api: ApiClient | null
    machineId: string | null
    projectPath: string | null
    fileTabs: EditorTab[]
    terminalTabs: EditorTab[]
    activeFileTab: EditorTab | null
    activeTerminalTab: EditorTab | null
    activeSessionId: string | null
    projectSessions: SessionSummary[]
    pendingDraftText?: string
    newFileTargetPath: string | null
    newSessionError: string | null
    onBackToAgents: () => void
    onBrowseProject: () => void
    onOpenFile: (path: string) => void
    onShowContextMenu: (filePath: string, x: number, y: number, items: EditorTreeItem[]) => void
    onCreateFile: (parentPath: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string } | unknown>
    onCancelNewFile: () => void
    onNewFileFromTabs: () => void
    onDirtyChange: (tabId: string, dirty: boolean) => void
    onAddSelectionToChat: (filePath: string, startLine: number, endLine: number, content: string) => void
    onSelectFileTab: (tabId: string) => void
    onCloseTab: (tabId: string) => void
    onOpenNewSessionModal: () => void
    onSelectSession: (sessionId: string) => void
    onArchiveSession: (sessionId: string) => Promise<void>
    onDeleteSession: (sessionId: string) => Promise<void>
    onSessionResolved: (resolvedSessionId: string) => void
    onExpandDraft: (text: string) => string
    onDraftConsumed: () => void
    onOpenTerminal: (sessionId?: string | null) => void
    onSelectTerminalTab: (tabId: string) => void
    onCloseTerminalTab: (tabId: string) => void
    onAddTerminalToChat: (text: string) => void
    onRegisterTerminalClose: (tabId: string, close: (() => void) | null) => void
    onSaveActiveFile: () => Promise<void>
    setTabViewMode: (tabId: string, mode: 'source' | 'preview') => void
    saveActiveFileRef: React.MutableRefObject<(() => Promise<void>) | null>
}

function getRelativeLabel(projectPath: string | null, path: string | null | undefined): string {
    if (!path) return ''
    if (!projectPath) return path

    const root = projectPath.replace(/\/+$/, '')
    if (path === root) {
        return path.split('/').filter(Boolean).pop() ?? path
    }
    if (path.startsWith(`${root}/`)) {
        return path.slice(root.length + 1)
    }
    return path
}

function getParentPath(path: string): string {
    const normalized = path.replace(/\/+$/, '')
    const index = normalized.lastIndexOf('/')
    if (index <= 0) return '/'
    return normalized.slice(0, index)
}

function MobileHeader(props: {
    title: string
    subtitle: string
    action: ReactNode
    onBackToAgents: () => void
}) {
    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2">
            <button
                type="button"
                aria-label="Back to Agent Mode"
                className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                onClick={props.onBackToAgents}
            >
                ← Agents
            </button>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{props.title}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{props.subtitle}</div>
            </div>
            {props.action}
        </div>
    )
}

function BottomNav(props: { view: MobileEditorView; onViewChange: (view: MobileEditorView) => void }) {
    const items: Array<{ view: MobileEditorView; label: string; ariaLabel?: string; icon: string }> = [
        { view: 'files', label: 'Files', icon: '📁' },
        { view: 'editor', label: 'Editor', icon: '⌨️' },
        { view: 'git', label: 'Git', ariaLabel: 'Git source control', icon: '⑂' },
        { view: 'chat', label: 'Chat', icon: '💬' },
        { view: 'terminal', label: 'Term', ariaLabel: 'Terminal', icon: '▣' },
    ]

    return (
        <nav aria-label="Mobile editor views" className="grid h-14 shrink-0 grid-cols-5 border-t border-[var(--app-border)] bg-[var(--app-bg)]">
            {items.map((item) => {
                const active = item.view === props.view
                return (
                    <button
                        key={item.view}
                        type="button"
                        aria-label={item.ariaLabel ?? item.label}
                        aria-current={active ? 'page' : undefined}
                        className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-xs rounded-lg transition-colors ${active ? 'font-semibold text-[#818cf8] bg-[#818cf8]/10' : 'text-[var(--app-hint)]'}`}
                        onClick={() => props.onViewChange(item.view)}
                    >
                        <span aria-hidden="true">{item.icon}</span>
                        <span>{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

function getSessionTabTitle(session: SessionSummary): string {
    if (session.metadata?.name) return session.metadata.name
    if (session.metadata?.summary?.text) return session.metadata.summary.text
    return session.id
}

type PendingConfirm =
    | { type: 'archive'; session: SessionSummary }
    | { type: 'delete'; session: SessionSummary }
    | null

function MobileConfirmModal(props: {
    pending: PendingConfirm
    onCancel: () => void
    onConfirm: () => Promise<void>
}) {
    const { t } = useTranslation()
    if (!props.pending) return null
    const isDelete = props.pending.type === 'delete'
    const archiveDescription = !isDelete
        ? getArchiveSessionDescription(t, {
            name: getSessionTabTitle(props.pending.session),
            terminalLiveCount: props.pending.session.terminalLiveCount
        })
        : null
    return (
        <AppDialog open onOpenChange={(open) => !open && props.onCancel()}>
            <AppDialogContent presentation="alert" dismissible={false} className="max-w-sm">
                <AppDialogHeader
                    title={isDelete ? 'Delete archived session?' : 'Archive session?'}
                    subtitle={isDelete
                        ? 'This permanently removes the archived session and its messages.'
                        : archiveDescription}
                />
                <AppDialogFooter>
                    <button
                        type="button"
                        className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-xs font-semibold text-[var(--app-fg)]"
                        onClick={props.onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white"
                        onClick={() => { void props.onConfirm() }}
                    >
                        {isDelete ? 'Delete' : 'Archive'}
                    </button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}

function MobileNewFileModal(props: {
    open: boolean
    parentPath: string | null
    fileName: string
    error: string | null
    isCreating: boolean
    onFileNameChange: (fileName: string) => void
    onCancel: () => void
    onCreate: () => void
}) {
    if (!props.open) return null

    return (
        <AppDialog open onOpenChange={(open) => !open && props.onCancel()}>
            <AppDialogContent presentation="alert" dismissible={false} className="max-w-sm">
                <AppDialogHeader
                    title="New file"
                    subtitle="Create inside"
                    closeDisabled={props.isCreating}
                />
                <AppDialogBody className="p-4">
                <div className="mt-1 truncate rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)]">
                    {props.parentPath ?? 'Select a project first'}
                </div>
                <label className="mt-3 block text-xs font-semibold text-[var(--app-fg)]" htmlFor="mobile-new-file-name">
                    File name
                </label>
                <input
                    id="mobile-new-file-name"
                    value={props.fileName}
                    autoFocus
                    className="mt-1 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[#818cf8]"
                    placeholder="src/NewFile.ts"
                    disabled={props.isCreating}
                    onChange={(event) => props.onFileNameChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            props.onCreate()
                        }
                    }}
                />
                {props.error ? (
                    <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-500">
                        {props.error}
                    </div>
                ) : null}
                </AppDialogBody>
                <AppDialogFooter>
                    <button
                        type="button"
                        className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-xs font-semibold text-[var(--app-fg)] disabled:opacity-60"
                        disabled={props.isCreating}
                        onClick={props.onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="rounded-md bg-[#6366f1] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        disabled={props.isCreating || !props.parentPath}
                        onClick={props.onCreate}
                    >
                        {props.isCreating ? 'Creating...' : 'Create'}
                    </button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}

function MobileSessionTabs(props: {
    mode: 'chat' | 'terminal'
    sessions: SessionSummary[]
    activeSessionId: string | null
    terminalScopeSessionId?: string | null
    onSelectSession: (sessionId: string) => void
    onSelectTerminalScope: (sessionId: string | null) => void
    onRequestArchive: (session: SessionSummary) => void
    onRequestDelete: (session: SessionSummary) => void
    onNewSession: () => void
}) {
    const [actionSessionId, setActionSessionId] = useState<string | null>(null)
    const actionSession = props.sessions.find((session) => session.id === actionSessionId) ?? null
    const activeId = props.mode === 'terminal' ? props.terminalScopeSessionId : props.activeSessionId

    if (props.sessions.length === 0) {
        return (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-2">
                {props.mode === 'terminal' ? (
                    <button
                        type="button"
                        aria-label="Use project for terminal"
                        className="shrink-0 rounded-full border border-[#818cf8] bg-[#818cf8]/10 px-3 py-1 text-xs font-semibold text-[#818cf8]"
                        onClick={() => props.onSelectTerminalScope(null)}
                    >
                        Project
                    </button>
                ) : (
                    <button
                        type="button"
                        className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1 text-xs font-semibold text-[#818cf8]"
                        onClick={props.onNewSession}
                    >
                        + New Session
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className="relative shrink-0 border-b border-[var(--app-border)] bg-[var(--app-secondary-bg)]">
            <div className="flex items-center gap-1 overflow-x-auto px-2 py-2">
                {props.mode === 'terminal' ? (
                    <button
                        type="button"
                        aria-label="Use project for terminal"
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${activeId === null ? 'border-[#818cf8] bg-[#818cf8]/10 text-[#818cf8]' : 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-hint)]'}`}
                        onClick={() => props.onSelectTerminalScope(null)}
                    >
                        Project
                    </button>
                ) : null}
                {props.sessions.map((session) => {
                    const isActive = activeId === session.id
                    const title = getSessionTabTitle(session)
                    const selectLabel = props.mode === 'terminal'
                        ? `Use session ${session.id} for terminal`
                        : `Select session ${session.id}`
                    return (
                        <div key={session.id} className={`flex shrink-0 items-center rounded-full border ${isActive ? 'border-[#818cf8] bg-[#818cf8]/10 text-[#818cf8]' : 'border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-hint)]'}`}>
                            <button
                                type="button"
                                aria-label={selectLabel}
                                className="max-w-[120px] truncate px-3 py-1 text-xs font-semibold"
                                onClick={() => {
                                    if (props.mode === 'terminal') {
                                        props.onSelectTerminalScope(session.id)
                                    } else {
                                        props.onSelectSession(session.id)
                                    }
                                }}
                            >
                                <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${session.active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                {title}
                            </button>
                            <button
                                type="button"
                                aria-label={`Session actions ${session.id}`}
                                className="border-l border-[var(--app-border)] px-2 py-1 text-xs"
                                onClick={() => setActionSessionId((current) => current === session.id ? null : session.id)}
                            >
                                ⋯
                            </button>
                        </div>
                    )
                })}
                {props.mode === 'chat' ? (
                    <button
                        type="button"
                        aria-label="New chat session"
                        className="shrink-0 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1 text-xs font-semibold text-[var(--app-fg)]"
                        onClick={props.onNewSession}
                    >
                        +
                    </button>
                ) : null}
            </div>
            {actionSession ? (
                <div className="absolute right-2 top-11 z-20 min-w-40 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg">
                    {actionSession.active ? (
                        <button
                            type="button"
                            className="w-full rounded-md px-3 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                            onClick={() => {
                                setActionSessionId(null)
                                props.onRequestArchive(actionSession)
                            }}
                        >
                            Archive session
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="w-full rounded-md px-3 py-2 text-left text-xs text-red-500 hover:bg-[var(--app-subtle-bg)]"
                            onClick={() => {
                                setActionSessionId(null)
                                props.onRequestDelete(actionSession)
                            }}
                        >
                            Delete session
                        </button>
                    )}
                </div>
            ) : null}
        </div>
    )
}

export function MobileEditorLayout(props: MobileEditorLayoutProps) {
    const { onSaveActiveFile, saveActiveFileRef } = props
    const [view, setView] = useState<MobileEditorView>('files')
    const [hasOpenedEditorSurface, setHasOpenedEditorSurface] = useState(false)
    const [selectionNoticeVisible, setSelectionNoticeVisible] = useState(false)
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
    const [newFileOpen, setNewFileOpen] = useState(false)
    const [newFileName, setNewFileName] = useState('')
    const [newFileError, setNewFileError] = useState<string | null>(null)
    const [isCreatingFile, setIsCreatingFile] = useState(false)
    const activeFilePath = props.activeFileTab?.path ?? null
    const newFileParentPath = activeFilePath
        ? getParentPath(activeFilePath)
        : props.projectPath

    const handleViewChange = useCallback((nextView: MobileEditorView) => {
        if (nextView === 'editor') {
            setHasOpenedEditorSurface(true)
        }
        setView(nextView)
    }, [])

    const title = useMemo(() => {
        switch (view) {
            case 'files':
                return 'HAPI Editor'
            case 'editor':
                return props.activeFileTab?.label ?? 'Editor'
            case 'git':
                return 'Source Control'
            case 'chat':
                return 'Chat'
            case 'terminal':
                return 'Terminal'
        }
    }, [props.activeFileTab?.label, view])

    const subtitle = useMemo(() => {
        switch (view) {
            case 'files':
                return props.projectPath ?? 'Open a project'
            case 'editor':
                return getRelativeLabel(props.projectPath, props.activeFileTab?.path) || 'Open a file'
            case 'git':
                return props.projectPath ?? 'Open a project'
            case 'chat':
                return props.activeSessionId ? `Session ${props.activeSessionId.slice(0, 8)}` : 'No session selected'
            case 'terminal':
                return props.activeTerminalTab?.label ?? 'No terminal open'
        }
    }, [props.activeFileTab?.path, props.activeSessionId, props.activeTerminalTab?.label, props.projectPath, view])

    const handleOpenFile = useCallback((path: string) => {
        props.onOpenFile(path)
        handleViewChange('editor')
    }, [handleViewChange, props.onOpenFile])

    const handleOpenTerminal = useCallback(() => {
        props.onOpenTerminal()
        setView('terminal')
    }, [props.onOpenTerminal])

    const handleAddSelectionToChat = useCallback((filePath: string, startLine: number, endLine: number, content: string) => {
        props.onAddSelectionToChat(filePath, startLine, endLine, content)
        setSelectionNoticeVisible(true)
    }, [props.onAddSelectionToChat])

    const openNewFileModal = useCallback(() => {
        setNewFileName('')
        setNewFileError(null)
        setNewFileOpen(true)
    }, [])

    const handleCreateMobileFile = useCallback(async () => {
        if (!newFileParentPath) {
            setNewFileError('Select a project before creating files')
            return
        }
        const trimmedName = newFileName.trim()
        if (!trimmedName) {
            setNewFileError('Enter a file name')
            return
        }

        setIsCreatingFile(true)
        setNewFileError(null)
        try {
            const result = await props.onCreateFile(newFileParentPath, trimmedName)
            if (result && typeof result === 'object' && 'success' in result && result.success === false) {
                const error = 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : 'Failed to create file'
                setNewFileError(error)
                return
            }
            setNewFileOpen(false)
            setNewFileName('')
        } catch (error) {
            setNewFileError(error instanceof Error ? error.message : 'Failed to create file')
        } finally {
            setIsCreatingFile(false)
        }
    }, [newFileName, newFileParentPath, props])

    const headerAction = useMemo(() => {
        if (view === 'files') {
            return (
                <button
                    type="button"
                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    onClick={props.onBrowseProject}
                >
                    Browse
                </button>
            )
        }
        if (view === 'editor') {
            const isDirty = props.activeFileTab?.dirty === true
            return (
                <div className="flex items-center gap-1.5">
                    {isDirty ? (
                        <button
                            type="button"
                            aria-label="Save file"
                            className="rounded-md bg-[#6366f1] px-2 py-1 text-xs font-semibold text-white hover:bg-[#5558e6]"
                            onClick={() => { void onSaveActiveFile() }}
                        >
                            Save
                        </button>
                    ) : null}
                    <button
                        type="button"
                        aria-label="New file"
                        className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                        onClick={openNewFileModal}
                    >
                        +
                    </button>
                </div>
            )
        }
        if (view === 'chat') {
            return (
                <button
                    type="button"
                    aria-label="New chat session"
                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    onClick={props.onOpenNewSessionModal}
                >
                    +
                </button>
            )
        }
        if (view === 'git') return null
        return (
            <button
                type="button"
                aria-label="Open terminal"
                className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                onClick={handleOpenTerminal}
            >
                +
            </button>
        )
    }, [handleOpenTerminal, openNewFileModal, props.onBrowseProject, props.onOpenNewSessionModal, view])

    const handleConfirmSessionAction = useCallback(async () => {
        if (!pendingConfirm) return
        if (pendingConfirm.type === 'archive') {
            await props.onArchiveSession(pendingConfirm.session.id)
        } else {
            await props.onDeleteSession(pendingConfirm.session.id)
        }
        setPendingConfirm(null)
    }, [pendingConfirm, props])

    return (
        <div data-testid="mobile-editor-layout" className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
            <MobileHeader
                title={title}
                subtitle={subtitle}
                action={headerAction}
                onBackToAgents={props.onBackToAgents}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
                {view === 'files' ? (
                    <EditorFileTree
                        api={props.api}
                        machineId={props.machineId}
                        projectPath={props.projectPath}
                        onOpenFile={handleOpenFile}
                        onContextMenu={props.onShowContextMenu}
                        activeFilePath={activeFilePath}
                        newFileTargetPath={props.newFileTargetPath}
                        onCreateFile={props.onCreateFile}
                        onCancelNewFile={props.onCancelNewFile}
                        mobileMode={true}
                    />
                ) : null}

                {hasOpenedEditorSurface ? (
                    <div className="h-full" hidden={view !== 'editor'}>
                        <EditorTabs
                            api={props.api}
                            machineId={props.machineId}
                            tabs={props.fileTabs}
                            activeTabId={props.activeFileTab?.id ?? null}
                            onSelectTab={props.onSelectFileTab}
                            onCloseTab={props.onCloseTab}
                            onNewFile={props.onNewFileFromTabs}
                            onDirtyChange={props.onDirtyChange}
                            onAddSelectionToChat={handleAddSelectionToChat}
                            setTabViewMode={props.setTabViewMode}
                            saveRef={saveActiveFileRef}
                            mobileMode={true}
                        />
                    </div>
                ) : null}

                {view === 'git' ? (
                    <EditorGitPanel
                        api={props.api}
                        machineId={props.machineId}
                        projectPath={props.projectPath}
                        onOpenFile={(relativePath) => {
                            const fullPath = props.projectPath ? `${props.projectPath.replace(/\/+$/, '')}/${relativePath}` : relativePath
                            props.onOpenFile(fullPath)
                            handleViewChange('editor')
                        }}
                    />
                ) : null}

                {view === 'chat' ? (
                    <div className="flex h-full min-h-0 flex-col">
                        <MobileSessionTabs
                            mode="chat"
                            sessions={props.projectSessions}
                            activeSessionId={props.activeSessionId}
                            terminalScopeSessionId={null}
                            onSelectSession={props.onSelectSession}
                            onSelectTerminalScope={() => {}}
                            onRequestArchive={(session) => setPendingConfirm({ type: 'archive', session })}
                            onRequestDelete={(session) => setPendingConfirm({ type: 'delete', session })}
                            onNewSession={props.onOpenNewSessionModal}
                        />
                        <div className="min-h-0 flex-1">
                            <EditorChatPanel
                                api={props.api}
                                sessionId={props.activeSessionId}
                                pendingDraftText={props.pendingDraftText}
                                onDraftConsumed={props.onDraftConsumed}
                                onExpandDraft={props.onExpandDraft}
                                onSessionResolved={props.onSessionResolved}
                                onNewSessionRequested={props.onOpenNewSessionModal}
                            />
                        </div>
                    </div>
                ) : null}

                {view === 'terminal' ? (
                    <div className="h-full min-h-0">
                        <EditorTerminal
                            api={props.api}
                            tabs={props.terminalTabs}
                            activeTabId={props.activeTerminalTab?.id ?? null}
                            isCollapsed={false}
                            onSelectTab={props.onSelectTerminalTab}
                            onCloseTab={props.onCloseTerminalTab}
                            onOpenTerminal={handleOpenTerminal}
                            onToggleCollapsed={() => {}}
                            onAddToChat={props.onAddTerminalToChat}
                            onRegisterTerminalClose={props.onRegisterTerminalClose}
                            mobileMode={true}
                        />
                    </div>
                ) : null}
            </div>

            {selectionNoticeVisible ? (
                <div className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2 text-xs text-[var(--app-fg)]">
                    <span>Selection added to chat draft</span>
                    <button
                        type="button"
                        className="ml-2 rounded-md px-2 py-1 text-xs font-semibold hover:bg-[var(--app-bg)]"
                        onClick={() => handleViewChange('chat')}
                    >
                        Open chat
                    </button>
                    <button
                        type="button"
                        className="ml-1 rounded-md px-2 py-1 text-xs text-[var(--app-hint)] hover:bg-[var(--app-bg)]"
                        onClick={() => setSelectionNoticeVisible(false)}
                    >
                        Dismiss
                    </button>
                </div>
            ) : null}

            <MobileConfirmModal
                pending={pendingConfirm}
                onCancel={() => setPendingConfirm(null)}
                onConfirm={handleConfirmSessionAction}
            />

            <MobileNewFileModal
                open={newFileOpen}
                parentPath={newFileParentPath}
                fileName={newFileName}
                error={newFileError}
                isCreating={isCreatingFile}
                onFileNameChange={(value) => {
                    setNewFileName(value)
                    setNewFileError(null)
                }}
                onCancel={() => {
                    if (isCreatingFile) return
                    setNewFileOpen(false)
                    setNewFileError(null)
                }}
                onCreate={() => { void handleCreateMobileFile() }}
            />

            {props.newSessionError ? (
                <div className="shrink-0 border-t border-[var(--app-border)] px-3 py-2 text-xs text-red-500">
                    {props.newSessionError}
                </div>
            ) : null}

            <BottomNav view={view} onViewChange={handleViewChange} />
        </div>
    )
}
