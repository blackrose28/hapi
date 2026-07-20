import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '../sync/syncEngine'
import { SharedHubStore } from '../store/sharedHubStore'
import { SessionSecurityProjection } from './sessionSecurityProjection'

function setup() {
    const db = new Database(':memory:')
    const store = new SharedHubStore(db, { organizationId: 'o1', organizationName: 'Pilot' })
    db.exec("INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at) VALUES ('u1','o1','u@example.com','admin','active',1)")
    store.createRunnerProjection({ runnerId: 'r1', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm1', name: 'Runner', metadata: {}, runnerState: {}, createdAt: 1 })
    store.createRunnerProjection({ runnerId: 'r2', organizationId: 'o1', ownerMembershipId: 'u1', machineId: 'm2', name: 'Runner 2', metadata: {}, runnerState: {}, createdAt: 1 })
    let listener: ((event: SyncEvent) => void) | null = null
    let subscribeCount = 0
    let unsubscribeCount = 0
    let current: Session | undefined
    const events = {
        getSession: () => current,
        subscribe: (next: (event: SyncEvent) => void) => {
            subscribeCount++
            listener = next
            return () => { unsubscribeCount++ }
        }
    }
    return { db, store, events, emit: (event: SyncEvent) => listener?.(event), setCurrent: (session: Session | undefined) => { current = session }, counts: () => ({ subscribeCount, unsubscribeCount }) }
}

function session(id: string, machineId: string, updatedAt: number): Session {
    return { id, updatedAt, metadata: { machineId } } as Session
}

describe('SessionSecurityProjection', () => {
    it('restores a startup snapshot newer than an earlier retirement tombstone', () => {
        const state = setup()
        state.store.retireSessionProjection('o1', 's1', 20)
        const projection = new SessionSecurityProjection(state.store, 'o1', { getSessions: () => [{
            id: 's1', machineId: 'm1', updatedAt: 10
        }] as never }, state.events, () => 30)

        projection.start()

        expect(state.store.findSessionRunner('o1', 's1')?.id).toBe('r1')
    })

    it('subscribes before snapshot and replays a newer event after stale reconciliation', () => {
        const state = setup()
        let reads = 0
        const projection = new SessionSecurityProjection(state.store, 'o1', { getSessions: () => {
            reads++
            state.setCurrent(session('s1', 'm1', 20))
            state.emit({ type: 'session-updated', sessionId: 's1' })
            return [{ id: 's1', machineId: null, updatedAt: 10 }] as never
        } }, state.events, () => 30)
        projection.start()
        projection.start()
        expect(state.store.findSessionRunner('o1', 's1')?.id).toBe('r1')
        expect(reads).toBe(1)
        expect(state.counts().subscribeCount).toBe(1)
    })

    it('orders buffered operations by timestamp then arrival and ignores events after idempotent stop', () => {
        const state = setup()
        let now = 40
        const projection = new SessionSecurityProjection(state.store, 'o1', { getSessions: () => {
            state.setCurrent(session('s1', 'm1', 50))
            state.emit({ type: 'session-updated', sessionId: 's1' })
            now = 60
            state.emit({ type: 'session-removed', sessionId: 's1' })
            return []
        } }, state.events, () => now)
        projection.start()
        expect(state.store.findSessionRunner('o1', 's1')).toBeNull()
        projection.stop()
        projection.stop()
        state.setCurrent(session('s1', 'm1', 70))
        state.emit({ type: 'session-added', sessionId: 's1' })
        expect(state.store.findSessionRunner('o1', 's1')).toBeNull()
        expect(state.counts().unsubscribeCount).toBe(1)
    })

    it('retires grants before projection removal so reused session ids inherit nothing', () => {
        const state = setup()
        state.store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 10 })
        state.store.createResourceGrant({ id: 'g1', organizationId: 'o1', principalType: 'user', principalId: 'u1', resourceType: 'session', resourceId: 's1', capability: 'view', expiresAt: null, createdByMembershipId: 'u1', createdAt: 11 })
        state.store.retireSessionProjection('o1', 's1', 20)
        state.store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 30 })
        expect(state.store.findResourceGrant('o1', 'g1')).toBeNull()
        expect(state.store.resolveEffectiveGrants({ organizationId: 'o1', membershipId: 'u1', resourceType: 'session', resourceId: 's1', now: 31 })).toEqual([])
    })

    it('causally replays a post-subscribe rebind after snapshot retirement despite an older domain timestamp', () => {
        const state = setup()
        state.store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 90 })
        const projection = new SessionSecurityProjection(state.store, 'o1', { getSessions: () => {
            state.setCurrent(session('s1', 'm2', 5))
            state.emit({ type: 'session-updated', sessionId: 's1' })
            return []
        } }, state.events, () => 100)
        projection.start()
        expect(state.store.findSessionRunner('o1', 's1')?.id).toBe('r2')
    })

    it('does not retire a projection when a non-removal event cannot resolve its session', () => {
        const state = setup()
        state.store.upsertSessionProjectionByMachine({ sessionId: 's1', organizationId: 'o1', machineId: 'm1', updatedAt: 10 })
        const projection = new SessionSecurityProjection(state.store, 'o1', { getSessions: () => [{
            id: 's1', machineId: 'm1', updatedAt: 10
        }] as never }, state.events, () => 20)
        projection.start()
        state.setCurrent(undefined)
        state.emit({ type: 'session-updated', sessionId: 's1' })
        expect(state.store.findSessionRunner('o1', 's1')?.id).toBe('r1')
    })
})
