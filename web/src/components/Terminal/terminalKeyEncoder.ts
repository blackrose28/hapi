import {
    normalizeTerminalKeyChord,
    type TerminalKeyChord,
    type TerminalMainKey,
    type TerminalModifier,
} from './terminalKeyChord'

export type TerminalKeyEncodingResult =
    | { ok: true; sequence: string }
    | { ok: false; reason: 'invalid' | 'unsupported' }

const CONTROL_CHARACTERS: Readonly<Record<string, string>> = {
    '@': '\x00',
    '[': '\x1b',
    '\\': '\x1c',
    ']': '\x1d',
    '^': '\x1e',
    '_': '\x1f',
    '?': '\x7f',
}

const NAVIGATION_KEYS: Readonly<Record<string, { code: string; tilde?: boolean }>> = {
    'arrow-up': { code: 'A' },
    'arrow-down': { code: 'B' },
    'arrow-right': { code: 'C' },
    'arrow-left': { code: 'D' },
    home: { code: 'H' },
    end: { code: 'F' },
    'page-up': { code: '5', tilde: true },
    'page-down': { code: '6', tilde: true },
}

const FUNCTION_TILDE_CODES = [15, 17, 18, 19, 20, 21, 23, 24] as const
const FUNCTION_SS3_CODES = ['P', 'Q', 'R', 'S'] as const

function modifierParameter(modifiers: readonly TerminalModifier[]): number {
    return 1
        + (modifiers.includes('shift') ? 1 : 0)
        + (modifiers.includes('alt') ? 2 : 0)
        + (modifiers.includes('ctrl') ? 4 : 0)
}

function withAltPrefix(sequence: string, modifiers: readonly TerminalModifier[]): string {
    return modifiers.includes('alt') ? `\x1b${sequence}` : sequence
}

function encodeControlKey(
    key: TerminalMainKey,
    modifiers: readonly TerminalModifier[],
): TerminalKeyEncodingResult {
    const hasCtrl = modifiers.includes('ctrl')
    const hasShift = modifiers.includes('shift')

    if (key.id === 'tab') {
        if (hasCtrl) {
            return { ok: false, reason: 'unsupported' }
        }
        const sequence = hasShift ? '\x1b[Z' : '\t'
        return { ok: true, sequence: withAltPrefix(sequence, modifiers) }
    }

    if (hasCtrl || hasShift) {
        return { ok: false, reason: 'unsupported' }
    }

    const sequences: Readonly<Record<string, string>> = {
        escape: '\x1b',
        enter: '\r',
        backspace: '\x7f',
    }
    const sequence = sequences[key.id]
    return sequence
        ? { ok: true, sequence: withAltPrefix(sequence, modifiers) }
        : { ok: false, reason: 'unsupported' }
}

function ctrlCharacter(character: string): string | null {
    const upper = character.toUpperCase()
    const code = upper.charCodeAt(0)
    if (upper.length === 1 && code >= 65 && code <= 90) {
        return String.fromCharCode(code - 64)
    }
    return CONTROL_CHARACTERS[character] ?? null
}

function encodeCharacterKey(
    key: TerminalMainKey,
    modifiers: readonly TerminalModifier[],
): TerminalKeyEncodingResult {
    if (key.base === undefined) {
        return { ok: false, reason: 'invalid' }
    }
    let sequence = modifiers.includes('shift')
        ? (key.shifted ?? key.base.toUpperCase())
        : key.base
    if (modifiers.includes('ctrl')) {
        const mapped = ctrlCharacter(sequence)
        if (mapped === null) {
            return { ok: false, reason: 'unsupported' }
        }
        sequence = mapped
    }
    return {
        ok: true,
        sequence: withAltPrefix(sequence, modifiers),
    }
}

function encodeNavigationKey(
    key: TerminalMainKey,
    modifiers: readonly TerminalModifier[],
): TerminalKeyEncodingResult {
    const definition = NAVIGATION_KEYS[key.id]
    if (!definition) {
        return { ok: false, reason: 'invalid' }
    }
    if (modifiers.length === 0) {
        return {
            ok: true,
            sequence: definition.tilde
                ? `\x1b[${definition.code}~`
                : `\x1b[${definition.code}`,
        }
    }
    const modifier = modifierParameter(modifiers)
    return {
        ok: true,
        sequence: definition.tilde
            ? `\x1b[${definition.code};${modifier}~`
            : `\x1b[1;${modifier}${definition.code}`,
    }
}

function encodeFunctionKey(
    key: TerminalMainKey,
    modifiers: readonly TerminalModifier[],
): TerminalKeyEncodingResult {
    const number = Number(key.id.slice(1))
    if (!Number.isInteger(number) || number < 1 || number > 12) {
        return { ok: false, reason: 'invalid' }
    }
    if (number <= 4) {
        const code = FUNCTION_SS3_CODES[number - 1]
        return modifiers.length === 0
            ? { ok: true, sequence: `\x1bO${code}` }
            : {
                ok: true,
                sequence: `\x1b[1;${modifierParameter(modifiers)}${code}`,
            }
    }
    const code = FUNCTION_TILDE_CODES[number - 5]
    return modifiers.length === 0
        ? { ok: true, sequence: `\x1b[${code}~` }
        : {
            ok: true,
            sequence: `\x1b[${code};${modifierParameter(modifiers)}~`,
        }
}

export function encodeTerminalKeyChord(chord: TerminalKeyChord): TerminalKeyEncodingResult {
    const normalized = normalizeTerminalKeyChord(chord)
    if (!normalized) {
        return { ok: false, reason: 'invalid' }
    }
    switch (normalized.key.kind) {
        case 'control':
            return encodeControlKey(normalized.key, normalized.modifiers)
        case 'character':
            return encodeCharacterKey(normalized.key, normalized.modifiers)
        case 'navigation':
            return encodeNavigationKey(normalized.key, normalized.modifiers)
        case 'function':
            return encodeFunctionKey(normalized.key, normalized.modifiers)
    }
}
