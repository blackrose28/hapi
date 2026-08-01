import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from '../sdk/prompts';
import type { Session } from '../session';

function createFakeSession() {
    const queueItems: { message: string; mode: unknown }[] = [];
    let permissionRpcHandler: ((response: any) => Promise<void>) | null = null;

    const session = {
        client: {
            rpcHandlerManager: {
                registerHandler: vi.fn((method: string, handler: (response: any) => Promise<void>) => {
                    if (method === 'permission') permissionRpcHandler = handler;
                }),
            },
            updateAgentState: vi.fn(),
        },
        queue: {
            unshift: vi.fn((message: string, mode: unknown) => {
                queueItems.push({ message, mode });
            }),
        },
        setPermissionMode: vi.fn(),
    } as unknown as Session;

    return { session, queueItems, submitPermissionResponse: (response: any) => permissionRpcHandler!(response) };
}

describe('PermissionHandler — YOLO plan mode', () => {
    it('injects PLAN_FAKE_RESTART and denies exit_plan_mode in bypassPermissions', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        // Simulate Claude emitting an assistant message with exit_plan_mode tool_use
        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-1', name: 'exit_plan_mode', input: {} }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'exit_plan_mode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        // Should deny with PLAN_FAKE_REJECT (so Claude restarts)
        expect(result.behavior).toBe('deny');
        expect(result).toEqual({ behavior: 'deny', message: PLAN_FAKE_REJECT });

        // Should inject PLAN_FAKE_RESTART into the queue
        expect(queueItems).toHaveLength(1);
        expect(queueItems[0].message).toBe(PLAN_FAKE_RESTART);
        expect(queueItems[0].mode).toEqual({ permissionMode: 'bypassPermissions' });
    });

    it('injects PLAN_FAKE_RESTART for ExitPlanMode variant', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-2', name: 'ExitPlanMode', input: {} }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'ExitPlanMode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('deny');
        expect(result).toEqual({ behavior: 'deny', message: PLAN_FAKE_REJECT });
        expect(queueItems).toHaveLength(1);
        expect(queueItems[0].message).toBe(PLAN_FAKE_RESTART);
    });

    it('allows normal tools in bypassPermissions without queue injection', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-3', name: 'Bash', input: { command: 'ls' } }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('allow');
        expect(queueItems).toHaveLength(0);
    });
});

describe('PermissionHandler — AskUserQuestion', () => {
    it('resolves by toolUseId even when the SDK normalizes input (e.g. adds multiSelect) between recording and the permission request', async () => {
        const { session, submitPermissionResponse } = createFakeSession();
        const handler = new PermissionHandler(session);

        const recordedInput = {
            questions: [{ question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }]
        };
        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-q1', name: 'AskUserQuestion', input: recordedInput }],
            },
        } as any);

        // Input as it arrives in the can_use_tool control request differs
        // (SDK-added multiSelect) from what was recorded above — a deepEqual
        // match would fail, so this only resolves because toolUseId is used.
        const normalizedInput = {
            questions: [{ question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }]
        };

        const resultPromise = handler.handleToolCall(
            'AskUserQuestion',
            normalizedInput,
            { permissionMode: 'default' } as any,
            { signal: new AbortController().signal, toolUseId: 'tc-q1' }
        );

        await submitPermissionResponse({ id: 'tc-q1', approved: true, answers: { '0': ['A'] } });
        const result = await resultPromise;

        expect(result.behavior).toBe('allow');
        // Answers must be remapped from index ("0") to the literal question
        // text, matching what the built-in AskUserQuestion tool looks up.
        expect((result as any).updatedInput.answers).toEqual({ 'Pick one?': ['A'] });
    });

    it('remaps multiple index-keyed answers to their question text', async () => {
        const { session, submitPermissionResponse } = createFakeSession();
        const handler = new PermissionHandler(session);

        const input = {
            questions: [
                { question: 'First?', options: [{ label: 'A' }, { label: 'B' }] },
                { question: 'Second?', options: [{ label: 'C' }, { label: 'D' }] }
            ]
        };
        handler.onMessage({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc-q2', name: 'AskUserQuestion', input }] },
        } as any);

        const resultPromise = handler.handleToolCall(
            'AskUserQuestion',
            input,
            { permissionMode: 'default' } as any,
            { signal: new AbortController().signal, toolUseId: 'tc-q2' }
        );

        await submitPermissionResponse({ id: 'tc-q2', approved: true, answers: { '0': ['A'], '1': ['D'] } });
        const result = await resultPromise;

        expect(result.behavior).toBe('allow');
        expect((result as any).updatedInput.answers).toEqual({ 'First?': ['A'], 'Second?': ['D'] });
    });
});
