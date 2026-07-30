import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { CodexGoalState } from '@/chat/types'
import type { Machine, Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMachines } from '@/hooks/queries/useMachines'
import { useTeamChats } from '@/hooks/queries/useTeamChats'
import { useSessionTeamMemberships } from '@/hooks/queries/useSessionTeamMemberships'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionGoalControl } from '@/components/SessionGoalControl'
import { SessionTaskListControl } from '@/components/SessionTaskListControl'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getSessionModelLabel } from '@/lib/sessionModelLabel'
import { useTranslation } from '@/lib/use-translation'
import { getArchiveSessionDescription } from '@/lib/archiveConfirmation'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function normalizeTeamAlias(alias: string): string {
    return alias.trim().replace(/\s+/g, ' ')
}

function isDesktopFocusViewport(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return !window.matchMedia('(max-width: 768px)').matches
}

function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function OutlineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
        </svg>
    )
}

function getMachineLabel(machine: Machine): string {
    return machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id.slice(0, 8)
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
    )
}


function EditorIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m8 10 3 3-3 3" />
            <path d="M13 16h3" />
        </svg>
    )
}

function TerminalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onOpenOutline?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
    compactMode?: boolean
    pinIndex?: number
    onFocusSession?: () => void
    compactCloseLabel?: string
    compactCloseButtonRef?: Ref<HTMLButtonElement>
    codexGoal?: CodexGoalState | null
    onGoalCommand?: (command: string) => void
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { session, api, onSessionDeleted, compactMode, pinIndex } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const modelLabel = getSessionModelLabel(session)
    const agentFlavor = session.metadata?.flavor ?? 'claude'
    const canControlGoal = session.active && agentFlavor === 'codex' && typeof props.onGoalCommand === 'function'
    const sessionStatus = session.thinking ? 'thinking' : !session.active ? 'archived' : 'active'
    const editorSearch = session.metadata?.machineId && session.metadata?.path
        ? { machine: session.metadata.machineId, project: session.metadata.path }
        : null

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [creatingTeamChat, setCreatingTeamChat] = useState(false)
    const [teamMenuOpen, setTeamMenuOpen] = useState(false)
    const [addingTeamChatId, setAddingTeamChatId] = useState<string | null>(null)
    const [teamAlias, setTeamAlias] = useState(title)
    const [desktopFocusEnabled, setDesktopFocusEnabled] = useState(() => isDesktopFocusViewport())
    const normalizedTeamAlias = normalizeTeamAlias(teamAlias)
    const teamAliasError = !normalizedTeamAlias
        ? 'Alias is required.'
        : normalizedTeamAlias.length > 32
            ? 'Alias must be 32 characters or fewer.'
            : null

    useEffect(() => {
        setTeamAlias(title.length > 32 ? title.slice(0, 32).trim() : title)
    }, [title])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
        const media = window.matchMedia('(max-width: 768px)')
        const update = () => setDesktopFocusEnabled(!media.matches)
        update()
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', update)
            return () => media.removeEventListener('change', update)
        }
        media.addListener(update)
        return () => media.removeListener(update)
    }, [])

    const canFocusSession = Boolean(compactMode && props.onFocusSession && desktopFocusEnabled)

    const handleCompactHeaderDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!canFocusSession) return
        const target = event.target as HTMLElement | null
        if (target?.closest('button,a,input,select,textarea,[role="button"],[data-focus-ignore="true"]')) return
        props.onFocusSession?.()
    }, [canFocusSession, props.onFocusSession])

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )

    const { machines } = useMachines(api, true)
    const { teamChats } = useTeamChats(api)
    const { memberships: teamMemberships } = useSessionTeamMemberships(api, session.id)

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    const handleMachineChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        const newMachineId = event.target.value
        if (!newMachineId) return
        navigate({ to: '/editor', search: { machine: newMachineId } })
    }, [navigate])

    const handleCreateTeamChatWithSession = useCallback(async () => {
        if (!api || creatingTeamChat || teamAliasError) return
        setCreatingTeamChat(true)
        try {
            const response = await api.createTeamChat({
                name: title,
                projectPath: session.metadata?.path ?? null
            })
            await api.addTeamParticipant(response.teamChat.id, {
                type: 'session',
                sessionId: session.id,
                displayName: normalizedTeamAlias,
                role: 'general',
                color: '#60a5fa'
            })
            setTeamMenuOpen(false)
            navigate({ to: '/team-chats/$teamChatId', params: { teamChatId: response.teamChat.id } })
        } finally {
            setCreatingTeamChat(false)
        }
    }, [api, creatingTeamChat, navigate, normalizedTeamAlias, session.id, session.metadata?.path, teamAliasError, title])

    const handleAddSessionToTeamChat = useCallback(async (teamChatId: string) => {
        if (!api || addingTeamChatId || teamAliasError) return
        setAddingTeamChatId(teamChatId)
        try {
            await api.addTeamParticipant(teamChatId, {
                type: 'session',
                sessionId: session.id,
                displayName: normalizedTeamAlias,
                role: 'general',
                color: '#60a5fa'
            })
            setTeamMenuOpen(false)
            navigate({ to: '/team-chats/$teamChatId', params: { teamChatId } })
        } finally {
            setAddingTeamChatId(null)
        }
    }, [addingTeamChatId, api, navigate, normalizedTeamAlias, session.id, teamAliasError])

    const handleOpenTeamChats = useCallback(() => {
        setTeamMenuOpen(false)
        navigate({ to: '/team-chats' })
    }, [navigate])

    const handleOpenCompactFiles = useCallback(() => {
        navigate({
            search: (previous: any) => ({
                ...previous,
                modal: 'files',
                modalSessionId: session.id
            })
        } as any)
    }, [navigate, session.id])

    const handleOpenCompactTerminal = useCallback(() => {
        navigate({
            search: (previous: any) => ({
                ...previous,
                modal: 'terminal',
                modalSessionId: session.id
            })
        } as any)
    }, [navigate, session.id])

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    if (compactMode) {
        const compactPath = session.metadata?.path
            ?.split('/')
            .filter(Boolean)
            .slice(-2)
            .join('/')
        const remainingTeamMemberships = teamMemberships.slice(1)
        const remainingTeamMembershipLabels = remainingTeamMemberships
            .map((membership) => `${membership.teamChat.name}: @${membership.participant.displayName}`)
            .join(', ')
        const teamMembershipOverflowLabel = remainingTeamMemberships.length > 0
            ? t('session.teamMemberships.more', {
                count: remainingTeamMemberships.length,
                memberships: remainingTeamMembershipLabels
            })
            : null

        return (
            <>
                <div className="db-pinned__compact-header" onDoubleClick={handleCompactHeaderDoubleClick}>
                    <div className="db-pinned__compact-row1">
                        {pinIndex !== undefined && <span className="db-pinned__index-badge">{pinIndex}</span>}
                        <span className={`db-card__dot db-card__dot--${sessionStatus}`} />
                        <span className="db-pinned__compact-title">{title}</span>
                        {session.metadata?.path ? (
                            <button
                                type="button"
                                className="db-pinned__compact-path-trigger"
                                onClick={handleOpenCompactFiles}
                                onDoubleClick={(event) => event.stopPropagation()}
                                title={session.metadata.path}
                                aria-label={t('session.files.openIn', { path: session.metadata.path })}
                            >
                                <FolderIcon className="h-3.5 w-3.5" />
                                <span>{compactPath}</span>
                            </button>
                        ) : null}
                        <span className="session-provider-tasks">
                            <span className={`db-card__agent db-card__agent--${agentFlavor}`}>{agentFlavor}</span>
                            <SessionTaskListControl todos={session.todos} compact />
                        </span>
                        {teamMemberships.slice(0, 1).map((membership) => (
                            <span
                                key={membership.participant.id}
                                className="db-pinned__compact-membership"
                                title={`${membership.teamChat.name}: @${membership.participant.displayName}`}
                            >
                                {membership.teamChat.name}: @{membership.participant.displayName}
                            </span>
                        ))}
                        {teamMembershipOverflowLabel ? (
                            <span
                                className="db-pinned__compact-membership db-pinned__compact-membership-overflow"
                                title={teamMembershipOverflowLabel}
                            >
                                <span aria-hidden="true">+{remainingTeamMemberships.length}</span>
                                <span className="sr-only">{teamMembershipOverflowLabel}</span>
                            </span>
                        ) : null}

                        <div className="db-pinned__compact-actions">
                            {canFocusSession ? (
                                <button
                                    type="button"
                                    className="db-pinned__compact-action db-pinned__compact-action--focus"
                                    onClick={props.onFocusSession}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                    title="Focus session"
                                    aria-label="Focus session"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M15 3h6v6" />
                                        <path d="M10 14 21 3" />
                                        <path d="M9 21H3v-6" />
                                        <path d="M14 10 3 21" />
                                    </svg>
                                </button>
                            ) : null}
                            {editorSearch ? (
                                <button
                                    type="button"
                                    className="db-pinned__compact-action"
                                    onClick={() => navigate({ to: '/editor', search: editorSearch })}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                    title="Open in Editor"
                                    aria-label="Open in Editor"
                                >
                                    <EditorIcon className="w-4 h-4" />
                                </button>
                            ) : null}
                            {props.codexGoal ? (
                                <SessionGoalControl
                                    goal={props.codexGoal}
                                    onGoalCommand={(command) => props.onGoalCommand?.(command)}
                                    disabled={!canControlGoal}
                                    compact
                                />
                            ) : null}
                            {api ? (
                                <button
                                    type="button"
                                    className="db-pinned__compact-action db-pinned__compact-action--team"
                                    onClick={() => { void handleCreateTeamChatWithSession() }}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                    title="Create Team Chat with this session"
                                    aria-label="Create Team Chat with this session"
                                    disabled={creatingTeamChat}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
                                        <path d="M8 9h8" />
                                        <path d="M8 13h5" />
                                    </svg>
                                </button>
                            ) : null}
                            <button type="button" className="db-pinned__compact-action" onClick={handleOpenCompactTerminal} onDoubleClick={(event) => event.stopPropagation()} title={t('chat.terminal')}
                                aria-label={t('chat.terminal')}
                            >
                                <TerminalIcon className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={handleMenuToggle}
                                onDoubleClick={(event) => event.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                ref={menuAnchorRef}
                                className="db-pinned__compact-action"
                                title={t('session.more')}
                                aria-label={t('session.more')}
                            >
                                <MoreVerticalIcon className="w-4 h-4" />
                            </button>
                            {props.compactCloseLabel ? (
                                <button
                                    ref={props.compactCloseButtonRef}
                                    type="button"
                                    className="db-pinned__compact-action db-pinned__compact-action--close"
                                    onClick={props.onBack}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                    title={props.compactCloseLabel}
                                    aria-label={props.compactCloseLabel}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>

                <SessionActionMenu
                    isOpen={menuOpen}
                    onClose={() => setMenuOpen(false)}
                    sessionActive={session.active}
                    onRename={() => setRenameOpen(true)}
                    onArchive={() => setArchiveOpen(true)}
                    onDelete={() => setDeleteOpen(true)}
                    onOpenFiles={handleOpenCompactFiles}
                    filesVisibleOnDesktop={!session.metadata?.path}
                    onUnpin={props.compactCloseLabel ? undefined : props.onBack}
                    anchorPoint={menuAnchorPoint}
                    menuId={menuId}
                />

                <RenameSessionDialog isOpen={renameOpen} onClose={() => setRenameOpen(false)} currentName={title} onRename={renameSession} isPending={isPending} />
                <ConfirmDialog isOpen={archiveOpen} onClose={() => setArchiveOpen(false)} title={t('dialog.archive.title')} description={getArchiveSessionDescription(t, { name: title, terminalLiveCount: session.terminalLiveCount })} confirmLabel={t('dialog.archive.confirm')} confirmingLabel={t('dialog.archive.confirming')} onConfirm={archiveSession} isPending={isPending} destructive />
                <ConfirmDialog isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('dialog.delete.title')} description={t('dialog.delete.description', { name: title })} confirmLabel={t('dialog.delete.confirm')} confirmingLabel={t('dialog.delete.confirming')} onConfirm={handleDelete} isPending={isPending} destructive />
            </>
        )
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-2">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        {teamMemberships.length > 0 ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                                {teamMemberships.slice(0, 3).map((membership) => (
                                    <span
                                        key={membership.participant.id}
                                        className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[11px] text-[var(--app-hint)]"
                                        title={`${membership.teamChat.name}: @${membership.participant.displayName}`}
                                    >
                                        <span className="truncate">{membership.teamChat.name}: @{membership.participant.displayName}</span>
                                    </span>
                                ))}
                                {teamMemberships.length > 3 ? (
                                    <span className="text-[11px] text-[var(--app-hint)]">+{teamMemberships.length - 3}</span>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="session-provider-tasks">
                                <span className="inline-flex items-center gap-1">
                                    <span aria-hidden="true">❖</span>
                                    {session.metadata?.flavor?.trim() || 'unknown'}
                                </span>
                                <SessionTaskListControl todos={session.todos} />
                            </span>
                            {modelLabel ? (
                                <span>
                                    {t(modelLabel.key)}: {modelLabel.value}
                                </span>
                            ) : null}
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                            {session.metadata?.path ? (
                                <span className="truncate font-mono opacity-70" title={session.metadata.path}>
                                    {session.metadata.path.split('/').filter(Boolean).slice(-2).join('/')}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <select
                        aria-label="Machine"
                        value={session.metadata?.machineId ?? ''}
                        onChange={handleMachineChange}
                        className="h-7 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-1.5 text-[11px] text-[var(--app-hint)] max-w-[140px] truncate cursor-pointer hover:border-[var(--app-link)] transition-colors"
                    >
                        <option value="">Device</option>
                        {machines.map((machine) => (
                            <option key={machine.id} value={machine.id}>
                                {machine.id === session.metadata?.machineId ? '● ' : ''}{getMachineLabel(machine)}
                            </option>
                        ))}
                    </select>

                    {editorSearch ? (
                        <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Open in Editor"
                            aria-label="Open in Editor"
                            onClick={() => navigate({ to: '/editor', search: editorSearch })}
                        >
                            <EditorIcon className="w-5 h-5" />
                        </button>
                    ) : null}

                    {props.codexGoal ? (
                        <SessionGoalControl
                            goal={props.codexGoal}
                            onGoalCommand={(command) => props.onGoalCommand?.(command)}
                            disabled={!canControlGoal}
                        />
                    ) : null}

                    {api ? (
                        <div className="relative">
                            <button
                                type="button"
                                className="flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                                title="Open Team Chat menu"
                                aria-label="Open Team Chat menu"
                                aria-haspopup="menu"
                                aria-expanded={teamMenuOpen}
                                disabled={creatingTeamChat}
                                onClick={() => setTeamMenuOpen((open) => !open)}
                            >
                                <span aria-hidden="true">💬</span>
                                <span className="hidden sm:inline">Team</span>
                            </button>
                            {teamMenuOpen ? (
                                <div
                                    role="menu"
                                    className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] p-2 text-sm shadow-xl"
                                >
                                    <button
                                        type="button"
                                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                        aria-label="Open Team Chats"
                                        onClick={handleOpenTeamChats}
                                    >
                                        <span>Open Team Chats</span>
                                        <span className="text-[var(--app-hint)]">↗</span>
                                    </button>
                                    <div className="mt-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                                        <label htmlFor="session-header-team-alias" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--app-hint)]">
                                            Team alias
                                        </label>
                                        <input
                                            id="session-header-team-alias"
                                            aria-label="Team alias"
                                            value={teamAlias}
                                            onChange={(event) => setTeamAlias(event.target.value)}
                                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                            placeholder="Backend, UI, Tester…"
                                        />
                                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                                            <span className="truncate text-[var(--app-hint)]">Tag preview: <span className="font-mono">@{normalizedTeamAlias || 'alias'}</span></span>
                                            <span className="text-[var(--app-hint)]">{normalizedTeamAlias.length}/32</span>
                                        </div>
                                        {teamAliasError ? <div className="mt-1 text-xs text-red-600">{teamAliasError}</div> : null}
                                    </div>
                                    <button
                                        type="button"
                                        className="mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                                        aria-label="Create Team Chat with this session"
                                        disabled={creatingTeamChat || Boolean(teamAliasError)}
                                        onClick={() => { void handleCreateTeamChatWithSession() }}
                                    >
                                        <span>Create Team Chat with this session</span>
                                        <span className="text-[var(--app-hint)]">＋</span>
                                    </button>
                                    <div className="my-2 h-px bg-[var(--app-border)]" />
                                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--app-hint)]">Add to existing</div>
                                    {teamChats.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">No existing Team Chats</div>
                                    ) : (
                                        <div className="max-h-56 overflow-y-auto">
                                            {teamChats.map((teamChat) => (
                                                <button
                                                    key={teamChat.id}
                                                    type="button"
                                                    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                                                    aria-label={`Add to ${teamChat.name}`}
                                                    disabled={addingTeamChatId === teamChat.id || Boolean(teamAliasError)}
                                                    onClick={() => { void handleAddSessionToTeamChat(teamChat.id) }}
                                                >
                                                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#60a5fa]" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[var(--app-fg)]">Add to {teamChat.name}</span>
                                                        {teamChat.projectPath ? <span className="block truncate text-xs text-[var(--app-hint)]">{teamChat.projectPath}</span> : null}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.title')}
                        onClick={() => navigate({ search: (prev: any) => ({ ...prev, modal: 'files', modalSessionId: session.id }) } as any)}
                    >
                        <FolderIcon className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('chat.terminal')}
                        onClick={() => navigate({ search: (prev: any) => ({ ...prev, modal: 'terminal', modalSessionId: session.id }) } as any)}
                    >
                        <TerminalIcon className="w-5 h-5" />
                    </button>

                    {props.onOpenOutline ? (
                        <button
                            type="button"
                            onClick={props.onOpenOutline}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.outline.open')}
                            aria-label={t('session.outline.open')}
                        >
                            <OutlineIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={getArchiveSessionDescription(t, { name: title, terminalLiveCount: session.terminalLiveCount })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )
}
