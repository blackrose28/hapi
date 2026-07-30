import { randomUUID } from 'node:crypto'

export type TerminalHistoryScope = { sessionId: string } | { machineId: string }

type ScheduleHandle = ReturnType<typeof setTimeout> | unknown

export type PendingTerminalHistoryRequest = {
    webSocketId: string
    webRequestId: string
    cliSocketId: string
    terminalId: string
    namespace: string
    scope: TerminalHistoryScope
}

type PendingRecord = PendingTerminalHistoryRequest & {
    expiresAt: number
    timer: ScheduleHandle
}

type TerminalHistoryRequestRegistryOptions = {
    ttlMs?: number
    now?: () => number
    schedule?: (callback: () => void, delayMs: number) => ScheduleHandle
    clearSchedule?: (handle: ScheduleHandle) => void
}

function scopesEqual(left: TerminalHistoryScope, right: TerminalHistoryScope): boolean {
    if ('sessionId' in left) {
        return 'sessionId' in right && left.sessionId === right.sessionId
    }
    return 'machineId' in right && left.machineId === right.machineId
}

export class TerminalHistoryRequestRegistry {
    private readonly ttlMs: number
    private readonly now: () => number
    private readonly schedule: (callback: () => void, delayMs: number) => ScheduleHandle
    private readonly clearSchedule: (handle: ScheduleHandle) => void
    private readonly pending = new Map<string, PendingRecord>()

    constructor(options: TerminalHistoryRequestRegistryOptions = {}) {
        this.ttlMs = options.ttlMs ?? 10_000
        this.now = options.now ?? Date.now
        this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
        this.clearSchedule = options.clearSchedule
            ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    }

    register(input: PendingTerminalHistoryRequest): string {
        const correlationId = randomUUID()
        const timer = this.schedule(() => {
            this.remove(correlationId)
        }, this.ttlMs)
        const maybeUnref = (timer as { unref?: () => void } | null)?.unref
        if (typeof maybeUnref === 'function') {
            maybeUnref.call(timer)
        }
        this.pending.set(correlationId, {
            ...input,
            expiresAt: this.now() + this.ttlMs,
            timer
        })
        return correlationId
    }

    consume(
        correlationId: string,
        identity: {
            cliSocketId: string
            terminalId: string
            namespace: string
            scope: TerminalHistoryScope
        }
    ): PendingTerminalHistoryRequest | null {
        const record = this.pending.get(correlationId)
        if (!record) {
            return null
        }
        if (record.expiresAt <= this.now()) {
            this.remove(correlationId)
            return null
        }
        if (
            record.cliSocketId !== identity.cliSocketId
            || record.terminalId !== identity.terminalId
            || record.namespace !== identity.namespace
            || !scopesEqual(record.scope, identity.scope)
        ) {
            return null
        }

        this.remove(correlationId)
        const { expiresAt: _expiresAt, timer: _timer, ...pending } = record
        return pending
    }

    remove(correlationId: string): void {
        const record = this.pending.get(correlationId)
        if (!record) {
            return
        }
        this.pending.delete(correlationId)
        this.clearSchedule(record.timer)
    }

    removeByWebSocket(webSocketId: string): void {
        this.removeWhere((record) => record.webSocketId === webSocketId)
    }

    removeByCliSocket(cliSocketId: string): void {
        this.removeWhere((record) => record.cliSocketId === cliSocketId)
    }

    has(correlationId: string): boolean {
        return this.pending.has(correlationId)
    }

    private removeWhere(predicate: (record: PendingRecord) => boolean): void {
        for (const [correlationId, record] of this.pending) {
            if (predicate(record)) {
                this.remove(correlationId)
            }
        }
    }
}
