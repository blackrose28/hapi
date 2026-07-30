import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTerminalKey, type TerminalKeyChord } from './terminalKeyChord'
import type { DeletedSavedTerminalKeyChord, SavedTerminalKeyChord } from './terminalKeyChordStore'
import { TerminalKeyPickerDialog } from './TerminalKeyPickerDialog'
import { TerminalSavedKeyDialog } from './TerminalSavedKeyDialog'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) => ({
            'button.cancel': 'Cancel',
            'button.close': 'Done',
            'terminal.keys.pickTitle': 'Choose keys',
            'terminal.keys.pickSubtitle': 'Compose a terminal key chord',
            'terminal.keys.apply': 'Apply combination',
            'terminal.keys.basic': 'Basic',
            'terminal.keys.alphanumeric': 'Letters & numbers',
            'terminal.keys.function': 'F1–F12',
            'terminal.keys.symbol': 'Symbols',
            'terminal.keys.savedTitle': 'Saved combinations',
            'terminal.keys.savedSubtitle': `${values?.count ?? 0} on this device`,
            'terminal.keys.load': 'Load',
            'terminal.keys.delete': 'Delete',
            'terminal.keys.undo': 'Undo',
            'terminal.keys.localOnly': 'Stored only on this device',
        }[key] ?? key),
        locale: 'en',
    }),
}))

afterEach(() => cleanup())

function chord(
    keyId: string,
    modifiers: TerminalKeyChord['modifiers'] = [],
): TerminalKeyChord {
    const key = getTerminalKey(keyId)
    if (!key) {
        throw new Error(`Missing test key: ${keyId}`)
    }
    return { modifiers, key }
}

describe('TerminalKeyPickerDialog', () => {
    it('uses the shared sheet and keeps the original chord when cancelled', () => {
        const onApply = vi.fn()
        const onOpenChange = vi.fn()
        render(
            <TerminalKeyPickerDialog
                open
                chord={chord('letter-a', ['ctrl'])}
                onApply={onApply}
                onOpenChange={onOpenChange}
            />,
        )

        expect(screen.getByRole('dialog', { name: 'Choose keys' }))
            .toHaveAttribute('data-app-dialog-presentation', 'sheet')
        fireEvent.click(screen.getByRole('button', { name: 'Shift' }))
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        expect(onApply).not.toHaveBeenCalled()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('selects multiple modifiers and replaces the main key before applying', () => {
        const onApply = vi.fn()
        render(
            <TerminalKeyPickerDialog
                open
                chord={chord('letter-a', ['ctrl'])}
                onApply={onApply}
                onOpenChange={() => undefined}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: 'Shift' }))
        fireEvent.click(screen.getByRole('tab', { name: 'F1–F12' }))
        fireEvent.click(screen.getByRole('button', { name: 'F10' }))
        fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))

        expect(onApply).toHaveBeenCalledWith(chord('f10', ['ctrl', 'shift']))
        expect(onApply).toHaveBeenCalledTimes(1)
    })
})

describe('TerminalSavedKeyDialog', () => {
    const items: SavedTerminalKeyChord[] = [
        { id: 'one', chord: chord('digit-6', ['ctrl', 'shift']), createdAt: 2 },
        { id: 'two', chord: chord('f10', ['ctrl']), createdAt: 1 },
    ]

    it('loads a saved chord without exposing a direct send action', () => {
        const onLoad = vi.fn()
        render(
            <TerminalSavedKeyDialog
                open
                items={items}
                onOpenChange={() => undefined}
                onLoad={onLoad}
                onDelete={() => null}
                onRestore={() => undefined}
            />,
        )

        const dialog = screen.getByRole('dialog', { name: 'Saved combinations' })
        expect(dialog).toHaveAttribute('data-app-dialog-presentation', 'sheet')
        expect(within(dialog).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Load' })[0])
        expect(onLoad).toHaveBeenCalledWith(items[0].chord)
    })

    it('deletes and restores a saved chord through Undo', () => {
        const deleted: DeletedSavedTerminalKeyChord = {
            item: items[0],
            index: 0,
        }
        const onDelete = vi.fn(() => deleted)
        const onRestore = vi.fn()
        render(
            <TerminalSavedKeyDialog
                open
                items={items}
                onOpenChange={() => undefined}
                onLoad={() => undefined}
                onDelete={onDelete}
                onRestore={onRestore}
            />,
        )

        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
        expect(onDelete).toHaveBeenCalledWith('one')

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
        expect(onRestore).toHaveBeenCalledWith(deleted)
    })
})
