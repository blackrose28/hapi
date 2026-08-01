import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from './index'

const TERMINAL_SNIPPET_INDEX = 'idx_terminal_snippets_namespace_created'

describe('Store V10→V11 migration: terminal snippets', () => {
    it('creates the terminal_snippets table and ordering index for a fresh database', () => {
        const store = new Store(':memory:')
        const db = getDatabase(store)

        expect(getSchemaObject(db, 'table', 'terminal_snippets')).not.toBeNull()
        expect(getSchemaObject(db, 'index', TERMINAL_SNIPPET_INDEX)?.sql).toContain(
            'namespace, created_at DESC, id DESC'
        )
        expect(getUserVersion(db)).toBe(14)
    })

    it('migrates a real on-disk user_version 10 database forward', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-'))
        const dbPath = join(dir, 'test.db')

        let store: Store | undefined

        try {
            // Start from the complete schema so the downgraded fixture retains
            // every table required by a real V10 HAPI database.
            new Store(dbPath)

            const v10Db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            v10Db.exec('DROP TABLE terminal_snippets')
            v10Db.exec('PRAGMA user_version = 10')
            expect(getSchemaObject(v10Db, 'table', 'terminal_snippets')).toBeNull()
            expect(getUserVersion(v10Db)).toBe(10)
            v10Db.close()

            store = new Store(dbPath)
            const migratedDb = getDatabase(store)

            expect(getUserVersion(migratedDb)).toBe(14)
            expect(getSchemaObject(migratedDb, 'table', 'terminal_snippets')).not.toBeNull()
            expect(getSchemaObject(migratedDb, 'index', TERMINAL_SNIPPET_INDEX)).not.toBeNull()

            const created = store.terminalSnippets.create({
                namespace: 'default',
                name: 'Migrated',
                command: 'echo migrated',
                description: null,
                now: 456
            })
            expect(store.terminalSnippets.list('default').map(snippet => snippet.id)).toEqual([created.id])

            // Reopening exercises the required-table guard, which a fake
            // one-table fixture would fail even if the migration itself passed.
            const reopenedStore = new Store(dbPath)
            expect(getUserVersion(getDatabase(reopenedStore))).toBe(14)
            expect(reopenedStore.terminalSnippets.list('default')).toEqual([created])
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('reopens a valid migrated database and keeps terminal snippets usable', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-reopen-v11-'))
        const dbPath = join(dir, 'test.db')

        let store: Store | undefined

        try {
            const firstStore = new Store(dbPath)
            const created = firstStore.terminalSnippets.create({
                namespace: 'default',
                name: 'Persisted',
                command: 'echo persisted',
                description: null,
                now: 123
            })

            const reopenedStore = new Store(dbPath)
            expect(getUserVersion(getDatabase(reopenedStore))).toBe(14)
            expect(reopenedStore.terminalSnippets.list('default')).toEqual([created])
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function getDatabase(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

function getSchemaObject(
    db: Database,
    type: 'table' | 'index',
    name: string
): { name: string; sql: string | null } | null {
    return db.prepare(
        'SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?'
    ).get(type, name) as { name: string; sql: string | null } | null
}

function getUserVersion(db: Database): number {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    return row.user_version
}
