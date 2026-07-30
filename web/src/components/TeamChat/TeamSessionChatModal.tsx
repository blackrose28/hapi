import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { SessionChat } from '@/components/SessionChat'
import { LoadingState } from '@/components/LoadingState'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useMessages } from '@/hooks/queries/useMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useRegisterActiveOverlaySession } from '@/lib/active-chat-session'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import type { AttachmentMetadata, Session } from '@/types/api'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogHeader,
} from '@/components/ui/app-dialog'

function getSessionTitle(session: Session): string {
    return session.metadata?.name
        ?? session.metadata?.summary?.text
        ?? session.metadata?.path
        ?? session.id.slice(0, 8)
}

function getPendingRequestCount(session: Session): number {
    return session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0
}

function getSessionStatus(session: Session): {
    label: string
    dotClassName: string
    pillClassName: string
} {
    if (getPendingRequestCount(session) > 0) {
        return {
            label: 'Needs input',
            dotClassName: 'bg-amber-400',
            pillClassName: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        }
    }
    if (session.thinking) {
        return {
            label: 'Working',
            dotClassName: 'bg-sky-400',
            pillClassName: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        }
    }
    if (session.active) {
        return {
            label: 'Active',
            dotClassName: 'bg-emerald-400',
            pillClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        }
    }
    return {
        label: 'Idle',
        dotClassName: 'bg-[var(--app-border)]',
        pillClassName: 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
    }
}

function getSessionMetaLine(session: Session): string {
    return [
        session.model,
        session.effort ? `${session.effort} effort` : null,
        session.metadata?.path
    ].filter((item): item is string => Boolean(item)).join(' · ')
}

export function TeamSessionChatModal(props: {
    api: ApiClient
    sessionId: string
    alias: string
    onClose: () => void
    onOpenFullSession: (sessionId: string) => void
}) {
    const [activeSessionId, setActiveSessionId] = useState(props.sessionId)
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const {
        session,
        isLoading,
        error,
        refetch: refetchSession,
    } = useSession(props.api, activeSessionId)
    const messagesState = useMessages(props.api, activeSessionId)
    const agentType = session?.metadata?.flavor ?? 'claude'
    const slashCommands = useSlashCommands(props.api, activeSessionId, agentType)
    const skills = useSkills(props.api, activeSessionId)
    useRegisterActiveOverlaySession(activeSessionId)

    useEffect(() => {
        setActiveSessionId(props.sessionId)
    }, [props.sessionId])

    const { sendMessage, retryMessage, isSending } = useSendMessage(props.api, activeSessionId, {
        isSessionThinking: session?.thinking ?? false,
        onSuccess: (sentSessionId) => {
            clearDraftsAfterSend(sentSessionId, activeSessionId)
        },
        resolveSessionId: async (currentSessionId) => {
            if (!session || session.active) {
                return currentSessionId
            }
            try {
                return await props.api.resumeSession(currentSessionId, { permissionMode: session.permissionMode ?? undefined })
            } catch (resumeError) {
                const message = resumeError instanceof Error ? resumeError.message : 'Resume failed'
                addToast({
                    title: 'Resume failed',
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw resumeError
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            if (resolvedSessionId === activeSessionId) {
                return
            }
            if (session) {
                seedMessageWindowFromSession(session.id, resolvedSessionId)
                queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                    session: { ...session, id: resolvedSessionId, active: true }
                })
            }
            setActiveSessionId(resolvedSessionId)
            void Promise.all([
                queryClient.prefetchQuery({
                    queryKey: queryKeys.session(resolvedSessionId),
                    queryFn: () => props.api.getSession(resolvedSessionId),
                }),
                fetchLatestMessages(props.api, resolvedSessionId),
            ]).catch(() => {})
        },
        onBlocked: (reason) => {
            if (reason !== 'no-api') return
            addToast({
                title: 'Cannot send message',
                body: 'Hub connection is unavailable.',
                sessionId: activeSessionId,
                url: ''
            })
        }
    })

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await skills.getSuggestions(query)
        }
        return await slashCommands.getSuggestions(query)
    }, [skills, slashCommands])

    const refreshSession = useCallback(() => {
        void refetchSession()
        void messagesState.refetch()
    }, [messagesState, refetchSession])

    const status = useMemo(() => session ? getSessionStatus(session) : null, [session])
    const title = session ? getSessionTitle(session) : props.alias
    const metaLine = session ? getSessionMetaLine(session) : ''

    return (
        <AppDialog open onOpenChange={(open) => !open && props.onClose()}>
            <AppDialogContent
                presentation="workspace"
                className="h-[min(92vh,900px)] w-[min(1120px,calc(100vw-1rem))] max-w-none text-[var(--app-fg)] sm:w-[min(1120px,calc(100vw-2rem))]"
            >
                <AppDialogHeader
                    title={`Direct chat with @${props.alias}`}
                    subtitle={(
                        <span className="flex min-w-0 items-center gap-1">
                            <span className="shrink-0">{title}</span>
                            <span aria-hidden="true">·</span>
                            <span>Messages here go only to this session, not the Team Chat.</span>
                            {metaLine ? <span className="truncate"> · {metaLine}</span> : null}
                        </span>
                    )}
                    meta={status ? (
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', status.pillClassName)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', status.dotClassName, session?.thinking ? 'animate-pulse' : '')} />
                            {status.label}
                        </span>
                    ) : null}
                    actions={(
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={() => props.onOpenFullSession(activeSessionId)}
                                className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Open full session
                            </button>
                        </div>
                    )}
                    closeLabel="Close direct chat"
                    mobileNavigation="back"
                    mobileBackLabel="Back to Team Chat"
                    onMobileBack={props.onClose}
                    className="sm:pl-4"
                />

                <AppDialogBody>
                    {isLoading ? (
                        <div className="flex h-full items-center justify-center p-4">
                            <LoadingState label="Loading direct chat…" className="text-sm" />
                        </div>
                    ) : error || !session ? (
                        <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
                            {error ?? 'Direct chat unavailable'}
                        </div>
                    ) : (
                        <SessionChat
                            key={session.id}
                            api={props.api}
                            session={session}
                            messages={messagesState.messages}
                            messagesWarning={messagesState.warning}
                            hasMoreMessages={messagesState.hasMore}
                            isLoadingMessages={messagesState.isLoading}
                            isLoadingMoreMessages={messagesState.isLoadingMore}
                            isSending={isSending}
                            pendingCount={messagesState.pendingCount}
                            messagesVersion={messagesState.messagesVersion}
                            onBack={props.onClose}
                            onRefresh={refreshSession}
                            onLoadMore={messagesState.loadMore}
                            onSend={(text: string, attachments?: AttachmentMetadata[]) => sendMessage(text, attachments)}
                            onFlushPending={messagesState.flushPending}
                            onAtBottomChange={messagesState.setAtBottom}
                            onRetryMessage={retryMessage}
                            autocompleteSuggestions={getAutocompleteSuggestions}
                            availableSlashCommands={slashCommands.commands}
                            hideHeader={true}
                            compactMode={false}
                            disableVoice={true}
                        />
                    )}
                </AppDialogBody>
            </AppDialogContent>
        </AppDialog>
    )
}
