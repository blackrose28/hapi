import { isObject } from '@hapi/protocol'
import type { AgentReasoningBlock } from '@/chat/types'

export const REASONING_TOOL_NAME = 'HapiReasoning' as const

export function reasoningToolCallId(blockId: string): string {
    return `reasoning:${blockId}`
}

export function isAgentReasoningBlock(value: unknown): value is AgentReasoningBlock {
    return isObject(value)
        && value.kind === 'agent-reasoning'
        && typeof value.id === 'string'
        && (value.localId === null || typeof value.localId === 'string')
        && typeof value.createdAt === 'number'
        && Number.isFinite(value.createdAt)
        && typeof value.text === 'string'
}
