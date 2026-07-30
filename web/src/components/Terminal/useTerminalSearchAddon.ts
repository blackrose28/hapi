import { useEffect, useRef, useState } from 'react'
import type { ITerminalAddon, Terminal } from '@xterm/xterm'
import {
    EMPTY_TERMINAL_SEARCH_RESULTS,
    EMPTY_TERMINAL_SEARCH_STATE,
    TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
    type TerminalSearchController,
    type TerminalSearchOptions,
    type TerminalSearchResults,
    type TerminalSearchState,
} from './terminalSearch'

type SearchResultEvent = {
    resultIndex: number
    resultCount: number
}

type TerminalSearchAddonAdapter = {
    dispose: () => void
    clearDecorations: () => void
    findNext: (query: string, options: {
        caseSensitive: boolean
        incremental: boolean
        decorations: SearchDecorationOptions
    }) => boolean
    findPrevious: (query: string, options: {
        caseSensitive: boolean
        incremental: boolean
        decorations: SearchDecorationOptions
    }) => boolean
    onDidChangeResults: (
        listener: (event: SearchResultEvent) => void,
    ) => { dispose: () => void }
}

type SearchDecorationOptions = {
    matchBackground: string
    matchBorder: string
    matchOverviewRuler: string
    activeMatchBackground: string
    activeMatchBorder: string
    activeMatchColorOverviewRuler: string
}

const SEARCH_DECORATIONS: SearchDecorationOptions = Object.freeze({
    matchBackground: '#5f4b00',
    matchBorder: '#ffd75f',
    matchOverviewRuler: '#ffd75f',
    activeMatchBackground: '#d97706',
    activeMatchBorder: '#ffffff',
    activeMatchColorOverviewRuler: '#f59e0b',
})

export const terminalSearchAddonLoader = {
    async load(): Promise<TerminalSearchAddonAdapter> {
        const { SearchAddon } = await import('@xterm/addon-search')
        return new SearchAddon({
            highlightLimit: TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
        })
    },
}

type SearchResource = {
    terminal: Terminal
    active: boolean
    disposed: boolean
    liveToken: { current: boolean }
    loading: boolean
    addon: TerminalSearchAddonAdapter | null
    resultSubscription: { dispose: () => void } | null
    controller: TerminalSearchController | null
    listeners: Set<(results: TerminalSearchResults) => void>
}

function normalizeResults(event: SearchResultEvent): TerminalSearchResults {
    const resultIndex = Number.isFinite(event.resultIndex)
        ? Math.trunc(event.resultIndex)
        : -1
    const resultCount = Number.isFinite(event.resultCount)
        ? Math.max(0, Math.trunc(event.resultCount))
        : 0
    return {
        resultIndex,
        resultCount,
        limitExceeded: resultCount >= TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
    }
}

function safeLoadError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message
    }
    return 'Unable to load terminal search'
}

function createController(
    addon: TerminalSearchAddonAdapter,
    listeners: Set<(results: TerminalSearchResults) => void>,
    liveToken: { current: boolean },
): TerminalSearchController {
    const emit = (results: TerminalSearchResults) => {
        if (!liveToken.current) return
        for (const listener of listeners) {
            listener(results)
        }
    }
    const clear = () => {
        if (!liveToken.current) return
        addon.clearDecorations()
        emit(EMPTY_TERMINAL_SEARCH_RESULTS)
    }
    const searchOptions = (options: TerminalSearchOptions) => ({
        caseSensitive: options.caseSensitive,
        incremental: options.incremental,
        decorations: SEARCH_DECORATIONS,
    })
    return {
        findNext(query, options) {
            if (!liveToken.current) return false
            if (!query) {
                clear()
                return false
            }
            return addon.findNext(query, searchOptions(options))
        },
        findPrevious(query, options) {
            if (!liveToken.current) return false
            if (!query) {
                clear()
                return false
            }
            return addon.findPrevious(query, searchOptions(options))
        },
        clear,
        subscribe(listener) {
            if (!liveToken.current) return () => {}
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

export function useTerminalSearchAddon(options: {
    terminal: Terminal | null
    active: boolean
}): TerminalSearchState {
    const resourceRef = useRef<SearchResource | null>(null)
    const [retryVersion, setRetryVersion] = useState(0)
    const [snapshot, setSnapshot] = useState<{
        terminal: Terminal | null
        state: TerminalSearchState
    }>({
        terminal: null,
        state: EMPTY_TERMINAL_SEARCH_STATE,
    })

    useEffect(() => {
        if (!options.terminal) {
            resourceRef.current = null
            setSnapshot({
                terminal: null,
                state: EMPTY_TERMINAL_SEARCH_STATE,
            })
            return
        }

        const resource: SearchResource = {
            terminal: options.terminal,
            active: options.active,
            disposed: false,
            liveToken: { current: true },
            loading: false,
            addon: null,
            resultSubscription: null,
            controller: null,
            listeners: new Set(),
        }
        resourceRef.current = resource
        setSnapshot({
            terminal: options.terminal,
            state: EMPTY_TERMINAL_SEARCH_STATE,
        })

        return () => {
            resource.liveToken.current = false
            resource.disposed = true
            resource.resultSubscription?.dispose()
            resource.resultSubscription = null
            resource.addon?.dispose()
            resource.addon = null
            resource.controller = null
            resource.listeners.clear()
            if (resourceRef.current === resource) {
                resourceRef.current = null
            }
        }
    }, [options.terminal])

    useEffect(() => {
        const resource = resourceRef.current
        if (!resource || resource.terminal !== options.terminal || resource.disposed) {
            return
        }
        resource.active = options.active

        const publish = (state: TerminalSearchState) => {
            if (
                !resource.liveToken.current
                || resource.disposed
                || resourceRef.current !== resource
            ) return
            setSnapshot({ terminal: resource.terminal, state })
        }
        const isCurrentActiveResource = () => (
            resource.liveToken.current
            && !resource.disposed
            && resourceRef.current === resource
            && resource.active
        )

        if (!options.active) {
            resource.controller?.clear()
            if (!resource.controller) {
                resource.addon?.clearDecorations()
            }
            publish(EMPTY_TERMINAL_SEARCH_STATE)
            return
        }

        if (resource.controller) {
            publish({
                status: 'ready',
                controller: resource.controller,
                error: null,
                retry: null,
            })
            return
        }
        if (resource.loading) return

        resource.loading = true
        publish({
            status: 'loading',
            controller: null,
            error: null,
            retry: null,
        })

        void terminalSearchAddonLoader.load().then((addon) => {
            resource.loading = false
            if (resource.disposed || resourceRef.current !== resource) {
                addon.dispose()
                return
            }

            try {
                resource.terminal.loadAddon(addon as unknown as ITerminalAddon)
                resource.addon = addon
                resource.controller = createController(
                    addon,
                    resource.listeners,
                    resource.liveToken,
                )
                resource.resultSubscription = addon.onDidChangeResults((event) => {
                    const results = normalizeResults(event)
                    for (const listener of resource.listeners) {
                        listener(results)
                    }
                })
            } catch (error) {
                addon.dispose()
                resource.addon = null
                resource.controller = null
                resource.resultSubscription = null
                if (!isCurrentActiveResource()) return
                publish({
                    status: 'error',
                    controller: null,
                    error: safeLoadError(error),
                    retry: () => setRetryVersion((value) => value + 1),
                })
                return
            }

            if (resource.active) {
                publish({
                    status: 'ready',
                    controller: resource.controller,
                    error: null,
                    retry: null,
                })
            } else {
                resource.controller.clear()
                publish(EMPTY_TERMINAL_SEARCH_STATE)
            }
        }).catch((error: unknown) => {
            resource.loading = false
            if (!isCurrentActiveResource()) return
            publish({
                status: 'error',
                controller: null,
                error: safeLoadError(error),
                retry: () => setRetryVersion((value) => value + 1),
            })
        })
    }, [options.active, options.terminal, retryVersion])

    return snapshot.terminal === options.terminal
        ? snapshot.state
        : EMPTY_TERMINAL_SEARCH_STATE
}
