export type TerminalModifier = 'ctrl' | 'alt' | 'shift'
export type TerminalKeyKind = 'control' | 'character' | 'navigation' | 'function'
export type TerminalKeyGroup = 'basic' | 'alphanumeric' | 'function' | 'symbol'

export type TerminalMainKey = {
    id: string
    label: string
    pickerLabel: string
    kind: TerminalKeyKind
    group: TerminalKeyGroup
    base?: string
    shifted?: string
}

export type TerminalKeyChord = {
    modifiers: TerminalModifier[]
    key: TerminalMainKey
}

export type TerminalKeyChordDraft = {
    modifiers: TerminalModifier[]
    key: TerminalMainKey | null
}

const MODIFIER_ORDER: readonly TerminalModifier[] = ['ctrl', 'alt', 'shift']
const MODIFIER_LABELS: Record<TerminalModifier, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
}

function defineKey(
    key: Omit<TerminalMainKey, 'pickerLabel'> & { pickerLabel?: string },
): TerminalMainKey {
    return Object.freeze({
        ...key,
        pickerLabel: key.pickerLabel ?? key.label,
    })
}

const BASIC_KEYS = [
    defineKey({ id: 'escape', label: 'Esc', kind: 'control', group: 'basic' }),
    defineKey({ id: 'tab', label: 'Tab', kind: 'control', group: 'basic' }),
    defineKey({ id: 'enter', label: 'Enter', kind: 'control', group: 'basic' }),
    defineKey({ id: 'backspace', label: '⌫', pickerLabel: 'Backspace', kind: 'control', group: 'basic' }),
    defineKey({ id: 'home', label: 'Home', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'end', label: 'End', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'page-up', label: 'PgUp', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'page-down', label: 'PgDn', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'arrow-left', label: '←', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'arrow-up', label: '↑', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'arrow-down', label: '↓', kind: 'navigation', group: 'basic' }),
    defineKey({ id: 'arrow-right', label: '→', kind: 'navigation', group: 'basic' }),
] as const

const LETTER_KEYS = Array.from({ length: 26 }, (_, index) => {
    const upper = String.fromCharCode(65 + index)
    return defineKey({
        id: `letter-${upper.toLowerCase()}`,
        label: upper,
        kind: 'character',
        group: 'alphanumeric',
        base: upper.toLowerCase(),
        shifted: upper,
    })
})

const SHIFTED_DIGITS = [')', '!', '@', '#', '$', '%', '^', '&', '*', '('] as const
const DIGIT_KEYS = Array.from({ length: 10 }, (_, digit) => defineKey({
    id: `digit-${digit}`,
    label: String(digit),
    pickerLabel: `${digit}  ${SHIFTED_DIGITS[digit]}`,
    kind: 'character',
    group: 'alphanumeric',
    base: String(digit),
    shifted: SHIFTED_DIGITS[digit],
}))

const FUNCTION_KEYS = Array.from({ length: 12 }, (_, index) => defineKey({
    id: `f${index + 1}`,
    label: `F${index + 1}`,
    kind: 'function',
    group: 'function',
}))

const SYMBOL_PAIRS = [
    ['backquote', '`', '~'],
    ['minus', '-', '_'],
    ['equal', '=', '+'],
    ['bracket-left', '[', '{'],
    ['bracket-right', ']', '}'],
    ['backslash', '\\', '|'],
    ['semicolon', ';', ':'],
    ['quote', "'", '"'],
    ['comma', ',', '<'],
    ['period', '.', '>'],
    ['slash', '/', '?'],
] as const

const SYMBOL_KEYS = SYMBOL_PAIRS.map(([id, base, shifted]) => defineKey({
    id,
    label: base,
    pickerLabel: `${base}  ${shifted}`,
    kind: 'character',
    group: 'symbol',
    base,
    shifted,
}))

export const TERMINAL_KEY_GROUPS = Object.freeze({
    basic: BASIC_KEYS,
    alphanumeric: Object.freeze([...LETTER_KEYS, ...DIGIT_KEYS]),
    function: Object.freeze(FUNCTION_KEYS),
    symbol: Object.freeze(SYMBOL_KEYS),
})

const TERMINAL_KEYS = new Map<string, TerminalMainKey>(
    Object.values(TERMINAL_KEY_GROUPS)
        .flat()
        .map((key) => [key.id, key]),
)

export function getTerminalKey(id: string): TerminalMainKey | undefined {
    return TERMINAL_KEYS.get(id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isTerminalModifier(value: unknown): value is TerminalModifier {
    return value === 'ctrl' || value === 'alt' || value === 'shift'
}

export function normalizeTerminalModifiers(values: readonly unknown[]): TerminalModifier[] | null {
    if (!values.every(isTerminalModifier)) {
        return null
    }
    const selected = new Set(values)
    return MODIFIER_ORDER.filter((modifier) => selected.has(modifier))
}

export function normalizeTerminalKeyChord(value: unknown): TerminalKeyChord | null {
    if (!isRecord(value) || !Array.isArray(value.modifiers) || !isRecord(value.key)) {
        return null
    }
    const modifiers = normalizeTerminalModifiers(value.modifiers)
    const key = typeof value.key.id === 'string'
        ? getTerminalKey(value.key.id)
        : undefined
    if (!modifiers || !key) {
        return null
    }
    return { modifiers, key }
}

export function terminalKeyChordIdentity(chord: TerminalKeyChord): string {
    return `${chord.modifiers.join('+')}:${chord.key.id}`
}

export function formatTerminalKeyChord(chord: TerminalKeyChord): string {
    return [
        ...chord.modifiers.map((modifier) => MODIFIER_LABELS[modifier]),
        chord.key.label,
    ].join(' + ')
}
