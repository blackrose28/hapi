import {
    normalizeTerminalKeyChord,
    terminalKeyChordIdentity,
    type TerminalKeyChord,
} from './terminalKeyChord'

export const TERMINAL_KEY_CHORD_STORAGE_KEY = 'hapi:terminal-key-chords:v1'
export const TERMINAL_KEY_CHORD_LIMIT = 50
const TERMINAL_KEY_CHORD_CHANGE_EVENT = 'hapi:terminal-key-chords-changed'

export type SavedTerminalKeyChord = {
    id: string
    chord: TerminalKeyChord
    createdAt: number
}

export type DeletedSavedTerminalKeyChord = {
    item: SavedTerminalKeyChord
    index: number
}

export type LoadTerminalKeyChordsResult = {
    status: 'ready' | 'unavailable'
    items: SavedTerminalKeyChord[]
}

export type SaveTerminalKeyChordResult =
    | { status: 'saved'; item: SavedTerminalKeyChord }
    | { status: 'duplicate'; item: SavedTerminalKeyChord }
    | { status: 'limit' }
    | { status: 'unavailable' }

type TerminalKeyChordStoreDependencies = {
    storage: Storage
    now: () => number
    idFactory: () => string
    notify: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function parseStoredItems(raw: string | null): SavedTerminalKeyChord[] {
    if (!raw) {
        return []
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items)) {
        return []
    }

    const seen = new Set<string>()
    const items: SavedTerminalKeyChord[] = []
    for (const candidate of parsed.items) {
        if (
            !isRecord(candidate)
            || typeof candidate.id !== 'string'
            || candidate.id.length === 0
            || typeof candidate.createdAt !== 'number'
            || !Number.isFinite(candidate.createdAt)
        ) {
            continue
        }
        const chord = normalizeTerminalKeyChord(candidate.chord)
        if (!chord) {
            continue
        }
        const identity = terminalKeyChordIdentity(chord)
        if (seen.has(identity)) {
            continue
        }
        seen.add(identity)
        items.push({
            id: candidate.id,
            chord,
            createdAt: candidate.createdAt,
        })
    }
    return items
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, TERMINAL_KEY_CHORD_LIMIT)
}

function serialize(items: SavedTerminalKeyChord[]): string {
    return JSON.stringify({ version: 1, items })
}

export function createTerminalKeyChordStore(dependencies: TerminalKeyChordStoreDependencies) {
    const load = (): LoadTerminalKeyChordsResult => {
        try {
            return {
                status: 'ready',
                items: parseStoredItems(
                    dependencies.storage.getItem(TERMINAL_KEY_CHORD_STORAGE_KEY),
                ),
            }
        } catch {
            return { status: 'unavailable', items: [] }
        }
    }

    const write = (items: SavedTerminalKeyChord[]): boolean => {
        try {
            dependencies.storage.setItem(
                TERMINAL_KEY_CHORD_STORAGE_KEY,
                serialize(items),
            )
            dependencies.notify()
            return true
        } catch {
            return false
        }
    }

    const save = (value: TerminalKeyChord): SaveTerminalKeyChordResult => {
        const chord = normalizeTerminalKeyChord(value)
        if (!chord) {
            return { status: 'unavailable' }
        }
        const loaded = load()
        if (loaded.status === 'unavailable') {
            return { status: 'unavailable' }
        }
        const identity = terminalKeyChordIdentity(chord)
        const existing = loaded.items.find(
            (item) => terminalKeyChordIdentity(item.chord) === identity,
        )
        if (existing) {
            return { status: 'duplicate', item: existing }
        }
        if (loaded.items.length >= TERMINAL_KEY_CHORD_LIMIT) {
            return { status: 'limit' }
        }
        const item: SavedTerminalKeyChord = {
            id: dependencies.idFactory(),
            chord,
            createdAt: dependencies.now(),
        }
        return write([item, ...loaded.items])
            ? { status: 'saved', item }
            : { status: 'unavailable' }
    }

    const remove = (id: string): DeletedSavedTerminalKeyChord | null => {
        const loaded = load()
        if (loaded.status === 'unavailable') {
            return null
        }
        const index = loaded.items.findIndex((item) => item.id === id)
        if (index < 0) {
            return null
        }
        const item = loaded.items[index]
        const next = loaded.items.filter((candidate) => candidate.id !== id)
        return write(next) ? { item, index } : null
    }

    const restore = (deleted: DeletedSavedTerminalKeyChord): boolean => {
        const loaded = load()
        if (loaded.status === 'unavailable') {
            return false
        }
        const identity = terminalKeyChordIdentity(deleted.item.chord)
        if (
            loaded.items.some((item) => (
                item.id === deleted.item.id
                || terminalKeyChordIdentity(item.chord) === identity
            ))
            || loaded.items.length >= TERMINAL_KEY_CHORD_LIMIT
        ) {
            return false
        }
        const index = Math.max(0, Math.min(deleted.index, loaded.items.length))
        const next = [...loaded.items]
        next.splice(index, 0, deleted.item)
        return write(next)
    }

    return { load, save, remove, restore }
}

function notifyBrowserSubscribers(): void {
    window.dispatchEvent(new Event(TERMINAL_KEY_CHORD_CHANGE_EVENT))
}

let browserStore: ReturnType<typeof createTerminalKeyChordStore> | null = null

export function getBrowserTerminalKeyChordStore(): ReturnType<typeof createTerminalKeyChordStore> | null {
    if (typeof window === 'undefined') {
        return null
    }
    if (browserStore) {
        return browserStore
    }
    try {
        browserStore = createTerminalKeyChordStore({
            storage: window.localStorage,
            now: () => Date.now(),
            idFactory: () => (
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
            ),
            notify: notifyBrowserSubscribers,
        })
        return browserStore
    } catch {
        return null
    }
}

export function subscribeTerminalKeyChords(listener: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => undefined
    }
    const handleStorage = (event: StorageEvent) => {
        if (event.key === TERMINAL_KEY_CHORD_STORAGE_KEY) {
            listener()
        }
    }
    window.addEventListener(TERMINAL_KEY_CHORD_CHANGE_EVENT, listener)
    window.addEventListener('storage', handleStorage)
    return () => {
        window.removeEventListener(TERMINAL_KEY_CHORD_CHANGE_EVENT, listener)
        window.removeEventListener('storage', handleStorage)
    }
}
