import { describe, expect, it } from 'vitest'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { getAssistantCopyText } from '@/components/AssistantChat/messages/assistantCopyText'
import { REASONING_TOOL_NAME } from '@/lib/reasoningPart'

describe('getAssistantCopyText', () => {
    it('joins assistant text parts and ignores non-text parts', () => {
        const parts = [
            { type: 'text', text: 'First paragraph.' },
            { type: 'reasoning', text: 'Hidden chain of thought' },
            {
                type: 'tool-call',
                toolCallId: 'reasoning:reason-1',
                toolName: REASONING_TOOL_NAME,
                args: {},
                argsText: '',
                result: 'Pseudo reasoning'
            },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'search', args: {}, argsText: '{}' },
            { type: 'text', text: 'Second paragraph.' }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts)).toBe('First paragraph.\n\nSecond paragraph.')
    })

    it('returns empty string when no assistant text exists', () => {
        const parts = [
            { type: 'reasoning', text: 'Thinking' },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'search', args: {}, argsText: '{}' }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts)).toBe('')
    })
})
