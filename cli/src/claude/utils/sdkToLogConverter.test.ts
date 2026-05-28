import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Tests for SDK to Log converter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SDKToLogConverter, convertSDKToLog } from './sdkToLogConverter'
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage, SDKSystemMessage, SDKResultMessage } from '@/claude/sdk'
import type { ClaudePermissionMode } from '@hapi/protocol/types'

describe('SDKToLogConverter', () => {
    let converter: SDKToLogConverter
    const context = {
        sessionId: 'test-session-123',
        cwd: '/test/project',
        version: '1.0.0',
        gitBranch: 'main'
    }

    beforeEach(() => {
        converter = new SDKToLogConverter(context)
    })

    describe('User messages', () => {
        it('should convert SDK user message to log format', () => {
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: 'Hello Claude'
                }
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('user')
            expect(logMessage).toMatchObject({
                type: 'user',
                sessionId: context.sessionId,
                cwd: context.cwd,
                version: context.version,
                gitBranch: context.gitBranch,
                parentUuid: null,
                isSidechain: false,
                userType: 'external',
                message: {
                    role: 'user',
                    content: 'Hello Claude'
                }
            })
            expect(logMessage?.uuid).toBeTruthy()
            expect(logMessage?.timestamp).toBeTruthy()
        })

        it('should handle user message with complex content', () => {
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Check this out' },
                        { type: 'tool_result', tool_use_id: 'tool123', content: 'Result data' }
                    ]
                }
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage?.type).toBe('user')
            expect((logMessage as any).message.content).toHaveLength(2)
        })

        it('preserves the SDK structured tool_use_result beside human-readable tool result text', () => {
            const structuredResult = {
                task: { id: '42', subject: 'Implement session tasks' }
            }
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                tool_use_result: structuredResult,
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: 'task-create-1',
                        content: 'Task #42 created successfully'
                    }]
                }
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toMatchObject({
                type: 'user',
                toolUseResult: structuredResult,
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: 'task-create-1',
                        content: 'Task #42 created successfully'
                    }]
                }
            })
        })

        it('should mark synthetic user messages as meta', () => {
            // Skill injections arrive over stream-json as plain-text user messages
            // flagged with isSynthetic. The on-disk transcript flags the same event
            // with isMeta, which is what every downstream filter looks for.
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                isSynthetic: true,
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Base directory for this skill: /home/user/.claude/skills/foo' }
                    ]
                }
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage?.type).toBe('user')
            expect(logMessage?.isMeta).toBe(true)
        })

        it('should preserve isMeta on user messages', () => {
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                isMeta: true,
                message: {
                    role: 'user',
                    content: 'injected context'
                }
            }

            expect(converter.convert(sdkMessage)?.isMeta).toBe(true)
        })

        it('should not mark genuine user messages as meta', () => {
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: 'Hello Claude'
                }
            }

            expect(converter.convert(sdkMessage)?.isMeta).toBeUndefined()
        })
    })

    describe('Assistant messages', () => {
        it('should convert SDK assistant message to log format', () => {
            const sdkMessage: SDKAssistantMessage = {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Hello! How can I help?' }
                    ]
                }
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('assistant')
            expect(logMessage).toMatchObject({
                type: 'assistant',
                sessionId: context.sessionId,
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Hello! How can I help?' }
                    ]
                }
            })
        })

        it('should include requestId if present', () => {
            const sdkMessage: any = {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Response' }]
                },
                requestId: 'req_123'
            }

            const logMessage = converter.convert(sdkMessage)

            expect((logMessage as any).requestId).toBe('req_123')
        })
    })

    describe('System messages', () => {
        it('should convert SDK system message to log format', () => {
            const sdkMessage: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'new-session-456',
                model: 'claude-opus-4',
                cwd: '/project',
                tools: ['bash', 'edit']
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('system')
            expect(logMessage).toMatchObject({
                type: 'system',
                subtype: 'init',
                model: 'claude-opus-4',
                tools: ['bash', 'edit']
            })
        })

        it('should update session ID on init system message', () => {
            const sdkMessage: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'updated-session-789'
            }

            converter.convert(sdkMessage)

            // Next message should have updated session ID
            const userMessage: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'Test' }
            }

            const logMessage = converter.convert(userMessage)
            expect(logMessage?.sessionId).toBe('updated-session-789')
        })
    })

    describe('Result messages', () => {
        it('should not convert result messages', () => {
            const sdkMessage: SDKResultMessage = {
                type: 'result',
                subtype: 'success',
                result: 'Task completed',
                num_turns: 5,
                usage: {
                    input_tokens: 100,
                    output_tokens: 200
                },
                total_cost_usd: 0.05,
                duration_ms: 3000,
                duration_api_ms: 2500,
                is_error: false,
                session_id: 'result-session'
            }

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeNull()
        })

        it('should not convert error results', () => {
            const sdkMessage: SDKResultMessage = {
                type: 'result',
                subtype: 'error_max_turns',
                num_turns: 10,
                total_cost_usd: 0.1,
                duration_ms: 5000,
                duration_api_ms: 4500,
                is_error: true,
                session_id: 'error-session'
            }

            const logMessage = converter.convert(sdkMessage)

            // Error results are not converted to summaries
            expect(logMessage).toBeFalsy()
        })
    })

    describe('Context window propagation', () => {
        function makeAssistantMessage(): SDKAssistantMessage {
            return {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'hi' }],
                    usage: {
                        input_tokens: 10,
                        output_tokens: 20,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                        service_tier: 'standard'
                    }
                } as any
            }
        }

        it('infers 1M contextWindow from [1m] suffix on system.init', () => {
            const initMsg: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'session-1',
                model: 'claude-opus-4-7[1m]'
            }
            converter.convert(initMsg)

            const assistantLog = converter.convert(makeAssistantMessage()) as any
            expect(assistantLog?.message?.usage?.context_window).toBe(1_000_000)
        })

        it('infers 200k contextWindow when [1m] suffix is absent', () => {
            const initMsg: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'session-2',
                model: 'claude-sonnet-4-6'
            }
            converter.convert(initMsg)

            const assistantLog = converter.convert(makeAssistantMessage()) as any
            expect(assistantLog?.message?.usage?.context_window).toBe(200_000)
        })

        it('refines contextWindow from result.modelUsage and applies to later assistants', () => {
            const initMsg: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'session-3',
                model: 'claude-opus-4-7[1m]'
            }
            converter.convert(initMsg)

            // First assistant gets the 1M estimate from the [1m] suffix
            const first = converter.convert(makeAssistantMessage()) as any
            expect(first?.message?.usage?.context_window).toBe(1_000_000)

            // Result message reports authoritative contextWindow (say, 500k)
            const resultMsg: SDKResultMessage = {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 'session-3',
                modelUsage: {
                    'claude-opus-4-7[1m]': { contextWindow: 500_000 }
                }
            }
            converter.convert(resultMsg)

            // Subsequent assistant message uses the refined value
            const second = converter.convert(makeAssistantMessage()) as any
            expect(second?.message?.usage?.context_window).toBe(500_000)
        })

        it('does not overwrite an explicit context_window already set by upstream', () => {
            const initMsg: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'session-4',
                model: 'claude-opus-4-7[1m]'
            }
            converter.convert(initMsg)

            const assistantMsg: SDKAssistantMessage = {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'hi' }],
                    usage: {
                        input_tokens: 10,
                        output_tokens: 20,
                        context_window: 42
                    }
                } as any
            }

            const log = converter.convert(assistantMsg) as any
            expect(log?.message?.usage?.context_window).toBe(42)
        })

        it('leaves usage untouched when no system.init was seen', () => {
            const log = converter.convert(makeAssistantMessage()) as any
            expect(log?.message?.usage?.context_window).toBeUndefined()
        })
    })

    describe('Parent-child relationships', () => {
        it('should track parent UUIDs across messages', () => {
            const msg1: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'First' }
            }
            const msg2: SDKAssistantMessage = {
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Second' }] }
            }
            const msg3: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'Third' }
            }

            const log1 = converter.convert(msg1)
            const log2 = converter.convert(msg2)
            const log3 = converter.convert(msg3)

            expect(log1?.parentUuid).toBeNull()
            expect(log2?.parentUuid).toBe(log1?.uuid)
            expect(log3?.parentUuid).toBe(log2?.uuid)
        })

        it('should reset parent chain when requested', () => {
            const msg1: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'First' }
            }
            const log1 = converter.convert(msg1)

            converter.resetParentChain()

            const msg2: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'Second' }
            }
            const log2 = converter.convert(msg2)

            expect(log2?.parentUuid).toBeNull()
        })
    })

    describe('Batch conversion', () => {
        it('should convert multiple messages maintaining relationships', () => {
            const messages: SDKMessage[] = [
                {
                    type: 'user',
                    message: { role: 'user', content: 'Hello' }
                } as SDKUserMessage,
                {
                    type: 'assistant',
                    message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] }
                } as SDKAssistantMessage,
                {
                    type: 'user',
                    message: { role: 'user', content: 'How are you?' }
                } as SDKUserMessage
            ]

            const logMessages = converter.convertMany(messages)

            expect(logMessages).toHaveLength(3)
            expect(logMessages[0].parentUuid).toBeNull()
            expect(logMessages[1].parentUuid).toBe(logMessages[0].uuid)
            expect(logMessages[2].parentUuid).toBe(logMessages[1].uuid)
        })
    })

    describe('Internal event filtering', () => {
        it('should convert allowed status to pipe-delimited quota status text', () => {
            const sdkMessage = {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed',
                    resetsAt: 1775559600,
                    utilization: 0.3,
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect(logMessage!.type).toBe('assistant')
            expect((logMessage as any).message.content[0].text).toBe(
                'Claude AI usage status|1775559600|30|five_hour'
            )
        })

        it('should leave the percent field empty when allowed status has no utilization', () => {
            // Real Claude Code payloads: a plain 'allowed' status below any warning
            // threshold carries no utilization figure at all.
            const sdkMessage = {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed',
                    resetsAt: 1775559600,
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect((logMessage as any).message.content[0].text).toBe(
                'Claude AI usage status|1775559600||five_hour'
            )
        })

        it('should suppress rate_limit_event with allowed status when resetsAt is missing', () => {
            const sdkMessage = {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed',
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage

            expect(converter.convert(sdkMessage)).toBeNull()
        })

        it('should convert allowed_warning to pipe-delimited text', () => {
            const sdkMessage = {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed_warning',
                    resetsAt: 1775559600,
                    utilization: 0.85,
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect(logMessage!.type).toBe('assistant')
            expect((logMessage as any).message.content[0].text).toBe(
                'Claude AI usage limit warning|1775559600|85|five_hour'
            )
        })

        it('should convert rejected to pipe-delimited text', () => {
            const sdkMessage = {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'rejected',
                    resetsAt: 1775559600,
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect(logMessage!.type).toBe('assistant')
            expect((logMessage as any).message.content[0].text).toBe(
                'Claude AI usage limit reached|1775559600|five_hour'
            )
        })

        it('should not break parent chain when rate_limit_event is suppressed', () => {
            const user = converter.convert({
                type: 'user',
                message: { role: 'user', content: 'hi' }
            } as SDKUserMessage)

            converter.convert({
                type: 'rate_limit_event',
                rate_limit_info: { status: 'allowed' }
            } as unknown as SDKMessage)

            const assistant = converter.convert({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
            } as SDKAssistantMessage)

            expect(assistant!.parentUuid).toBe(user!.uuid)
        })

        it('should chain parent correctly when rate_limit_event is converted', () => {
            const user = converter.convert({
                type: 'user',
                message: { role: 'user', content: 'hi' }
            } as SDKUserMessage)

            const warning = converter.convert({
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed_warning',
                    resetsAt: 1775559600,
                    utilization: 0.8,
                    rateLimitType: 'five_hour'
                }
            } as unknown as SDKMessage)

            const assistant = converter.convert({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
            } as SDKAssistantMessage)

            expect(warning!.parentUuid).toBe(user!.uuid)
            expect(assistant!.parentUuid).toBe(warning!.uuid)
        })

        it('should drop tool_progress heartbeats instead of passing them through', () => {
            const logMessage = converter.convert({
                type: 'tool_progress',
                tool_use_id: 'toolu_abc',
                tool_name: 'Bash',
                parent_tool_use_id: 'toolu_parent',
                elapsed_time_seconds: 30,
                heartbeat: true,
                session_id: 'test-session-123'
            } as unknown as SDKMessage)

            expect(logMessage).toBeNull()
        })

        it('should not reparent sidechain messages when tool_progress is suppressed', () => {
            const prompt = converter.convertSidechainUserMessage('toolu_parent', 'do the thing')

            converter.convert({
                type: 'tool_progress',
                tool_use_id: 'toolu_abc',
                parent_tool_use_id: 'toolu_parent',
                elapsed_time_seconds: 30,
                heartbeat: true
            } as unknown as SDKMessage)

            const sidechainReply = converter.convert({
                type: 'assistant',
                parent_tool_use_id: 'toolu_parent',
                message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
            } as unknown as SDKMessage)

            expect(sidechainReply!.parentUuid).toBe(prompt.uuid)
            expect(sidechainReply!.isSidechain).toBe(true)
        })

        it('should not break the main parent chain when tool_progress is suppressed', () => {
            const user = converter.convert({
                type: 'user',
                message: { role: 'user', content: 'hi' }
            } as SDKUserMessage)

            converter.convert({
                type: 'tool_progress',
                tool_use_id: 'toolu_abc',
                elapsed_time_seconds: 60,
                heartbeat: true
            } as unknown as SDKMessage)

            const assistant = converter.convert({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
            } as SDKAssistantMessage)

            expect(assistant!.parentUuid).toBe(user!.uuid)
        })

        it('should still pass unknown message types through', () => {
            const logMessage = converter.convert({
                type: 'some_future_signal',
                payload: { hello: 'world' }
            } as unknown as SDKMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage!.type).toBe('some_future_signal')
        })
    })

    describe('Unknown message types', () => {
        it('should drop tool_progress heartbeat events instead of passing them through', () => {
            const logMessage = converter.convert({
                type: 'tool_progress',
                tool_use_id: 'toolu_011qMV3YCgDP89zcjHbC4rd2-heartbeat-0',
                tool_name: 'Bash',
                parent_tool_use_id: 'toolu_011qMV3YCgDP89zcjHbC4rd2',
                elapsed_time_seconds: 30,
                heartbeat: true,
                session_id: context.sessionId
            } as unknown as SDKMessage)

            expect(logMessage).toBeNull()
        })

        it('should drop arbitrary unknown SDK message types', () => {
            for (const type of ['stream_event', 'control_response', 'log', 'some_future_event']) {
                expect(converter.convert({ type, payload: { foo: 'bar' } } as unknown as SDKMessage)).toBeNull()
            }
        })

        it('should drop command_lifecycle events', () => {
            // Second unknown type observed leaking in the wild, after
            // tool_progress. It needed no code change to cover — which is the
            // point of gating on an allowlist rather than naming each offender.
            const logMessage = converter.convert({
                type: 'command_lifecycle',
                command_uuid: 'a0c15039-fb30-4ba3-bf1b-6afc3196cbeb',
                state: 'started',
                session_id: context.sessionId
            } as unknown as SDKMessage)

            expect(logMessage).toBeNull()
        })

        it('should not break parent chain when an unknown type is dropped', () => {
            const user = converter.convert({
                type: 'user',
                message: { role: 'user', content: 'hi' }
            } as SDKUserMessage)

            converter.convert({
                type: 'tool_progress',
                parent_tool_use_id: 'toolu_abc',
                heartbeat: true
            } as unknown as SDKMessage)

            const assistant = converter.convert({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
            } as SDKAssistantMessage)

            expect(assistant!.parentUuid).toBe(user!.uuid)
        })

        it('should not let repeated tool_progress heartbeats hijack sidechain parent tracking', () => {
            // A long-running Bash inside a Task subagent emits a tool_progress
            // heartbeat every 30s, all sharing the subagent's parent_tool_use_id.
            // Converting them would overwrite sidechainLastUUID on every tick, so
            // the subagent's next real message would be parented to a heartbeat
            // rather than to its own previous message.
            const parentToolUseId = 'toolu_011qMV3YCgDP89zcjHbC4rd2'

            const firstSidechainMessage = converter.convert({
                type: 'assistant',
                parent_tool_use_id: parentToolUseId,
                message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] }
            } as unknown as SDKAssistantMessage)

            for (let tick = 0; tick < 3; tick++) {
                const heartbeat = converter.convert({
                    type: 'tool_progress',
                    tool_use_id: `${parentToolUseId}-heartbeat-${tick}`,
                    tool_name: 'Bash',
                    parent_tool_use_id: parentToolUseId,
                    elapsed_time_seconds: (tick + 1) * 30,
                    heartbeat: true,
                    session_id: context.sessionId
                } as unknown as SDKMessage)

                expect(heartbeat).toBeNull()
            }

            const nextSidechainMessage = converter.convert({
                type: 'assistant',
                parent_tool_use_id: parentToolUseId,
                message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
            } as unknown as SDKAssistantMessage)

            expect(nextSidechainMessage!.isSidechain).toBe(true)
            expect(nextSidechainMessage!.parentUuid).toBe(firstSidechainMessage!.uuid)
        })

        it('should still convert every known type', () => {
            expect(converter.convert({
                type: 'user',
                message: { role: 'user', content: 'hi' }
            } as SDKUserMessage)).toBeTruthy()

            expect(converter.convert({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }
            } as SDKAssistantMessage)).toBeTruthy()

            expect(converter.convert({
                type: 'system',
                subtype: 'init',
                model: 'claude-opus-4-8'
            } as SDKSystemMessage)).toBeTruthy()

            expect(converter.convert({
                type: 'tool_result',
                tool_use_id: 'toolu_x',
                content: 'done'
            } as unknown as SDKMessage)).toBeTruthy()
        })
    })

    describe('Convenience function', () => {
        it('should convert single message without state', () => {
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: { role: 'user', content: 'Test message' }
            }

            const logMessage = convertSDKToLog(sdkMessage, context)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('user')
            expect(logMessage?.parentUuid).toBeNull()
        })
    })

    describe('Tool results with mode', () => {
        it('should add mode to tool result when available in responses', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_123', { approved: true, mode: 'acceptEdits' })
            
            const converterWithResponses = new SDKToLogConverter(context, responses)
            
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: 'tool_123',
                        content: 'Tool executed successfully'
                    }]
                }
            }

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('acceptEdits')
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should not add mode when not in responses', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            
            const converterWithResponses = new SDKToLogConverter(context, responses)
            
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: 'tool_456',
                        content: 'Tool result'
                    }]
                }
            }

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBeUndefined()
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should handle mixed content with tool results', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_789', { approved: true, mode: 'bypassPermissions' })
            
            const converterWithResponses = new SDKToLogConverter(context, responses)
            
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Here is the result:' },
                        {
                            type: 'tool_result',
                            tool_use_id: 'tool_789',
                            content: 'Tool output'
                        }
                    ]
                }
            }

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('bypassPermissions')
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should work with convenience function', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_abc', { approved: false, mode: 'plan', reason: 'User rejected' })
            
            const sdkMessage: SDKUserMessage = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: 'tool_abc',
                        content: 'Permission denied'
                    }]
                }
            }

            const logMessage = convertSDKToLog(sdkMessage, context, responses)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('plan')
        })
    })
})
