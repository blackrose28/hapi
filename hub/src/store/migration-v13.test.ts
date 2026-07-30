import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

describe('Store V12→V13 session machine migration', () => {
    it('persists machine_id when sessions are created and metadata changes', () => {
        const store = new Store(':memory:')
        const created = store.sessions.getOrCreateSession(
            'tag-1',
            { path: '/workspace', host: 'host', machineId: 'machine-1' },
            null,
            'org-1'
        )
        expect(created.machineId).toBe('machine-1')

        const updated = store.sessions.updateSessionMetadata(
            created.id,
            { path: '/workspace', host: 'host', machineId: 'machine-2' },
            created.metadataVersion,
            'org-1'
        )
        expect(updated.result).toBe('success')
        expect(store.sessions.getSession(created.id)?.machineId).toBe('machine-2')
    })

    it('backfills machine_id from valid session metadata', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v13-'))
        const path = join(dir, 'hub.db')
        try {
            const db = new Database(path)
            db.exec(`
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    machine_id TEXT,
                    metadata TEXT
                );
                INSERT INTO sessions VALUES
                    ('backfill', NULL, '{"machineId":"machine-1"}'),
                    ('preserve', 'machine-2', '{"machineId":"other"}'),
                    ('invalid', NULL, 'not-json');
                PRAGMA user_version = 12;
            `)
            db.close()

            new Store(path)

            const migrated = new Database(path)
            const rows = migrated.prepare('SELECT id, machine_id FROM sessions ORDER BY id').all()
            expect(rows).toEqual([
                { id: 'backfill', machine_id: 'machine-1' },
                { id: 'invalid', machine_id: null },
                { id: 'preserve', machine_id: 'machine-2' }
            ])
            expect((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(13)
            migrated.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
