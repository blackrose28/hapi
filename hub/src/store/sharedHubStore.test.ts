import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { SharedHubStore } from './sharedHubStore'

function seeded(): { db: Database; store: SharedHubStore } {
    const db = new Database(':memory:')
    const store = new SharedHubStore(db, { organizationId: 'o1', organizationName: 'Pilot' })
    db.prepare(`INSERT INTO memberships(id, organization_id, invited_email, role, status, created_at)
        VALUES ('u1', 'o1', 'user@example.com', 'admin', 'active', 1)`).run()
    return { db, store }
}

describe('SharedHubStore', () => {
    it('creates the organization once and all pilot tables', () => {
        const { db } = seeded()
        new SharedHubStore(db, { organizationId: 'o1', organizationName: 'Changed' })
        expect(db.prepare('SELECT count(*) count FROM organizations').get()).toEqual({ count: 1 })
        expect(db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name IN ('identities','teams','runners','resource_grants','audit_events')").get()).toEqual({ count: 5 })
    })

    it('consumes a hash-only enrollment once and rejects expiry', () => {
        const { db, store } = seeded()
        store.createEnrollment({ id: 'e1', organizationId: 'o1', createdBy: 'u1', codeHash: 'hash-not-code', expiresAt: 100, createdAt: 1 })
        expect(JSON.stringify(db.prepare('SELECT * FROM runner_enrollments').get())).not.toContain('plaintext-code')
        expect(store.consumeEnrollment('hash-not-code', 50)?.id).toBe('e1')
        expect(store.consumeEnrollment('hash-not-code', 51)).toBeNull()
        store.createEnrollment({ id: 'e2', organizationId: 'o1', createdBy: 'u1', codeHash: 'expired', expiresAt: 10, createdAt: 1 })
        expect(store.consumeEnrollment('expired', 10)).toBeNull()
    })

    it('rejects legacy databases with recovery guidance', () => {
        const db = new Database(':memory:')
        db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY)')
        expect(() => new SharedHubStore(db, { organizationId: 'o1', organizationName: 'Pilot' })).toThrow(/offline backup.*new database path/i)
    })

    it('keeps machine runtime state as a one-to-one Runner projection', () => {
        const { db, store } = seeded()
        const runner = store.createRunnerProjection({
            runnerId: 'r1', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1',
            name: 'Laptop', metadata: { os: 'linux' }, runnerState: { active: true }, createdAt: 1
        })
        expect(runner.machineId).toBe('m1')
        expect(store.findRunner('other-org', 'r1')).toBeNull()
        expect(() => store.createRunnerProjection({
            runnerId: 'r2', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1',
            name: 'Duplicate', metadata: {}, runnerState: {}, createdAt: 2
        })).toThrow()
        expect(db.prepare("SELECT count(*) count FROM runners WHERE id = 'r2'").get()).toEqual({ count: 0 })
    })

    it('resolves active direct and dynamic Team grants only', () => {
        const { db, store } = seeded()
        store.createRunnerProjection({
            runnerId: 'r1', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1',
            name: 'Laptop', metadata: {}, runnerState: {}, createdAt: 1
        })
        db.exec(`
            INSERT INTO teams(id, organization_id, name, created_at) VALUES ('t1', 'o1', 'Active', 1), ('t2', 'o1', 'Archived', 1);
            UPDATE teams SET archived_at = 2 WHERE id = 't2';
            INSERT INTO team_memberships(team_id, membership_id, organization_id, role, created_at)
            VALUES ('t1', 'u1', 'o1', 'member', 1), ('t2', 'u1', 'o1', 'member', 1);
            INSERT INTO resource_grants(id, organization_id, principal_type, principal_id, resource_type, resource_id, capability, expires_at, created_by_membership_id, created_at)
            VALUES
                ('g1', 'o1', 'user', 'u1', 'runner', 'r1', 'view', NULL, 'u1', 1),
                ('g2', 'o1', 'team', 't1', 'runner', 'r1', 'operate', 100, 'u1', 1),
                ('g3', 'o1', 'team', 't2', 'runner', 'r1', 'manage', NULL, 'u1', 1),
                ('g4', 'o1', 'user', 'u1', 'runner', 'r1', 'manage', 5, 'u1', 1);
        `)
        expect(store.resolveEffectiveGrants({ organizationId: 'o1', membershipId: 'u1', resourceType: 'runner', resourceId: 'r1', now: 10 }))
            .toEqual([
                { capability: 'view', expiresAt: null, source: 'direct', sourceId: 'g1' },
                { capability: 'operate', expiresAt: 100, source: 'team', sourceId: 't1' }
            ])
        expect(store.resolveEffectiveGrants({ organizationId: 'other', membershipId: 'u1', resourceType: 'runner', resourceId: 'r1', now: 10 })).toEqual([])
    })

    it('rejects a different organization configuration for an existing database', () => {
        const { db } = seeded()
        expect(() => new SharedHubStore(db, { organizationId: 'o2', organizationName: 'Other' })).toThrow(/schema mismatch/i)
    })

    it('normalizes invitation email and enforces closed roles', () => {
        const { db, store } = seeded()
        store.createInvitation({ id: 'i1', organizationId: 'o1', email: ' User@Example.COM ', tokenHash: 'h1', role: 'member', expiresAt: 100, createdAt: 1 })
        expect(db.prepare("SELECT email FROM invitations WHERE id = 'i1'").get()).toEqual({ email: 'user@example.com' })
        expect(() => db.prepare(`INSERT INTO invitations(id, organization_id, email, token_hash, role, expires_at, created_at)
            VALUES ('i2', 'o1', 'x@example.com', 'h2', 'superadmin', 100, 1)`).run()).toThrow()
    })

    it('cleans expired or revoked ephemeral security records', () => {
        const { db, store } = seeded()
        db.exec(`
            INSERT INTO oidc_transactions(state_hash, nonce_hash, code_verifier, redirect_uri, expires_at, created_at) VALUES ('s', 'n', 'v', 'https://hub/cb', 5, 1);
            INSERT INTO runner_enrollments(id, organization_id, created_by_membership_id, code_hash, expires_at, created_at) VALUES ('e', 'o1', 'u1', 'h', 5, 1);
            INSERT INTO web_sessions(id_hash, membership_id, csrf_hash, expires_at, created_at) VALUES ('w', 'u1', 'c', 5, 1);
        `)
        store.cleanupExpiredSecurityState(5)
        expect(db.prepare('SELECT count(*) count FROM oidc_transactions').get()).toEqual({ count: 0 })
        expect(db.prepare('SELECT count(*) count FROM runner_enrollments').get()).toEqual({ count: 1 })
        expect(db.prepare('SELECT count(*) count FROM web_sessions').get()).toEqual({ count: 0 })
    })

    it('rejects orphan session grants and suppresses stale rows from effective resolution', () => {
        const { db, store } = seeded()
        store.createRunnerProjection({
            runnerId: 'r1', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1',
            name: 'Laptop', metadata: {}, runnerState: {}, createdAt: 1
        })
        expect(() => store.createResourceGrant({
            id: 'bad', organizationId: 'o1', principalType: 'user', principalId: 'u1',
            resourceType: 'session', resourceId: 'missing', capability: 'view', expiresAt: null,
            createdByMembershipId: 'u1', createdAt: 2
        })).toThrow()
        store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 3 })
        store.createResourceGrant({
            id: 'g1', organizationId: 'o1', principalType: 'user', principalId: 'u1',
            resourceType: 'session', resourceId: 's1', capability: 'view', expiresAt: null,
            createdByMembershipId: 'u1', createdAt: 4
        })
        db.prepare("DELETE FROM session_security_projections WHERE session_id='s1'").run()
        expect(store.resolveEffectiveGrants({ organizationId: 'o1', membershipId: 'u1', resourceType: 'session', resourceId: 's1', now: 5 })).toEqual([])
    })

    it('rejects equivalent grants and transfers ownership atomically', () => {
        const { db, store } = seeded()
        db.exec(`
            INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at)
            VALUES ('u2','o1','two@example.com','member','active',1);
            INSERT INTO teams(id,organization_id,name,created_at) VALUES ('t1','o1','Core',1);
            INSERT INTO team_memberships(team_id,membership_id,organization_id,role,created_at)
            VALUES ('t1','u1','o1','owner',1),('t1','u2','o1','member',1);
        `)
        expect(store.transferTeamOwnership('o1', 't1', 'u1', 'u2')).toBe('transferred')
        expect(store.listTeamMemberships('o1', 't1')).toEqual([
            { membershipId: 'u1', role: 'member' }, { membershipId: 'u2', role: 'owner' }
        ])
    })

    it('lets equal-timestamp retirement win and rejects equal-version conflicting rebinds', () => {
        const { store } = seeded()
        store.createRunnerProjection({ runnerId: 'r1', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1', name: 'One', metadata: {}, runnerState: {}, createdAt: 1 })
        store.createRunnerProjection({ runnerId: 'r2', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm2', name: 'Two', metadata: {}, runnerState: {}, createdAt: 1 })
        store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 10 })
        expect(store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm2', updatedAt: 10 })).toBeFalse()
        expect(store.findSessionRunner('o1', 's1')?.id).toBe('r1')
        store.retireSessionProjection('o1', 's1', 20)
        expect(store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm2', updatedAt: 20 })).toBeFalse()
        expect(store.findSessionRunner('o1', 's1')).toBeNull()
    })

    it('lists runners with createdAt', () => {
        const { db, store } = seeded()
        db.exec("INSERT INTO runners(id,organization_id,owner_membership_id,machine_id,profile,name,status,created_at) VALUES ('r1','o1','u1','m1','p1','A','active',2),('r2','o1','u1','m2','p2','B','revoked',1)")
        const runners = store.listRunners('o1')
        expect(runners).toHaveLength(2)
        expect(runners[0].id).toBe('r1')
        expect(runners[0].createdAt).toBe(2)
    })

    it('transfers runner ownership and rejects invalid targets', () => {
        const { db, store } = seeded()
        db.exec("INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at) VALUES ('u2','o1','b@x.com','member','active',1)")
        db.exec("INSERT INTO runners(id,organization_id,owner_membership_id,machine_id,profile,name,status,created_at) VALUES ('r1','o1','u1','m1','p1','A','active',1)")
        expect(store.transferRunnerOwnership('o1', 'r1', 'u1')).toBe('same_owner')
        expect(store.transferRunnerOwnership('o1', 'r1', 'u2')).toBe('transferred')
        expect(store.findRunner('o1', 'r1')?.ownerMembershipId).toBe('u2')
        expect(store.transferRunnerOwnership('o1', 'r1', 'ghost')).toBe('target_not_found')
        db.exec("UPDATE runners SET status='revoked' WHERE id='r1'")
        expect(store.transferRunnerOwnership('o1', 'r1', 'u1')).toBe('not_found')
    })

    it('cleans up runner tombstone after revoke', () => {
        const { db, store } = seeded()
        db.exec("INSERT INTO runners(id,organization_id,owner_membership_id,machine_id,profile,name,status,created_at) VALUES ('r1','o1','u1','m1','p1','A','active',1)")
        store.revokeRunnerAccess({ organizationId: 'o1', runnerId: 'r1', now: 10 })
        expect(db.prepare('SELECT cleanup_required FROM runner_tombstones WHERE runner_id=?').get('r1')).toEqual({ cleanup_required: 1 })
        expect(store.cleanupRunnerTombstone('o1', 'r1')).toBe('cleaned')
        expect(db.prepare('SELECT cleanup_required FROM runner_tombstones WHERE runner_id=?').get('r1')).toEqual({ cleanup_required: 0 })
        expect(store.findRunner('o1', 'r1')?.status).toBe('archived')
        expect(store.cleanupRunnerTombstone('o1', 'r1')).toBe('not_found')
        expect(store.cleanupRunnerTombstone('o1', 'never')).toBe('not_found')
    })

    it('cleans up a revoked runner whose tombstone flag was already cleared', () => {
        const { db, store } = seeded()
        db.exec("INSERT INTO runners(id,organization_id,owner_membership_id,machine_id,profile,name,status,created_at) VALUES ('r1','o1','u1','m1','p1','A','revoked',1)")
        db.exec("INSERT INTO runner_tombstones(runner_id,cleanup_required,revoked_at) VALUES ('r1',0,1)")
        expect(store.cleanupRunnerTombstone('o1', 'r1')).toBe('cleaned')
        expect(store.findRunner('o1', 'r1')?.status).toBe('archived')
    })
})
