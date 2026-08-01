import { describe, expect, it } from 'vitest'
import { reduceTimeline } from './reducerTimeline'
import type { TracedMessage } from './tracer'

function makeContext() {
    return {
        permissionsById: new Map(),
        groups: new Map(),
        consumedGroupIds: new Set<string>(),
        titleChangesByToolUseId: new Map(),
        emittedTitleChangeToolUseIds: new Set<string>()
    }
}

function makeUserMessage(text: string, overrides?: Partial<TracedMessage>): TracedMessage {
    return {
        id: 'msg-1',
        localId: null,
        createdAt: 1_700_000_000_000,
        role: 'user',
        content: { type: 'text', text },
        isSidechain: false,
        ...overrides
    } as TracedMessage
}

function makeAgentMessage(text: string, overrides?: Partial<TracedMessage>): TracedMessage {
    return {
        id: 'msg-agent-1',
        localId: null,
        createdAt: 1_700_000_000_000,
        role: 'agent',
        content: [{ type: 'text', text, uuid: 'u-1', parentUUID: null }],
        isSidechain: false,
        ...overrides
    } as TracedMessage
}

describe('reduceTimeline', () => {
    it('renders user text as user-text block', () => {
        const text = 'Hello, this is a normal message'
        const { blocks } = reduceTimeline([makeUserMessage(text)], makeContext())

        expect(blocks).toHaveLength(1)
        expect(blocks[0].kind).toBe('user-text')
    })

    it('does not filter XML-like user text (filtering is in normalize layer)', () => {
        const text = '<task-notification> <summary>Some task</summary> </task-notification>'
        const { blocks } = reduceTimeline([makeUserMessage(text)], makeContext())

        expect(blocks).toHaveLength(1)
        expect(blocks[0].kind).toBe('user-text')
    })

    it('suppresses "No response requested." when parentUUID points to an injected turn', () => {
        // Simulate: sidechain message with uuid 'injected-uuid', then sentinel reply pointing to it
        const injectedMsg: TracedMessage = {
            id: 'msg-injected',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [{ type: 'sidechain', uuid: 'injected-uuid', prompt: '<task-notification>...</task-notification>' }],
            isSidechain: true
        } as TracedMessage

        const sentinelMsg: TracedMessage = {
            id: 'msg-sentinel',
            localId: null,
            createdAt: 1_700_000_001_000,
            role: 'agent',
            content: [{ type: 'text', text: 'No response requested.', uuid: 'u-1', parentUUID: 'injected-uuid' }],
            isSidechain: false
        } as TracedMessage

        const { blocks } = reduceTimeline([injectedMsg, sentinelMsg], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        expect(textBlocks).toHaveLength(0)
    })

    it('keeps "No response requested." when parentUUID points to a normal turn (not injected)', () => {
        // parentUUID points to a normal assistant message, not an injected turn
        const normalMsg: TracedMessage = {
            id: 'msg-normal',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [{ type: 'text', text: 'Hello!', uuid: 'normal-uuid', parentUUID: null }],
            isSidechain: false
        } as TracedMessage

        const replyMsg: TracedMessage = {
            id: 'msg-reply',
            localId: null,
            createdAt: 1_700_000_001_000,
            role: 'agent',
            content: [{ type: 'text', text: 'No response requested.', uuid: 'u-2', parentUUID: 'normal-uuid' }],
            isSidechain: false
        } as TracedMessage

        const { blocks } = reduceTimeline([normalMsg, replyMsg], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        // Should be 2: "Hello!" + "No response requested." (not filtered because parent is normal)
        expect(textBlocks).toHaveLength(2)
    })

    it('keeps "No response requested." when parentUUID is null (first message)', () => {
        const { blocks } = reduceTimeline([makeAgentMessage('No response requested.')], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        expect(textBlocks).toHaveLength(1)
    })

    it('keeps "No response requested." when message also has other blocks (e.g. tool calls)', () => {
        const injectedMsg: TracedMessage = {
            id: 'msg-injected',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [{ type: 'sidechain', uuid: 'injected-uuid', prompt: 'system content' }],
            isSidechain: true
        } as TracedMessage

        const multiMsg: TracedMessage = {
            id: 'msg-multi',
            localId: null,
            createdAt: 1_700_000_001_000,
            role: 'agent',
            content: [
                { type: 'text', text: 'No response requested.', uuid: 'u-1', parentUUID: 'injected-uuid' },
                { type: 'tool-call', id: 'tc-1', name: 'Bash', input: { command: 'ls' }, description: null, uuid: 'u-1', parentUUID: 'injected-uuid' }
            ],
            isSidechain: false
        } as TracedMessage

        const { blocks } = reduceTimeline([injectedMsg, multiMsg], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        expect(textBlocks).toHaveLength(1)
    })

    it('recognizes Kimi-style "Agent: <name>" tool-call titles as subagent spawns', () => {
        // Claude/Codex spawn subagents via a tool named exactly 'Task'. Kimi
        // (and other ACP agents) label the same concept with a titled variant
        // like 'Agent: Researcher'. The subagent-prompt suppression logic
        // must recognize both so the duplicated prompt text is not shown
        // twice for Kimi sessions.
        const kimiAgentMsg: TracedMessage = {
            id: 'msg-kimi-agent',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [
                { type: 'text', text: 'Look into the failing test', uuid: 'u-1', parentUUID: null },
                {
                    type: 'tool-call',
                    id: 'tc-kimi-1',
                    name: 'Agent: Researcher',
                    input: { prompt: 'Look into the failing test' },
                    description: null,
                    uuid: 'u-1',
                    parentUUID: null
                }
            ],
            isSidechain: false
        } as TracedMessage

        const { blocks } = reduceTimeline([kimiAgentMsg], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        // The prompt-echo text preceding the "Agent: Researcher" tool call is
        // suppressed, same as it would be for a Claude 'Task' tool call.
        expect(textBlocks).toHaveLength(0)
        const toolBlocks = blocks.filter(b => b.kind === 'tool-call')
        expect(toolBlocks).toHaveLength(1)
    })

    it('keeps normal assistant text blocks', () => {
        const { blocks } = reduceTimeline([makeAgentMessage('Here is the answer.')], makeContext())

        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        expect(textBlocks).toHaveLength(1)
    })

    it('never renders a quota-update (sub-threshold usage) message as a chat block', () => {
        const msg = makeAgentMessage('Claude AI usage status|1774278000|30|five_hour')
        const { blocks } = reduceTimeline([msg], makeContext())

        expect(blocks).toHaveLength(0)
    })

    it('extracts task-notification summary as event from sidechain block', () => {
        const msg: TracedMessage = {
            id: 'msg-notif',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [{ type: 'sidechain', uuid: 'n-1', prompt: '<task-notification> <summary>Background command stopped</summary> </task-notification>' }],
            isSidechain: true
        } as TracedMessage

        const { blocks } = reduceTimeline([msg], makeContext())
        const events = blocks.filter(b => b.kind === 'agent-event')
        expect(events).toHaveLength(1)
        expect((events[0] as any).event.message).toBe('Background command stopped')
    })

    it('suppresses sentinel reply to task-notification (summary path)', () => {
        const notifMsg: TracedMessage = {
            id: 'msg-notif',
            localId: null,
            createdAt: 1_700_000_000_000,
            role: 'agent',
            content: [{ type: 'sidechain', uuid: 'notif-uuid', prompt: '<task-notification> <summary>Done</summary> </task-notification>' }],
            isSidechain: true
        } as TracedMessage

        const sentinelMsg: TracedMessage = {
            id: 'msg-sentinel',
            localId: null,
            createdAt: 1_700_000_001_000,
            role: 'agent',
            content: [{ type: 'text', text: 'No response requested.', uuid: 'u-1', parentUUID: 'notif-uuid' }],
            isSidechain: false
        } as TracedMessage

        const { blocks } = reduceTimeline([notifMsg, sentinelMsg], makeContext())
        const textBlocks = blocks.filter(b => b.kind === 'agent-text')
        expect(textBlocks).toHaveLength(0)
        // But the event should still be present
        const events = blocks.filter(b => b.kind === 'agent-event')
        expect(events).toHaveLength(1)
    })

    it('renders Team Chat mention user records as team-mention blocks', () => {
        const { blocks } = reduceTimeline([makeUserMessage('[HAPI_TEAM_MENTION]\nhello team mention', {
            meta: {
                sentFrom: 'team-chat',
                teamMentionRequestId: 'req-1',
                teamChatId: 'team-1',
                sourceMessageId: 'team-msg-1'
            }
        })], makeContext())

        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({
            kind: 'team-mention',
            requestId: 'req-1',
            teamChatId: 'team-1',
            sourceMessageId: 'team-msg-1',
            text: 'hello team mention',
            status: 'delivered'
        })
    })

    it('renders Team Chat mention status from request state when available', () => {
        const context = {
            ...makeContext(),
            teamMentionStatusesById: new Map([['req-1', 'no_action' as const]])
        }

        const { blocks } = reduceTimeline([makeUserMessage('[HAPI_TEAM_MENTION]\nhello team mention', {
            meta: {
                sentFrom: 'team-chat',
                teamMentionRequestId: 'req-1',
                teamChatId: 'team-1',
                sourceMessageId: 'team-msg-1'
            }
        })], context)

        expect(blocks[0]).toMatchObject({
            kind: 'team-mention',
            status: 'no_action'
        })
    })

})
