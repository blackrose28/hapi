import { describe, expect, it } from 'vitest'
import { parseToolProgressMessage } from './toolProgress'

describe('parseToolProgressMessage', () => {
    const heartbeat = {
        type: 'tool_progress',
        tool_use_id: 'toolu_01E8M8oJgMsqE6n7pegXoD69',
        tool_name: 'Bash',
        parent_tool_use_id: 'toolu_parent',
        elapsed_time_seconds: 30,
        heartbeat: true,
        session_id: '44ba8a87-23fc-49f8-ba52-f21482c48afb'
    }

    it('parses a full heartbeat', () => {
        expect(parseToolProgressMessage(heartbeat)).toEqual({
            toolUseId: 'toolu_01E8M8oJgMsqE6n7pegXoD69',
            parentToolUseId: 'toolu_parent',
            toolName: 'Bash',
            elapsedSeconds: 30
        })
    })

    it('defaults parentToolUseId to null for a main-thread tool', () => {
        const { parent_tool_use_id: _omitted, ...mainThread } = heartbeat
        expect(parseToolProgressMessage(mainThread)?.parentToolUseId).toBeNull()
    })

    it('omits toolName and elapsedSeconds when absent', () => {
        expect(parseToolProgressMessage({
            type: 'tool_progress',
            tool_use_id: 'toolu_abc'
        })).toEqual({ toolUseId: 'toolu_abc', parentToolUseId: null })
    })

    it('drops a nonsensical elapsed value rather than forwarding it', () => {
        expect(parseToolProgressMessage({ ...heartbeat, elapsed_time_seconds: -5 }))
            .not.toHaveProperty('elapsedSeconds')
        expect(parseToolProgressMessage({ ...heartbeat, elapsed_time_seconds: Number.NaN }))
            .not.toHaveProperty('elapsedSeconds')
        expect(parseToolProgressMessage({ ...heartbeat, elapsed_time_seconds: '30' }))
            .not.toHaveProperty('elapsedSeconds')
    })

    it('returns null for other message types', () => {
        expect(parseToolProgressMessage({ type: 'assistant', tool_use_id: 'toolu_abc' })).toBeNull()
        expect(parseToolProgressMessage({ type: 'user' })).toBeNull()
    })

    it('returns null when tool_use_id is missing or empty', () => {
        expect(parseToolProgressMessage({ type: 'tool_progress' })).toBeNull()
        expect(parseToolProgressMessage({ type: 'tool_progress', tool_use_id: '' })).toBeNull()
        expect(parseToolProgressMessage({ type: 'tool_progress', tool_use_id: 42 })).toBeNull()
    })

    it('returns null for non-object input', () => {
        expect(parseToolProgressMessage(null)).toBeNull()
        expect(parseToolProgressMessage(undefined)).toBeNull()
        expect(parseToolProgressMessage('tool_progress')).toBeNull()
    })
})
