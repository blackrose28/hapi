import { logger } from '@/ui/logger';
import { grokLoop } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { GrokSession } from './session';
import type { GrokMode, PermissionMode } from './types';
import { bootstrapSession } from '@/agent/sessionFactory';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { getInvokedCwd } from '@/utils/invokedCwd';

export async function runGrok(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
    effort?: string;
    resumeSessionId?: string;
} = {}): Promise<void> {
    const workingDirectory = getInvokedCwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[grok] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[grok] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    // Persist only when the user (or runner) explicitly chose a model/effort on
    // launch. Mid-session selections are persisted by the hub via the
    // set-session-config RPC, not by this initial bootstrap.
    const initialModel = opts.model ?? null;
    const initialEffort = opts.effort ?? null;

    // NOTE: unlike upstream, this fork has no `bootstrapExistingSession` /
    // `registerLocalHandoffHandler` (those are introduced by the still-pending
    // codex-session-import-resume cart). Grok resume is handled entirely via
    // `bootstrapSession` + forwarding `--resume`/`--session-id` to the Grok
    // subprocess — matching the simpler bootstrapSession-only pattern already
    // used by runOpencode.ts/runKimi.ts/runPi.ts.
    const { api, session, sessionInfo } = await bootstrapSession({
        flavor: 'grok',
        startedBy,
        workingDirectory,
        agentState: initialState,
        model: initialModel ?? undefined,
        effort: initialEffort ?? undefined
    });

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<GrokMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model ?? null,
        effort: mode.effort ?? null
    }));

    const sessionWrapperRef: { current: GrokSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    let sessionModel: string | null = initialModel;
    let sessionEffort: string | null = initialEffort;

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'grok',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive()
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle.cleanupAndExit);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        sessionInstance.setModel(sessionModel);
        sessionInstance.setEffort(sessionEffort);

        // Notify hub immediately so the UI reflects the change without
        // waiting for the next 2s keepalive tick.
        sessionInstance.pushKeepAlive();

        logger.debug(`[grok] Synced session config for keepalive: permissionMode=${currentPermissionMode}, model=${sessionModel ?? '(default)'}, effort=${sessionEffort ?? '(default)'}`);
    };

    session.onUserMessage((message, localId) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: GrokMode = {
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined,
            effort: sessionEffort ?? undefined
        };
        messageQueue.push(formattedText, mode, localId);
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'grok')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModel = (value: unknown): string | null => {
        if (value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('Invalid model');
        }
        return value.trim();
    };

    const resolveEffort = (value: unknown): string | null => {
        if (value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('Invalid effort');
        }
        return value.trim();
    };

    // Grok registers 'set-session-config' inline instead of through a shared
    // helper — matching the pattern every other flavor's run*.ts follows in
    // this fork (there is no shared `sessionConfigRpc.ts` in this tree).
    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; model?: unknown; effort?: unknown };
        const applied: Record<string, unknown> = {};

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
            applied.permissionMode = currentPermissionMode;
        }

        if (config.model !== undefined) {
            sessionModel = resolveModel(config.model);
            applied.model = sessionModel;
        }

        if (config.effort !== undefined) {
            sessionEffort = resolveEffort(config.effort);
            applied.effort = sessionEffort;
        }

        syncSessionMode();
        return { applied };
    });

    let crashed = false;

    try {
        await grokLoop({
            path: workingDirectory,
            hapiSessionId: sessionInfo.id,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined,
            effort: sessionEffort ?? undefined,
            resumeSessionId: opts.resumeSessionId,
            onModelRollback: (model) => {
                sessionModel = model;
            },
            onEffortRollback: (effort) => {
                sessionEffort = effort;
            },
            onConfigDiscovered: (config) => {
                sessionModel = config.model;
                sessionEffort = config.effort;
                syncSessionMode();
            },
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        crashed = true;
        lifecycle.markCrash(error);
        logger.debug('[grok] Loop error:', error);
    } finally {
        const localFailure = sessionWrapperRef.current?.localLaunchFailure;
        if (localFailure?.exitReason === 'exit') {
            lifecycle.setExitCode(1);
            lifecycle.setArchiveReason(`Local launch failed: ${localFailure.message.slice(0, 200)}`);
            lifecycle.setSessionEndReason('error');
        } else if (!crashed) {
            lifecycle.setSessionEndReason('completed');
        }
        await lifecycle.cleanupAndExit();
    }
}
