import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    TOOL_PROGRESS_STALE_AFTER_MS,
    clearToolProgressEntries,
    getToolProgress,
    getToolProgressStalenessMs,
    recordToolProgress,
    resetToolProgressStore,
    subscribeToToolProgress
} from './toolProgressStore'

describe('toolProgressStore', () => {
    beforeEach(() => {
        resetToolProgressStore()
    })

    it('records a heartbeat keyed by session and tool', () => {
        recordToolProgress('session-a', 'toolu_1', { elapsedSeconds: 30, at: 1_000 })

        expect(getToolProgress('session-a', 'toolu_1')).toEqual({
            lastProgressAt: 1_000,
            elapsedSeconds: 30
        })
        expect(getToolProgress('session-b', 'toolu_1')).toBeNull()
        expect(getToolProgress('session-a', 'toolu_2')).toBeNull()
    })

    it('stores a null elapsed value when the agent reported none', () => {
        recordToolProgress('session-a', 'toolu_1', { at: 1_000 })
        expect(getToolProgress('session-a', 'toolu_1')?.elapsedSeconds).toBeNull()

        recordToolProgress('session-a', 'toolu_2', { elapsedSeconds: Number.NaN, at: 1_000 })
        expect(getToolProgress('session-a', 'toolu_2')?.elapsedSeconds).toBeNull()
    })

    it('returns a stable snapshot reference until the next heartbeat', () => {
        recordToolProgress('session-a', 'toolu_1', { at: 1_000 })
        const first = getToolProgress('session-a', 'toolu_1')

        expect(getToolProgress('session-a', 'toolu_1')).toBe(first)

        recordToolProgress('session-a', 'toolu_1', { at: 2_000 })
        expect(getToolProgress('session-a', 'toolu_1')).not.toBe(first)
    })

    it('notifies only listeners for the affected tool', () => {
        const listenerA = vi.fn()
        const listenerB = vi.fn()
        subscribeToToolProgress('session-a', 'toolu_1', listenerA)
        subscribeToToolProgress('session-a', 'toolu_2', listenerB)

        recordToolProgress('session-a', 'toolu_1', { at: 1_000 })

        expect(listenerA).toHaveBeenCalledTimes(1)
        expect(listenerB).not.toHaveBeenCalled()
    })

    it('stops notifying after unsubscribe', () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToToolProgress('session-a', 'toolu_1', listener)
        unsubscribe()

        recordToolProgress('session-a', 'toolu_1', { at: 1_000 })

        expect(listener).not.toHaveBeenCalled()
    })

    it('prunes entries older than the TTL and notifies their listeners', () => {
        const listener = vi.fn()
        recordToolProgress('session-a', 'toolu_old', { at: 1_000 })
        subscribeToToolProgress('session-a', 'toolu_old', listener)

        recordToolProgress('session-a', 'toolu_new', { at: 1_000 + 11 * 60_000 })

        expect(getToolProgress('session-a', 'toolu_old')).toBeNull()
        expect(getToolProgress('session-a', 'toolu_new')).not.toBeNull()
        expect(listener).toHaveBeenCalledTimes(1)
    })

    describe('clearToolProgressEntries', () => {
        it('forgets entries, notifies listeners, and keeps subscriptions alive', () => {
            const listener = vi.fn()
            recordToolProgress('session-a', 'toolu_1', { at: 1_000 })
            subscribeToToolProgress('session-a', 'toolu_1', listener)

            clearToolProgressEntries()

            expect(getToolProgress('session-a', 'toolu_1')).toBeNull()
            expect(listener).toHaveBeenCalledTimes(1)

            // The subscription must survive, or a remounted card would go deaf.
            recordToolProgress('session-a', 'toolu_1', { at: 2_000 })
            expect(listener).toHaveBeenCalledTimes(2)
            expect(getToolProgress('session-a', 'toolu_1')?.lastProgressAt).toBe(2_000)
        })

        it('does nothing when the store is already empty', () => {
            const listener = vi.fn()
            subscribeToToolProgress('session-a', 'toolu_1', listener)

            clearToolProgressEntries()

            expect(listener).not.toHaveBeenCalled()
        })
    })

    describe('getToolProgressStalenessMs', () => {
        it('says nothing when no heartbeat was ever received', () => {
            expect(getToolProgressStalenessMs(null, 10_000_000)).toBeNull()
        })

        it('says nothing while heartbeats are fresh', () => {
            const entry = { lastProgressAt: 1_000, elapsedSeconds: 30 }
            expect(getToolProgressStalenessMs(entry, 1_000)).toBeNull()
            expect(getToolProgressStalenessMs(entry, 1_000 + TOOL_PROGRESS_STALE_AFTER_MS - 1)).toBeNull()
        })

        it('reports the gap once three beats have been missed', () => {
            const entry = { lastProgressAt: 1_000, elapsedSeconds: 30 }
            expect(getToolProgressStalenessMs(entry, 1_000 + TOOL_PROGRESS_STALE_AFTER_MS))
                .toBe(TOOL_PROGRESS_STALE_AFTER_MS)
            expect(getToolProgressStalenessMs(entry, 1_000 + 300_000)).toBe(300_000)
        })

        it('says nothing when the clock moved backwards', () => {
            const entry = { lastProgressAt: 10_000, elapsedSeconds: 30 }
            expect(getToolProgressStalenessMs(entry, 5_000)).toBeNull()
        })
    })
})
