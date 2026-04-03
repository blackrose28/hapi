import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ThreadPrimitive } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

const DEBUG_SCROLL_MODE = true

function NewMessagesIndicator(props: { count: number; onClick: () => void }) {
    const { t } = useTranslation()
    if (props.count === 0) {
        return null
    }

    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-sm font-medium shadow-lg animate-bounce-in z-10"
        >
            {t('misc.newMessage', { n: props.count })} &#8595;
        </button>
    )
}

function MessageSkeleton() {
    const { t } = useTranslation()
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('misc.loadingMessages')}</span>
            <div className="space-y-3 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

export function HappyThread(props: {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    pendingCount: number
    rawMessagesCount: number
    normalizedMessagesCount: number
    messagesVersion: number
    forceScrollToken: number
}) {
    const { t } = useTranslation()
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const topSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const pendingScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
    const prevLoadingMoreRef = useRef(false)
    const loadStartedRef = useRef(false)
    const isLoadingMoreRef = useRef(props.isLoadingMoreMessages)
    const hasMoreMessagesRef = useRef(props.hasMoreMessages)
    const isLoadingMessagesRef = useRef(props.isLoadingMessages)
    const onLoadMoreRef = useRef(props.onLoadMore)
    const handleLoadMoreRef = useRef<() => void>(() => {})
    const atBottomRef = useRef(true)
    const onAtBottomChangeRef = useRef(props.onAtBottomChange)
    const onFlushPendingRef = useRef(props.onFlushPending)
    const forceScrollTokenRef = useRef(props.forceScrollToken)
    const initialScrollDoneRef = useRef(false)
    const lastScrollTopRef = useRef(0)
    const settleRafRef = useRef<number | null>(null)
    const settleDeadlineRef = useRef(0)
    const settleLastHeightRef = useRef(0)
    const settleStableFramesRef = useRef(0)
    const openLockActiveRef = useRef(false)
    const sendSettleRafRef = useRef<number | null>(null)
    const sendSettleDeadlineRef = useRef(0)
    const sendSettleLastHeightRef = useRef(0)

    // Smart scroll state: autoScroll enabled when user is near bottom
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const autoScrollEnabledRef = useRef(autoScrollEnabled)

    // Keep refs in sync with state
    useEffect(() => {
        autoScrollEnabledRef.current = autoScrollEnabled
    }, [autoScrollEnabled])
    useEffect(() => {
        onAtBottomChangeRef.current = props.onAtBottomChange
    }, [props.onAtBottomChange])
    useEffect(() => {
        onFlushPendingRef.current = props.onFlushPending
    }, [props.onFlushPending])
    useEffect(() => {
        hasMoreMessagesRef.current = props.hasMoreMessages
    }, [props.hasMoreMessages])
    useEffect(() => {
        isLoadingMessagesRef.current = props.isLoadingMessages
    }, [props.isLoadingMessages])
    useEffect(() => {
        onLoadMoreRef.current = props.onLoadMore
    }, [props.onLoadMore])

    const cancelSettledScroll = useCallback(() => {
        if (settleRafRef.current !== null) {
            cancelAnimationFrame(settleRafRef.current)
            settleRafRef.current = null
        }
    }, [])

    const cancelOpenLock = useCallback((reason?: string) => {
        if (openLockActiveRef.current && DEBUG_SCROLL_MODE) {
            console.log('[HappyThread] mode=normal', { sessionId: props.sessionId, reason: reason ?? 'unknown' })
        }
        openLockActiveRef.current = false
    }, [props.sessionId])

    const cancelSendSettle = useCallback(() => {
        if (sendSettleRafRef.current !== null) {
            cancelAnimationFrame(sendSettleRafRef.current)
            sendSettleRafRef.current = null
        }
    }, [])

    const startSendSettledScrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }

        cancelSendSettle()
        if (DEBUG_SCROLL_MODE) {
            console.log('[HappyThread] sendScrollToBottom', { sessionId: props.sessionId, behavior })
        }

        sendSettleDeadlineRef.current = performance.now() + 1200
        sendSettleLastHeightRef.current = viewport.scrollHeight
        const tick = () => {
            const nextViewport = viewportRef.current
            if (!nextViewport) {
                sendSettleRafRef.current = null
                return
            }

            nextViewport.scrollTo({ top: nextViewport.scrollHeight, behavior: 'instant' })
            if (!atBottomRef.current) {
                atBottomRef.current = true
                onAtBottomChangeRef.current(true)
            }
            onFlushPendingRef.current()

            const height = nextViewport.scrollHeight
            if (height !== sendSettleLastHeightRef.current) {
                sendSettleLastHeightRef.current = height
                sendSettleDeadlineRef.current = performance.now() + 1200
            }

            if (performance.now() >= sendSettleDeadlineRef.current) {
                sendSettleRafRef.current = null
                return
            }

            sendSettleRafRef.current = requestAnimationFrame(tick)
        }

        viewport.scrollTo({ top: viewport.scrollHeight, behavior })
        if (!atBottomRef.current) {
            atBottomRef.current = true
            onAtBottomChangeRef.current(true)
        }
        onFlushPendingRef.current()
        sendSettleRafRef.current = requestAnimationFrame(tick)
    }, [cancelSendSettle, props.sessionId])

    const startSettledScrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }

        cancelSettledScroll()
        if (DEBUG_SCROLL_MODE) {
            console.log('[HappyThread] settledScrollToBottom', { sessionId: props.sessionId, behavior })
        }
        setAutoScrollEnabled(true)
        settleDeadlineRef.current = performance.now() + 1200
        settleLastHeightRef.current = viewport.scrollHeight
        settleStableFramesRef.current = 0

        const tick = () => {
            const nextViewport = viewportRef.current
            if (!nextViewport) {
                settleRafRef.current = null
                return
            }

            nextViewport.scrollTo({ top: nextViewport.scrollHeight, behavior: 'instant' })
            if (!atBottomRef.current) {
                atBottomRef.current = true
                onAtBottomChangeRef.current(true)
            }
            onFlushPendingRef.current()

            const height = nextViewport.scrollHeight
            if (height === settleLastHeightRef.current) {
                settleStableFramesRef.current += 1
            } else {
                settleStableFramesRef.current = 0
                settleLastHeightRef.current = height
            }

            if (performance.now() >= settleDeadlineRef.current || settleStableFramesRef.current >= 4) {
                settleRafRef.current = null
                return
            }

            settleRafRef.current = requestAnimationFrame(tick)
        }

        viewport.scrollTo({ top: viewport.scrollHeight, behavior })
        if (!atBottomRef.current) {
            atBottomRef.current = true
            onAtBottomChangeRef.current(true)
        }
        onFlushPendingRef.current()
        settleRafRef.current = requestAnimationFrame(tick)
    }, [cancelOpenLock, cancelSendSettle, cancelSettledScroll])

    // Track scroll position and cancel settled scroll on upward user intent.
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const THRESHOLD_PX = 120
        lastScrollTopRef.current = viewport.scrollTop

        const handleScroll = () => {
            const currentTop = viewport.scrollTop
            const distanceFromBottom = viewport.scrollHeight - currentTop - viewport.clientHeight
            const isNearBottom = distanceFromBottom < THRESHOLD_PX
            const isScrollingUp = currentTop < lastScrollTopRef.current

            if (isScrollingUp) {
                cancelSettledScroll()
                cancelSendSettle()
                cancelOpenLock('scroll-up')
            }

            if (isNearBottom) {
                if (!autoScrollEnabledRef.current) setAutoScrollEnabled(true)
            } else if (autoScrollEnabledRef.current) {
                setAutoScrollEnabled(false)
            }

            if (isNearBottom !== atBottomRef.current) {
                atBottomRef.current = isNearBottom
                onAtBottomChangeRef.current(isNearBottom)
                if (isNearBottom) {
                    onFlushPendingRef.current()
                }
            }

            lastScrollTopRef.current = currentTop
        }

        handleScroll()
        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => viewport.removeEventListener('scroll', handleScroll)
    }, [cancelOpenLock, cancelSendSettle, cancelSettledScroll])

    // Reset state when session changes
    useEffect(() => {
        setAutoScrollEnabled(true)
        atBottomRef.current = true
        onAtBottomChangeRef.current(true)
        forceScrollTokenRef.current = props.forceScrollToken
        initialScrollDoneRef.current = false
    }, [props.sessionId])

    useEffect(() => {
        initialScrollDoneRef.current = false
        openLockActiveRef.current = false
    }, [props.sessionId])

    useEffect(() => {
        if (initialScrollDoneRef.current) {
            return
        }
        if (props.isLoadingMessages) {
            return
        }

        initialScrollDoneRef.current = true
        openLockActiveRef.current = true
        if (DEBUG_SCROLL_MODE) {
            console.log('[HappyThread] mode=scrollToBottomLock', { sessionId: props.sessionId, reason: 'initial-open' })
        }

        const viewport = viewportRef.current
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' })
            if (!atBottomRef.current) {
                atBottomRef.current = true
                onAtBottomChangeRef.current(true)
            }
            onFlushPendingRef.current()
        }
    }, [props.sessionId, props.isLoadingMessages])

    useEffect(() => {
        if (!openLockActiveRef.current) {
            return
        }

        const content = contentRef.current
        const viewport = viewportRef.current
        const handleKeyDown = () => cancelOpenLock('keydown')
        const snapToBottom = () => {
            if (!openLockActiveRef.current) {
                return
            }
            const nextViewport = viewportRef.current
            if (!nextViewport) {
                return
            }
            nextViewport.scrollTo({ top: nextViewport.scrollHeight, behavior: 'instant' })
            if (!atBottomRef.current) {
                atBottomRef.current = true
                onAtBottomChangeRef.current(true)
            }
            onFlushPendingRef.current()
        }

        window.addEventListener('keydown', handleKeyDown)

        if (viewport) {
            snapToBottom()
        }

        if (!content || typeof ResizeObserver === 'undefined') {
            return () => {
                window.removeEventListener('keydown', handleKeyDown)
            }
        }

        const observer = new ResizeObserver(() => {
            snapToBottom()
        })
        observer.observe(content)

        return () => {
            observer.disconnect()
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [props.sessionId, props.messagesVersion, cancelOpenLock])

    useEffect(() => {
        if (forceScrollTokenRef.current === props.forceScrollToken) {
            return
        }
        console.log('[HappyThread] forceScrollToken changed', {
            sessionId: props.sessionId,
            from: forceScrollTokenRef.current,
            to: props.forceScrollToken
        })
        forceScrollTokenRef.current = props.forceScrollToken
        startSendSettledScrollToBottom('instant')
    }, [props.forceScrollToken, startSendSettledScrollToBottom])

    const handleLoadMore = useCallback(() => {
        if (isLoadingMessagesRef.current || !hasMoreMessagesRef.current || isLoadingMoreRef.current || loadLockRef.current) {
            return
        }
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        pendingScrollRef.current = {
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight
        }
        loadLockRef.current = true
        loadStartedRef.current = false
        let loadPromise: Promise<unknown>
        try {
            loadPromise = onLoadMoreRef.current()
        } catch (error) {
            pendingScrollRef.current = null
            loadLockRef.current = false
            throw error
        }
        void loadPromise.catch((error) => {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
        }).finally(() => {
            if (!loadStartedRef.current && !isLoadingMoreRef.current && pendingScrollRef.current) {
                pendingScrollRef.current = null
                loadLockRef.current = false
            }
        })
    }, [])

    useEffect(() => {
        handleLoadMoreRef.current = handleLoadMore
    }, [handleLoadMore])

    useEffect(() => {
        const sentinel = topSentinelRef.current
        const viewport = viewportRef.current
        if (!sentinel || !viewport || !props.hasMoreMessages || props.isLoadingMessages) {
            return
        }
        if (typeof IntersectionObserver === 'undefined') {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        handleLoadMoreRef.current()
                    }
                }
            },
            {
                root: viewport,
                rootMargin: '200px 0px 0px 0px'
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [props.hasMoreMessages, props.isLoadingMessages])

    useEffect(() => {
        return () => {
            cancelOpenLock('cleanup')
            cancelSendSettle()
            cancelSettledScroll()
        }
    }, [cancelOpenLock, cancelSendSettle, cancelSettledScroll])

    useLayoutEffect(() => {
        const pending = pendingScrollRef.current
        const viewport = viewportRef.current
        if (!pending || !viewport) {
            return
        }
        const delta = viewport.scrollHeight - pending.scrollHeight
        viewport.scrollTop = pending.scrollTop + delta
        pendingScrollRef.current = null
        loadLockRef.current = false
    }, [props.messagesVersion, props.sessionId])

    useEffect(() => {
        isLoadingMoreRef.current = props.isLoadingMoreMessages
        if (props.isLoadingMoreMessages) {
            loadStartedRef.current = true
        }
        if (prevLoadingMoreRef.current && !props.isLoadingMoreMessages && pendingScrollRef.current) {
            pendingScrollRef.current = null
            loadLockRef.current = false
        }
        prevLoadingMoreRef.current = props.isLoadingMoreMessages
    }, [props.isLoadingMoreMessages])

    const showSkeleton = props.isLoadingMessages && props.rawMessagesCount === 0 && props.pendingCount === 0

    return (
        <HappyChatProvider value={{
            api: props.api,
            sessionId: props.sessionId,
            metadata: props.metadata,
            disabled: props.disabled,
            onRefresh: props.onRefresh,
            onRetryMessage: props.onRetryMessage
        }}>
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col relative">
                <ThreadPrimitive.Viewport
                    asChild
                    autoScroll={false}
                    scrollToBottomOnRunStart={false}
                    scrollToBottomOnInitialize={false}
                    scrollToBottomOnThreadSwitch={false}
                >
                    <div ref={viewportRef} className="app-scroll-y min-h-0 flex-1 overflow-x-hidden">
                        <div ref={contentRef} className="mx-auto w-full max-w-content min-w-0 p-3">
                            <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />
                            {showSkeleton ? (
                                <MessageSkeleton />
                            ) : (
                                <>
                                    {props.messagesWarning ? (
                                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                            {props.messagesWarning}
                                        </div>
                                    ) : null}

                                    {props.hasMoreMessages && !props.isLoadingMessages ? (
                                        <div className="py-1 mb-2">
                                            <div className="mx-auto w-fit">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleLoadMore}
                                                    disabled={props.isLoadingMoreMessages || props.isLoadingMessages}
                                                    aria-busy={props.isLoadingMoreMessages}
                                                    className="gap-1.5 text-xs opacity-80 hover:opacity-100"
                                                >
                                                    {props.isLoadingMoreMessages ? (
                                                        <>
                                                            <Spinner size="sm" label={null} className="text-current" />
                                                            {t('misc.loading')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span aria-hidden="true">↑</span>
                                                            {t('misc.loadOlder')}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    {import.meta.env.DEV && props.normalizedMessagesCount === 0 && props.rawMessagesCount > 0 ? (
                                        <div className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs">
                                            Message normalization returned 0 items for {props.rawMessagesCount} messages (see `web/src/chat/normalize.ts`).
                                        </div>
                                    ) : null}
                                </>
                            )}
                            <div className="happy-thread-messages flex flex-col gap-3">
                                <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
                            </div>
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                <NewMessagesIndicator count={props.pendingCount} onClick={() => startSettledScrollToBottom('smooth')} />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
