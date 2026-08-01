import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { randomUUID } from 'node:crypto';
import type { AgentMessage, PlanItem } from './types';

export type CodexMessage =
    | { type: 'message'; message: string }
    | { type: 'reasoning'; message: string; id: string }
    | {
        type: 'tool-call';
        name: string;
        callId: string;
        input: unknown;
        status?: 'pending' | 'in_progress' | 'completed' | 'failed';
    }
    | {
        type: 'tool-call-result';
        callId: string;
        output: unknown;
        is_error?: boolean;
    }
    | { type: 'plan'; entries: PlanItem[] }
    | { type: 'error'; message: string }
    | {
        type: 'token_count';
        info: {
            total: {
                inputTokens?: number;
                outputTokens?: number;
                cachedInputTokens?: number;
                thoughtTokens?: number;
                totalTokens?: number;
            };
            contextTokens?: number;
            modelContextWindow?: number;
        };
    };

export function convertAgentMessage(message: AgentMessage): CodexMessage | null {
    switch (message.type) {
        case 'text':
            return { type: 'message', message: message.text };
        case 'reasoning':
            // AgentMessage uses `text` (consistent with the `text` variant);
            // the wire-level CodexMessage uses `message` to match the
            // existing reasoning format emitted by the Codex path.
            return { type: 'reasoning', message: message.text, id: message.id ?? randomUUID() };
        case 'tool_call':
            return {
                type: 'tool-call',
                name: message.name,
                callId: message.id,
                input: message.input,
                status: message.status
            };
        case 'tool_result':
            return {
                type: 'tool-call-result',
                callId: message.id,
                output: message.output,
                is_error: message.status === 'failed'
            };
        case 'plan':
            return {
                type: 'plan',
                entries: message.items
            };
        case 'error':
            return { type: 'error', message: message.message };
        case 'turn_complete':
            return null;
        case 'usage': {
            const inputTokens = message.inputTokens ?? 0;
            const outputTokens = message.outputTokens ?? 0;
            return {
                type: 'token_count',
                info: {
                    total: {
                        inputTokens: message.inputTokens,
                        outputTokens: message.outputTokens,
                        cachedInputTokens: message.cacheReadTokens ?? 0,
                        thoughtTokens: message.thoughtTokens ?? 0,
                        totalTokens: message.totalTokens ?? (inputTokens + outputTokens)
                    },
                    contextTokens: message.contextTokens,
                    modelContextWindow: message.contextWindow
                }
            };
        }
        default: {
            // Unreachable while every AgentMessage variant is handled above —
            // the `never` binding is what enforces that at compile time. The
            // runtime return is deliberately `null` rather than the message
            // itself: callers forward a non-null result straight into the chat
            // stream, so echoing an unrecognized shape here would put a raw
            // object on screen instead of failing closed.
            const _exhaustive: never = message;
            void _exhaustive;
            return null;
        }
    }
}
