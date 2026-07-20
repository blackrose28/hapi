import type { Session, SyncEvent } from '../sync/syncEngine'
import type { StoredSession } from '../store/types'
import { SharedHubStore } from '../store/sharedHubStore'

type LegacySessionSource = Pick<{ getSessions(): StoredSession[] }, 'getSessions'>

type SessionEventSource = {
    getSession(sessionId: string): Session | undefined
    subscribe(listener: (event: SyncEvent) => void): () => void
}

type BufferedOperation = {
    sequence: number
    timestamp: number
    sessionId: string
    machineId: string | null
}

export class SessionSecurityProjection {
    private unsubscribe: (() => void) | null = null
    private reconciling = false
    private running = false
    private arrivalSequence = 0
    private causalTimestamp = 0
    private buffered: BufferedOperation[] = []

    constructor(
        private readonly store: SharedHubStore,
        private readonly organizationId: string,
        private readonly legacy: LegacySessionSource,
        private readonly events: SessionEventSource,
        private readonly now: () => number = Date.now
    ) {}

    start(): void {
        if (this.running) return
        this.running = true
        this.reconciling = true
        this.unsubscribe = this.events.subscribe((event) => this.handleEvent(event))

        try {
            const reconciledAt = this.now()
            const sessions = this.legacy.getSessions().flatMap((session) => session.machineId
                ? [{ sessionId: session.id, machineId: session.machineId, updatedAt: reconciledAt }]
                : [])
            this.store.reconcileSessionProjections(this.organizationId, sessions, reconciledAt)
            this.causalTimestamp = Math.max(reconciledAt, ...sessions.map((session) => session.updatedAt))
            this.reconciling = false
            const replay = this.buffered.splice(0).sort((left, right) =>
                left.timestamp - right.timestamp || left.sequence - right.sequence)
            for (const operation of replay) this.applyCausally(operation)
        } catch (error) {
            this.stop()
            throw error
        }
    }

    stop(): void {
        if (!this.running) return
        this.running = false
        this.reconciling = false
        this.buffered = []
        this.unsubscribe?.()
        this.unsubscribe = null
    }

    private handleEvent(event: SyncEvent): void {
        if (!this.running || !isSessionProjectionEvent(event)) return
        const sequence = this.arrivalSequence++
        const session = event.type === 'session-removed' ? undefined : this.events.getSession(event.sessionId)
        if (event.type !== 'session-removed' && !session) return
        const operation: BufferedOperation = {
            sequence,
            timestamp: session?.updatedAt ?? this.now(),
            sessionId: event.sessionId,
            machineId: session?.metadata?.machineId ?? null
        }
        if (this.reconciling) {
            this.buffered.push(operation)
            return
        }
        this.applyCausally(operation)
    }

    private applyCausally(operation: BufferedOperation): void {
        const timestamp = Math.max(operation.timestamp, this.now(), this.causalTimestamp + 1)
        this.causalTimestamp = timestamp
        this.apply({ ...operation, timestamp })
    }

    private apply(operation: BufferedOperation): void {
        if (!this.running) return
        if (operation.machineId) {
            this.store.upsertSessionProjectionByMachine({
                sessionId: operation.sessionId,
                organizationId: this.organizationId,
                machineId: operation.machineId,
                updatedAt: operation.timestamp
            })
            return
        }
        this.store.retireSessionProjection(this.organizationId, operation.sessionId, operation.timestamp)
    }
}

function isSessionProjectionEvent(event: SyncEvent): event is Extract<SyncEvent, {
    type: 'session-added' | 'session-updated' | 'session-removed'
}> {
    return event.type === 'session-added' || event.type === 'session-updated' || event.type === 'session-removed'
}
