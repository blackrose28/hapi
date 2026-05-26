import { describe, expect, it } from 'vitest'
import {
    type BlockWithThreadMessageId,
    assignThreadMessageIds,
    assignThreadMessageIdsWithStableWrappers,
    toThreadMessageLike
} from './assistant-runtime'
import type { AgentReasoningBlock, ChatBlock, CliOutputBlock } from '@/chat/types'
import { REASONING_TOOL_NAME } from '@/lib/reasoningPart'

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

function agentText(id: string): ChatBlock {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt: 1000,
        text: 'agent message'
    }
}

function userText(id: string): ChatBlock {
    return {
        kind: 'user-text',
        id,
        localId: null,
        createdAt: 1000,
        text: 'user message'
    }
}

describe('assignThreadMessageIds', () => {
    it('suffixes duplicate kind+id pairs so assistant-ui never sees repeated thread ids', () => {
        const blocks: ChatBlock[] = [
            agentText('dup'),
            userText('u1'),
            agentText('dup')
        ]

        const assigned = assignThreadMessageIds(blocks)
        expect(assigned.map((entry) => entry.threadMessageId)).toEqual([
            'agent-text:dup',
            'user-text:u1',
            'agent-text:dup~1'
        ])
    })

    it('reuses wrapper objects from a WeakMap cache when block ref and thread id are unchanged', () => {
        const block = agentText('a')
        const cache = new WeakMap<ChatBlock, BlockWithThreadMessageId>()
        const first = assignThreadMessageIdsWithStableWrappers([block], cache)
        const second = assignThreadMessageIdsWithStableWrappers([block, userText('u')], cache)
        expect(second[0]).toBe(first[0])
        expect(second[0].threadMessageId).toBe('agent-text:a')
        expect(second[1].threadMessageId).toBe('user-text:u')
    })
})

describe('toThreadMessageLike CLI output', () => {
    it('keeps user CLI as a user text message', () => {
        const message = toThreadMessageLike(cli('user'), 'cli-output:cli-user')

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

        const message = toThreadMessageLike(reasoning, 'agent-reasoning:reason-1')

        expect(message).toEqual(expect.objectContaining({
            role: 'assistant',
            id: 'agent-reasoning:reason-1',
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
