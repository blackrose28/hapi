import { describe, expect, it } from 'vitest'
import {
    formatTerminalKeyChord,
    getTerminalKey,
    normalizeTerminalKeyChord,
    terminalKeyChordIdentity,
    TERMINAL_KEY_GROUPS,
} from './terminalKeyChord'

describe('terminalKeyChord', () => {
    it('normalizes modifiers and rebuilds the canonical main key', () => {
        const chord = normalizeTerminalKeyChord({
            modifiers: ['shift', 'ctrl', 'shift'],
            key: { id: 'digit-6', label: 'wrong', kind: 'character' },
        })

        expect(chord).toEqual({
            modifiers: ['ctrl', 'shift'],
            key: getTerminalKey('digit-6'),
        })
        expect(terminalKeyChordIdentity(chord!)).toBe('ctrl+shift:digit-6')
        expect(formatTerminalKeyChord(chord!)).toBe('Ctrl + Shift + 6')
    })

    it('rejects unknown keys and invalid modifiers', () => {
        expect(normalizeTerminalKeyChord({
            modifiers: [],
            key: { id: 'unknown', label: '?', kind: 'character' },
        })).toBeNull()
        expect(normalizeTerminalKeyChord({
            modifiers: ['meta'],
            key: { id: 'digit-6', label: '6', kind: 'character' },
        })).toBeNull()
    })

    it('contains every approved picker group', () => {
        expect(Object.keys(TERMINAL_KEY_GROUPS)).toEqual([
            'basic',
            'alphanumeric',
            'function',
            'symbol',
        ])
        expect(TERMINAL_KEY_GROUPS.basic.map((key) => key.id)).toEqual([
            'escape',
            'tab',
            'enter',
            'backspace',
            'home',
            'end',
            'page-up',
            'page-down',
            'arrow-left',
            'arrow-up',
            'arrow-down',
            'arrow-right',
        ])
        expect(TERMINAL_KEY_GROUPS.alphanumeric).toHaveLength(36)
        expect(TERMINAL_KEY_GROUPS.function).toHaveLength(12)
        expect(TERMINAL_KEY_GROUPS.symbol).toHaveLength(11)
    })

    it('exposes US-key shifted metadata without changing the badge label', () => {
        expect(getTerminalKey('digit-6')).toMatchObject({
            label: '6',
            base: '6',
            shifted: '^',
        })
        expect(getTerminalKey('backslash')).toMatchObject({
            label: '\\',
            pickerLabel: '\\  |',
            shifted: '|',
        })
    })
})
