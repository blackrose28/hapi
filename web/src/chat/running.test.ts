import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from './types'
import { hasInFlightToolCall } from './running'

function userMessage(id: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: 1,
        role: 'user',
        isSidechain: false,
        content: { type: 'text', text: 'Run the task' }
    }
}

function toolCallMessage(id: string, toolCallId: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: 2,
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-call',
            id: toolCallId,
            name: 'Bash',
            input: { command: 'sleep 1' },
            description: null,
            uuid: id,
            parentUUID: null
        }]
    }
}

function toolResultMessage(id: string, toolCallId: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: 3,
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-result',
            tool_use_id: toolCallId,
            content: 'done',
            is_error: false,
            uuid: id,
            parentUUID: null
        }]
    }
}

function readyMessage(id: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: 4,
        role: 'event',
        isSidechain: false,
        content: { type: 'ready' }
    }
}

describe('hasInFlightToolCall', () => {
    it('detects an unmatched tool call in the current turn', () => {
        expect(hasInFlightToolCall([
            userMessage('user-1'),
            toolCallMessage('tool-1', 'call-1')
        ])).toBe(true)
    })

    it('clears the inferred run when the tool result arrives', () => {
        expect(hasInFlightToolCall([
            userMessage('user-1'),
            toolCallMessage('tool-1', 'call-1'),
            toolResultMessage('result-1', 'call-1')
        ])).toBe(false)
    })

    it('does not keep a missing tool result alive beyond a ready boundary', () => {
        expect(hasInFlightToolCall([
            userMessage('user-1'),
            toolCallMessage('tool-1', 'call-1'),
            readyMessage('ready-1')
        ])).toBe(false)
    })

})
