import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { GrokMode } from './types';

const harness = vi.hoisted(() => ({
    setModels: [] as Array<{ sessionId: string; modelId: string; flavor?: string }>,
    setConfigOptions: [] as Array<{ sessionId: string; configId: string; value: string; flavor?: string }>,
    prompts: [] as unknown[][],
    stderrHandler: null as null | ((error: { message: string; raw: string }) => void),
    sessionInfoUpdateHandler: null as null | ((update: { sessionId: string | null; title: string | null }) => void),
    nativeTitle: null as string | null,
    nativeTitleSent: false
}));

vi.mock('./utils/grokBackend', () => ({
    createGrokBackend: vi.fn(() => ({
        initialize: vi.fn(async () => {}),
        newSession: vi.fn(async () => 'grok-session-1'),
        loadSession: vi.fn(async () => 'grok-session-1'),
        setModel: vi.fn(async (sessionId: string, modelId: string, opts?: { flavor?: string }) => {
            harness.setModels.push({ sessionId, modelId, flavor: opts?.flavor });
        }),
        setConfigOption: vi.fn(async (sessionId: string, configId: string, value: string, opts?: { flavor?: string }) => {
            harness.setConfigOptions.push({ sessionId, configId, value, flavor: opts?.flavor });
        }),
        prompt: vi.fn(async (_sessionId: string, content: unknown[]) => {
            harness.prompts.push(content);
            if (harness.nativeTitle !== null && !harness.nativeTitleSent) {
                harness.nativeTitleSent = true;
                harness.sessionInfoUpdateHandler?.({ sessionId: 'grok-session-1', title: harness.nativeTitle });
            }
            if (harness.prompts.length === 1) {
                harness.stderrHandler?.({
                    message: 'status=402 Payment Required model_id=grok-build spending-limit',
                    raw: 'status=402 Payment Required model_id=grok-build spending-limit'
                });
            }
        }),
        cancelPrompt: vi.fn(async () => {}),
        respondToPermission: vi.fn(async () => {}),
        onStderrError: vi.fn((handler) => { harness.stderrHandler = handler; }),
        setSessionInfoUpdateListener: vi.fn((handler) => { harness.sessionInfoUpdateHandler = handler; }),
        onPermissionRequest: vi.fn(),
        disconnect: vi.fn(async () => {}),
        refreshSessionInfo: vi.fn(async () => {}),
        getSessionModelsMetadata: vi.fn(() => ({
            availableModels: [{ modelId: 'grok-a' }, { modelId: 'grok-b' }],
            currentModelId: 'grok-a',
            availableEfforts: [{ effortId: 'low' }, { effortId: 'medium' }, { effortId: 'high' }],
            currentEffortId: 'low'
        }))
    })),
    formatGrokError: (error: unknown) => error instanceof Error ? error.message : String(error),
    isGrokBuildAuxiliaryQuotaError: (value: string, activeModel?: string | null) => (
        activeModel !== 'grok-build'
        && value.includes('402 Payment Required')
        && value.includes('model_id=grok-build')
    )
}));

vi.mock('@/codex/utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({ server: { stop: () => {} }, mcpServers: {} })
}));
vi.mock('./utils/permissionHandler', () => ({
    GrokPermissionHandler: class { async cancelAll(): Promise<void> {} }
}));
vi.mock('@/ui/ink/GrokDisplay', () => ({ GrokDisplay: () => null }));
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

import { grokRemoteLauncher } from './grokRemoteLauncher';

function createSession() {
    const queue = new MessageQueue2<GrokMode>((mode) => JSON.stringify(mode));
    queue.pushIsolateAndClear('first', { permissionMode: 'default', model: 'grok-a', effort: 'low' });
    queue.push('second', { permissionMode: 'default', model: 'grok-b', effort: 'medium' });
    queue.close();
    const rpcHandlers = new Map<string, () => unknown>();
    const session = {
        path: '/tmp/grok-test',
        logPath: '/tmp/grok-test/test.log',
        client: {
            rpcHandlerManager: {
                registerHandler(method: string, handler: () => unknown) { rpcHandlers.set(method, handler); }
            },
            sendAgentMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn()
        },
        queue,
        sessionId: null as string | null,
        thinking: false,
        getPermissionMode: () => 'default' as const,
        registerExistingNativeSession(id: string) { session.sessionId = id; },
        setModel: vi.fn(),
        setEffort: vi.fn(),
        setPermissionMode: vi.fn(),
        pushKeepAlive: vi.fn(),
        onThinkingChange(thinking: boolean) { session.thinking = thinking; },
        sendAgentMessage: vi.fn(),
        sendSessionEvent: vi.fn()
    };
    return { session, rpcHandlers };
}

describe('grokRemoteLauncher runtime config', () => {
    afterEach(() => {
        harness.setModels = [];
        harness.setConfigOptions = [];
        harness.prompts = [];
        harness.stderrHandler = null;
        harness.sessionInfoUpdateHandler = null;
        harness.nativeTitle = null;
        harness.nativeTitleSent = false;
    });

    it('switches model and effort between turns and exposes session catalogs', async () => {
        const { session, rpcHandlers } = createSession();
        const discovered: unknown[] = [];

        await grokRemoteLauncher(session as never, {
            model: 'grok-a',
            effort: 'low',
            onConfigDiscovered: (config) => discovered.push(config)
        });

        expect(discovered).toEqual([{ model: 'grok-a', effort: 'low' }]);
        expect(harness.setModels).toEqual([
            { sessionId: 'grok-session-1', modelId: 'grok-b', flavor: 'grok' }
        ]);
        expect(harness.setConfigOptions).toEqual([
            { sessionId: 'grok-session-1', configId: 'effort', value: 'medium', flavor: 'grok' }
        ]);
        expect(harness.prompts).toHaveLength(2);
        // The non-fatal grok-build title-quota stderr on the first prompt must
        // never surface as a session message.
        expect(session.sendSessionEvent).not.toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('402 Payment Required')
        }));
        expect(JSON.stringify(harness.prompts[0])).toContain('hapi_change_title');
        expect(JSON.stringify(harness.prompts[1])).not.toContain('hapi_change_title');
        expect(await rpcHandlers.get('listGrokModels')?.()).toMatchObject({ success: true, currentModelId: 'grok-a' });
        expect(await rpcHandlers.get('listGrokReasoningEffortOptions')?.()).toMatchObject({ success: true, currentValue: 'low' });
    });

    it('injects the plan-mode instruction for non-slash messages in plan mode', async () => {
        const { session } = createSession();
        session.queue.reset();
        session.queue.push('plan-1', { permissionMode: 'plan', model: 'grok-a', effort: 'low' });
        session.queue.close();

        await grokRemoteLauncher(session as never, { model: 'grok-a', effort: 'low' });

        expect(JSON.stringify(harness.prompts[0])).toContain('Work in plan-only mode');
    });

    it('forwards ACP native titles while retaining the prompt fallback', async () => {
        harness.nativeTitle = 'Native Grok title';
        const { session } = createSession();

        await grokRemoteLauncher(session as never, { model: 'grok-a', effort: 'low' });

        expect(session.client.sendClaudeSessionMessage).toHaveBeenCalledWith({
            type: 'summary',
            summary: 'Native Grok title',
            leafUuid: expect.any(String)
        });
        expect(JSON.stringify(harness.prompts[0])).toContain('hapi_change_title');
    });
});
