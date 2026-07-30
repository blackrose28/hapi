import { afterEach, describe, expect, it } from 'bun:test'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    cleanupBashHistoryRuntime,
    createBashHistoryRuntime,
    parseBashHistorySnapshot
} from './bashHistory'

const cleanupRoots: string[] = []

afterEach(() => {
    for (const root of cleanupRoots.splice(0)) {
        Bun.spawnSync(['rm', '-rf', root])
    }
})

describe('parseBashHistorySnapshot', () => {
    it('returns newest commands first and joins continuation lines', () => {
        expect(parseBashHistorySnapshot(
            '   40  pwd\n   41  printf "a\\\\nb"\ncontinuation\n   42  git status\n',
            100
        )).toEqual([
            { index: 42, command: 'git status' },
            { index: 41, command: 'printf "a\\\\nb"\ncontinuation' },
            { index: 40, command: 'pwd' }
        ])
    })

    it('keeps duplicates and limits the newest entries', () => {
        expect(parseBashHistorySnapshot(
            '  1  pwd\n  2  pwd\n  3  ls\n',
            2
        )).toEqual([
            { index: 3, command: 'ls' },
            { index: 2, command: 'pwd' }
        ])
    })

    it('ignores empty and malformed leading lines', () => {
        expect(parseBashHistorySnapshot(
            'orphan\n   1  \n   2  echo ok\n',
            100
        )).toEqual([{ index: 2, command: 'echo ok' }])
    })
})

describe('Bash history runtime', () => {
    it('creates private runtime files and removes them', () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'hapi-history-test-'))
        cleanupRoots.push(rootDir)

        const runtime = createBashHistoryRuntime({ terminalId: 'term-1', rootDir })

        expect(statSync(runtime.directory).mode & 0o777).toBe(0o700)
        expect(statSync(runtime.rcPath).mode & 0o777).toBe(0o600)
        const wrapper = readFileSync(runtime.rcPath, 'utf8')
        expect(wrapper).toContain('builtin history 100')
        expect(wrapper).toContain('PROMPT_COMMAND')
        expect(wrapper).not.toContain('history -a')
        expect(wrapper).not.toContain('history -w')

        cleanupBashHistoryRuntime(runtime)
        expect(existsSync(runtime.directory)).toBe(false)
    })

    it('preserves the user prompt command and writes a snapshot without changing bash history', async () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'hapi-history-test-'))
        cleanupRoots.push(rootDir)
        const home = join(rootDir, 'home')
        mkdirSync(home)
        const promptMarker = join(rootDir, 'prompt-marker')
        const bashHistory = join(home, '.bash_history')
        writeFileSync(bashHistory, 'persisted-command\n', { mode: 0o600 })
        writeFileSync(join(home, '.bashrc'), [
            `PROMPT_COMMAND='printf preserved > "${promptMarker}"'`,
            'HISTFILE="$HOME/.bash_history"',
            'history -c',
            'history -r'
        ].join('\n'))

        const runtime = createBashHistoryRuntime({ terminalId: 'term-2', rootDir })
        const proc = Bun.spawnSync([
            '/bin/bash',
            '--noprofile',
            '--norc',
            '-c',
            'set -o history; source "$HAPI_WRAPPER_RC"; HISTFILE=/dev/null; history -s "echo live-command >/dev/null"; eval "$PROMPT_COMMAND"'
        ], {
            env: {
                ...process.env,
                HOME: home,
                TERM: 'dumb',
                HAPI_WRAPPER_RC: runtime.rcPath,
                HAPI_HISTORY_SNAPSHOT: runtime.snapshotPath,
                HAPI_HISTORY_TEMP: runtime.tempPath
            },
            stdout: 'ignore',
            stderr: 'ignore'
        })

        expect(proc.exitCode).toBe(0)

        expect(readFileSync(promptMarker, 'utf8')).toBe('preserved')
        expect(readFileSync(runtime.snapshotPath, 'utf8')).toContain('echo live-command')
        expect(readFileSync(bashHistory, 'utf8')).toBe('persisted-command\n')
    })
})
