import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it } from 'vitest'
import { mergeCapabilityNames, normalizeCapabilityName, sameCapabilityNames, toProviderCommandName } from './capabilities'

describe('normalizeCapabilityName', () => {
    it('trims strings and returns null for empty or non-string values', () => {
        expect(normalizeCapabilityName('  Bash  ')).toBe('Bash')
        expect(normalizeCapabilityName('   ')).toBeNull()
        expect(normalizeCapabilityName('')).toBeNull()
        expect(normalizeCapabilityName(null)).toBeNull()
        expect(normalizeCapabilityName(123)).toBeNull()
    })
})

describe('mergeCapabilityNames', () => {
    it('normalizes existing and incoming names, dedupes, and sorts', () => {
        expect(mergeCapabilityNames([' write ', 'Read', '', 'Read'], ['Bash', ' read ', null, 'Edit'])).toEqual([
            'Bash',
            'Edit',
            'Read',
            'read',
            'write',
        ])
    })

    it('handles undefined inputs as empty lists', () => {
        expect(mergeCapabilityNames(undefined, undefined)).toEqual([])
    })
})


describe('sameCapabilityNames', () => {
    it('compares normalized capability sets independent of order and duplicates', () => {
        expect(sameCapabilityNames([' write ', 'Read', 'Read'], ['Read', 'write'])).toBe(true)
        expect(sameCapabilityNames(['Read'], ['Read', 'Write'])).toBe(false)
    })

    it('treats missing and blank-only lists as equal', () => {
        expect(sameCapabilityNames(undefined, [])).toBe(true)
        expect(sameCapabilityNames(['   '], undefined)).toBe(true)
    })
})

describe('toProviderCommandName', () => {
    it('prefixes normalized opencode and gemini commands', () => {
        expect(toProviderCommandName('opencode', '  plan  ')).toBe('opencode:plan')
        expect(toProviderCommandName('gemini', '  help  ')).toBe('gemini:help')
    })

    it('returns null for blank or non-string command names', () => {
        expect(toProviderCommandName('opencode', '   ')).toBeNull()
        expect(toProviderCommandName('gemini', undefined)).toBeNull()
    })
})
