import { logger } from '@/ui/logger'
import { getInvokedCwd } from '@/utils/invokedCwd'
import type {
    TerminalCloseReason,
    TerminalErrorPayload,
    TerminalExitPayload,
    TerminalHistoryRequest,
    TerminalHistoryResult,
    TerminalOutputPayload,
    TerminalReadyPayload,
    TerminalState,
    TerminalWarningPayload
} from '@hapi/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
    cleanupBashHistoryRuntime,
    createBashHistoryRuntime,
    parseBashHistorySnapshot,
    type BashHistoryRuntime
} from './bashHistory'
import type { TerminalSession } from './types'

type WarningTimerHandle = ReturnType<typeof setTimeout> | unknown
type LifecycleTimerHandle = ReturnType<typeof setTimeout> | unknown
type ProcessKillTimerHandle = ReturnType<typeof setTimeout> | unknown

type TerminalHistoryCapability =
    | { status: 'ready'; shell: 'bash'; runtime: BashHistoryRuntime }
    | { status: 'unsupported_shell'; shell: string }
    | { status: 'read_failed'; shell: 'bash' }

type TerminalRuntime = TerminalSession & {
    proc: Bun.Subprocess
    terminal: Bun.Terminal
    idleTimer: ReturnType<typeof setTimeout> | null
    warningTimer: WarningTimerHandle | null
    lifecycleTimer: LifecycleTimerHandle | null
    detachedTimer: ReturnType<typeof setTimeout> | null
    processKillGraceTimer: ProcessKillTimerHandle | null
    processExited: boolean
    outputBuffer: string
    history: TerminalHistoryCapability
}

type TerminalMetadataRecord = {
    terminalId: string
    label: string
    cwd?: string
    createdAt: number
    lastActivityAt: number
    idleWarningAt: number | null
    hardExpiresAt: number
    cols: number
    rows: number
    status: TerminalState['status']
    closeReason: TerminalCloseReason | null
}

type TerminalManagerOptions = {
    sessionId?: string
    machineId?: string
    getSessionPath: () => string | null
    onReady: (payload: TerminalReadyPayload) => void
    onOutput: (payload: TerminalOutputPayload) => void
    onExit: (payload: TerminalExitPayload) => void
    onError: (payload: TerminalErrorPayload) => void
    onWarning?: (payload: TerminalWarningPayload) => void
    idleTimeoutMs?: number
    idleWarningMs?: number
    hardLifetimeMs?: number
    ageWarningBeforeMs?: number
    detachedTimeoutMs?: number
    maxTerminals?: number
    maxOutputBufferChars?: number
    maxClosedTerminalRecords?: number
    processKillGraceMs?: number
    now?: () => number
    scheduleWarningCheck?: (callback: () => void, delayMs: number) => WarningTimerHandle
    clearWarningCheck?: (timer: WarningTimerHandle) => void
    scheduleLifecycleCheck?: (callback: () => void, delayMs: number) => LifecycleTimerHandle
    clearLifecycleCheck?: (timer: LifecycleTimerHandle) => void
    scheduleProcessKillGrace?: (callback: () => void, delayMs: number) => ProcessKillTimerHandle
    clearProcessKillGrace?: (timer: ProcessKillTimerHandle) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 0
const DEFAULT_IDLE_WARNING_MS = 2 * 60 * 60_000
const DEFAULT_PLANNED_IDLE_CLOSE_MS = 4 * 60 * 60_000
const DEFAULT_DETACHED_TIMEOUT_MS = 5 * 60_000
const DEFAULT_SESSION_MAX_TERMINALS = 3
const DEFAULT_MACHINE_MAX_TERMINALS = 4
const DEFAULT_HARD_LIFETIME_MS = 24 * 60 * 60_000
const DEFAULT_AGE_WARNING_BEFORE_MS = 30 * 60_000
const DEFAULT_PROCESS_KILL_GRACE_MS = 2_000
export const MAX_OUTPUT_BUFFER_CHARS = 200_000
const DEFAULT_MAX_CLOSED_TERMINAL_RECORDS = 20
const OUTPUT_TRUNCATION_MARKER = '\n[... output truncated ...]\n'
const TINY_OUTPUT_TRUNCATION_MARKER = '…'
const SENSITIVE_ENV_KEY_PATTERNS = [
    'TOKEN',
    'SECRET',
    'PASSWORD',
    'PASS',
    'API_KEY',
    'PRIVATE_KEY',
    'ACCESS_KEY',
    'CREDENTIALS',
    'AUTH_TOKEN',
    'AUTH_SECRET',
    'AUTHORIZATION',
    'DATABASE',
    'DB_URL',
    'POSTGRES',
    'MYSQL',
    'MONGO',
    'REDIS',
    'NEON',
    'TURSO'
]
const SENSITIVE_ENV_KEY_EXACT = new Set(['DATABASE_URL', 'REDIS_URL'])

export function isSensitiveEnvKey(key: string): boolean {
    const upperKey = key.toUpperCase()
    return SENSITIVE_ENV_KEY_EXACT.has(upperKey)
        || SENSITIVE_ENV_KEY_PATTERNS.some((pattern) => upperKey.includes(pattern))
}

const SENSITIVE_CWD_PATTERN = /(?:token|secret|cookie|password|pass|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth|sk-[a-z0-9_-]+|ghp_[a-z0-9_]+|github_pat_[a-z0-9_]+|glpat-[a-z0-9_-]+|xox[baprs]-[a-z0-9-]+|AIza[a-z0-9_-]+)/i

function sanitizeCwdForMetadata(cwd: string): string | undefined {
    const normalized = cwd.trim().replace(/[\\/]+$/, '')
    if (!normalized) {
        return undefined
    }
    const pathSegments = normalized.split(/[\\/]+/).filter(Boolean)
    const displayName = pathSegments.at(-1) ?? normalized
    if (!displayName) {
        return normalized === '/' ? '/' : undefined
    }
    return SENSITIVE_CWD_PATTERN.test(displayName) ? '[redacted]' : displayName
}

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveEnvNumberAllowZero(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveShell(): string {
    if (process.env.SHELL) {
        return process.env.SHELL
    }
    if (process.platform === 'darwin') {
        return '/bin/zsh'
    }
    return '/bin/bash'
}

function buildFilteredEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (!value) {
            continue
        }
        if (isSensitiveEnvKey(key)) {
            continue
        }
        env[key] = value
    }
    if (!env.TERM) {
        env.TERM = 'xterm-256color'
    }
    if (!env.COLORTERM) {
        env.COLORTERM = 'truecolor'
    }
    if (!env.LANG) {
        env.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
    }
    return env
}

function sanitizeTerminalError(error: unknown): { name?: string; code?: string } {
    if (!(error instanceof Error)) return {}
    const errorWithCode = error as Error & { code?: unknown }
    const code = typeof errorWithCode.code === 'string'
        ? errorWithCode.code
        : undefined
    return { name: error.name, code }
}

export class TerminalManager {
    private readonly sessionId?: string
    private readonly machineId?: string
    private readonly getSessionPath: () => string | null
    private readonly onReady: (payload: TerminalReadyPayload) => void
    private readonly onOutput: (payload: TerminalOutputPayload) => void
    private readonly onExit: (payload: TerminalExitPayload) => void
    private readonly onError: (payload: TerminalErrorPayload) => void
    private readonly onWarning: (payload: TerminalWarningPayload) => void
    private readonly idleTimeoutMs: number
    private readonly idleWarningMs: number
    private readonly hardLifetimeMs: number
    private readonly ageWarningBeforeMs: number
    private readonly detachedTimeoutMs: number
    private readonly maxTerminals: number
    private readonly maxOutputBufferChars: number
    private readonly maxClosedTerminalRecords: number
    private readonly processKillGraceMs: number
    private readonly now: () => number
    private readonly scheduleWarningCheck: (callback: () => void, delayMs: number) => WarningTimerHandle
    private readonly clearWarningCheck: (timer: WarningTimerHandle) => void
    private readonly scheduleLifecycleCheck: (callback: () => void, delayMs: number) => LifecycleTimerHandle
    private readonly clearLifecycleCheck: (timer: LifecycleTimerHandle) => void
    private readonly scheduleProcessKillGrace: (callback: () => void, delayMs: number) => ProcessKillTimerHandle
    private readonly clearProcessKillGrace: (timer: ProcessKillTimerHandle) => void
    private readonly terminals: Map<string, TerminalRuntime> = new Map()
    private readonly terminalRecords: Map<string, TerminalMetadataRecord> = new Map()
    private readonly ageWarningAtByTerminal: Map<string, number> = new Map()
    private readonly filteredEnv: NodeJS.ProcessEnv
    private nextTerminalLabelNumber = 1

    constructor(options: TerminalManagerOptions) {
        if (Boolean(options.sessionId) === Boolean(options.machineId)) {
            throw new Error('TerminalManager requires exactly one of sessionId or machineId')
        }
        this.sessionId = options.sessionId
        this.machineId = options.machineId
        this.getSessionPath = options.getSessionPath
        this.onReady = options.onReady
        this.onOutput = options.onOutput
        this.onExit = options.onExit
        this.onError = options.onError
        this.onWarning = options.onWarning ?? (() => {})
        const isSessionScope = Boolean(options.sessionId)
        this.idleTimeoutMs = options.idleTimeoutMs
            ?? (isSessionScope ? DEFAULT_PLANNED_IDLE_CLOSE_MS : resolveEnvNumber('HAPI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS))
        this.idleWarningMs = options.idleWarningMs ?? DEFAULT_IDLE_WARNING_MS
        this.hardLifetimeMs = options.hardLifetimeMs ?? DEFAULT_HARD_LIFETIME_MS
        this.ageWarningBeforeMs = options.ageWarningBeforeMs ?? DEFAULT_AGE_WARNING_BEFORE_MS
        this.detachedTimeoutMs = isSessionScope
            ? 0
            : (options.detachedTimeoutMs ?? resolveEnvNumberAllowZero('HAPI_TERMINAL_DETACHED_TIMEOUT_MS', DEFAULT_DETACHED_TIMEOUT_MS))
        this.maxTerminals = options.maxTerminals
            ?? (isSessionScope ? DEFAULT_SESSION_MAX_TERMINALS : resolveEnvNumber('HAPI_TERMINAL_MAX_TERMINALS', DEFAULT_MACHINE_MAX_TERMINALS))
        this.maxOutputBufferChars = options.maxOutputBufferChars ?? MAX_OUTPUT_BUFFER_CHARS
        this.maxClosedTerminalRecords = options.maxClosedTerminalRecords ?? DEFAULT_MAX_CLOSED_TERMINAL_RECORDS
        this.processKillGraceMs = options.processKillGraceMs ?? DEFAULT_PROCESS_KILL_GRACE_MS
        this.now = options.now ?? Date.now
        this.scheduleWarningCheck = options.scheduleWarningCheck ?? ((callback, delayMs) => setTimeout(callback, delayMs))
        this.clearWarningCheck = options.clearWarningCheck ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
        this.scheduleLifecycleCheck = options.scheduleLifecycleCheck ?? ((callback, delayMs) => setTimeout(callback, delayMs))
        this.clearLifecycleCheck = options.clearLifecycleCheck ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
        this.scheduleProcessKillGrace = options.scheduleProcessKillGrace ?? ((callback, delayMs) => setTimeout(callback, delayMs))
        this.clearProcessKillGrace = options.clearProcessKillGrace ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
        this.filteredEnv = buildFilteredEnv()
    }

    list(): TerminalState[] {
        return Array.from(this.terminalRecords.values()).map((record) => ({
            ...this.typedScopePayload(),
            ...record
        }))
    }

    getHistory(request: TerminalHistoryRequest): TerminalHistoryResult {
        const responseBase = {
            ...this.scopePayload(),
            terminalId: request.terminalId,
            requestId: request.requestId
        }
        const runtime = this.terminals.get(request.terminalId)
        if (!runtime || !this.requestMatchesScope(request)) {
            return {
                ...responseBase,
                status: 'not_ready',
                entries: []
            }
        }

        if (runtime.history.status === 'unsupported_shell') {
            return {
                ...responseBase,
                status: 'unsupported_shell',
                shell: runtime.history.shell,
                entries: []
            }
        }
        if (runtime.history.status === 'read_failed') {
            return {
                ...responseBase,
                status: 'read_failed',
                shell: runtime.history.shell,
                entries: []
            }
        }

        const { snapshotPath } = runtime.history.runtime
        if (!existsSync(snapshotPath)) {
            return {
                ...responseBase,
                status: 'not_ready',
                shell: runtime.history.shell,
                entries: []
            }
        }

        try {
            const snapshot = readFileSync(snapshotPath, 'utf8')
            return {
                ...responseBase,
                status: 'ok',
                shell: runtime.history.shell,
                entries: parseBashHistorySnapshot(snapshot, request.limit ?? 100)
            }
        } catch {
            return {
                ...responseBase,
                status: 'read_failed',
                shell: runtime.history.shell,
                entries: []
            }
        }
    }

    create(terminalId: string, cols: number, rows: number, cwd?: string, replay = false): void {
        if (process.platform === 'win32') {
            this.emitError(terminalId, 'Remote terminal is not supported on Windows yet.')
            return
        }

        const existing = this.terminals.get(terminalId)
        if (existing) {
            if (!this.enforceLifecycleBeforeUse(terminalId)) {
                return
            }
            existing.cols = cols
            existing.rows = rows
            const existingRecord = this.terminalRecords.get(terminalId)
            if (existingRecord) {
                existingRecord.cols = cols
                existingRecord.rows = rows
                if (existingRecord.status === 'detached') {
                    existingRecord.status = 'running'
                }
                existingRecord.closeReason = null
            }
            this.clearDetachedTimer(existing)
            existing.terminal.resize(cols, rows)
            if (this.sessionId) {
                this.scheduleWarningTimer(existing)
                this.scheduleLifecycleTimer(existing)
            }
            else this.markRealActivity(existing)
            this.onReady({ ...this.scopePayload(), terminalId })
            if (replay && existing.outputBuffer) {
                this.onOutput({ ...this.scopePayload(), terminalId, data: existing.outputBuffer })
            }
            return
        }

        if (this.terminals.size >= this.maxTerminals) {
            this.emitError(terminalId, `Too many terminals open (max ${this.maxTerminals}).`)
            return
        }

        if (typeof Bun === 'undefined' || typeof Bun.spawn !== 'function') {
            this.emitError(terminalId, 'Terminal is unavailable in this runtime.')
            return
        }

        const sessionPath = cwd?.trim() || this.getSessionPath() || getInvokedCwd()
        const shell = resolveShell()
        const shellName = basename(shell)
        const decoder = new TextDecoder()
        const now = this.now()
        let runtime: TerminalRuntime | null = null
        let history: TerminalHistoryCapability = {
            status: 'unsupported_shell',
            shell: shellName
        }
        let spawnCommand = [shell]
        let spawnEnv = this.filteredEnv

        if (shellName === 'bash') {
            try {
                const historyRuntime = createBashHistoryRuntime({ terminalId })
                history = { status: 'ready', shell: 'bash', runtime: historyRuntime }
                spawnCommand = [shell, '--rcfile', historyRuntime.rcPath]
                spawnEnv = {
                    ...this.filteredEnv,
                    HAPI_HISTORY_SNAPSHOT: historyRuntime.snapshotPath,
                    HAPI_HISTORY_TEMP: historyRuntime.tempPath
                }
            } catch {
                history = { status: 'read_failed', shell: 'bash' }
            }
        }

        try {
            const proc = Bun.spawn(spawnCommand, {
                cwd: sessionPath,
                env: spawnEnv,
                terminal: {
                    cols,
                    rows,
                    data: (terminal, data) => {
                        if (!this.enforceLifecycleBeforeUse(terminalId)) {
                            return
                        }
                        const text = decoder.decode(data, { stream: true })
                        if (text) {
                            this.appendOutputBuffer(terminalId, text)
                            this.onOutput({ ...this.scopePayload(), terminalId, data: text })
                        }
                        const active = this.terminals.get(terminalId)
                        if (active) {
                            this.markRealActivity(active)
                        }
                    },
                    exit: (terminal, exitCode) => {
                        if (exitCode === 1) {
                            this.emitError(terminalId, 'Terminal stream closed unexpectedly.')
                        }
                    }
                },
                onExit: (subprocess, exitCode) => {
                    if (runtime) {
                        runtime.processExited = true
                        this.clearProcessKillGraceTimer(runtime)
                    }
                    const signal = subprocess.signalCode ?? null
                    this.onExit({
                        ...this.scopePayload(),
                        terminalId,
                        code: exitCode ?? null,
                        signal
                    })
                    this.cleanup(terminalId, 'process_exit')
                }
            })

            const terminal = proc.terminal
            if (!terminal) {
                try {
                    proc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill process after missing terminal', { error: sanitizeTerminalError(error) })
                }
                this.emitError(terminalId, 'Failed to attach terminal.')
                this.cleanupHistoryCapability(history)
                return
            }

            runtime = {
                terminalId,
                cols,
                rows,
                proc,
                terminal,
                idleTimer: null,
                warningTimer: null,
                lifecycleTimer: null,
                detachedTimer: null,
                processKillGraceTimer: null,
                processExited: false,
                outputBuffer: '',
                history
            }
            const record: TerminalMetadataRecord = {
                terminalId,
                label: `Terminal ${this.nextTerminalLabelNumber++}`,
                cwd: sanitizeCwdForMetadata(sessionPath),
                createdAt: now,
                lastActivityAt: now,
                idleWarningAt: null,
                hardExpiresAt: now + this.hardLifetimeMs,
                cols,
                rows,
                status: 'running',
                closeReason: null
            }

            this.terminals.set(terminalId, runtime)
            this.terminalRecords.set(terminalId, record)
            if (this.sessionId) {
                this.scheduleWarningTimer(runtime)
                this.scheduleLifecycleTimer(runtime)
            }
            else this.scheduleMachineIdleTimer(runtime)
            this.onReady({ ...this.scopePayload(), terminalId })
        } catch (error) {
            this.cleanupHistoryCapability(history)
            logger.debug('[TERMINAL] Failed to spawn terminal', { error: sanitizeTerminalError(error) })
            this.emitError(terminalId, 'Failed to spawn terminal.')
        }
    }

    write(terminalId: string, data: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            this.emitError(terminalId, 'Terminal not found.')
            return
        }
        if (!this.enforceLifecycleBeforeUse(terminalId)) {
            return
        }
        runtime.terminal.write(data)
        this.markRealActivity(runtime)
    }

    resize(terminalId: string, cols: number, rows: number): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        if (!this.enforceLifecycleBeforeUse(terminalId)) {
            return
        }
        runtime.cols = cols
        runtime.rows = rows
        const record = this.terminalRecords.get(terminalId)
        if (record) {
            record.cols = cols
            record.rows = rows
        }
        runtime.terminal.resize(cols, rows)
        if (this.sessionId) {
            this.scheduleWarningTimer(runtime)
            this.scheduleLifecycleTimer(runtime)
        }
        else this.markRealActivity(runtime)
    }

    close(terminalId: string): void {
        this.cleanup(terminalId, 'user_close')
    }

    detach(terminalId: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        if (!this.enforceLifecycleBeforeUse(terminalId)) {
            return
        }

        const record = this.terminalRecords.get(terminalId)
        if (record?.status === 'running') {
            record.status = 'detached'
        }

        if (this.detachedTimeoutMs <= 0) {
            return
        }

        this.clearDetachedTimer(runtime)
        runtime.detachedTimer = setTimeout(() => {
            this.cleanup(runtime.terminalId, 'process_exit')
        }, this.detachedTimeoutMs)
    }

    keepalive(terminalId: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        if (!this.enforceLifecycleBeforeUse(terminalId)) {
            return
        }
        this.markRealActivity(runtime)
    }

    checkLifecycleWarnings(): void {
        if (!this.sessionId) {
            return
        }

        const now = this.now()
        for (const runtime of this.terminals.values()) {
            const record = this.terminalRecords.get(runtime.terminalId)
            if (!record || !this.isLiveStatus(record.status)) {
                continue
            }

            const idleWarningDue = this.idleWarningMs > 0
                && record.idleWarningAt === null
                && now - record.lastActivityAt >= this.idleWarningMs
            if (idleWarningDue) {
                record.idleWarningAt = now
                record.status = 'warning_idle'
                this.onWarning({
                    ...this.typedScopePayload(),
                    terminalId: record.terminalId,
                    reason: 'idle',
                    message: 'Terminal has been idle and will stop if no activity occurs.',
                    closesAt: this.idleClosesAt(record)
                })
            }

            const ageWarningDue = this.ageWarningBeforeMs > 0
                && !this.ageWarningAtByTerminal.has(record.terminalId)
                && now >= record.hardExpiresAt - this.ageWarningBeforeMs
            if (ageWarningDue) {
                this.ageWarningAtByTerminal.set(record.terminalId, now)
                record.status = 'warning_age'
                this.onWarning({
                    ...this.typedScopePayload(),
                    terminalId: record.terminalId,
                    reason: 'age',
                    message: 'Terminal is near its maximum age and will stop soon.',
                    closesAt: record.hardExpiresAt
                })
            }

            this.scheduleWarningTimer(runtime)
        }
    }

    checkLifecycleTimeouts(): void {
        if (!this.sessionId) {
            return
        }

        const due: Array<{ terminalId: string; reason: TerminalCloseReason }> = []
        for (const record of this.terminalRecords.values()) {
            if (!this.isLiveStatus(record.status)) {
                continue
            }
            const reason = this.lifecycleCloseReason(record)
            if (reason) {
                due.push({ terminalId: record.terminalId, reason })
            }
        }

        for (const item of due) {
            this.cleanup(item.terminalId, item.reason)
        }
        for (const runtime of this.terminals.values()) {
            this.scheduleLifecycleTimer(runtime)
        }
    }

    private appendOutputBuffer(terminalId: string, text: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) return
        runtime.outputBuffer += text
        if (runtime.outputBuffer.length > this.maxOutputBufferChars) {
            if (this.maxOutputBufferChars <= 0) {
                runtime.outputBuffer = ''
                return
            }
            const marker = this.maxOutputBufferChars >= OUTPUT_TRUNCATION_MARKER.length
                ? OUTPUT_TRUNCATION_MARKER
                : TINY_OUTPUT_TRUNCATION_MARKER
            const safeMarker = marker.slice(0, this.maxOutputBufferChars)
            const keepLength = Math.max(0, this.maxOutputBufferChars - safeMarker.length)
            runtime.outputBuffer = `${safeMarker}${runtime.outputBuffer.slice(-keepLength)}`
        }
    }

    closeAll(): void {
        for (const terminalId of Array.from(this.terminals.keys())) {
            this.cleanup(terminalId, 'archive')
        }
    }

    private markRealActivity(runtime: TerminalRuntime): void {
        const record = this.terminalRecords.get(runtime.terminalId)
        if (record) {
            record.lastActivityAt = this.now()
            record.idleWarningAt = null
            if (record.status === 'warning_idle') {
                record.status = 'running'
            }
        }
        this.clearDetachedTimer(runtime)
        if (this.sessionId) {
            this.scheduleWarningTimer(runtime)
            this.scheduleLifecycleTimer(runtime)
        }
        else this.scheduleMachineIdleTimer(runtime)
    }

    private scheduleMachineIdleTimer(runtime: TerminalRuntime): void {
        if (this.sessionId || this.idleTimeoutMs <= 0) {
            return
        }
        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
            runtime.idleTimer = null
        }
        this.clearDetachedTimer(runtime)
        runtime.idleTimer = setTimeout(() => {
            this.emitError(runtime.terminalId, 'Terminal closed due to inactivity.')
            this.cleanup(runtime.terminalId, 'idle_timeout')
        }, this.idleTimeoutMs)
    }

    private scheduleWarningTimer(runtime: TerminalRuntime): void {
        if (!this.sessionId) {
            return
        }

        if (runtime.warningTimer) {
            this.clearWarningCheck(runtime.warningTimer)
            runtime.warningTimer = null
        }

        const record = this.terminalRecords.get(runtime.terminalId)
        if (!record || !this.isLiveStatus(record.status)) {
            return
        }

        const now = this.now()
        const dueTimes: number[] = []
        if (this.idleWarningMs > 0 && record.idleWarningAt === null) {
            dueTimes.push(record.lastActivityAt + this.idleWarningMs)
        }
        if (this.ageWarningBeforeMs > 0 && !this.ageWarningAtByTerminal.has(record.terminalId)) {
            dueTimes.push(record.hardExpiresAt - this.ageWarningBeforeMs)
        }
        if (dueTimes.length === 0) {
            return
        }

        const nextDueAt = Math.min(...dueTimes)
        const delayMs = Math.max(0, nextDueAt - now)
        runtime.warningTimer = this.scheduleWarningCheck(() => {
            runtime.warningTimer = null
            this.checkLifecycleWarnings()
        }, delayMs)
        const maybeUnref = (runtime.warningTimer as { unref?: () => void } | null)?.unref
        if (typeof maybeUnref === 'function') {
            maybeUnref.call(runtime.warningTimer)
        }
    }

    private scheduleLifecycleTimer(runtime: TerminalRuntime): void {
        if (!this.sessionId) {
            return
        }

        if (runtime.lifecycleTimer) {
            this.clearLifecycleCheck(runtime.lifecycleTimer)
            runtime.lifecycleTimer = null
        }

        const record = this.terminalRecords.get(runtime.terminalId)
        if (!record || !this.isLiveStatus(record.status)) {
            return
        }

        const dueTimes = [record.hardExpiresAt]
        if (this.idleTimeoutMs > 0) {
            dueTimes.push(record.lastActivityAt + this.idleTimeoutMs)
        }
        const delayMs = Math.max(0, Math.min(...dueTimes) - this.now())
        runtime.lifecycleTimer = this.scheduleLifecycleCheck(() => {
            runtime.lifecycleTimer = null
            this.checkLifecycleTimeouts()
        }, delayMs)
        const maybeUnref = (runtime.lifecycleTimer as { unref?: () => void } | null)?.unref
        if (typeof maybeUnref === 'function') {
            maybeUnref.call(runtime.lifecycleTimer)
        }
    }

    private enforceLifecycleBeforeUse(terminalId: string): boolean {
        if (!this.sessionId) {
            return true
        }
        const record = this.terminalRecords.get(terminalId)
        if (!record || !this.isLiveStatus(record.status)) {
            return false
        }
        const reason = this.lifecycleCloseReason(record)
        if (!reason) {
            return true
        }
        this.cleanup(terminalId, reason)
        return false
    }

    private lifecycleCloseReason(record: TerminalMetadataRecord): TerminalCloseReason | null {
        const now = this.now()
        if (now >= record.hardExpiresAt) {
            return 'hard_timeout'
        }
        if (this.idleTimeoutMs > 0 && now - record.lastActivityAt >= this.idleTimeoutMs) {
            return 'idle_timeout'
        }
        return null
    }

    private idleClosesAt(record: TerminalMetadataRecord): number {
        const idleCloseAfterMs = this.idleTimeoutMs > 0 ? this.idleTimeoutMs : DEFAULT_PLANNED_IDLE_CLOSE_MS
        return record.lastActivityAt + idleCloseAfterMs
    }

    private cleanup(terminalId: string, reason: TerminalCloseReason): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }

        runtime.outputBuffer = ''
        this.terminals.delete(terminalId)
        const record = this.terminalRecords.get(terminalId)
        if (record) {
            record.status = this.statusForCloseReason(reason)
            record.closeReason = reason
            record.lastActivityAt = this.now()
        }
        this.ageWarningAtByTerminal.delete(terminalId)
        this.pruneClosedTerminalRecords()
        if (runtime.warningTimer) {
            this.clearWarningCheck(runtime.warningTimer)
            runtime.warningTimer = null
        }
        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
            runtime.idleTimer = null
        }
        if (runtime.lifecycleTimer) {
            this.clearLifecycleCheck(runtime.lifecycleTimer)
            runtime.lifecycleTimer = null
        }
        this.clearDetachedTimer(runtime)
        this.cleanupHistoryCapability(runtime.history)

        this.terminateProcess(runtime, reason)

        try {
            runtime.terminal.close()
        } catch (error) {
            logger.debug('[TERMINAL] Failed to close terminal', { error: sanitizeTerminalError(error) })
        }
    }

    private terminateProcess(runtime: TerminalRuntime, reason: TerminalCloseReason): void {
        if (runtime.processExited || runtime.proc.exitCode !== null || runtime.processKillGraceTimer) {
            return
        }

        try {
            this.sendProcessSignal(runtime.proc, 'SIGTERM')
        } catch (error) {
            logger.debug('[TERMINAL] Failed to send terminal SIGTERM', {
                terminalId: runtime.terminalId,
                reason,
                error: sanitizeTerminalError(error)
            })
        }

        runtime.processKillGraceTimer = this.scheduleProcessKillGrace(() => {
            runtime.processKillGraceTimer = null
            if (runtime.processExited || runtime.proc.exitCode !== null) {
                return
            }
            try {
                this.sendProcessSignal(runtime.proc, 'SIGKILL')
            } catch (error) {
                logger.debug('[TERMINAL] Failed to send terminal SIGKILL', {
                    terminalId: runtime.terminalId,
                    reason,
                    error: sanitizeTerminalError(error)
                })
            }
        }, this.processKillGraceMs)
        const maybeUnref = (runtime.processKillGraceTimer as { unref?: () => void } | null)?.unref
        if (typeof maybeUnref === 'function') {
            maybeUnref.call(runtime.processKillGraceTimer)
        }
    }

    private sendProcessSignal(proc: Bun.Subprocess, signal: NodeJS.Signals): void {
        const pid = (proc as { pid?: number }).pid
        if (pid && process.platform !== 'win32') {
            try {
                process.kill(-pid, signal)
                return
            } catch {
                // Fall back to Bun subprocess signal below.
            }
        }
        proc.kill(signal)
    }

    private clearProcessKillGraceTimer(runtime: TerminalRuntime): void {
        if (!runtime.processKillGraceTimer) {
            return
        }
        this.clearProcessKillGrace(runtime.processKillGraceTimer)
        runtime.processKillGraceTimer = null
    }

    private pruneClosedTerminalRecords(): void {
        const closedRecords = Array.from(this.terminalRecords.values())
            .filter((record) => !this.isLiveStatus(record.status))
        const pruneCount = closedRecords.length - this.maxClosedTerminalRecords
        if (pruneCount <= 0) {
            return
        }
        for (const record of closedRecords.slice(0, pruneCount)) {
            this.terminalRecords.delete(record.terminalId)
        }
    }

    private isLiveStatus(status: TerminalState['status']): boolean {
        return status === 'running' || status === 'detached' || status === 'warning_idle' || status === 'warning_age'
    }

    private statusForCloseReason(reason: TerminalCloseReason): TerminalState['status'] {
        switch (reason) {
            case 'user_close':
                return 'closed_user'
            case 'idle_timeout':
                return 'closed_idle'
            case 'hard_timeout':
                return 'closed_age'
            case 'archive':
                return 'closed_archive'
            case 'process_exit':
                return 'exited'
            case 'cli_lost':
            case 'spawn_error':
                return 'lost'
        }
    }

    private emitError(terminalId: string, message: string): void {
        this.onError({ ...this.scopePayload(), terminalId, message })
    }

    private clearDetachedTimer(runtime: TerminalRuntime): void {
        if (!runtime.detachedTimer) {
            return
        }
        clearTimeout(runtime.detachedTimer)
        runtime.detachedTimer = null
    }

    private requestMatchesScope(request: TerminalHistoryRequest): boolean {
        if ('sessionId' in request) {
            return request.sessionId === this.sessionId
        }
        return request.machineId === this.machineId
    }

    private cleanupHistoryCapability(capability: TerminalHistoryCapability): void {
        if (capability.status !== 'ready') {
            return
        }
        try {
            cleanupBashHistoryRuntime(capability.runtime)
        } catch {
            // Runtime history is best-effort and must not block terminal cleanup.
        }
    }

    private scopePayload(): { sessionId: string } | { machineId: string } {
        if (this.sessionId) {
            return { sessionId: this.sessionId }
        }
        if (this.machineId) {
            return { machineId: this.machineId }
        }
        throw new Error('TerminalManager scope is not configured')
    }

    private typedScopePayload(): { scopeType: 'session'; sessionId: string } | { scopeType: 'machine'; machineId: string } {
        if (this.sessionId) {
            return { scopeType: 'session', sessionId: this.sessionId }
        }
        if (this.machineId) {
            return { scopeType: 'machine', machineId: this.machineId }
        }
        throw new Error('TerminalManager scope is not configured')
    }
}
