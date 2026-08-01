import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, it, expect } from 'vitest';
import { convertPiEvent } from './piEventConverter';
import type { PiAgentEvent } from './types';

describe('convertPiEvent', () => {
    it('should return empty for message_update with text_delta (accumulated in runPi)', () => {
        // The converter intentionally emits nothing for message_update
        // — runPi accumulates text/thinking deltas and flushes a single
        // snapshot on `message_end`. This avoids the web UI rendering
        // every delta as a separate block (character-by-character column)
        // and the reducer's per-content streamId dedup showing only the
        // last delta as the whole reasoning.
        const result = convertPiEvent({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'hello world' }
        });
        expect(result).toEqual([]);
    });

    it('should return empty for message_update with thinking_delta (accumulated in runPi)', () => {
        const result = convertPiEvent({
            type: 'message_update',
            assistantMessageEvent: { type: 'thinking_delta', delta: 'let me think...' }
        });
        expect(result).toEqual([]);
    });

    it('should return empty for message_update with start sub-type', () => {
        // text_start/thinking_start carry the full partial state and
        // would cause the web UI to render the same text multiple
        // times. The accumulator only listens to deltas.
        const result = convertPiEvent({
            type: 'message_update',
            assistantMessageEvent: { type: 'start' }
        });
        expect(result).toEqual([]);
    });

    it('should return empty array for message_update with done sub-type', () => {
        const result = convertPiEvent({
            type: 'message_update',
            assistantMessageEvent: { type: 'done', reason: 'stop' }
        });
        expect(result).toEqual([]);
    });

    it('should return empty array for message_update without assistantMessageEvent', () => {
        const result = convertPiEvent({ type: 'message_update' });
        expect(result).toEqual([]);
    });

    it('should convert tool_execution_start to tool_call AgentMessage', () => {
        const result = convertPiEvent({
            type: 'tool_execution_start',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            args: { path: '/foo.ts' }
        });
        expect(result).toEqual([{
            type: 'tool_call',
            id: 'tc-1',
            name: 'read_file',
            input: { path: '/foo.ts' },
            status: 'in_progress'
        }]);
    });

    it('should convert tool_execution_end (success) to tool_result AgentMessage', () => {
        const result = convertPiEvent({
            type: 'tool_execution_end',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            result: 'file content',
            isError: false
        });
        expect(result).toEqual([{
            type: 'tool_result',
            id: 'tc-1',
            output: 'file content',
            status: 'completed'
        }]);
    });

    it('should convert tool_execution_end (error) to failed tool_result AgentMessage', () => {
        const result = convertPiEvent({
            type: 'tool_execution_end',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            result: 'file not found',
            isError: true
        });
        expect(result).toEqual([{
            type: 'tool_result',
            id: 'tc-1',
            output: 'file not found',
            status: 'failed'
        }]);
    });

    it('should handle tool_execution_end with missing result', () => {
        const result = convertPiEvent({
            type: 'tool_execution_end',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            isError: false
        } as any);
        expect(result).toEqual([{
            type: 'tool_result',
            id: 'tc-1',
            output: undefined,
            status: 'completed'
        }]);
    });

    it('should handle tool_execution_end with missing toolCallId', () => {
        const result = convertPiEvent({
            type: 'tool_execution_end',
            toolName: 'read_file',
            result: 'ok',
            isError: false
        } as any);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool_result');
        expect((result[0] as any).id).toBeUndefined();
    });

    // NOTE: unlike upstream, this fork's AgentMessage/CodexMessage layer has no
    // 'usage' variant (usage-tracking was never ported into this fork's agent
    // message abstraction — see the acp-shared-fixes cart's investigation of
    // AcpSdkBackend). turn_end therefore only ever emits a single
    // turn_complete message; the usage payload on the wire event is read but
    // intentionally dropped rather than grafting a parallel usage-reporting
    // mechanism onto AgentMessage.
    it('should convert turn_end to a single turn_complete message (usage intentionally dropped)', () => {
        const result = convertPiEvent({
            type: 'turn_end',
            message: {
                usage: {
                    input: 100,
                    output: 200,
                    cacheRead: 10,
                    cacheWrite: 5,
                    totalTokens: 315
                },
                stopReason: 'stop'
            },
            toolResults: []
        });

        expect(result).toEqual([{
            type: 'turn_complete',
            stopReason: 'stop'
        }]);
    });

    it('should convert turn_end with toolUse stopReason', () => {
        const result = convertPiEvent({
            type: 'turn_end',
            message: {
                usage: { input: 50, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
                stopReason: 'toolUse'
            },
            toolResults: []
        });

        expect(result).toEqual([{
            type: 'turn_complete',
            stopReason: 'toolUse'
        }]);
    });

    it('should convert turn_end without usage data', () => {
        const result = convertPiEvent({
            type: 'turn_end'
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            type: 'turn_complete',
            stopReason: 'stop'
        });
    });

    it('should return empty array for agent_start', () => {
        expect(convertPiEvent({ type: 'agent_start' })).toEqual([]);
    });

    it('should return empty array for agent_end', () => {
        expect(convertPiEvent({ type: 'agent_end', messages: [] })).toEqual([]);
    });

    it('should return empty array for response events', () => {
        // Response events use a different type, but we handle gracefully
        expect(convertPiEvent({ type: 'response', command: 'prompt', success: true } as unknown as PiAgentEvent)).toEqual([]);
    });

    it('should return empty array for turn_start', () => {
        expect(convertPiEvent({ type: 'turn_start' })).toEqual([]);
    });

    it('should return empty array for unknown event types', () => {
        expect(convertPiEvent({ type: 'something_else' })).toEqual([]);
    });

    it('should not crash on unexpected data structure (safety net)', () => {
        // Simulate a malformed event that somehow passes through
        const weird = Object.create(null);
        weird.type = 'message_update';
        weird.assistantMessageEvent = undefined;
        // Should not throw
        expect(() => convertPiEvent(weird as unknown as PiAgentEvent)).not.toThrow();
        expect(convertPiEvent(weird as unknown as PiAgentEvent)).toEqual([]);
    });
});
