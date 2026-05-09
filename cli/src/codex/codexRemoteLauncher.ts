import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import React from 'react';
import { randomUUID } from 'node:crypto';

import { CodexAppServerClient } from './codexAppServerClient';
import { CodexPermissionHandler } from './utils/permissionHandler';
import { ReasoningProcessor } from './utils/reasoningProcessor';
import { DiffProcessor } from './utils/diffProcessor';
import { logger } from '@/ui/logger';
import { CodexDisplay } from '@/ui/ink/CodexDisplay';
import { buildHapiMcpBridge } from './utils/buildHapiMcpBridge';
import { emitReadyIfIdle } from './utils/emitReadyIfIdle';
import type { CodexSession } from './session';
import type { EnhancedMode } from './loop';
import { hasCodexCliOverrides } from './utils/codexCliOverrides';
import { AppServerEventConverter } from './utils/appServerEventConverter';
import { registerAppServerPermissionHandlers } from './utils/appServerPermissionAdapter';
import { buildThreadStartParams, buildTurnStartParams } from './utils/appServerConfig';
import { shouldIgnoreTerminalEvent } from './utils/terminalEventGuard';
import { parseCodexSpecialCommand } from './codexSpecialCommands';
import { parseCodexGoalCommand, type CodexGoalCommand } from './utils/goalCommands';
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from '@/modules/common/remote/RemoteLauncherBase';

type HappyServer = Awaited<ReturnType<typeof buildHapiMcpBridge>>['server'];
type QueuedMessage = { message: string; mode: EnhancedMode; isolate: boolean; hash: string };
type ChildAgentRuntime = {
    reasoningProcessor: ReasoningProcessor;
    diffProcessor: DiffProcessor;
    activeToolsByCallId: Map<string, {
        name: string;
        label: string;
        activity: string;
        activityKind: string;
    }>;
    pendingTitleByCallId: Map<string, string>;
    reasoningPreview: string;
    finalMessage: string | null;
    terminal: boolean;
    blockedNestedAgent: boolean;
};

const AGENT_RUN_UPDATE_THROTTLE_MS = 300;
const AGENT_RUN_START_TIMEOUT_MS = 30 * 1000;
const THROTTLED_AGENT_RUN_ACTIVITY_KINDS = new Set(['thinking']);

class CodexRemoteLauncher extends RemoteLauncherBase {
    private readonly session: CodexSession;
    private readonly appServerClient: CodexAppServerClient;
    private permissionHandler: CodexPermissionHandler | null = null;
    private reasoningProcessor: ReasoningProcessor | null = null;
    private diffProcessor: DiffProcessor | null = null;
    private happyServer: HappyServer | null = null;
    private abortController: AbortController = new AbortController();
    private currentThreadId: string | null = null;
    private currentTurnId: string | null = null;

    private recoveryContext: string | null = null

    constructor(session: CodexSession, recoveryContext?: string) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.appServerClient = new CodexAppServerClient();
        this.recoveryContext = recoveryContext ?? null;
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(CodexDisplay, context);
    }

    private async handleAbort(): Promise<void> {
        logger.debug('[Codex] Abort requested - stopping current task');
        try {
            if (this.currentThreadId && this.currentTurnId) {
                try {
                    await this.appServerClient.interruptTurn({
                        threadId: this.currentThreadId,
                        turnId: this.currentTurnId
                    });
                } catch (error) {
                    logger.debug('[Codex] Error interrupting app-server turn:', error);
                }
            }
            this.currentTurnId = null;

            this.abortController.abort();
            this.session.queue.reset();
            this.permissionHandler?.reset();
            this.reasoningProcessor?.abort();
            this.diffProcessor?.reset();
            logger.debug('[Codex] Abort completed - session remains active');
        } catch (error) {
            logger.debug('[Codex] Error during abort:', error);
        } finally {
            this.abortController = new AbortController();
        }
    }

    private async handleExitFromUi(): Promise<void> {
        logger.debug('[codex-remote]: Exiting agent via Ctrl-C');
        this.exitReason = 'exit';
        this.shouldExit = true;
        await this.handleAbort();
    }

    private async handleSwitchFromUi(): Promise<void> {
        logger.debug('[codex-remote]: Switching to local mode via double space');
        this.exitReason = 'switch';
        this.shouldExit = true;
        await this.handleAbort();
    }

    private async handleSwitchRequest(): Promise<void> {
        this.exitReason = 'switch';
        this.shouldExit = true;
        await this.handleAbort();
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        if (this.session.codexArgs && this.session.codexArgs.length > 0) {
            if (hasCodexCliOverrides(this.session.codexCliOverrides)) {
                logger.debug(`[codex-remote] CLI args include sandbox/approval overrides; other args ` +
                    `are ignored in remote mode.`);
            } else {
                logger.debug(`[codex-remote] Warning: CLI args [${this.session.codexArgs.join(', ')}] are ignored in remote mode. ` +
                    `Remote mode uses message-based configuration (model/sandbox set via web interface).`);
            }
        }

        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;
        const appServerClient = this.appServerClient;
        const appServerEventConverter = new AppServerEventConverter();

        const normalizeCommand = (value: unknown): string | undefined => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed.length > 0 ? trimmed : undefined;
            }
            if (Array.isArray(value)) {
                const joined = value.filter((part): part is string => typeof part === 'string').join(' ');
                return joined.length > 0 ? joined : undefined;
            }
            return undefined;
        };

        const asRecord = (value: unknown): Record<string, unknown> | null => {
            if (!value || typeof value !== 'object') {
                return null;
            }
            return value as Record<string, unknown>;
        };

        const asString = (value: unknown): string | null => {
            return typeof value === 'string' && value.length > 0 ? value : null;
        };

        const asNumber = (value: unknown): number | null => {
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
        };

        const applyResolvedModel = (value: unknown): string | undefined => {
            const resolvedModel = asString(value) ?? undefined;
            if (!resolvedModel) {
                return undefined;
            }
            session.setModel(resolvedModel);
            logger.debug(`[Codex] Resolved app-server model: ${resolvedModel}`);
            return resolvedModel;
        };

        const buildMcpToolName = (server: unknown, tool: unknown): string | null => {
            const serverName = asString(server);
            const toolName = asString(tool);
            if (!serverName || !toolName) {
                return null;
            }
            return `mcp__${serverName}__${toolName}`;
        };

        const formatOutputPreview = (value: unknown): string => {
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            if (value === null || value === undefined) return '';
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        };

        const permissionHandler = new CodexPermissionHandler(session.client, () => {
            const mode = session.getPermissionMode();
            return mode === 'default' || mode === 'read-only' || mode === 'safe-yolo' || mode === 'yolo'
                ? mode
                : undefined;
        }, {
            onRequest: ({ id, toolName, input }) => {
                if (toolName === 'request_user_input') {
                    session.sendAgentMessage({
                        type: 'tool-call',
                        name: 'request_user_input',
                        callId: id,
                        input,
                        id: randomUUID()
                    });
                    return;
                }

                const inputRecord = input && typeof input === 'object' ? input as Record<string, unknown> : {};
                const message = typeof inputRecord.message === 'string' ? inputRecord.message : undefined;
                const rawCommand = inputRecord.command;
                const command = Array.isArray(rawCommand)
                    ? rawCommand.filter((part): part is string => typeof part === 'string').join(' ')
                    : typeof rawCommand === 'string'
                        ? rawCommand
                        : undefined;
                const cwdValue = inputRecord.cwd;
                const cwd = typeof cwdValue === 'string' && cwdValue.trim().length > 0 ? cwdValue : undefined;

                session.sendAgentMessage({
                    type: 'tool-call',
                    name: 'CodexPermission',
                    callId: id,
                    input: {
                        tool: toolName,
                        message,
                        command,
                        cwd
                    },
                    id: randomUUID()
                });
            },
            onComplete: ({ id, toolName, decision, reason, approved, answers }) => {
                session.sendAgentMessage({
                    type: 'tool-call-result',
                    callId: id,
                    output: toolName === 'request_user_input'
                        ? { answers }
                        : {
                            decision,
                            reason
                        },
                    is_error: !approved,
                    id: randomUUID()
                });
            }
        });
        const reasoningProcessor = new ReasoningProcessor((message) => {
            session.sendAgentMessage(message);
        });
        const diffProcessor = new DiffProcessor((message) => {
            session.sendAgentMessage(message);
        });
        this.permissionHandler = permissionHandler;
        this.reasoningProcessor = reasoningProcessor;
        this.diffProcessor = diffProcessor;
        let readyAfterTurnTimer: ReturnType<typeof setTimeout> | null = null;
        let scheduleReadyAfterTurn: (() => void) | null = null;
        let clearReadyAfterTurnTimer: (() => void) | null = null;
        let turnInFlight = false;
        let allowAnonymousTerminalEvent = false;
        let hasSummary = false;
        let invalidThreadId: string | null = null;
        let childAgentActivityInCurrentTurn = false;

        const isCodexAgentToolName = (toolName: string | null): boolean => {
            return toolName === 'spawn_agent'
                || toolName === 'send_input'
                || toolName === 'resume_agent'
                || toolName === 'wait_agent'
                || toolName === 'close_agent';
        };

        const isTerminalAgentRunStatus = (status: string | null | undefined): boolean => {
            return status === 'completed'
                || status === 'failed'
                || status === 'error'
                || status === 'canceled'
                || status === 'cancelled'
                || status === 'notFound'
                || status === 'not_found';
        };

        const isCloseAgentCleanupUpdate = (update: Record<string, unknown>): boolean => {
            const activityKind = asString(update.activityKind ?? update.activity_kind);
            if (activityKind === 'close_agent' || activityKind === 'closed') return true;
            return activityKind === 'canceled'
                && (asString(update.activity) === 'Closed' || asString(update.statusText ?? update.status_text) === 'Closed');
        };

        const isScopeSensitiveCodexEvent = (type: string): boolean => {
            return type === 'token_count' || type === 'context_compacted';
        };

        const hasKnownChildAgents = (): boolean => {
            if (childAgentActivityInCurrentTurn) return true;
            if (pendingAgentStartCardIds.size > 0) return true;
            for (const agentId of new Set([...agentCardByAgentId.keys(), ...childAgentRuntimeById.keys()])) {
                const status = agentStatusByAgentId.get(agentId);
                if (!isTerminalAgentRunStatus(status)) {
                    return true;
                }
            }
            return false;
        };

        const buildCodexEventScope = (
            threadId: string | null,
            role: 'parent' | 'child',
            agentId?: string | null
        ): Record<string, unknown> => ({
            role,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(this.currentThreadId ? { parentThreadId: this.currentThreadId, parent_thread_id: this.currentThreadId } : {}),
            ...(agentId ? { agentId, agent_id: agentId } : {})
        });

        const addCodexEventScope = (
            event: Record<string, unknown>,
            role: 'parent' | 'child',
            threadId: string | null,
            agentId?: string | null
        ): Record<string, unknown> => ({
            ...event,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            scopeRole: role,
            scope_role: role,
            scope: buildCodexEventScope(threadId, role, agentId)
        });

        const extractAgentTargets = (input: unknown): string[] => {
            const record = asRecord(input);
            if (!record) return [];
            const targets = Array.isArray(record.targets)
                ? record.targets.filter((target): target is string => typeof target === 'string' && target.length > 0)
                : [];
            if (targets.length > 0) return targets;
            return [record.target, record.agent_id, record.agentId, record.id]
                .filter((target): target is string => typeof target === 'string' && target.length > 0);
        };

        const emitAgentRunEvent = (event: Record<string, unknown>): void => {
            const agentId = asString(event.agentId ?? event.agent_id);
            session.sendAgentMessage({
                ...(agentId ? addCodexEventScope(event, 'child', agentId, agentId) : event),
                id: randomUUID()
            });
        };

        const clearPendingAgentStart = (cardId: string): void => {
            const timer = pendingAgentStartTimersByCardId.get(cardId);
            if (timer) {
                clearTimeout(timer);
            }
            pendingAgentStartTimersByCardId.delete(cardId);
            pendingAgentStartCardIds.delete(cardId);
        };

        let failAgentStartCard = (_cardId: string, _error: unknown): void => {};

        const emitAgentRunStart = (cardId: string, input: unknown): void => {
            childAgentActivityInCurrentTurn = true;
            const startedAt = Date.now();
            agentStartedAtByCardId.set(cardId, startedAt);
            const summary = summarizeAgentInput(input);
            if (summary) {
                agentSummaryByCardId.set(cardId, summary);
            }
            clearPendingAgentStart(cardId);
            pendingAgentStartCardIds.add(cardId);
            const timer = setTimeout(() => {
                failAgentStartCard(
                    cardId,
                    `spawn_agent did not return an agent id within ${AGENT_RUN_START_TIMEOUT_MS / 1000}s`
                );
            }, AGENT_RUN_START_TIMEOUT_MS);
            timer.unref?.();
            pendingAgentStartTimersByCardId.set(cardId, timer);
            emitAgentRunEvent({
                type: 'agent-run-start',
                cardId,
                input,
                startedAt,
                status: 'starting',
                statusText: 'Starting',
                activity: 'Starting',
                activityKind: 'starting',
                ...(summary ? { summary } : {})
            });
        };

        const flushPendingAgentTraces = (agentId: string): void => {
            const traces = pendingAgentTracesByAgentId.get(agentId);
            if (!traces || traces.length === 0) return;
            pendingAgentTracesByAgentId.delete(agentId);
            for (const message of traces) {
                emitAgentRunEvent({
                    type: 'agent-run-trace',
                    agentId,
                    cardId: agentCardByAgentId.get(agentId),
                    ...(agentStartedAtByAgentId.has(agentId) ? { startedAt: agentStartedAtByAgentId.get(agentId) } : {}),
                    message
                });
            }
        };

        const linkAgentToCard = (agentId: string, cardId: string): void => {
            agentCardByAgentId.set(agentId, cardId);
            clearPendingAgentStart(cardId);
            const startedAt = agentStartedAtByCardId.get(cardId) ?? agentStartedAtByAgentId.get(agentId);
            if (startedAt) {
                agentStartedAtByCardId.set(cardId, startedAt);
                agentStartedAtByAgentId.set(agentId, startedAt);
            }
            const summary = agentSummaryByCardId.get(cardId);
            if (summary) {
                agentSummaryByAgentId.set(agentId, summary);
            }
            flushPendingAgentTraces(agentId);
        };

        const flushPendingAgentUpdates = (agentId: string): void => {
            const updates = pendingAgentUpdatesByAgentId.get(agentId);
            if (!updates || updates.length === 0) return;
            pendingAgentUpdatesByAgentId.delete(agentId);
            for (const update of updates) {
                emitAgentRunUpdate(agentId, update);
            }
        };

        const stableStringify = (value: unknown): string => {
            if (value === null || typeof value !== 'object') {
                return JSON.stringify(value);
            }
            if (Array.isArray(value)) {
                return `[${value.map(stableStringify).join(',')}]`;
            }
            const record = value as Record<string, unknown>;
            return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
        };

        const getAgentRunUpdateSignature = (
            agentId: string,
            update: Record<string, unknown>,
            cardIdOverride?: string | null
        ): string => stableStringify({
            agentId,
            cardIdOverride: cardIdOverride ?? null,
            update
        });

        const cancelPendingThrottledAgentRunUpdate = (agentId: string): void => {
            const timer = pendingThrottledAgentUpdateTimerByAgentId.get(agentId);
            if (timer) {
                clearTimeout(timer);
            }
            pendingThrottledAgentUpdateTimerByAgentId.delete(agentId);
            pendingThrottledAgentUpdateByAgentId.delete(agentId);
        };

        const cancelAllPendingThrottledAgentRunUpdates = (): void => {
            for (const agentId of Array.from(pendingThrottledAgentUpdateTimerByAgentId.keys())) {
                cancelPendingThrottledAgentRunUpdate(agentId);
            }
            pendingThrottledAgentUpdateByAgentId.clear();
        };

        const flushPendingThrottledAgentRunUpdate = (agentId: string): void => {
            const pendingUpdate = pendingThrottledAgentUpdateByAgentId.get(agentId);
            pendingThrottledAgentUpdateTimerByAgentId.delete(agentId);
            pendingThrottledAgentUpdateByAgentId.delete(agentId);
            if (!pendingUpdate) return;
            emitAgentRunUpdateNow(agentId, pendingUpdate.update, pendingUpdate.cardIdOverride);
        };

        const scheduleThrottledAgentRunUpdate = (
            agentId: string,
            update: Record<string, unknown>,
            cardIdOverride?: string | null
        ): void => {
            pendingThrottledAgentUpdateByAgentId.set(agentId, { update, cardIdOverride });
            if (pendingThrottledAgentUpdateTimerByAgentId.has(agentId)) {
                return;
            }

            const lastAt = lastAgentRunUpdateAtByAgentId.get(agentId) ?? 0;
            const delay = Math.max(AGENT_RUN_UPDATE_THROTTLE_MS - (Date.now() - lastAt), 0);
            const timer = setTimeout(() => {
                flushPendingThrottledAgentRunUpdate(agentId);
            }, delay);
            timer.unref?.();
            pendingThrottledAgentUpdateTimerByAgentId.set(agentId, timer);
        };

        const emitAgentRunUpdateNow = (
            agentId: string,
            update: Record<string, unknown>,
            cardIdOverride?: string | null
        ): void => {
            const knownCardId = agentCardByAgentId.get(agentId);
            if (
                !cardIdOverride
                && !knownCardId
                && pendingAgentStartCardIds.size > 0
                && childAgentRuntimeById.has(agentId)
            ) {
                const updates = pendingAgentUpdatesByAgentId.get(agentId) ?? [];
                updates.push(update);
                pendingAgentUpdatesByAgentId.set(agentId, updates);
                return;
            }

            const cardId = cardIdOverride ?? knownCardId ?? `codex-agent:${agentId}`;
            if (!knownCardId) {
                agentCardByAgentId.set(agentId, cardId);
            }
            const startedAt = agentStartedAtByAgentId.get(agentId)
                ?? agentStartedAtByCardId.get(cardId)
                ?? Date.now();
            agentStartedAtByAgentId.set(agentId, startedAt);
            agentStartedAtByCardId.set(cardId, startedAt);
            const nextStatus = asString(update.status);
            const currentStatus = agentStatusByAgentId.get(agentId);
            const activityKind = asString(update.activityKind ?? update.activity_kind);
            if (
                isTerminalAgentRunStatus(currentStatus)
                && !isTerminalAgentRunStatus(nextStatus)
                && activityKind !== 'send_input'
                && activityKind !== 'resume_agent'
            ) {
                return;
            }
            if (
                childAgentRuntimeById.get(agentId)?.blockedNestedAgent
                && nextStatus !== 'failed'
                && nextStatus !== 'error'
            ) {
                return;
            }
            if (
                isTerminalAgentRunStatus(currentStatus)
                && nextStatus !== 'failed'
                && nextStatus !== 'error'
                && isCloseAgentCleanupUpdate(update)
            ) {
                return;
            }
            const nextSummary = asString(update.summary);
            if (nextSummary) {
                agentSummaryByAgentId.set(agentId, nextSummary);
                agentSummaryByCardId.set(cardId, nextSummary);
            }
            if (nextStatus) {
                agentStatusByAgentId.set(agentId, nextStatus);
            }
            const event = {
                type: 'agent-run-update',
                agentId,
                cardId,
                startedAt,
                ...(isTerminalAgentRunStatus(nextStatus) ? { completedAt: Date.now() } : {}),
                ...(agentSummaryByAgentId.has(agentId) ? { summary: agentSummaryByAgentId.get(agentId) } : {}),
                ...update
            };
            const signature = getAgentRunUpdateSignature(agentId, event, cardIdOverride);
            if (lastAgentRunUpdateSignatureByAgentId.get(agentId) === signature) {
                return;
            }
            lastAgentRunUpdateSignatureByAgentId.set(agentId, signature);
            lastAgentRunUpdateAtByAgentId.set(agentId, Date.now());
            emitAgentRunEvent(event);
            flushPendingAgentTraces(agentId);
        };

        const emitAgentRunUpdate = (
            agentId: string,
            update: Record<string, unknown>,
            cardIdOverride?: string | null
        ): void => {
            const nextStatus = asString(update.status);
            const terminal = isTerminalAgentRunStatus(nextStatus);
            if (terminal) {
                cancelPendingThrottledAgentRunUpdate(agentId);
                emitAgentRunUpdateNow(agentId, update, cardIdOverride);
                return;
            }

            const activityKind = asString(update.activityKind ?? update.activity_kind);
            if (!activityKind || !THROTTLED_AGENT_RUN_ACTIVITY_KINDS.has(activityKind)) {
                emitAgentRunUpdateNow(agentId, update, cardIdOverride);
                return;
            }

            const lastAt = lastAgentRunUpdateAtByAgentId.get(agentId);
            if (lastAt === undefined || Date.now() - lastAt >= AGENT_RUN_UPDATE_THROTTLE_MS) {
                emitAgentRunUpdateNow(agentId, update, cardIdOverride);
                return;
            }

            scheduleThrottledAgentRunUpdate(agentId, update, cardIdOverride);
        };

        failAgentStartCard = (cardId: string, error: unknown): void => {
            if (!pendingAgentStartCardIds.has(cardId) && !pendingAgentStartTimersByCardId.has(cardId)) {
                return;
            }

            const agentId = `spawn-error:${cardId}`;
            linkAgentToCard(agentId, cardId);
            emitAgentRunUpdate(agentId, {
                status: 'failed',
                statusText: 'Failed to start',
                activity: formatActivity('Failed to start', previewText(error)),
                activityKind: 'failed',
                error
            }, cardId);
        };

        const failPendingAgentStarts = (error: unknown): void => {
            for (const cardId of Array.from(pendingAgentStartCardIds)) {
                failAgentStartCard(cardId, error);
            }
        };

        const emitAgentRunTraceMessage = (agentId: string, message: unknown): void => {
            const cardId = agentCardByAgentId.get(agentId);
            if (!cardId) {
                const traces = pendingAgentTracesByAgentId.get(agentId) ?? [];
                traces.push(message);
                pendingAgentTracesByAgentId.set(agentId, traces);
                return;
            }
            emitAgentRunEvent({
                type: 'agent-run-trace',
                agentId,
                cardId,
                ...(agentStartedAtByAgentId.has(agentId) ? { startedAt: agentStartedAtByAgentId.get(agentId) } : {}),
                message
            });
        };

        const getChildRuntime = (agentId: string) => {
            const existing = childAgentRuntimeById.get(agentId);
            if (existing) return existing;
            const runtime = {
                reasoningProcessor: new ReasoningProcessor((message) => {
                    emitAgentRunTraceMessage(agentId, message);
                }),
                diffProcessor: new DiffProcessor((message) => {
                    emitAgentRunTraceMessage(agentId, message);
                }),
                activeToolsByCallId: new Map(),
                pendingTitleByCallId: new Map(),
                reasoningPreview: '',
                finalMessage: null,
                terminal: false,
                blockedNestedAgent: false
            };
            childAgentRuntimeById.set(agentId, runtime);
            return runtime;
        };

        const extractAgentStatusMessage = (record: Record<string, unknown>): unknown => {
            const message = asString(record.message);
            if (message) return message;

            for (const key of ['output', 'result', 'finalMessage', 'final_message'] as const) {
                const value = record[key];
                if (value !== undefined && value !== null) {
                    return asString(value) ?? value;
                }
            }

            return undefined;
        };

        const normalizeAgentStateValue = (value: unknown): string | null => {
            return asString(value)?.trim().toLowerCase().replace(/[\s_-]/g, '') ?? null;
        };

        const hasOwn = (record: Record<string, unknown>, key: string): boolean => {
            return Object.prototype.hasOwnProperty.call(record, key);
        };

        const fillCompletedAgentUpdateFromRuntime = (
            agentId: string,
            update: Record<string, unknown>
        ): Record<string, unknown> => {
            if (asString(update.status) !== 'completed') return update;
            if (hasOwn(update, 'result') || hasOwn(update, 'error')) return update;

            const result = childAgentRuntimeById.get(agentId)?.finalMessage;
            if (!result) return update;

            return {
                ...update,
                activity: formatActivity('Completed', result),
                result
            };
        };

        const normalizeAgentStatusUpdate = (value: unknown): Record<string, unknown> => {
            if (typeof value === 'string') {
                const normalized = normalizeAgentStateValue(value);
                if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
                    return {
                        status: 'completed',
                        statusText: 'Completed',
                        activity: 'Completed',
                        activityKind: 'completed'
                    };
                }
                const activity = formatActivity('Completed', previewText(value));
                return {
                    status: 'completed',
                    statusText: 'Completed',
                    activity,
                    activityKind: 'completed',
                    result: value
                };
            }

            const record = asRecord(value);
            if (!record) {
                const activity = formatActivity('Completed', previewText(value));
                return {
                    status: 'completed',
                    statusText: 'Completed',
                    activity,
                    activityKind: 'completed',
                    result: value
                };
            }

            const completed = asString(record.completed);
            if (completed) {
                return {
                    status: 'completed',
                    statusText: 'Completed',
                    activity: formatActivity('Completed', completed),
                    activityKind: 'completed',
                    result: completed
                };
            }
            const done = asString(record.done);
            if (done) {
                return {
                    status: 'completed',
                    statusText: 'Completed',
                    activity: formatActivity('Completed', done),
                    activityKind: 'completed',
                    result: done
                };
            }
            const failed = asString(record.failed ?? record.error);
            if (failed) {
                return {
                    status: 'failed',
                    statusText: 'Failed',
                    activity: formatActivity('Failed', failed),
                    activityKind: 'failed',
                    error: failed
                };
            }
            const canceled = asString(record.canceled ?? record.cancelled);
            if (canceled) {
                return {
                    status: 'canceled',
                    statusText: 'Canceled',
                    activity: formatActivity('Canceled', canceled),
                    activityKind: 'canceled',
                    error: canceled
                };
            }

            const rawStatus = asString(record.status ?? record.state);
            const normalizedStatus = normalizeAgentStateValue(record.status ?? record.state);
            if (normalizedStatus === 'notfound') {
                const error = record.message ?? record.error ?? value;
                return {
                    status: 'failed',
                    statusText: 'Not found',
                    activity: formatActivity('Agent not found', previewText(error)),
                    activityKind: 'not_found',
                    error
                };
            }
            if (
                normalizedStatus === 'completed'
                || normalizedStatus === 'complete'
                || normalizedStatus === 'done'
                || record.completed === true
                || record.done === true
            ) {
                const result = extractAgentStatusMessage(record);
                return {
                    status: 'completed',
                    statusText: 'Completed',
                    activity: formatActivity('Completed', previewText(result)),
                    activityKind: 'completed',
                    ...(result !== undefined && result !== null ? { result } : {})
                };
            }
            if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
                const error = extractAgentStatusMessage(record) ?? record.error ?? value;
                return {
                    status: 'failed',
                    statusText: 'Failed',
                    activity: formatActivity('Failed', previewText(error)),
                    activityKind: 'failed',
                    error
                };
            }
            if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
                const error = extractAgentStatusMessage(record) ?? record.error ?? value;
                return {
                    status: 'canceled',
                    statusText: 'Canceled',
                    activity: formatActivity('Canceled', previewText(error)),
                    activityKind: 'canceled',
                    error
                };
            }

            return {
                status: rawStatus ?? 'running',
                statusText: rawStatus ?? 'Running',
                activity: formatActivity(rawStatus ?? 'Running', previewText(extractAgentStatusMessage(record) ?? value)),
                activityKind: rawStatus ?? 'running',
                result: value
            };
        };

        const isAgentNotFoundStatusUpdate = (update: Record<string, unknown>): boolean => {
            const status = asString(update.status);
            const activityKind = asString(update.activityKind ?? update.activity_kind);
            return status === 'notFound'
                || status === 'not_found'
                || activityKind === 'not_found';
        };

        const handleAgentToolEnd = (callId: string, name: string, output: unknown, isError: boolean): void => {
            const pending = pendingAgentToolInputByCallId.get(callId);
            pendingAgentToolInputByCallId.delete(callId);

            if (name === 'spawn_agent') {
                childAgentActivityInCurrentTurn = true;
                const outputRecord = asRecord(output);
                const agentsStates = asRecord(outputRecord?.agentsStates ?? outputRecord?.agents_states);
                const agentIdsFromState = agentsStates ? Object.keys(agentsStates) : [];
                const agentId = asString(outputRecord?.agent_id ?? outputRecord?.agentId ?? outputRecord?.id)
                    ?? (agentIdsFromState.length === 1 ? agentIdsFromState[0] : null)
                    ?? extractAgentTargets(pending?.input).at(0);
                if (!agentId) {
                    const detail = isError
                        ? output
                        : {
                            message: 'spawn_agent completed without returning an agent id',
                            output
                        };
                    failAgentStartCard(callId, detail);
                    return;
                }
                linkAgentToCard(agentId, callId);
                emitAgentRunUpdate(agentId, {
                    status: isError ? 'failed' : 'running',
                    statusText: isError ? 'Failed to start' : 'Running',
                    activity: isError ? formatActivity('Failed to start', previewText(output)) : 'Started',
                    activityKind: isError ? 'failed' : 'running',
                    ...(isError ? { error: output } : { spawnResult: output })
                }, callId);
                flushPendingAgentUpdates(agentId);
                return;
            }

            if (name === 'wait_agent') {
                childAgentActivityInCurrentTurn = true;
                const outputRecord = asRecord(output);
                const statusMap = asRecord(outputRecord?.status) ?? {};
                for (const [agentId, statusValue] of Object.entries(statusMap)) {
                    const update = fillCompletedAgentUpdateFromRuntime(
                        agentId,
                        normalizeAgentStatusUpdate(statusValue)
                    );
                    if (!agentCardByAgentId.has(agentId) && isAgentNotFoundStatusUpdate(update)) {
                        continue;
                    }
                    if (asString(update.status) === 'completed') {
                        const runtime = childAgentRuntimeById.get(agentId);
                        if (runtime) {
                            runtime.terminal = true;
                        }
                    }
                    emitAgentRunUpdate(agentId, update);
                }
                return;
            }

            if (name === 'send_input' || name === 'resume_agent') {
                childAgentActivityInCurrentTurn = true;
                const outputRecord = asRecord(output);
                const targets = Array.from(new Set([
                    ...extractAgentTargets(pending?.input),
                    ...extractAgentTargets(outputRecord)
                ]));
                const label = name === 'send_input' ? 'Send input' : 'Resume';
                const successActivity = name === 'send_input' ? 'Input sent' : 'Resumed';
                const errorDetail = asString(outputRecord?.error ?? outputRecord?.message) ?? output;

                for (const agentId of targets) {
                    if (!agentCardByAgentId.has(agentId)) continue;
                    emitAgentRunUpdate(agentId, {
                        status: isError ? 'failed' : 'running',
                        statusText: isError ? `${label} failed` : successActivity,
                        activity: isError ? formatActivity(`${label} failed`, previewText(errorDetail)) : successActivity,
                        activityKind: isError ? 'failed' : name,
                        ...(isError ? { error: output } : { result: output })
                    });
                }
                return;
            }

            if (name === 'close_agent') {
                const outputRecord = asRecord(output);
                const agentId = asString(outputRecord?.agent_id ?? outputRecord?.agentId)
                    ?? extractAgentTargets(pending?.input).at(0);
                if (!agentId) return;
                emitAgentRunUpdate(agentId, {
                    status: isError ? 'failed' : 'completed',
                    statusText: isError ? 'Close failed' : 'Closed',
                    activity: isError ? formatActivity('Close failed', previewText(output)) : 'Closed',
                    activityKind: isError ? 'failed' : 'closed',
                    ...(isError ? { error: output } : { result: output })
                });
                return;
            }
        };

        const handleChildCodexEvent = (agentId: string, msg: Record<string, unknown>): void => {
            const msgType = asString(msg.type);
            if (!msgType) return;
            childAgentActivityInCurrentTurn = true;
            const runtime = getChildRuntime(agentId);
            const isChildTerminalEvent = msgType === 'task_complete' || msgType === 'turn_aborted' || msgType === 'task_failed';
            if (runtime.blockedNestedAgent && !isChildTerminalEvent) {
                return;
            }
            const updateActivity = (
                activity: string,
                activityKind: string,
                extra?: Record<string, unknown>
            ): void => {
                if (runtime.terminal) {
                    return;
                }
                emitAgentRunUpdate(agentId, {
                    status: 'running',
                    statusText: activity,
                    activity,
                    activityKind,
                    ...extra
                });
            };

            if (msgType === 'token_count') {
                return;
            }

            if (msgType === 'context_compacted') {
                emitAgentRunTraceMessage(agentId, {
                    type: 'context_compacted',
                    id: randomUUID()
                });
                updateActivity('Context compacted', 'compact');
                return;
            }

            if (msgType === 'task_started') {
                runtime.reasoningPreview = '';
                runtime.finalMessage = null;
                runtime.terminal = false;
                agentStatusByAgentId.delete(agentId);
                updateActivity('Starting task', 'starting');
                return;
            }
            if (msgType === 'agent_reasoning_section_break') {
                runtime.reasoningProcessor.handleSectionBreak();
                runtime.reasoningPreview = '';
                updateActivity('Thinking', 'thinking');
                return;
            }
            if (msgType === 'agent_reasoning_delta') {
                const delta = asString(msg.delta);
                if (delta) {
                    runtime.reasoningProcessor.processDelta(delta);
                    runtime.reasoningPreview = truncateText(`${runtime.reasoningPreview}${delta}`, 160);
                }
                updateActivity(formatActivity('Thinking', runtime.reasoningPreview || null), 'thinking');
                return;
            }
            if (msgType === 'agent_reasoning') {
                const text = asString(msg.text);
                if (text) {
                    runtime.reasoningProcessor.complete(text);
                    runtime.reasoningPreview = truncateText(text, 160);
                }
                updateActivity(formatActivity('Thinking', runtime.reasoningPreview || null), 'thinking');
                return;
            }
            if (msgType === 'agent_message') {
                const message = asString(msg.message);
                if (message) {
                    runtime.finalMessage = message;
                    emitAgentRunTraceMessage(agentId, {
                        type: 'message',
                        message,
                        id: randomUUID()
                    });
                }
                if (runtime.terminal) {
                    if (message) {
                        emitAgentRunUpdate(agentId, {
                            status: 'completed',
                            statusText: 'Completed',
                            activity: formatActivity('Completed', message),
                            activityKind: 'completed',
                            result: message
                        });
                    }
                    return;
                }
                updateActivity(formatActivity('Writing', message), 'writing');
                return;
            }
            if (msgType === 'exec_command_begin' || msgType === 'exec_approval_request') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const inputs: Record<string, unknown> = { ...msg };
                    delete inputs.type;
                    delete inputs.call_id;
                    delete inputs.callId;
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call',
                        name: 'CodexBash',
                        callId,
                        input: inputs,
                        id: randomUUID()
                    });
                    const command = normalizeCommand(inputs.command) ?? 'command';
                    if (!runtime.terminal) {
                        runtime.activeToolsByCallId.set(callId, {
                            name: 'CodexBash',
                            label: command,
                            activity: formatActivity('Running command', command),
                            activityKind: 'running-command'
                        });
                        emitAgentRunUpdate(agentId, {
                            status: 'running',
                            statusText: formatActivity('Running command', command),
                            activity: formatActivity('Running command', command),
                            activityKind: 'running-command'
                        });
                    }
                }
                return;
            }
            if (msgType === 'exec_command_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const activeTool = runtime.activeToolsByCallId.get(callId);
                    runtime.activeToolsByCallId.delete(callId);
                    const output: Record<string, unknown> = { ...msg };
                    delete output.type;
                    delete output.call_id;
                    delete output.callId;
                    output.stdout = output.output;
                    delete output.output;
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call-result',
                        callId,
                        output,
                        is_error: Boolean(output.error),
                        id: randomUUID()
                    });
                    const label = activeTool?.label ?? normalizeCommand(output.command) ?? 'command';
                    const isError = Boolean(output.error);
                    updateActivity(
                        formatActivity(isError ? 'Command failed' : 'Command finished', label),
                        isError ? 'command-failed' : 'command-completed'
                    );
                }
                return;
            }
            if (msgType === 'patch_apply_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const changes = asRecord(msg.changes) ?? {};
                    const files = getPatchFiles(changes);
                    const fileSummary = summarizeFiles(files);
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call',
                        name: 'CodexPatch',
                        callId,
                        input: {
                            auto_approved: msg.auto_approved ?? msg.autoApproved,
                            changes
                        },
                        id: randomUUID()
                    });
                    runtime.activeToolsByCallId.set(callId, {
                        name: 'CodexPatch',
                        label: fileSummary ?? 'files',
                        activity: formatActivity('Editing files', fileSummary),
                        activityKind: 'editing'
                    });
                    updateActivity(formatActivity('Editing files', fileSummary), 'editing');
                }
                return;
            }
            if (msgType === 'patch_apply_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const activeTool = runtime.activeToolsByCallId.get(callId);
                    runtime.activeToolsByCallId.delete(callId);
                    const stdout = asString(msg.stdout);
                    const stderr = asString(msg.stderr);
                    const success = Boolean(msg.success);
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call-result',
                        callId,
                        output: { stdout, stderr, success },
                        is_error: !success,
                        id: randomUUID()
                    });
                    updateActivity(
                        formatActivity(success ? 'Files edited' : 'Edit failed', activeTool?.label ?? previewText(stderr ?? stdout)),
                        success ? 'edited' : 'edit-failed'
                    );
                }
                return;
            }
            if (msgType === 'mcp_tool_call_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                const invocation = asRecord(msg.invocation) ?? {};
                const name = buildMcpToolName(
                    invocation.server ?? invocation.server_name ?? msg.server,
                    invocation.tool ?? invocation.tool_name ?? msg.tool
                );
                if (callId && name) {
                    const input = invocation.arguments ?? invocation.input ?? msg.arguments ?? msg.input ?? {};
                    const inputRecord = asRecord(input);
                    const requestedTitle = inputRecord ? asString(inputRecord.title) : null;
                    if (isHapiChangeTitleToolName(name) && requestedTitle) {
                        runtime.pendingTitleByCallId.set(callId, requestedTitle);
                    }
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call',
                        name,
                        callId,
                        input,
                        id: randomUUID()
                    });
                    const label = displayMcpToolName(name);
                    runtime.activeToolsByCallId.set(callId, {
                        name,
                        label,
                        activity: formatActivity('Calling tool', label),
                        activityKind: 'tool'
                    });
                    updateActivity(formatActivity('Calling tool', label), 'tool');
                }
                return;
            }
            if (msgType === 'mcp_tool_call_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const activeTool = runtime.activeToolsByCallId.get(callId);
                    runtime.activeToolsByCallId.delete(callId);
                    const rawResult = msg.result;
                    let output = rawResult;
                    let isError = false;
                    const resultRecord = asRecord(rawResult);
                    if (resultRecord) {
                        if (Object.prototype.hasOwnProperty.call(resultRecord, 'Ok')) {
                            output = resultRecord.Ok;
                        } else if (Object.prototype.hasOwnProperty.call(resultRecord, 'Err')) {
                            output = resultRecord.Err;
                            isError = true;
                        }
                    }
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call-result',
                        callId,
                        output,
                        is_error: isError,
                        id: randomUUID()
                    });
                    const title = runtime.pendingTitleByCallId.get(callId);
                    runtime.pendingTitleByCallId.delete(callId);
                    updateActivity(
                        formatActivity(isError ? 'Tool failed' : 'Tool finished', activeTool?.label ?? displayMcpToolName(asString(msg.tool) ?? 'tool')),
                        isError ? 'tool-failed' : 'tool-completed',
                        !isError && title ? { summary: title } : undefined
                    );
                }
                return;
            }
            if (msgType === 'codex_tool_call_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                const name = asString(msg.name);
                if (callId && name) {
                    if (isCodexAgentToolName(name)) {
                        const error = 'Nested agent calls are disabled for child agents.';
                        runtime.blockedNestedAgent = true;
                        emitAgentRunTraceMessage(agentId, {
                            type: 'tool-call',
                            name,
                            callId,
                            input: msg.input ?? {},
                            id: randomUUID()
                        });
                        emitAgentRunTraceMessage(agentId, {
                            type: 'tool-call-result',
                            callId,
                            output: error,
                            is_error: true,
                            id: randomUUID()
                        });
                        emitAgentRunUpdate(agentId, {
                            status: 'failed',
                            statusText: 'Failed',
                            activity: formatActivity('Failed', error),
                            activityKind: 'failed',
                            error
                        });
                        return;
                    }
                    const activity = formatActivity('Running tool', name);
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call',
                        name,
                        callId,
                        input: msg.input ?? {},
                        id: randomUUID()
                    });
                    runtime.activeToolsByCallId.set(callId, {
                        name,
                        label: name,
                        activity,
                        activityKind: 'tool'
                    });
                    updateActivity(activity, 'tool');
                }
                return;
            }
            if (msgType === 'codex_tool_call_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const activeTool = runtime.activeToolsByCallId.get(callId);
                    runtime.activeToolsByCallId.delete(callId);
                    const isError = Boolean(msg.is_error ?? msg.isError);
                    emitAgentRunTraceMessage(agentId, {
                        type: 'tool-call-result',
                        callId,
                        output: msg.output,
                        is_error: isError,
                        id: randomUUID()
                    });
                    updateActivity(
                        formatActivity(isError ? 'Tool failed' : 'Tool finished', activeTool?.label ?? 'tool'),
                        isError ? 'tool-failed' : 'tool-completed'
                    );
                }
                return;
            }
            if (msgType === 'turn_diff') {
                const diff = asString(msg.unified_diff);
                if (diff) {
                    runtime.diffProcessor.processDiff(diff);
                    updateActivity(formatActivity('Editing files', summarizeDiffFiles(diff)), 'editing');
                }
                return;
            }
            if (isChildTerminalEvent) {
                runtime.terminal = true;
                runtime.reasoningProcessor.reset();
                runtime.diffProcessor.reset();
                runtime.activeToolsByCallId.clear();
                runtime.pendingTitleByCallId.clear();
                runtime.reasoningPreview = '';
                if (msgType === 'task_failed') {
                    const error = asString(msg.error) ?? 'Task failed';
                    emitAgentRunUpdate(agentId, {
                        status: 'failed',
                        statusText: 'Failed',
                        activity: formatActivity('Failed', error),
                        activityKind: 'failed',
                        error
                    });
                } else if (msgType === 'turn_aborted') {
                    emitAgentRunUpdate(agentId, {
                        status: 'canceled',
                        statusText: 'Canceled',
                        activity: 'Canceled',
                        activityKind: 'canceled'
                    });
                } else {
                    const result = runtime.finalMessage;
                    emitAgentRunUpdate(agentId, {
                        status: 'completed',
                        statusText: 'Completed',
                        activity: formatActivity('Completed', result),
                        activityKind: 'completed',
                        ...(result ? { result } : {})
                    });
                }
            }
        };

        const handleCodexEvent = (msg: Record<string, unknown>) => {
            const msgType = asString(msg.type);
            if (!msgType) return;
            const eventTurnId = asString(msg.turn_id ?? msg.turnId);
            const eventThreadId = asString(msg.thread_id ?? msg.threadId);
            const isTerminalEvent = msgType === 'task_complete' || msgType === 'turn_aborted' || msgType === 'task_failed';

            if (msgType === 'thread_started') {
                const threadId = asString(msg.thread_id ?? msg.threadId);
                if (threadId) {
                    this.currentThreadId = threadId;
                    session.onSessionFound(threadId);
                }
                return;
            }

            if (msgType === 'task_started') {
                const turnId = eventTurnId;
                if (turnId) {
                    this.currentTurnId = turnId;
                    allowAnonymousTerminalEvent = false;
                } else if (!this.currentTurnId) {
                    allowAnonymousTerminalEvent = true;
                }
            }

            const isThreadStatusFailure = msgType === 'task_failed' && msg.terminal_source === 'thread_status';

            if (isTerminalEvent) {
                if (shouldIgnoreTerminalEvent({
                    eventTurnId,
                    currentTurnId: this.currentTurnId,
                    turnInFlight,
                    allowAnonymousTerminalEvent,
                    eventThreadId,
                    currentThreadId: this.currentThreadId,
                    allowMatchingThreadIdTerminalEvent: msg.terminal_source === 'thread_status'
                })) {
                    logger.debug(
                        `[Codex] Ignoring terminal event ${msgType} without matching turn context; ` +
                        `eventTurnId=${eventTurnId ?? 'none'}, activeTurn=${this.currentTurnId ?? 'none'}, ` +
                        `eventThreadId=${eventThreadId ?? 'none'}, activeThread=${this.currentThreadId ?? 'none'}, ` +
                        `turnInFlight=${turnInFlight}, allowAnonymous=${allowAnonymousTerminalEvent}`
                    );
                    return;
                }
                this.currentTurnId = null;
                allowAnonymousTerminalEvent = false;
                if (isThreadStatusFailure) {
                    invalidThreadId = eventThreadId ?? this.currentThreadId;
                    this.currentThreadId = null;
                    hasThread = false;
                    // Stop heartbeat so hub can mark session inactive.
                    // Without this, the 2s keepalive would re-activate the session
                    // before auto-resume can trigger.
                    session.stopKeepAlive();
                    // Notify hub that thread crashed so auto-resume can trigger.
                    // Include error so hub can detect upstream API corruption
                    // (e.g. tool_use.input invalid) and clear the stale thread id.
                    session.sendSessionEvent({
                        type: 'thread-crashed',
                        ...(msg.error ? { error: asString(msg.error) ?? undefined } : {})
                    });
                }
            }

            if (msgType === 'agent_message') {
                const message = asString(msg.message);
                if (message) {
                    messageBuffer.addMessage(message, 'assistant');
                }
            } else if (msgType === 'agent_reasoning') {
                const text = asString(msg.text);
                if (text) {
                    messageBuffer.addMessage(`[Thinking] ${text.substring(0, 100)}...`, 'system');
                }
            } else if (msgType === 'exec_command_begin') {
                const command = normalizeCommand(msg.command) ?? 'command';
                messageBuffer.addMessage(`Executing: ${command}`, 'tool');
            } else if (msgType === 'exec_command_end') {
                const output = msg.output ?? msg.error ?? 'Command completed';
                const outputText = formatOutputPreview(output);
                const truncatedOutput = outputText.substring(0, 200);
                messageBuffer.addMessage(
                    `Result: ${truncatedOutput}${outputText.length > 200 ? '...' : ''}`,
                    'result'
                );
            } else if (msgType === 'task_started') {
                messageBuffer.addMessage('Starting task...', 'status');
            } else if (msgType === 'task_complete') {
                messageBuffer.addMessage('Task completed', 'status');
            } else if (msgType === 'turn_aborted') {
                messageBuffer.addMessage('Turn aborted', 'status');
            } else if (msgType === 'task_failed') {
                const error = asString(msg.error);
                const message = error ? `Task failed: ${error}` : 'Task failed';
                messageBuffer.addMessage(message, 'status');
                session.sendSessionEvent({ type: 'message', message });
            } else if (msgType === 'codex_goal') {
                const action = asString(msg.action);
                const goal = asRecord(msg.goal);
                if (action === 'cleared') {
                    messageBuffer.addMessage('Goal cleared', 'status');
                } else if (goal) {
                    messageBuffer.addMessage(formatGoalStatusMessage(goal), 'status');
                }
            }

            if (msgType === 'task_started') {
                clearReadyAfterTurnTimer?.();
                turnInFlight = true;
                if (!eventTurnId && !this.currentTurnId) {
                    allowAnonymousTerminalEvent = true;
                }
                if (!session.thinking) {
                    logger.debug('thinking started');
                    session.onThinkingChange(true);
                }
            }
            if (isTerminalEvent) {
                turnInFlight = false;
                allowAnonymousTerminalEvent = false;
                if (session.thinking) {
                    logger.debug('thinking completed');
                    session.onThinkingChange(false);
                }
                diffProcessor.reset();
                appServerEventConverter.reset();
            }

            if (isTerminalEvent && !turnInFlight) {
                scheduleReadyAfterTurn?.();
            } else if (readyAfterTurnTimer && msgType !== 'task_started') {
                scheduleReadyAfterTurn?.();
            }

            if (msgType === 'agent_reasoning_section_break') {
                reasoningProcessor.handleSectionBreak();
            }
            if (msgType === 'agent_reasoning_delta') {
                const delta = asString(msg.delta);
                if (delta) {
                    reasoningProcessor.processDelta(delta);
                }
            }
            if (msgType === 'agent_reasoning') {
                const text = asString(msg.text);
                if (text) {
                    reasoningProcessor.complete(text);
                }
            }
            if (msgType === 'agent_message') {
                const message = asString(msg.message);
                if (message) {
                    session.sendAgentMessage({
                        type: 'message',
                        message,
                        id: randomUUID()
                    });

                    // Auto-update session summary from first agent message
                    if (!hasSummary) {
                        hasSummary = true;
                        const firstLine = message.split('\n')[0].trim();
                        const summaryText = firstLine.length > 120
                            ? firstLine.slice(0, 117) + '…'
                            : firstLine;
                        if (summaryText.length > 0) {
                            session.client.updateMetadata((metadata) => ({
                                ...metadata,
                                summary: {
                                    text: summaryText,
                                    updatedAt: Date.now()
                                }
                            }));
                        }
                    }
                }
            }
            if (msgType === 'exec_command_begin' || msgType === 'exec_approval_request') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const inputs: Record<string, unknown> = { ...msg };
                    delete inputs.type;
                    delete inputs.call_id;
                    delete inputs.callId;

                    session.sendAgentMessage({
                        type: 'tool-call',
                        name: 'CodexBash',
                        callId: callId,
                        input: inputs,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'exec_command_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const output: Record<string, unknown> = { ...msg };
                    delete output.type;
                    delete output.call_id;
                    delete output.callId;
                    output.stdout = output.output;
                    delete output.output;

                    session.sendAgentMessage({
                        type: 'tool-call-result',
                        callId: callId,
                        output,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'codex_goal') {
                session.sendAgentMessage({
                    ...msg,
                    id: randomUUID()
                });
            }
            if (msgType === 'token_count') {
                session.sendAgentMessage({
                    ...msg,
                    id: randomUUID()
                });
            }
            if (msgType === 'plan_update') {
                session.sendAgentMessage({
                    type: 'tool-call',
                    name: 'update_plan',
                    callId: 'codex-plan-state',
                    input: {
                        plan: Array.isArray(msg.plan) ? msg.plan : [],
                        source: 'codex'
                    },
                    id: randomUUID()
                });
                session.sendAgentMessage({
                    type: 'tool-call-result',
                    callId: 'codex-plan-state',
                    output: {
                        plan: Array.isArray(msg.plan) ? msg.plan : [],
                        source: 'codex',
                        status: 'updated'
                    },
                    id: randomUUID()
                });
            }
            if (msgType === 'patch_apply_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const changes = asRecord(msg.changes) ?? {};
                    const changeCount = Object.keys(changes).length;
                    const filesMsg = changeCount === 1 ? '1 file' : `${changeCount} files`;
                    messageBuffer.addMessage(`Modifying ${filesMsg}...`, 'tool');

                    session.sendAgentMessage({
                        type: 'tool-call',
                        name: 'CodexPatch',
                        callId: callId,
                        input: {
                            auto_approved: msg.auto_approved ?? msg.autoApproved,
                            changes
                        },
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'patch_apply_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const stdout = asString(msg.stdout);
                    const stderr = asString(msg.stderr);
                    const success = Boolean(msg.success);

                    if (success) {
                        const message = stdout || 'Files modified successfully';
                        messageBuffer.addMessage(message.substring(0, 200), 'result');
                    } else {
                        const errorMsg = stderr || 'Failed to modify files';
                        messageBuffer.addMessage(`Error: ${errorMsg.substring(0, 200)}`, 'result');
                    }

                    session.sendAgentMessage({
                        type: 'tool-call-result',
                        callId: callId,
                        output: {
                            stdout,
                            stderr,
                            success
                        },
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'mcp_tool_call_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                const invocation = asRecord(msg.invocation) ?? {};
                const name = buildMcpToolName(
                    invocation.server ?? invocation.server_name ?? msg.server,
                    invocation.tool ?? invocation.tool_name ?? msg.tool
                );
                if (callId && name) {
                    session.sendAgentMessage({
                        type: 'tool-call',
                        name,
                        callId,
                        input: invocation.arguments ?? invocation.input ?? msg.arguments ?? msg.input ?? {},
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'mcp_tool_call_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                const rawResult = msg.result;
                let output = rawResult;
                let isError = false;
                const resultRecord = asRecord(rawResult);
                if (resultRecord) {
                    if (Object.prototype.hasOwnProperty.call(resultRecord, 'Ok')) {
                        output = resultRecord.Ok;
                    } else if (Object.prototype.hasOwnProperty.call(resultRecord, 'Err')) {
                        output = resultRecord.Err;
                        isError = true;
                    }
                }

                if (callId) {
                    session.sendAgentMessage({
                        type: 'tool-call-result',
                        callId,
                        output,
                        is_error: isError,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'turn_diff') {
                const diff = asString(msg.unified_diff);
                if (diff) {
                    diffProcessor.processDiff(diff);
                }
            }
        };

        registerAppServerPermissionHandlers({
            client: appServerClient,
            permissionHandler,
            onUserInputRequest: async ({ id, input }) => {
                try {
                    const answers = await permissionHandler.handleUserInputRequest(id, input);
                    return {
                        decision: 'accept',
                        answers
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.debug(`[Codex] request_user_input failed: ${message}`);
                    return {
                        decision: 'cancel'
                    };
                }
            }
        });

        appServerClient.setNotificationHandler((method, params) => {
            const events = appServerEventConverter.handleNotification(method, params);
            for (const event of events) {
                const eventRecord = asRecord(event) ?? { type: undefined };
                handleCodexEvent(eventRecord);
            }
        });

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client);
        this.happyServer = happyServer;

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        function logActiveHandles(tag: string) {
            if (!process.env.DEBUG) return;
            const anyProc: any = process as any;
            const handles = typeof anyProc._getActiveHandles === 'function' ? anyProc._getActiveHandles() : [];
            const requests = typeof anyProc._getActiveRequests === 'function' ? anyProc._getActiveRequests() : [];
            logger.debug(`[codex][handles] ${tag}: handles=${handles.length} requests=${requests.length}`);
            try {
                const kinds = handles.map((h: any) => (h && h.constructor ? h.constructor.name : typeof h));
                logger.debug(`[codex][handles] kinds=${JSON.stringify(kinds)}`);
            } catch {}
        }

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };

        await appServerClient.connect();
        await appServerClient.initialize({
            clientInfo: {
                name: 'hapi-codex-client',
                version: '1.0.0'
            },
            capabilities: {
                experimentalApi: true
            }
        });

        let hasThread = false;
        let pending: QueuedMessage | null = null;

        clearReadyAfterTurnTimer = () => {
            if (!readyAfterTurnTimer) {
                return;
            }
            clearTimeout(readyAfterTurnTimer);
            readyAfterTurnTimer = null;
        };

        scheduleReadyAfterTurn = () => {
            clearReadyAfterTurnTimer?.();
            readyAfterTurnTimer = setTimeout(() => {
                readyAfterTurnTimer = null;
                emitReadyIfIdle({
                    pending,
                    queueSize: () => session.queue.size(),
                    shouldExit: this.shouldExit,
                    sendReady
                });
            }, 120);
            readyAfterTurnTimer.unref?.();
        };

        const formatTokenCount = (value: number): string => {
            if (Math.abs(value) >= 1000) {
                const compact = value / 1000;
                return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
            }
            return value.toLocaleString();
        };

        const formatGoalUsage = (goal: Record<string, unknown>): string => {
            const tokensUsed = asNumber(goal.tokensUsed ?? goal.tokens_used) ?? 0;
            const tokenBudget = asNumber(goal.tokenBudget ?? goal.token_budget);
            const timeUsedSeconds = asNumber(goal.timeUsedSeconds ?? goal.time_used_seconds) ?? 0;
            const tokenPart = tokenBudget !== null
                ? `${formatTokenCount(tokensUsed)}/${formatTokenCount(tokenBudget)} tokens`
                : `${formatTokenCount(tokensUsed)} tokens`;
            const minutes = Math.floor(timeUsedSeconds / 60);
            const seconds = timeUsedSeconds % 60;
            const timePart = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
            return `${tokenPart} · ${timePart}`;
        };

        const formatGoalStatusMessage = (goal: Record<string, unknown>): string => {
            const status = asString(goal.status) ?? 'active';
            const objective = asString(goal.objective) ?? 'Goal';
            return `Goal ${status}: ${objective}
${formatGoalUsage(goal)}`;
        };

        const sendVisibleStatus = (message: string) => {
            messageBuffer.addMessage(message, 'status');
            session.sendSessionEvent({ type: 'message', message });
        };

        const sendGoalCleared = (threadId: string) => {
            session.sendAgentMessage({
                type: 'codex_goal',
                action: 'cleared',
                threadId,
                id: randomUUID()
            });
        };

        const resetCurrentTurnState = () => {
            turnInFlight = false;
            allowAnonymousTerminalEvent = false;
            this.currentTurnId = null;
            permissionHandler.reset();
            reasoningProcessor.abort();
            diffProcessor.reset();
            appServerEventConverter.reset();
            session.onThinkingChange(false);
        };

        const interruptActiveTurn = async () => {
            const threadId = this.currentThreadId;
            const turnId = this.currentTurnId;
            if (!threadId || !turnId) {
                return;
            }

            try {
                await appServerClient.interruptTurn({ threadId, turnId });
            } catch (error) {
                logger.debug('[Codex] Error interrupting app-server turn for slash command:', error);
            }
        };

        const resumeExistingThreadForCompact = async (mode: EnhancedMode): Promise<string | null> => {
            if (this.currentThreadId && this.currentThreadId !== invalidThreadId) {
                hasThread = true;
                return this.currentThreadId;
            }

            const resumeCandidate = session.sessionId && session.sessionId !== invalidThreadId
                ? session.sessionId
                : null;
            if (!resumeCandidate) {
                return null;
            }

            const threadParams = buildThreadStartParams({
                cwd: session.path,
                mode,
                mcpServers,
                cliOverrides: session.codexCliOverrides
            });

            try {
                const resumeResponse = await appServerClient.resumeThread({
                    threadId: resumeCandidate,
                    ...threadParams
                }, {
                    signal: this.abortController.signal
                });
                const resumeRecord = asRecord(resumeResponse);
                const resumeThread = resumeRecord ? asRecord(resumeRecord.thread) : null;
                const threadId = asString(resumeThread?.id) ?? resumeCandidate;
                applyResolvedModel(resumeRecord?.model);
                this.currentThreadId = threadId;
                session.onSessionFound(threadId);
                hasThread = true;
                logger.debug(`[Codex] Resumed app-server thread ${threadId} for /compact`);
                return threadId;
            } catch (error) {
                logger.warn(`[Codex] Failed to resume app-server thread ${resumeCandidate} for /compact`, error);
                return null;
            }
        };

        const resolveExistingThreadForGoal = async (mode: EnhancedMode): Promise<string | null> => {
            if (this.currentThreadId && this.currentThreadId !== invalidThreadId) {
                hasThread = true;
                return this.currentThreadId;
            }

            const resumeCandidate = session.sessionId && session.sessionId !== invalidThreadId
                ? session.sessionId
                : null;
            const threadParams = buildThreadStartParams({
                cwd: session.path,
                mode,
                mcpServers,
                cliOverrides: session.codexCliOverrides
            });

            if (resumeCandidate) {
                try {
                    const resumeResponse = await appServerClient.resumeThread({
                        threadId: resumeCandidate,
                        ...threadParams
                    }, { signal: this.abortController.signal });
                    const resumeRecord = asRecord(resumeResponse);
                    const resumeThread = resumeRecord ? asRecord(resumeRecord.thread) : null;
                    const threadId = asString(resumeThread?.id) ?? resumeCandidate;
                    applyResolvedModel(resumeRecord?.model);
                    this.currentThreadId = threadId;
                    session.onSessionFound(threadId);
                    hasThread = true;
                    return threadId;
                } catch (error) {
                    logger.warn(`[Codex] Failed to resume app-server thread ${resumeCandidate} for /goal`, error);
                }
            }

            return null;
        };

        const ensureThreadForGoal = async (mode: EnhancedMode): Promise<string> => {
            const existingThreadId = await resolveExistingThreadForGoal(mode);
            if (existingThreadId) return existingThreadId;

            const threadParams = buildThreadStartParams({
                cwd: session.path,
                mode,
                mcpServers,
                cliOverrides: session.codexCliOverrides
            });
            const threadResponse = await appServerClient.startThread(threadParams, { signal: this.abortController.signal });
            const threadRecord = asRecord(threadResponse);
            const thread = threadRecord ? asRecord(threadRecord.thread) : null;
            const threadId = asString(thread?.id);
            applyResolvedModel(threadRecord?.model);
            if (!threadId) {
                throw new Error('app-server thread/start did not return thread.id for /goal');
            }
            this.currentThreadId = threadId;
            session.onSessionFound(threadId);
            hasThread = true;
            return threadId;
        };

        const handleGoalCommand = async (slash: CodexGoalCommand, message: QueuedMessage): Promise<void> => {
            // Goal-control commands must not interrupt or reset active turns.
            // Native Codex owns goal mutation and emits thread/goal notifications.
            if (slash.action === 'unsupported') {
                sendVisibleStatus(slash.message);
                return;
            }

            try {
                if (slash.action === 'set') {
                    const threadId = await ensureThreadForGoal(message.mode);
                    await appServerClient.setThreadGoal({ threadId, objective: slash.objective, status: 'active' }, { signal: this.abortController.signal });
                    return;
                }

                const threadId = await resolveExistingThreadForGoal(message.mode);
                if (!threadId) {
                    sendVisibleStatus(slash.action === 'clear' ? 'No active goal to clear' : 'No active goal');
                    return;
                }

                if (slash.action === 'set-status') {
                    await appServerClient.setThreadGoal({ threadId, status: slash.status }, { signal: this.abortController.signal });
                    return;
                }

                if (slash.action === 'clear') {
                    const response = await appServerClient.clearThreadGoal({ threadId }, { signal: this.abortController.signal });
                    if (!response.cleared) {
                        sendVisibleStatus('No active goal to clear');
                    }
                    return;
                }

                const response = await appServerClient.getThreadGoal({ threadId }, { signal: this.abortController.signal });
                const goal = asRecord(response.goal);
                sendVisibleStatus(goal ? formatGoalStatusMessage(goal) : 'No active goal');
            } catch (error) {
                logger.debug('[Codex] /goal command failed', error);
                sendVisibleStatus('Goal command is not available in this Codex app-server. Upgrade Codex or enable goals.');
            }
        };

        const handleSpecialCommand = async (message: QueuedMessage): Promise<boolean> => {
            const specialCommand = parseCodexSpecialCommand(message.message);
            if (!specialCommand.type) {
                return false;
            }

            if (specialCommand.type === 'invalid') {
                await interruptActiveTurn();
                resetCurrentTurnState();
                sendVisibleStatus(specialCommand.message);
                return true;
            }

            if (specialCommand.type === 'clear') {
                await interruptActiveTurn();
                resetCurrentTurnState();
                const clearedThreadId = this.currentThreadId && this.currentThreadId !== invalidThreadId
                    ? this.currentThreadId
                    : session.sessionId && session.sessionId !== invalidThreadId
                        ? session.sessionId
                        : null;
                this.currentThreadId = null;
                invalidThreadId = null;
                hasThread = false;
                hasSummary = false;
                session.resetCodexThread();
                if (clearedThreadId) {
                    sendGoalCleared(clearedThreadId);
                }
                sendVisibleStatus('Context was reset');
                return true;
            }

            await interruptActiveTurn();
            resetCurrentTurnState();
            const threadId = await resumeExistingThreadForCompact(message.mode);
            if (!threadId) {
                sendVisibleStatus('Nothing to compact');
                return true;
            }

            sendVisibleStatus('Compaction started');
            try {
                await appServerClient.compactThread({ threadId }, {
                    signal: this.abortController.signal
                });
                sendVisibleStatus('Compaction completed');
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                sendVisibleStatus(`Compaction failed: ${detail}`);
            }
            return true;
        };

        while (!this.shouldExit) {
            logActiveHandles('loop-top');
            let message: QueuedMessage | null = pending;
            pending = null;
            if (!message) {
                const waitSignal = this.abortController.signal;
                const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
                if (!batch) {
                    if (waitSignal.aborted && !this.shouldExit) {
                        logger.debug('[codex]: Wait aborted while idle; ignoring and continuing');
                        continue;
                    }
                    logger.debug(`[codex]: batch=${!!batch}, shouldExit=${this.shouldExit}`);
                    break;
                }
                message = batch;
            }

            if (!message) {
                break;
            }

            messageBuffer.addMessage(message.message, 'user');

            try {
                const goalCommand = parseCodexGoalCommand(message.message);
                if (goalCommand) {
                    await handleGoalCommand(goalCommand, message);
                    continue;
                }

                if (await handleSpecialCommand(message)) {
                    continue;
                }

                if (!hasThread) {
                    const threadParams = buildThreadStartParams({
                        developerInstructions: this.recoveryContext ?? undefined,
                        cwd: session.path,
                        mode: message.mode,
                        mcpServers,
                        cliOverrides: session.codexCliOverrides
                    });

                    const resumeCandidate = session.sessionId && session.sessionId !== invalidThreadId
                        ? session.sessionId
                        : null;
                    let threadId: string | null = null;

                    if (resumeCandidate) {
                        try {
                            const resumeResponse = await appServerClient.resumeThread({
                                threadId: resumeCandidate,
                                ...threadParams
                            }, {
                                signal: this.abortController.signal
                            });
                            const resumeRecord = asRecord(resumeResponse);
                            const resumeThread = resumeRecord ? asRecord(resumeRecord.thread) : null;
                            threadId = asString(resumeThread?.id) ?? resumeCandidate;
                            applyResolvedModel(resumeRecord?.model);
                            logger.debug(`[Codex] Resumed app-server thread ${threadId}`);
                        } catch (error) {
                            logger.warn(`[Codex] Failed to resume app-server thread ${resumeCandidate}, starting new thread`, error);
                        }
                    }

                    if (!threadId) {
                        const threadResponse = await appServerClient.startThread(threadParams, {
                            signal: this.abortController.signal
                        });
                        const threadRecord = asRecord(threadResponse);
                        const thread = threadRecord ? asRecord(threadRecord.thread) : null;
                        threadId = asString(thread?.id);
                        applyResolvedModel(threadRecord?.model);
                        if (!threadId) {
                            throw new Error('app-server thread/start did not return thread.id');
                        }
                    }

                    if (!threadId) {
                        throw new Error('app-server resume did not return thread.id');
                    }

                    this.currentThreadId = threadId;
                    session.onSessionFound(threadId);
                    hasThread = true;

                // Consume recovery context after first successful thread creation
                if (hasThread && this.recoveryContext) {
                    this.recoveryContext = null
                }
                } else {
                    if (!this.currentThreadId) {
                        logger.debug('[Codex] Missing thread id; restarting app-server thread');
                        hasThread = false;
                        pending = message;
                        continue;
                    }
                }

                const turnParams = buildTurnStartParams({
                    threadId: this.currentThreadId,
                    message: message.message,
                    cwd: session.path,
                    mode: {
                        ...message.mode,
                        model: session.getModel() ?? message.mode.model
                    },
                    cliOverrides: session.codexCliOverrides
                });
                turnInFlight = true;
                allowAnonymousTerminalEvent = false;
                const turnResponse = await appServerClient.startTurn(turnParams, {
                    signal: this.abortController.signal
                });
                const turnRecord = asRecord(turnResponse);
                const turn = turnRecord ? asRecord(turnRecord.turn) : null;
                const turnId = asString(turn?.id);
                if (turnInFlight) {
                    if (turnId) {
                        this.currentTurnId = turnId;
                    } else if (!this.currentTurnId) {
                        allowAnonymousTerminalEvent = true;
                    }
                }
            } catch (error) {
                logger.warn('Error in codex session:', error);
                const isAbortError = error instanceof Error && error.name === 'AbortError';
                turnInFlight = false;
                allowAnonymousTerminalEvent = false;
                this.currentTurnId = null;

                if (isAbortError) {
                    messageBuffer.addMessage('Aborted by user', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                } else {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    messageBuffer.addMessage('Process exited unexpectedly', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Process exited unexpectedly' });
                    this.currentTurnId = null;
                    this.currentThreadId = null;
                    hasThread = false;
                    // Stop heartbeat so hub can mark session inactive
                    session.stopKeepAlive();
                    // Notify hub that thread crashed so auto-resume can trigger.
                    // Include error message so hub can detect upstream API corruption
                    // and clear the stale thread id.
                    session.sendSessionEvent({
                        type: 'thread-crashed',
                        error: errorMsg
                    });
                }
            } finally {
                if (!turnInFlight) {
                    permissionHandler.reset();
                    reasoningProcessor.abort();
                    diffProcessor.reset();
                    appServerEventConverter.reset();
                    session.onThinkingChange(false);
                    clearReadyAfterTurnTimer?.();
                    emitReadyIfIdle({
                        pending,
                        queueSize: () => session.queue.size(),
                        shouldExit: this.shouldExit,
                        sendReady
                    });
                }
                logActiveHandles('after-turn');
            }
        }
    }

    protected async cleanup(): Promise<void> {
        logger.debug('[codex-remote]: cleanup start');
        try {
            await this.appServerClient.disconnect();
        } catch (error) {
            logger.debug('[codex-remote]: Error disconnecting client', error);
        }

        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.happyServer) {
            this.happyServer.stop();
            this.happyServer = null;
        }

        this.permissionHandler?.reset();
        this.reasoningProcessor?.abort();
        this.diffProcessor?.reset();
        this.permissionHandler = null;
        this.reasoningProcessor = null;
        this.diffProcessor = null;

        logger.debug('[codex-remote]: cleanup done');
    }
}

export async function codexRemoteLauncher(session: CodexSession, recoveryContext?: string): Promise<'switch' | 'exit'> {
    const launcher = new CodexRemoteLauncher(session, recoveryContext);
    return launcher.launch();
}
