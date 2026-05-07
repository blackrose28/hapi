import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, MessageStatus } from '@/types/api'
import {
    appendOptimisticMessage,
    clearMessageWindow,
    fetchLatestMessages,
    fetchOlderMessages,
    getMessageWindowState,
    ingestIncomingMessages,
    markMessagesConsumed,
    removeOptimisticMessage,
    setAtBottom,
    VISIBLE_WINDOW_SIZE,
    updateMessageStatus,
} from '@/lib/message-window-store'

const SESSION_ID = 'session-message-window-store-test'

function makeUserMessage(props: {
    id: string
    localId?: string
    status?: MessageStatus
    text?: string
    createdAt?: number
}): DecryptedMessage {
    return {
        id: props.id,
        seq: null,
        localId: props.localId ?? null,
        content: {
            role: 'user',
            content: {
                type: 'text',
                text: props.text ?? 'hello',
            },
        },
        createdAt: props.createdAt ?? Date.now(),
        status: props.status,
        originalText: props.text ?? 'hello',
    } as DecryptedMessage
}


function makeAgentMessage(props: {
    id: string
    seq?: number | null
    createdAt?: number
    text?: string
}): DecryptedMessage {
    return {
        id: props.id,
        seq: props.seq ?? null,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: props.text ?? 'agent text'
                }
            }
        },
        createdAt: props.createdAt ?? Date.now(),
        invokedAt: props.createdAt ?? Date.now()
    } as DecryptedMessage
}

function makeAgentRunMessage(props: {
    id: string
    seq?: number | null
    createdAt?: number
    eventType?: 'agent-run-start' | 'agent-run-update' | 'agent-run-trace'
}): DecryptedMessage {
    const eventType = props.eventType ?? 'agent-run-update'
    return {
        id: props.id,
        seq: props.seq ?? null,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: eventType,
                    cardId: 'spawn-1',
                    agentId: 'agent-1',
                    status: 'running',
                    activity: 'Running'
                }
            }
        },
        createdAt: props.createdAt ?? Date.now(),
        invokedAt: props.createdAt ?? Date.now()
    } as DecryptedMessage
}

function makeAgentMessagePage(props: {
    idPrefix: string
    startSeq: number
    count: number
    startCreatedAt: number
}): DecryptedMessage[] {
    return Array.from({ length: props.count }, (_, index) => makeAgentMessage({
        id: `${props.idPrefix}-${index}`,
        seq: props.startSeq + index,
        createdAt: props.startCreatedAt + index,
    }))
}

describe('removeOptimisticMessage', () => {
    const SESSION = 'test-session-remove'

    afterEach(() => {
        clearMessageWindow(SESSION)
    })

    it('removes a message matched by localId from the messages list', () => {
        const msg = makeMsg({ id: 'msg-a', localId: 'local-a' })
        appendOptimisticMessage(SESSION, msg)

        removeOptimisticMessage(SESSION, 'local-a')

        const state = getMessageWindowState(SESSION)
        expect(state.messages.find((m) => m.id === 'msg-a')).toBeUndefined()
    })

    it('removes a message matched by id (when localId equals id)', () => {
        const msg = makeMsg({ id: 'msg-b', localId: 'msg-b' })
        appendOptimisticMessage(SESSION, msg)

        removeOptimisticMessage(SESSION, 'msg-b')

        const state = getMessageWindowState(SESSION)
        expect(state.messages).toHaveLength(0)
    })

    it('is a no-op when localId does not match any message', () => {
        const msg = makeMsg({ id: 'msg-c', localId: 'local-c' })
        appendOptimisticMessage(SESSION, msg)

        removeOptimisticMessage(SESSION, 'nonexistent')

        const state = getMessageWindowState(SESSION)
        expect(state.messages).toHaveLength(1)
    })

    it('is a no-op when called with an empty string', () => {
        const msg = makeMsg({ id: 'msg-d', localId: 'local-d' })
        appendOptimisticMessage(SESSION, msg)

        removeOptimisticMessage(SESSION, '')

        const state = getMessageWindowState(SESSION)
        expect(state.messages).toHaveLength(1)
    })

    it('does not remove other messages when removing one', () => {
        const msgA = makeMsg({ id: 'msg-e1', localId: 'local-e1' })
        const msgB = makeMsg({ id: 'msg-e2', localId: 'local-e2' })
        appendOptimisticMessage(SESSION, msgA)
        appendOptimisticMessage(SESSION, msgB)

        removeOptimisticMessage(SESSION, 'local-e1')

        const state = getMessageWindowState(SESSION)
        expect(state.messages.find((m) => m.id === 'msg-e1')).toBeUndefined()
        expect(state.messages.find((m) => m.id === 'msg-e2')).toBeDefined()
    })

    it('is idempotent: second call is a no-op', () => {
        const msg = makeMsg({ id: 'msg-f', localId: 'local-f' })
        appendOptimisticMessage(SESSION, msg)

        removeOptimisticMessage(SESSION, 'local-f')
        removeOptimisticMessage(SESSION, 'local-f')

        const state = getMessageWindowState(SESSION)
        expect(state.messages).toHaveLength(0)
    })
})

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('message-window-store async generations', () => {
    const SESSION_ID = 'session-message-window-generation-test'

    afterEach(() => {
        clearMessageWindow(SESSION_ID)
        sessionStorage.clear()
    })

    it('does not let a stale failed retry overwrite a newer reset-and-reload state', async () => {
        const firstRequest = deferred<Awaited<ReturnType<ApiClient['getMessages']>>>()
        const api = {
            getMessages: vi.fn(async (_sessionId: string) => {
                if (api.getMessages.mock.calls.length === 1) {
                    return await firstRequest.promise
                }
                return {
                    messages: [
                        makeAgentMessage({
                            id: 'fresh-message',
                            seq: 10,
                            createdAt: 1_700_000_300_000
                        })
                    ],
                    page: {
                        limit: 50,
                        nextBeforeSeq: null,
                        nextBeforeAt: null,
                        hasMore: false
                    }
                }
            })
        } as Pick<ApiClient, 'getMessages'> & {
            getMessages: ReturnType<typeof vi.fn>
        }

        const staleLoad = fetchLatestMessages(api as unknown as ApiClient, SESSION_ID)
        clearMessageWindow(SESSION_ID)
        await fetchLatestMessages(api as unknown as ApiClient, SESSION_ID)

        firstRequest.reject(new Error('stale failure'))
        await staleLoad

        const state = getMessageWindowState(SESSION_ID)
        expect(state.warning).toBeNull()
        expect(state.messages.map((message) => message.id)).toEqual(['fresh-message'])
    })

    it('hydrates persisted window state for progressive re-entry', async () => {
        ingestIncomingMessages(SESSION_ID, [
            makeAgentMessage({
                id: 'persisted-message',
                seq: 11,
                createdAt: 1_700_000_301_000
            })
        ])

        await new Promise((resolve) => setTimeout(resolve, 250))
        vi.resetModules()

        const reloadedStore = await import('@/lib/message-window-store')
        const state = reloadedStore.getMessageWindowState(SESSION_ID)

        expect(state.messages.map((message) => message.id)).toEqual(['persisted-message'])
        reloadedStore.clearMessageWindow(SESSION_ID)
    })

    it('does not let a latest refresh wedge an in-flight older load', async () => {
        const latestPage = makeAgentMessagePage({
            idPrefix: 'latest',
            startSeq: 101,
            count: 50,
            startCreatedAt: 1_700_000_400_000,
        })
        const olderPage = makeAgentMessagePage({
            idPrefix: 'older',
            startSeq: 51,
            count: 50,
            startCreatedAt: 1_700_000_300_000,
        })
        const oldestPage = makeAgentMessagePage({
            idPrefix: 'oldest',
            startSeq: 1,
            count: 50,
            startCreatedAt: 1_700_000_200_000,
        })
        const olderRequest = deferred<Awaited<ReturnType<ApiClient['getMessages']>>>()
        const callLog: Array<{ beforeAt?: number | null; beforeSeq?: number | null; byPosition?: boolean; limit?: number }> = []
        const api = {
            getMessages: vi.fn(async (_sessionId: string, options: { beforeAt?: number | null; beforeSeq?: number | null; byPosition?: boolean; limit?: number } = {}) => {
                callLog.push(options)
                const callIndex = callLog.length
                if (callIndex === 1 || callIndex === 3) {
                    return {
                        messages: latestPage,
                        page: {
                            limit: options.limit ?? 50,
                            nextBeforeSeq: 101,
                            nextBeforeAt: 1_700_000_400_000,
                            hasMore: true,
                        }
                    }
                }
                if (callIndex === 2) {
                    return await olderRequest.promise
                }
                return {
                    messages: oldestPage,
                    page: {
                        limit: options.limit ?? 50,
                        nextBeforeSeq: null,
                        nextBeforeAt: null,
                        hasMore: false,
                    }
                }
            })
        } as Pick<ApiClient, 'getMessages'> & {
            getMessages: ReturnType<typeof vi.fn>
        }

        await fetchLatestMessages(api as unknown as ApiClient, SESSION_ID)

        const olderLoad = fetchOlderMessages(api as unknown as ApiClient, SESSION_ID)
        await Promise.resolve()
        expect(getMessageWindowState(SESSION_ID).isLoadingMore).toBe(true)

        setAtBottom(SESSION_ID, false)
        await fetchLatestMessages(api as unknown as ApiClient, SESSION_ID)

        olderRequest.resolve({
            messages: olderPage,
            page: {
                limit: 50,
                nextBeforeSeq: 51,
                nextBeforeAt: 1_700_000_300_000,
                hasMore: true,
            }
        })
        await olderLoad

        const recoveredState = getMessageWindowState(SESSION_ID)
        expect(recoveredState.isLoadingMore).toBe(false)
        expect(recoveredState.messages.some((message) => message.id === 'older-0')).toBe(true)

        await fetchOlderMessages(api as unknown as ApiClient, SESSION_ID)

        const finalState = getMessageWindowState(SESSION_ID)
        expect(finalState.isLoadingMore).toBe(false)
        expect(callLog).toEqual([
            { byPosition: true, limit: 50 },
            { byPosition: true, beforeAt: 1_700_000_400_000, beforeSeq: 101, limit: 50 },
            { byPosition: true, limit: 50 },
            { byPosition: true, beforeAt: 1_700_000_300_000, beforeSeq: 51, limit: 50 },
        ])
    })
})

describe('message-window-store status updates', () => {
    afterEach(() => {
        clearMessageWindow(SESSION_ID)
    })

    it('updates stored user messages by localId after optimistic replacement', () => {
        appendOptimisticMessage(SESSION_ID, makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            status: 'sending',
        }))

        ingestIncomingMessages(SESSION_ID, [
            makeUserMessage({
                id: 'server-1',
                localId: 'local-1',
                createdAt: Date.now() + 1,
            }),
        ])

        updateMessageStatus(SESSION_ID, 'local-1', 'sent')

        const message = getMessageWindowState(SESSION_ID).messages.find((entry) => entry.id === 'server-1')
        expect(message?.status).toBe('sent')
    })

    it('marks stored queued messages as consumed by localId', () => {
        ingestIncomingMessages(SESSION_ID, [
            makeUserMessage({
                id: 'server-queued',
                localId: 'queued-1',
                status: 'queued',
            }),
        ])

        markMessagesConsumed(SESSION_ID, ['queued-1'], Date.now())

        const message = getMessageWindowState(SESSION_ID).messages.find((entry) => entry.id === 'server-queued')
        expect(message?.status).toBe('sent')
    })
})
