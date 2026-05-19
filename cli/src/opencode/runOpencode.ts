import { logger } from '@/ui/logger';
import { opencodeLoop } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { OpencodeSession } from './session';
import type { OpencodeMode, PermissionMode } from './types';
import { bootstrapExistingSession, bootstrapSession } from '@/agent/sessionFactory';
import { registerLocalHandoffHandler } from '@/agent/localHandoff';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { startOpencodeHookServer } from './utils/startOpencodeHookServer';
import { registerSessionConfigRpc } from '@/agent/sessionConfigRpc';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { getInvokedCwd } from '@/utils/invokedCwd';

export async function runOpencode(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
    modelReasoningEffort?: string;
    resumeSessionId?: string;
    recoveryContext?: string;
    existingSessionId?: string;
    workingDirectory?: string;
} = {}): Promise<void> {
    const workingDirectory = opts.workingDirectory ?? getInvokedCwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[opencode] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[opencode] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    // Persist only when the user (or runner) explicitly chose a model on launch.
    // Mid-session selections are persisted by the hub via the set-session-config RPC,
    // not by this initial bootstrap.
    const initialModel = opts.model ?? null;

    const bootstrap = opts.existingSessionId
        ? await bootstrapExistingSession({
            sessionId: opts.existingSessionId,
            flavor: 'opencode',
            startedBy,
            workingDirectory
        })
        : await bootstrapSession({
            flavor: 'opencode',
            startedBy,
            workingDirectory,
            agentState: initialState,
            model: initialModel ?? undefined,
            modelReasoningEffort: opts.modelReasoningEffort
        });
    const { api, session } = bootstrap;

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<OpencodeMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model ?? null,
        modelReasoningEffort: mode.modelReasoningEffort ?? null
    }));

    const sessionWrapperRef: { current: OpencodeSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    let sessionModel: string | null = initialModel;
    let sessionModelReasoningEffort: string | null = opts.modelReasoningEffort ?? null;
    const hookServer = await startOpencodeHookServer({
        onEvent: (event) => {
            const currentSession = sessionWrapperRef.current;
            if (!currentSession) {
                return;
            }
            currentSession.emitHookEvent(event);
        }
    });
    const hookUrl = `http://127.0.0.1:${hookServer.port}/hook/opencode`;

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'opencode',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive(),
        onAfterClose: () => {
            hookServer.stop();
        }
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle.cleanupAndExit);
    registerLocalHandoffHandler(session.rpcHandlerManager, lifecycle);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        sessionInstance.setModel(sessionModel);
        sessionInstance.setModelReasoningEffort(sessionModelReasoningEffort);

        // Notify hub immediately so the UI reflects the change without
        // waiting for the next 2s keepalive tick.
        sessionInstance.pushKeepAlive();

        logger.debug(`[opencode] Synced session config for keepalive: permissionMode=${currentPermissionMode}, model=${sessionModel ?? '(default)'}, modelReasoningEffort=${sessionModelReasoningEffort ?? '(default)'}`);
    };

    session.onUserMessage((message, localId) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: OpencodeMode = {
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined,
            modelReasoningEffort: sessionModelReasoningEffort
        };
        messageQueue.push(formattedText, mode, localId);
    });

    session.onCancelQueuedMessage((localId) => {
        const removed = messageQueue.cancelByLocalId(localId);
        logger.debug(`[opencode] cancelByLocalId(${localId}): ${removed ? 'removed' : 'not found (best-effort)'}`);
        return removed;
    });

    registerSessionConfigRpc({
        rpcHandlerManager: session.rpcHandlerManager,
        flavor: 'opencode',
        modelMode: 'nullable',
        modelReasoningEffortMode: 'nullable',
        onApply: (config: any) => {
            if (config.permissionMode !== undefined) currentPermissionMode = config.permissionMode as any;
            if (config.model !== undefined) sessionModel = config.model;
            if (config.modelReasoningEffort !== undefined) sessionModelReasoningEffort = config.modelReasoningEffort;
        },
        onAfterApply: syncSessionMode
    });

    let crashed = false;

    try {
        await opencodeLoop({
            path: workingDirectory,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined,
            modelReasoningEffort: sessionModelReasoningEffort ?? undefined,
            resumeSessionId: opts.resumeSessionId,
            recoveryContext: opts.recoveryContext,
            hookServer,
            hookUrl,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        crashed = true;
        lifecycle.markCrash(error);
        logger.debug('[opencode] Loop error:', error);
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
