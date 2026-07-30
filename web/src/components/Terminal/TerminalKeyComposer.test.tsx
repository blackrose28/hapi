import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTerminalKey, type TerminalKeyChord } from './terminalKeyChord'
import { TERMINAL_KEY_CHORD_STORAGE_KEY } from './terminalKeyChordStore'
import { TerminalKeyComposer } from './TerminalKeyComposer'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string | number>) => ({
            'button.cancel': 'Cancel',
            'button.close': 'Done',
            'terminal.keys.saved': `Saved · ${values?.count ?? 0}`,
            'terminal.keys.manage': 'Manage',
            'terminal.keys.emptySaved': 'No saved combinations yet.',
            'terminal.keys.combination': 'Key combination',
            'terminal.keys.empty': 'No key selected',
            'terminal.keys.groups': 'Key groups',
            'terminal.keys.add': 'Add key',
            'terminal.keys.save': 'Save',
            'terminal.keys.savedSuccess': 'Combination saved.',
            'terminal.keys.clear': 'Clear all',
            'terminal.keys.send': 'Send',
            'terminal.keys.remove': `Remove ${values?.key ?? ''}`,
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
            'terminal.keys.deleted': 'Combination deleted.',
            'terminal.keys.undo': 'Undo',
            'terminal.keys.localOnly': 'Stored only on this device',
            'terminal.keys.duplicate': 'This combination is already saved.',
            'terminal.keys.limit': 'Limit reached.',
            'terminal.keys.unavailable': 'Storage unavailable.',
            'terminal.keys.unsupported': 'Unsupported combination.',
            'terminal.keys.sendFailed': 'Could not send.',
        }[key] ?? key),
        locale: 'en',
    }),
}))

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

function applyChord(
    keyLabel: string,
    options: { ctrl?: boolean; alt?: boolean; shift?: boolean; group?: string } = {},
) {
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
    if (options.ctrl) fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
    if (options.alt) fireEvent.click(screen.getByRole('button', { name: 'Alt' }))
    if (options.shift) fireEvent.click(screen.getByRole('button', { name: 'Shift' }))
    if (options.group) fireEvent.click(screen.getByRole('tab', { name: options.group }))
    fireEvent.click(screen.getByRole('button', { name: keyLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply combination' }))
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    cleanup()
    localStorage.clear()
})

describe('TerminalKeyComposer', () => {
    it('renders a fixed saved rail and one-line composer', () => {
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )

        expect(screen.getByTestId('terminal-saved-key-rail')).toHaveClass('h-[42px]')
        expect(screen.getByTestId('terminal-key-badge-scroll')).toHaveClass(
            'whitespace-nowrap',
            'overflow-x-auto',
        )
        expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    })

    it('loads a saved item into badges without sending', async () => {
        localStorage.setItem(TERMINAL_KEY_CHORD_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: [{
                id: 'saved-one',
                chord: chord('digit-6', ['ctrl', 'shift']),
                createdAt: 1,
            }],
        }))
        const onSend = vi.fn(() => true)
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={onSend}
            />,
        )

        fireEvent.click(await screen.findByRole('button', {
            name: 'Load Ctrl + Shift + 6',
        }))

        expect(screen.getByText('Ctrl')).toBeInTheDocument()
        expect(screen.getByText('Shift')).toBeInTheDocument()
        expect(screen.getByText('6')).toBeInTheDocument()
        expect(onSend).not.toHaveBeenCalled()
    })

    it('sends exactly once and clears only after an accepted write', () => {
        const onSend = vi.fn(() => true)
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={onSend}
            />,
        )
        applyChord('F10', { ctrl: true, shift: true, group: 'F1–F12' })

        expect(onSend).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))

        expect(onSend).toHaveBeenCalledTimes(1)
        expect(onSend).toHaveBeenCalledWith('\x1b[21;6~')
        expect(screen.getByText('No key selected')).toBeInTheDocument()
    })

    it('preserves the draft while hidden and clears it on terminal context change', () => {
        const view = render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )
        applyChord('F10', { ctrl: true, group: 'F1–F12' })

        view.rerender(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible={false}
                onSend={() => true}
            />,
        )
        view.rerender(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )
        expect(screen.getByText('F10')).toBeInTheDocument()

        view.rerender(
            <TerminalKeyComposer
                terminalContextKey="terminal-2"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )
        expect(screen.getByText('No key selected')).toBeInTheDocument()
    })

    it('keeps the draft and reports an error when write is rejected', () => {
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => false}
            />,
        )
        applyChord('C', { ctrl: true, group: 'Letters & numbers' })
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))

        expect(screen.getByText('C')).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('Could not send.')
    })

    it('saves a valid chord once and exposes it through Manage', async () => {
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )
        applyChord('C', { ctrl: true, group: 'Letters & numbers' })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(screen.getByRole('status')).toHaveTextContent('Combination saved.')
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Load Ctrl + C' })).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        expect(screen.getByRole('status')).toHaveTextContent('already saved')

        fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
        expect(screen.getByRole('dialog', { name: 'Saved combinations' })).toBeInTheDocument()
    })

    it('brings an existing saved chord into view when saving a duplicate', async () => {
        localStorage.setItem(TERMINAL_KEY_CHORD_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: [{
                id: 'saved-one',
                chord: chord('letter-c', ['ctrl']),
                createdAt: 1,
            }],
        }))
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )

        const savedButton = await screen.findByRole('button', {
            name: 'Load Ctrl + C',
        })
        const scrollIntoView = vi.fn()
        savedButton.scrollIntoView = scrollIntoView
        fireEvent.click(savedButton)
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(screen.getByRole('status')).toHaveTextContent('already saved')
        expect(scrollIntoView).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
        })
    })

    it('removes badges through labelled trailing controls', () => {
        render(
            <TerminalKeyComposer
                terminalContextKey="terminal-1"
                disabled={false}
                visible
                onSend={() => true}
            />,
        )
        applyChord('F10', { ctrl: true, shift: true, group: 'F1–F12' })

        const removeShift = screen.getByRole('button', { name: 'Remove Shift' })
        expect(removeShift).toHaveClass('h-9', 'w-9', 'shrink-0')
        fireEvent.click(removeShift)

        expect(screen.queryByText('Shift')).not.toBeInTheDocument()
        expect(screen.getByText('F10')).toBeInTheDocument()
    })
})
