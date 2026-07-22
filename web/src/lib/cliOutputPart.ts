import { isObject } from '@hapi/protocol'
import type { CliOutputBlock } from '@/chat/types'

export const CLI_OUTPUT_TOOL_NAME = 'HapiCliOutput' as const

export function isAssistantCliOutputBlock(value: unknown): value is CliOutputBlock & { source: 'assistant' } {
    return isObject(value)
        && value.kind === 'cli-output'
        && typeof value.id === 'string'
        && (value.localId === null || typeof value.localId === 'string')
        && typeof value.createdAt === 'number'
        && typeof value.text === 'string'
        && value.source === 'assistant'
}
