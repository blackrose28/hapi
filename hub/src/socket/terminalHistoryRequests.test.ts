import { describe, expect, it } from 'bun:test'
import { TerminalHistoryRequestRegistry } from './terminalHistoryRequests'

describe('TerminalHistoryRequestRegistry', () => {
    it('consumes a matching request once and restores the web request id', () => {
        const registry = new TerminalHistoryRequestRegistry({
            now: () => 1_000,
            schedule: () => ({ id: 1 }),
            clearSchedule: () => {}
        })
        const correlationId = registry.register({
            webSocketId: 'web-1',
            webRequestId: 'web-request-1',
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })
        const identity = {
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' } as const
        }

        expect(registry.consume(correlationId, identity)).toMatchObject({
            webSocketId: 'web-1',
            webRequestId: 'web-request-1'
        })
        expect(registry.consume(correlationId, identity)).toBeNull()
    })

    it('does not consume a forged CLI, terminal, namespace, or scope', () => {
        const registry = new TerminalHistoryRequestRegistry({
            now: () => 1_000,
            schedule: () => ({ id: 1 }),
            clearSchedule: () => {}
        })
        const register = () => registry.register({
            webSocketId: 'web-1',
            webRequestId: 'web-request-1',
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { machineId: 'machine-1' }
        })

        expect(registry.consume(register(), {
            cliSocketId: 'cli-2',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { machineId: 'machine-1' }
        })).toBeNull()
        expect(registry.consume(register(), {
            cliSocketId: 'cli-1',
            terminalId: 'terminal-2',
            namespace: 'default',
            scope: { machineId: 'machine-1' }
        })).toBeNull()
        expect(registry.consume(register(), {
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'other',
            scope: { machineId: 'machine-1' }
        })).toBeNull()
        expect(registry.consume(register(), {
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })).toBeNull()
    })

    it('expires requests after ten seconds and clears requests on disconnect', () => {
        let now = 1_000
        const scheduled: Array<() => void> = []
        const registry = new TerminalHistoryRequestRegistry({
            now: () => now,
            schedule: (callback) => {
                scheduled.push(callback)
                return { id: scheduled.length }
            },
            clearSchedule: () => {}
        })
        const expiredId = registry.register({
            webSocketId: 'web-1',
            webRequestId: 'request-1',
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })
        now = 11_001

        expect(registry.consume(expiredId, {
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })).toBeNull()

        const webId = registry.register({
            webSocketId: 'web-1',
            webRequestId: 'request-2',
            cliSocketId: 'cli-1',
            terminalId: 'terminal-1',
            namespace: 'default',
            scope: { sessionId: 'session-1' }
        })
        const cliId = registry.register({
            webSocketId: 'web-2',
            webRequestId: 'request-3',
            cliSocketId: 'cli-1',
            terminalId: 'terminal-2',
            namespace: 'default',
            scope: { sessionId: 'session-2' }
        })

        registry.removeByWebSocket('web-1')
        expect(registry.has(webId)).toBe(false)
        registry.removeByCliSocket('cli-1')
        expect(registry.has(cliId)).toBe(false)
    })
})
