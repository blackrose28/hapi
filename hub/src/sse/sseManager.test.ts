import { describe, expect, it } from 'bun:test'
import { SSEManager } from './sseManager'
import type { SyncEvent } from '../sync/syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

describe('SSEManager namespace filtering', () => {
    it('routes events to matching namespace', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const receivedAlpha: SyncEvent[] = []
        const receivedBeta: SyncEvent[] = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            membershipId: 'member-alpha',
            all: true,
            authorize: () => true,
            send: (event) => {
                receivedAlpha.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            membershipId: 'member-beta',
            all: true,
            authorize: () => true,
            send: (event) => {
                receivedBeta.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })

        expect(receivedAlpha).toHaveLength(1)
        expect(receivedBeta).toHaveLength(0)
    })

    it('broadcasts connection-changed to all namespaces', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            membershipId: 'member-alpha',
            all: true,
            authorize: () => true,
            send: (event) => {
                received.push({ id: 'alpha', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            membershipId: 'member-beta',
            all: true,
            authorize: () => true,
            send: (event) => {
                received.push({ id: 'beta', event })
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'connection-changed', data: { status: 'connected' } })

        expect(received).toHaveLength(2)
        expect(received.map((entry) => entry.id).sort()).toEqual(['alpha', 'beta'])
    })

    it('sends toast only to visible connections in a namespace', async () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'visible',
            namespace: 'alpha',
            membershipId: 'member-alpha',
            all: true,
            visibility: 'visible',
            authorize: () => true,
            send: (event) => {
                received.push({ id: 'visible', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'hidden',
            namespace: 'alpha',
            membershipId: 'member-alpha',
            all: true,
            visibility: 'hidden',
            authorize: () => true,
            send: (event) => {
                received.push({ id: 'hidden', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'other',
            namespace: 'beta',
            membershipId: 'member-beta',
            all: true,
            visibility: 'visible',
            authorize: () => true,
            send: (event) => {
                received.push({ id: 'other', event })
            },
            sendHeartbeat: () => {}
        })

        const toastEvent: Extract<SyncEvent, { type: 'toast' }> = {
            type: 'toast',
            data: {
                title: 'Test',
                body: 'Toast body',
                sessionId: 'session-1',
                url: '/sessions/session-1'
            }
        }

        const delivered = await manager.sendToast('alpha', toastEvent)

        expect(delivered).toBe(1)
        expect(received).toHaveLength(1)
        expect(received[0]?.id).toBe('visible')
    })

    it('disconnects only the affected membership', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        for (const [id, membershipId] of [['affected', 'member-a'], ['unrelated', 'member-b']] as const) {
            manager.subscribe({
                id,
                namespace: 'org-1',
                membershipId,
                all: true,
                authorize: () => true,
                send: () => {},
                sendHeartbeat: () => {}
            })
        }

        manager.disconnectMembership('org-1', 'member-a')

        expect(manager['connections'].has('affected')).toBe(false)
        expect(manager['connections'].has('unrelated')).toBe(true)
    })

    it('projects all dynamically and rechecks Team Chat authorization', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []
        const allowed = new Set(['session:granted', 'machine:machine-granted', 'team-chat:team-1'])

        manager.subscribe({
            id: 'dynamic',
            namespace: 'org-1',
            membershipId: 'member-1',
            all: true,
            authorize: ({ resourceType, resourceId }) => allowed.has(`${resourceType}:${resourceId}`),
            send: (event) => { received.push(event) },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', namespace: 'org-1', sessionId: 'granted' })
        manager.broadcast({ type: 'session-updated', namespace: 'org-1', sessionId: 'denied' })
        manager.broadcast({ type: 'machine-updated', namespace: 'org-1', machineId: 'machine-granted' })
        manager.broadcast({ type: 'team-chat-updated', namespace: 'org-1', teamChatId: 'team-1' })
        allowed.delete('team-chat:team-1')
        manager.broadcast({ type: 'team-message-created', namespace: 'org-1', teamChatId: 'team-1', messageId: 'secret' })
        allowed.delete('session:granted')
        manager.broadcast({ type: 'messages-invalidated', namespace: 'org-1', sessionId: 'granted' })

        expect(received.map((event) => event.type)).toEqual(['session-updated', 'machine-updated', 'team-chat-updated'])
    })

    it('authorizes nested toast session ids before visible delivery', async () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []
        manager.subscribe({
            id: 'toast',
            namespace: 'org-1',
            membershipId: 'member-1',
            all: true,
            visibility: 'visible',
            authorize: ({ resourceId }) => resourceId === 'allowed-session',
            send: (event) => { received.push(event) },
            sendHeartbeat: () => {}
        })

        const delivered = await manager.sendToast('org-1', {
            type: 'toast',
            data: { title: 'Denied', body: 'secret', sessionId: 'denied-session', url: '/sessions/denied-session' }
        })

        expect(delivered).toBe(0)
        expect(received).toEqual([])
    })

    it('rechecks message authorization before all-subscription delivery', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []
        manager.subscribe({
            id: 'messages', namespace: 'org-1', membershipId: 'member-1', all: true,
            authorize: () => false,
            send: (event) => { received.push(event) },
            sendHeartbeat: () => {}
        })

        manager.broadcast({
            type: 'message-received', namespace: 'org-1', sessionId: 'session-1',
            message: { id: 'm1', seq: 1, localId: null, content: { role: 'user', content: { type: 'text', text: 'secret' } }, createdAt: 1 }
        })

        expect(received).toEqual([])
    })

    it('delivers Shared Hub lifecycle invalidations only to all-scope admins in the organization', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: string[] = []
        for (const input of [
            { id: 'admin', namespace: 'org-1', organizationRole: 'admin' as const, all: true },
            { id: 'member', namespace: 'org-1', organizationRole: 'member' as const, all: true },
            { id: 'scoped-admin', namespace: 'org-1', organizationRole: 'admin' as const, all: false },
            { id: 'other-admin', namespace: 'org-2', organizationRole: 'admin' as const, all: true }
        ]) {
            manager.subscribe({
                ...input,
                membershipId: input.id,
                authorize: () => true,
                send: () => { received.push(input.id) },
                sendHeartbeat: () => {}
            })
        }

        manager.broadcast({
            type: 'shared-hub-updated', namespace: 'org-1', eventId: 'event-1',
            name: 'member.role_changed', resourceType: 'membership', resourceId: 'member-1'
        })

        expect(received).toEqual(['admin'])
    })

    it('delivers tool-progress only to subscribers watching that session', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: string[] = []
        for (const input of [
            { id: 'watching', all: false, sessionId: 's1' },
            { id: 'other-session', all: false, sessionId: 's2' },
            { id: 'dashboard', all: true, sessionId: null }
        ]) {
            manager.subscribe({
                ...input,
                namespace: 'org-1',
                membershipId: input.id,
                authorize: () => true,
                send: () => { received.push(input.id) },
                sendHeartbeat: () => {}
            })
        }

        manager.broadcast({
            type: 'tool-progress',
            namespace: 'org-1',
            sessionId: 's1',
            toolUseId: 'toolu_1',
            parentToolUseId: null,
            toolName: 'Bash',
            elapsedSeconds: 30
        })

        expect(received).toEqual(['watching'])
    })

    it('does not deliver tool-progress when the session is not authorized', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: string[] = []

        manager.subscribe({
            id: 'watching',
            namespace: 'org-1',
            membershipId: 'watching',
            all: false,
            sessionId: 's1',
            authorize: () => false,
            send: () => { received.push('watching') },
            sendHeartbeat: () => {}
        })

        manager.broadcast({
            type: 'tool-progress',
            namespace: 'org-1',
            sessionId: 's1',
            toolUseId: 'toolu_1',
            parentToolUseId: null
        })

        expect(received).toEqual([])
    })
})
