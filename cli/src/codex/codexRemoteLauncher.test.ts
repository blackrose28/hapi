import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

type Harness = {
    notifications: Array<{ method: string; params: unknown }>;
    registerRequestCalls: string[];
    initializeCalls: unknown[];
    startThreadIds: string[];
    resumeThreadIds: string[];
    startTurnThreadIds: string[];
    interruptedTurns: Array<{ threadId: string; turnId: string }>;
    compactThreadIds: string[];
    setGoalCalls: Array<{ threadId: string; objective?: string | null; status?: string | null; tokenBudget?: number | null }>;
    getGoalCalls: string[];
    clearGoalCalls: string[];
    currentGoal: null | {
        threadId: string;
        objective: string;
        status: string;
        tokenBudget: number | null;
        tokensUsed: number;
        timeUsedSeconds: number;
        createdAt: number;
        updatedAt: number;
    };
    failGoalApi: boolean;
    clearGoalReturnsFalse: boolean;
    suppressTurnCompletion: boolean;
    remainingThreadSystemErrors: number;
    startTurnMessages: string[];
    failResumeThreadIds: string[];
    nextThreadSystemErrorMessage: string | null;
    failNextCompact: boolean;
    deferThreadStatusNotifications: boolean;
    emitChildThreadEvents: boolean;
    emitChildUsageEvents: boolean;
    emitChildReasoningBurst: boolean;
    emitChildDoneStatusWithoutMessage: boolean;
    emitChildWaitStructuredOutput: boolean;
    emitChildTaskCompleteBeforeMessage: boolean;
    suppressChildTaskCompleteEvent: boolean;
    emitSecondChildMessage: boolean;
    emitLateChildCommandAfterParentTool: boolean;
    emitParentUsageEvents: boolean;
    emitChildNestedAgentTool: boolean;
    emitParentTitleChange: boolean;
    emitParentSpawnFailureWithoutAgentId: boolean;
    emitParentSpawnStartWithoutEnd: boolean;
    emitParentSendInputFailure: boolean;
    emitParentResumeSuccess: boolean;
    bridgeOptions: unknown[];
};

function getHarness(): Harness {
    const globalWithHarness = globalThis as typeof globalThis & { __codexRemoteLauncherHarness?: Harness };
    globalWithHarness.__codexRemoteLauncherHarness ??= {
        notifications: [],
        registerRequestCalls: [],
        initializeCalls: [],
        startThreadIds: [],
        resumeThreadIds: [],
        startTurnThreadIds: [],
        interruptedTurns: [],
        compactThreadIds: [],
        setGoalCalls: [],
        getGoalCalls: [],
        clearGoalCalls: [],
        currentGoal: null,
        failGoalApi: false,
        clearGoalReturnsFalse: false,
        suppressTurnCompletion: false,
        remainingThreadSystemErrors: 0,
        startTurnMessages: [],
        failResumeThreadIds: [],
        nextThreadSystemErrorMessage: null,
        failNextCompact: false,
        deferThreadStatusNotifications: false,
        emitChildThreadEvents: false,
        emitChildUsageEvents: false,
        emitChildReasoningBurst: false,
        emitChildDoneStatusWithoutMessage: false,
        emitChildWaitStructuredOutput: false,
        emitChildTaskCompleteBeforeMessage: false,
        suppressChildTaskCompleteEvent: false,
        emitSecondChildMessage: false,
        emitLateChildCommandAfterParentTool: false,
        emitParentUsageEvents: false,
        emitChildNestedAgentTool: false,
        emitParentTitleChange: false,
        emitParentSpawnFailureWithoutAgentId: false,
        emitParentSpawnStartWithoutEnd: false,
        emitParentSendInputFailure: false,
        emitParentResumeSuccess: false,
        bridgeOptions: []
    };
    return globalWithHarness.__codexRemoteLauncherHarness;
}

const harness = getHarness();

vi.mock('./codexAppServerClient', () => {
    class MockCodexAppServerClient {
        private notificationHandler: ((method: string, params: unknown) => void) | null = null;

        async connect(): Promise<void> {}

        async initialize(params: unknown): Promise<{ protocolVersion: number }> {
            harness.initializeCalls.push(params);
            return { protocolVersion: 1 };
        }

        setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
            this.notificationHandler = handler;
        }

        registerRequestHandler(method: string): void {
            harness.registerRequestCalls.push(method);
        }

        async startThread(): Promise<{ thread: { id: string }; model: string }> {
            const id = `thread-${harness.startThreadIds.length + 1}`;
            harness.startThreadIds.push(id);
            return { thread: { id }, model: 'gpt-5.4' };
        }

        async resumeThread(params?: { threadId?: string }): Promise<{ thread: { id: string }; model: string }> {
            const id = params?.threadId ?? 'thread-resumed';
            harness.resumeThreadIds.push(id);
            return { thread: { id }, model: 'gpt-5.4' };
        }

        async startTurn(params?: { threadId?: string }): Promise<{ turn: { id?: string } }> {
            const threadId = params?.threadId ?? 'thread-unknown';
            harness.startTurnThreadIds.push(threadId);
            const turnId = `turn-${harness.startTurnThreadIds.length}`;
            const started = { turn: { id: turnId } };
            harness.notifications.push({ method: 'turn/started', params: started });
            this.notificationHandler?.('turn/started', started);

            if (harness.remainingThreadSystemErrors > 0) {
                harness.remainingThreadSystemErrors -= 1;
                const failed = {
                    thread: { id: threadId },
                    status: { type: 'systemError' }
                };
                harness.notifications.push({ method: 'thread/status/changed', params: failed });
                this.notificationHandler?.('thread/status/changed', failed);
                return { turn: { id: turnId } };
            }

            if (
                harness.emitRunningChildTurnBeforeSuppressedParent
                || harness.emitCompletedChildTurnBeforeSuppressedParent
            ) {
                const childStarted = {
                    msg: {
                        type: 'task_started',
                        thread_id: 'child-thread',
                        turn_id: 'child-turn'
                    }
                };
                harness.notifications.push({ method: 'codex/event/task_started', params: childStarted });
                this.notificationHandler?.('codex/event/task_started', childStarted);

                if (harness.emitCompletedChildTurnBeforeSuppressedParent) {
                    const childCompleted = {
                        msg: {
                            type: 'task_complete',
                            thread_id: 'child-thread',
                            turn_id: 'child-turn'
                        }
                    };
                    harness.notifications.push({ method: 'codex/event/task_complete', params: childCompleted });
                    this.notificationHandler?.('codex/event/task_complete', childCompleted);
                }
            }

            if (harness.suppressTurnCompletion) {
                return { turn: { id: turnId } };
            }

            if (params?.threadId === 'thread-1') {
                const commandStart = {
                    item: {
                        id: 'cmd-1',
                        type: 'commandExecution',
                        command: 'echo ok',
                        cwd: '/tmp/hapi-update'
                    }
                };
                harness.notifications.push({ method: 'item/started', params: commandStart });
                this.notificationHandler?.('item/started', commandStart);
                this.notificationHandler?.('item/commandExecution/outputDelta', {
                    itemId: 'cmd-1',
                    delta: 'ok\n'
                });
                const commandEnd = {
                    item: {
                        id: 'cmd-1',
                        type: 'commandExecution',
                        exitCode: 0
                    }
                };
                harness.notifications.push({ method: 'item/completed', params: commandEnd });
                this.notificationHandler?.('item/completed', commandEnd);

                if (harness.emitParentUsageEvents) {
                    const parentUsage = {
                        tokenUsage: {
                            thread_id: threadId,
                            turn_id: turnId,
                            last_token_usage: {
                                input_tokens: 100,
                                output_tokens: 10
                            },
                            model_context_window: 200_000
                        }
                    };
                    harness.notifications.push({ method: 'thread/tokenUsage/updated', params: parentUsage });
                    this.notificationHandler?.('thread/tokenUsage/updated', parentUsage);

                    const parentCompact = { thread: { id: threadId } };
                    harness.notifications.push({ method: 'thread/compacted', params: parentCompact });
                    this.notificationHandler?.('thread/compacted', parentCompact);
                }

                if (harness.emitParentSpawnFailureWithoutAgentId || harness.emitParentSpawnStartWithoutEnd) {
                    const spawnStart = {
                        item: {
                            id: 'failed-spawn',
                            type: 'collabAgentToolCall',
                            tool: 'spawnAgent',
                            prompt: 'do side work',
                            reasoningEffort: 'medium',
                            senderThreadId: threadId,
                            receiverThreadIds: []
                        },
                        threadId,
                        turnId
                    };
                    harness.notifications.push({ method: 'item/started', params: spawnStart });
                    this.notificationHandler?.('item/started', spawnStart);

                    if (harness.emitParentSpawnFailureWithoutAgentId) {
                        const spawnCompleted = {
                            item: {
                                id: 'failed-spawn',
                                type: 'collabAgentToolCall',
                                tool: 'spawnAgent',
                                status: 'failed',
                                error: 'invalid spawn arguments',
                                senderThreadId: threadId,
                                receiverThreadIds: [],
                                agentsStates: {}
                            },
                            threadId,
                            turnId
                        };
                        harness.notifications.push({ method: 'item/completed', params: spawnCompleted });
                        this.notificationHandler?.('item/completed', spawnCompleted);
                    }
                }
            }

            if (harness.emitChildThreadEvents) {
                const childThreadId = 'child-thread';
                const childTurnId = 'child-turn';
                const childMessage = 'child output should stay hidden';
                const secondChildMessage = 'final child output should win';

                const emitChildDone = () => {
                    const childDone = {
                        msg: {
                            type: 'task_complete',
                            thread_id: childThreadId,
                            turn_id: childTurnId
                        }
                    };
                    harness.notifications.push({ method: 'codex/event/task_complete', params: childDone });
                    this.notificationHandler?.('codex/event/task_complete', childDone);
                };

                if (harness.emitChildReasoningBurst) {
                    for (let i = 0; i < 20; i += 1) {
                        const reasoningDelta = {
                            msg: {
                                type: 'reasoning_content_delta',
                                item_id: 'child-reasoning',
                                delta: `step-${i} `,
                                thread_id: childThreadId,
                                turn_id: childTurnId
                            }
                        };
                        harness.notifications.push({ method: 'codex/event/reasoning_content_delta', params: reasoningDelta });
                        this.notificationHandler?.('codex/event/reasoning_content_delta', reasoningDelta);
                    }
                }

                if (harness.emitChildDoneStatusWithoutMessage && harness.emitChildTaskCompleteBeforeMessage) {
                    emitChildDone();
                }

                const childMessageCompleted = {
                    item: {
                        id: 'child-msg-1',
                        type: 'agentMessage',
                        content: [{ type: 'text', text: childMessage }]
                    },
                    threadId: childThreadId,
                    turnId: childTurnId
                };
                harness.notifications.push({ method: 'item/completed', params: childMessageCompleted });
                this.notificationHandler?.('item/completed', childMessageCompleted);

                if (harness.emitSecondChildMessage) {
                    const secondChildMessageCompleted = {
                        item: {
                            id: 'child-msg-2',
                            type: 'agentMessage',
                            content: [{ type: 'text', text: secondChildMessage }]
                        },
                        threadId: childThreadId,
                        turnId: childTurnId
                    };
                    harness.notifications.push({ method: 'item/completed', params: secondChildMessageCompleted });
                    this.notificationHandler?.('item/completed', secondChildMessageCompleted);
                }

                if (
                    harness.emitChildDoneStatusWithoutMessage
                    && !harness.emitChildTaskCompleteBeforeMessage
                    && !harness.suppressChildTaskCompleteEvent
                ) {
                    emitChildDone();
                }

                if (harness.emitChildUsageEvents) {
                    const childUsage = {
                        tokenUsage: {
                            thread_id: childThreadId,
                            turn_id: childTurnId,
                            last_token_usage: {
                                input_tokens: 30,
                                output_tokens: 3
                            },
                            model_context_window: 200_000
                        }
                    };
                    harness.notifications.push({ method: 'thread/tokenUsage/updated', params: childUsage });
                    this.notificationHandler?.('thread/tokenUsage/updated', childUsage);

                    const childCompact = {
                        msg: {
                            type: 'context_compacted',
                            thread_id: childThreadId,
                            turn_id: childTurnId
                        }
                    };
                    harness.notifications.push({ method: 'codex/event/context_compacted', params: childCompact });
                    this.notificationHandler?.('codex/event/context_compacted', childCompact);

                    const ambiguousUsage = {
                        tokenUsage: {
                            last_token_usage: {
                                input_tokens: 999,
                                output_tokens: 1
                            }
                        }
                    };
                    harness.notifications.push({ method: 'thread/tokenUsage/updated', params: ambiguousUsage });
                    this.notificationHandler?.('thread/tokenUsage/updated', ambiguousUsage);
                }

                const childCommandStart = {
                    item: {
                        id: 'child-cmd-1',
                        type: 'commandExecution',
                        command: 'echo child'
                    },
                    threadId: childThreadId,
                    turnId: childTurnId
                };
                harness.notifications.push({ method: 'item/started', params: childCommandStart });
                this.notificationHandler?.('item/started', childCommandStart);
                this.notificationHandler?.('item/commandExecution/outputDelta', {
                    itemId: 'child-cmd-1',
                    delta: 'child stdout\n',
                    threadId: childThreadId,
                    turnId: childTurnId
                });
                const childCommandEnd = {
                    item: {
                        id: 'child-cmd-1',
                        type: 'commandExecution',
                        exitCode: 0
                    },
                    threadId: childThreadId,
                    turnId: childTurnId
                };
                harness.notifications.push({ method: 'item/completed', params: childCommandEnd });
                this.notificationHandler?.('item/completed', childCommandEnd);

                const childTitleStart = {
                    item: {
                        id: 'title-child',
                        type: 'mcpToolCall',
                        server: 'hapi',
                        tool: 'change_title',
                        arguments: { title: 'Child Title' }
                    },
                    threadId: childThreadId,
                    turnId: childTurnId
                };
                harness.notifications.push({ method: 'item/started', params: childTitleStart });
                this.notificationHandler?.('item/started', childTitleStart);

                const childTitleEnd = {
                    item: {
                        id: 'title-child',
                        type: 'mcpToolCall',
                        server: 'hapi',
                        tool: 'change_title',
                        result: {
                            content: [
                                { type: 'text', text: 'Successfully changed chat title to: "Child Title"' }
                            ]
                        }
                    },
                    threadId: childThreadId,
                    turnId: childTurnId
                };
                harness.notifications.push({ method: 'item/completed', params: childTitleEnd });
                this.notificationHandler?.('item/completed', childTitleEnd);

                if (harness.emitChildNestedAgentTool) {
                    const nestedSpawnStart = {
                        item: {
                            id: 'nested-spawn',
                            type: 'collabAgentToolCall',
                            tool: 'spawn',
                            senderThreadId: childThreadId,
                            receiverThreadIds: ['grandchild-thread'],
                            prompt: 'do nested work'
                        },
                        threadId: childThreadId,
                        turnId: childTurnId
                    };
                    harness.notifications.push({ method: 'item/started', params: nestedSpawnStart });
                    this.notificationHandler?.('item/started', nestedSpawnStart);

                    const nestedSpawnCompleted = {
                        item: {
                            id: 'nested-spawn',
                            type: 'collabAgentToolCall',
                            tool: 'spawn',
                            status: 'completed',
                            senderThreadId: childThreadId,
                            receiverThreadIds: ['grandchild-thread'],
                            agentsStates: {}
                        },
                        threadId: childThreadId,
                        turnId: childTurnId
                    };
                    harness.notifications.push({ method: 'item/completed', params: nestedSpawnCompleted });
                    this.notificationHandler?.('item/completed', nestedSpawnCompleted);
                }

                const waitStarted = {
                    item: {
                        id: 'wait-child',
                        type: 'collabAgentToolCall',
                        tool: 'wait',
                        senderThreadId: threadId,
                        receiverThreadIds: [childThreadId],
                        agentsStates: {}
                    },
                    threadId,
                    turnId
                };
                harness.notifications.push({ method: 'item/started', params: waitStarted });
                this.notificationHandler?.('item/started', waitStarted);

                const waitCompleted = {
                    item: {
                        id: 'wait-child',
                        type: 'collabAgentToolCall',
                        tool: 'wait',
                        status: 'completed',
                        senderThreadId: threadId,
                        receiverThreadIds: [childThreadId],
                        agentsStates: {
                            [childThreadId]: {
                                status: harness.emitChildDoneStatusWithoutMessage ? 'done' : 'completed',
                                message: harness.emitChildWaitStructuredOutput
                                    ? ''
                                    : harness.emitChildDoneStatusWithoutMessage
                                        ? null
                                        : harness.emitSecondChildMessage
                                            ? secondChildMessage
                                            : childMessage,
                                ...(harness.emitChildWaitStructuredOutput ? { output: { value: 42 } } : {})
                            }
                        }
                    },
                    threadId,
                    turnId
                };
                harness.notifications.push({ method: 'item/completed', params: waitCompleted });
                this.notificationHandler?.('item/completed', waitCompleted);

                if (harness.emitParentSendInputFailure) {
                    const sendInputStarted = {
                        item: {
                            id: 'send-child',
                            type: 'collabAgentToolCall',
                            tool: 'sendInput',
                            senderThreadId: threadId,
                            receiverThreadIds: [childThreadId],
                            message: 'follow up'
                        },
                        threadId,
                        turnId
                    };
                    harness.notifications.push({ method: 'item/started', params: sendInputStarted });
                    this.notificationHandler?.('item/started', sendInputStarted);

                    const sendInputCompleted = {
                        item: {
                            id: 'send-child',
                            type: 'collabAgentToolCall',
                            tool: 'sendInput',
                            status: 'failed',
                            error: 'send failed',
                            senderThreadId: threadId,
                            receiverThreadIds: [childThreadId],
                            agentsStates: {}
                        },
                        threadId,
                        turnId
                    };
                    harness.notifications.push({ method: 'item/completed', params: sendInputCompleted });
                    this.notificationHandler?.('item/completed', sendInputCompleted);
                }

                if (harness.emitParentResumeSuccess) {
                    const resumeStarted = {
                        item: {
                            id: 'resume-child',
                            type: 'collabAgentToolCall',
                            tool: 'resumeAgent',
                            senderThreadId: threadId,
                            receiverThreadIds: [childThreadId]
                        },
                        threadId,
                        turnId
                    };
                    harness.notifications.push({ method: 'item/started', params: resumeStarted });
                    this.notificationHandler?.('item/started', resumeStarted);

                    const resumeCompleted = {
                        item: {
                            id: 'resume-child',
                            type: 'collabAgentToolCall',
                            tool: 'resumeAgent',
                            status: 'completed',
                            senderThreadId: threadId,
                            receiverThreadIds: [childThreadId],
                            agentsStates: {}
                        },
                        threadId,
                        turnId
                    };
                    harness.notifications.push({ method: 'item/completed', params: resumeCompleted });
                    this.notificationHandler?.('item/completed', resumeCompleted);
                }

                if (harness.emitLateChildCommandAfterParentTool) {
                    const lateChildCommandStart = {
                        item: {
                            id: 'late-child-cmd',
                            type: 'commandExecution',
                            command: 'echo late'
                        },
                        threadId: childThreadId,
                        turnId: childTurnId
                    };
                    harness.notifications.push({ method: 'item/started', params: lateChildCommandStart });
                    this.notificationHandler?.('item/started', lateChildCommandStart);
                }
            }

            const completed = { status: 'Completed', turn: { id: turnId } };
            harness.notifications.push({ method: 'turn/completed', params: completed });
            this.notificationHandler?.('turn/completed', completed);

            return { turn: { id: turnId } };
        }

        async interruptTurn(params?: { threadId?: string; turnId?: string }): Promise<Record<string, never>> {
            const threadId = params?.threadId ?? 'thread-unknown';
            const turnId = params?.turnId ?? 'turn-unknown';
            harness.interruptedTurns.push({ threadId, turnId });
            if (harness.emitTurnAbortedOnInterrupt) {
                const interrupted = {
                    threadId,
                    turnId,
                    status: 'interrupted',
                    turn: { id: turnId }
                };
                harness.notifications.push({ method: 'turn/completed', params: interrupted });
                this.notificationHandler?.('turn/completed', interrupted);
            }
            return {};
        }

        async compactThread(params?: { threadId?: string }): Promise<Record<string, never>> {
            harness.compactThreadIds.push(params?.threadId ?? 'thread-unknown');
            return {};
        }

        async setThreadGoal(params?: { threadId?: string; objective?: string | null; status?: string | null; tokenBudget?: number | null }) {
            if (harness.failGoalApi) throw new Error('goal api unavailable');
            const threadId = params?.threadId ?? 'thread-unknown';
            harness.setGoalCalls.push({ threadId, objective: params?.objective, status: params?.status, tokenBudget: params?.tokenBudget });
            harness.currentGoal = {
                threadId,
                objective: params?.objective ?? harness.currentGoal?.objective ?? 'existing goal',
                status: params?.status ?? harness.currentGoal?.status ?? 'active',
                tokenBudget: params?.tokenBudget ?? harness.currentGoal?.tokenBudget ?? null,
                tokensUsed: 12000,
                timeUsedSeconds: 90,
                createdAt: 1776272400,
                updatedAt: 1776272490
            };
            const payload = { threadId, turnId: null, goal: harness.currentGoal };
            harness.notifications.push({ method: 'thread/goal/updated', params: payload });
            this.notificationHandler?.('thread/goal/updated', payload);
            return { goal: harness.currentGoal };
        }

        async getThreadGoal(params?: { threadId?: string }) {
            if (harness.failGoalApi) throw new Error('goal api unavailable');
            const threadId = params?.threadId ?? 'thread-unknown';
            harness.getGoalCalls.push(threadId);
            return { goal: harness.currentGoal };
        }

        async clearThreadGoal(params?: { threadId?: string }) {
            if (harness.failGoalApi) throw new Error('goal api unavailable');
            const threadId = params?.threadId ?? 'thread-unknown';
            harness.clearGoalCalls.push(threadId);
            if (harness.clearGoalReturnsFalse) {
                return { cleared: false };
            }
            harness.currentGoal = null;
            const payload = { threadId };
            harness.notifications.push({ method: 'thread/goal/cleared', params: payload });
            this.notificationHandler?.('thread/goal/cleared', payload);
            return { cleared: true };
        }

        async disconnect(): Promise<void> {}
    }

    return { CodexAppServerClient: MockCodexAppServerClient };
});

vi.mock('./utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async (_session: unknown, options?: unknown) => {
        harness.bridgeOptions.push(options);
        return {
            server: {
                stop: () => {}
            },
            mcpServers: {}
        };
    }
}));

import { codexRemoteLauncher } from './codexRemoteLauncher';

type FakeAgentState = {
    requests: Record<string, unknown>;
    completedRequests: Record<string, unknown>;
};

function createMode(): EnhancedMode {
    return {
        permissionMode: 'default',
        collaborationMode: 'default'
    };
}

function createSessionStub(messages = ['hello from launcher test']) {
    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
    messages.forEach((message, index) => {
        if (message.trim().startsWith('/goal')) {
            queue.pushIsolate(message, createMode());
        } else if (index === 0 && messages.length > 1) {
            queue.pushIsolateAndClear(message, createMode());
        } else {
            queue.push(message, createMode());
        }
    });
    queue.close();

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const codexMessages: unknown[] = [];
    const thinkingChanges: boolean[] = [];
    const foundSessionIds: string[] = [];
    const resetThreadCalls: string[] = [];
    let currentModel: string | null | undefined;
    let agentState: FakeAgentState = {
        requests: {},
        completedRequests: {}
    };

    const rpcHandlers = new Map<string, (params: unknown) => unknown>();
    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: (params: unknown) => unknown) {
                rpcHandlers.set(method, handler);
            }
        },
        updateAgentState(handler: (state: FakeAgentState) => FakeAgentState) {
            agentState = handler(agentState);
        },
        sendAgentMessage(message: unknown) {
            codexMessages.push(message);
        },
        sendUserMessage(_text: string) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            sessionEvents.push(event);
        }
    };

    const session = {
        path: '/tmp/hapi-update',
        logPath: '/tmp/hapi-update/test.log',
        client,
        queue,
        codexArgs: undefined,
        codexCliOverrides: undefined,
        sessionId: null as string | null,
        thinking: false,
        getPermissionMode() {
            return 'default' as const;
        },
        setModel(nextModel: string | null) {
            currentModel = nextModel;
        },
        getModel() {
            return currentModel;
        },
        onThinkingChange(nextThinking: boolean) {
            session.thinking = nextThinking;
            thinkingChanges.push(nextThinking);
        },
        onSessionFound(id: string) {
            session.sessionId = id;
            foundSessionIds.push(id);
        },
        resetCodexThread() {
            resetThreadCalls.push(session.sessionId ?? 'none');
            session.sessionId = null;
        },
        sendAgentMessage(message: unknown) {
            client.sendAgentMessage(message);
        },
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(text: string) {
            client.sendUserMessage(text);
        },
        stopKeepAlive() {
            // no-op: keepalive is mocked in tests
        }
    };

    return {
        session,
        sessionEvents,
        codexMessages,
        thinkingChanges,
        foundSessionIds,
        resetThreadCalls,
        rpcHandlers,
        getModel: () => currentModel,
        getAgentState: () => agentState
    };
}

describe('codexRemoteLauncher', () => {
    afterEach(() => {
        harness.notifications = [];
        harness.registerRequestCalls = [];
        harness.initializeCalls = [];
        harness.startThreadIds = [];
        harness.resumeThreadIds = [];
        harness.startTurnThreadIds = [];
        harness.interruptedTurns = [];
        harness.compactThreadIds = [];
        harness.setGoalCalls = [];
        harness.getGoalCalls = [];
        harness.clearGoalCalls = [];
        harness.currentGoal = null;
        harness.failGoalApi = false;
        harness.clearGoalReturnsFalse = false;
        harness.suppressTurnCompletion = false;
        harness.remainingThreadSystemErrors = 0;
        harness.nextThreadSystemErrorMessage = null;
        harness.failNextCompact = false;
        harness.deferThreadStatusNotifications = false;
        harness.emitChildThreadEvents = false;
        harness.emitChildUsageEvents = false;
        harness.emitChildReasoningBurst = false;
        harness.emitChildDoneStatusWithoutMessage = false;
        harness.emitChildWaitStructuredOutput = false;
        harness.emitChildTaskCompleteBeforeMessage = false;
        harness.suppressChildTaskCompleteEvent = false;
        harness.emitSecondChildMessage = false;
        harness.emitLateChildCommandAfterParentTool = false;
        harness.emitParentUsageEvents = false;
        harness.emitChildNestedAgentTool = false;
        harness.emitParentTitleChange = false;
        harness.emitParentSpawnFailureWithoutAgentId = false;
        harness.emitParentSpawnStartWithoutEnd = false;
        harness.emitParentSendInputFailure = false;
        harness.emitParentResumeSuccess = false;
        harness.emitRunningChildTurnBeforeSuppressedParent = false;
        harness.emitCompletedChildTurnBeforeSuppressedParent = false;
        harness.emitTurnAbortedOnInterrupt = false;
        harness.bridgeOptions = [];
    });

    it('finishes a turn and emits ready when task lifecycle events include turn_id', async () => {
        const {
            session,
            sessionEvents,
            thinkingChanges,
            foundSessionIds,
            getModel
        } = createSessionStub();

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(foundSessionIds).toContain('thread-1');
        expect(getModel()).toBe('gpt-5.4');
        expect(harness.initializeCalls).toEqual([{
            clientInfo: {
                name: 'hapi-codex-client',
                version: '1.0.0'
            },
            capabilities: {
                experimentalApi: true
            }
        }]);
        expect(harness.notifications.map((entry) => entry.method)).toEqual([
            'turn/started',
            'item/started',
            'item/completed',
            'turn/completed'
        ]);
        expect(sessionEvents.filter((event) => event.type === 'ready').length).toBeGreaterThanOrEqual(1);
        expect(thinkingChanges).toContain(true);
        expect(session.thinking).toBe(false);
    });

    it('surfaces thread-level systemError as a visible failure and emits ready', async () => {
        harness.remainingThreadSystemErrors = 1;
        const { session, sessionEvents } = createSessionStub();

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.notifications.map((entry) => entry.method)).toEqual(['turn/started', 'thread/status/changed']);
        expect(sessionEvents).toContainEqual(expect.objectContaining({ type: 'thread-crashed' }));
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Task failed: Codex thread entered systemError'
        });
        expect(sessionEvents.filter((event) => event.type === 'ready').length).toBeGreaterThanOrEqual(1);
        expect(session.thinking).toBe(false);
    });

    it('starts a fresh thread for the next queued message after thread-level systemError', async () => {
        harness.remainingThreadSystemErrors = 1;
        const { session } = createSessionStub(['first message', 'second message']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual(['thread-1', 'thread-2']);
        expect(harness.resumeThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual(['thread-1', 'thread-2']);
        expect(session.sessionId).toBe('thread-2');
        expect(session.thinking).toBe(false);
    });

    it('surfaces Codex bash stdout instead of duplicating raw output json', async () => {
        const { session, codexMessages } = createSessionStub();

        await codexRemoteLauncher(session as never);

        expect(codexMessages).toContainEqual(expect.objectContaining({
            type: 'tool-call-result',
            callId: 'cmd-1',
            output: expect.objectContaining({
                command: 'echo ok',
                cwd: '/tmp/hapi-update',
                stdout: 'ok\n',
                exit_code: 0
            })
        }));
        expect(codexMessages).not.toContainEqual(expect.objectContaining({
            type: 'tool-call-result',
            callId: 'cmd-1',
            output: expect.objectContaining({
                output: 'ok\n'
            })
        }));
    });

    it('clears codex thread state without starting a turn', async () => {
        const { session, sessionEvents, resetThreadCalls } = createSessionStub(['/clear', 'next message']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(resetThreadCalls).toEqual(['none']);
        expect(harness.startThreadIds).toEqual(['thread-1']);
        expect(harness.startTurnThreadIds).toEqual(['thread-1']);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Context was reset'
        });
        expect(session.sessionId).toBe('thread-1');
    });

    it('interrupts an in-flight turn before clearing codex thread state', async () => {
        harness.suppressTurnCompletion = true;
        const { session, sessionEvents, resetThreadCalls } = createSessionStub(['first message', '/clear']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual(['thread-1']);
        expect(harness.startTurnThreadIds).toEqual(['thread-1']);
        expect(harness.interruptedTurns).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
        expect(resetThreadCalls).toEqual(['thread-1']);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Context was reset'
        });
        expect(session.thinking).toBe(false);
    });

    it('clears visible goal state when resetting codex context', async () => {
        const { session, codexMessages } = createSessionStub(['/goal ship the feature', '/clear']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(codexMessages).toContainEqual(expect.objectContaining({
            type: 'codex_goal',
            action: 'updated',
            goal: expect.objectContaining({ objective: 'ship the feature' })
        }));
        expect(codexMessages).toContainEqual(expect.objectContaining({
            type: 'codex_goal',
            action: 'cleared',
            threadId: 'thread-1'
        }));
    });

    it('compacts the current thread without starting a turn', async () => {
        const { session, sessionEvents } = createSessionStub(['first message', '/compact']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual(['thread-1']);
        expect(harness.startTurnThreadIds).toEqual(['thread-1']);
        expect(harness.compactThreadIds).toEqual(['thread-1']);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Compaction started'
        });
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Compaction completed'
        });
    });

    it('interrupts an in-flight turn before compacting the current thread', async () => {
        harness.suppressTurnCompletion = true;
        const { session, sessionEvents } = createSessionStub(['first message', '/compact']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual(['thread-1']);
        expect(harness.startTurnThreadIds).toEqual(['thread-1']);
        expect(harness.interruptedTurns).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
        expect(harness.compactThreadIds).toEqual(['thread-1']);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Compaction completed'
        });
        expect(session.thinking).toBe(false);
    });

    it('reports nothing to compact when no codex thread exists', async () => {
        const { session, sessionEvents } = createSessionStub(['/compact']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.compactThreadIds).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Nothing to compact'
        });
    });

    it('rejects argument-bearing codex slash commands without starting a turn', async () => {
        const { session, sessionEvents } = createSessionStub(['/compact now']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.compactThreadIds).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: '/compact does not accept arguments'
        });
    });

    it('sets a Codex goal without starting a user turn or emitting duplicate status', async () => {
        const { session, sessionEvents, codexMessages } = createSessionStub(['/goal ship the feature']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual(['thread-1']);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.interruptedTurns).toEqual([]);
        expect(harness.setGoalCalls).toEqual([{ threadId: 'thread-1', objective: 'ship the feature', status: 'active', tokenBudget: undefined }]);
        expect(codexMessages).toContainEqual(expect.objectContaining({
            type: 'codex_goal',
            action: 'updated',
            goal: expect.objectContaining({ objective: 'ship the feature', status: 'active' })
        }));
        expect(sessionEvents).not.toContainEqual(expect.objectContaining({
            type: 'message',
            message: expect.stringContaining('Goal active')
        }));
    });

    it('reads a Codex goal as visible status without starting a user turn', async () => {
        harness.currentGoal = {
            threadId: 'thread-1',
            objective: 'ship the feature',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 12000,
            timeUsedSeconds: 90,
            createdAt: 1776272400,
            updatedAt: 1776272490
        };
        const { session, sessionEvents } = createSessionStub(['/goal']);
        session.sessionId = 'thread-1';

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.getGoalCalls).toEqual(['thread-1']);
        expect(sessionEvents).toContainEqual(expect.objectContaining({
            type: 'message',
            message: expect.stringContaining('Goal active: ship the feature')
        }));
    });

    it('does not create a thread when reading a goal before a thread exists', async () => {
        const { session, sessionEvents } = createSessionStub(['/goal']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual([]);
        expect(harness.resumeThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.getGoalCalls).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'No active goal'
        });
    });

    it('does not create a thread when clearing a goal before a thread exists', async () => {
        const { session, sessionEvents } = createSessionStub(['/goal clear']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual([]);
        expect(harness.resumeThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.clearGoalCalls).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'No active goal to clear'
        });
    });

    it('does not create a thread when pausing a goal before a thread exists', async () => {
        const { session, sessionEvents } = createSessionStub(['/goal pause']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startThreadIds).toEqual([]);
        expect(harness.resumeThreadIds).toEqual([]);
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.setGoalCalls).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'No active goal'
        });
    });

    it('pauses, resumes, and clears a Codex goal via native APIs without direct user turns', async () => {
        harness.currentGoal = {
            threadId: 'thread-1',
            objective: 'ship the feature',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 12000,
            timeUsedSeconds: 90,
            createdAt: 1776272400,
            updatedAt: 1776272490
        };
        const { session, sessionEvents, codexMessages } = createSessionStub(['/goal pause', '/goal resume', '/goal clear']);
        session.sessionId = 'thread-1';

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(harness.setGoalCalls.map((call) => call.status)).toEqual(['paused', 'active']);
        expect(harness.clearGoalCalls).toEqual(['thread-1']);
        expect(codexMessages).toContainEqual(expect.objectContaining({ type: 'codex_goal', action: 'cleared' }));
        expect(sessionEvents).not.toContainEqual(expect.objectContaining({
            type: 'message',
            message: expect.stringMatching(/^Goal (active|paused|cleared)/)
        }));
    });

    it('reports when goal clear is a no-op and Codex sends no cleared notification', async () => {
        harness.clearGoalReturnsFalse = true;
        const { session, sessionEvents, codexMessages } = createSessionStub(['/goal clear']);
        session.sessionId = 'thread-1';

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.clearGoalCalls).toEqual(['thread-1']);
        expect(codexMessages).not.toContainEqual(expect.objectContaining({
            type: 'codex_goal',
            action: 'cleared'
        }));
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'No active goal to clear'
        });
    });

    it('does not interrupt an in-flight turn before applying goal control', async () => {
        harness.suppressTurnCompletion = true;
        harness.currentGoal = {
            threadId: 'thread-1',
            objective: 'ship the feature',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 12000,
            timeUsedSeconds: 90,
            createdAt: 1776272400,
            updatedAt: 1776272490
        };
        const { session } = createSessionStub(['first message', '/goal pause']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnThreadIds).toEqual(['thread-1']);
        expect(harness.interruptedTurns).toEqual([]);
        expect(harness.setGoalCalls).toEqual([{ threadId: 'thread-1', objective: undefined, status: 'paused', tokenBudget: undefined }]);
    });

    it('shows safe visible status when goal API is unavailable and does not fall through to a user turn', async () => {
        harness.failGoalApi = true;
        const { session, sessionEvents } = createSessionStub(['/goal ship the feature']);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnThreadIds).toEqual([]);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Goal command is not available in this Codex app-server. Upgrade Codex or enable goals.'
        });
    });
});
