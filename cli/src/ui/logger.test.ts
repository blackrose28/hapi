import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const tempDirs: string[] = []

async function importLoggerWithTempHome(env: Record<string, string> = {}) {
    const hapiHome = mkdtempSync(join(tmpdir(), 'hapi-logger-test-'))
    tempDirs.push(hapiHome)

    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('HAPI_HOME', hapiHome)
    for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value)
    }

    const module = await import('@/ui/logger')
    return { logger: module.logger, hapiHome }
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()

    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('logger file output', () => {
    test('does not write debug messages to local log files', async () => {
        const { logger, hapiHome } = await importLoggerWithTempHome()

        logger.debug('debug message that should not touch disk', { count: 1 })

        const logPath = logger.getLogPath()
        expect(existsSync(logPath)).toBe(false)

        const logsDir = join(hapiHome, 'logs')
        const logFiles = existsSync(logsDir) ? readdirSync(logsDir) : []
        expect(logFiles).toEqual([])
    })

    test('does not send log content to the optional remote diagnostic endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
        vi.stubGlobal('fetch', fetchMock)
        const { logger } = await importLoggerWithTempHome({
            DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: '1',
            HAPI_API_URL: 'https://logs.example.test',
        })

        logger.debug('token=top-secret', 'rm -rf /private/workspace')
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

        const request = fetchMock.mock.calls[0]?.[1] as RequestInit
        const body = String(request.body)
        expect(body).not.toContain('top-secret')
        expect(body).not.toContain('rm -rf')
        expect(body).not.toContain('/private/workspace')
        const payload = JSON.parse(body) as Record<string, unknown>
        expect(['debug', 'info']).toContain(payload.level)
        expect(payload).toMatchObject({
            source: 'cli',
            platform: process.platform,
        })
    })
})
