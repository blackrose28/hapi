import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type CompositionEvent,
    type FormEvent,
} from 'react'
import { useTranslation } from '@/lib/use-translation'
import {
    EMPTY_TERMINAL_SEARCH_RESULTS,
    TERMINAL_SEARCH_DEBOUNCE_MS,
    TERMINAL_SEARCH_QUERY_MAX,
    type TerminalSearchController,
    type TerminalSearchResults,
    type TerminalSearchState,
} from './terminalSearch'

export type TerminalSearchPanelProps = {
    state: TerminalSearchState
    onClose: () => void
}

type SearchButtonProps = {
    label: string
    disabled?: boolean
    pressed?: boolean
    onClick: () => void
    children: string
}

function SearchButton(props: SearchButtonProps) {
    return (
        <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.pressed}
            disabled={props.disabled}
            onClick={props.onClick}
            className={`grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg px-2 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 ${
                props.pressed
                    ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                    : 'text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
            }`}
        >
            {props.children}
        </button>
    )
}

function displayResults(results: TerminalSearchResults): string {
    if (results.limitExceeded) return '1000+'
    const index = results.resultIndex >= 0 && results.resultCount > 0
        ? Math.min(results.resultIndex + 1, results.resultCount)
        : 0
    return `${index}/${results.resultCount}`
}

export function TerminalSearchPanel(props: TerminalSearchPanelProps) {
    const { t } = useTranslation()
    const controller = props.state.status === 'ready'
        ? props.state.controller
        : null
    const [query, setQuery] = useState('')
    const [caseSensitive, setCaseSensitive] = useState(false)
    const [results, setResults] = useState<TerminalSearchResults>(
        EMPTY_TERMINAL_SEARCH_RESULTS,
    )
    const [isComposing, setIsComposing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const composingRef = useRef(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const cancelPendingSearch = useCallback(() => {
        if (timerRef.current === null) return
        clearTimeout(timerRef.current)
        timerRef.current = null
    }, [])

    const scheduleSearch = useCallback((
        activeController: TerminalSearchController,
        nextQuery: string,
        nextCaseSensitive: boolean,
    ) => {
        cancelPendingSearch()
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            activeController.findNext(nextQuery, {
                caseSensitive: nextCaseSensitive,
                incremental: true,
            })
        }, TERMINAL_SEARCH_DEBOUNCE_MS)
    }, [cancelPendingSearch])

    useEffect(() => {
        composingRef.current = false
        setIsComposing(false)
        cancelPendingSearch()
        setResults(EMPTY_TERMINAL_SEARCH_RESULTS)
        if (!controller) return

        const unsubscribe = controller.subscribe(setResults)
        return () => {
            cancelPendingSearch()
            unsubscribe()
        }
    }, [cancelPendingSearch, controller])

    useEffect(() => () => {
        cancelPendingSearch()
    }, [cancelPendingSearch])

    const updateQuery = (event: ChangeEvent<HTMLInputElement>) => {
        const nextQuery = event.currentTarget.value.slice(
            0,
            TERMINAL_SEARCH_QUERY_MAX,
        )
        setQuery(nextQuery)
        cancelPendingSearch()
        if (!controller) return
        if (!nextQuery) {
            controller.clear()
            setResults(EMPTY_TERMINAL_SEARCH_RESULTS)
            return
        }
        if (!composingRef.current) {
            scheduleSearch(controller, nextQuery, caseSensitive)
        }
    }

    const startComposition = () => {
        composingRef.current = true
        setIsComposing(true)
        cancelPendingSearch()
    }

    const endComposition = (event: CompositionEvent<HTMLInputElement>) => {
        composingRef.current = false
        setIsComposing(false)
        const nextQuery = event.currentTarget.value.slice(
            0,
            TERMINAL_SEARCH_QUERY_MAX,
        )
        setQuery(nextQuery)
        cancelPendingSearch()
        if (!controller) return
        if (!nextQuery) {
            controller.clear()
            setResults(EMPTY_TERMINAL_SEARCH_RESULTS)
            return
        }
        scheduleSearch(controller, nextQuery, caseSensitive)
    }

    const toggleCaseSensitive = () => {
        const nextCaseSensitive = !caseSensitive
        setCaseSensitive(nextCaseSensitive)
        cancelPendingSearch()
        if (composingRef.current || !controller || !query) return
        controller.findNext(query, {
            caseSensitive: nextCaseSensitive,
            incremental: true,
        })
    }

    const navigate = (direction: 'previous' | 'next') => {
        if (composingRef.current) return
        cancelPendingSearch()
        if (!controller || !query) return
        const options = {
            caseSensitive,
            incremental: false,
        }
        if (direction === 'previous') {
            controller.findPrevious(query, options)
        } else {
            controller.findNext(query, options)
        }
    }

    const submitSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        composingRef.current = false
        setIsComposing(false)
        cancelPendingSearch()
        const nextQuery = (inputRef.current?.value ?? query).slice(
            0,
            TERMINAL_SEARCH_QUERY_MAX,
        )
        setQuery(nextQuery)
        if (!controller || !nextQuery) {
            controller?.clear()
            setResults(EMPTY_TERMINAL_SEARCH_RESULTS)
            return
        }
        controller.findNext(nextQuery, {
            caseSensitive,
            incremental: false,
        })
    }

    const close = () => {
        cancelPendingSearch()
        props.onClose()
    }

    return (
        <form
            role="region"
            aria-label={t('terminal.search.title')}
            aria-busy={props.state.status === 'loading'}
            onSubmit={submitSearch}
            className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_44px] gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-1.5 text-[var(--app-fg)] shadow-lg backdrop-blur transition-[opacity,transform] duration-150 motion-reduce:transition-none lg:flex lg:items-center"
        >
            {controller ? (
                <>
                    <label className="col-start-1 row-start-1 min-w-0 flex-1">
                        <span className="sr-only">{t('terminal.search.input')}</span>
                        <input
                            ref={inputRef}
                            type="search"
                            value={query}
                            maxLength={TERMINAL_SEARCH_QUERY_MAX}
                            enterKeyHint="search"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            aria-label={t('terminal.search.input')}
                            placeholder={t('terminal.search.input')}
                            onChange={updateQuery}
                            onCompositionStart={startComposition}
                            onCompositionEnd={endComposition}
                            className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)] focus-visible:ring-2 focus-visible:ring-violet-500"
                        />
                    </label>
                    <div
                        data-testid="terminal-search-controls"
                        className="col-span-2 row-start-2 flex items-center justify-end gap-1 lg:contents"
                    >
                        <output
                            aria-live="polite"
                            aria-atomic="true"
                            className="mr-auto min-w-10 shrink-0 text-center text-xs tabular-nums text-[var(--app-hint)] lg:mr-0"
                        >
                            {displayResults(results)}
                        </output>
                        <SearchButton
                            label={t('terminal.search.caseSensitive')}
                            pressed={caseSensitive}
                            onClick={toggleCaseSensitive}
                        >
                            Aa
                        </SearchButton>
                        <SearchButton
                            label={t('terminal.search.previous')}
                            disabled={!query || isComposing}
                            onClick={() => navigate('previous')}
                        >
                            ‹
                        </SearchButton>
                        <SearchButton
                            label={t('terminal.search.next')}
                            disabled={!query || isComposing}
                            onClick={() => navigate('next')}
                        >
                            ›
                        </SearchButton>
                    </div>
                </>
            ) : (
                <div className="col-start-1 row-start-1 min-w-0 flex-1 px-2 text-sm text-[var(--app-hint)]">
                    {props.state.status === 'error' ? (
                        <div className="flex min-w-0 items-center gap-2">
                            <span role="alert" className="min-w-0 flex-1 truncate">
                                {props.state.error || t('terminal.search.error')}
                            </span>
                            {props.state.retry ? (
                                <SearchButton
                                    label={t('terminal.search.retry')}
                                    onClick={props.state.retry}
                                >
                                    ↻
                                </SearchButton>
                            ) : null}
                        </div>
                    ) : (
                        <span role="status">
                            {props.state.status === 'loading'
                                ? t('terminal.search.loading')
                                : t('terminal.search.unavailable')}
                        </span>
                    )}
                </div>
            )}
            <SearchButton
                label={t('terminal.search.close')}
                onClick={close}
            >
                ×
            </SearchButton>
        </form>
    )
}
