import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'
import { useTranslation } from '@/lib/use-translation'
import type { TerminalKeyChord } from './terminalKeyChord'
import type {
    DeletedSavedTerminalKeyChord,
    SavedTerminalKeyChord,
} from './terminalKeyChordStore'
import { TerminalKeyTokenList } from './TerminalKeyPickerDialog'

export function TerminalSavedKeyDialog(props: {
    open: boolean
    items: SavedTerminalKeyChord[]
    onOpenChange: (open: boolean) => void
    onLoad: (chord: TerminalKeyChord) => void
    onDelete: (id: string) => DeletedSavedTerminalKeyChord | null
    onRestore: (deleted: DeletedSavedTerminalKeyChord) => void
}) {
    const { t } = useTranslation()
    const [undo, setUndo] = useState<DeletedSavedTerminalKeyChord | null>(null)
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearUndo = () => {
        if (undoTimer.current) {
            clearTimeout(undoTimer.current)
            undoTimer.current = null
        }
        setUndo(null)
    }

    useEffect(() => {
        if (!props.open) {
            clearUndo()
        }
        return () => {
            if (undoTimer.current) {
                clearTimeout(undoTimer.current)
                undoTimer.current = null
            }
        }
    }, [props.open])

    const handleDelete = (id: string) => {
        const deleted = props.onDelete(id)
        if (!deleted) {
            return
        }
        if (undoTimer.current) {
            clearTimeout(undoTimer.current)
        }
        setUndo(deleted)
        undoTimer.current = setTimeout(() => {
            setUndo(null)
            undoTimer.current = null
        }, 5_000)
    }

    return (
        <AppDialog open={props.open} onOpenChange={props.onOpenChange}>
            <AppDialogContent presentation="sheet" className="max-w-xl">
                <AppDialogHeader
                    title={t('terminal.keys.savedTitle')}
                    subtitle={t('terminal.keys.savedSubtitle', { count: props.items.length })}
                />
                <AppDialogBody className="min-h-0 overflow-y-auto p-3">
                    {props.items.length === 0 ? (
                        <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-[var(--app-border)] px-4 text-center text-xs text-[var(--app-hint)]">
                            {t('terminal.keys.emptySaved')}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {props.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex min-h-[58px] items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-2"
                                >
                                    <span className="min-w-0 flex-1 overflow-hidden">
                                        <TerminalKeyTokenList chord={item.chord} compact />
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            props.onLoad(item.chord)
                                            props.onOpenChange(false)
                                        }}
                                        className="min-h-10 shrink-0 rounded-lg border border-violet-500/50 bg-violet-500/10 px-3 text-[10px] font-extrabold text-violet-600 dark:text-violet-200"
                                    >
                                        {t('terminal.keys.load')}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={t('terminal.keys.delete')}
                                        onClick={() => handleDelete(item.id)}
                                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-rose-500/25 bg-rose-500/5 text-rose-500"
                                    >
                                        <svg
                                            aria-hidden="true"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            className="h-4 w-4"
                                        >
                                            <path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </AppDialogBody>
                {undo ? (
                    <div
                        role="status"
                        className="mx-3 mb-2 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 text-xs text-[var(--app-fg)]"
                    >
                        <span>{t('terminal.keys.deleted')}</span>
                        <button
                            type="button"
                            className="min-h-9 rounded-md px-2 font-bold text-violet-600 dark:text-violet-200"
                            onClick={() => {
                                props.onRestore(undo)
                                clearUndo()
                            }}
                        >
                            {t('terminal.keys.undo')}
                        </button>
                    </div>
                ) : null}
                <AppDialogFooter className="justify-between">
                    <span className="flex items-center gap-2 text-[10px] text-[var(--app-hint)]">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {t('terminal.keys.localOnly')}
                    </span>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('button.close')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
