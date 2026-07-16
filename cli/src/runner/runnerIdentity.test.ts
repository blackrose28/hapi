import {
    hashRunnerCliApiToken,
    hashRunnerExtraHeaders,
    isRunnerStateCompatibleWithIdentity
} from './runnerIdentity'

describe('runner identity', () => {
    const state = { startedWithApiUrl: 'https://hub.test', startedWithMachineId: 'machine-1' }

    it('matches the selected Hub and machine', () => {
        expect(isRunnerStateCompatibleWithIdentity(state, { apiUrl: 'https://hub.test', machineId: 'machine-1' })).toBe(true)
    })

    it('rejects missing or different Hub and machine identity', () => {
        expect(isRunnerStateCompatibleWithIdentity(state, { apiUrl: 'https://other.test', machineId: 'machine-1' })).toBe(false)
        expect(isRunnerStateCompatibleWithIdentity(state, { apiUrl: 'https://hub.test', machineId: 'machine-2' })).toBe(false)
        expect(isRunnerStateCompatibleWithIdentity(state, { apiUrl: 'https://hub.test' })).toBe(false)
    })

    it('rejects reused runner when token changed', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('old-token')
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('new-token')
            }
        )).toBe(false)
    })

    it('rejects reused runner when extra headers changed', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                startedWithExtraHeadersHash: 'old-headers-hash'
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                extraHeadersHash: 'new-headers-hash'
            }
        )).toBe(false)
    })

    it('hashes equivalent extra headers identically regardless of insertion order', () => {
        const first = hashRunnerExtraHeaders({
            'X-Second': 'two',
            'X-First': 'one'
        })
        const second = hashRunnerExtraHeaders({
            'X-First': 'one',
            'X-Second': 'two'
        })

        expect(first).toBe(second)
        expect(first).toMatch(/^[a-f0-9]{64}$/)
    })

    it('matches equivalent extra headers with different insertion order', () => {
        const first = hashRunnerExtraHeaders({
            'X-Second': 'two',
            'X-First': 'one'
        })
        const second = hashRunnerExtraHeaders({
            'X-First': 'one',
            'X-Second': 'two'
        })

        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                startedWithExtraHeadersHash: first
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                extraHeadersHash: second
            }
        )).toBe(true)
    })

    it('keeps legacy runner state compatible when no extra headers are configured', () => {
        expect(hashRunnerExtraHeaders({})).toBeUndefined()
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token')
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                extraHeadersHash: undefined
            }
        )).toBe(true)
    })

    it('rejects legacy runner state when extra headers are now configured', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token')
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                extraHeadersHash: 'configured-headers-hash'
            }
        )).toBe(false)
    })

    it('rejects runner state with headers when current headers are empty', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                startedWithExtraHeadersHash: 'configured-headers-hash'
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token'),
                extraHeadersHash: undefined
            }
        )).toBe(false)
    })

    it('rejects reused runner when current machine id is missing', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token')
            },
            {
                apiUrl: 'http://example.com',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token')
            }
        )).toBe(false)
    })

    it('rejects reused runner when current token hash is missing', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {
                startedWithApiUrl: 'http://example.com',
                startedWithMachineId: 'machine-123',
                startedWithCliApiTokenHash: hashRunnerCliApiToken('secret-token')
            },
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123'
            }
        )).toBe(false)
    })

    it('rejects old runner state missing connection identity', () => {
        expect(isRunnerStateCompatibleWithIdentity(
            {},
            {
                apiUrl: 'http://example.com',
                machineId: 'machine-123',
                cliApiTokenHash: hashRunnerCliApiToken('secret-token')
            }
        )).toBe(false)
>>>>>>> c87720ab (fix(cli): load extra headers from settings (#1041))
    })
})
