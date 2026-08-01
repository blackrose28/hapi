import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getOrCreateMachineMock = vi.fn()
const getOrCreateSessionMock = vi.fn()
const sessionSyncClientMock = vi.fn()
const apiClientCreateMock = vi.fn()

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: (...args: unknown[]) => apiClientCreateMock(...args)
    }
}))

vi.mock('@/runner/controlClient', () => ({
    notifyRunnerSessionStarted: vi.fn(async () => ({}))
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn()
    }
}))

import { HAPI_SESSION_ID_ENV, bootstrapSession, buildSessionMetadata } from './sessionFactory'

describe('buildSessionMetadata', () => {
    const originalHostname = process.env.HAPI_HOSTNAME

    afterEach(() => {
        if (originalHostname === undefined) {
            delete process.env.HAPI_HOSTNAME
        } else {
            process.env.HAPI_HOSTNAME = originalHostname
        }
    })

    it('uses HAPI_HOSTNAME for session metadata host when provided', () => {
        process.env.HAPI_HOSTNAME = 'custom-session-host'

        const metadata = buildSessionMetadata({
            flavor: 'codex',
            startedBy: 'terminal',
            workingDirectory: '/tmp/project',
            machineId: 'machine-1',
            now: 123
        })

        expect(metadata.host).toBe('custom-session-host')
    })
})

describe('bootstrapSession HAPI_SESSION_ID export', () => {
    beforeEach(() => {
        getOrCreateMachineMock.mockReset()
        getOrCreateSessionMock.mockReset()
        sessionSyncClientMock.mockReset()
        apiClientCreateMock.mockReset()
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('exports the hub session id so spawned agents inherit it', async () => {
        getOrCreateSessionMock.mockResolvedValue({ id: 'hub-session-42' })
        getOrCreateMachineMock.mockResolvedValue({ id: 'machine-1' })
        sessionSyncClientMock.mockReturnValue({})
        apiClientCreateMock.mockResolvedValue({
            machineId: 'machine-1',
            getOrCreateMachine: getOrCreateMachineMock,
            getOrCreateSession: getOrCreateSessionMock,
            sessionSyncClient: sessionSyncClientMock
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            workingDirectory: '/tmp/project'
        })

        expect(result.sessionInfo.id).toBe('hub-session-42')
        expect(process.env[HAPI_SESSION_ID_ENV]).toBe('hub-session-42')
    })
})
