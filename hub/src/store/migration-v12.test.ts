import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

describe('Store V11→V12 Team Chat ownership migration', () => {
    it('adds owner_membership_id without exposing a legacy owner', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v12-'))
        const path = join(dir, 'hub.db')
        try {
            const db = new Database(path)
            db.exec(`
                CREATE TABLE team_chats (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL,
                    project_path TEXT, shared_context TEXT, archived_at INTEGER,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                );
                INSERT INTO team_chats VALUES ('legacy', 'org-1', 'Legacy', NULL, NULL, NULL, 1, 1);
                PRAGMA user_version = 11;
            `)
            db.close()

            const store = new Store(path)
            expect(store.teamChats.getTeamChat('org-1', 'legacy')?.ownerMembershipId).toBeNull()

            const migrated = new Database(path)
            expect((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(13)
            expect((migrated.prepare('PRAGMA table_info(team_chats)').all() as Array<{ name: string }>).some((column) => column.name === 'owner_membership_id')).toBe(true)
            migrated.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
