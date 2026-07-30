import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalHistoryEntry, TerminalHistoryResult } from '@hapi/protocol'

export type TerminalHistoryState =
    | { status: 'idle'; entries: [] }
    | { status: 'loading'; entries: [] }
    | { status: 'ready'; entries: TerminalHistoryEntry[] }
    | { status: 'unsupported'; entries: []; shell?: string }
    | { status: 'error'; entries: []; message: 'not_ready' | 'read_failed' | 'request_failed' | 'cli_outdated' }

type UseTerminalHistoryOptions = {
    terminalContextKey: string | null
    terminalId: string | null
    request: (requestId: string, limit: number) => boolean
    subscribe: (handler: (result: TerminalHistoryResult) => void) => void
}

let fallbackRequestSequence = 0
const HISTORY_REQUEST_TIMEOUT_MS = 10_000

function createRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    fallbackRequestSequence += 1
    return `terminal-history-${Date.now()}-${fallbackRequestSequence}`
}

export function useTerminalHistory(options: UseTerminalHistoryOptions): {
    state: TerminalHistoryState
    open: () => void
    refresh: () => void
    close: () => void
} {
    const [state, setState] = useState<TerminalHistoryState>({ status: 'idle', entries: [] })
    const activeRequestRef = useRef<{ requestId: string; terminalContextKey: string; terminalId: string } | null>(null)
    const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const terminalContextKeyRef = useRef(options.terminalContextKey)
    const terminalIdRef = useRef(options.terminalId)
    const requestRef = useRef(options.request)
    terminalContextKeyRef.current = options.terminalContextKey
    terminalIdRef.current = options.terminalId
    requestRef.current = options.request

    const clearRequestTimeout = useCallback(() => {
        if (requestTimeoutRef.current === null) {
            return
        }
        clearTimeout(requestTimeoutRef.current)
        requestTimeoutRef.current = null
    }, [])

    useEffect(() => {
        clearRequestTimeout()
        activeRequestRef.current = null
        setState({ status: 'idle', entries: [] })
    }, [clearRequestTimeout, options.terminalContextKey])

    useEffect(() => {
        options.subscribe((result) => {
            const active = activeRequestRef.current
            if (
                !active
                || result.requestId !== active.requestId
                || result.terminalId !== active.terminalId
                || terminalContextKeyRef.current !== active.terminalContextKey
            ) {
                return
            }

            clearRequestTimeout()
            activeRequestRef.current = null
            if (result.status === 'ok') {
                setState({ status: 'ready', entries: result.entries })
                return
            }
            if (result.status === 'unsupported_shell') {
                setState({
                    status: 'unsupported',
                    entries: [],
                    ...(result.shell ? { shell: result.shell } : {})
                })
                return
            }
            setState({
                status: 'error',
                entries: [],
                message: result.status
            })
        })
    }, [clearRequestTimeout, options.subscribe])

    useEffect(() => clearRequestTimeout, [clearRequestTimeout])

    const load = useCallback(() => {
        clearRequestTimeout()
        const terminalContextKey = terminalContextKeyRef.current
        const terminalId = terminalIdRef.current
        if (!terminalContextKey || !terminalId) {
            activeRequestRef.current = null
            setState({ status: 'error', entries: [], message: 'request_failed' })
            return
        }

        const requestId = createRequestId()
        activeRequestRef.current = { requestId, terminalContextKey, terminalId }
        setState({ status: 'loading', entries: [] })
        if (!requestRef.current(requestId, 100)) {
            activeRequestRef.current = null
            setState({ status: 'error', entries: [], message: 'request_failed' })
            return
        }

        requestTimeoutRef.current = setTimeout(() => {
            const active = activeRequestRef.current
            if (!active || active.requestId !== requestId) {
                return
            }
            requestTimeoutRef.current = null
            activeRequestRef.current = null
            setState({ status: 'error', entries: [], message: 'request_failed' })
        }, HISTORY_REQUEST_TIMEOUT_MS)
    }, [clearRequestTimeout])

    const close = useCallback(() => {
        clearRequestTimeout()
        activeRequestRef.current = null
        setState({ status: 'idle', entries: [] })
    }, [clearRequestTimeout])

    return {
        state,
        open: load,
        refresh: load,
        close
    }
}
