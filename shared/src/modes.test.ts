import { describe, expect, test } from 'bun:test'
import {
    AGENT_FLAVORS,
    CREATABLE_AGENT_FLAVORS,
    getPermissionModeLabel,
    getPermissionModeOptionsForFlavor,
    getPermissionModeTone,
    getPermissionModesForFlavor,
    isPermissionModeAllowedForFlavor,
} from './modes'

describe('Gemini CLI sunset (read-only, not creatable)', () => {
    test('gemini stays a valid flavor so existing stored sessions still validate/load', () => {
        expect(AGENT_FLAVORS).toContain('gemini')
    })

    test('gemini is excluded from creatable flavors (not offered for new sessions)', () => {
        expect(CREATABLE_AGENT_FLAVORS).not.toContain('gemini')
    })

    test('all other flavors remain creatable', () => {
        for (const flavor of AGENT_FLAVORS) {
            if (flavor === 'gemini') continue
            expect(CREATABLE_AGENT_FLAVORS).toContain(flavor)
        }
    })

    test('gemini still resolves permission modes (existing sessions can still change permission mode)', () => {
        expect(getPermissionModesForFlavor('gemini').length).toBeGreaterThan(0)
    })
})

describe('getPermissionModesForFlavor', () => {
    test('returns CLAUDE_PERMISSION_MODES for undefined/claude', () => {
        expect(getPermissionModesForFlavor()).toEqual(getPermissionModesForFlavor('claude'))
    })

    test('returns codex-specific modes for codex', () => {
        expect(getPermissionModesForFlavor('codex')).toContain('read-only')
    })

    test("returns [] for flavor 'pi' (RPC mode has no runtime permission switching)", () => {
        expect(getPermissionModesForFlavor('pi')).toEqual([])
    })

    test('pi does not fall back to Claude modes (opt-in empty, not silently inherited)', () => {
        expect(getPermissionModesForFlavor('pi')).not.toEqual(getPermissionModesForFlavor('claude'))
        expect(getPermissionModesForFlavor('pi')).not.toEqual(getPermissionModesForFlavor(null))
    })

    test('returns grok-specific modes for grok', () => {
        expect(getPermissionModesForFlavor('grok')).toEqual(['default', 'plan', 'bypassPermissions'])
    })
})

describe('getPermissionModeOptionsForFlavor / label / tone', () => {
    test('every option has a label and tone', () => {
        for (const option of getPermissionModeOptionsForFlavor('claude')) {
            expect(getPermissionModeLabel(option.mode)).toBe(option.label)
            expect(getPermissionModeTone(option.mode)).toBe(option.tone)
        }
    })
})

describe('isPermissionModeAllowedForFlavor', () => {
    test('yolo is allowed for gemini', () => {
        expect(isPermissionModeAllowedForFlavor('yolo', 'gemini')).toBe(true)
    })

    test('plan is not allowed for gemini', () => {
        expect(isPermissionModeAllowedForFlavor('plan', 'gemini')).toBe(false)
    })

    test('plan and bypassPermissions are allowed for grok, but read-only/yolo are not', () => {
        expect(isPermissionModeAllowedForFlavor('plan', 'grok')).toBe(true)
        expect(isPermissionModeAllowedForFlavor('bypassPermissions', 'grok')).toBe(true)
        expect(isPermissionModeAllowedForFlavor('read-only', 'grok')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('yolo', 'grok')).toBe(false)
    })

    test('no mode is allowed for pi', () => {
        expect(isPermissionModeAllowedForFlavor('yolo', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('default', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('plan', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('bypassPermissions', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('read-only', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('safe-yolo', 'pi')).toBe(false)
        expect(isPermissionModeAllowedForFlavor('ask', 'pi')).toBe(false)
    })

    test("cursor includes autoReview", () => {
        expect(getPermissionModesForFlavor('cursor')).toContain('autoReview')
        expect(getPermissionModeLabel('autoReview')).toBe('Auto-review')
        expect(getPermissionModeTone('autoReview')).toBe('warning')
        expect(isPermissionModeAllowedForFlavor('autoReview', 'cursor')).toBe(true)
        expect(isPermissionModeAllowedForFlavor('autoReview', 'claude')).toBe(false)
    })
})
    })
})
