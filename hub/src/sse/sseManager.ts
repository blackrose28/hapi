import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export type SSESubscription = {
    id: string
    namespace: string
    membershipId: string
    organizationRole?: 'admin' | 'member' | 'viewer'
    all: boolean
    sessionId: string | null
    machineId: string | null
}

export type SSEEventResource = {
    resourceType: 'session' | 'machine' | 'team-chat'
    resourceId: string
}

type SSEConnection = SSESubscription & {
    authorize: (resource: SSEEventResource) => boolean
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
    }

    subscribe(options: {
        id: string
        namespace: string
        membershipId: string
        organizationRole?: 'admin' | 'member' | 'viewer'
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        visibility?: VisibilityState
        authorize: (resource: SSEEventResource) => boolean
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            membershipId: options.membershipId,
            organizationRole: options.organizationRole,
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            authorize: options.authorize,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            membershipId: subscription.membershipId,
            all: subscription.all,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId
        }
    }

    unsubscribe(id: string): void {
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            if (!this.visibilityTracker.isVisibleConnection(connection.id)) {
                continue
            }
            if (!this.shouldSend(connection, { ...event, namespace })) {
                continue
            }

            deliveries.push(
                Promise.resolve(connection.send(event))
                    .then(() => ({ id: connection.id, ok: true }))
                    .catch(() => ({ id: connection.id, ok: false }))
            )
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                successCount += 1
                continue
            }
            this.unsubscribe(result.id)
        }

        return successCount
    }

    broadcast(event: SyncEvent): void {
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            try {
                void Promise.resolve(connection.send(event)).catch(() => {
                    this.unsubscribe(connection.id)
                })
            } catch {
                this.unsubscribe(connection.id)
            }
        }
    }

    /**
     * Disconnect all subscriptions for an organization. Used when a member is
     * disabled or access is revoked so affected SSE streams close immediately.
     */
    disconnectOrganization(organizationId: string): void {
        for (const [id, connection] of this.connections) {
            if (connection.namespace === organizationId) {
                this.unsubscribe(id)
            }
        }
    }

    disconnectMembership(organizationId: string, membershipId: string): void {
        for (const [id, connection] of this.connections) {
            if (connection.namespace === organizationId && connection.membershipId === membershipId) {
                this.unsubscribe(id)
            }
        }
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                    this.unsubscribe(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (event.type === 'heartbeat') {
            return true
        }

        if (event.type === 'shared-hub-updated') {
            return connection.all && connection.organizationRole === 'admin'
        }

        if (event.type === 'terminal-snippets-updated') {
            return true
        }

        const resource = this.resourceForEvent(event)
        if (!resource || !connection.authorize(resource)) {
            return false
        }

        if (event.type === 'message-received') {
            return connection.all || connection.sessionId === event.sessionId
        }

        if (event.type === 'tool-progress') {
            // Only a client actually watching this session can use per-tool liveness.
            // Dashboard ('all') subscribers would get a 30s drip per running tool
            // they never render.
            return connection.sessionId === event.sessionId
        }

        if (connection.all) {
            return true
        }

        if ('sessionId' in event && connection.sessionId === event.sessionId) {
            return true
        }

        if ('machineId' in event && connection.machineId === event.machineId) {
            return true
        }

        return false
    }

    private resourceForEvent(event: SyncEvent): SSEEventResource | null {
        if (event.type === 'toast') {
            return { resourceType: 'session', resourceId: event.data.sessionId }
        }
        if (event.type.startsWith('team-') && 'teamChatId' in event && typeof event.teamChatId === 'string') {
            return { resourceType: 'team-chat', resourceId: event.teamChatId }
        }
        if ('sessionId' in event && typeof event.sessionId === 'string') {
            return { resourceType: 'session', resourceId: event.sessionId }
        }
        if ('machineId' in event && typeof event.machineId === 'string') {
            return { resourceType: 'machine', resourceId: event.machineId }
        }
        return null
    }
}
