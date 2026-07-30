import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'
import { useTranslation } from '@/lib/use-translation'
import {
    TERMINAL_KEY_GROUPS,
    type TerminalKeyChord,
    type TerminalKeyChordDraft,
    type TerminalKeyGroup,
    type TerminalMainKey,
    type TerminalModifier,
} from './terminalKeyChord'
import { encodeTerminalKeyChord } from './terminalKeyEncoder'

const MODIFIERS: Array<{ id: TerminalModifier; label: string }> = [
    { id: 'ctrl', label: 'Ctrl' },
    { id: 'alt', label: 'Alt' },
    { id: 'shift', label: 'Shift' },
]

const GROUPS: Array<{ id: TerminalKeyGroup; labelKey: string }> = [
    { id: 'basic', labelKey: 'terminal.keys.basic' },
    { id: 'alphanumeric', labelKey: 'terminal.keys.alphanumeric' },
    { id: 'function', labelKey: 'terminal.keys.function' },
    { id: 'symbol', labelKey: 'terminal.keys.symbol' },
]

function initialDraft(chord: TerminalKeyChordDraft | null): TerminalKeyChordDraft {
    return chord
        ? { modifiers: [...chord.modifiers], key: chord.key }
        : { modifiers: [], key: null }
}

function isDraftSupported(draft: TerminalKeyChordDraft): draft is TerminalKeyChord {
    return draft.key !== null && encodeTerminalKeyChord({
        modifiers: draft.modifiers,
        key: draft.key,
    }).ok
}

export function TerminalKeyTokenList(props: {
    chord: TerminalKeyChord
    compact?: boolean
}) {
    const tokens = [
        ...props.chord.modifiers.map((modifier) => ({
            id: modifier,
            label: MODIFIERS.find((item) => item.id === modifier)?.label ?? modifier,
            main: false,
        })),
        { id: props.chord.key.id, label: props.chord.key.label, main: true },
    ]
    return (
        <span className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tokens.map((token, index) => (
                <span key={token.id} className="contents">
                    {index > 0 ? (
                        <span aria-hidden="true" className="shrink-0 text-[9px] text-[var(--app-hint)]">
                            +
                        </span>
                    ) : null}
                    <span
                        className={`inline-flex shrink-0 items-center border font-extrabold ${
                            props.compact
                                ? 'min-h-[30px] rounded-lg px-2 text-[9px]'
                                : 'min-h-8 rounded-lg px-2.5 text-[10px]'
                        } ${
                            token.main
                                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-200'
                                : 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-200'
                        }`}
                    >
                        {token.label}
                    </span>
                </span>
            ))}
        </span>
    )
}

export function TerminalKeyPickerDialog(props: {
    open: boolean
    chord: TerminalKeyChordDraft | null
    onOpenChange: (open: boolean) => void
    onApply: (chord: TerminalKeyChord) => void
}) {
    const { t } = useTranslation()
    const [draft, setDraft] = useState<TerminalKeyChordDraft>(() => initialDraft(props.chord))
    const [group, setGroup] = useState<TerminalKeyGroup>(props.chord?.key?.group ?? 'basic')

    useEffect(() => {
        if (!props.open) {
            return
        }
        setDraft(initialDraft(props.chord))
        setGroup(props.chord?.key?.group ?? 'basic')
    }, [props.chord, props.open])

    const supported = useMemo(() => isDraftSupported(draft), [draft])
    const previewChord = draft.key
        ? { modifiers: draft.modifiers, key: draft.key }
        : null

    const toggleModifier = (modifier: TerminalModifier) => {
        setDraft((current) => ({
            ...current,
            modifiers: current.modifiers.includes(modifier)
                ? current.modifiers.filter((item) => item !== modifier)
                : MODIFIERS
                    .map((item) => item.id)
                    .filter((item) => (
                        item === modifier || current.modifiers.includes(item)
                    )),
        }))
    }

    const selectKey = (key: TerminalMainKey) => {
        setDraft((current) => ({ ...current, key }))
    }

    return (
        <AppDialog open={props.open} onOpenChange={props.onOpenChange}>
            <AppDialogContent presentation="sheet" className="max-w-xl">
                <AppDialogHeader
                    title={t('terminal.keys.pickTitle')}
                    subtitle={t('terminal.keys.pickSubtitle')}
                />
                <AppDialogBody className="flex min-h-0 flex-col">
                    <div className="border-b border-[var(--app-border)] px-3 py-2.5">
                        <div className="mb-2 min-h-8 overflow-hidden">
                            {previewChord ? (
                                <TerminalKeyTokenList chord={previewChord} compact />
                            ) : (
                                <span className="text-xs text-[var(--app-hint)]">
                                    {t('terminal.keys.empty')}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {MODIFIERS.map((modifier) => {
                                const selected = draft.modifiers.includes(modifier.id)
                                return (
                                    <button
                                        key={modifier.id}
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => toggleModifier(modifier.id)}
                                        className={`min-h-11 rounded-lg border px-3 text-xs font-bold transition-colors motion-reduce:transition-none ${
                                            selected
                                                ? 'border-violet-500/50 bg-violet-500/15 text-violet-600 dark:text-violet-200'
                                                : 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)]'
                                        }`}
                                    >
                                        {modifier.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div
                        role="tablist"
                        aria-label={t('terminal.keys.groups')}
                        className="mx-3 mt-3 grid grid-cols-4 gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-1"
                    >
                        {GROUPS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={group === item.id}
                                onClick={() => setGroup(item.id)}
                                className={`min-h-9 rounded-lg px-1 text-[10px] font-bold transition-colors motion-reduce:transition-none ${
                                    group === item.id
                                        ? 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] shadow-sm'
                                        : 'text-[var(--app-hint)]'
                                }`}
                            >
                                {t(item.labelKey)}
                            </button>
                        ))}
                    </div>

                    <div
                        role="tabpanel"
                        className="grid min-h-0 flex-1 grid-cols-4 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-6"
                    >
                        {TERMINAL_KEY_GROUPS[group].map((key) => {
                            const selected = draft.key?.id === key.id
                            return (
                                <button
                                    key={key.id}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => selectKey(key)}
                                    className={`min-h-11 rounded-lg border px-1 text-[11px] font-extrabold transition-colors motion-reduce:transition-none ${
                                        selected
                                            ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-600 dark:text-cyan-200'
                                            : 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                    }`}
                                >
                                    {key.pickerLabel}
                                </button>
                            )
                        })}
                    </div>
                    {draft.key && !supported ? (
                        <p role="alert" className="px-3 pb-2 text-xs text-amber-600 dark:text-amber-300">
                            {t('terminal.keys.unsupported')}
                        </p>
                    ) : null}
                </AppDialogBody>
                <AppDialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('button.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!supported}
                        onClick={() => {
                            if (!isDraftSupported(draft)) {
                                return
                            }
                            props.onApply({
                                modifiers: [...draft.modifiers],
                                key: draft.key,
                            })
                            props.onOpenChange(false)
                        }}
                    >
                        {t('terminal.keys.apply')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
