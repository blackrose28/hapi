import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent/types';
import { AcpSdkBackend } from './AcpSdkBackend';
import { ACP_SESSION_UPDATE_TYPES } from './constants';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type BackendStatics = {
    UPDATE_QUIET_PERIOD_MS: number;
    UPDATE_DRAIN_TIMEOUT_MS: number;
    PRE_PROMPT_UPDATE_QUIET_PERIOD_MS: number;
    PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS: number;
    LATE_FLUSH_INTERVAL_MS: number;
    LATE_FLUSH_QUIET_PERIOD_MS: number;
    LATE_FLUSH_WINDOW_MS: number;
};

const backendStatics = AcpSdkBackend as unknown as BackendStatics;
const originalStatics = {
    updateQuietPeriodMs: backendStatics.UPDATE_QUIET_PERIOD_MS,
    updateDrainTimeoutMs: backendStatics.UPDATE_DRAIN_TIMEOUT_MS,
    prePromptUpdateQuietPeriodMs: backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS,
    prePromptUpdateDrainTimeoutMs: backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS,
    lateFlushIntervalMs: backendStatics.LATE_FLUSH_INTERVAL_MS,
    lateFlushQuietPeriodMs: backendStatics.LATE_FLUSH_QUIET_PERIOD_MS,
    lateFlushWindowMs: backendStatics.LATE_FLUSH_WINDOW_MS
};

afterEach(() => {
    backendStatics.UPDATE_QUIET_PERIOD_MS = originalStatics.updateQuietPeriodMs;
    backendStatics.UPDATE_DRAIN_TIMEOUT_MS = originalStatics.updateDrainTimeoutMs;
    backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = originalStatics.prePromptUpdateQuietPeriodMs;
    backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = originalStatics.prePromptUpdateDrainTimeoutMs;
    backendStatics.LATE_FLUSH_INTERVAL_MS = originalStatics.lateFlushIntervalMs;
    backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = originalStatics.lateFlushQuietPeriodMs;
    backendStatics.LATE_FLUSH_WINDOW_MS = originalStatics.lateFlushWindowMs;
});

describe('AcpSdkBackend', () => {
    it('forwards ACP session_info_update titles without requiring an active prompt', () => {
        const backend = new AcpSdkBackend({ command: 'agent' });
        const updates: Array<{ sessionId: string | null; title: string | null }> = [];
        backend.setSessionInfoUpdateListener((update) => updates.push(update));

        const backendInternal = backend as unknown as {
            handleSessionUpdate: (params: unknown) => void;
        };
        backendInternal.handleSessionUpdate({
            sessionId: 'session-1',
            update: {
                sessionUpdate: ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate,
                title: 'Native session title'
            }
        });
        backendInternal.handleSessionUpdate({
            sessionId: 'session-1',
            update: {
                sessionUpdate: ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate,
                updatedAt: '2026-07-12T00:00:00Z'
            }
        });

        expect(updates).toEqual([{ sessionId: 'session-1', title: 'Native session title' }]);
    });

    it('refreshes native titles through ACP session/list', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const calls: Array<{ method: string; params: unknown; options: unknown }> = [];
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (method: string, params: unknown, options?: unknown) => Promise<unknown>;
            } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method, params, options) => {
                calls.push({ method, params, options });
                return {
                    sessions: [
                        { sessionId: 'other', title: 'Other title' },
                        { sessionId: 'session-1', title: 'Native OpenCode title' }
                    ]
                };
            }
        };
        const updates: Array<{ sessionId: string | null; title: string | null }> = [];
        backend.setSessionInfoUpdateListener((update) => updates.push(update));

        await backend.refreshSessionInfo('session-1', '/workspace');

        expect(calls).toEqual([{
            method: 'session/list',
            params: { cwd: '/workspace' },
            options: { timeoutMs: 5000 }
        }]);
        expect(updates).toEqual([{ sessionId: 'session-1', title: 'Native OpenCode title' }]);
    });

    it('retries session/list while an asynchronously generated title is still a placeholder', async () => {
        vi.useFakeTimers();
        try {
            const backend = new AcpSdkBackend({ command: 'opencode' });
            const titles = ['New session - 2026-07-12T00:00:00.000Z', 'Native OpenCode title'];
            const backendInternal = backend as unknown as {
                transport: { sendRequest: () => Promise<unknown> } | null;
            };
            backendInternal.transport = {
                sendRequest: async () => ({
                    sessions: [{ sessionId: 'session-1', title: titles.shift() }]
                })
            };
            const updates: Array<{ sessionId: string | null; title: string | null }> = [];
            backend.setSessionInfoUpdateListener((update) => updates.push(update));

            await backend.refreshSessionInfo('session-1', '/workspace');
            await vi.runAllTimersAsync();

            expect(updates).toEqual([
                { sessionId: 'session-1', title: 'New session - 2026-07-12T00:00:00.000Z' },
                { sessionId: 'session-1', title: 'Native OpenCode title' }
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('allows the permission handler to resolve requests immediately', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        let capturedRequestId: string | null = null;

        backend.onPermissionRequest((request) => {
            capturedRequestId = request.id;
            void backend.respondToPermission(request.sessionId, request, {
                outcome: 'selected',
                optionId: 'allow-once'
            });
        });

        const backendInternal = backend as unknown as {
            handlePermissionRequest: (params: unknown, requestId: string | number | null) => Promise<unknown>;
        };

        await expect(backendInternal.handlePermissionRequest({
            sessionId: 'session-1',
            toolCall: {
                toolCallId: 'tool-approve',
                title: 'hapi_change_title',
                rawInput: { title: 'Rename chat' }
            },
            options: [
                {
                    optionId: 'allow-once',
                    name: 'Allow once',
                    kind: 'allow_once'
                }
            ]
        }, null)).resolves.toEqual({
            outcome: {
                outcome: 'selected',
                optionId: 'allow-once'
            }
        });

        expect(capturedRequestId).toBe('tool-approve');
    });

    it('uses session/set_model by default (gemini flavor)', async () => {
        const backend = new AcpSdkBackend({ command: 'gemini' });
        const calls: Array<{ method: string; params: unknown }> = [];
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method, params) => {
                calls.push({ method, params });
                return null;
            },
            close: async () => {}
        };

        await backend.setModel('session-1', 'gemini-2.5-pro');

        expect(calls).toEqual([
            { method: 'session/set_model', params: { sessionId: 'session-1', modelId: 'gemini-2.5-pro' } }
        ]);
    });

    it('uses session/set_model when flavor is opencode', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const calls: Array<{ method: string; params: unknown }> = [];
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method, params) => {
                calls.push({ method, params });
                // OpenCode 1.14.30's set_model response: only an opaque _meta block.
                return {
                    _meta: { opencode: { modelId: 'ollama/exaone:4.5-33b-q8', variant: null, availableVariants: [] } }
                };
            },
            close: async () => {}
        };

        await backend.setModel('session-1', 'ollama/exaone:4.5-33b-q8', { flavor: 'opencode' });

        expect(calls).toEqual([
            {
                method: 'session/set_model',
                params: {
                    sessionId: 'session-1',
                    modelId: 'ollama/exaone:4.5-33b-q8'
                }
            }
        ]);
    });

    it('optimistically updates currentModelId when flavor is grok and the response omits it', async () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            // Grok's set_model response carries only an opaque _meta block, like OpenCode.
            sendRequest: async () => ({ _meta: { modelId: 'grok-4.5' } }),
            close: async () => {}
        };

        await backend.setModel('session-1', 'grok-4.5', { flavor: 'grok' });

        expect(backend.getSessionModelsMetadata('session-1')).toEqual({
            availableModels: [],
            currentModelId: 'grok-4.5',
            availableEfforts: undefined,
            currentEffortId: undefined
        });
    });

    it('captures availableModels and currentModelId from session/new response', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        const fixtureModels = [
            { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
            { modelId: 'mlx/qwen3:0.6b', name: 'MLX/Qwen3 0.6B' }
        ];
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 'opencode-session-7',
                        models: {
                            availableModels: fixtureModels,
                            currentModelId: 'ollama/exaone:4.5-33b-q8'
                        }
                    };
                }
                return null;
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });

        expect(sessionId).toBe('opencode-session-7');
        expect(backend.getSessionModelsMetadata(sessionId)).toEqual({
            availableModels: fixtureModels,
            currentModelId: 'ollama/exaone:4.5-33b-q8'
        });
    });

    it('returns undefined session metadata when session/new omits models', async () => {
        const backend = new AcpSdkBackend({ command: 'gemini' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return { sessionId: 'gemini-session-3' };
                }
                return null;
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });

        expect(sessionId).toBe('gemini-session-3');
        expect(backend.getSessionModelsMetadata(sessionId)).toBeUndefined();
    });

    it('optimistically updates currentModelId after a successful opencode setModel call', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        const fixtureModels = [
            { modelId: 'ollama/a', name: 'a' },
            { modelId: 'ollama/b', name: 'b' }
        ];
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 's1',
                        models: { availableModels: fixtureModels, currentModelId: 'ollama/a' }
                    };
                }
                if (method === 'session/set_model') {
                    // OpenCode 1.14.30: response carries only an opaque _meta block.
                    return { _meta: { opencode: { modelId: 'ollama/b' } } };
                }
                return null;
            },
            close: async () => {}
        };

        await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });
        await backend.setModel('s1', 'ollama/b', { flavor: 'opencode' });

        // availableModels list is preserved from session/new; currentModelId is
        // optimistically updated from the requested modelId.
        expect(backend.getSessionModelsMetadata('s1')).toEqual({
            availableModels: fixtureModels,
            currentModelId: 'ollama/b'
        });
    });

    it('captures OpenCode efforts from set_model _meta variants', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 's1',
                        models: {
                            availableModels: [{ modelId: 'openai/o3', name: 'OpenAI/o3' }],
                            currentModelId: 'openai/o3'
                        }
                    };
                }
                if (method === 'session/set_model') {
                    return {
                        _meta: {
                            opencode: {
                                modelId: 'openai/o3',
                                variant: 'high',
                                availableVariants: ['low', 'medium', 'high']
                            }
                        }
                    };
                }
                return null;
            },
            close: async () => {}
        };

        await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });
        await backend.setModel('s1', 'openai/o3/high', { flavor: 'opencode' });

        expect(backend.getSessionModelsMetadata('s1')).toEqual({
            availableModels: [{ modelId: 'openai/o3', name: 'OpenAI/o3' }],
            currentModelId: 'openai/o3/high',
            availableEfforts: [
                { effortId: 'low', name: 'Low' },
                { effortId: 'medium', name: 'Medium' },
                { effortId: 'high', name: 'High' }
            ],
            currentEffortId: 'high'
        });
    });

    it('sets OpenCode effort via session/set_config_option and captures returned config options', async () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const calls: Array<{ method: string; params: unknown }> = [];
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method, params) => {
                calls.push({ method, params });
                return {
                    configOptions: [
                        {
                            id: 'model',
                            currentValue: 'openai/o3',
                            options: [{ value: 'openai/o3', name: 'OpenAI/o3' }]
                        },
                        {
                            id: 'effort',
                            currentValue: 'high',
                            options: [
                                { value: 'low', name: 'Low' },
                                { value: 'high', name: 'High' }
                            ]
                        }
                    ],
                    _meta: {
                        opencode: {
                            modelId: 'openai/o3',
                            variant: 'high',
                            availableVariants: ['low', 'high']
                        }
                    }
                };
            },
            close: async () => {}
        };

        await backend.setConfigOption('s1', 'effort', 'high', { flavor: 'opencode' });

        expect(calls).toEqual([
            {
                method: 'session/set_config_option',
                params: {
                    sessionId: 's1',
                    configId: 'effort',
                    value: 'high'
                }
            }
        ]);
        expect(backend.getSessionModelsMetadata('s1')).toEqual({
            availableModels: [{ modelId: 'openai/o3', name: 'OpenAI/o3' }],
            currentModelId: 'openai/o3',
            currentEffortId: 'high',
            availableEfforts: [{ effortId: 'low', name: 'Low' }, { effortId: 'high', name: 'High' }]
        });
    });


    it('emits available commands and skips invalid entries from session updates', () => {
        const backend = new AcpSdkBackend({ command: 'opencode' });
        const received: unknown[] = [];
        backend.onAvailableCommands((commands) => {
            received.push(commands);
        });

        const backendInternal = backend as unknown as {
            handleSessionUpdate: (params: unknown) => void;
        };

        backendInternal.handleSessionUpdate({
            sessionId: 'session-1',
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: [
                    { name: 'gitnexus:issue', description: 'Create or inspect GitNexus issues' },
                    { name: '' },
                    { description: 'missing name' },
                    null,
                    'not-object',
                    { name: 'md2html', description: 'Convert Markdown to HTML' }
                ]
            }
        });

        expect(received).toEqual([
            [
                { name: 'gitnexus:issue', description: 'Create or inspect GitNexus issues' },
                { name: 'md2html', description: 'Convert Markdown to HTML' }
            ]
        ]);
    });

    it('emits turn_complete after trailing tool updates from the same turn', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 8;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 200;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const messages: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => {
                setTimeout(() => {
                    backendInternal.handleSessionUpdate({
                        sessionId: 'session-1',
                        update: {
                            sessionUpdate: ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
                            content: { type: 'text', text: 'final answer' }
                        }
                    });
                }, 0);

                await sleep(5);

                setTimeout(() => {
                    backendInternal.handleSessionUpdate({
                        sessionId: 'session-1',
                        update: {
                            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCall,
                            toolCallId: 'tool-1',
                            title: 'Read',
                            rawInput: { path: 'README.md' },
                            status: 'in_progress'
                        }
                    });
                }, 3);

                setTimeout(() => {
                    backendInternal.handleSessionUpdate({
                        sessionId: 'session-1',
                        update: {
                            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCallUpdate,
                            toolCallId: 'tool-1',
                            status: 'completed',
                            rawOutput: { ok: true }
                        }
                    });
                }, 6);

                return { stopReason: 'end_turn' };
            },
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hello' }], (message) => {
            messages.push(message);
        });

        expect(messages.map((message) => message.type)).toEqual([
            'text',
            'tool_call',
            'tool_result',
            'turn_complete'
        ]);
    });

    it('emits straggler chunks before turn_complete', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 5;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 30;
        backendStatics.LATE_FLUSH_WINDOW_MS = 500;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const messages: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => {
                // Schedule a late chunk to arrive *after* session/prompt returns,
                // simulating a slow-tailing model that keeps emitting past the
                // initial post-prompt drain.
                setTimeout(() => {
                    backendInternal.handleSessionUpdate({
                        sessionId: 'session-1',
                        update: {
                            sessionUpdate: ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
                            content: { type: 'text', text: 'late tail' }
                        }
                    });
                }, 20);
                return { stopReason: 'end_turn' };
            },
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hi' }], (m) => messages.push(m));

        const lateIdx = messages.findIndex((m) => m.type === 'text' && m.text === 'late tail');
        const turnCompleteIdx = messages.findIndex((m) => m.type === 'turn_complete');

        expect(lateIdx).toBeGreaterThanOrEqual(0);
        expect(turnCompleteIdx).toBeGreaterThan(lateIdx);
    });

    it('attributes pre-prompt straggler chunks to the previous turn\'s onUpdate', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 25;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 200;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 20;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 200;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 10;
        backendStatics.LATE_FLUSH_WINDOW_MS = 30;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const turn1: AgentMessage[] = [];
        const turn2: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => ({ stopReason: 'end_turn' }),
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hi' }], (m) => turn1.push(m));

        // Straggler arrives after turn 1 fully resolved but before turn 2 starts.
        // Pre-prompt drain in turn 2 should route it via turn 1's handler.
        backendInternal.handleSessionUpdate({
            sessionId: 'session-1',
            update: {
                sessionUpdate: ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
                content: { type: 'text', text: 'straggler from turn 1' }
            }
        });

        await backend.prompt('session-1', [{ type: 'text', text: 'again' }], (m) => turn2.push(m));

        const turn1Text = turn1.filter((m): m is Extract<AgentMessage, { type: 'text' }> => m.type === 'text').map((m) => m.text);
        const turn2Text = turn2.filter((m): m is Extract<AgentMessage, { type: 'text' }> => m.type === 'text').map((m) => m.text);

        expect(turn1Text).toContain('straggler from turn 1');
        expect(turn2Text).not.toContain('straggler from turn 1');
    });

    it('exits the late-flush wait once the model is quiet', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 5;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 20;
        backendStatics.LATE_FLUSH_WINDOW_MS = 5000;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
        };

        backendInternal.transport = {
            sendRequest: async () => ({ stopReason: 'end_turn' }),
            close: async () => {}
        };

        const started = Date.now();
        await backend.prompt('session-1', [{ type: 'text', text: 'hi' }], () => {});
        const elapsed = Date.now() - started;

        // With no late chunks arriving, drainLateBuffers should exit on the
        // first quiet check well before the 5s window. Anything under ~500ms
        // proves we're not blocking on the full window.
        expect(elapsed).toBeLessThan(500);
    });

    it('catches stragglers when session/prompt paused before resolving', async () => {
        // Regression: if the model emitted chunks early in the turn, paused,
        // then sent stopReason, lastSessionUpdateAt is already stale when
        // drainLateBuffers starts. It must anchor the quiet window to entry
        // time, not just lastSessionUpdateAt, otherwise a chunk arriving just
        // after session/prompt resolves is missed.
        backendStatics.UPDATE_QUIET_PERIOD_MS = 5;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 50;
        backendStatics.LATE_FLUSH_WINDOW_MS = 500;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const messages: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => {
                // Chunk arrives early, then a long pause stales lastSessionUpdateAt.
                backendInternal.handleSessionUpdate({
                    sessionId: 'session-1',
                    update: {
                        sessionUpdate: ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
                        content: { type: 'text', text: 'early' }
                    }
                });
                await sleep(200);
                // After sendRequest resolves, schedule a straggler.
                setTimeout(() => {
                    backendInternal.handleSessionUpdate({
                        sessionId: 'session-1',
                        update: {
                            sessionUpdate: ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
                            content: { type: 'text', text: 'post-pause straggler' }
                        }
                    });
                }, 10);
                return { stopReason: 'end_turn' };
            },
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hi' }], (m) => messages.push(m));

        const stragglerIdx = messages.findIndex((m) => m.type === 'text' && m.text === 'post-pause straggler');
        const turnCompleteIdx = messages.findIndex((m) => m.type === 'turn_complete');

        expect(stragglerIdx).toBeGreaterThanOrEqual(0);
        expect(turnCompleteIdx).toBeGreaterThan(stragglerIdx);
    });

    it('emits a context-only usage mid-turn so the status bar updates live', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 25;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 200;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 10;
        backendStatics.LATE_FLUSH_WINDOW_MS = 50;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const messages: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => {
                backendInternal.handleSessionUpdate({
                    sessionId: 'session-1',
                    update: { sessionUpdate: 'usage_update', used: 1_000, size: 200_000 }
                });
                backendInternal.handleSessionUpdate({
                    sessionId: 'session-1',
                    update: { sessionUpdate: 'usage_update', used: 1_000, size: 200_000 }
                });
                backendInternal.handleSessionUpdate({
                    sessionId: 'session-1',
                    update: { sessionUpdate: 'usage_update', used: 2_500, size: 200_000 }
                });
                await sleep(5);
                return {
                    stopReason: 'end_turn',
                    usage: { inputTokens: 100, outputTokens: 50 }
                };
            },
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hello' }], (m) => messages.push(m));

        const usageMessages = messages.filter((m): m is Extract<AgentMessage, { type: 'usage' }> => m.type === 'usage');
        // Two mid-turn ticks (deduped second 1_000) + one final emit with the
        // prompt-level input/output totals.
        expect(usageMessages.length).toBe(3);
        expect(usageMessages[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, contextTokens: 1_000, contextWindow: 200_000 });
        expect(usageMessages[1]).toMatchObject({ inputTokens: 0, outputTokens: 0, contextTokens: 2_500, contextWindow: 200_000 });
        expect(usageMessages[2]).toMatchObject({ inputTokens: 100, outputTokens: 50, contextTokens: 2_500, contextWindow: 200_000 });
    });

    it('captures the initial available-commands snapshot (as seen from the initialize response)', () => {
        // initialize() always constructs its own AcpStdioTransport (guarded by
        // `if (this.transport) return`), so it cannot be exercised through the
        // manual-transport-injection pattern the other tests use. Exercise the
        // private capture method directly instead, mirroring how
        // handleSessionUpdate/handlePermissionRequest are tested above.
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            captureAvailableCommands: (sessionId: string | null, source: unknown) => void;
        };

        backendInternal.captureAvailableCommands(null, {
            availableCommands: [{ name: 'auto' }, { name: 'always-approve' }]
        });

        expect(backend.hasAvailableCommand('any-session', 'auto')).toBe(true);
        expect(backend.hasAvailableCommand('any-session', 'always-approve')).toBe(true);
        expect(backend.hasAvailableCommand('any-session', 'unknown-command')).toBe(false);
    });

    it('scopes available commands captured from session/new to that session only', async () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 'grok-session-9',
                        availableCommands: [{ name: 'auto' }]
                    };
                }
                return null;
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });

        expect(backend.hasAvailableCommand(sessionId, 'auto')).toBe(true);
        expect(backend.hasAvailableCommand('other-session', 'auto')).toBe(false);
    });

    it('treats auto_permission_mode_enabled settings updates as an available "auto" command', () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            handleSettingsUpdate: (params: unknown) => void;
        };

        expect(backend.hasAvailableCommand('session-1', 'auto')).toBe(false);
        backendInternal.handleSettingsUpdate({ auto_permission_mode_enabled: true });
        expect(backend.hasAvailableCommand('session-1', 'auto')).toBe(true);
    });

    it('captures Grok reasoning-effort options from _meta[\'x.ai/sessionConfig\'] on session/new', async () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 'grok-session-5',
                        _meta: {
                            'x.ai/sessionConfig': {
                                options: [
                                    { id: 'low', category: 'mode', label: 'Low' },
                                    { id: 'high', category: 'mode', label: 'High', selected: true },
                                    { id: 'unrelated', category: 'other' }
                                ]
                            }
                        }
                    };
                }
                return null;
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });

        expect(backend.getThoughtLevelConfigOption(sessionId)).toEqual({
            currentValue: 'high',
            options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }]
        });
    });

    it('updates the cached thought-level currentValue after a successful session/set_mode call', async () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        const calls: Array<{ method: string; params: unknown }> = [];
        backendInternal.transport = {
            sendRequest: async (method, params) => {
                calls.push({ method, params });
                if (method === 'session/new') {
                    return {
                        sessionId: 'grok-session-6',
                        _meta: {
                            'x.ai/sessionConfig': {
                                options: [
                                    { id: 'low', category: 'mode', label: 'Low', selected: true },
                                    { id: 'high', category: 'mode', label: 'High' }
                                ]
                            }
                        }
                    };
                }
                return {};
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });
        await backend.setMode(sessionId, 'high');

        expect(calls).toContainEqual({
            method: 'session/set_mode',
            params: { sessionId, modeId: 'high' }
        });
        expect(backend.getThoughtLevelConfigOption(sessionId)?.currentValue).toBe('high');
    });

    it('captures reasoningEfforts per model from session/new availableModels', async () => {
        const backend = new AcpSdkBackend({ command: 'grok' });
        const backendInternal = backend as unknown as {
            transport: { sendRequest: (method: string, params: unknown) => Promise<unknown>; close: () => Promise<void> } | null;
        };
        backendInternal.transport = {
            sendRequest: async (method) => {
                if (method === 'session/new') {
                    return {
                        sessionId: 'grok-session-8',
                        availableModels: [
                            {
                                modelId: 'grok-4.5',
                                name: 'Grok 4.5',
                                _meta: {
                                    reasoningEfforts: [
                                        { value: 'low', label: 'Low' },
                                        { value: 'high', label: 'High', default: true }
                                    ]
                                }
                            },
                            { modelId: 'grok-build' }
                        ],
                        currentModelId: 'grok-4.5'
                    };
                }
                return null;
            },
            close: async () => {}
        };

        const sessionId = await backend.newSession({ cwd: '/tmp/x', mcpServers: [] });

        expect(backend.getSessionModelsMetadata(sessionId)).toEqual({
            availableModels: [
                {
                    modelId: 'grok-4.5',
                    name: 'Grok 4.5',
                    reasoningEfforts: [
                        { value: 'low', name: 'Low', isDefault: false },
                        { value: 'high', name: 'High', isDefault: true }
                    ]
                },
                { modelId: 'grok-build' }
            ],
            currentModelId: 'grok-4.5'
        });
    });

    it('emits a context-only usage on finalize when the prompt response carries no usage', async () => {
        backendStatics.UPDATE_QUIET_PERIOD_MS = 25;
        backendStatics.UPDATE_DRAIN_TIMEOUT_MS = 200;
        backendStatics.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 1;
        backendStatics.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 50;
        backendStatics.LATE_FLUSH_INTERVAL_MS = 5;
        backendStatics.LATE_FLUSH_QUIET_PERIOD_MS = 10;
        backendStatics.LATE_FLUSH_WINDOW_MS = 50;

        const backend = new AcpSdkBackend({ command: 'opencode' });
        const backendInternal = backend as unknown as {
            transport: {
                sendRequest: (...args: unknown[]) => Promise<unknown>;
                close: () => Promise<void>;
            } | null;
            handleSessionUpdate: (params: unknown) => void;
        };

        const messages: AgentMessage[] = [];
        backendInternal.transport = {
            sendRequest: async () => {
                backendInternal.handleSessionUpdate({
                    sessionId: 'session-1',
                    update: { sessionUpdate: 'usage_update', used: 4_200, size: 200_000 }
                });
                await sleep(5);
                return { stopReason: 'end_turn' };
            },
            close: async () => {}
        };

        await backend.prompt('session-1', [{ type: 'text', text: 'hi' }], (m) => messages.push(m));

        const usageMessages = messages.filter((m): m is Extract<AgentMessage, { type: 'usage' }> => m.type === 'usage');
        expect(usageMessages.length).toBe(2);
        for (const usage of usageMessages) {
            expect(usage).toMatchObject({
                inputTokens: 0,
                outputTokens: 0,
                contextTokens: 4_200,
                contextWindow: 200_000
            });
        }
    });
});
