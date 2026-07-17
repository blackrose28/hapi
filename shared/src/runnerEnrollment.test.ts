import { describe, expect, it } from 'bun:test'
import { RunnerCredentialEnvelopeSchema, RunnerCredentialRotateSchema, RunnerEnrollmentExchangeSchema, RunnerEnrollmentIssueSchema } from './runnerEnrollment'

describe('Runner enrollment contract', () => {
    it('accepts pilot platforms and contains no long-lived credential', () => {
        const value = RunnerEnrollmentExchangeSchema.parse({
            code: '0123456789abcdef', profile: 'work-hub',
            machine: { id: 'm1', name: 'laptop', platform: 'linux', arch: 'x64' }
        })
        expect(value).not.toHaveProperty('runnerSecret')
        expect(RunnerEnrollmentExchangeSchema.safeParse({ ...value, machine: { ...value.machine, platform: 'windows' } }).success).toBeFalse()
    })
})

it('bounds enrollment and credential contracts', () => {
    expect(RunnerEnrollmentIssueSchema.safeParse({}).success).toBe(true)
    expect(RunnerEnrollmentIssueSchema.safeParse({ ownerMembershipId: 'x'.repeat(257) }).success).toBe(false)
    expect(RunnerCredentialEnvelopeSchema.safeParse({ credentialId: 'id', secret: 'x'.repeat(257) }).success).toBe(false)
    expect(RunnerCredentialRotateSchema.safeParse({ expectedGeneration: 0 }).success).toBe(false)
})
