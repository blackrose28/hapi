import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import type { Store } from '../../../store'
import type { CliSocketWithData } from '../../socketTypes'
import { registerSessionHandlers } from './sessionHandlers'

type AccessError = { scope: string; id: string; reason?: string }

class FakeSocket {
    private readonly handlers = new Map<string, (...args: unknown[]) => void>()

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    emit(): boolean {
        return true
    }

    to(): { emit: () => boolean } {
        return { emit: () => true }
    }

    trigger(event: string, data?: unknown): void {
        const handler = this.handlers.get(event)
        if (!handler) throw new Error(`no handler registered for ${event}`)
        handler(data)
    }
}

function setup(options: { access?: boolean } = {}) {
    const socket = new FakeSocket()
    const events: SyncEvent[] = []
    const accessErrors: AccessError[] = []

    registerSessionHandlers(socket as unknown as CliSocketWithData, {
        store: {} as Store,
        resolveSessionAccess: () => (options.access === false
            ? { ok: false, reason: 'forbidden' }
            : { ok: true, session: { id: 's1', namespace: 'org-1' } }) as never,
        emitAccessError: (scope, id, reason) => {
            accessErrors.push({ scope, id, reason })
        },
        onWebappEvent: (event) => {
            events.push(event)
        }
    })

    return { socket, events, accessErrors }
}

describe('session handlers: tool-progress relay', () => {
    it('relays a heartbeat as an ephemeral session-scoped event', () => {
        const { socket, events } = setup()

        socket.trigger('tool-progress', {
            sid: 's1',
            toolUseId: 'toolu_1',
            parentToolUseId: 'toolu_parent',
            toolName: 'Bash',
            elapsedSeconds: 30
        })

        expect(events).toEqual([{
            type: 'tool-progress',
            sessionId: 's1',
            toolUseId: 'toolu_1',
            parentToolUseId: 'toolu_parent',
            toolName: 'Bash',
            elapsedSeconds: 30
        }])
    })

    it('normalizes a missing parent to null and omits absent optional fields', () => {
        const { socket, events } = setup()

        socket.trigger('tool-progress', { sid: 's1', toolUseId: 'toolu_1' })

        expect(events).toEqual([{
            type: 'tool-progress',
            sessionId: 's1',
            toolUseId: 'toolu_1',
            parentToolUseId: null
        }])
    })

    it('drops malformed payloads without emitting an access error', () => {
        const { socket, events, accessErrors } = setup()

        socket.trigger('tool-progress', { sid: 's1' })
        socket.trigger('tool-progress', { sid: 's1', toolUseId: '' })
        socket.trigger('tool-progress', { toolUseId: 'toolu_1' })
        socket.trigger('tool-progress', { sid: 's1', toolUseId: 'toolu_1', elapsedSeconds: -1 })
        socket.trigger('tool-progress', null)

        expect(events).toEqual([])
        expect(accessErrors).toEqual([])
    })

    it('rejects a session the CLI has no access to', () => {
        const { socket, events, accessErrors } = setup({ access: false })

        socket.trigger('tool-progress', { sid: 's1', toolUseId: 'toolu_1' })

        expect(events).toEqual([])
        expect(accessErrors).toEqual([{ scope: 'session', id: 's1', reason: 'forbidden' }])
    })
})
