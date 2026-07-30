import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import {
    formatTerminalKeyChord,
    normalizeTerminalModifiers,
    type TerminalKeyChord,
    type TerminalKeyChordDraft,
    type TerminalModifier,
} from './terminalKeyChord'
import {
    getBrowserTerminalKeyChordStore,
    subscribeTerminalKeyChords,
    type DeletedSavedTerminalKeyChord,
    type SavedTerminalKeyChord,
} from './terminalKeyChordStore'
import { encodeTerminalKeyChord } from './terminalKeyEncoder'
import { TerminalKeyPickerDialog } from './TerminalKeyPickerDialog'
import { TerminalSavedKeyDialog } from './TerminalSavedKeyDialog'

const MODIFIER_LABELS: Record<TerminalModifier, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
}

type FeedbackKey =
    | 'terminal.keys.savedSuccess'
    | 'terminal.keys.duplicate'
    | 'terminal.keys.limit'
    | 'terminal.keys.unavailable'
    | 'terminal.keys.unsupported'
    | 'terminal.keys.sendFailed'

function completedChord(draft: TerminalKeyChordDraft): TerminalKeyChord | null {
    return draft.key ? { modifiers: draft.modifiers, key: draft.key } : null
}

function TerminalEditableKeyBadge(props: {
    label: string
    main?: boolean
    removeLabel: string
    onRemove: () => void
}) {
    return (
        <span
            className={`inline-flex min-h-[34px] max-w-40 shrink-0 items-center overflow-hidden rounded-[9px] border pl-2.5 text-[10px] font-extrabold ${
                props.main
                    ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-600 dark:text-cyan-200'
                    : 'border-violet-500/45 bg-violet-500/15 text-violet-600 dark:text-violet-200'
            }`}
        >
            <span className="truncate">{props.label}</span>
            <button
                type="button"
                aria-label={props.removeLabel}
                onClick={(event) => {
                    event.stopPropagation()
                    props.onRemove()
                }}
                className={`ml-1.5 grid h-9 w-9 shrink-0 place-items-center border-l text-base font-normal ${
                    props.main
                        ? 'border-cyan-500/25 text-cyan-600 dark:text-cyan-200'
                        : 'border-violet-500/25 text-violet-600 dark:text-violet-200'
                }`}
            >
                ×
            </button>
        </span>
    )
}

export function TerminalKeyComposer(props: {
    terminalContextKey: string | null
    disabled: boolean
    visible: boolean
    onSend: (sequence: string) => boolean
}) {
    const { t } = useTranslation()
    const [draft, setDraft] = useState<TerminalKeyChordDraft>({
        modifiers: [],
        key: null,
    })
    const [items, setItems] = useState<SavedTerminalKeyChord[]>([])
    const [pickerOpen, setPickerOpen] = useState(false)
    const [managerOpen, setManagerOpen] = useState(false)
    const [feedback, setFeedback] = useState<FeedbackKey | null>(null)
    const [storageUnavailable, setStorageUnavailable] = useState(false)
    const loadedRef = useRef(false)
    const previousContextRef = useRef(props.terminalContextKey)
    const sendingRef = useRef(false)
    const badgeScrollRef = useRef<HTMLDivElement | null>(null)
    const savedKeyRefs = useRef(new Map<string, HTMLButtonElement>())

    const refreshItems = useCallback(() => {
        const store = getBrowserTerminalKeyChordStore()
        const loaded = store?.load()
        if (!loaded || loaded.status === 'unavailable') {
            setItems([])
            setStorageUnavailable(true)
            return
        }
        setItems(loaded.items)
        setStorageUnavailable(false)
    }, [])

    useEffect(() => subscribeTerminalKeyChords(() => {
        if (loadedRef.current) {
            refreshItems()
        }
    }), [refreshItems])

    useEffect(() => {
        if (props.visible && !loadedRef.current) {
            loadedRef.current = true
            refreshItems()
        }
    }, [props.visible, refreshItems])

    useEffect(() => {
        if (previousContextRef.current === props.terminalContextKey) {
            return
        }
        previousContextRef.current = props.terminalContextKey
        setDraft({ modifiers: [], key: null })
        setPickerOpen(false)
        setManagerOpen(false)
        setFeedback(null)
    }, [props.terminalContextKey])

    useEffect(() => {
        const node = badgeScrollRef.current
        if (node) {
            node.scrollLeft = node.scrollWidth
        }
    }, [draft])

    const chord = completedChord(draft)
    const encoding = useMemo(
        () => chord ? encodeTerminalKeyChord(chord) : null,
        [chord],
    )
    const valid = Boolean(encoding?.ok)

    const removeModifier = (modifier: TerminalModifier) => {
        setFeedback(null)
        setDraft((current) => ({
            ...current,
            modifiers: current.modifiers.filter((item) => item !== modifier),
        }))
    }

    const handleSend = () => {
        if (
            props.disabled
            || !encoding?.ok
            || sendingRef.current
        ) {
            return
        }
        sendingRef.current = true
        const accepted = props.onSend(encoding.sequence)
        if (accepted) {
            setDraft({ modifiers: [], key: null })
            setFeedback(null)
        } else {
            setFeedback('terminal.keys.sendFailed')
        }
        queueMicrotask(() => {
            sendingRef.current = false
        })
    }

    const handleSave = () => {
        if (!chord || !encoding?.ok) {
            setFeedback('terminal.keys.unsupported')
            return
        }
        const result = getBrowserTerminalKeyChordStore()?.save(chord)
        switch (result?.status) {
            case 'saved':
                setFeedback('terminal.keys.savedSuccess')
                break
            case 'duplicate':
                setFeedback('terminal.keys.duplicate')
                savedKeyRefs.current.get(result.item.id)?.scrollIntoView?.({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center',
                })
                break
            case 'limit':
                setFeedback('terminal.keys.limit')
                break
            default:
                setFeedback('terminal.keys.unavailable')
        }
    }

    const handleDelete = (id: string): DeletedSavedTerminalKeyChord | null => (
        getBrowserTerminalKeyChordStore()?.remove(id) ?? null
    )

    const handleRestore = (deleted: DeletedSavedTerminalKeyChord) => {
        if (!getBrowserTerminalKeyChordStore()?.restore(deleted)) {
            setFeedback('terminal.keys.unavailable')
        }
    }

    const normalizedModifiers = normalizeTerminalModifiers(draft.modifiers) ?? []

    return (
        <div
            hidden={!props.visible}
            className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-2.5 shadow-xl backdrop-blur"
        >
            <div className="flex items-center justify-between px-0.5 text-[9px] font-extrabold uppercase tracking-[0.07em] text-[var(--app-hint)]">
                <span>{t('terminal.keys.saved', { count: items.length })}</span>
                <button
                    type="button"
                    disabled={storageUnavailable}
                    onClick={() => setManagerOpen(true)}
                    className="min-h-8 px-1.5 text-[10px] font-bold normal-case tracking-normal text-violet-600 disabled:opacity-40 dark:text-violet-300"
                >
                    {t('terminal.keys.manage')}
                </button>
            </div>

            <div
                data-testid="terminal-saved-key-rail"
                className="flex h-[42px] items-center gap-1.5 overflow-x-auto whitespace-nowrap overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {items.length === 0 ? (
                    <span className="px-1 text-[10px] text-[var(--app-hint)]">
                        {storageUnavailable
                            ? t('terminal.keys.unavailable')
                            : t('terminal.keys.emptySaved')}
                    </span>
                ) : items.map((item) => {
                    const label = formatTerminalKeyChord(item.chord)
                    return (
                        <button
                            key={item.id}
                            ref={(node) => {
                                if (node) {
                                    savedKeyRefs.current.set(item.id, node)
                                } else {
                                    savedKeyRefs.current.delete(item.id)
                                }
                            }}
                            type="button"
                            aria-label={`${t('terminal.keys.load')} ${label}`}
                            disabled={props.disabled}
                            onClick={() => {
                                setDraft({
                                    modifiers: [...item.chord.modifiers],
                                    key: item.chord.key,
                                })
                                setFeedback(null)
                            }}
                            className="min-h-9 shrink-0 rounded-[10px] border border-violet-500/35 bg-violet-500/10 px-2.5 text-[10px] font-extrabold text-violet-600 shadow-[inset_0_-2px_0_rgba(0,0,0,0.08)] disabled:opacity-40 dark:text-violet-200"
                        >
                            {label}
                        </button>
                    )
                })}
            </div>

            <div className="my-2 h-px bg-[var(--app-border)]" />

            <div className="mb-1.5 flex items-center justify-between px-0.5 text-[9px] font-extrabold uppercase tracking-[0.07em] text-[var(--app-hint)]">
                <span>{t('terminal.keys.combination')}</span>
                <span className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label={t('terminal.keys.save')}
                        disabled={!valid || props.disabled}
                        onClick={handleSave}
                        className="min-h-8 px-1 text-[10px] font-bold normal-case tracking-normal text-violet-600 disabled:opacity-35 dark:text-violet-300"
                    >
                        ☆ {t('terminal.keys.save')}
                    </button>
                    <button
                        type="button"
                        disabled={(!draft.key && draft.modifiers.length === 0) || props.disabled}
                        onClick={() => {
                            setDraft({ modifiers: [], key: null })
                            setFeedback(null)
                        }}
                        className="min-h-8 px-1 text-[10px] font-bold normal-case tracking-normal text-[var(--app-hint)] disabled:opacity-35"
                    >
                        {t('terminal.keys.clear')}
                    </button>
                </span>
            </div>

            <div className="flex items-center gap-1.5">
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={t('terminal.keys.combination')}
                    onClick={() => !props.disabled && setPickerOpen(true)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            if (!props.disabled) setPickerOpen(true)
                        }
                    }}
                    className="relative flex min-h-12 min-w-0 flex-1 items-center overflow-hidden rounded-[11px] border border-[var(--app-border)] bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                    <div
                        ref={badgeScrollRef}
                        data-testid="terminal-key-badge-scroll"
                        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-1.5 pl-1.5 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {normalizedModifiers.map((modifier, index) => (
                            <span key={modifier} className="contents">
                                {index > 0 ? (
                                    <span aria-hidden="true" className="shrink-0 text-[9px] text-[var(--app-hint)]">+</span>
                                ) : null}
                                <TerminalEditableKeyBadge
                                    label={MODIFIER_LABELS[modifier]}
                                    removeLabel={t('terminal.keys.remove', { key: MODIFIER_LABELS[modifier] })}
                                    onRemove={() => removeModifier(modifier)}
                                />
                            </span>
                        ))}
                        {draft.key ? (
                            <>
                                {normalizedModifiers.length > 0 ? (
                                    <span aria-hidden="true" className="shrink-0 text-[9px] text-[var(--app-hint)]">+</span>
                                ) : null}
                                <TerminalEditableKeyBadge
                                    label={draft.key.label}
                                    main
                                    removeLabel={t('terminal.keys.remove', { key: draft.key.label })}
                                    onRemove={() => {
                                        setFeedback(null)
                                        setDraft((current) => ({ ...current, key: null }))
                                    }}
                                />
                            </>
                        ) : normalizedModifiers.length === 0 ? (
                            <span className="px-1 text-[10px] text-[var(--app-hint)]">
                                {t('terminal.keys.empty')}
                            </span>
                        ) : null}
                    </div>
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-r from-transparent to-[var(--app-subtle-bg)]"
                    />
                </div>

                <button
                    type="button"
                    aria-label={t('terminal.keys.add')}
                    disabled={props.disabled}
                    onClick={() => setPickerOpen(true)}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-lg text-[var(--app-fg)] disabled:opacity-40"
                >
                    +
                </button>
                <button
                    type="button"
                    disabled={!valid || props.disabled}
                    onClick={handleSend}
                    className="min-h-12 shrink-0 rounded-[10px] border border-violet-500 bg-gradient-to-br from-violet-600 to-violet-700 px-3 text-[10px] font-extrabold text-white disabled:border-[var(--app-border)] disabled:bg-none disabled:bg-[var(--app-secondary-bg)] disabled:text-[var(--app-hint)]"
                >
                    {t('terminal.keys.send')}
                </button>
            </div>

            {feedback ? (
                <p
                    role={feedback === 'terminal.keys.sendFailed' || feedback === 'terminal.keys.unsupported' ? 'alert' : 'status'}
                    className={`mt-2 px-1 text-[10px] ${
                        feedback === 'terminal.keys.savedSuccess'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-amber-600 dark:text-amber-300'
                    }`}
                >
                    {t(feedback)}
                </p>
            ) : null}

            <TerminalKeyPickerDialog
                open={pickerOpen}
                chord={draft}
                onOpenChange={setPickerOpen}
                onApply={(next) => {
                    setDraft({
                        modifiers: [...next.modifiers],
                        key: next.key,
                    })
                    setFeedback(null)
                }}
            />
            <TerminalSavedKeyDialog
                open={managerOpen}
                items={items}
                onOpenChange={setManagerOpen}
                onLoad={(next) => {
                    setDraft({
                        modifiers: [...next.modifiers],
                        key: next.key,
                    })
                    setFeedback(null)
                }}
                onDelete={handleDelete}
                onRestore={handleRestore}
            />
        </div>
    )
}
