import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageQueue2 } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

type Harness = {
    userMessageHandler: null | ((message: { content: { text: string; attachments?: unknown[] } }, localId?: string) => void);
    sentAgentMessages: unknown[];
    queuedBatch: null | { message: string; mode: EnhancedMode; isolate: boolean; hash: string };
};

function getHarness(): Harness {
    const globalWithHarness = globalThis as typeof globalThis & { __runCodexGoalHarness?: Harness };
    globalWithHarness.__runCodexGoalHarness ??= {
        userMessageHandler: null,
        sentAgentMessages: [],
        queuedBatch: null
    };
    return globalWithHarness.__runCodexGoalHarness;
}

vi.mock('@/utils/invokedCwd', () => ({
    getInvokedCwd: () => '/tmp/hapi-codex-goal-test'
}));

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: async () => ({
        api: {},
        session: {
            onUserMessage(handler: (message: { content: { text: string; attachments?: unknown[] } }, localId?: string) => void) {
                getHarness().userMessageHandler = handler;
            },
            sendAgentMessage(message: unknown) {
                getHarness().sentAgentMessages.push(message);
            },
            emitMessagesConsumed() {},
            onCancelQueuedMessage() {},
            rpcHandlerManager: {
                registerHandler() {}
            }
        }
    })
}));

vi.mock('@/agent/runnerLifecycle', () => ({
    createModeChangeHandler: () => () => {},
    setControlledByUser: () => {},
    createRunnerLifecycle: () => ({
        registerProcessHandlers() {},
        markCrash() {},
        setExitCode() {},
        setArchiveReason() {},
        setSessionEndReason() {},
        cleanupAndExit: async () => {}
    })
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: () => {}
}));

vi.mock('@/modules/common/slashCommands', () => ({
    listSlashCommands: async () => [
        { name: 'goal', source: 'project', content: 'CUSTOM GOAL PROMPT' }
    ]
}));

vi.mock('./loop', () => ({
    loop: async (options: { messageQueue: MessageQueue2<EnhancedMode> }) => {
        const harness = getHarness();
        harness.userMessageHandler?.({ content: { text: '/goal ship the feature', attachments: [] } }, 'local-1');
        for (let attempt = 0; attempt < 20 && options.messageQueue.size() === 0; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        harness.queuedBatch = await options.messageQueue.waitForMessagesAndGetAsString();
    }
}));

import { runCodex } from './runCodex';

describe('runCodex /goal queueing', () => {
    afterEach(() => {
        const harness = getHarness();
        harness.userMessageHandler = null;
        harness.sentAgentMessages = [];
        harness.queuedBatch = null;
        vi.clearAllMocks();
    });

    it('queues /goal unchanged and isolated before custom prompt expansion', async () => {
        await runCodex({ startedBy: 'runner' });

        const harness = getHarness();
        expect(harness.queuedBatch).toMatchObject({
            message: '/goal ship the feature',
            isolate: true
        });
        expect(harness.sentAgentMessages).not.toContainEqual(expect.objectContaining({
            message: expect.stringContaining('Expanded /goal')
        }));
    });
});
