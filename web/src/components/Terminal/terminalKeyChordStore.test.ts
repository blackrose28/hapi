import { describe, expect, it } from 'vitest'
import { getTerminalKey, type TerminalKeyChord } from './terminalKeyChord'
import {
    createTerminalKeyChordStore,
    TERMINAL_KEY_CHORD_LIMIT,
    TERMINAL_KEY_CHORD_STORAGE_KEY,
} from './terminalKeyChordStore'

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length(): number {
        return this.values.size
    }

    clear(): void {
        this.values.clear()
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null
    }

    removeItem(key: string): void {
        this.values.delete(key)
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
}

function chord(keyId: string, modifiers: TerminalKeyChord['modifiers'] = []): TerminalKeyChord {
    const key = getTerminalKey(keyId)
    if (!key) {
        throw new Error(`Missing test key ${keyId}`)
    }
    return { modifiers, key }
}

function makeStore(storage: Storage = new MemoryStorage()) {
    let id = 0
    let now = 100
    return {
        storage,
        store: createTerminalKeyChordStore({
            storage,
            idFactory: () => `saved-${++id}`,
            now: () => ++now,
            notify: () => undefined,
        }),
    }
}

describe('terminalKeyChordStore', () => {
    it('stores newest first and returns the existing normalized duplicate', () => {
        const { store } = makeStore()

        expect(store.save(chord('letter-c')).status).toBe('saved')
        expect(store.save(chord('digit-6', ['shift', 'ctrl'])).status).toBe('saved')
        const duplicate = store.save(chord('digit-6', ['ctrl', 'shift', 'ctrl']))

        expect(duplicate).toMatchObject({
            status: 'duplicate',
            item: { id: 'saved-2' },
        })
        expect(store.load()).toMatchObject({
            status: 'ready',
            items: [
                { id: 'saved-2', chord: { modifiers: ['ctrl', 'shift'] } },
                { id: 'saved-1' },
            ],
        })
    })

    it('drops corrupt, duplicate and unknown-key records while loading', () => {
        const storage = new MemoryStorage()
        storage.setItem(TERMINAL_KEY_CHORD_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: [
                { id: 'good', chord: chord('letter-a'), createdAt: 4 },
                { id: 'duplicate', chord: chord('letter-a'), createdAt: 3 },
                {
                    id: 'unknown',
                    chord: { modifiers: [], key: { id: 'unknown' } },
                    createdAt: 2,
                },
                { id: '', chord: chord('letter-b'), createdAt: 1 },
            ],
        }))
        const { store } = makeStore(storage)

        expect(store.load()).toEqual({
            status: 'ready',
            items: [{
                id: 'good',
                chord: chord('letter-a'),
                createdAt: 4,
            }],
        })

        storage.setItem(TERMINAL_KEY_CHORD_STORAGE_KEY, '{bad json')
        expect(store.load()).toEqual({ status: 'ready', items: [] })
    })

    it('returns limit without deleting existing items', () => {
        const { store } = makeStore()
        const keyIds = [
            ...Array.from({ length: 26 }, (_, index) => `letter-${String.fromCharCode(97 + index)}`),
            ...Array.from({ length: 10 }, (_, index) => `digit-${index}`),
            ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
            'escape',
            'tab',
        ]
        expect(keyIds).toHaveLength(TERMINAL_KEY_CHORD_LIMIT)
        for (const keyId of keyIds) {
            expect(store.save(chord(keyId)).status).toBe('saved')
        }

        expect(store.save(chord('enter'))).toEqual({ status: 'limit' })
        expect(store.load()).toMatchObject({
            status: 'ready',
            items: { length: TERMINAL_KEY_CHORD_LIMIT },
        })
    })

    it('deletes and restores an item at its original index', () => {
        const { store } = makeStore()
        store.save(chord('letter-a'))
        store.save(chord('letter-b'))
        store.save(chord('letter-c'))

        const deleted = store.remove('saved-2')
        expect(deleted).toMatchObject({ index: 1, item: { id: 'saved-2' } })
        expect(store.load().items.map((item) => item.id)).toEqual(['saved-3', 'saved-1'])

        expect(store.restore(deleted!)).toBe(true)
        expect(store.load().items.map((item) => item.id)).toEqual(['saved-3', 'saved-2', 'saved-1'])
    })

    it('does not restore past the saved-item limit', () => {
        const { store } = makeStore()
        const keyIds = [
            ...Array.from({ length: 26 }, (_, index) => `letter-${String.fromCharCode(97 + index)}`),
            ...Array.from({ length: 10 }, (_, index) => `digit-${index}`),
            ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
            'escape',
            'tab',
        ]
        for (const keyId of keyIds) {
            store.save(chord(keyId))
        }

        const deleted = store.remove('saved-1')
        expect(deleted).not.toBeNull()
        expect(store.save(chord('enter')).status).toBe('saved')

        expect(store.restore(deleted!)).toBe(false)
        expect(store.load().items).toHaveLength(TERMINAL_KEY_CHORD_LIMIT)
    })

    it('reports unavailable when storage access throws', () => {
        const storage = new MemoryStorage()
        storage.getItem = () => {
            throw new Error('blocked')
        }
        const { store } = makeStore(storage)

        expect(store.load()).toEqual({ status: 'unavailable', items: [] })
        expect(store.save(chord('letter-a'))).toEqual({ status: 'unavailable' })
    })
})
