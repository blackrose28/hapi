import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSessionClient } from '@/api/apiSession'
import { HAPI_SESSION_ID_ENV } from '@/agent/hapiSessionEnv'

const harness = vi.hoisted(() => ({
    stopServer: vi.fn()
}))

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: vi.fn(async () => ({
        url: 'http://127.0.0.1:1234',
        stop: harness.stopServer
    }))
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
    getHappyCliCommand: vi.fn((args: string[]) => ({ command: 'hapi', args }))
}))

import { buildHapiMcpBridge } from './buildHapiMcpBridge'

describe('buildHapiMcpBridge', () => {
    beforeEach(() => {
        harness.stopServer.mockClear()
        delete process.env[HAPI_SESSION_ID_ENV]
    })

    it('exports HAPI_SESSION_ID for the wrapped agent before starting the bridge', async () => {
        const client = { sessionId: 'hub-session-1' } as unknown as ApiSessionClient

        const bridge = await buildHapiMcpBridge(client)

        expect(process.env[HAPI_SESSION_ID_ENV]).toBe('hub-session-1')
        expect(bridge.server.url).toBe('http://127.0.0.1:1234')
        expect(bridge.mcpServers.hapi_session).toBeDefined()
    })
})
