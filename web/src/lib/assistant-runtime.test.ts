import { describe, expect, it } from 'vitest'
import type { AgentReasoningBlock, CliOutputBlock } from '@/chat/types'
import { CLI_OUTPUT_TOOL_NAME } from '@/lib/cliOutputPart'
import { REASONING_TOOL_NAME } from '@/lib/reasoningPart'
import { toThreadMessageLike } from '@/lib/assistant-runtime'

function cli(source: CliOutputBlock['source']): CliOutputBlock {
    return {
        kind: 'cli-output',
        id: `cli-${source}`,
        localId: null,
        createdAt: 1000,
        text: 'Exit code: 0\nOutput:\nready',
        source,
        meta: null
    }
}

describe('toThreadMessageLike CLI output', () => {
    it('encodes assistant CLI as a dedicated tool-call part', () => {
        const message = toThreadMessageLike(cli('assistant'))

        expect(message.role).toBe('assistant')
        expect(message.content).toEqual([expect.objectContaining({
            type: 'tool-call',
            toolName: CLI_OUTPUT_TOOL_NAME,
            result: 'Exit code: 0\nOutput:\nready',
            artifact: cli('assistant')
        })])
    })

    it('keeps user CLI as a user text message', () => {
        const message = toThreadMessageLike(cli('user'))

        expect(message.role).toBe('user')
        expect(message.content).toEqual([{ type: 'text', text: 'Exit code: 0\nOutput:\nready' }])
    })
})

describe('toThreadMessageLike agent reasoning', () => {
    it('encodes reasoning as a stable presentation tool-call', () => {
        const reasoning: AgentReasoningBlock = {
            kind: 'agent-reasoning',
            id: 'reason-1',
            localId: null,
            createdAt: 1000,
            text: 'reasoning body'
        }

        const message = toThreadMessageLike(reasoning)

        expect(message).toEqual(expect.objectContaining({
            role: 'assistant',
            id: 'assistant:reason-1',
            content: [expect.objectContaining({
                type: 'tool-call',
                toolCallId: 'reasoning:reason-1',
                toolName: REASONING_TOOL_NAME,
                argsText: '',
                result: 'reasoning body',
                artifact: reasoning
            })]
        }))
    })
})
