import { expect, it } from 'bun:test'
import { registerCliHandlers } from './handlers/cli'

function createHarness(clientType: 'machine-scoped' | 'session-scoped') {
    const events: string[] = []
    const socket = {
        id: 'socket-1',
        data: { principalKind: 'runner', runnerClientType: clientType, namespace: 'o1', machineId: 'm1' },
        handshake: { auth: { machineId: 'm1', ...(clientType === 'session-scoped' ? { sessionId: 's1' } : {}) } },
        on: (name: string) => { events.push(name) },
        join: () => {},
        emit: () => {},
        to: () => ({ emit: () => {} })
    }
    const machine = { id: 'm1', namespace: 'o1' }
    const store = {
        machines: {
            getMachineByNamespace: (id: string, namespace: string) => id === 'm1' && namespace === 'o1' ? machine : null,
            getMachine: () => machine
        },
        sessions: {
            getSessionByNamespace: (id: string) => id === 's1' ? { id: 's1', namespace: 'o1' } : null,
            getSession: () => null
        }
    }
    const io = { of: () => ({}) }

        registerCliHandlers(socket as never, {
        io: io as never,
        store: store as never,
        rpcRegistry: {} as never,
            terminalRegistry: {} as never,
            resolveCapability: () => null
    })

    return events
}

it('registers machine events and RPC handlers for a machine-scoped Runner principal', () => {
    const events = createHarness('machine-scoped')

    expect(events).toContain('machine-alive')
    expect(events).not.toContain('session-alive')
    expect(events).toContain('rpc-register')
    expect(events.some((event) => event.startsWith('terminal:'))).toBe(false)
})

it('registers session events for a session-scoped Runner principal', () => {
    const events = createHarness('session-scoped')

    expect(events).toContain('session-alive')
    expect(events).toContain('rpc-register')
    expect(events).not.toContain('machine-alive')
})
