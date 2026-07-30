export const TERMINAL_SEARCH_QUERY_MAX = 256
export const TERMINAL_SEARCH_DEBOUNCE_MS = 150
export const TERMINAL_SEARCH_HIGHLIGHT_LIMIT = 1_000

export type TerminalSearchResults = {
    resultIndex: number
    resultCount: number
    limitExceeded: boolean
}

export type TerminalSearchOptions = {
    caseSensitive: boolean
    incremental: boolean
}

export type TerminalSearchController = {
    findNext: (query: string, options: TerminalSearchOptions) => boolean
    findPrevious: (query: string, options: TerminalSearchOptions) => boolean
    clear: () => void
    subscribe: (listener: (results: TerminalSearchResults) => void) => () => void
}

export type TerminalSearchState = {
    status: 'idle' | 'loading' | 'ready' | 'error'
    controller: TerminalSearchController | null
    error: string | null
    retry: (() => void) | null
}

export const EMPTY_TERMINAL_SEARCH_RESULTS: TerminalSearchResults = Object.freeze({
    resultIndex: -1,
    resultCount: 0,
    limitExceeded: false,
})

export const EMPTY_TERMINAL_SEARCH_STATE: TerminalSearchState = Object.freeze({
    status: 'idle',
    controller: null,
    error: null,
    retry: null,
})
