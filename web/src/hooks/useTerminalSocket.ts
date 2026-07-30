import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Manager, type Socket } from 'socket.io-client'
import type {
    TerminalHistoryResult,
    TerminalListPayload,
    TerminalState,
    TerminalWarningPayload
} from '@hapi/protocol'

export type TerminalConnectionState =
    | { status: 'idle' }
    | { status: 'connecting' }
    | { status: 'connected' }
    | { status: 'error'; error: string }

type UseTerminalSocketOptions = {
    baseUrl: string
    sessionId?: string
    machineId?: string
    cwd?: string
    terminalId: string
}

type TerminalReadyPayload = {
    terminalId: string
}

type TerminalOutputPayload = {
    terminalId: string
    data: string
}

type TerminalExitPayload = {
    terminalId: string
    code: number | null
    signal: string | null
}

type TerminalErrorPayload = {
    terminalId: string
    message: string
}

export function useTerminalSocket(options: UseTerminalSocketOptions): {
    state: TerminalConnectionState
    connect: (cols: number, rows: number) => void
    write: (data: string) => boolean
    resize: (cols: number, rows: number) => void
    disconnect: () => void
    close: () => void
    onOutput: (handler: (data: string) => void) => void
    onExit: (handler: (code: number | null, signal: string | null) => void) => void
    requestHistory: (requestId: string, limit?: number) => boolean
    onHistory: (handler: (result: TerminalHistoryResult) => void) => void
} {
    const [state, setState] = useState<TerminalConnectionState>({ status: 'idle' })
    const socketRef = useRef<Socket | null>(null)
    const outputHandlerRef = useRef<(data: string) => void>(() => {})
    const exitHandlerRef = useRef<(code: number | null, signal: string | null) => void>(() => {})
    const historyHandlerRef = useRef<(result: TerminalHistoryResult) => void>(() => {})
    const sessionIdRef = useRef(options.sessionId)
    const machineIdRef = useRef(options.machineId)
    const cwdRef = useRef(options.cwd)
    const terminalIdRef = useRef(options.terminalId)
    const baseUrlRef = useRef(options.baseUrl)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const replayOnNextCreateRef = useRef(true)

    useEffect(() => {
        sessionIdRef.current = options.sessionId
        machineIdRef.current = options.machineId
        cwdRef.current = options.cwd
        terminalIdRef.current = options.terminalId
        baseUrlRef.current = options.baseUrl
    }, [options.sessionId, options.machineId, options.cwd, options.terminalId, options.baseUrl])

    const isCurrentTerminal = useCallback((terminalId: string) => terminalId === terminalIdRef.current, [])

    const emitCreate = useCallback((socket: Socket, size: { cols: number; rows: number }) => {
        socket.emit('terminal:create', {
            ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : { machineId: machineIdRef.current }),
            terminalId: terminalIdRef.current,
            cols: size.cols,
            rows: size.rows,
            replay: replayOnNextCreateRef.current,
            ...(cwdRef.current ? { cwd: cwdRef.current } : {})
        })
    }, [])

    const setErrorState = useCallback((message: string) => {
        setState({ status: 'error', error: message })
    }, [])

    const connect = useCallback((cols: number, rows: number) => {
        lastSizeRef.current = { cols, rows }
        const sessionId = sessionIdRef.current
        const machineId = machineIdRef.current
        const terminalId = terminalIdRef.current

        if (!terminalId || (!sessionId && !machineId)) {
            setErrorState('Missing terminal credentials.')
            return
        }

        if (socketRef.current) {
            const socket = socketRef.current
            if (socket.connected) {
                emitCreate(socket, { cols, rows })
            } else {
                socket.connect()
            }
            setState({ status: 'connecting' })
            return
        }

        const manager = new Manager(baseUrlRef.current, {
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['polling', 'websocket'],
            autoConnect: false,
            withCredentials: true
        })
        const socket = manager.socket('/terminal')

        socketRef.current = socket
        setState({ status: 'connecting' })

        socket.on('connect', () => {
            const size = lastSizeRef.current ?? { cols, rows }
            setState({ status: 'connecting' })
            emitCreate(socket, size)
        })

        socket.on('terminal:ready', (payload: TerminalReadyPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            replayOnNextCreateRef.current = false
            setState({ status: 'connected' })
        })

        socket.on('terminal:output', (payload: TerminalOutputPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            outputHandlerRef.current(payload.data)
        })

        socket.on('terminal:exit', (payload: TerminalExitPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            exitHandlerRef.current(payload.code, payload.signal)
            setErrorState('Terminal exited.')
        })

        socket.on('terminal:error', (payload: TerminalErrorPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            setErrorState(payload.message)
        })

        socket.on('terminal:history-result', (payload: TerminalHistoryResult) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            if ('sessionId' in payload && payload.sessionId !== sessionIdRef.current) {
                return
            }
            if ('machineId' in payload && payload.machineId !== machineIdRef.current) {
                return
            }
            historyHandlerRef.current(payload)
        })

        socket.on('connect_error', (error) => {
            const message = error instanceof Error ? error.message : 'Connection error'
            setErrorState(message)
        })

        socket.on('disconnect', (reason) => {
            if (reason === 'io client disconnect') {
                setState({ status: 'idle' })
                return
            }
            setErrorState(`Disconnected: ${reason}`)
        })

        socket.connect()
    }, [emitCreate, setErrorState, isCurrentTerminal])

    const write = useCallback((data: string) => {
        const socket = socketRef.current
        if (!socket || !socket.connected) {
            return false
        }
        socket.emit('terminal:write', { terminalId: terminalIdRef.current, data })
        return true
    }, [])

    const resize = useCallback((cols: number, rows: number) => {
        lastSizeRef.current = { cols, rows }
        const socket = socketRef.current
        if (!socket || !socket.connected) {
            return
        }
        socket.emit('terminal:resize', { terminalId: terminalIdRef.current, cols, rows })
    }, [])

    const disconnect = useCallback(() => {
        const socket = socketRef.current
        if (!socket) {
            return
        }
        socket.removeAllListeners()
        socket.disconnect()
        socketRef.current = null
        setState({ status: 'idle' })
    }, [])

    const close = useCallback(() => {
        const socket = socketRef.current
        if (socket?.connected) {
            socket.emit('terminal:close', { terminalId: terminalIdRef.current })
        }
        disconnect()
    }, [disconnect])

    const onOutput = useCallback((handler: (data: string) => void) => {
        outputHandlerRef.current = handler
    }, [])

    const onExit = useCallback((handler: (code: number | null, signal: string | null) => void) => {
        exitHandlerRef.current = handler
    }, [])

    const requestHistory = useCallback((requestId: string, limit?: number) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return false
        }
        socket.emit('terminal:history', {
            terminalId: terminalIdRef.current,
            requestId,
            ...(limit === undefined ? {} : { limit })
        })
        return true
    }, [])

    const onHistory = useCallback((handler: (result: TerminalHistoryResult) => void) => {
        historyHandlerRef.current = handler
    }, [])

    return {
        state,
        connect,
        write,
        resize,
        disconnect,
        close,
        onOutput,
        onExit,
        requestHistory,
        onHistory
    }
}


export type TerminalScope =
    | { scopeType: 'session'; sessionId: string }
    | { scopeType: 'machine'; machineId: string }

const SESSION_LIVE_STATUSES = new Set<TerminalState['status']>(['running', 'detached', 'warning_idle', 'warning_age'])

function warningStatus(reason: TerminalWarningPayload['reason']): TerminalState['status'] {
    return reason === 'idle' ? 'warning_idle' : 'warning_age'
}

export type SessionTerminalController = {
    state: TerminalConnectionState
    terminals: TerminalState[]
    recoveryReason: 'cli_lost' | null
    listLoaded: boolean
    lastError: string | null
    connect: () => void
    disconnect: () => void
    subscribe: () => void
    create: (input: { terminalId: string; cols: number; rows: number; cwd?: string; replay?: boolean }) => boolean
    write: (terminalId: string, data: string) => boolean
    resize: (terminalId: string, cols: number, rows: number) => void
    closeOne: (terminalId: string) => void
    keepalive: (terminalId: string) => void
    onOutput: (handler: (terminalId: string, data: string) => void) => void
    onExit: (handler: (terminalId: string, code: number | null, signal: string | null) => void) => void
    onWarning: (handler: (payload: TerminalWarningPayload) => void) => void
    requestHistory: (terminalId: string, requestId: string, limit?: number) => boolean
    onHistory: (handler: (result: TerminalHistoryResult) => void) => void
    clearLastError: () => void
}

export function useSessionTerminalSocket(options: {
    baseUrl: string
    sessionId: string
}): SessionTerminalController {
    const [state, setState] = useState<TerminalConnectionState>({ status: 'idle' })
    const [terminals, setTerminals] = useState<TerminalState[]>([])
    const [recoveryReason, setRecoveryReason] = useState<'cli_lost' | null>(null)
    const [listLoaded, setListLoaded] = useState(false)
    const [lastError, setLastError] = useState<string | null>(null)
    const socketRef = useRef<Socket | null>(null)
    const baseUrlRef = useRef(options.baseUrl)
    const sessionIdRef = useRef(options.sessionId)
    const outputHandlerRef = useRef<(terminalId: string, data: string) => void>(() => {})
    const exitHandlerRef = useRef<(terminalId: string, code: number | null, signal: string | null) => void>(() => {})
    const warningHandlerRef = useRef<(payload: TerminalWarningPayload) => void>(() => {})
    const historyHandlerRef = useRef<(result: TerminalHistoryResult) => void>(() => {})

    useEffect(() => {
        baseUrlRef.current = options.baseUrl
        sessionIdRef.current = options.sessionId
    }, [options.baseUrl, options.sessionId])

    useEffect(() => {
        setTerminals([])
        setRecoveryReason(null)
        setListLoaded(false)
        setLastError(null)
    }, [options.sessionId])

    const isSessionPayload = useCallback((payload: { scopeType?: string; sessionId?: string }) => (
        payload.scopeType === 'session' && payload.sessionId === sessionIdRef.current
    ), [])

    const emitListRequest = useCallback((socket: Socket) => {
        socket.emit('terminal:list', { scopeType: 'session', sessionId: sessionIdRef.current })
    }, [])

    const subscribe = useCallback(() => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return
        }
        socket.emit('terminal:subscribe', { scopeType: 'session', sessionId: sessionIdRef.current })
        emitListRequest(socket)
    }, [emitListRequest])

    const ensureSocket = useCallback(() => {
        if (socketRef.current) {
            return socketRef.current
        }
        const manager = new Manager(baseUrlRef.current, {
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['polling', 'websocket'],
            autoConnect: false,
            withCredentials: true
        })
        const socket = manager.socket('/terminal')
        socketRef.current = socket

        socket.on('connect', () => {
            setState({ status: 'connected' })
            socket.emit('terminal:subscribe', { scopeType: 'session', sessionId: sessionIdRef.current })
            emitListRequest(socket)
        })

        socket.on('terminal:list', (payload: TerminalListPayload) => {
            if (!isSessionPayload(payload)) {
                return
            }
            setTerminals(payload.terminals)
            setRecoveryReason(payload.scopeType === 'session' ? (payload.recovery?.reason ?? null) : null)
            setListLoaded(true)
        })

        socket.on('terminal:output', (payload: { scopeType?: string; sessionId?: string; terminalId: string; data: string }) => {
            if (payload.scopeType && !isSessionPayload(payload)) {
                return
            }
            outputHandlerRef.current(payload.terminalId, payload.data)
        })

        socket.on('terminal:ready', (payload: { scopeType?: string; sessionId?: string; terminalId: string }) => {
            if (payload.scopeType && !isSessionPayload(payload)) {
                return
            }
            setState({ status: 'connected' })
            emitListRequest(socket)
        })

        socket.on('terminal:exit', (payload: { scopeType?: string; sessionId?: string; terminalId: string; code: number | null; signal: string | null }) => {
            if (payload.scopeType && !isSessionPayload(payload)) {
                return
            }
            exitHandlerRef.current(payload.terminalId, payload.code, payload.signal)
            emitListRequest(socket)
        })

        socket.on('terminal:error', (payload: { scopeType?: string; sessionId?: string; terminalId?: string; message: string }) => {
            if (payload.scopeType && !isSessionPayload(payload)) {
                return
            }
            setLastError(payload.message)
            if (socket.connected) {
                setState({ status: 'connected' })
            } else {
                setState({ status: 'error', error: payload.message })
            }
            emitListRequest(socket)
        })

        socket.on('terminal:warning', (payload: TerminalWarningPayload) => {
            if (!isSessionPayload(payload)) {
                return
            }
            setTerminals((current) => current.map((terminal) => {
                if (terminal.terminalId !== payload.terminalId) {
                    return terminal
                }
                if (!SESSION_LIVE_STATUSES.has(terminal.status)) {
                    return terminal
                }
                return {
                    ...terminal,
                    status: warningStatus(payload.reason),
                    idleWarningAt: payload.reason === 'idle' ? Date.now() : terminal.idleWarningAt
                }
            }))
            warningHandlerRef.current(payload)
        })

        socket.on('terminal:history-result', (payload: TerminalHistoryResult) => {
            if (!('sessionId' in payload) || payload.sessionId !== sessionIdRef.current) {
                return
            }
            historyHandlerRef.current(payload)
        })

        socket.on('connect_error', (error) => {
            const message = error instanceof Error ? error.message : 'Connection error'
            setState({ status: 'error', error: message })
        })

        socket.on('disconnect', (reason) => {
            if (reason === 'io client disconnect') {
                setState({ status: 'idle' })
                return
            }
            setState({ status: 'error', error: `Disconnected: ${reason}` })
        })

        return socket
    }, [emitListRequest, isSessionPayload])

    const connect = useCallback(() => {
        if (!sessionIdRef.current) {
            setState({ status: 'error', error: 'Missing terminal credentials.' })
            return
        }
        const socket = ensureSocket()
        setListLoaded(false)
        setState({ status: 'connecting' })
        if (socket.connected) {
            subscribe()
            setState({ status: 'connected' })
            return
        }
        socket.connect()
    }, [ensureSocket, subscribe])

    const disconnect = useCallback(() => {
        const socket = socketRef.current
        if (!socket) {
            return
        }
        socket.removeAllListeners()
        socket.disconnect()
        socketRef.current = null
        setListLoaded(false)
        setState({ status: 'idle' })
    }, [])

    const create = useCallback((input: { terminalId: string; cols: number; rows: number; cwd?: string; replay?: boolean }) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return false
        }
        setLastError(null)
        socket.emit('terminal:create', {
            sessionId: sessionIdRef.current,
            terminalId: input.terminalId,
            cols: input.cols,
            rows: input.rows,
            replay: input.replay ?? true,
            ...(input.cwd ? { cwd: input.cwd } : {})
        })
        return true
    }, [])

    const write = useCallback((terminalId: string, data: string) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return false
        }
        socket.emit('terminal:write', { terminalId, data })
        return true
    }, [])

    const resize = useCallback((terminalId: string, cols: number, rows: number) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return
        }
        socket.emit('terminal:resize', { terminalId, cols, rows })
    }, [])

    const closeOne = useCallback((terminalId: string) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return
        }
        socket.emit('terminal:close', { scopeType: 'session', sessionId: sessionIdRef.current, terminalId })
    }, [])

    const keepalive = useCallback((terminalId: string) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return
        }
        socket.emit('terminal:keepalive', { scopeType: 'session', sessionId: sessionIdRef.current, terminalId })
        emitListRequest(socket)
    }, [emitListRequest])

    const onOutput = useCallback((handler: (terminalId: string, data: string) => void) => {
        outputHandlerRef.current = handler
    }, [])

    const onExit = useCallback((handler: (terminalId: string, code: number | null, signal: string | null) => void) => {
        exitHandlerRef.current = handler
    }, [])

    const onWarning = useCallback((handler: (payload: TerminalWarningPayload) => void) => {
        warningHandlerRef.current = handler
    }, [])

    const requestHistory = useCallback((terminalId: string, requestId: string, limit?: number) => {
        const socket = socketRef.current
        if (!socket?.connected) {
            return false
        }
        socket.emit('terminal:history', {
            terminalId,
            requestId,
            ...(limit === undefined ? {} : { limit })
        })
        return true
    }, [])

    const onHistory = useCallback((handler: (result: TerminalHistoryResult) => void) => {
        historyHandlerRef.current = handler
    }, [])

    const clearLastError = useCallback(() => {
        setLastError(null)
    }, [])

    return useMemo(() => ({
        state,
        terminals,
        recoveryReason,
        listLoaded,
        lastError,
        connect,
        disconnect,
        subscribe,
        create,
        write,
        resize,
        closeOne,
        keepalive,
        onOutput,
        onExit,
        onWarning,
        requestHistory,
        onHistory,
        clearLastError
    }), [
        state,
        terminals,
        recoveryReason,
        listLoaded,
        lastError,
        connect,
        disconnect,
        subscribe,
        create,
        write,
        resize,
        closeOne,
        keepalive,
        onOutput,
        onExit,
        onWarning,
        requestHistory,
        onHistory,
        clearLastError
    ])
}
