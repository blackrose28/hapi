import { afterEach, describe, expect, it } from 'bun:test'
import { TerminalStateSchema, TerminalWarningPayloadSchema, type TerminalWarningPayload } from '@hapi/protocol'
import { logger } from '@/ui/logger'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_OUTPUT_BUFFER_CHARS, TerminalManager } from './TerminalManager'

type SpawnOptions = {
    cwd?: string
    env?: NodeJS.ProcessEnv
    terminal?: {
        cols: number
        rows: number
        data?: (terminal: FakeTerminal, data: Uint8Array) => void
    }
    onExit?: (subprocess: {
        signalCode?: NodeJS.Signals | null
        exitCode: number | null
    }, exitCode: number | null) => void
}

type FakeTerminal = {
    resize: (cols: number, rows: number) => void
    write: (data: string) => void
    close: () => void
}

const originalSpawn = Bun.spawn
const originalProcessKill = process.kill
const originalShell = process.env.SHELL

function installFakeSpawn(fakeOptions: {
    markKilledOnKill?: boolean
    pid?: number
    killError?: (signal: string) => Error
} = {}) {
    process.env.SHELL = '/bin/zsh'
    let latestTerminal: FakeTerminal | null = null
    let latestOptions: SpawnOptions | null = null
    let latestCommand: string[] | null = null
    let spawnCount = 0
    const processes: Array<{
        killed: boolean
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        killCalls: string[]
        pid?: number
    }> = []
    const terminals: Array<FakeTerminal & { closed: boolean; writes: string[] }> = []

    Bun.spawn = ((command: string[], options: SpawnOptions) => {
        spawnCount += 1
        latestCommand = command
        latestOptions = options
        const terminal: FakeTerminal & { closed: boolean; writes: string[] } = {
            closed: false,
            writes: [],
            resize: () => {},
            write: (data) => {
                terminal.writes.push(data)
            },
            close: () => {
                terminal.closed = true
            }
        }
        latestTerminal = terminal
        terminals.push(terminal)
        const proc = {
            terminal,
            killed: false,
            exitCode: null,
            signalCode: null,
            pid: fakeOptions.pid,
            kill: (signal?: string) => {
                const signalName = signal ?? 'SIGTERM'
                if (fakeOptions.markKilledOnKill !== false) {
                    proc.killed = true
                }
                proc.killCalls.push(signalName)
                const error = fakeOptions.killError?.(signalName)
                if (error) {
                    throw error
                }
                return true
            },
            killCalls: [] as string[]
        }
        processes.push(proc)
        return proc
    }) as unknown as typeof Bun.spawn

    return {
        get spawnCount() {
            return spawnCount
        },
        get latestEnv() {
            return latestOptions?.env ?? null
        },
        get latestCommand() {
            return latestCommand
        },
        get latestCwd() {
            return latestOptions?.cwd ?? null
        },
        processes,
        terminals,
        emitData(data: string): void {
            if (!latestOptions?.terminal?.data || !latestTerminal) {
                throw new Error('terminal data handler was not registered')
            }
            latestOptions.terminal.data(latestTerminal, new TextEncoder().encode(data))
        },
        emitExit(exitCode: number | null, signalCode: NodeJS.Signals | null = null): void {
            const latestProcess = processes.at(-1)
            if (!latestOptions?.onExit || !latestProcess) {
                throw new Error('process exit handler was not registered')
            }
            latestProcess.exitCode = exitCode
            latestProcess.signalCode = signalCode
            latestOptions.onExit(latestProcess, exitCode)
        }
    }
}

describe('TerminalManager', () => {
    afterEach(() => {
        Bun.spawn = originalSpawn
        process.kill = originalProcessKill
        if (originalShell === undefined) {
            delete process.env.SHELL
        } else {
            process.env.SHELL = originalShell
        }
    })

    it('spawns Bash with a private history wrapper and serves its live snapshot', () => {
        const fakeSpawn = installFakeSpawn()
        process.env.SHELL = '/bin/bash'
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)

        expect(fakeSpawn.latestCommand).toEqual(['/bin/bash', '--rcfile', expect.any(String)])
        expect(fakeSpawn.latestEnv?.HAPI_HISTORY_SNAPSHOT).toEqual(expect.any(String))
        expect(manager.getHistory({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            limit: 20
        })).toMatchObject({
            status: 'not_ready',
            shell: 'bash',
            entries: []
        })

        const snapshotPath = fakeSpawn.latestEnv!.HAPI_HISTORY_SNAPSHOT!
        writeFileSync(snapshotPath, '  4  pwd\n  5  git status\n')
        expect(manager.getHistory({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            requestId: 'request-2',
            limit: 20
        })).toMatchObject({
            status: 'ok',
            entries: [
                { index: 5, command: 'git status' },
                { index: 4, command: 'pwd' }
            ]
        })

        const runtimeDirectory = dirname(snapshotPath)
        manager.close('terminal-1')
        expect(existsSync(runtimeDirectory)).toBe(false)
    })

    it('keeps non-Bash terminals working and reports history as unsupported', () => {
        const fakeSpawn = installFakeSpawn()
        process.env.SHELL = '/bin/zsh'
        const manager = new TerminalManager({
            machineId: 'machine-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)

        expect(fakeSpawn.latestCommand).toEqual(['/bin/zsh'])
        expect(manager.getHistory({
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: 'request-1'
        })).toMatchObject({
            status: 'unsupported_shell',
            shell: 'zsh',
            entries: []
        })
    })

    it('replays buffered output when reattaching to an existing terminal', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const readyIds: string[] = []

        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: (payload) => readyIds.push(payload.terminalId),
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData('first line\n')
        fakeSpawn.emitData('second line\n')

        outputs.length = 0
        manager.create('terminal-1', 100, 30, undefined, true)

        expect(readyIds).toEqual(['terminal-1', 'terminal-1'])
        expect(outputs).toEqual(['first line\nsecond line\n'])
    })

    it('does not replay buffered output unless requested', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []

        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(`${payload.terminalId}:${payload.data}`),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData('first line\n')

        outputs.length = 0
        manager.create('terminal-1', 80, 24)

        expect(outputs).toEqual([])
    })

    it('replays only the requested terminal output', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []

        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(`${payload.terminalId}:${payload.data}`),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('t1', 80, 24)
        fakeSpawn.emitData('ONE')
        manager.create('t2', 80, 24)
        fakeSpawn.emitData('TWO')

        outputs.length = 0
        manager.create('t1', 80, 24, undefined, true)

        expect(outputs).toEqual(['t1:ONE'])
        expect(outputs.join('')).not.toContain('t2:TWO')
        expect(outputs.join('')).not.toContain('TWO')
    })

    it('keeps machine detached terminal cleanup behavior after the detached timeout', async () => {
        const fakeSpawn = installFakeSpawn()
        const errors: string[] = []

        const manager = new TerminalManager({
            machineId: 'machine-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: (payload) => errors.push(payload.message),
            idleTimeoutMs: 0,
            detachedTimeoutMs: 1
        })

        manager.create('terminal-1', 80, 24)
        manager.detach('terminal-1')
        await new Promise((resolve) => setTimeout(resolve, 5))
        manager.write('terminal-1', 'echo still-there\n')

        expect(errors).toEqual(['Terminal not found.'])
        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM'])
    })

    it('lists session terminal metadata without output data', () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp/project',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData('SECRET_OUTPUT_DO_NOT_LIST')

        expect(manager.list()).toEqual([{
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            label: 'Terminal 1',
            cwd: 'project',
            cols: 80,
            rows: 24,
            status: 'running',
            closeReason: null,
            createdAt: expect.any(Number),
            lastActivityAt: expect.any(Number),
            idleWarningAt: null,
            hardExpiresAt: expect.any(Number)
        }])
        const serialized = JSON.stringify(manager.list())
        expect(serialized).not.toContain('SECRET_OUTPUT_DO_NOT_LIST')
        expect(serialized).not.toContain('outputBuffer')
        expect(serialized).not.toContain('data')
        expect(serialized).not.toContain('/tmp/project')
        expect(TerminalStateSchema.safeParse(manager.list()[0]).success).toBe(true)
    })

    it('redacts sensitive cwd path segments from serialized terminal list state', () => {
        const fakeSpawn = installFakeSpawn()
        const sensitiveCwd = '/tmp/sk-secret/cookie/token/AIzaSyProviderKey/project'
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => sensitiveCwd,
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)

        const serialized = JSON.stringify(manager.list())
        expect(fakeSpawn.latestCwd).toBe(sensitiveCwd)
        expect(manager.list()[0]?.cwd).toBe('project')
        expect(serialized).not.toContain(sensitiveCwd)
        expect(serialized).not.toContain('sk-secret')
        expect(serialized).not.toContain('cookie')
        expect(serialized).not.toContain('token')
        expect(serialized).not.toContain('AIzaSyProviderKey')
        expect(TerminalStateSchema.safeParse(manager.list()[0]).success).toBe(true)
    })

    it('redacts sensitive cwd basename when it carries secret-like data', () => {
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp/project-token-sk-secret',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)

        const serialized = JSON.stringify(manager.list())
        expect(manager.list()[0]?.cwd).toBe('[redacted]')
        expect(serialized).not.toContain('project-token-sk-secret')
        expect(serialized).not.toContain('sk-secret')
        expect(serialized).not.toContain('token')
        expect(TerminalStateSchema.safeParse(manager.list()[0]).success).toBe(true)
    })

    it('keeps list and warning payloads metadata-only without terminal secrets', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp/project',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 10_000,
            idleWarningMs: 100,
            hardLifetimeMs: 60_000,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        manager.write('terminal-1', 'export OPENAI_API_KEY=sk-secret\n')
        fakeSpawn.emitData('token=SECRET_OUTPUT cookie=session-secret\n')
        now = 1_100
        manager.checkLifecycleWarnings()

        const serialized = JSON.stringify({ list: manager.list(), warnings })
        expect(serialized).not.toContain('sk-secret')
        expect(serialized).not.toContain('SECRET_OUTPUT')
        expect(serialized).not.toContain('cookie=session-secret')
        expect(serialized).not.toContain('export OPENAI_API_KEY')
        expect(serialized).not.toContain('outputBuffer')
        expect(serialized).not.toContain('env')
        expect(serialized).not.toContain('command')
        expect(TerminalWarningPayloadSchema.safeParse(warnings[0]).success).toBe(true)
    })

    it('filters broad sensitive env keys from spawned terminal env and keeps safe defaults', () => {
        const previousEnv: Record<string, string | undefined> = {}
        const touchedKeys = [
            'GITHUB_TOKEN',
            'NPM_TOKEN',
            'AWS_SECRET_ACCESS_KEY',
            'HAPI_OPENCODE_HOOK_TOKEN',
            'DATABASE_URL',
            'POSTGRES_URL',
            'POSTGRES_PRISMA_URL',
            'MYSQL_URL',
            'MONGODB_URI',
            'SUPABASE_DB_URL',
            'NEON_DATABASE_URL',
            'SSH_AUTH_SOCK',
            'GIT_AUTHOR_NAME',
            'TERM',
            'LANG',
            'COLORTERM'
        ]
        for (const key of touchedKeys) previousEnv[key] = process.env[key]
        Object.assign(process.env, {
            GITHUB_TOKEN: 'github-secret',
            NPM_TOKEN: 'npm-secret',
            AWS_SECRET_ACCESS_KEY: 'aws-secret',
            HAPI_OPENCODE_HOOK_TOKEN: 'hook-secret',
            DATABASE_URL: 'postgres://secret',
            POSTGRES_URL: 'postgres://pg-secret',
            POSTGRES_PRISMA_URL: 'postgres://prisma-secret',
            MYSQL_URL: 'mysql://mysql-secret',
            MONGODB_URI: 'mongodb://mongo-secret',
            SUPABASE_DB_URL: 'postgres://supabase-secret',
            NEON_DATABASE_URL: 'postgres://neon-secret',
            SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
            GIT_AUTHOR_NAME: 'HAPI Dev',
            TERM: 'xterm-safe',
            LANG: 'C.UTF-8',
            COLORTERM: 'truecolor-safe'
        })

        try {
            const fakeSpawn = installFakeSpawn()
            const manager = new TerminalManager({
                sessionId: 'session-1',
                getSessionPath: () => '/tmp',
                onReady: () => {},
                onOutput: () => {},
                onExit: () => {},
                onError: () => {},
                idleTimeoutMs: 0
            })

            manager.create('terminal-1', 80, 24)

            expect(fakeSpawn.latestEnv).not.toHaveProperty('GITHUB_TOKEN')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('NPM_TOKEN')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('HAPI_OPENCODE_HOOK_TOKEN')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('DATABASE_URL')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('POSTGRES_URL')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('POSTGRES_PRISMA_URL')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('MYSQL_URL')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('MONGODB_URI')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('SUPABASE_DB_URL')
            expect(fakeSpawn.latestEnv).not.toHaveProperty('NEON_DATABASE_URL')
            expect(fakeSpawn.latestEnv).toMatchObject({
                SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
                GIT_AUTHOR_NAME: 'HAPI Dev',
                TERM: 'xterm-safe',
                LANG: 'C.UTF-8',
                COLORTERM: 'truecolor-safe'
            })
            const serializedEnv = JSON.stringify(fakeSpawn.latestEnv)
            expect(serializedEnv).not.toContain('github-secret')
            expect(serializedEnv).not.toContain('npm-secret')
            expect(serializedEnv).not.toContain('aws-secret')
            expect(serializedEnv).not.toContain('hook-secret')
            expect(serializedEnv).not.toContain('postgres://secret')
            expect(serializedEnv).not.toContain('pg-secret')
            expect(serializedEnv).not.toContain('prisma-secret')
            expect(serializedEnv).not.toContain('mysql-secret')
            expect(serializedEnv).not.toContain('mongo-secret')
            expect(serializedEnv).not.toContain('supabase-secret')
            expect(serializedEnv).not.toContain('neon-secret')
        } finally {
            for (const key of touchedKeys) {
                if (previousEnv[key] === undefined) delete process.env[key]
                else process.env[key] = previousEnv[key]
            }
        }
    })

    it('does not close session terminals on detach by default', async () => {
        const fakeSpawn = installFakeSpawn()
        const errors: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: (payload) => errors.push(payload.message),
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)
        manager.detach('terminal-1')
        await new Promise((resolve) => setTimeout(resolve, 5))
        manager.write('terminal-1', 'echo alive\n')

        expect(errors).toEqual([])
        expect(fakeSpawn.processes[0]?.killed).toBe(false)
        expect(manager.list()[0]?.status).toBe('detached')
    })

    it('ignores configured detached timeout for session terminals', async () => {
        const fakeSpawn = installFakeSpawn()
        const errors: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: (payload) => errors.push(payload.message),
            idleTimeoutMs: 0,
            detachedTimeoutMs: 1
        })

        manager.create('terminal-1', 80, 24)
        manager.detach('terminal-1')
        await new Promise((resolve) => setTimeout(resolve, 5))
        manager.write('terminal-1', 'echo alive\n')

        expect(errors).toEqual([])
        expect(fakeSpawn.processes[0]?.killCalls).toEqual([])
        expect(fakeSpawn.terminals[0]?.writes).toEqual(['echo alive\n'])
        expect(manager.list()[0]).toMatchObject({ status: 'detached', closeReason: null })
    })

    it('enforces max 3 live session terminals in the CLI manager', () => {
        const fakeSpawn = installFakeSpawn()
        const errors: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: (payload) => errors.push(payload.message),
            idleTimeoutMs: 0
        })

        for (const id of ['t1', 't2', 't3', 't4']) manager.create(id, 80, 24)

        expect(fakeSpawn.spawnCount).toBe(3)
        expect(manager.list().map((item) => item.terminalId)).toEqual(['t1', 't2', 't3'])
        expect(errors).toContain('Too many terminals open (max 3).')
    })

    it('frees a session slot after explicit close-one and keeps closed metadata', () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('t1', 80, 24)
        manager.create('t2', 80, 24)
        manager.create('t3', 80, 24)
        manager.close('t2')
        expect(fakeSpawn.processes[0]?.killed).toBe(false)
        expect(fakeSpawn.processes[1]?.killed).toBe(true)
        expect(fakeSpawn.processes[2]?.killed).toBe(false)
        manager.create('t4', 80, 24)

        const states = manager.list()
        const liveStates = states.filter((item) => item.status === 'running' || item.status === 'detached')
        const closedState = states.find((item) => item.terminalId === 't2')

        expect(fakeSpawn.spawnCount).toBe(4)
        expect(states.map((item) => item.terminalId)).toEqual(['t1', 't2', 't3', 't4'])
        expect(liveStates.map((item) => item.terminalId)).toEqual(['t1', 't3', 't4'])
        expect(liveStates).toHaveLength(3)
        expect(closedState).toMatchObject({
            terminalId: 't2',
            status: 'closed_user',
            closeReason: 'user_close'
        })
        expect(TerminalStateSchema.safeParse(closedState).success).toBe(true)
    })

    it('close t1 in three session terminals leaves t1 closed_user, two live, and allows one new terminal', () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        for (const terminalId of ['t1', 't2', 't3']) manager.create(terminalId, 80, 24)
        manager.close('t1')

        const afterClose = manager.list()
        expect(afterClose.find((item) => item.terminalId === 't1')).toMatchObject({
            status: 'closed_user',
            closeReason: 'user_close'
        })
        expect(afterClose.filter((item) => item.status === 'running')).toHaveLength(2)

        manager.create('t4', 80, 24)

        expect(fakeSpawn.spawnCount).toBe(4)
        expect(manager.list().filter((item) => item.status === 'running').map((item) => item.terminalId)).toEqual(['t2', 't3', 't4'])
    })

    it('closeAll marks session terminals closed_archive with archive reason', () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('t1', 80, 24)
        manager.create('t2', 80, 24)
        manager.closeAll()

        expect(fakeSpawn.processes.map((process) => process.killCalls)).toEqual([['SIGTERM'], ['SIGTERM']])
        expect(manager.list().map((item) => ({
            terminalId: item.terminalId,
            status: item.status,
            closeReason: item.closeReason
        }))).toEqual([
            { terminalId: 't1', status: 'closed_archive', closeReason: 'archive' },
            { terminalId: 't2', status: 'closed_archive', closeReason: 'archive' }
        ])
    })

    it('keeps machine terminal detached cleanup behavior and default max unchanged', async () => {
        const previousMax = process.env.HAPI_TERMINAL_MAX_TERMINALS
        delete process.env.HAPI_TERMINAL_MAX_TERMINALS

        try {
            const fakeSpawn = installFakeSpawn()
            const errors: string[] = []
            const manager = new TerminalManager({
                machineId: 'machine-1',
                getSessionPath: () => '/tmp',
                onReady: () => {},
                onOutput: () => {},
                onExit: () => {},
                onError: (payload) => errors.push(payload.message),
                idleTimeoutMs: 0,
                detachedTimeoutMs: 1
            })

            for (const id of ['t1', 't2', 't3', 't4']) manager.create(id, 80, 24)
            manager.create('t5', 80, 24)
            expect(fakeSpawn.spawnCount).toBe(4)
            expect(errors).toContain('Too many terminals open (max 4).')
            manager.detach('t1')
            await new Promise((resolve) => setTimeout(resolve, 5))
            const states = manager.list()
            const liveStates = states.filter((item) => item.status === 'running' || item.status === 'detached')
            expect(states.every((item) => item.scopeType === 'machine')).toBe(true)
            expect(states.every((item) => item.scopeType !== 'session')).toBe(true)
            expect(states.find((item) => item.terminalId === 't2')).toMatchObject({
                scopeType: 'machine',
                machineId: 'machine-1'
            })
            expect(states.find((item) => item.terminalId === 't1')).toMatchObject({
                terminalId: 't1',
                status: 'exited',
                closeReason: 'process_exit'
            })
            expect(liveStates.map((item) => item.terminalId)).toEqual(['t2', 't3', 't4'])
        } finally {
            if (previousMax === undefined) delete process.env.HAPI_TERMINAL_MAX_TERMINALS
            else process.env.HAPI_TERMINAL_MAX_TERMINALS = previousMax
        }
    })

    it('keeps machine idle timeout cleanup behavior when configured', async () => {
        const fakeSpawn = installFakeSpawn()
        const errors: string[] = []
        const manager = new TerminalManager({
            machineId: 'machine-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: (payload) => errors.push(payload.message),
            idleTimeoutMs: 1,
            detachedTimeoutMs: 0
        })

        manager.create('tm', 80, 24)
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(errors).toEqual(['Terminal closed due to inactivity.'])
        expect(fakeSpawn.processes[0]?.killed).toBe(true)
        expect(manager.list()[0]).toMatchObject({
            terminalId: 'tm',
            status: 'closed_idle',
            closeReason: 'idle_timeout'
        })
    })

    it('bounds replay output with a truncation marker', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            maxOutputBufferChars: 64
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData(`abcde${'x'.repeat(100)}`)
        outputs.length = 0
        manager.create('terminal-1', 80, 24, undefined, true)

        expect(outputs[0]).toContain('output truncated')
        expect(outputs[0]!.length).toBeLessThanOrEqual(64)
        expect(outputs[0]).not.toContain('abcde')
    })


    it('uses 200000 chars as the default replay buffer cap with a truncation marker', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData(`prefix-secret-${'x'.repeat(200_100)}`)
        outputs.length = 0
        manager.create('terminal-1', 80, 24, undefined, true)

        expect(MAX_OUTPUT_BUFFER_CHARS).toBe(200_000)
        expect(outputs).toHaveLength(1)
        expect(outputs[0]!.length).toBeLessThanOrEqual(MAX_OUTPUT_BUFFER_CHARS)
        expect(outputs[0]).toContain('output truncated')
        expect(outputs[0]).not.toContain('prefix-secret')
    })

    it('sanitizes lifecycle log errors without message stack cwd env or output secrets', () => {
        const originalDebug = logger.debug
        const logs: unknown[] = []
        logger.debug = ((logMessage: string, metadata?: unknown) => {
            logs.push([logMessage, metadata])
        }) as typeof logger.debug

        try {
            Bun.spawn = (() => {
                const error = new Error('spawn failed token=SECRET_TOKEN cwd=/secret/project') as Error & { code?: string }
                error.code = 'EACCES'
                error.stack = 'stack with SECRET_STACK and OPENAI_API_KEY=sk-secret'
                throw error
            }) as unknown as typeof Bun.spawn

            const errors: string[] = []
            const manager = new TerminalManager({
                sessionId: 'session-1',
                getSessionPath: () => '/tmp/secret-project',
                onReady: () => {},
                onOutput: () => {},
                onExit: () => {},
                onError: (payload) => errors.push(payload.message),
                idleTimeoutMs: 0
            })

            manager.create('terminal-1', 80, 24)

            const serialized = JSON.stringify(logs)
            expect(errors).toEqual(['Failed to spawn terminal.'])
            expect(serialized).toContain('EACCES')
            expect(serialized).not.toContain('SECRET_TOKEN')
            expect(serialized).not.toContain('SECRET_STACK')
            expect(serialized).not.toContain('sk-secret')
            expect(serialized).not.toContain('/tmp/secret-project')
            expect(serialized).not.toContain('/secret/project')
            expect(serialized).not.toContain('message')
            expect(serialized).not.toContain('stack')
            expect(serialized).not.toContain('cwd')
            expect(serialized).not.toContain('env')
            expect(serialized).not.toContain('output')
        } finally {
            logger.debug = originalDebug
        }
    })

    it('sanitizes SIGTERM and SIGKILL failure logs without message stack cwd env output or secrets', () => {
        const originalDebug = logger.debug
        const logs: unknown[] = []
        logger.debug = ((logMessage: string, metadata?: unknown) => {
            logs.push([logMessage, metadata])
        }) as typeof logger.debug

        try {
            const graceCallbacks: Array<() => void> = []
            const fakeSpawn = installFakeSpawn({
                killError: (signal) => {
                    const error = new Error(`${signal} failed token=SECRET_TOKEN cwd=/secret/project output=SECRET_OUTPUT`) as Error & {
                        code?: string
                        cwd?: string
                        env?: Record<string, string>
                        output?: string
                    }
                    error.code = signal === 'SIGTERM' ? 'E_TERM' : 'E_KILL'
                    error.cwd = '/tmp/secret-project'
                    error.env = { OPENAI_API_KEY: 'sk-secret' }
                    error.output = 'SECRET_OUTPUT'
                    error.stack = `stack ${signal} SECRET_STACK cookie=session-secret`
                    return error
                }
            })
            const manager = new TerminalManager({
                sessionId: 'session-1',
                getSessionPath: () => '/tmp/secret-project',
                onReady: () => {},
                onOutput: () => {},
                onExit: () => {},
                onError: () => {},
                idleTimeoutMs: 0,
                scheduleProcessKillGrace: (callback) => {
                    graceCallbacks.push(callback)
                    return {}
                },
                clearProcessKillGrace: () => {}
            })

            manager.create('terminal-1', 80, 24)
            manager.close('terminal-1')
            graceCallbacks[0]!()

            const serialized = JSON.stringify(logs)
            expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
            expect(serialized).toContain('Failed to send terminal SIGTERM')
            expect(serialized).toContain('Failed to send terminal SIGKILL')
            expect(serialized).toContain('E_TERM')
            expect(serialized).toContain('E_KILL')
            expect(serialized).not.toContain('SECRET_TOKEN')
            expect(serialized).not.toContain('SECRET_STACK')
            expect(serialized).not.toContain('SECRET_OUTPUT')
            expect(serialized).not.toContain('sk-secret')
            expect(serialized).not.toContain('session-secret')
            expect(serialized).not.toContain('/tmp/secret-project')
            expect(serialized).not.toContain('/secret/project')
            expect(serialized).not.toContain('message')
            expect(serialized).not.toContain('stack')
            expect(serialized).not.toContain('cwd')
            expect(serialized).not.toContain('env')
            expect(serialized).not.toContain('output=')
        } finally {
            logger.debug = originalDebug
        }
    })

    it('bounds replay output when max buffer is smaller than truncation marker', () => {
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            maxOutputBufferChars: 8
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData('abcdefghijklmnopqrstuvwxyz')
        outputs.length = 0
        manager.create('terminal-1', 80, 24, undefined, true)

        expect(outputs[0]!.length).toBeLessThanOrEqual(8)
    })

    it('prunes only oldest closed metadata records over the closed record cap', () => {
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            maxClosedTerminalRecords: 2
        })

        manager.create('live', 80, 24)
        for (const id of ['t1', 't2', 't3']) {
            manager.create(id, 80, 24)
            manager.close(id)
        }

        expect(manager.list().map((item) => item.terminalId)).toEqual(['live', 't2', 't3'])
        expect(manager.list().find((item) => item.terminalId === 'live')?.status).toBe('running')
        expect(manager.list().filter((item) => item.closeReason !== null).map((item) => item.terminalId)).toEqual(['t2', 't3'])
    })

    it('ignores legacy env max and detached defaults for session terminals', async () => {
        const previousMax = process.env.HAPI_TERMINAL_MAX_TERMINALS
        const previousDetached = process.env.HAPI_TERMINAL_DETACHED_TIMEOUT_MS
        process.env.HAPI_TERMINAL_MAX_TERMINALS = '4'
        process.env.HAPI_TERMINAL_DETACHED_TIMEOUT_MS = '1'

        try {
            const fakeSpawn = installFakeSpawn()
            const manager = new TerminalManager({
                sessionId: 's1',
                getSessionPath: () => '/tmp',
                onReady: () => {},
                onOutput: () => {},
                onExit: () => {},
                onError: () => {},
                idleTimeoutMs: 0
            })

            for (const id of ['t1', 't2', 't3', 't4']) manager.create(id, 80, 24)
            expect(fakeSpawn.spawnCount).toBe(3)

            manager.detach('t1')
            await new Promise((resolve) => setTimeout(resolve, 5))
            expect(fakeSpawn.processes[0]?.killed).toBe(false)
        } finally {
            if (previousMax === undefined) delete process.env.HAPI_TERMINAL_MAX_TERMINALS
            else process.env.HAPI_TERMINAL_MAX_TERMINALS = previousMax
            if (previousDetached === undefined) delete process.env.HAPI_TERMINAL_DETACHED_TIMEOUT_MS
            else process.env.HAPI_TERMINAL_DETACHED_TIMEOUT_MS = previousDetached
        }
    })

    it('does not exceed max 3 when create is called in a same-tick burst', async () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        await Promise.all(['t1', 't2', 't3', 't4'].map(async (id) => manager.create(id, 80, 24)))

        expect(fakeSpawn.spawnCount).toBe(3)
        expect(manager.list()).toHaveLength(3)
    })



    it('refreshes lastActivityAt on keepalive without writing to the shell', () => {
        let now = 100
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 500
        manager.keepalive('terminal-1')

        expect(manager.list()[0]?.lastActivityAt).toBe(500)
        expect(fakeSpawn.processes[0]?.killed).toBe(false)
    })

    it('emits idle warning once after the configured idle threshold via scheduled check', () => {
        let now = 1_000
        installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const scheduledChecks: Array<{ delayMs: number; callback: () => void }> = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 0,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now,
            scheduleWarningCheck: (callback, delayMs) => {
                scheduledChecks.push({ callback, delayMs })
                return { id: scheduledChecks.length }
            },
            clearWarningCheck: () => {}
        })

        manager.create('terminal-1', 80, 24)
        expect(scheduledChecks[0]?.delayMs).toBe(100)

        now = 1_099
        manager.checkLifecycleWarnings()
        expect(warnings).toEqual([])

        now = 1_100
        scheduledChecks[0]!.callback()

        expect(warnings).toEqual([{
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            reason: 'idle',
            message: 'Terminal has been idle and will stop if no activity occurs.',
            closesAt: 1_000 + 4 * 60 * 60_000
        }])
        expect(TerminalWarningPayloadSchema.safeParse(warnings[0]).success).toBe(true)
        expect(JSON.stringify(warnings[0])).not.toContain('output')
        expect(manager.list()[0]).toMatchObject({
            status: 'warning_idle',
            idleWarningAt: 1_100,
            lastActivityAt: 1_000
        })

        now = 1_200
        manager.checkLifecycleWarnings()
        expect(warnings).toHaveLength(1)
    })

    it('resets idle warning after shell input, terminal output, or keepalive', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 0,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        manager.checkLifecycleWarnings()
        expect(warnings).toHaveLength(1)

        now = 1_200
        manager.write('terminal-1', 'echo input\n')
        expect(manager.list()[0]).toMatchObject({ status: 'running', idleWarningAt: null, lastActivityAt: 1_200 })
        now = 1_300
        manager.checkLifecycleWarnings()
        expect(warnings.map((warning) => warning.reason)).toEqual(['idle', 'idle'])

        now = 1_400
        fakeSpawn.emitData('shell output\n')
        expect(manager.list()[0]).toMatchObject({ status: 'running', idleWarningAt: null, lastActivityAt: 1_400 })
        now = 1_500
        manager.checkLifecycleWarnings()
        expect(warnings.map((warning) => warning.reason)).toEqual(['idle', 'idle', 'idle'])

        now = 1_600
        manager.keepalive('terminal-1')
        expect(manager.list()[0]).toMatchObject({ status: 'running', idleWarningAt: null, lastActivityAt: 1_600 })
        now = 1_700
        manager.checkLifecycleWarnings()
        expect(warnings.map((warning) => warning.reason)).toEqual(['idle', 'idle', 'idle', 'idle'])
    })

    it('does not reset idle warning timing on resize, reconnect, detach, or list', () => {
        let now = 1_000
        installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 0,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_050
        manager.resize('terminal-1', 120, 40)
        manager.create('terminal-1', 100, 30, undefined, true)
        manager.detach('terminal-1')
        manager.list()

        expect(manager.list()[0]?.lastActivityAt).toBe(1_000)

        now = 1_100
        manager.checkLifecycleWarnings()

        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatchObject({ reason: 'idle', terminalId: 'terminal-1' })
        expect(manager.list()[0]).toMatchObject({
            status: 'warning_idle',
            lastActivityAt: 1_000,
            idleWarningAt: 1_100
        })
    })

    it('does not clear warning state on detach or reconnect after idle warning', () => {
        let now = 1_000
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: () => {},
            idleTimeoutMs: 0,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        manager.checkLifecycleWarnings()
        manager.detach('terminal-1')
        manager.create('terminal-1', 100, 30, undefined, true)

        expect(manager.list()[0]).toMatchObject({
            status: 'warning_idle',
            idleWarningAt: 1_100,
            lastActivityAt: 1_000
        })
    })

    it('emits age warning before hard expiry and keepalive does not reset hard lifetime', () => {
        let now = 1_000
        installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 0,
            idleWarningMs: 10_000,
            hardLifetimeMs: 1_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        const hardExpiresAt = manager.list()[0]!.hardExpiresAt

        now = 1_500
        manager.keepalive('terminal-1')
        expect(manager.list()[0]?.hardExpiresAt).toBe(hardExpiresAt)

        now = 1_899
        manager.checkLifecycleWarnings()
        expect(warnings).toEqual([])

        now = 1_900
        manager.checkLifecycleWarnings()
        manager.keepalive('terminal-1')
        manager.checkLifecycleWarnings()

        expect(warnings).toEqual([{
            scopeType: 'session',
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            reason: 'age',
            message: 'Terminal is near its maximum age and will stop soon.',
            closesAt: hardExpiresAt
        }])
        expect(manager.list()[0]).toMatchObject({
            status: 'warning_age',
            hardExpiresAt
        })
    })

    it('emits age warning after idle warning once and leaves status warning_age', () => {
        let now = 1_000
        installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 0,
            idleWarningMs: 100,
            hardLifetimeMs: 200,
            ageWarningBeforeMs: 50,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        manager.checkLifecycleWarnings()
        now = 1_150
        manager.checkLifecycleWarnings()
        now = 1_200
        manager.checkLifecycleWarnings()

        expect(warnings.map((warning) => warning.reason)).toEqual(['idle', 'age'])
        expect(manager.list()[0]).toMatchObject({
            status: 'warning_age',
            idleWarningAt: 1_100
        })
    })

    it('warning checks do not kill processes even when idle timeout is configured', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const warnings: TerminalWarningPayload[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            onWarning: (payload) => warnings.push(payload),
            idleTimeoutMs: 400,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 2_000
        manager.checkLifecycleWarnings()

        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatchObject({ reason: 'idle', closesAt: 1_400 })
        expect(fakeSpawn.processes[0]?.killed).toBe(false)
        expect(manager.list()[0]).toMatchObject({
            status: 'warning_idle',
            closeReason: null
        })
    })

    it('closes session terminal as closed_idle after configured idle timeout', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 200,
            idleWarningMs: 100,
            hardLifetimeMs: 10_000,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_200
        manager.checkLifecycleTimeouts()

        expect(fakeSpawn.processes[0]?.killCalls[0]).toBe('SIGTERM')
        expect(manager.list()[0]).toMatchObject({
            terminalId: 'terminal-1',
            status: 'closed_idle',
            closeReason: 'idle_timeout'
        })
    })

    it('closes session terminal as closed_age at hard lifetime despite activity', () => {
        let now = 1_000
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 10_000,
            idleWarningMs: 1_000,
            hardLifetimeMs: 500,
            ageWarningBeforeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_300
        manager.keepalive('terminal-1')
        now = 1_500
        manager.checkLifecycleTimeouts()

        expect(manager.list()[0]).toMatchObject({
            terminalId: 'terminal-1',
            status: 'closed_age',
            closeReason: 'hard_timeout',
            hardExpiresAt: 1_500
        })
    })

    it('enforces expired idle timeout before keepalive can refresh activity', () => {
        let now = 1_000
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 100,
            hardLifetimeMs: 10_000,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        manager.keepalive('terminal-1')

        expect(manager.list()[0]).toMatchObject({
            status: 'closed_idle',
            closeReason: 'idle_timeout',
            lastActivityAt: 1_100
        })
    })

    it('enforces expired idle timeout before write can reach shell', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 100,
            hardLifetimeMs: 10_000,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        manager.write('terminal-1', 'echo should-not-write\n')

        expect(fakeSpawn.terminals[0]?.writes).toEqual([])
        expect(manager.list()[0]).toMatchObject({ status: 'closed_idle', closeReason: 'idle_timeout' })
    })

    it('enforces expired hard timeout before output callback can mark activity', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 10_000,
            hardLifetimeMs: 100,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_100
        fakeSpawn.emitData('late output must be dropped')

        expect(outputs).toEqual([])
        expect(manager.list()[0]).toMatchObject({ status: 'closed_age', closeReason: 'hard_timeout' })
    })

    it('uses 4h idle timeout by default for session terminals', () => {
        let now = 1_000
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_000 + 4 * 60 * 60_000
        manager.checkLifecycleTimeouts()

        expect(manager.list()[0]).toMatchObject({ status: 'closed_idle', closeReason: 'idle_timeout' })
    })

    it('uses 24h hard lifetime by default and does not reset it on activity', () => {
        let now = 1_000
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 25 * 60 * 60_000,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        now = 1_000 + 23 * 60 * 60_000 + 59 * 60_000
        manager.keepalive('terminal-1')
        now = 1_000 + 24 * 60 * 60_000
        manager.checkLifecycleTimeouts()

        expect(manager.list()[0]).toMatchObject({ status: 'closed_age', closeReason: 'hard_timeout' })
    })

    it('cleanup is idempotent and sends SIGTERM only once for repeated close', () => {
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            scheduleProcessKillGrace: () => ({})
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')
        manager.close('terminal-1')

        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM'])
        expect(manager.list()[0]).toMatchObject({ status: 'closed_user', closeReason: 'user_close' })
    })

    it('escalates stubborn terminal cleanup from SIGTERM to SIGKILL after grace', () => {
        const fakeSpawn = installFakeSpawn({ markKilledOnKill: false })
        const timers: Array<() => void> = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            processKillGraceMs: 50,
            scheduleProcessKillGrace: (callback) => {
                timers.push(callback)
                return callback
            },
            clearProcessKillGrace: () => {}
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')
        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM'])

        timers[0]!()
        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
    })

    it('falls back to subprocess SIGTERM when process-group signal fails', () => {
        const fakeSpawn = installFakeSpawn({ pid: 1_234 })
        const processKillCalls: Array<{ pid: number; signal?: NodeJS.Signals | 0 }> = []
        process.kill = ((pid: number, signal?: NodeJS.Signals | 0) => {
            processKillCalls.push({ pid, signal })
            throw new Error('no such process group')
        }) as typeof process.kill
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            scheduleProcessKillGrace: () => ({})
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')

        expect(processKillCalls).toEqual([{ pid: -1_234, signal: 'SIGTERM' }])
        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM'])
    })

    it('uses process-group fallback strategy for SIGKILL escalation too', () => {
        const fakeSpawn = installFakeSpawn({ markKilledOnKill: false, pid: 1_234 })
        const timers: Array<() => void> = []
        const processKillCalls: Array<{ pid: number; signal?: NodeJS.Signals | 0 }> = []
        process.kill = ((pid: number, signal?: NodeJS.Signals | 0) => {
            processKillCalls.push({ pid, signal })
            throw new Error('no such process group')
        }) as typeof process.kill
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            scheduleProcessKillGrace: (callback) => {
                timers.push(callback)
                return callback
            },
            clearProcessKillGrace: () => {}
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')
        timers[0]!()

        expect(processKillCalls).toEqual([
            { pid: -1_234, signal: 'SIGTERM' },
            { pid: -1_234, signal: 'SIGKILL' }
        ])
        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
    })

    it('keeps explicit close state when subprocess exits after cleanup', () => {
        const fakeSpawn = installFakeSpawn()
        let clearGraceCalls = 0
        const exits: Array<{ code: number | null; signal: string | null }> = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: (payload) => exits.push({ code: payload.code, signal: payload.signal }),
            onError: () => {},
            idleTimeoutMs: 0,
            scheduleProcessKillGrace: () => ({}),
            clearProcessKillGrace: () => {
                clearGraceCalls += 1
            }
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')
        fakeSpawn.emitExit(0)

        expect(fakeSpawn.processes[0]?.killCalls).toEqual(['SIGTERM'])
        expect(clearGraceCalls).toBe(1)
        expect(exits).toEqual([{ code: 0, signal: null }])
        expect(manager.list()[0]).toMatchObject({ status: 'closed_user', closeReason: 'user_close' })
    })

    it('does not apply session default 4h idle timeout to machine terminals', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const manager = new TerminalManager({
            machineId: 'machine-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            now: () => now,
            detachedTimeoutMs: 0
        })

        manager.create('machine-terminal', 80, 24)
        now = 1_000 + 4 * 60 * 60_000
        manager.checkLifecycleTimeouts()

        expect(fakeSpawn.processes[0]?.killCalls).toEqual([])
        expect(manager.list()[0]).toMatchObject({ status: 'running', closeReason: null })
    })

    it('clears replay buffers for user archive hard-timeout and process-exit cleanup paths', () => {
        const reasons: Array<{
            name: string
            close: (manager: TerminalManager, fakeSpawn: ReturnType<typeof installFakeSpawn>, setNow: (value: number) => void) => void
        }> = [
            { name: 'user', close: (manager) => manager.close('terminal-1') },
            { name: 'archive', close: (manager) => manager.closeAll() },
            { name: 'hard', close: (manager, _fakeSpawn, setNow) => { setNow(2_000); manager.checkLifecycleTimeouts() } },
            { name: 'process_exit', close: (_manager, fakeSpawn) => fakeSpawn.emitExit(0) }
        ]

        for (const item of reasons) {
            let now = 1_000
            const fakeSpawn = installFakeSpawn()
            const outputs: string[] = []
            const manager = new TerminalManager({
                sessionId: `session-${item.name}`,
                getSessionPath: () => '/tmp',
                onReady: () => {},
                onOutput: (payload) => outputs.push(payload.data),
                onExit: () => {},
                onError: () => {},
                idleTimeoutMs: 0,
                hardLifetimeMs: 1_000,
                now: () => now
            })

            manager.create('terminal-1', 80, 24)
            fakeSpawn.emitData(`secret output ${item.name}
`)
            item.close(manager, fakeSpawn, (value) => { now = value })
            outputs.length = 0
            manager.create('terminal-1', 80, 24, undefined, true)

            expect(outputs, item.name).toEqual([])
            expect(JSON.stringify(manager.list()), item.name).not.toContain('secret output')
        }
    })

    it('clears replay buffer on idle cleanup so closed state has no output replay', () => {
        let now = 1_000
        const fakeSpawn = installFakeSpawn()
        const outputs: string[] = []
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: (payload) => outputs.push(payload.data),
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 100,
            hardLifetimeMs: 1_000,
            now: () => now
        })

        manager.create('terminal-1', 80, 24)
        fakeSpawn.emitData('secret-like output should not replay after cleanup\n')
        now = 1_100
        manager.checkLifecycleTimeouts()
        outputs.length = 0
        manager.create('terminal-1', 80, 24, undefined, true)

        expect(outputs).toEqual([])
    })

    it('attempts process-group signal before falling back to subprocess kill', () => {
        const fakeSpawn = installFakeSpawn({ pid: 1_234 })
        const processKillCalls: Array<{ pid: number; signal?: NodeJS.Signals | 0 }> = []
        process.kill = ((pid: number, signal?: NodeJS.Signals | 0) => {
            processKillCalls.push({ pid, signal })
            return true
        }) as typeof process.kill
        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0,
            scheduleProcessKillGrace: () => ({})
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')

        expect(processKillCalls).toEqual([{ pid: -1_234, signal: 'SIGTERM' }])
        expect(fakeSpawn.processes[0]?.killCalls).toEqual([])
    })

    it('does not duplicate labels after closing a terminal and creating another', () => {
        installFakeSpawn()
        const manager = new TerminalManager({
            sessionId: 's1',
            getSessionPath: () => '/tmp',
            onReady: () => {},
            onOutput: () => {},
            onExit: () => {},
            onError: () => {},
            idleTimeoutMs: 0
        })

        manager.create('t1', 80, 24)
        manager.create('t2', 80, 24)
        manager.close('t2')
        manager.create('t3', 80, 24)

        const labels = manager.list().map((item) => item.label)
        expect(new Set(labels).size).toBe(labels.length)
        expect(labels).toEqual(['Terminal 1', 'Terminal 2', 'Terminal 3'])
    })
})
