import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getTelegramWebApp, isTelegramApp } from '@/hooks/useTelegram'
import { initializeTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { useServerUrl } from '@/hooks/useServerUrl'
import { useSSE } from '@/hooks/useSSE'
import { useSyncingState } from '@/hooks/useSyncingState'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useViewportHeight } from '@/hooks/useViewportHeight'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'
import { queryKeys } from '@/lib/query-keys'
import { AppContextProvider } from '@/lib/app-context'
import { clearMessageWindow, fetchLatestMessages } from '@/lib/message-window-store'
import { clearToolProgressEntries, recordToolProgress } from '@/chat/toolProgressStore'
import { markSessionSeen } from '@/lib/sessionLastSeen'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useTranslation } from '@/lib/use-translation'
import { VoiceProvider } from '@/lib/voice-context'
import { ActiveChatSessionProvider } from '@/lib/active-chat-session'
import { requireHubUrlForLogin } from '@/lib/runtime-config'
import { getAppGlobalSseSubscription, getAppSessionSseSubscription } from '@/lib/appSseSubscriptions'
import { LoginPrompt } from '@/components/LoginPrompt'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NavBar } from '@/components/NavBar'
import { OfflineBanner } from '@/components/OfflineBanner'
import { SyncingBanner } from '@/components/SyncingBanner'
import { ReconnectingBanner } from '@/components/ReconnectingBanner'
import { VoiceErrorBanner } from '@/components/VoiceErrorBanner'
import { LoadingState } from '@/components/LoadingState'
import { ToastContainer } from '@/components/ToastContainer'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { GlobalModalManager } from '@/components/GlobalModalManager'
import type { SyncEvent } from '@/types/api'

type ToastEvent = Extract<SyncEvent, { type: 'toast' }>

const REQUIRE_SERVER_URL = requireHubUrlForLogin()

export function App() {
    return (
        <ToastProvider>
            <AppInner />
        </ToastProvider>
    )
}

function AppInner() {
    const { t } = useTranslation()
    const { serverUrl, baseUrl, setServerUrl, clearServerUrl } = useServerUrl()
    const { session, api, isLoading: isAuthLoading, error: authError, login, loginWithInvitation, logout } = useAuth(baseUrl)
    const goBack = useAppGoBack()
    const pathname = useLocation({ select: (location) => location.pathname })
    const matchRoute = useMatchRoute()
    const router = useRouter()
    const { addToast } = useToast()

    useEffect(() => {
        const tg = getTelegramWebApp()
        tg?.ready()
        tg?.expand()
        initializeTheme()
    }, [])

    // Track visual viewport height for mobile keyboard avoidance (see useViewportHeight.ts)
    useViewportHeight()

    useEffect(() => {
        const preventDefault = (event: Event) => {
            event.preventDefault()
        }

        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault()
            }
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const modifier = event.ctrlKey || event.metaKey
            if (!modifier) return
            if (event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0') {
                event.preventDefault()
            }
        }

        document.addEventListener('gesturestart', preventDefault as EventListener, { passive: false })
        document.addEventListener('gesturechange', preventDefault as EventListener, { passive: false })
        document.addEventListener('gestureend', preventDefault as EventListener, { passive: false })

        window.addEventListener('wheel', onWheel, { passive: false })
        window.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('gesturestart', preventDefault as EventListener)
            document.removeEventListener('gesturechange', preventDefault as EventListener)
            document.removeEventListener('gestureend', preventDefault as EventListener)

            window.removeEventListener('wheel', onWheel)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    useEffect(() => {
        const tg = getTelegramWebApp()
        const backButton = tg?.BackButton
        if (!backButton) return

        if (pathname === '/' || pathname === '/sessions') {
            backButton.offClick(goBack)
            backButton.hide()
            return
        }

        backButton.show()
        backButton.onClick(goBack)
        return () => {
            backButton.offClick(goBack)
            backButton.hide()
        }
    }, [goBack, pathname])
    const queryClient = useQueryClient()
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId' })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    useEffect(() => {
        if (!selectedSessionId) {
            return
        }
        markSessionSeen(selectedSessionId, Date.now())
    }, [selectedSessionId])
    const [activeEditorSessionId, setActiveEditorSessionId] = useState<string | null>(null)
    const [activeOverlaySessionId, setActiveOverlaySessionId] = useState<string | null>(null)
    const activeChatSessionId = selectedSessionId ?? activeOverlaySessionId ?? (pathname === '/editor' ? activeEditorSessionId : null)
    const { isSyncing, startSync, endSync } = useSyncingState()
    const [sseDisconnected, setSseDisconnected] = useState(false)
    const [sseDisconnectReason, setSseDisconnectReason] = useState<string | null>(null)
    const syncTokenRef = useRef(0)
    const isFirstConnectRef = useRef(true)
    const baseUrlRef = useRef(baseUrl)
    const pushPromptedRef = useRef(false)
    const { isSupported: isPushSupported, permission: pushPermission, requestPermission, subscribe } = usePushNotifications(api)

    useEffect(() => {
        if (baseUrlRef.current === baseUrl) {
            return
        }
        baseUrlRef.current = baseUrl
        isFirstConnectRef.current = true
        syncTokenRef.current = 0
        queryClient.clear()
    }, [baseUrl, queryClient])

    // Clean up URL params after successful auth (for direct access links)
    useEffect(() => {
        if (!session || !api) return
        const { pathname, search, hash, state } = router.history.location
        const searchParams = new URLSearchParams(search)
        if (!searchParams.has('server') && !searchParams.has('hub') && !searchParams.has('token')) {
            return
        }
        searchParams.delete('server')
        searchParams.delete('hub')
        searchParams.delete('token')
        const nextSearch = searchParams.toString()
        const nextHref = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
        router.history.replace(nextHref, state)
    }, [session, api, router])

    useEffect(() => {
        if (!api || !session) {
            pushPromptedRef.current = false
            return
        }
        if (isTelegramApp() || !isPushSupported) {
            return
        }
        if (pushPromptedRef.current) {
            return
        }
        pushPromptedRef.current = true

        const run = async () => {
            if (pushPermission === 'granted') {
                await subscribe()
                return
            }
            if (pushPermission === 'default') {
                const granted = await requestPermission()
                if (granted) {
                    await subscribe()
                }
            }
        }

        void run()
    }, [api, isPushSupported, pushPermission, requestPermission, subscribe, session])

    const handleSseConnect = useCallback(() => {
        // Clear disconnected state on successful connection
        setSseDisconnected(false)
        setSseDisconnectReason(null)

        // Tool heartbeats are only delivered while subscribed to that session, so
        // anything recorded before this connection is unverifiable now, not stale.
        clearToolProgressEntries()

        // Increment token to track this specific connection
        const token = ++syncTokenRef.current

        // Only force show banner on first connect (page load)
        // Subsequent connects (session switches) use non-forced mode
        // which only shows banner when returning from background
        if (isFirstConnectRef.current) {
            isFirstConnectRef.current = false
            startSync({ force: true })
        } else {
            startSync()
        }
        const invalidations = [
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            ...(activeChatSessionId ? [
                queryClient.invalidateQueries({ queryKey: queryKeys.session(activeChatSessionId) })
            ] : [])
        ]
        const refreshMessages = (activeChatSessionId && api)
            ? fetchLatestMessages(api, activeChatSessionId, { mergeStrategy: 'visible' })
            : Promise.resolve()
        Promise.all([...invalidations, refreshMessages])
            .catch((error) => {
                console.error('Failed to invalidate queries on SSE connect:', error)
            })
            .finally(() => {
                // Only end sync if this is still the latest connection
                if (syncTokenRef.current === token) {
                    endSync()
                }
            })
    }, [activeChatSessionId, api, queryClient, startSync, endSync])

    const handleSseDisconnect = useCallback((reason: string) => {
        // Only show reconnecting banner if we've already connected once
        if (!isFirstConnectRef.current) {
            setSseDisconnected(true)
            setSseDisconnectReason(reason)
        }
    }, [])

    const handleSseEvent = useCallback((event: SyncEvent) => {
        if (event.type === 'tool-progress') {
            // Ephemeral: goes to the tool-progress store only, never into query
            // caches or the message window.
            recordToolProgress(event.sessionId, event.toolUseId, {
                elapsedSeconds: event.elapsedSeconds ?? null
            })
            return
        }
        if (event.type === 'shared-hub-updated') {
            window.dispatchEvent(new CustomEvent('hapi:shared-hub-updated', { detail: event }))
            return
        }
        if (event.type === 'team-mention-updated') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessionTeamMentions(event.sessionId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamMentionRequestsBase })
            return
        }
        if (event.type === 'team-message-created') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamMessages(event.teamChatId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat(event.teamChatId) })
            return
        }
        if (event.type === 'team-participant-updated') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamParticipants(event.teamChatId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessionTeamMembershipsBase })
            return
        }
        if (event.type === 'team-chat-updated') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamChats })
            void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat(event.teamChatId) })
            return
        }
        if (event.type !== 'messages-invalidated') {
            return
        }
        if (!api || event.sessionId !== activeChatSessionId) {
            return
        }
        clearMessageWindow(event.sessionId)
        void fetchLatestMessages(api, event.sessionId, { mergeStrategy: 'visible' })
    }, [activeChatSessionId, api])

    const translateIncomingToast = useCallback((title: string, body: string): { title: string; body: string } => {
        const normalizedTitle = title.trim()
        const normalizedBody = body.trim()

        if (normalizedTitle === 'Ready for input') {
            const waitingMatch = normalizedBody.match(/^(.+)\s+is waiting in\s+(.+)$/i)
            if (waitingMatch) {
                const agent = waitingMatch[1]?.trim() ?? ''
                const sessionName = waitingMatch[2]?.trim() ?? ''
                return {
                    title: t('toast.ready.title'),
                    body: t('toast.ready.body', { agent, session: sessionName })
                }
            }
            return {
                title: t('toast.ready.title'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Permission Request') {
            return {
                title: t('toast.permission.title'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Task completed') {
            return {
                title: t('toast.task.completed'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Task failed') {
            return {
                title: t('toast.task.failed'),
                body: normalizedBody
            }
        }

        return { title, body }
    }, [t])
    const handleToast = useCallback((event: ToastEvent) => {
        const localized = translateIncomingToast(event.data.title, event.data.body)
        addToast({
            title: localized.title,
            body: localized.body,
            sessionId: event.data.sessionId,
            url: event.data.url
        })
    }, [addToast, translateIncomingToast])

    const globalEventSubscription = useMemo(() => getAppGlobalSseSubscription(), [])
    const sessionEventSubscription = useMemo(
    }, [selectedSessionId])
    const sseEnabled = Boolean(api && token)

    const { subscriptionId: globalSubscriptionId } = useSSE({
        enabled: Boolean(api && session),
        baseUrl,
        cacheScopeId: session ? `${session.organizationId}:${session.membershipId}` : undefined,
        subscription: globalEventSubscription,
        scope: 'global',
        onConnect: handleSseConnect,
        onDisconnect: handleSseDisconnect,
        onEvent: () => {},
        onToast: handleToast
    })

    const { subscriptionId: sessionSubscriptionId } = useSSE({
        enabled: Boolean(api && session) && Boolean(sessionEventSubscription),
        baseUrl,
        cacheScopeId: session ? `${session.organizationId}:${session.membershipId}` : undefined,
        subscription: sessionEventSubscription ?? undefined,
        scope: 'full',
        onEvent: handleSseEvent
    })

    useVisibilityReporter({
        api,
        subscriptionId: globalSubscriptionId,
        enabled: sseEnabled
    })

    useVisibilityReporter({
        api,
        subscriptionId: sessionSubscriptionId,
        enabled: sseEnabled && Boolean(sessionEventSubscription)
>>>>>>> 9af6696a (fix(web): keep global SSE alive for session list status updates (#694))
    })

    // Loading auth
    if (isAuthLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>
        )
    }

    // Not authenticated — show login
    if (!session) {
        return (
            <LoginPrompt
                isLoading={isAuthLoading}
                error={authError}
                onLogin={login}
                onLoginWithInvitation={loginWithInvitation}
            />
        )
    }

    // Auth error — show login with error
    if (authError) {
        return (
            <LoginPrompt
                isLoading={isAuthLoading}
                error={authError}
                onLogin={login}
                onLoginWithInvitation={loginWithInvitation}
            />
        )
    }

    return (
        <AppContextProvider value={{ api: api!, baseUrl, role: session?.role ?? 'member' }}>
            <ActiveChatSessionProvider value={{ setActiveEditorSessionId, setActiveOverlaySessionId }}>
                <VoiceProvider>
                    <SyncingBanner isSyncing={isSyncing} />
                    <ReconnectingBanner
                        isReconnecting={sseDisconnected && !isSyncing}
                        reason={sseDisconnectReason}
                    />
                    <VoiceErrorBanner />
                    <OfflineBanner />
                    <div className="h-full min-h-0 flex flex-col">
                        <NavBar session={session!} />
                        <Outlet />
                    </div>
                    <GlobalModalManager />
                    <ToastContainer />
                    <InstallPrompt />
                </VoiceProvider>
            </ActiveChatSessionProvider>
        </AppContextProvider>
    )
}
