import { useCallback, useEffect, useRef, useState } from 'react'

export type QuickInput = {
    label: string
    sequence?: string
    description: string
    modifier?: 'ctrl' | 'alt'
    popup?: {
        label: string
        sequence: string
        description: string
    }
}

export type ModifierState = {
    ctrl: boolean
    alt: boolean
}

export type TerminalQuickInput = {
    ctrlActive: boolean
    altActive: boolean
    sendQuickInput: (sequence: string) => boolean
    toggleModifier: (modifier: 'ctrl' | 'alt') => void
    writePlainInput: (text: string) => boolean
    writeTerminalData: (text: string) => void
}

export const QUICK_INPUT_ROWS: Array<{ label: string; keys: QuickInput[] }> = [
    {
        label: 'Terminal modifier keys',
        keys: [
            { label: 'Esc', sequence: '\u001b', description: 'Escape' },
            { label: 'Tab', sequence: '\t', description: 'Tab' },
            { label: 'Ctrl', description: 'Control', modifier: 'ctrl' },
            { label: 'Alt', description: 'Alternate', modifier: 'alt' },
        ],
    },
    {
        label: 'Terminal arrow keys',
        keys: [
            { label: '←', sequence: '\u001b[D', description: 'Arrow left' },
            { label: '↑', sequence: '\u001b[A', description: 'Arrow up' },
            { label: '↓', sequence: '\u001b[B', description: 'Arrow down' },
            { label: '→', sequence: '\u001b[C', description: 'Arrow right' },
        ],
    },
]

export const ADVANCED_KEY_GROUPS: Array<{ label: string; keys: QuickInput[] }> = [
    {
        label: 'Signals',
        keys: [
            { label: 'Ctrl+D', sequence: '\u0004', description: 'Ctrl+D' },
            { label: 'Ctrl+Z', sequence: '\u001a', description: 'Ctrl+Z' },
            { label: 'Ctrl+L', sequence: '\u000c', description: 'Ctrl+L' },
        ],
    },
    {
        label: 'Navigation',
        keys: [
            { label: 'Home', sequence: '\u001b[H', description: 'Home' },
            { label: 'End', sequence: '\u001b[F', description: 'End' },
            { label: 'PgUp', sequence: '\u001b[5~', description: 'PgUp' },
            { label: 'PgDn', sequence: '\u001b[6~', description: 'PgDn' },
        ],
    },
    {
        label: 'Function keys',
        keys: [
            { label: 'F1', sequence: '\u001bOP', description: 'F1' },
            { label: 'F2', sequence: '\u001bOQ', description: 'F2' },
            { label: 'F3', sequence: '\u001bOR', description: 'F3' },
            { label: 'F4', sequence: '\u001bOS', description: 'F4' },
            { label: 'F5', sequence: '\u001b[15~', description: 'F5' },
            { label: 'F6', sequence: '\u001b[17~', description: 'F6' },
            { label: 'F7', sequence: '\u001b[18~', description: 'F7' },
            { label: 'F8', sequence: '\u001b[19~', description: 'F8' },
            { label: 'F9', sequence: '\u001b[20~', description: 'F9' },
            { label: 'F10', sequence: '\u001b[21~', description: 'F10' },
            { label: 'F11', sequence: '\u001b[23~', description: 'F11' },
            { label: 'F12', sequence: '\u001b[24~', description: 'F12' },
        ],
    },
    {
        label: 'Symbols',
        keys: [
            { label: '/', sequence: '/', description: 'Forward slash' },
            { label: '|', sequence: '|', description: 'Pipe' },
            { label: '~', sequence: '~', description: 'Tilde' },
            { label: '\\', sequence: '\\', description: 'Backslash' },
            { label: '-', sequence: '-', description: 'Hyphen' },
            { label: '_', sequence: '_', description: 'Underscore' },
        ],
    },
]

export function applyTerminalModifierState(sequence: string, state: ModifierState): string {
    let modified = sequence
    if (state.alt) {
        modified = `\u001b${modified}`
    }
    if (state.ctrl && modified.length === 1) {
        const code = modified.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) {
            modified = String.fromCharCode(code - 64)
        }
    }
    return modified
}

function shouldResetModifiers(sequence: string, state: ModifierState): boolean {
    if (!sequence) {
        return false
    }
    return state.ctrl || state.alt
}

export function useTerminalQuickInput(args: {
    disabled: boolean
    write: (text: string) => boolean
}): TerminalQuickInput {
    const modifierStateRef = useRef<ModifierState>({ ctrl: false, alt: false })
    const [ctrlActive, setCtrlActive] = useState(false)
    const [altActive, setAltActive] = useState(false)

    useEffect(() => {
        modifierStateRef.current = { ctrl: ctrlActive, alt: altActive }
    }, [ctrlActive, altActive])

    const resetModifiers = useCallback(() => {
        setCtrlActive(false)
        setAltActive(false)
    }, [])

    const writeWithModifiers = useCallback((sequence: string, state: ModifierState) => {
        const accepted = args.write(applyTerminalModifierState(sequence, state))
        if (shouldResetModifiers(sequence, state)) {
            resetModifiers()
        }
        return accepted
    }, [args, resetModifiers])

    const sendQuickInput = useCallback((sequence: string): boolean => {
        if (!sequence || args.disabled) {
            return false
        }
        return writeWithModifiers(sequence, { ctrl: ctrlActive, alt: altActive })
    }, [args.disabled, ctrlActive, altActive, writeWithModifiers])

    const toggleModifier = useCallback((modifier: 'ctrl' | 'alt') => {
        if (args.disabled) {
            return
        }
        if (modifier === 'ctrl') {
            setCtrlActive((value) => !value)
            setAltActive(false)
        } else {
            setAltActive((value) => !value)
            setCtrlActive(false)
        }
    }, [args])

    const writePlainInput = useCallback((text: string) => {
        if (!text || args.disabled) {
            return false
        }
        const accepted = args.write(text)
        resetModifiers()
        return accepted
    }, [args, resetModifiers])

    const writeTerminalData = useCallback((text: string) => {
        if (!text) {
            return
        }
        writeWithModifiers(text, modifierStateRef.current)
    }, [writeWithModifiers])

    return {
        ctrlActive,
        altActive,
        sendQuickInput,
        toggleModifier,
        writePlainInput,
        writeTerminalData,
    }
}
