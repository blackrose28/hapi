import { randomUUID } from 'node:crypto'
import type { AuthorizationSubject } from '../auth/authorizationService'
import { keyedHash, randomOpaqueToken } from '../auth/identityCrypto'
import { RunnerClaimConflictError, SharedHubStore } from '../store/sharedHubStore'
import type { RunnerEnrollmentExchange } from '@hapi/protocol/runner-enrollment'

export class RunnerEnrollmentError extends Error {
    constructor(readonly code: 'forbidden'|'enrollment_used'|'machine_claimed'|'profile_claimed'|'not_found'|'conflict', message = code) { super(message) }
}

export class RunnerEnrollmentService {
    static readonly TTL_MS = 15 * 60 * 1000
    constructor(private readonly store:SharedHubStore, private readonly pepper:string, private readonly hubUrl:string, private readonly now=()=>Date.now(), private readonly afterCredentialInsert?:()=>void) {}

    issue(subject:AuthorizationSubject, requestedOwnerMembershipId?:string) {
        if(subject.disabled||subject.role==='viewer') throw new RunnerEnrollmentError('forbidden')
        const ownerMembershipId = subject.role === 'admin'
            ? requestedOwnerMembershipId ?? subject.membershipId
            : subject.membershipId
        if(!this.store.membershipExists(subject.organizationId,ownerMembershipId)) throw new RunnerEnrollmentError('forbidden')
        const code=randomOpaqueToken(32), createdAt=this.now(), enrollmentId=randomUUID()
        this.store.transaction(()=>{this.store.createEnrollment({id:enrollmentId,organizationId:subject.organizationId,ownerMembershipId,codeHash:keyedHash(code,this.pepper),expiresAt:createdAt+RunnerEnrollmentService.TTL_MS,createdAt});this.store.appendAuditEvent({id:randomUUID(),organizationId:subject.organizationId,actorType:'user',actorId:subject.membershipId,action:'runner.enrollment.issue',resourceType:'runner_enrollment',resourceId:enrollmentId,outcome:'success',metadata:{ownerMembershipId,expiresAt:createdAt+RunnerEnrollmentService.TTL_MS},createdAt});this.store.appendOutboxEvent({id:randomUUID(),organizationId:subject.organizationId,name:'runner.enrollment.issued',resourceType:'runner_enrollment',resourceId:enrollmentId,createdAt})})
        return {enrollmentId,code,expiresAt:createdAt+RunnerEnrollmentService.TTL_MS}
    }

    list(subject:AuthorizationSubject) {
        if(subject.disabled||subject.role==='viewer')throw new RunnerEnrollmentError('forbidden')
        const now=this.now()
        return {enrollments:this.store.listEnrollments(subject.organizationId).filter((e)=>subject.role==='admin'||e.ownerMembershipId===subject.membershipId).map((e)=>({id:e.id,ownerMembershipId:e.ownerMembershipId,expiresAt:e.expiresAt,consumed:e.consumedAt!==null,cancelled:e.cancelledAt!==null,status:e.cancelledAt!==null?'cancelled' as const:e.consumedAt!==null?'consumed' as const:e.expiresAt<=now?'expired' as const:'active' as const}))}
    }

    cancel(subject:AuthorizationSubject,id:string):void {
        const enrollment=this.store.listEnrollments(subject.organizationId).find((candidate)=>candidate.id===id)
        if(subject.disabled||subject.role==='viewer'||(subject.role!=='admin'&&(!enrollment||enrollment.ownerMembershipId!==subject.membershipId)))throw new RunnerEnrollmentError('forbidden')
        const now=this.now();this.store.transaction(()=>{if(!this.store.cancelEnrollment(subject.organizationId,id,now))throw new RunnerEnrollmentError('not_found');this.store.appendAuditEvent({id:randomUUID(),organizationId:subject.organizationId,actorType:'user',actorId:subject.membershipId,action:'runner.enrollment.cancel',resourceType:'runner_enrollment',resourceId:id,outcome:'success',createdAt:now});this.store.appendOutboxEvent({id:randomUUID(),organizationId:subject.organizationId,name:'runner.enrollment.cancelled',resourceType:'runner_enrollment',resourceId:id,createdAt:now})})
    }

    exchange(input:RunnerEnrollmentExchange) {
        const now=this.now(), runnerId=randomUUID(), credentialId=randomUUID(), secret=randomOpaqueToken(48)
        try {
            return this.store.transaction(() => {
                const enrollment=this.store.consumeEnrollment(keyedHash(input.code,this.pepper),now)
                if(!enrollment)throw new RunnerEnrollmentError('enrollment_used')
                this.store.createRunnerProjection({runnerId,organizationId:enrollment.organizationId,ownerMembershipId:enrollment.ownerMembershipId,machineId:input.machine.id,profile:input.profile,name:input.machine.name,metadata:{platform:input.machine.platform,arch:input.machine.arch,profile:input.profile},runnerState:{},createdAt:now})
                this.store.createRunnerCredential({id:credentialId,runnerId,organizationId:enrollment.organizationId,secretHash:keyedHash(secret,this.pepper),generation:1,createdAt:now})
                this.afterCredentialInsert?.()
                this.store.appendAuditEvent({id:randomUUID(),organizationId:enrollment.organizationId,actorType:'runner',actorId:runnerId,action:'runner.enroll',resourceType:'runner',resourceId:runnerId,outcome:'success',metadata:{generation:1},createdAt:now})
                this.store.appendOutboxEvent({id:randomUUID(),organizationId:enrollment.organizationId,name:'runner.enrolled',resourceType:'runner',resourceId:runnerId,createdAt:now})
                return {organizationId:enrollment.organizationId,runnerId,credential:{credentialId,secret},generation:1,hubUrl:this.hubUrl}
            })
        } catch(error) {
            if(error instanceof RunnerEnrollmentError)throw error
            if(error instanceof RunnerClaimConflictError)throw new RunnerEnrollmentError(error.code)
            throw error
        }
    }
}
