import { describe, it, expect } from "bun:test"
import { buildRecoveryContext } from './recoveryContext'
import type { StoredMessage } from '../store/types'

function msg(overrides: Partial<StoredMessage> = {}): StoredMessage {
    return {
        id: 'msg-1',
        sessionId: 's1',
        content: null,
        createdAt: Date.now(),
        seq: 1,
        localId: null,
        invokedAt: null,
        scheduledAt: null,
        ...overrides
    }
}

describe('buildRecoveryContext', () => {
    it('returns null for empty messages', () => {
        expect(buildRecoveryContext([])).toBeNull()
    })

    it('returns null when no user messages found', () => {
        const messages: StoredMessage[] = [
            msg({ content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'hello' } } } })
        ]
        expect(buildRecoveryContext(messages)).toBeNull()
    })

    it('builds context from user + agent messages', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Write a test' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'I wrote the test' } } } }),
            msg({ seq: 3, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Tests pass' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx).not.toBeNull()
        expect(ctx!).toContain('[Previous session context')
        expect(ctx!).toContain('User:')
        expect(ctx!).toContain('Write a test')
        expect(ctx!).toContain('Agent:')
        expect(ctx!).toContain('I wrote the test')
        expect(ctx!).toContain('Tests pass')
        expect(ctx!).toContain('--- End of recovered context ---')
    })

    it('groups multiple turns correctly', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Task 1' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Doing task 1' } } } }),
            msg({ seq: 3, content: { role: 'user', content: { type: 'text', text: 'Task 2' } } }),
            msg({ seq: 4, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Doing task 2' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Task 1')
        expect(ctx!).toContain('Task 2')
        const userCount = (ctx!.match(/^User:$/gm) || []).length
        expect(userCount).toBe(2)
    })

    it('skips tool-call, tool-call-result, reasoning, token_count', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Hello' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'read' } } } }),
            msg({ seq: 3, content: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', output: '...' } } } }),
            msg({ seq: 4, content: { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', text: '...' } } } }),
            msg({ seq: 5, content: { role: 'agent', content: { type: 'codex', data: { type: 'token_count', count: 500 } } } }),
            msg({ seq: 6, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Done' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Hello')
        expect(ctx!).toContain('Done')
        expect(ctx!).not.toContain('tool-call')
        expect(ctx!).not.toContain('tool-call-result')
        expect(ctx!).not.toContain('reasoning')
        expect(ctx!).not.toContain('token_count')
    })

    it('includes event messages', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Hi' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'event', data: { type: 'message', text: 'Task failed: 429' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Task failed: 429')
    })

    
    it('extracts agent text from data.message field (real-world format)', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Hello' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'I found the issue' } } } }),
            msg({ seq: 3, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Fixed it' } } } }),
            msg({ seq: 4, content: { role: 'agent', content: { type: 'event', data: { type: 'message', message: 'Task failed: 429' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx).not.toBeNull()
        expect(ctx!).toContain('I found the issue')
        expect(ctx!).toContain('Fixed it')
        expect(ctx!).toContain('Task failed: 429')
    })

    it('silently skips malformed messages', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Hi' } } }),
            msg({ seq: 2, content: 'not-an-object' }),
            msg({ seq: 3, content: null }),
            msg({ seq: 4, content: { role: 'user' } }),
            msg({ seq: 5, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Still works' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Hi')
        expect(ctx!).toContain('Still works')
    })

    it('handles user message without subsequent agent responses', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Solo question' } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Solo question')
        expect(ctx!).not.toContain('Agent:')
    })

    it('returns null for messages with only skipped types', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'agent', content: { type: 'codex', data: { type: 'token_count', count: 100 } } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', text: '...' } } } }),
        ]
        expect(buildRecoveryContext(messages)).toBeNull()
    })

    // --- New tests for the fixes ---

    it('handles wrapped-envelope messages (message wrapper)', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { message: { role: 'user', content: { type: 'text', text: 'Wrapped user message' } } } }),
            msg({ seq: 2, content: { message: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Wrapped agent reply' } } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx).not.toBeNull()
        expect(ctx!).toContain('Wrapped user message')
        expect(ctx!).toContain('Wrapped agent reply')
    })

    it('handles data-wrapped envelope messages', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { data: { message: { role: 'user', content: { type: 'text', text: 'Data-wrapped user' } } } } }),
            msg({ seq: 2, content: { data: { message: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Data-wrapped reply' } } } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx).not.toBeNull()
        expect(ctx!).toContain('Data-wrapped user')
        expect(ctx!).toContain('Data-wrapped reply')
    })

    it('handles assistant role alongside agent role', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Hello assistant' } } }),
            msg({ seq: 2, content: { role: 'assistant', content: { type: 'codex', data: { type: 'message', text: 'Assistant response here' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx).not.toBeNull()
        expect(ctx!).toContain('Hello assistant')
        expect(ctx!).toContain('Assistant response here')
    })

    it('handles mixed agent and assistant roles in same session', () => {
        const messages: StoredMessage[] = [
            msg({ seq: 1, content: { role: 'user', content: { type: 'text', text: 'Task 1' } } }),
            msg({ seq: 2, content: { role: 'agent', content: { type: 'codex', data: { type: 'message', text: 'Agent reply' } } } }),
            msg({ seq: 3, content: { role: 'user', content: { type: 'text', text: 'Task 2' } } }),
            msg({ seq: 4, content: { role: 'assistant', content: { type: 'codex', data: { type: 'message', text: 'Assistant reply' } } } }),
        ]
        const ctx = buildRecoveryContext(messages)
        expect(ctx!).toContain('Agent reply')
        expect(ctx!).toContain('Assistant reply')
    })
})
