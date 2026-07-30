import { describe, expect, it } from 'vitest'
import { getTerminalKey, type TerminalKeyChord, type TerminalModifier } from './terminalKeyChord'
import { encodeTerminalKeyChord } from './terminalKeyEncoder'

function chord(modifiers: TerminalModifier[], keyId: string): TerminalKeyChord {
    const key = getTerminalKey(keyId)
    if (!key) {
        throw new Error(`Missing test key: ${keyId}`)
    }
    return { modifiers, key }
}

describe('encodeTerminalKeyChord', () => {
    it.each([
        [chord(['ctrl'], 'letter-c'), '\x03'],
        [chord(['ctrl', 'shift'], 'digit-6'), '\x1e'],
        [chord(['shift'], 'tab'), '\x1b[Z'],
        [chord(['alt'], 'arrow-up'), '\x1b[1;3A'],
        [chord(['ctrl', 'shift'], 'f10'), '\x1b[21;6~'],
        [chord([], 'f1'), '\x1bOP'],
        [chord(['ctrl'], 'f1'), '\x1b[1;5P'],
        [chord([], 'page-down'), '\x1b[6~'],
        [chord(['shift'], 'page-up'), '\x1b[5;2~'],
        [chord(['alt'], 'letter-x'), '\x1bx'],
        [chord(['shift'], 'digit-1'), '!'],
        [chord(['alt', 'ctrl'], 'bracket-left'), '\x1b\x1b'],
        [chord([], 'enter'), '\r'],
        [chord(['alt'], 'backspace'), '\x1b\x7f'],
    ])('encodes %o', (input, expected) => {
        expect(encodeTerminalKeyChord(input)).toEqual({
            ok: true,
            sequence: expected,
        })
    })

    it.each([
        chord(['ctrl'], 'enter'),
        chord(['shift'], 'escape'),
        chord(['ctrl'], 'tab'),
        chord(['shift'], 'backspace'),
        chord(['ctrl'], 'digit-1'),
    ])('rejects modifiers that cannot be represented for %o', (input) => {
        expect(encodeTerminalKeyChord(input)).toEqual({
            ok: false,
            reason: 'unsupported',
        })
    })

    it('rejects a non-canonical key and does not mutate the caller input', () => {
        const input = chord(['shift', 'ctrl'], 'digit-6')
        const before = structuredClone(input)
        input.key = { ...input.key, id: 'unknown' }

        expect(encodeTerminalKeyChord(input)).toEqual({
            ok: false,
            reason: 'invalid',
        })
        expect(input).toEqual({ ...before, key: { ...before.key, id: 'unknown' } })
    })
})
