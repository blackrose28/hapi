import type { TerminalHistoryEntry } from '@hapi/protocol'
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type BashHistoryRuntime = {
    shell: 'bash'
    directory: string
    rcPath: string
    snapshotPath: string
    tempPath: string
}

const WRAPPER_RC = [
    'if [[ -f "${HOME:-}/.bashrc" ]]; then',
    '    source "${HOME}/.bashrc"',
    'fi',
    '',
    '__hapi_capture_history() {',
    '    {',
    '        HISTTIMEFORMAT= builtin history 100 > "$HAPI_HISTORY_TEMP" &&',
    '            command mv -f -- "$HAPI_HISTORY_TEMP" "$HAPI_HISTORY_SNAPSHOT"',
    '    } 2>/dev/null',
    '    return 0',
    '}',
    '',
    "if declare -p PROMPT_COMMAND 2>/dev/null | command grep -q '^declare -a '; then",
    '    PROMPT_COMMAND+=("__hapi_capture_history")',
    'elif [[ -n "${PROMPT_COMMAND:-}" ]]; then',
    '    PROMPT_COMMAND="${PROMPT_COMMAND};__hapi_capture_history"',
    'else',
    '    PROMPT_COMMAND="__hapi_capture_history"',
    'fi',
    ''
].join('\n')

export function parseBashHistorySnapshot(snapshot: string, limit: number): TerminalHistoryEntry[] {
    const entries: TerminalHistoryEntry[] = []
    let current: TerminalHistoryEntry | null = null

    for (const line of snapshot.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line)
        if (match) {
            if (current && current.command.length > 0) {
                entries.push(current)
            }
            const index = Number.parseInt(match[1]!, 10)
            const command = match[2] ?? ''
            current = command.length > 0 && Number.isSafeInteger(index)
                ? { index, command }
                : null
            continue
        }

        if (current && line.length > 0) {
            current.command += `\n${line}`
        }
    }

    if (current && current.command.length > 0) {
        entries.push(current)
    }

    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
    return entries.reverse().slice(0, boundedLimit)
}

export function createBashHistoryRuntime(input: {
    terminalId: string
    rootDir?: string
}): BashHistoryRuntime {
    const rootDir = input.rootDir ?? tmpdir()
    mkdirSync(rootDir, { recursive: true })
    const safeTerminalId = input.terminalId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'terminal'
    const directory = mkdtempSync(join(rootDir, `hapi-${safeTerminalId}-history-`))
    chmodSync(directory, 0o700)

    const runtime: BashHistoryRuntime = {
        shell: 'bash',
        directory,
        rcPath: join(directory, 'bashrc'),
        snapshotPath: join(directory, 'history.snapshot'),
        tempPath: join(directory, 'history.tmp')
    }

    try {
        writeFileSync(runtime.rcPath, WRAPPER_RC, { mode: 0o600 })
        chmodSync(runtime.rcPath, 0o600)
        return runtime
    } catch (error) {
        rmSync(directory, { recursive: true, force: true })
        throw error
    }
}

export function cleanupBashHistoryRuntime(runtime: BashHistoryRuntime): void {
    rmSync(runtime.directory, { recursive: true, force: true })
}
