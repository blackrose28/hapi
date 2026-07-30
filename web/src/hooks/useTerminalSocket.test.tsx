import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalState } from '@hapi/protocol'
import { SessionTerminalTabs } from '@/components/Terminal/SessionTerminalTabs'
import { useSessionTerminalSocket, useTerminalSocket } from './useTerminalSocket'

type Handler = (payload?: unknown) => void

type MockSocket = {
    connected: boolean
    auth: unknown
    handlers: Map<string, Handler[]>
    emits: Array<{ event: string; payload: unknown }>
    on: (event: string, handler: Handler) => MockSocket
    emit: (event: string, payload: unknown) => void
    connect: () => void
    disconnect: () => void
    removeAllListeners: () => void
    trigger: (event: string, payload?: unknown) => void
}

const socketMocks = vi.hoisted(() => ({
    sockets: [] as MockSocket[]
}))

function makeSocket(): MockSocket {
    const socket: MockSocket = {
        connected: false,
        auth: null,
        handlers: new Map(),
        emits: [],
        on(event, handler) {
            const handlers = this.handlers.get(event) ?? []
            handlers.push(handler)
            this.handlers.set(event, handlers)
            return this
        },
        emit(event, payload) {
            this.emits.push({ event, payload })
        },
        connect() {
            this.connected = true
        },
        disconnect() {
            this.connected = false
        },
        removeAllListeners() {
            this.handlers.clear()
        },
        trigger(event, payload) {
            for (const handler of this.handlers.get(event) ?? []) {
                handler(payload)
            }
        }
    }
    return socket
}

vi.mock('socket.io-client', () => ({
    Manager: vi.fn(function MockManager() {
        return {
            socket: vi.fn(() => {
                const socket = makeSocket()
                socketMocks.sockets.push(socket)
                return socket
            })
        }
    })
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ token: 'token-1', baseUrl: 'http://hub.local', api: null })
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="terminal-view" />
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'terminal.lifecycle.hint': 'Closing this window only detaches. Terminals live with the session and stop only when you close them, archive the session, or timeout limits apply.',
            'terminal.limit.full': 'Close an existing terminal before creating another.',
            'terminal.new': 'New terminal',
            'terminal.close.confirmTitle': 'Stop terminal process?',
            'terminal.close.confirmDescription': 'Stop process and close this terminal tab?',
            'terminal.close.confirmAction': 'Stop process and close',
            'terminal.keep': 'Keep terminal',
            'terminal.warning.idle': 'Terminal is idle and will stop soon unless activity resumes.',
            'terminal.warning.age': 'Terminal is near its maximum lifetime hard limit and will stop soon.',
            'terminal.warning.badge.idle': 'Idle warning',
            'terminal.warning.badge.age': 'Age warning',
            'terminal.closed.idle': 'Closed after idle timeout.',
            'terminal.closed.age': 'Closed after hard timeout.',
            'terminal.closed.user': 'Closed by user.',
            'terminal.closed.archive': 'Closed because session was archived.',
            'terminal.closed.exited': 'Process exited.',
            'terminal.closed.lost': 'CLI connection was lost.',
            'terminal.recovery.cliLost': 'CLI restarted or disconnected. Previous terminals may be lost.',
            'terminal.closed.spawn': 'CLI could not spawn this terminal.',
            'terminal.closed.generic': 'Terminal is closed.',
            'terminal.createNew': 'Create new terminal',
            'terminal.unsupported': 'Remote terminal is not supported on this host.',
            'terminal.inactive': 'Session is inactive. Terminal is unavailable.',
            'button.cancel': 'Cancel',
            'button.paste': 'Paste',
            'terminal.paste.fallbackTitle': 'Paste input',
            'terminal.paste.fallbackDescription': 'Clipboard read is unavailable. Paste your text below.',
            'terminal.paste.placeholder': 'Paste terminal input here…'
        }[key] ?? key)
    })
}))

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: ({ onClick }: { onClick: () => void }) => ({ onClick })
}))

function state(id: string, status: TerminalState['status'] = 'running', closeReason: TerminalState['closeReason'] = null): TerminalState {
    return {
        scopeType: 'session',
        sessionId: 'session-1',
        terminalId: id,
        label: id,
        cwd: '/repo',
        cols: 80,
        rows: 24,
        status,
        closeReason,
        createdAt: 1,
        lastActivityAt: 1,
        idleWarningAt: null,
        hardExpiresAt: 2
    }
}

function listPayload(terminals: TerminalState[], sessionId = 'session-1', recovery?: { reason: 'cli_lost'; at: number }) {
    return { scopeType: 'session' as const, sessionId, terminals, ...(recovery ? { recovery } : {}) }
}

function warningPayload(reason: 'idle' | 'age', sessionId = 'session-1', message = 'ignored raw message') {
    return {
        scopeType: 'session' as const,
        sessionId,
        terminalId: 't1',
        reason,
        message,
        closesAt: 9
    }
}

function renderSessionHook() {
    const rendered = renderHook(() => useSessionTerminalSocket({
        baseUrl: 'http://hub.local',
        sessionId: 'session-1'
    }))
    act(() => rendered.result.current.connect())
    const socket = socketMocks.sockets.at(-1)
    if (!socket) throw new Error('socket not created')
    act(() => socket.trigger('connect'))
    return { ...rendered, socket }
}

describe('useSessionTerminalSocket warning merge', () => {
    beforeEach(() => {
        socketMocks.sockets.length = 0
        vi.clearAllMocks()
    })

    afterEach(() => cleanup())

    it('updates terminal to idle warning from warning event without list refresh', () => {
        const { result, socket } = renderSessionHook()
        act(() => socket.trigger('terminal:list', listPayload([state('t1')])) )

        act(() => socket.trigger('terminal:warning', warningPayload('idle')))

        expect(result.current.terminals[0]?.status).toBe('warning_idle')
        expect(result.current.terminals[0]?.idleWarningAt).toEqual(expect.any(Number))
    })

    it('updates terminal to age warning from warning event', () => {
        const { result, socket } = renderSessionHook()
        act(() => socket.trigger('terminal:list', listPayload([state('t1')])) )

        act(() => socket.trigger('terminal:warning', warningPayload('age')))

        expect(result.current.terminals[0]?.status).toBe('warning_age')
    })

    it('ignores warning event for another session', () => {
        const { result, socket } = renderSessionHook()
        act(() => socket.trigger('terminal:list', listPayload([state('t1')])) )

        act(() => socket.trigger('terminal:warning', warningPayload('idle', 'other-session')))

        expect(result.current.terminals[0]?.status).toBe('running')
    })

    it.each([
        ['closed_idle', 'idle_timeout'],
        ['lost', 'cli_lost'],
        ['exited', 'process_exit']
    ] as Array<[TerminalState['status'], TerminalState['closeReason']]>)('does not revive stale %s terminal from warning event', (status, closeReason) => {
        const { result, socket } = renderSessionHook()
        act(() => socket.trigger('terminal:list', listPayload([state('t1', status, closeReason)])) )

        act(() => socket.trigger('terminal:warning', warningPayload('idle')))

        expect(result.current.terminals[0]?.status).toBe(status)
        expect(result.current.terminals[0]?.closeReason).toBe(closeReason)
    })

    it('keepalive emits keepalive and list only, never terminal write', () => {
        const { result, socket } = renderSessionHook()

        act(() => result.current.keepalive('t1'))

        expect(socket.emits).toContainEqual({
            event: 'terminal:keepalive',
            payload: { scopeType: 'session', sessionId: 'session-1', terminalId: 't1' }
        })
        expect(socket.emits).toContainEqual({
            event: 'terminal:list',
            payload: { scopeType: 'session', sessionId: 'session-1' }
        })
        expect(socket.emits.map((emit) => emit.event)).not.toContain('terminal:write')
    })

    it('rejects a session write when the socket disconnects after the UI became enabled', () => {
        const { result, socket } = renderSessionHook()

        socket.connected = false
        let accepted: boolean | undefined
        act(() => {
            accepted = result.current.write('t1', 'pwd')
        })

        expect(accepted).toBe(false)
        expect(socket.emits).not.toContainEqual({
            event: 'terminal:write',
            payload: { terminalId: 't1', data: 'pwd' }
        })
    })

    it('returns true only when a session write is emitted', () => {
        const { result, socket } = renderSessionHook()

        let accepted: boolean | undefined
        act(() => {
            accepted = result.current.write('t1', 'pwd')
        })

        expect(accepted).toBe(true)
        expect(socket.emits).toContainEqual({
            event: 'terminal:write',
            payload: { terminalId: 't1', data: 'pwd' }
        })
    })

    it('requests session terminal history and delivers only matching session results', () => {
        const { result, socket } = renderSessionHook()
        const received: unknown[] = []
        act(() => result.current.onHistory((payload) => received.push(payload)))

        let accepted: boolean | undefined
        act(() => {
            accepted = result.current.requestHistory('t1', 'request-1', 100)
        })

        expect(accepted).toBe(true)
        expect(socket.emits).toContainEqual({
            event: 'terminal:history',
            payload: { terminalId: 't1', requestId: 'request-1', limit: 100 }
        })

        act(() => socket.trigger('terminal:history-result', {
            sessionId: 'other-session',
            terminalId: 't1',
            requestId: 'request-1',
            status: 'ok',
            entries: []
        }))
        act(() => socket.trigger('terminal:history-result', {
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: 'request-1',
            status: 'ok',
            entries: [{ index: 1, command: 'pwd' }]
        }))

        expect(received).toEqual([{
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: 'request-1',
            status: 'ok',
            entries: [{ index: 1, command: 'pwd' }]
        }])
    })

    it('stores recovery reason from terminal list payload', () => {
        const { result, socket } = renderSessionHook()

        act(() => socket.trigger('terminal:list', listPayload([], 'session-1', { reason: 'cli_lost', at: 123 })))

        expect(result.current.recoveryReason).toBe('cli_lost')
        expect(result.current.terminals).toEqual([])
    })

    it('clears stale terminals and marks list unloaded when session id changes', () => {
        const rendered = renderHook(({ sessionId }) => useSessionTerminalSocket({
            baseUrl: 'http://hub.local',
            sessionId
        }), { initialProps: { sessionId: 'session-a' } })
        act(() => rendered.result.current.connect())
        const socketA = socketMocks.sockets.at(-1)
        if (!socketA) throw new Error('socket A not created')
        act(() => socketA.trigger('connect'))
        act(() => socketA.trigger('terminal:list', listPayload([state('a1')], 'session-a', { reason: 'cli_lost', at: 123 })))

        expect(rendered.result.current.terminals.map((terminal) => terminal.terminalId)).toEqual(['a1'])
        expect(rendered.result.current.recoveryReason).toBe('cli_lost')
        expect(rendered.result.current.listLoaded).toBe(true)

        rendered.rerender({ sessionId: 'session-b' })

        expect(rendered.result.current.terminals).toEqual([])
        expect(rendered.result.current.recoveryReason).toBeNull()
        expect(rendered.result.current.listLoaded).toBe(false)
    })

    it('does not render raw warning payload message in SessionTerminalTabs', () => {
        render(<SessionTerminalTabs sessionId="session-1" active terminalSupported />)
        const socket = socketMocks.sockets.at(-1)
        if (!socket) throw new Error('socket not created')

        act(() => socket.trigger('connect'))
        act(() => socket.trigger('terminal:list', listPayload([state('t1')])) )
        act(() => socket.trigger('terminal:warning', warningPayload('idle', 'session-1', 'token=SECRET')))

        expect(screen.getByRole('status')).toHaveTextContent('Terminal is idle')
        expect(screen.queryByText(/token=SECRET/)).not.toBeInTheDocument()
        expect(document.body.textContent).not.toContain('SECRET')
    })

    it('keeps snippets open with an error and no success when the session socket drops before insert', () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false }
            }
        })
        render(
            <QueryClientProvider client={queryClient}>
                <SessionTerminalTabs sessionId="session-1" active terminalSupported />
            </QueryClientProvider>
        )
        const socket = socketMocks.sockets.at(-1)
        if (!socket) throw new Error('socket not created')

        act(() => socket.trigger('connect'))
        act(() => socket.trigger('terminal:list', listPayload([state('t1')])) )
        fireEvent.click(screen.getByRole('button', { name: 'terminal.controls.snippets' }))
        expect(screen.getByRole('region', { name: 'terminal.snippets.title' })).toBeVisible()

        socket.connected = false
        fireEvent.click(screen.getByRole('button', {
            name: 'terminal.snippets.insert terminal.snippets.builtin.pwd.name'
        }))

        expect(screen.getByRole('region', { name: 'terminal.snippets.title' })).toBeVisible()
        expect(screen.getByRole('status')).toHaveTextContent('terminal.snippets.insertFailed')
        expect(screen.queryByText('terminal.snippets.inserted')).not.toBeInTheDocument()
        expect(socket.emits).not.toContainEqual({
            event: 'terminal:write',
            payload: { terminalId: 't1', data: 'pwd' }
        })
    })
})

describe('useTerminalSocket writes', () => {
    beforeEach(() => {
        socketMocks.sockets.length = 0
        vi.clearAllMocks()
    })

    afterEach(() => cleanup())

    function renderMachineHook() {
        const rendered = renderHook(() => useTerminalSocket({
            baseUrl: 'http://hub.local',
            machineId: 'machine-1',
            terminalId: 'terminal-1'
        }))
        act(() => rendered.result.current.connect(80, 24))
        const socket = socketMocks.sockets.at(-1)
        if (!socket) throw new Error('socket not created')
        act(() => socket.trigger('connect'))
        act(() => socket.trigger('terminal:ready', { terminalId: 'terminal-1' }))
        return { ...rendered, socket }
    }

    it('rejects a machine write when the socket disconnects after the UI became enabled', () => {
        const { result, socket } = renderMachineHook()

        socket.connected = false
        let accepted: boolean | undefined
        act(() => {
            accepted = result.current.write('pwd')
        })

        expect(accepted).toBe(false)
        expect(socket.emits).not.toContainEqual({
            event: 'terminal:write',
            payload: { terminalId: 'terminal-1', data: 'pwd' }
        })
    })

    it('returns true only when a machine write is emitted', () => {
        const { result, socket } = renderMachineHook()

        let accepted: boolean | undefined
        act(() => {
            accepted = result.current.write('pwd')
        })

        expect(accepted).toBe(true)
        expect(socket.emits).toContainEqual({
            event: 'terminal:write',
            payload: { terminalId: 'terminal-1', data: 'pwd' }
        })
    })

    it('requests machine terminal history and rejects requests after disconnect', () => {
        const { result, socket } = renderMachineHook()
        const received: unknown[] = []
        act(() => result.current.onHistory((payload) => received.push(payload)))

        expect(result.current.requestHistory('request-1', 50)).toBe(true)
        expect(socket.emits).toContainEqual({
            event: 'terminal:history',
            payload: { terminalId: 'terminal-1', requestId: 'request-1', limit: 50 }
        })

        act(() => socket.trigger('terminal:history-result', {
            machineId: 'machine-1',
            terminalId: 'terminal-1',
            requestId: 'request-1',
            status: 'ok',
            entries: [{ index: 2, command: 'ls' }]
        }))
        expect(received).toHaveLength(1)

        socket.connected = false
        expect(result.current.requestHistory('request-2')).toBe(false)
    })
})
