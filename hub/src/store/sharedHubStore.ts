import { Database } from 'bun:sqlite'

export const SHARED_HUB_SCHEMA_VERSION = 1
export const SHARED_HUB_SCHEMA_MARKER = 'hapi-shared-hub'

export type SharedHubStoreOptions = {
    organizationId: string
    organizationName: string
}

export type StoredSharedRunner = {
    id: string
    organizationId: string
    ownerMembershipId: string
    machineId: string
    profile: string
    name: string
    status: 'active' | 'revoked' | 'archived'
}

export type StoredRunnerEnrollment = {
    id: string
    organizationId: string
    ownerMembershipId: string
    expiresAt: number
    consumedAt: number | null
    cancelledAt: number | null
}

export type StoredRunnerCredential = {
    id: string
    runnerId: string
    organizationId: string
    secretHash: string
    generation: number
    revokedAt: number | null
}

export class RunnerClaimConflictError extends Error {
    constructor(readonly code: 'machine_claimed' | 'profile_claimed') { super(code) }
}

export type StoredEffectiveGrant = {
    capability: 'view' | 'interact' | 'spawn' | 'operate' | 'manage'
    expiresAt: number | null
    source: 'direct' | 'team'
    sourceId: string
}

export type StoredOidcTransaction = {
    codeVerifier: string
    nonceHash: string
    redirectUri: string
    invitationTokenHash: string | null
}

export type StoredWebSession = {
    membershipId: string
    organizationId: string
    role: 'admin' | 'member' | 'viewer'
    csrfHash: string
}

export type StoredInvitation = {
    id: string
    organizationId: string
    email: string
    role: 'admin' | 'member' | 'viewer'
    expiresAt: number
    claimedAt: number | null
    cancelledAt: number | null
    createdAt: number
}

export type StoredTeam = {
    id: string
    organizationId: string
    name: string
    archivedAt: number | null
}

export type StoredTeamMembership = {
    membershipId: string
    role: 'owner' | 'member'
}

export type StoredResourceGrant = {
    id: string
    organizationId: string
    principalType: 'user' | 'team'
    principalId: string
    resourceType: 'runner' | 'session'
    resourceId: string
    capability: 'view' | 'interact' | 'spawn' | 'operate' | 'manage'
    expiresAt: number | null
}

export type StoredResourceGrantDetail = StoredResourceGrant & {
    createdByMembershipId: string
    createdAt: number
}

export type StoredAuditEvent = {
    id: string
    actorType: 'user' | 'runner'
    actorId: string
    action: string
    resourceType: string
    resourceId: string
    outcome: 'success' | 'denied' | 'failure'
    metadata: Readonly<Record<string, string | number | boolean | null>>
    createdAt: number
}

export type StoredOutboxEvent = {
    id: string
    name: string
    organizationId: string
    resourceType: string
    resourceId: string
}

export class SharedHubStore {
    constructor(private readonly db: Database, options: SharedHubStoreOptions) {
        this.initialize(options)
    }

    createEnrollment(input: { id: string; organizationId: string; ownerMembershipId?: string; createdBy?: string; codeHash: string; expiresAt: number; createdAt: number }): void {
        this.cleanupExpiredSecurityState(input.createdAt)
        const ownerMembershipId = input.ownerMembershipId ?? input.createdBy
        if (!ownerMembershipId) throw new Error('Enrollment owner is required.')
        this.db.prepare(`INSERT INTO runner_enrollments
            (id, organization_id, created_by_membership_id, code_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`
        ).run(input.id, input.organizationId, ownerMembershipId, input.codeHash, input.expiresAt, input.createdAt)
    }

    consumeEnrollment(codeHash: string, now: number): { id: string; organizationId: string; ownerMembershipId: string } | null {
        return this.transaction(() => {
            const row = this.db.prepare(`UPDATE runner_enrollments SET consumed_at = ?
                WHERE code_hash = ? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
                AND EXISTS (SELECT 1 FROM memberships m WHERE m.id = runner_enrollments.created_by_membership_id
                    AND m.organization_id = runner_enrollments.organization_id AND m.status = 'active')
                RETURNING id, organization_id, created_by_membership_id`).get(now, codeHash, now) as {
                    id: string; organization_id: string; created_by_membership_id: string
                } | null
            if (!row) return null
            return { id: row.id, organizationId: row.organization_id, ownerMembershipId: row.created_by_membership_id }
        })
    }

    listEnrollments(organizationId: string): StoredRunnerEnrollment[] {
        return (this.db.prepare(`SELECT id, organization_id, created_by_membership_id, expires_at, consumed_at, cancelled_at
            FROM runner_enrollments WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1000`).all(organizationId) as Array<{id:string;organization_id:string;created_by_membership_id:string;expires_at:number;consumed_at:number|null;cancelled_at:number|null}>).map((row) => ({ id: row.id, organizationId: row.organization_id, ownerMembershipId: row.created_by_membership_id, expiresAt: row.expires_at, consumedAt: row.consumed_at, cancelledAt: row.cancelled_at }))
    }

    cancelEnrollment(organizationId: string, id: string, now: number): boolean {
        return this.db.prepare('UPDATE runner_enrollments SET cancelled_at=? WHERE organization_id=? AND id=? AND consumed_at IS NULL AND cancelled_at IS NULL').run(now, organizationId, id).changes === 1
    }

    transaction<T>(operation: () => T): T {
        return this.db.transaction(operation)()
    }

    createRunnerProjection(input: {
        runnerId: string
        organizationId: string
        ownerMembershipId: string
        machineId: string
        profile?: string
        name: string
        metadata: unknown
        runnerState: unknown
        createdAt: number
    }): StoredSharedRunner {
        return this.transaction(() => {
            const profile = input.profile ?? `legacy-${input.runnerId}`
            this.db.prepare(`INSERT INTO runners
                (id, organization_id, owner_membership_id, machine_id, profile, name, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
            ).run(input.runnerId, input.organizationId, input.ownerMembershipId, input.machineId, profile, input.name, input.createdAt)
            try { this.db.prepare(`INSERT INTO runner_active_claims(organization_id, runner_id, machine_id, profile, created_at) VALUES(?,?,?,?,?)`).run(input.organizationId, input.runnerId, input.machineId, profile, input.createdAt) }
            catch (error) {
                const message = error instanceof Error ? error.message : ''
                if (message === 'UNIQUE constraint failed: runner_active_claims.organization_id, runner_active_claims.machine_id') throw new RunnerClaimConflictError('machine_claimed')
                if (message === 'UNIQUE constraint failed: runner_active_claims.organization_id, runner_active_claims.profile') throw new RunnerClaimConflictError('profile_claimed')
                throw error
            }
            this.db.prepare(`INSERT INTO runner_machine_projections
                (runner_id, organization_id, machine_id, metadata, runner_state, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(
                input.runnerId,
                input.organizationId,
                input.machineId,
                JSON.stringify(input.metadata),
                JSON.stringify(input.runnerState),
                input.createdAt,
                input.createdAt
            )
            const runner = this.findRunner(input.organizationId, input.runnerId)
            if (!runner) throw new Error('Runner projection creation failed.')
            return runner
        })
    }

    createRunnerCredential(input: { id:string; runnerId:string; organizationId:string; secretHash:string; generation:number; createdAt:number }): void {
        this.db.prepare(`INSERT INTO runner_credentials(id,runner_id,organization_id,secret_hash,generation,created_at) VALUES(?,?,?,?,?,?)`).run(input.id,input.runnerId,input.organizationId,input.secretHash,input.generation,input.createdAt)
    }

    findRunnerCredential(organizationId:string, credentialId:string):StoredRunnerCredential|null {
        const r=this.db.prepare('SELECT id,runner_id,organization_id,secret_hash,generation,revoked_at FROM runner_credentials WHERE organization_id=? AND id=?').get(organizationId,credentialId) as {id:string;runner_id:string;organization_id:string;secret_hash:string;generation:number;revoked_at:number|null}|null
        return r?{id:r.id,runnerId:r.runner_id,organizationId:r.organization_id,secretHash:r.secret_hash,generation:r.generation,revokedAt:r.revoked_at}:null
    }

    findRunnerCredentialById(credentialId:string):StoredRunnerCredential|null { const r=this.db.prepare('SELECT id,runner_id,organization_id,secret_hash,generation,revoked_at FROM runner_credentials WHERE id=?').get(credentialId) as {id:string;runner_id:string;organization_id:string;secret_hash:string;generation:number;revoked_at:number|null}|null;return r?{id:r.id,runnerId:r.runner_id,organizationId:r.organization_id,secretHash:r.secret_hash,generation:r.generation,revokedAt:r.revoked_at}:null }

    rotateRunnerCredential(input:{organizationId:string;runnerId:string;expectedGeneration:number;id:string;secretHash:string;now:number}):'rotated'|'not_found'|'conflict' {
        return this.transaction(() => {
            const runner=this.findRunner(input.organizationId,input.runnerId)
            if(!runner||runner.status!=='active')return'not_found'
            const current=this.db.prepare('SELECT id,generation FROM runner_credentials WHERE organization_id=? AND runner_id=? AND revoked_at IS NULL ORDER BY generation DESC LIMIT 1').get(input.organizationId,input.runnerId) as {id:string;generation:number}|null
            if(!current||current.generation!==input.expectedGeneration)return'conflict'
            const changed=this.db.prepare('UPDATE runner_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND generation=?').run(input.now,current.id,input.expectedGeneration)
            if(changed.changes!==1)return'conflict'
            this.createRunnerCredential({id:input.id,runnerId:input.runnerId,organizationId:input.organizationId,secretHash:input.secretHash,generation:input.expectedGeneration+1,createdAt:input.now})
            return'rotated'
        })
    }

    revokeRunnerAccess(input:{organizationId:string;runnerId:string;now:number}):'revoked'|'already_revoked'|'not_found' {
        return this.transaction(() => {
            const runner=this.findRunner(input.organizationId,input.runnerId)
            if(!runner)return'not_found'
            if(runner.status==='revoked')return'already_revoked'
            if(runner.status==='archived')return'not_found'
            this.db.prepare("UPDATE runners SET status='revoked',revoked_at=? WHERE organization_id=? AND id=? AND status='active'").run(input.now,input.organizationId,input.runnerId)
            this.db.prepare('UPDATE runner_credentials SET revoked_at=? WHERE organization_id=? AND runner_id=? AND revoked_at IS NULL').run(input.now,input.organizationId,input.runnerId)
            this.db.prepare('DELETE FROM runner_active_claims WHERE organization_id=? AND runner_id=?').run(input.organizationId,input.runnerId)
            this.db.prepare('DELETE FROM runner_machine_projections WHERE organization_id=? AND runner_id=?').run(input.organizationId,input.runnerId)
            this.db.prepare("DELETE FROM resource_grants WHERE organization_id=? AND ((resource_type='runner' AND resource_id=?) OR (resource_type='session' AND resource_id IN (SELECT session_id FROM session_security_projections WHERE organization_id=? AND runner_id=?)))").run(input.organizationId,input.runnerId,input.organizationId,input.runnerId)
            this.db.prepare('DELETE FROM session_security_projections WHERE organization_id=? AND runner_id=?').run(input.organizationId,input.runnerId)
            this.db.prepare('INSERT OR IGNORE INTO runner_tombstones(runner_id,cleanup_required,revoked_at) VALUES(?,1,?)').run(input.runnerId,input.now)
            return'revoked'
        })
    }

    findRunner(organizationId: string, runnerId: string): StoredSharedRunner | null {
        const row = this.db.prepare(`SELECT id, organization_id, owner_membership_id, machine_id, profile, name, status
            FROM runners WHERE organization_id = ? AND id = ?`).get(organizationId, runnerId) as {
                id: string
                organization_id: string
                owner_membership_id: string
                machine_id: string
                profile: string
                name: string
                status: StoredSharedRunner['status']
            } | null
        return row ? {
            id: row.id,
            organizationId: row.organization_id,
            ownerMembershipId: row.owner_membership_id,
            machineId: row.machine_id,
            profile: row.profile,
            name: row.name,
            status: row.status
        } : null
    }

    findRunnerByMachine(organizationId: string, machineId: string): StoredSharedRunner | null {
        const row = this.db.prepare(`SELECT id FROM runners
            WHERE organization_id = ? AND machine_id = ? AND status = 'active'`
        ).get(organizationId, machineId) as { id: string } | null
        return row ? this.findRunner(organizationId, row.id) : null
    }

    listRunners(organizationId: string): Array<StoredSharedRunner & { createdAt: number }> {
        const rows = this.db.prepare(`SELECT id, organization_id, owner_membership_id, machine_id, profile, name, status, created_at
            FROM runners WHERE organization_id = ? ORDER BY created_at DESC`
        ).all(organizationId) as Array<{
            id: string; organization_id: string; owner_membership_id: string; machine_id: string
            profile: string; name: string; status: StoredSharedRunner['status']; created_at: number
        }>
        return rows.map((r) => ({ id: r.id, organizationId: r.organization_id, ownerMembershipId: r.owner_membership_id, machineId: r.machine_id, profile: r.profile, name: r.name, status: r.status, createdAt: r.created_at }))
    }

    transferRunnerOwnership(organizationId: string, runnerId: string, targetMembershipId: string): 'transferred' | 'not_found' | 'same_owner' | 'target_not_found' {
        const runner = this.findRunner(organizationId, runnerId)
        if (!runner) return 'not_found'
        if (runner.status !== 'active') return 'not_found'
        if (runner.ownerMembershipId === targetMembershipId) return 'same_owner'
        if (!this.membershipExists(organizationId, targetMembershipId)) return 'target_not_found'
        this.db.prepare('UPDATE runners SET owner_membership_id = ? WHERE organization_id = ? AND id = ?')
            .run(targetMembershipId, organizationId, runnerId)
        return 'transferred'
    }

    cleanupRunnerTombstone(organizationId: string, runnerId: string): 'cleaned' | 'not_found' {
        const runner = this.findRunner(organizationId, runnerId)
        if (!runner || runner.status !== 'revoked') return 'not_found'
        this.db.prepare('UPDATE runner_tombstones SET cleanup_required = 0 WHERE runner_id = ?').run(runnerId)
        this.db.prepare("UPDATE runners SET status='archived' WHERE organization_id=? AND id=?").run(organizationId, runnerId)
        return 'cleaned'
    }

    resolveEffectiveGrants(input: {
        organizationId: string
        membershipId: string
        resourceType: 'runner' | 'session'
        resourceId: string
        now: number
    }): StoredEffectiveGrant[] {
        const rows = this.db.prepare(`
            SELECT g.capability, g.expires_at, 'direct' source, g.id source_id
            FROM resource_grants g
            WHERE g.organization_id = ? AND g.principal_type = 'user' AND g.principal_id = ?
              AND g.resource_type = ? AND g.resource_id = ?
              AND (g.expires_at IS NULL OR g.expires_at > ?)
              AND (g.resource_type != 'session' OR EXISTS (SELECT 1 FROM session_security_projections sp JOIN runners sr
                  ON sr.id = sp.runner_id AND sr.organization_id = sp.organization_id AND sr.status = 'active'
                  WHERE sp.organization_id = g.organization_id AND sp.session_id = g.resource_id))
            UNION ALL
            SELECT g.capability, g.expires_at, 'team' source, g.principal_id source_id
            FROM resource_grants g
            JOIN teams t ON t.id = g.principal_id AND t.organization_id = g.organization_id AND t.archived_at IS NULL
            JOIN team_memberships tm ON tm.team_id = t.id AND tm.organization_id = t.organization_id AND tm.membership_id = ?
            WHERE g.organization_id = ? AND g.principal_type = 'team'
              AND g.resource_type = ? AND g.resource_id = ?
              AND (g.expires_at IS NULL OR g.expires_at > ?)
              AND (g.resource_type != 'session' OR EXISTS (SELECT 1 FROM session_security_projections sp JOIN runners sr
                  ON sr.id = sp.runner_id AND sr.organization_id = sp.organization_id AND sr.status = 'active'
                  WHERE sp.organization_id = g.organization_id AND sp.session_id = g.resource_id))
        `).all(
            input.organizationId, input.membershipId, input.resourceType, input.resourceId, input.now,
            input.membershipId, input.organizationId, input.resourceType, input.resourceId, input.now
        ) as Array<{ capability: StoredEffectiveGrant['capability']; expires_at: number | null; source: StoredEffectiveGrant['source']; source_id: string }>
        return rows.map((row) => ({ capability: row.capability, expiresAt: row.expires_at, source: row.source, sourceId: row.source_id }))
    }

    listTeams(organizationId: string): StoredTeam[] { return (this.db.prepare(`SELECT id, organization_id, name, archived_at FROM teams WHERE organization_id = ? ORDER BY name`).all(organizationId) as Array<{id:string;organization_id:string;name:string;archived_at:number|null}>).map((r) => ({ id:r.id, organizationId:r.organization_id, name:r.name, archivedAt:r.archived_at })) }
    findTeam(organizationId: string, teamId: string): StoredTeam | null { const r=this.db.prepare('SELECT id, organization_id, name, archived_at FROM teams WHERE organization_id=? AND id=?').get(organizationId,teamId) as {id:string;organization_id:string;name:string;archived_at:number|null}|null; return r?{id:r.id,organizationId:r.organization_id,name:r.name,archivedAt:r.archived_at}:null }
    membershipExists(organizationId:string,membershipId:string):boolean { return Boolean(this.db.prepare("SELECT 1 FROM memberships WHERE organization_id=? AND id=? AND status='active'").get(organizationId,membershipId)) }
    createTeam(input:{id:string;organizationId:string;name:string;createdAt:number}):StoredTeam { this.db.prepare('INSERT INTO teams(id,organization_id,name,created_at) VALUES(?,?,?,?)').run(input.id,input.organizationId,input.name,input.createdAt); return {id:input.id,organizationId:input.organizationId,name:input.name,archivedAt:null} }
    renameTeam(org:string,id:string,name:string):'updated'|'not_found'|'archived' { const t=this.findTeam(org,id); if(!t)return'not_found'; if(t.archivedAt!==null)return'archived'; this.db.prepare('UPDATE teams SET name=? WHERE organization_id=? AND id=?').run(name,org,id); return'updated' }
    archiveTeam(org:string,id:string,at:number):'archived'|'not_found'|'already_archived' { const t=this.findTeam(org,id); if(!t)return'not_found'; if(t.archivedAt!==null)return'already_archived'; this.db.prepare('UPDATE teams SET archived_at=? WHERE organization_id=? AND id=?').run(at,org,id); return'archived' }
    listTeamMemberships(org:string,teamId:string):StoredTeamMembership[] { return this.db.prepare('SELECT membership_id membershipId, role FROM team_memberships WHERE organization_id=? AND team_id=? ORDER BY membership_id').all(org,teamId) as StoredTeamMembership[] }
    isTeamOwner(org:string,teamId:string,memberId:string):boolean { return Boolean(this.db.prepare("SELECT 1 FROM team_memberships tm JOIN teams t ON t.id=tm.team_id AND t.organization_id=tm.organization_id WHERE tm.organization_id=? AND tm.team_id=? AND tm.membership_id=? AND tm.role='owner' AND t.archived_at IS NULL").get(org,teamId,memberId)) }
    addTeamMembership(input:{organizationId:string;teamId:string;membershipId:string;role:'owner'|'member';createdAt:number}):'added'|'not_found'|'archived' { const t=this.findTeam(input.organizationId,input.teamId); if(!t)return'not_found'; if(t.archivedAt!==null)return'archived'; if(!this.membershipExists(input.organizationId,input.membershipId))return'not_found'; this.db.prepare('INSERT INTO team_memberships(team_id,membership_id,organization_id,role,created_at) VALUES(?,?,?,?,?)').run(input.teamId,input.membershipId,input.organizationId,input.role,input.createdAt); return'added' }
    updateTeamMembershipRole(org:string,teamId:string,memberId:string,role:'owner'|'member'):'updated'|'not_found'|'archived'|'last_owner' { const t=this.findTeam(org,teamId); if(!t)return'not_found'; if(t.archivedAt!==null)return'archived'; const c=this.db.prepare('SELECT role FROM team_memberships WHERE organization_id=? AND team_id=? AND membership_id=?').get(org,teamId,memberId) as {role:'owner'|'member'}|null; if(!c)return'not_found'; if(c.role==='owner'&&role==='member'&&this.countOwners(org,teamId)===1)return'last_owner'; this.db.prepare('UPDATE team_memberships SET role=? WHERE organization_id=? AND team_id=? AND membership_id=?').run(role,org,teamId,memberId); return'updated' }
    transferTeamOwnership(org:string,teamId:string,from:string,to:string):'transferred'|'same_member'|'not_found'|'archived'|'target_owner' { if(from===to)return'same_member'; const t=this.findTeam(org,teamId); if(!t)return'not_found'; if(t.archivedAt!==null)return'archived'; if(!this.isTeamOwner(org,teamId,from))return'not_found'; const target=this.db.prepare('SELECT tm.role,m.status FROM team_memberships tm JOIN memberships m ON m.id=tm.membership_id AND m.organization_id=tm.organization_id WHERE tm.organization_id=? AND tm.team_id=? AND tm.membership_id=?').get(org,teamId,to) as {role:'owner'|'member';status:string}|null; if(!target||target.status!=='active')return'not_found'; if(target.role==='owner')return'target_owner'; this.db.prepare("UPDATE team_memberships SET role='owner' WHERE organization_id=? AND team_id=? AND membership_id=?").run(org,teamId,to); this.db.prepare("UPDATE team_memberships SET role='member' WHERE organization_id=? AND team_id=? AND membership_id=?").run(org,teamId,from); return'transferred' }
    removeTeamMembership(org:string,teamId:string,memberId:string):'removed'|'not_found'|'archived'|'last_owner' { const t=this.findTeam(org,teamId); if(!t)return'not_found'; if(t.archivedAt!==null)return'archived'; const c=this.db.prepare('SELECT role FROM team_memberships WHERE organization_id=? AND team_id=? AND membership_id=?').get(org,teamId,memberId) as {role:'owner'|'member'}|null; if(!c)return'not_found'; if(c.role==='owner'&&this.countOwners(org,teamId)===1)return'last_owner'; this.db.prepare('DELETE FROM team_memberships WHERE organization_id=? AND team_id=? AND membership_id=?').run(org,teamId,memberId); return'removed' }

    upsertSessionProjectionByMachine(input:{sessionId:string;organizationId:string;machineId:string;updatedAt:number}):boolean { return this.transaction(()=>{ const tomb=this.db.prepare('SELECT retired_at FROM session_security_tombstones WHERE session_id=? AND organization_id=?').get(input.sessionId,input.organizationId) as {retired_at:number}|null; if(tomb&&tomb.retired_at>=input.updatedAt)return false; const runner=this.db.prepare("SELECT id FROM runners WHERE organization_id=? AND machine_id=? AND status='active'").get(input.organizationId,input.machineId) as {id:string}|null; if(!runner){this.retireSessionProjection(input.organizationId,input.sessionId,input.updatedAt);return false} const prior=this.db.prepare('SELECT runner_id, updated_at FROM session_security_projections WHERE session_id=? AND organization_id=?').get(input.sessionId,input.organizationId) as {runner_id:string;updated_at:number}|null; if(prior&&prior.updated_at>=input.updatedAt)return false; if(prior&&prior.runner_id!==runner.id)this.db.prepare("DELETE FROM resource_grants WHERE organization_id=? AND resource_type='session' AND resource_id=?").run(input.organizationId,input.sessionId); this.db.prepare('DELETE FROM session_security_tombstones WHERE session_id=? AND organization_id=?').run(input.sessionId,input.organizationId); this.db.prepare('INSERT INTO session_security_projections(session_id,organization_id,runner_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET organization_id=excluded.organization_id,runner_id=excluded.runner_id,updated_at=excluded.updated_at WHERE excluded.updated_at>session_security_projections.updated_at').run(input.sessionId,input.organizationId,runner.id,input.updatedAt); return true }) }
    retireSessionProjection(org:string,sessionId:string,retiredAt:number):void { this.transaction(()=>{ const current=this.db.prepare('SELECT updated_at FROM session_security_projections WHERE session_id=? AND organization_id=?').get(sessionId,org) as {updated_at:number}|null; if(current&&current.updated_at>retiredAt)return; this.db.prepare("DELETE FROM resource_grants WHERE organization_id=? AND resource_type='session' AND resource_id=?").run(org,sessionId); this.db.prepare('DELETE FROM session_security_projections WHERE session_id=? AND organization_id=?').run(sessionId,org); this.db.prepare('INSERT INTO session_security_tombstones(session_id,organization_id,retired_at) VALUES(?,?,?) ON CONFLICT(session_id,organization_id) DO UPDATE SET retired_at=MAX(retired_at,excluded.retired_at)').run(sessionId,org,retiredAt) }) }
    reconcileSessionProjections(
        org: string,
        sessions: ReadonlyArray<{ sessionId: string; machineId: string; updatedAt: number }>,
        reconciledAt: number
    ): void {
        this.transaction(() => {
            const current = this.db.prepare(`SELECT session_id FROM session_security_projections
                WHERE organization_id = ?`).all(org) as Array<{ session_id: string }>
            const snapshotIds = new Set(sessions.map((session) => session.sessionId))
            for (const projection of current) {
                if (!snapshotIds.has(projection.session_id)) {
                    this.retireSessionProjection(org, projection.session_id, reconciledAt)
                }
            }
            for (const session of sessions) {
                this.upsertSessionProjectionByMachine({ organizationId: org, ...session })
            }
        })
    }
    findSessionRunner(org:string,sessionId:string):StoredSharedRunner|null { const r=this.db.prepare("SELECT r.id FROM session_security_projections s JOIN runners r ON r.id=s.runner_id AND r.organization_id=s.organization_id WHERE s.organization_id=? AND s.session_id=? AND r.status='active'").get(org,sessionId) as {id:string}|null; return r?this.findRunner(org,r.id):null }
    createResourceGrant(input:StoredResourceGrant&{createdByMembershipId:string;createdAt:number}):StoredResourceGrant { this.db.prepare('INSERT INTO resource_grants(id,organization_id,principal_type,principal_id,resource_type,resource_id,capability,expires_at,created_by_membership_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.id,input.organizationId,input.principalType,input.principalId,input.resourceType,input.resourceId,input.capability,input.expiresAt,input.createdByMembershipId,input.createdAt); return input }
    findResourceGrant(org:string,id:string):StoredResourceGrant|null {
        const r = this.db.prepare(`SELECT id, organization_id, principal_type, principal_id,
            resource_type, resource_id, capability, expires_at
            FROM resource_grants WHERE organization_id = ? AND id = ?`).get(org, id) as {
                id: string
                organization_id: string
                principal_type: StoredResourceGrant['principalType']
                principal_id: string
                resource_type: StoredResourceGrant['resourceType']
                resource_id: string
                capability: StoredResourceGrant['capability']
                expires_at: number | null
            } | null
        return r ? {
            id: r.id,
            organizationId: r.organization_id,
            principalType: r.principal_type,
            principalId: r.principal_id,
            resourceType: r.resource_type,
            resourceId: r.resource_id,
            capability: r.capability,
            expiresAt: r.expires_at
        } : null
    }
    listDueResourceGrants(org: string, now: number, limit = 100): StoredResourceGrant[] {
        return (this.db.prepare(`SELECT id, organization_id, principal_type, principal_id, resource_type,
            resource_id, capability, expires_at FROM resource_grants
            WHERE organization_id = ? AND expires_at IS NOT NULL AND expires_at <= ?
            ORDER BY expires_at, id LIMIT ?`
        ).all(org, now, limit) as Array<{
            id: string; organization_id: string; principal_type: StoredResourceGrant['principalType'];
            principal_id: string; resource_type: StoredResourceGrant['resourceType']; resource_id: string;
            capability: StoredResourceGrant['capability']; expires_at: number
        }>).map((row) => ({ id: row.id, organizationId: row.organization_id, principalType: row.principal_type,
            principalId: row.principal_id, resourceType: row.resource_type, resourceId: row.resource_id,
            capability: row.capability, expiresAt: row.expires_at }))
    }
    deleteResourceGrant(org:string,id:string):boolean { return this.db.prepare('DELETE FROM resource_grants WHERE organization_id=? AND id=?').run(org,id).changes===1 }
    listResourceGrants(org: string): StoredResourceGrantDetail[] {
        return (this.db.prepare(`SELECT id, organization_id, principal_type, principal_id, resource_type,
            resource_id, capability, expires_at, created_by_membership_id, created_at
            FROM resource_grants WHERE organization_id = ? ORDER BY created_at DESC, id`).all(org) as Array<{
                id: string; organization_id: string; principal_type: StoredResourceGrant['principalType'];
                principal_id: string; resource_type: StoredResourceGrant['resourceType']; resource_id: string;
                capability: StoredResourceGrant['capability']; expires_at: number | null;
                created_by_membership_id: string; created_at: number
            }>).map((row) => ({
                id: row.id, organizationId: row.organization_id, principalType: row.principal_type,
                principalId: row.principal_id, resourceType: row.resource_type, resourceId: row.resource_id,
                capability: row.capability, expiresAt: row.expires_at,
                createdByMembershipId: row.created_by_membership_id, createdAt: row.created_at
            }))
    }
    listAuditEvents(org: string, limit = 100): StoredAuditEvent[] {
        const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
        return (this.db.prepare(`SELECT id, actor_type, actor_id, action, resource_type, resource_id,
            outcome, metadata, created_at FROM audit_events WHERE organization_id = ?
            ORDER BY created_at DESC, id DESC LIMIT ?`).all(org, boundedLimit) as Array<{
                id: string; actor_type: StoredAuditEvent['actorType']; actor_id: string; action: string;
                resource_type: string; resource_id: string; outcome: StoredAuditEvent['outcome'];
                metadata: string; created_at: number
            }>).map((row) => ({
                id: row.id, actorType: row.actor_type, actorId: row.actor_id, action: row.action,
                resourceType: row.resource_type, resourceId: row.resource_id, outcome: row.outcome,
                metadata: JSON.parse(row.metadata) as StoredAuditEvent['metadata'], createdAt: row.created_at
            }))
    }
    private countOwners(org:string,teamId:string):number { return (this.db.prepare("SELECT count(*) count FROM team_memberships WHERE organization_id=? AND team_id=? AND role='owner'").get(org,teamId) as {count:number}).count }

    appendAuditEvent(input: {
        id: string
        organizationId: string
        actorType: 'user' | 'runner'
        actorId: string
        action: string
        resourceType: string
        resourceId: string
        outcome: 'success' | 'denied' | 'failure'
        metadata?: Readonly<Record<string, string | number | boolean | null>>
        createdAt: number
    }): void {
        this.db.prepare(`INSERT INTO audit_events
            (id, organization_id, actor_type, actor_id, action, resource_type, resource_id, outcome, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            input.id, input.organizationId, input.actorType, input.actorId, input.action,
            input.resourceType, input.resourceId, input.outcome, JSON.stringify(input.metadata ?? {}), input.createdAt
        )
    }

    createOidcTransaction(input: {
        stateHash: string
        nonceHash: string
        codeVerifier: string
        redirectUri: string
        expiresAt: number
        createdAt: number
        invitationTokenHash?: string
    }): void {
        this.cleanupExpiredSecurityState(input.createdAt)
        this.db.prepare(`INSERT INTO oidc_transactions
            (state_hash, nonce_hash, code_verifier, redirect_uri, invitation_token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(input.stateHash, input.nonceHash, input.codeVerifier, input.redirectUri, input.invitationTokenHash ?? null, input.expiresAt, input.createdAt)
    }

    consumeOidcTransaction(stateHash: string, now: number): StoredOidcTransaction | null {
        return this.transaction(() => {
            const row = this.db.prepare(`SELECT nonce_hash, code_verifier, redirect_uri, invitation_token_hash
                FROM oidc_transactions WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`
            ).get(stateHash, now) as { nonce_hash: string; code_verifier: string; redirect_uri: string; invitation_token_hash: string | null } | null
            if (!row) return null
            const updated = this.db.prepare(`UPDATE oidc_transactions SET consumed_at = ?
                WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`).run(now, stateHash, now)
            return updated.changes === 1
                ? { nonceHash: row.nonce_hash, codeVerifier: row.code_verifier, redirectUri: row.redirect_uri, invitationTokenHash: row.invitation_token_hash }
                : null
        })
    }

    createInvitation(input: {
        id: string
        organizationId: string
        email: string
        tokenHash: string
        role: 'admin' | 'member' | 'viewer'
        expiresAt: number
        createdAt: number
    }): void {
        const email = input.email.trim().toLowerCase()
        this.db.prepare(`INSERT INTO invitations
            (id, organization_id, email, token_hash, role, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(input.id, input.organizationId, email, input.tokenHash, input.role, input.expiresAt, input.createdAt)
    }

    listInvitations(organizationId: string): StoredInvitation[] {
        const rows = this.db.prepare(`SELECT id, organization_id, email, role, expires_at, claimed_at, cancelled_at, created_at
            FROM invitations WHERE organization_id = ? ORDER BY created_at DESC, id DESC`
        ).all(organizationId) as Array<{
            id: string; organization_id: string; email: string; role: StoredInvitation['role']; expires_at: number;
            claimed_at: number | null; cancelled_at: number | null; created_at: number
        }>
        return rows.map((row) => ({
            id: row.id, organizationId: row.organization_id, email: row.email, role: row.role,
            expiresAt: row.expires_at, claimedAt: row.claimed_at, cancelledAt: row.cancelled_at, createdAt: row.created_at
        }))
    }

    cancelInvitation(organizationId: string, invitationId: string, now: number): boolean {
        return this.db.prepare(`UPDATE invitations SET cancelled_at = ?
            WHERE organization_id = ? AND id = ? AND claimed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`
        ).run(now, organizationId, invitationId, now).changes === 1
    }

    claimInvitation(input: {
        tokenHash: string
        verifiedEmail: string
        identityId: string
        issuer: string
        subject: string
        membershipId: string
        now: number
    }): { invitationId: string; membershipId: string; organizationId: string; role: 'admin' | 'member' | 'viewer' } | null {
        return this.claimInvitationHash({ ...input, tokenHash: input.tokenHash })
    }

    claimInvitationHash(input: {
        tokenHash: string
        verifiedEmail: string
        identityId: string
        issuer: string
        subject: string
        membershipId: string
        now: number
    }): { invitationId: string; membershipId: string; organizationId: string; role: 'admin' | 'member' | 'viewer' } | null {
        return this.transaction(() => {
            const invitation = this.db.prepare(`SELECT id, organization_id, email, role
                FROM invitations WHERE token_hash = ? AND claimed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`
            ).get(input.tokenHash, input.now) as { id: string; organization_id: string; email: string; role: 'admin' | 'member' | 'viewer' } | null
            if (!invitation || invitation.email !== input.verifiedEmail) return null
            const consumed = this.db.prepare(`UPDATE invitations SET claimed_at = ?
                WHERE id = ? AND claimed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`
            ).run(input.now, invitation.id, input.now)
            if (consumed.changes !== 1) return null
            const existingIdentity = this.db.prepare('SELECT id, verified_email FROM identities WHERE issuer = ? AND subject = ?')
                .get(input.issuer, input.subject) as { id: string; verified_email: string } | null
            if (existingIdentity && existingIdentity.verified_email !== input.verifiedEmail) {
                throw new Error('OIDC identity email does not match the invitation.')
            }
            const identityId = existingIdentity?.id ?? input.identityId
            this.db.prepare(`INSERT OR IGNORE INTO identities(id, issuer, subject, verified_email, created_at)
                VALUES (?, ?, ?, ?, ?)`
            ).run(identityId, input.issuer, input.subject, input.verifiedEmail, input.now)
            const existingMembership = this.db.prepare(`SELECT id, identity_id FROM memberships
                WHERE organization_id = ? AND invited_email = ?`
            ).get(invitation.organization_id, input.verifiedEmail) as { id: string; identity_id: string | null } | null
            if (existingMembership?.identity_id && existingMembership.identity_id !== identityId) {
                throw new Error('Membership identity binding is immutable.')
            }
            this.db.prepare(`INSERT INTO memberships
                (id, organization_id, identity_id, invited_email, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'active', ?)
                ON CONFLICT(organization_id, invited_email) DO UPDATE SET
                    identity_id = excluded.identity_id, role = excluded.role, status = 'active'
                WHERE memberships.identity_id IS NULL`
            ).run(input.membershipId, invitation.organization_id, identityId, input.verifiedEmail, invitation.role, input.now)
            const membership = this.db.prepare(`SELECT id FROM memberships WHERE organization_id = ? AND invited_email = ?`)
                .get(invitation.organization_id, input.verifiedEmail) as { id: string }
            return { invitationId: invitation.id, membershipId: membership.id, organizationId: invitation.organization_id, role: invitation.role }
        })
    }

    bootstrapFirstAdmin(input: {
        organizationId: string
        configuredEmail: string
        verifiedEmail: string
        identityId: string
        issuer: string
        subject: string
        membershipId: string
        now: number
    }): { membershipId: string; organizationId: string; role: 'admin' } | null {
        if (input.configuredEmail !== input.verifiedEmail) return null
        return this.transaction(() => {
            const identityMembership = this.findMembershipByIdentity(input.issuer, input.subject)
            if (identityMembership) {
                return identityMembership.status === 'active' && identityMembership.organizationId === input.organizationId
                    && identityMembership.role === 'admin'
                    ? { membershipId: identityMembership.membershipId, organizationId: input.organizationId, role: 'admin' }
                    : null
            }
            const existing = this.db.prepare(`SELECT m.id, i.issuer, i.subject FROM memberships m
                JOIN identities i ON i.id = m.identity_id
                WHERE m.organization_id = ? AND m.role = 'admin' AND m.status = 'active' LIMIT 1`
            ).get(input.organizationId) as { id: string; issuer: string; subject: string } | null
            if (existing) {
                return existing.issuer === input.issuer && existing.subject === input.subject
                    ? { membershipId: existing.id, organizationId: input.organizationId, role: 'admin' }
                    : null
            }
            this.db.prepare(`INSERT INTO identities(id, issuer, subject, verified_email, created_at)
                VALUES (?, ?, ?, ?, ?)`
            ).run(input.identityId, input.issuer, input.subject, input.verifiedEmail, input.now)
            this.db.prepare(`INSERT INTO memberships
                (id, organization_id, identity_id, invited_email, role, status, created_at)
                VALUES (?, ?, ?, ?, 'admin', 'active', ?)`
            ).run(input.membershipId, input.organizationId, input.identityId, input.verifiedEmail, input.now)
            return { membershipId: input.membershipId, organizationId: input.organizationId, role: 'admin' }
        })
    }

    createWebSession(input: { idHash: string; membershipId: string; csrfHash: string; expiresAt: number; createdAt: number }): void {
        this.cleanupExpiredSecurityState(input.createdAt)
        this.db.prepare(`INSERT INTO web_sessions(id_hash, membership_id, csrf_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)`
        ).run(input.idHash, input.membershipId, input.csrfHash, input.expiresAt, input.createdAt)
    }

    getValidWebSession(idHash: string, now: number): StoredWebSession | null {
        const row = this.db.prepare(`SELECT ws.membership_id, ws.csrf_hash, m.organization_id, m.role
            FROM web_sessions ws JOIN memberships m ON m.id = ws.membership_id
            JOIN organizations o ON o.id = m.organization_id
            WHERE ws.id_hash = ? AND ws.revoked_at IS NULL AND ws.expires_at > ?
              AND m.status = 'active' AND o.status = 'active'`
        ).get(idHash, now) as { membership_id: string; csrf_hash: string; organization_id: string; role: StoredWebSession['role'] } | null
        return row ? { membershipId: row.membership_id, csrfHash: row.csrf_hash, organizationId: row.organization_id, role: row.role } : null
    }

    revokeWebSession(idHash: string, now: number): boolean {
        return this.db.prepare('UPDATE web_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
            .run(now, idHash).changes === 1
    }

    findMembershipByIdentity(issuer: string, subject: string): {
        membershipId: string
        organizationId: string
        role: 'admin' | 'member' | 'viewer'
        status: 'invited' | 'active' | 'disabled'
    } | null {
        const row = this.db.prepare(`SELECT m.id, m.organization_id, m.role, m.status
            FROM identities i JOIN memberships m ON m.identity_id = i.id
            WHERE i.issuer = ? AND i.subject = ? LIMIT 1`
        ).get(issuer, subject) as { id: string; organization_id: string; role: 'admin' | 'member' | 'viewer'; status: 'invited' | 'active' | 'disabled' } | null
        return row ? { membershipId: row.id, organizationId: row.organization_id, role: row.role, status: row.status } : null
    }

    findMembershipById(organizationId: string, membershipId: string): {
        membershipId: string
        invitedEmail: string
        role: 'admin' | 'member' | 'viewer'
        status: 'invited' | 'active' | 'disabled'
        identityId: string | null
        identityIssuer: string | null
        identitySubject: string | null
        createdAt: number
    } | null {
        const row = this.db.prepare(`SELECT m.id, m.invited_email, m.role, m.status, m.created_at,
            m.identity_id, i.issuer, i.subject
            FROM memberships m LEFT JOIN identities i ON i.id = m.identity_id
            WHERE m.organization_id = ? AND m.id = ?`
        ).get(organizationId, membershipId) as {
            id: string; invited_email: string; role: 'admin' | 'member' | 'viewer'
            status: 'invited' | 'active' | 'disabled'; created_at: number
            identity_id: string | null; issuer: string | null; subject: string | null
        } | null
        return row ? {
            membershipId: row.id, invitedEmail: row.invited_email, role: row.role, status: row.status,
            identityId: row.identity_id, identityIssuer: row.issuer, identitySubject: row.subject,
            createdAt: row.created_at
        } : null
    }

    listMemberships(organizationId: string): Array<{
        membershipId: string
        invitedEmail: string
        role: 'admin' | 'member' | 'viewer'
        status: 'invited' | 'active' | 'disabled'
        identityId: string | null
        identityIssuer: string | null
        identitySubject: string | null
        createdAt: number
    }> {
        const rows = this.db.prepare(`SELECT m.id, m.invited_email, m.role, m.status, m.created_at,
            m.identity_id, i.issuer, i.subject
            FROM memberships m LEFT JOIN identities i ON i.id = m.identity_id
            WHERE m.organization_id = ? ORDER BY m.invited_email`
        ).all(organizationId) as Array<{
            id: string; invited_email: string; role: 'admin' | 'member' | 'viewer'
            status: 'invited' | 'active' | 'disabled'; created_at: number
            identity_id: string | null; issuer: string | null; subject: string | null
        }>
        return rows.map((row) => ({
            membershipId: row.id, invitedEmail: row.invited_email, role: row.role, status: row.status,
            identityId: row.identity_id, identityIssuer: row.issuer, identitySubject: row.subject,
            createdAt: row.created_at
        }))
    }

    countActiveAdmins(organizationId: string): number {
        return (this.db.prepare(`SELECT count(*) count FROM memberships
            WHERE organization_id = ? AND role = 'admin' AND status = 'active'`
        ).get(organizationId) as { count: number }).count
    }

    updateMembershipRole(organizationId: string, membershipId: string, role: 'admin' | 'member' | 'viewer'): 'updated' | 'not_found' {
        const result = this.db.prepare(`UPDATE memberships SET role = ?
            WHERE organization_id = ? AND id = ? AND status = 'active'`
        ).run(role, organizationId, membershipId)
        return result.changes === 1 ? 'updated' : 'not_found'
    }

    updateMembershipStatus(organizationId: string, membershipId: string, status: 'active' | 'disabled'): 'updated' | 'not_found' {
        const result = this.db.prepare(`UPDATE memberships SET status = ?
            WHERE organization_id = ? AND id = ?`
        ).run(status, organizationId, membershipId)
        return result.changes === 1 ? 'updated' : 'not_found'
    }

    revokeMembershipSessions(membershipId: string, now: number): number {
        return this.db.prepare(`UPDATE web_sessions SET revoked_at = ?
            WHERE membership_id = ? AND revoked_at IS NULL`
        ).run(now, membershipId).changes
    }

    appendOutboxEvent(input: { id: string; organizationId: string; name: string; resourceType: string; resourceId: string; createdAt: number }): void {
        this.db.prepare(`INSERT INTO outbox_events(id, organization_id, name, resource_type, resource_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`
        ).run(input.id, input.organizationId, input.name, input.resourceType, input.resourceId, input.createdAt)
    }

    markOutboxEventPublished(id: string, publishedAt: number): void {
        this.db.prepare('UPDATE outbox_events SET published_at = ? WHERE id = ? AND published_at IS NULL').run(publishedAt, id)
    }

    listPendingOutboxEvents(limit = 100): StoredOutboxEvent[] {
        const rows = this.db.prepare(`SELECT id, name, organization_id, resource_type, resource_id
            FROM outbox_events WHERE published_at IS NULL ORDER BY created_at, id LIMIT ?`).all(limit) as Array<{
                id: string; name: string; organization_id: string; resource_type: string; resource_id: string
            }>
        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            organizationId: row.organization_id,
            resourceType: row.resource_type,
            resourceId: row.resource_id
        }))
    }

    cleanupExpiredSecurityState(now: number): void {
        this.transaction(() => {
            this.db.prepare('DELETE FROM oidc_transactions WHERE expires_at <= ?').run(now)
            this.db.prepare('DELETE FROM web_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now)
        })
    }

    private initialize(options: SharedHubStoreOptions): void {
        const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()
        const marker = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shared_hub_meta'").get()
        if (legacy && !marker) {
            throw new Error('Legacy HAPI database rejected. Keep it as an offline backup and configure a new database path for Shared Hub.')
        }
        this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
        this.db.transaction(() => {
            this.db.exec(SHARED_HUB_SCHEMA_SQL)
            const current = this.db.prepare('SELECT marker, schema_version, organization_id FROM shared_hub_meta WHERE singleton = 1').get() as { marker: string; schema_version: number; organization_id: string } | null
            if (current && (current.marker !== SHARED_HUB_SCHEMA_MARKER || current.schema_version !== SHARED_HUB_SCHEMA_VERSION || current.organization_id !== options.organizationId)) {
                throw new Error(`Shared Hub schema mismatch. Expected ${SHARED_HUB_SCHEMA_VERSION}, found ${current.schema_version}. Restore a backup or create a new database.`)
            }
            this.db.prepare('INSERT OR IGNORE INTO shared_hub_meta(singleton, marker, schema_version, organization_id) VALUES (1, ?, ?, ?)').run(SHARED_HUB_SCHEMA_MARKER, SHARED_HUB_SCHEMA_VERSION, options.organizationId)
            this.db.prepare('INSERT OR IGNORE INTO organizations(id, name, status, created_at) VALUES (?, ?, ?, ?)').run(options.organizationId, options.organizationName, 'active', Date.now())
            const count = this.db.prepare('SELECT count(*) count FROM organizations').get() as { count: number }
            if (count.count !== 1) throw new Error('Shared Hub pilot database must contain exactly one organization.')
        })()
    }
}

const SHARED_HUB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shared_hub_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), marker TEXT NOT NULL, schema_version INTEGER NOT NULL, organization_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, verified_email TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(issuer, subject));
CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), identity_id TEXT REFERENCES identities(id), invited_email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')), status TEXT NOT NULL CHECK(status IN ('invited','active','disabled')), created_at INTEGER NOT NULL, UNIQUE(organization_id, invited_email), UNIQUE(id, organization_id));
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, archived_at INTEGER, created_at INTEGER NOT NULL, UNIQUE(organization_id, name), UNIQUE(id, organization_id));
CREATE TABLE IF NOT EXISTS team_memberships (team_id TEXT NOT NULL, membership_id TEXT NOT NULL, organization_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at INTEGER NOT NULL, PRIMARY KEY(team_id, membership_id), FOREIGN KEY(team_id, organization_id) REFERENCES teams(id, organization_id) ON DELETE CASCADE, FOREIGN KEY(membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), email TEXT NOT NULL CHECK(email = lower(trim(email))), token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')), expires_at INTEGER NOT NULL, claimed_at INTEGER, cancelled_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS web_sessions (id_hash TEXT PRIMARY KEY, membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE, csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oidc_transactions (state_hash TEXT PRIMARY KEY, nonce_hash TEXT NOT NULL, code_verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL, invitation_token_hash TEXT, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runners (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), owner_membership_id TEXT NOT NULL, machine_id TEXT NOT NULL, profile TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','revoked','archived')), last_seen_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL, UNIQUE(id, organization_id), FOREIGN KEY(owner_membership_id, organization_id) REFERENCES memberships(id, organization_id));
CREATE TABLE IF NOT EXISTS runner_active_claims (organization_id TEXT NOT NULL REFERENCES organizations(id), runner_id TEXT NOT NULL, machine_id TEXT NOT NULL, profile TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(runner_id), UNIQUE(organization_id,machine_id), UNIQUE(organization_id,profile), FOREIGN KEY(runner_id,organization_id) REFERENCES runners(id,organization_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS runner_machine_projections (runner_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), machine_id TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL, runner_state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(runner_id, organization_id) REFERENCES runners(id, organization_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS runner_credentials (id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, organization_id TEXT NOT NULL, secret_hash TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation > 0 AND generation <= 9007199254740991), created_at INTEGER NOT NULL, revoked_at INTEGER, UNIQUE(runner_id,generation), FOREIGN KEY(runner_id,organization_id) REFERENCES runners(id,organization_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS runner_enrollments (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), created_by_membership_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, consumed_at INTEGER, cancelled_at INTEGER, created_at INTEGER NOT NULL, FOREIGN KEY(created_by_membership_id, organization_id) REFERENCES memberships(id, organization_id));
CREATE TABLE IF NOT EXISTS resource_grants (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), principal_type TEXT NOT NULL CHECK(principal_type IN ('user','team')), principal_id TEXT NOT NULL, resource_type TEXT NOT NULL CHECK(resource_type IN ('runner','session')), resource_id TEXT NOT NULL, capability TEXT NOT NULL CHECK(capability IN ('view','interact','spawn','operate','manage')), expires_at INTEGER, created_by_membership_id TEXT NOT NULL, created_at INTEGER NOT NULL, CHECK(resource_type != 'session' OR capability = 'view'), FOREIGN KEY(created_by_membership_id, organization_id) REFERENCES memberships(id, organization_id));
CREATE TABLE IF NOT EXISTS session_security_projections (session_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), runner_id TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(session_id, organization_id), FOREIGN KEY(runner_id, organization_id) REFERENCES runners(id, organization_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS session_security_tombstones (session_id TEXT NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), retired_at INTEGER NOT NULL, PRIMARY KEY(session_id, organization_id));
CREATE TABLE IF NOT EXISTS runner_tombstones (runner_id TEXT PRIMARY KEY, cleanup_required INTEGER NOT NULL DEFAULT 1, revoked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, outcome TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox_events (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER);
CREATE TRIGGER IF NOT EXISTS trg_single_pilot_org BEFORE INSERT ON organizations WHEN EXISTS (SELECT 1 FROM organizations WHERE id != NEW.id) BEGIN SELECT RAISE(ABORT, 'Shared Hub pilot supports one organization'); END;
CREATE TRIGGER IF NOT EXISTS trg_grant_user_org BEFORE INSERT ON resource_grants WHEN NEW.principal_type = 'user' AND NOT EXISTS (SELECT 1 FROM memberships WHERE id = NEW.principal_id AND organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'grant user organization mismatch'); END;
CREATE TRIGGER IF NOT EXISTS trg_grant_team_org BEFORE INSERT ON resource_grants WHEN NEW.principal_type = 'team' AND NOT EXISTS (SELECT 1 FROM teams WHERE id = NEW.principal_id AND organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'grant team organization mismatch'); END;
CREATE TRIGGER IF NOT EXISTS trg_grant_runner_org BEFORE INSERT ON resource_grants WHEN NEW.resource_type = 'runner' AND NOT EXISTS (SELECT 1 FROM runners WHERE id = NEW.resource_id AND organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'grant runner organization mismatch'); END;
CREATE TRIGGER IF NOT EXISTS trg_grant_session_org BEFORE INSERT ON resource_grants WHEN NEW.resource_type = 'session' AND NOT EXISTS (SELECT 1 FROM session_security_projections sp JOIN runners r ON r.id = sp.runner_id AND r.organization_id = sp.organization_id AND r.status = 'active' WHERE sp.session_id = NEW.resource_id AND sp.organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'grant session organization mismatch'); END;
CREATE UNIQUE INDEX IF NOT EXISTS idx_grants_equivalent ON resource_grants(organization_id, principal_type, principal_id, resource_type, resource_id, capability, IFNULL(expires_at, -1));
CREATE INDEX IF NOT EXISTS idx_grants_principal ON resource_grants(organization_id, principal_type, principal_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_grants_resource ON resource_grants(organization_id, resource_type, resource_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_enrollments_expiry ON runner_enrollments(expires_at) WHERE consumed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_chronology ON audit_events(organization_id, created_at DESC);`
