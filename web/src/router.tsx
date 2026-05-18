import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useNavigate,
    useParams,
} from '@tanstack/react-router'
import { getScrollRestorationKey } from '@/lib/scrollRestorationKey'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionList } from '@/components/SessionList'
import { CodexSessionSyncDialog } from '@/components/CodexSessionSyncDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { NewSession } from '@/components/NewSession'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'
import { clearCodexImportedSession, markCodexSessionsImported } from '@/lib/codexImportedSessions'
import type { Machine, CodexDuplicateSessionGroup, CodexLocalSessionSummary } from '@/types/api'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import SettingsPage from '@/routes/settings'
import { RunnersPage } from '@/routes/runners'
import { AdminPage } from '@/routes/admin'
import DashboardPage from '@/routes/dashboard'
import EditorPage from '@/routes/editor'
import TeamChatsPage from '@/routes/team-chats'
import TeamChatDetailPage from '@/routes/team-chats/$teamChatId'



function BackIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function CodexImportIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            {/* 中文注释：导入图标使用“下载进托盘”样式，与刷新按钮的循环箭头区分开，避免两个相邻按钮看起来一样。 */}
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
        </svg>
    )
}

function FolderOpenIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function SettingsIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}
function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}




function SessionsPage() {
    return <Outlet />
}

function SessionsIndexPage() {
    return <DashboardPage />
}


function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const {
        session,
        userCapability,
        error: sessionError,
        refetch: refetchSession,
    } = useSession(api, sessionId)
    const {
        messages,
        pendingMessages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(api, sessionId)
    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        isSessionThinking: session?.thinking ?? false,
        onSuccess: (sentSessionId) => {
            clearDraftsAfterSend(sentSessionId, sessionId)
            // 中文注释：一旦用户已经在 Hapi 内继续这个 Codex 会话，就清除“刚从 Codex 导入”的标记。
            clearCodexImportedSession(session?.metadata?.codexSessionId)
        },
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId, { permissionMode: session.permissionMode ?? undefined })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Resume failed'
                addToast({
                    title: 'Resume failed',
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (api) {
                    if (session) {
                        if (resolvedSessionId !== session.id) {
                            seedMessageWindowFromSession(session.id, resolvedSessionId)
                        }
                        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                    }
                    try {
                        await Promise.all([
                            queryClient.prefetchQuery({
                                queryKey: queryKeys.session(resolvedSessionId),
                                queryFn: () => api.getSession(resolvedSessionId),
                            }),
                            fetchLatestMessages(api, resolvedSessionId),
                        ])
                    } catch {
                    }
                    if (session) {
                        // 中文注释：恢复接口成功后，REST/SSE 可能仍有短暂竞态；最后再乐观置为在线，
                        // 避免刚 prefetch 到旧 inactive 快照导致状态栏继续显示离线。
                        queryClient.setQueryData(queryKeys.session(resolvedSessionId), (previous: { session?: typeof session } | undefined) => ({
                            session: { ...(previous?.session ?? session), id: resolvedSessionId, active: true }
                        }))
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resolvedSessionId },
                    replace: true
                })
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        commands: slashCommands,
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('@')) {
            if (agentType !== 'codex' || !api || !sessionId) return []
            const search = query.slice(1)
            const response = await api.searchSessionFiles(sessionId, search, 50)
            if (!response.success || !response.files) return []
            return response.files.map((file) => {
                const mentionText = `@"${file.fullPath.replace(/(["\\])/g, '\\$1')}"`
                return {
                    key: mentionText,
                    text: mentionText,
                    label: `@${file.fileName}`,
                    description: file.filePath || file.fullPath
                }
            })
        }
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [agentType, api, sessionId, getSkillSuggestions, getSlashSuggestions])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    if (!session) {
        if (sessionError) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                    <div className="text-sm font-medium text-[var(--app-fg)]">Session unavailable</div>
                    <div className="max-w-md text-xs text-[var(--app-hint)]">{sessionError}</div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/sessions', replace: true })}
                            className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                        >
                            Back to sessions
                        </button>
                        <button
                            type="button"
                            onClick={() => { void refetchSession() }}
                            className="rounded-md bg-[var(--app-link)] px-3 py-1.5 text-sm text-white"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            readOnly={userCapability === 'view'}
            messages={messages}
            pendingMessages={pendingMessages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={() => navigate({ to: '/sessions' })}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            availableSlashCommands={slashCommands}
        />
    )
}

function SessionDetailRoute() {
    const { api } = useAppContext()
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const navigate = useNavigate()
    const { notFound: sessionNotFound } = useSession(api, sessionId)
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    useEffect(() => {
        if (!sessionNotFound) {
            return
        }
        navigate({ to: '/sessions', replace: true })
    }, [navigate, sessionNotFound])

    if (sessionNotFound) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Session not found. Returning to sessions…" className="text-sm" />
            </div>
        )
    }

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()
    const { directory: initialDirectory, machineId: initialMachineId } = newSessionRoute.useSearch()

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Always return to dashboard with new session pinned
        sessionStorage.setItem('mc-pinned-ids', JSON.stringify([sessionId]))
        navigate({ to: '/sessions', replace: true })
    }, [navigate, queryClient])

    const handleChooseFolder = useCallback((args: { machineId: string | null; directory: string }) => {
        // Forward the currently-selected machine so /browse opens scoped to
        // it rather than falling back to `hapi:lastMachineId`, which can
        // disagree if the user changed machines without yet creating a
        // session.
        navigate({
            to: '/browse',
            search: args.machineId ? { machineId: args.machineId } : {}
        })
    }, [navigate])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {machinesError ? (
                    <div className="p-3 text-sm text-red-600">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    onCancel={handleCancel}
                    onSuccess={handleSuccess}
                    onChooseFolder={handleChooseFolder}
                    initialDirectory={initialDirectory}
                    initialMachineId={initialMachineId}
                />
            </div>
        </div>
    )
}

function BrowsePage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { t } = useTranslation()
    const { machineId: initialMachineId } = browseRoute.useSearch()

    const handleStartSession = useCallback((machineId: string, directory: string) => {
        navigate({
            to: '/sessions/new',
            search: { directory, machineId }
        })
    }, [navigate])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('browse.title')}</div>
            </div>

            <div className="flex-1 min-h-0">
                <WorkspaceBrowser
                    api={api}
                    machines={machines}
                    machinesLoading={machinesLoading}
                    onStartSession={handleStartSession}
                    initialMachineId={initialMachineId}
                />
            </div>
        </div>
    )
}

export type RootSearch = {
    modal?: 'new-session' | 'files' | 'terminal' | 'settings' | 'browser' | 'replace-pin'
    modalSessionId?: string
    modalPath?: string
    modalMachineId?: string
    modalReplaceSessionId?: string
    modalNewSessionId?: string
    modalReturnTo?: 'editor'
    modalParent?: 'new-session'
}

const rootRoute = createRootRoute({
    component: App,
    validateSearch: (search: Record<string, unknown>): RootSearch => {
        const result: RootSearch = {}
        if (typeof search.modal === 'string' && ['new-session', 'files', 'terminal', 'settings', 'browser', 'replace-pin'].includes(search.modal)) {
            result.modal = search.modal as RootSearch['modal']
        }
        if (typeof search.modalSessionId === 'string') {
            result.modalSessionId = search.modalSessionId
        }
        if (typeof search.modalPath === 'string') {
            result.modalPath = search.modalPath
        }
        if (typeof search.modalMachineId === 'string') {
            result.modalMachineId = search.modalMachineId
        }
        if (typeof search.modalReplaceSessionId === 'string') {
            result.modalReplaceSessionId = search.modalReplaceSessionId
        }
        if (typeof search.modalNewSessionId === 'string') {
            result.modalNewSessionId = search.modalNewSessionId
        }
        if (search.modalReturnTo === 'editor') {
            result.modalReturnTo = 'editor'
        }
        if (search.modalParent === 'new-session') {
            result.modalParent = 'new-session'
        }
        return result
    }
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    path: '/',
    getParentRoute: () => sessionsRoute,
    validateSearch: (search: Record<string, unknown>) => {
        return {}
    },
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        return tab ? { tab } : {}
    },
    component: FilesPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        return result
    },
    component: FilePage,
})

type NewSessionSearch = {
    directory?: string
    machineId?: string
    from?: 'dashboard'
}

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    validateSearch: (search: Record<string, unknown>): NewSessionSearch => {
        const result: NewSessionSearch = {}
        if (typeof search.directory === 'string' && search.directory) {
            result.directory = search.directory
        }
        if (typeof search.machineId === 'string' && search.machineId) {
            result.machineId = search.machineId
        }
        if (search.from === 'dashboard') {
            result.from = 'dashboard'
        }
        return result
    },
    component: NewSessionPage,
})

const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/browse',
    validateSearch: (search: Record<string, unknown>): { machineId?: string } => {
        if (typeof search.machineId === 'string' && search.machineId) {
            return { machineId: search.machineId }
        }
        return {}
    },
    component: BrowsePage,
})

type EditorSearch = {
    machine?: string
    project?: string
}

const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/editor',
    validateSearch: (search: Record<string, unknown>): EditorSearch => {
        const result: EditorSearch = {}
        if (typeof search.machine === 'string' && search.machine) {
            result.machine = search.machine
        }
        if (typeof search.project === 'string' && search.project) {
            result.project = search.project
        }
        return result
    },
    component: EditorPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

const runnersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runners',
    component: RunnersPage,
})

const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: AdminPage,
})

export type TeamChatsSearch = {
    machine?: string
    project?: string
}

const teamChatsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/team-chats',
    validateSearch: (search: Record<string, unknown>): TeamChatsSearch => {
        const result: TeamChatsSearch = {}
        if (typeof search.machine === 'string' && search.machine) {
            result.machine = search.machine
        }
        if (typeof search.project === 'string' && search.project) {
            result.project = search.project
        }
        return result
    },
    component: TeamChatsPage,
})

const teamChatDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/team-chats/$teamChatId',
    component: TeamChatDetailPage,
})


export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    browseRoute,
    editorRoute,
    teamChatsRoute,
    teamChatDetailRoute,
    settingsRoute,
    runnersRoute,
    adminRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
        getScrollRestorationKey,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
