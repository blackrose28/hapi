import { describe, expect, it } from 'vitest'
import { getModelOptionsForFlavor, getNextModelForFlavor } from './modelOptions'

describe('getModelOptionsForFlavor', () => {
    it('returns Gemini model options for gemini flavor', () => {
        const options = getModelOptionsForFlavor('gemini')
        expect(options[0]).toEqual({ value: null, label: 'Default' })
        expect(options.some((o) => o.value === 'gemini-3-flash-preview')).toBe(true)
        expect(options.some((o) => o.value === 'gemini-2.5-flash')).toBe(true)
    })

    it('returns Claude model options for claude flavor', () => {
        const options = getModelOptionsForFlavor('claude')
        expect(options[0]).toEqual({ value: null, label: 'Default' })
        expect(options.some((o) => o.value === 'sonnet')).toBe(true)
        expect(options.some((o) => o.value === 'opus')).toBe(true)
    })

    it('uses a dynamic Claude catalog and preserves an unknown current model', () => {
        const options = getModelOptionsForFlavor('claude', 'claude-legacy', [
            { value: null, label: 'Default' },
            { value: 'claude-custom', label: 'Claude Custom' }
        ])

        expect(options).toEqual([
            { value: null, label: 'Default' },
            { value: 'claude-legacy', label: 'claude-legacy' },
            { value: 'claude-custom', label: 'Claude Custom' }
        ])
    })

    it('includes custom Gemini model from env/config in options', () => {
        const options = getModelOptionsForFlavor('gemini', 'gemini-custom-experiment')
        expect(options.some((o) => o.value === 'gemini-custom-experiment')).toBe(true)
    })

    it('does not duplicate a preset Gemini model', () => {
        const options = getModelOptionsForFlavor('gemini', 'gemini-2.5-flash')
        const flashCount = options.filter((o) => o.value === 'gemini-2.5-flash').length
        expect(flashCount).toBe(1)
    })

    it('includes the current custom model when it is missing from explicit options', () => {
        const options = getModelOptionsForFlavor('codex', 'gpt-legacy', [
            { value: 'gpt-5.5', label: 'GPT-5.5' }
        ])
        expect(options).toEqual([
            { value: 'gpt-legacy', label: 'gpt-legacy' },
            { value: 'gpt-5.5', label: 'GPT-5.5' }
        ])
    })

    it('does not fall back to Claude models for Codex before provider models are discovered', () => {
        const options = getModelOptionsForFlavor('codex', null)
        expect(options).toEqual([])
    })

    it('returns the current Codex model before provider models are discovered', () => {
        const options = getModelOptionsForFlavor('codex', 'gpt-5.5')
        expect(options).toEqual([
            { value: 'gpt-5.5', label: 'gpt-5.5' }
        ])
    })

    it('returns only the supplied custom options for opencode flavor (no claude fallback)', () => {
        const options = getModelOptionsForFlavor('opencode', null, [
            { value: 'ollama/exaone:4.5-33b-q8', label: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
            { value: 'mlx/qwen3:0.6b', label: 'MLX/Qwen3 0.6B' }
        ])
        expect(options).toEqual([
            { value: 'ollama/exaone:4.5-33b-q8', label: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
            { value: 'mlx/qwen3:0.6b', label: 'MLX/Qwen3 0.6B' }
        ])
    })

    it('returns an empty list for opencode flavor before models are discovered (no claude fallback)', () => {
        const options = getModelOptionsForFlavor('opencode', null)
        expect(options).toEqual([])
    })

    it('returns the current opencode model before models are discovered (no claude fallback)', () => {
        const options = getModelOptionsForFlavor('opencode', 'ollama/exaone:4.5-33b-q8')
        expect(options).toEqual([
            { value: 'ollama/exaone:4.5-33b-q8', label: 'ollama/exaone:4.5-33b-q8' }
        ])
    })

    it('includes the current opencode model when it is missing from explicit options', () => {
        const options = getModelOptionsForFlavor('opencode', 'ollama/legacy', [
            { value: 'ollama/exaone:4.5-33b-q8', label: 'Ollama EXAONE' }
        ])
        expect(options).toEqual([
            { value: 'ollama/legacy', label: 'ollama/legacy' },
            { value: 'ollama/exaone:4.5-33b-q8', label: 'Ollama EXAONE' }
        ])
    })
})

describe('getNextModelForFlavor', () => {
    it('cycles Gemini models', () => {
        const next = getNextModelForFlavor('gemini', null)
        expect(next).not.toBeNull()
    })

    it('cycles Claude models', () => {
        const next = getNextModelForFlavor('claude', null)
        expect(next).not.toBeNull()
    })

    it('cycles explicit model options', () => {
        const next = getNextModelForFlavor('codex', 'gpt-5.5', [
            { value: 'gpt-5.5', label: 'GPT-5.5' },
            { value: 'gpt-5.4', label: 'GPT-5.4' }
        ])
        expect(next).toBe('gpt-5.4')
    })

    it('does not choose auto when cycling explicit Codex model options from an unknown current model', () => {
        const next = getNextModelForFlavor('codex', 'gpt-legacy', [
            { value: 'gpt-5.5', label: 'GPT-5.5' },
            { value: 'gpt-5.4', label: 'GPT-5.4' }
        ])
        expect(next).toBe('gpt-5.5')
    })

    it('keeps the current Codex model when provider models have not loaded', () => {
        const next = getNextModelForFlavor('codex', 'gpt-5.5')
        expect(next).toBe('gpt-5.5')
    })

    it('keeps the current opencode model when the dynamic list has not loaded (undefined customOptions)', () => {
        const next = getNextModelForFlavor('opencode', 'ollama/exaone:4.5-33b-q8')
        expect(next).toBe('ollama/exaone:4.5-33b-q8')
    })

    it('keeps the current opencode model when the dynamic list is empty', () => {
        const next = getNextModelForFlavor('opencode', 'ollama/exaone:4.5-33b-q8', [])
        expect(next).toBe('ollama/exaone:4.5-33b-q8')
    })

    it('returns null for opencode without a current model and without dynamic options (no Claude fallback)', () => {
        const next = getNextModelForFlavor('opencode', null, [])
        expect(next).toBeNull()
    })
})
