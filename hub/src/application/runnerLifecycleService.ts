import { randomUUID } from 'node:crypto'
import type { AuthorizationSubject } from '../auth/authorizationService'
import { keyedHash, randomOpaqueToken } from '../auth/identityCrypto'
import { SharedHubStore } from '../store/sharedHubStore'
import { RunnerEnrollmentError } from './runnerEnrollmentService'

export class RunnerLifecycleService {
    constructor(
        private readonly store: SharedHubStore,
        private readonly pepper: string,
        private readonly now = () => Date.now(),
        private readonly onRevoked?: (organizationId: string, runnerId: string) => void
    ) {}

    private authorize(subject: AuthorizationSubject, runnerId: string, requireActive = true) {
        const runner = this.store.findRunner(subject.organizationId, runnerId)
        if (!runner || (requireActive && runner.status !== 'active')) throw new RunnerEnrollmentError('not_found')
        if (subject.disabled || (subject.role !== 'admin' && runner.ownerMembershipId !== subject.membershipId)) {
            throw new RunnerEnrollmentError('forbidden')
        }
        return runner
    }

    list(subject: AuthorizationSubject) {
        if (subject.disabled || subject.role === 'viewer') throw new RunnerEnrollmentError('forbidden')
        return this.store.listRunners(subject.organizationId)
            .filter((runner) => subject.role === 'admin' || runner.ownerMembershipId === subject.membershipId)
    }

    rotate(subject: AuthorizationSubject, runnerId: string, expectedGeneration: number) {
        this.authorize(subject, runnerId)
        const secret = randomOpaqueToken(48)
        const credentialId = randomUUID()
        const now = this.now()
        return this.store.transaction(() => {
            const result = this.store.rotateRunnerCredential({
                organizationId: subject.organizationId, runnerId, expectedGeneration, id: credentialId,
                secretHash: keyedHash(secret, this.pepper), now
            })
            if (result === 'not_found') throw new RunnerEnrollmentError('not_found')
            if (result === 'conflict') throw new RunnerEnrollmentError('conflict')
            this.record(subject, 'runner.credential.rotate', 'runner.credential.rotated', runnerId, now, {
                previousGeneration: expectedGeneration,
                generation: expectedGeneration + 1
            })
            return { runnerId, credential: { credentialId, secret }, generation: expectedGeneration + 1 }
        })
    }

    revoke(subject: AuthorizationSubject, runnerId: string) {
        this.authorize(subject, runnerId, false)
        const now = this.now()
        const changed = this.store.transaction(() => {
            const result = this.store.revokeRunnerAccess({ organizationId: subject.organizationId, runnerId, now })
            if (result === 'not_found') throw new RunnerEnrollmentError('not_found')
            if (result === 'already_revoked') return false
            this.record(subject, 'runner.revoke', 'runner.revoked', runnerId, now)
            return true
        })
        if (changed) this.onRevoked?.(subject.organizationId, runnerId)
        return { runnerId, revoked: true as const }
    }

    transfer(subject: AuthorizationSubject, runnerId: string, targetMembershipId: string) {
        this.authorize(subject, runnerId)
        const now = this.now()
        return this.store.transaction(() => {
            const runner = this.store.findRunner(subject.organizationId, runnerId)
            if (!runner) throw new RunnerEnrollmentError('not_found')
            const result = this.store.transferRunnerOwnership(subject.organizationId, runnerId, targetMembershipId)
            if (result === 'not_found' || result === 'target_not_found') throw new RunnerEnrollmentError('not_found')
            if (result === 'same_owner') throw new RunnerEnrollmentError('conflict')
            this.record(subject, 'runner.transfer', 'runner.transferred', runnerId, now, {
                previousOwnerMembershipId: runner.ownerMembershipId,
                newOwnerMembershipId: targetMembershipId
            })
            return { runnerId, previousOwnerMembershipId: runner.ownerMembershipId, newOwnerMembershipId: targetMembershipId }
        })
    }

    cleanup(subject: AuthorizationSubject, runnerId: string) {
        this.authorize(subject, runnerId, false)
        const now = this.now()
        return this.store.transaction(() => {
            const result = this.store.cleanupRunnerTombstone(subject.organizationId, runnerId)
            if (result === 'not_found') throw new RunnerEnrollmentError('not_found')
            this.record(subject, 'runner.cleanup', 'runner.cleaned', runnerId, now)
            return { runnerId, cleaned: true as const }
        })
    }

    private record(
        subject: AuthorizationSubject,
        action: string,
        eventName: string,
        runnerId: string,
        now: number,
        metadata?: Readonly<Record<string, string | number | boolean | null>>
    ): void {
        this.store.appendAuditEvent({
            id: randomUUID(), organizationId: subject.organizationId, actorType: 'user', actorId: subject.membershipId,
            action, resourceType: 'runner', resourceId: runnerId, outcome: 'success', metadata, createdAt: now
        })
        this.store.appendOutboxEvent({
            id: randomUUID(), organizationId: subject.organizationId, name: eventName,
            resourceType: 'runner', resourceId: runnerId, createdAt: now
        })
    }
}
