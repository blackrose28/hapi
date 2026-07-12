import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { AgentFlavor } from '@hapi/protocol';
import type { AgentAvailableCommand, AgentBackend, AgentMessage, AgentSessionConfig, PermissionRequest, PermissionResponse, PromptContent } from '@/agent/types';
import { asString, isObject } from '@hapi/protocol';
import { AcpStdioTransport, type AcpStderrError } from './AcpStdioTransport';
import { AcpMessageHandler, type AcpTextChunkMode } from './AcpMessageHandler';
import { ACP_SESSION_UPDATE_TYPES } from './constants';
import { logger } from '@/ui/logger';
import { withRetry } from '@/utils/time';
import packageJson from '../../../../package.json';

type PendingPermission = {
    resolve: (result: { outcome: { outcome: string; optionId?: string } }) => void;
};

export type AcpModelDescriptor = {
    modelId: string;
    name?: string;
    reasoningEfforts?: Array<{ value: string; name?: string; isDefault?: boolean }>;
};

export type AcpAvailableCommand = AgentAvailableCommand;

export type AcpEffortDescriptor = {
    effortId: string;
    name?: string;
};

export type AcpSessionModelsMetadata = {
    availableModels: AcpModelDescriptor[];
    currentModelId: string | null;
    availableEfforts?: AcpEffortDescriptor[];
    currentEffortId?: string | null;
};

export type AcpSessionInfoUpdate = {
    sessionId: string | null;
    title: string | null;
};

export type AcpThoughtLevelOption = {
    value: string;
    name?: string;
};

export type AcpThoughtLevelConfig = {
    currentValue: string | null;
    options: AcpThoughtLevelOption[];
};

export class AcpSdkBackend implements AgentBackend {
    private transport: AcpStdioTransport | null = null;
    private permissionHandler: ((request: PermissionRequest) => void) | null = null;
    private stderrErrorHandler: ((error: AcpStderrError) => void) | null = null;
    private availableCommandsHandler: ((commands: AcpAvailableCommand[]) => void) | null = null;
    private sessionInfoUpdateListener: ((update: AcpSessionInfoUpdate) => void) | null = null;
    private readonly pendingPermissions = new Map<string, PendingPermission>();
    private readonly sessionModelsMetadata = new Map<string, AcpSessionModelsMetadata>();
    private readonly sessionThoughtLevelOptions = new Map<string, AcpThoughtLevelConfig>();
    private readonly initialAvailableCommands = new Set<string>();
    private readonly sessionAvailableCommands = new Map<string, Set<string>>();
    private autoPermissionModeEnabled: boolean | null = null;
    private readonly sessionInfoRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private messageHandler: AcpMessageHandler | null = null;
    private activeSessionId: string | null = null;
    private isProcessingMessage = false;
    private responseCompleteResolvers: Array<() => void> = [];
    private lastSessionUpdateAt = 0;
    private latestUsageUpdate: AcpUsageUpdate | null = null;
    private activeOnUpdate: ((msg: AgentMessage) => void) | null = null;

    /** Retry configuration for ACP initialization */
    private static readonly INIT_RETRY_OPTIONS = {
        maxAttempts: 3,
        minDelay: 1000,
        maxDelay: 5000
    };
    private static readonly UPDATE_QUIET_PERIOD_MS = 120;
    private static readonly UPDATE_DRAIN_TIMEOUT_MS = 2000;
    private static readonly PRE_PROMPT_UPDATE_QUIET_PERIOD_MS = 200;
    private static readonly PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS = 1200;
    private static readonly SESSION_TITLE_REFRESH_DELAYS_MS = [1000, 3000];
    // After the initial post-prompt drain, slow-tailing models (DeepSeek,
    // GPT-5.5, etc.) can keep sending agentMessageChunk notifications. We poll
    // flushText()/flushReasoning() on a short interval so the UI keeps
    // streaming smoothly, and block prompt() from resolving until the model is
    // truly quiet — that way turn_complete only fires after every straggler
    // has been emitted to the current turn's onUpdate. Bounded by
    // LATE_FLUSH_WINDOW_MS so a stuck stream never wedges the session.
    //
    // 6000ms covers tails up to ~5s observed against GPT-5.5 / DeepSeek V4 Pro
    // with 1s headroom. The 250ms quiet check is anchored to drainLateBuffers
    // entry time, so every turn pays at least one quiet period before
    // resolving — that minimum is what catches stragglers arriving just after
    // session/prompt resolves when the model paused mid-turn. 50ms polling
    // keeps the UI responsive without measurable CPU cost (flush is a no-op on
    // empty buffers). All three can be tightened once we have telemetry on
    // real-world tail distributions.
    private static readonly LATE_FLUSH_INTERVAL_MS = 50;
    private static readonly LATE_FLUSH_QUIET_PERIOD_MS = 250;
    private static readonly LATE_FLUSH_WINDOW_MS = 6000;

    constructor(private readonly options: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
        textChunkMode?: AcpTextChunkMode;
    }) {}

    async initialize(): Promise<void> {
        if (this.transport) return;

        this.transport = new AcpStdioTransport({
            command: this.options.command,
            args: this.options.args,
            env: this.options.env
        });

        this.transport.onNotification((method, params) => {
            if (method === 'session/update') {
                this.handleSessionUpdate(params);
            } else if (method === '_x.ai/settings/update') {
                this.handleSettingsUpdate(params);
            }
        });

        this.transport.onStderrError((error) => {
            this.stderrErrorHandler?.(error);
        });

        this.transport.registerRequestHandler('session/request_permission', async (params, requestId) => {
            return await this.handlePermissionRequest(params, requestId);
        });

        const response = await withRetry(
            () => this.transport!.sendRequest('initialize', {
                protocolVersion: 1,
                clientCapabilities: {
                    fs: { readTextFile: false, writeTextFile: false },
                    terminal: false,
                    _meta: {
                        // Cursor ACP exposes Composer's non-fast/fast choice as separate
                        // `model` + `fast` config options only when the client advertises
                        // this capability. Agents that do not know this metadata ignore it.
                        parameterizedModelPicker: true
                    }
                },
                clientInfo: {
                    name: 'hapi',
                    version: packageJson.version
                }
            }),
            {
                ...AcpSdkBackend.INIT_RETRY_OPTIONS,
                onRetry: (error, attempt, nextDelayMs) => {
                    logger.debug(`[ACP] Initialize attempt ${attempt} failed, retrying in ${nextDelayMs}ms`, error);
                }
            }
        );

        if (!isObject(response) || typeof response.protocolVersion !== 'number') {
            throw new Error('Invalid initialize response from ACP agent');
        }

        this.captureAvailableCommands(null, response);

        logger.debug(`[ACP] Initialized with protocol version ${response.protocolVersion}`);
    }

    /**
     * Sends Grok's `session/set_mode` RPC (ACP's mode/thought-level switch,
     * distinct from `session/set_config_option`) and, on success, updates the
     * cached currentValue for the session's thought_level config option so
     * getThoughtLevelConfigOption() reflects the switch immediately.
     */
    async setMode(sessionId: string, modeId: string): Promise<void> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        await this.waitForResponseComplete();

        const response = await this.transport.sendRequest('session/set_mode', {
            sessionId,
            modeId
        });

        this.updateThoughtLevelCurrentValue(sessionId, modeId);
        this.captureSessionModelsMetadata(sessionId, response);
        this.captureThoughtLevelConfigOption(sessionId, response);
    }

    async newSession(config: AgentSessionConfig): Promise<string> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        const response = await withRetry(
            () => this.transport!.sendRequest('session/new', {
                cwd: config.cwd,
                mcpServers: config.mcpServers
            }),
            {
                ...AcpSdkBackend.INIT_RETRY_OPTIONS,
                onRetry: (error, attempt, nextDelayMs) => {
                    logger.debug(`[ACP] session/new attempt ${attempt} failed, retrying in ${nextDelayMs}ms`, error);
                }
            }
        );

        const sessionId = isObject(response) ? asString(response.sessionId) : null;
        if (!sessionId) {
            throw new Error('Invalid session/new response from ACP agent');
        }

        this.activeSessionId = sessionId;
        this.captureSessionModelsMetadata(sessionId, response);
        this.captureThoughtLevelConfigOption(sessionId, response);
        this.captureAvailableCommands(sessionId, response);
        return sessionId;
    }

    async loadSession(config: AgentSessionConfig & { sessionId: string }): Promise<string> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        const response = await withRetry(
            () => this.transport!.sendRequest('session/load', {
                sessionId: config.sessionId,
                cwd: config.cwd,
                mcpServers: config.mcpServers
            }),
            {
                ...AcpSdkBackend.INIT_RETRY_OPTIONS,
                onRetry: (error, attempt, nextDelayMs) => {
                    logger.debug(`[ACP] session/load attempt ${attempt} failed, retrying in ${nextDelayMs}ms`, error);
                }
            }
        );

        const loadedSessionId = isObject(response) ? asString(response.sessionId) : null;
        const sessionId = loadedSessionId ?? config.sessionId;
        this.activeSessionId = sessionId;
        this.captureSessionModelsMetadata(sessionId, response);
        this.captureThoughtLevelConfigOption(sessionId, response);
        this.captureAvailableCommands(sessionId, response);
        return sessionId;
    }

    async setModel(
        sessionId: string,
        modelId: string,
        opts?: { flavor?: AgentFlavor }
    ): Promise<void> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        // The launcher serializes setModel between turns, but defensively wait for any
        // in-flight prompt to drain so we never interleave a switch with a session/prompt.
        await this.waitForResponseComplete();

        // ACP defines `session/set_model` ({ sessionId, modelId }) for inline model
        // switching — see ACP SDK schema `x-method: session/set_model`. OpenCode
        // 1.14.30 implements this exact wire name (the SDK's TypeScript helper is
        // exposed as `unstable_setSessionModel` but the JSON-RPC method on the wire
        // is unprefixed). Errors (including JSON-RPC 'method not found') propagate
        // as rejections from the transport; the launcher's catch block handles them.
        const response = await this.transport.sendRequest('session/set_model', {
            sessionId,
            modelId
        });

        if (opts?.flavor === 'opencode' || opts?.flavor === 'grok') {
            // Some OpenCode/Grok builds return only an opaque `_meta`; newer builds may
            // also return configOptions. Capture what is present, then preserve an
            // optimistic current model when the response omits normalized models.
            this.captureSessionModelsMetadata(sessionId, response);
            this.updateCurrentModelOptimistic(sessionId, modelId);
        } else {
            // For other flavors (e.g. Gemini), if the response carries metadata,
            // capture it. Missing fields are silently ignored.
            this.captureSessionModelsMetadata(sessionId, response);
        }
    }

    async setConfigOption(
        sessionId: string,
        configId: string,
        value: string,
        _opts?: { flavor?: AgentFlavor }
    ): Promise<void> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        await this.waitForResponseComplete();

        const response = await this.transport.sendRequest('session/set_config_option', {
            sessionId,
            configId,
            value
        });
        this.captureSessionModelsMetadata(sessionId, response);
    }

    /**
     * Returns the per-session models metadata captured from session/new (or
     * session/load, or session/set_model). Returns undefined if the agent did
     * not include the optional `models` block in its response.
     */
    getSessionModelsMetadata(sessionId: string): AcpSessionModelsMetadata | undefined {
        return this.sessionModelsMetadata.get(sessionId);
    }

    /**
     * Returns Grok's thought-level (reasoning effort) config option for a
     * session, synthesized from the `_meta['x.ai/sessionConfig']` block that
     * Grok returns on session/new, session/load, and session/set_mode
     * responses (see captureThoughtLevelConfigOption).
     */
    getThoughtLevelConfigOption(sessionId: string): AcpThoughtLevelConfig | undefined {
        return this.sessionThoughtLevelOptions.get(sessionId);
    }

    /**
     * Returns true if the ACP agent has advertised `command` as an available
     * slash command, either for this specific session or in the initial
     * (pre-session) available-commands snapshot captured at initialize().
     * `command === 'auto'` additionally checks the `_x.ai/settings/update`
     * notification's `auto_permission_mode_enabled` flag — this fork has no
     * 'auto' GrokPermissionMode (see GROK_PERMISSION_MODES), so that branch
     * is currently inert but harmless, kept for ACP protocol parity.
     */
    hasAvailableCommand(sessionId: string, command: string): boolean {
        if (command === 'auto' && this.autoPermissionModeEnabled === true) {
            return true;
        }
        return this.sessionAvailableCommands.get(sessionId)?.has(command)
            ?? this.initialAvailableCommands.has(command);
    }

    /** Forwards stable ACP session metadata updates independently of prompt streaming. */
    setSessionInfoUpdateListener(listener: ((update: AcpSessionInfoUpdate) => void) | null): void {
        this.sessionInfoUpdateListener = listener;
    }

    /** Reads the agent's persisted native title through stable ACP session/list. */
    async refreshSessionInfo(sessionId: string, cwd: string): Promise<void> {
        const existingTimer = this.sessionInfoRefreshTimers.get(sessionId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.sessionInfoRefreshTimers.delete(sessionId);
        }
        await this.refreshSessionInfoAttempt(sessionId, cwd, 0);
    }

    private async refreshSessionInfoAttempt(sessionId: string, cwd: string, retryIndex: number): Promise<void> {
        if (!this.transport) {
            return;
        }
        try {
            const response = await this.transport.sendRequest('session/list', { cwd }, { timeoutMs: 5000 });
            if (!isObject(response) || !Array.isArray(response.sessions)) {
                return;
            }
            const match = response.sessions.find((entry) =>
                isObject(entry) && asString(entry.sessionId) === sessionId
            );
            if (!isObject(match) || (typeof match.title !== 'string' && match.title !== null)) {
                return;
            }
            this.sessionInfoUpdateListener?.({ sessionId, title: match.title });
            if (match.title === null || !this.isPlaceholderSessionTitle(match.title)) {
                return;
            }
            const delayMs = AcpSdkBackend.SESSION_TITLE_REFRESH_DELAYS_MS[retryIndex];
            if (delayMs === undefined) {
                return;
            }
            const timer = setTimeout(() => {
                this.sessionInfoRefreshTimers.delete(sessionId);
                void this.refreshSessionInfoAttempt(sessionId, cwd, retryIndex + 1);
            }, delayMs);
            timer.unref();
            this.sessionInfoRefreshTimers.set(sessionId, timer);
        } catch (error) {
            logger.debug('[ACP] session/list title refresh unavailable', error);
        }
    }

    private isPlaceholderSessionTitle(title: string): boolean {
        const normalizedTitle = title.trim();
        return normalizedTitle.length === 0
            || normalizedTitle === 'Untitled'
            || /^(?:New|Child) session - \d{4}-\d{2}-\d{2}T/.test(normalizedTitle);
    }

    async prompt(
        sessionId: string,
        content: PromptContent[],
        onUpdate: (msg: AgentMessage) => void
    ): Promise<void> {
        if (!this.transport) {
            throw new Error('ACP transport not initialized');
        }

        this.activeSessionId = sessionId;
        // Single-phase handler swap: drain any chunks still buffered in the
        // previous turn's handler so they emit via that turn's onUpdate, then
        // immediately install the new handler. The post-prompt drainLateBuffers
        // means by this point the previous turn should already be quiet; this
        // wait is a cheap safety net for the rare case where a chunk arrived
        // between prompt() resolving and the next turn starting.
        await this.waitForSessionUpdateQuiet(
            AcpSdkBackend.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS,
            AcpSdkBackend.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS
        );
        this.messageHandler?.drainBuffers();
        this.messageHandler = null;
        await this.waitForSessionUpdateQuiet(
            AcpSdkBackend.PRE_PROMPT_UPDATE_QUIET_PERIOD_MS,
            AcpSdkBackend.PRE_PROMPT_UPDATE_DRAIN_TIMEOUT_MS
        );
        this.messageHandler = new AcpMessageHandler(onUpdate, { textChunkMode: this.options.textChunkMode });
        this.activeOnUpdate = onUpdate;
        this.isProcessingMessage = true;
        this.lastSessionUpdateAt = Date.now();
        let stopReason: string | null = null;

        try {
            // No timeout for prompt requests - they can run for extended periods
            // during complex tasks, tool-heavy operations, or slow model responses
            const response = await this.transport.sendRequest('session/prompt', {
                sessionId,
                prompt: content
            }, { timeoutMs: Infinity });

            stopReason = isObject(response) ? asString(response.stopReason) : null;
        } finally {
            // Start the post-response drain window when the prompt response returns,
            // not at the last update timestamp. Under load, the response itself may
            // be delayed long enough that trailing tool updates are scheduled after
            // an older text update; without resetting here, the quiet-period check
            // can return immediately and emit turn_complete before those updates.
            this.lastSessionUpdateAt = Date.now();
            await this.waitForSessionUpdateQuiet(
                AcpSdkBackend.UPDATE_QUIET_PERIOD_MS,
                AcpSdkBackend.UPDATE_DRAIN_TIMEOUT_MS
            );
            this.messageHandler?.drainBuffers();
            // Block here until the model truly stops streaming straggler
            // chunks (or LATE_FLUSH_WINDOW_MS elapses), so turn_complete only
            // fires once every chunk has been emitted to this turn's onUpdate.
            await this.drainLateBuffers();
            try {
                const latestUsageUpdate = this.readLatestUsageUpdate();
                if (promptUsage) {
                    onUpdate({
                        type: 'usage',
                        inputTokens: promptUsage.inputTokens,
                        outputTokens: promptUsage.outputTokens,
                        totalTokens: promptUsage.totalTokens,
                        thoughtTokens: promptUsage.thoughtTokens,
                        cacheReadTokens: promptUsage.cacheReadTokens,
                        contextTokens: latestUsageUpdate ? latestUsageUpdate.contextTokens : undefined,
                        contextWindow: latestUsageUpdate ? latestUsageUpdate.contextWindow : undefined
                    });
                } else if (
                    latestUsageUpdate
                    && (latestUsageUpdate.contextTokens !== undefined || latestUsageUpdate.contextWindow !== undefined)
                ) {
                    // Agent did not return prompt usage (slash-handled turns,
                    // errored turns), but we did see ACP usage updates during
                    // the turn. Emit a context-only usage so the status bar
                    // reflects the current context size.
                    onUpdate({
                        type: 'usage',
                        inputTokens: 0,
                        outputTokens: 0,
                        contextTokens: latestUsageUpdate.contextTokens,
                        contextWindow: latestUsageUpdate.contextWindow
                    });
                }
                if (stopReason) {
                    onUpdate({ type: 'turn_complete', stopReason });
                }
            } finally {
                this.activeOnUpdate = null;
                this.isProcessingMessage = false;
                this.notifyResponseComplete();
            }
        }
    }

    /**
     * Poll flushText()/flushReasoning() on a short interval until the model
     * has been quiet for LATE_FLUSH_QUIET_PERIOD_MS or LATE_FLUSH_WINDOW_MS
     * elapses. Polling keeps the UI streaming smoothly while we wait; the
     * quiet-window check lets fast models exit almost immediately (Claude
     * tail typically < 100ms) while still bounding slow-tailing models
     * (GPT-5.5, DeepSeek V4 Pro).
     *
     * The quiet measurement is anchored to entry time, not just
     * lastSessionUpdateAt: if session/prompt paused mid-turn (chunks → pause
     * → stopReason), lastSessionUpdateAt is already stale on entry and we
     * would otherwise exit immediately, missing any straggler that arrives
     * just after session/prompt resolves.
     */
    private async drainLateBuffers(): Promise<void> {
        const quietBaseline = Date.now();
        const deadline = quietBaseline + AcpSdkBackend.LATE_FLUSH_WINDOW_MS;
        while (Date.now() < deadline) {
            const latestActivityAt = Math.max(this.lastSessionUpdateAt, quietBaseline);
            const elapsedSinceUpdate = Date.now() - latestActivityAt;
            if (elapsedSinceUpdate >= AcpSdkBackend.LATE_FLUSH_QUIET_PERIOD_MS) {
                return;
            }
            const remainingBudget = deadline - Date.now();
            const waitMs = Math.max(1, Math.min(AcpSdkBackend.LATE_FLUSH_INTERVAL_MS, remainingBudget));
            await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
            this.messageHandler?.flushReasoning();
            this.messageHandler?.flushText();
        }
    }

    async cancelPrompt(sessionId: string): Promise<void> {
        if (!this.transport) {
            return;
        }

        this.transport.sendNotification('session/cancel', { sessionId });
    }

    async respondToPermission(
        _sessionId: string,
        request: PermissionRequest,
        response: PermissionResponse
    ): Promise<void> {
        const pending = this.pendingPermissions.get(request.id);
        if (!pending) {
            logger.debug('[ACP] No pending permission request for id', request.id);
            return;
        }

        this.pendingPermissions.delete(request.id);

        if (response.outcome === 'cancelled') {
            pending.resolve({ outcome: { outcome: 'cancelled' } });
            return;
        }

        pending.resolve({
            outcome: {
                outcome: 'selected',
                optionId: response.optionId
            }
        });
    }

    onPermissionRequest(handler: (request: PermissionRequest) => void): void {
        this.permissionHandler = handler;
    }

    onStderrError(handler: (error: AcpStderrError) => void): void {
        this.stderrErrorHandler = handler;
    }

    onAvailableCommands(handler: ((commands: AcpAvailableCommand[]) => void) | null): void {
        this.availableCommandsHandler = handler;
    }

    /**
     * Returns true if currently processing a message (prompt in progress).
     * Useful for checking if it's safe to perform session operations.
     */
    get processingMessage(): boolean {
        return this.isProcessingMessage;
    }

    getLastSessionUpdateAt(): number {
        return this.lastSessionUpdateAt;
    }

    /**
     * Wait for any in-progress response to complete.
     * Resolves immediately if no response is being processed.
     * Use this before performing operations that require the response to be complete,
     * like session swap or sending task_complete.
     */
    async waitForResponseComplete(): Promise<void> {
        if (!this.isProcessingMessage) {
            return;
        }
        return new Promise<void>((resolve) => {
            this.responseCompleteResolvers.push(resolve);
        });
    }

    async disconnect(): Promise<void> {
        if (!this.transport) return;
        for (const timer of this.sessionInfoRefreshTimers.values()) {
            clearTimeout(timer);
        }
        this.sessionInfoRefreshTimers.clear();
        this.messageHandler?.drainBuffers();
        this.messageHandler = null;
        this.activeOnUpdate = null;
        this.activeSessionId = null;
        this.isProcessingMessage = false;
        this.sessionModelsMetadata.clear();
        this.sessionThoughtLevelOptions.clear();
        this.initialAvailableCommands.clear();
        this.sessionAvailableCommands.clear();
        this.autoPermissionModeEnabled = null;
        this.notifyResponseComplete();
        await this.transport.close();
        this.transport = null;
    }

    private handleSessionUpdate(params: unknown): void {
        if (!isObject(params)) return;
        const sessionId = asString(params.sessionId);
        if (this.activeSessionId && sessionId && sessionId !== this.activeSessionId) {
            return;
        }
        this.lastSessionUpdateAt = Date.now();
        const update = params.update;
        this.emitAvailableCommands(update);
        if (sessionId) {
            this.captureAvailableCommands(sessionId, update);
        }
        this.forwardSessionInfoUpdate(sessionId, update);
        this.messageHandler?.handleUpdate(update);
    }

    private captureUsageUpdate(update: unknown): void {
        if (!isObject(update)) return;
        if (asString(update.sessionUpdate) !== ACP_SESSION_UPDATE_TYPES.usageUpdate) return;

        const contextTokens = this.asFiniteNumber(update.used) ?? undefined;
        const contextWindow = this.asFiniteNumber(update.size) ?? undefined;
        const prev = this.latestUsageUpdate;
        const changed = !prev
            || prev.contextTokens !== contextTokens
            || prev.contextWindow !== contextWindow;
        this.latestUsageUpdate = { contextTokens, contextWindow };

        // Surface context updates mid-turn so the web status bar shows live
        // ctx N/M (X%) instead of staying blank until the final prompt usage
        // arrives. ACP usage_update only carries context tokens, so I/O is
        // sent as 0; the final prompt-finalize emit overwrites with the real
        // input/output totals.
        if (
            changed
            && this.activeOnUpdate
            && (contextTokens !== undefined || contextWindow !== undefined)
        ) {
            this.activeOnUpdate({
                type: 'usage',
                inputTokens: 0,
                outputTokens: 0,
                contextTokens,
                contextWindow
            });
        }
    }

    private readLatestUsageUpdate(): AcpUsageUpdate | null {
        return this.latestUsageUpdate;
    }
    /**
     * Grok's `_x.ai/settings/update` notification (distinct from
     * `session/update`) reports whether the account/CLI build has Auto
     * permission mode enabled. Cached for hasAvailableCommand('auto') — this
     * fork has no 'auto' GrokPermissionMode (see GROK_PERMISSION_MODES), so
     * the cached flag is currently inert but harmless, kept for ACP protocol
     * parity.
     */
    private handleSettingsUpdate(params: unknown): void {
        if (!isObject(params) || !('auto_permission_mode_enabled' in params)) return;
        this.autoPermissionModeEnabled = params.auto_permission_mode_enabled === true;
    }

    private forwardSessionInfoUpdate(sessionId: string | null, update: unknown): void {
        if (!isObject(update) || update.sessionUpdate !== ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate) {
            return;
        }
        if (typeof update.title !== 'string' && update.title !== null) {
            return;
        }
        this.sessionInfoUpdateListener?.({ sessionId, title: update.title });
    }

    private emitAvailableCommands(update: unknown): void {
        if (!isObject(update)) return;
        if (update.sessionUpdate !== 'available_commands_update') return;
        if (!Array.isArray(update.availableCommands)) return;

        const commands: AcpAvailableCommand[] = [];
        for (const entry of update.availableCommands) {
            if (!isObject(entry)) continue;
            const name = asString(entry.name);
            if (!name) continue;
            const description = asString(entry.description) ?? undefined;
            commands.push(description ? { name, description } : { name });
        }

        if (commands.length > 0) {
            this.availableCommandsHandler?.(commands);
        }
    }

    private async waitForSessionUpdateQuiet(quietMs: number, timeoutMs: number): Promise<void> {
        if (quietMs <= 0 || timeoutMs <= 0) {
            return;
        }

        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const elapsedSinceUpdate = Date.now() - this.lastSessionUpdateAt;
            if (elapsedSinceUpdate >= quietMs) {
                return;
            }

            const remainingToQuiet = quietMs - elapsedSinceUpdate;
            const remainingBudget = deadline - Date.now();
            const waitMs = Math.max(1, Math.min(remainingToQuiet, remainingBudget));
            await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }
    }

    private async handlePermissionRequest(params: unknown, requestId: string | number | null): Promise<unknown> {
        if (!isObject(params)) {
            return { outcome: { outcome: 'cancelled' } };
        }

        const sessionId = asString(params.sessionId) ?? this.activeSessionId ?? 'unknown';
        const toolCall = isObject(params.toolCall) ? params.toolCall : {};
        const toolCallId = asString(toolCall.toolCallId) ?? `tool-${Date.now()}`;
        const title = asString(toolCall.title) ?? undefined;
        const kind = asString(toolCall.kind) ?? undefined;
        const rawInput = 'rawInput' in toolCall ? toolCall.rawInput : undefined;
        const rawOutput = 'rawOutput' in toolCall ? toolCall.rawOutput : undefined;
        const options = Array.isArray(params.options)
            ? params.options
                .filter((option) => isObject(option))
                .map((option, index) => ({
                    optionId: asString(option.optionId) ?? `option-${index + 1}`,
                    name: asString(option.name) ?? `Option ${index + 1}`,
                    kind: asString(option.kind) ?? 'allow_once'
                }))
            : [];

        const request: PermissionRequest = {
            id: toolCallId,
            sessionId,
            toolCallId,
            title,
            kind,
            rawInput,
            rawOutput,
            options
        };

        const responsePromise = new Promise((resolve) => {
            this.pendingPermissions.set(toolCallId, { resolve });
        });

        if (this.permissionHandler) {
            try {
                this.permissionHandler(request);
            } catch (error) {
                this.pendingPermissions.delete(toolCallId);
                throw error;
            }
        } else {
            logger.debug('[ACP] No permission handler registered; cancelling request');
            this.pendingPermissions.delete(toolCallId);
            return { outcome: { outcome: 'cancelled' } };
        }

        return await responsePromise;
    }

    private notifyResponseComplete(): void {
        const resolvers = this.responseCompleteResolvers;
        this.responseCompleteResolvers = [];
        for (const resolve of resolvers) {
            resolve();
        }
    }

    /**
     * Optimistically update the cached `currentModelId` for a session after a
     * successful `session/set_model` call whose response does not echo the
     * model metadata (OpenCode 1.14.30 returns only `_meta.opencode.modelId`).
     * The previously captured `availableModels` list is preserved.
     */
    private updateCurrentModelOptimistic(sessionId: string, modelId: string): void {
        const existing = this.sessionModelsMetadata.get(sessionId);
        this.sessionModelsMetadata.set(sessionId, {
            availableModels: existing?.availableModels ?? [],
            currentModelId: modelId,
            availableEfforts: existing?.availableEfforts,
            currentEffortId: existing?.currentEffortId
        });
    }

    /**
     * Extract `availableModels` and `currentModelId` from an ACP response and
     * store them keyed by sessionId. Both top-level and nested-under-`models`
     * shapes are accepted because different agents use different conventions.
     * Missing or malformed fields are silently ignored — flavors that do not
     * expose model metadata (e.g. current Gemini ACP build) simply leave the
     * cache untouched.
     */
    private extractModelConfigOption(response: Record<string, unknown>): {
        currentValue: string | null;
        options: unknown[];
    } | null {
        if (!Array.isArray(response.configOptions)) return null;

        for (const entry of response.configOptions) {
            if (!isObject(entry)) continue;
            if (asString(entry.category) !== 'model' && asString(entry.id) !== 'model') continue;
            return {
                currentValue: asString(entry.currentValue),
                options: Array.isArray(entry.options) ? entry.options : []
            };
        }

        return null;
    }
    private captureSessionModelsMetadata(sessionId: string, response: unknown): void {
        if (!isObject(response)) return;

        const directList = response.availableModels;
        const directCurrent = response.currentModelId;
        const nested = isObject(response.models) ? response.models : null;
        const nestedList = nested?.availableModels;
        const nestedCurrent = nested?.currentModelId;

        const rawModels = Array.isArray(directList)
            ? directList
            : Array.isArray(nestedList)
                ? nestedList
                : null;
        const rawCurrent = typeof directCurrent === 'string'
            ? directCurrent
            : typeof nestedCurrent === 'string'
                ? nestedCurrent
                : null;

        if (rawModels === null && rawCurrent === null) {
            const configMetadata = this.extractConfigOptionsMetadata(response);
            const metaMetadata = this.extractOpencodeMetaMetadata(response);
            if (!configMetadata && !metaMetadata) return;
            const existing = this.sessionModelsMetadata.get(sessionId);
            this.sessionModelsMetadata.set(sessionId, {
                availableModels: configMetadata?.availableModels ?? existing?.availableModels ?? [],
                currentModelId: configMetadata?.currentModelId ?? metaMetadata?.currentModelId ?? existing?.currentModelId ?? null,
                availableEfforts: configMetadata?.availableEfforts ?? metaMetadata?.availableEfforts ?? existing?.availableEfforts,
                currentEffortId: configMetadata?.currentEffortId ?? metaMetadata?.currentEffortId ?? existing?.currentEffortId
            });
            return;
        }

        const availableModels: AcpModelDescriptor[] = [];
        if (Array.isArray(rawModels)) {
            for (const entry of rawModels) {
                if (!isObject(entry)) continue;
                const modelId = asString(entry.modelId);
                if (!modelId) continue;
                const name = asString(entry.name) ?? undefined;
                const entryMeta = isObject(entry._meta) ? entry._meta : null;
                const reasoningEfforts = entryMeta && Array.isArray(entryMeta.reasoningEfforts)
                    ? entryMeta.reasoningEfforts
                        .filter((effort): effort is Record<string, unknown> => isObject(effort))
                        .map((effort) => ({
                            value: asString(effort.value) ?? asString(effort.id) ?? '',
                            name: asString(effort.label) ?? undefined,
                            isDefault: effort.default === true
                        }))
                        .filter((effort) => effort.value.length > 0)
                    : undefined;
                const descriptor: AcpModelDescriptor = name ? { modelId, name } : { modelId };
                if (reasoningEfforts && reasoningEfforts.length > 0) {
                    descriptor.reasoningEfforts = reasoningEfforts;
                }
                availableModels.push(descriptor);
            }
        } else {
            // Preserve previously-captured availableModels when the response only
            // updates currentModelId (e.g. a setModel response from some agents).
            const existing = this.sessionModelsMetadata.get(sessionId);
            if (existing) {
                availableModels.push(...existing.availableModels);
            }
        }

        const existing = this.sessionModelsMetadata.get(sessionId);
        const configMetadata = this.extractConfigOptionsMetadata(response);
        const metaMetadata = this.extractOpencodeMetaMetadata(response);
        this.sessionModelsMetadata.set(sessionId, {
            availableModels,
            currentModelId: rawCurrent,
            availableEfforts: configMetadata?.availableEfforts ?? metaMetadata?.availableEfforts ?? existing?.availableEfforts,
            currentEffortId: configMetadata?.currentEffortId ?? metaMetadata?.currentEffortId ?? existing?.currentEffortId
        });
    }

    private extractConfigOptionsMetadata(response: unknown): Partial<AcpSessionModelsMetadata> | null {
        if (!isObject(response) || !Array.isArray(response.configOptions)) return null;

        let availableModels: AcpModelDescriptor[] | undefined;
        let currentModelId: string | null | undefined;
        let availableEfforts: AcpEffortDescriptor[] | undefined;
        let currentEffortId: string | null | undefined;

        for (const option of response.configOptions) {
            if (!isObject(option)) continue;
            const id = asString(option.id);
            const currentValue = asString(option.currentValue);
            const rawOptions = Array.isArray(option.options) ? option.options : [];

            if (id === 'model') {
                currentModelId = currentValue ?? null;
                availableModels = [];
                for (const entry of rawOptions) {
                    if (!isObject(entry)) continue;
                    const value = asString(entry.value);
                    if (!value) continue;
                    const name = asString(entry.name) ?? undefined;
                    availableModels.push(name ? { modelId: value, name } : { modelId: value });
                }
            }

            if (id === 'effort') {
                currentEffortId = currentValue ?? null;
                availableEfforts = [];
                for (const entry of rawOptions) {
                    if (!isObject(entry)) continue;
                    const value = asString(entry.value);
                    if (!value) continue;
                    const name = asString(entry.name) ?? undefined;
                    availableEfforts.push(name ? { effortId: value, name } : { effortId: value });
                }
            }
        }

        if (
            availableModels === undefined
            && currentModelId === undefined
            && availableEfforts === undefined
            && currentEffortId === undefined
        ) {
            return null;
        }

        return { availableModels, currentModelId, availableEfforts, currentEffortId };
    }

    private extractOpencodeMetaMetadata(response: unknown): Partial<AcpSessionModelsMetadata> | null {
        if (!isObject(response) || !isObject(response._meta)) return null;
        const opencode = isObject(response._meta.opencode) ? response._meta.opencode : null;
        if (!opencode) return null;

        const modelId = asString(opencode.modelId);
        const variant = asString(opencode.variant);
        const rawVariants = Array.isArray(opencode.availableVariants) ? opencode.availableVariants : [];
        const availableEfforts: AcpEffortDescriptor[] = rawVariants.flatMap((entry): AcpEffortDescriptor[] => {
            const effortId = asString(entry);
            if (!effortId) return [];
            return [{ effortId, name: formatEffortName(effortId) }];
        });

        if (!modelId && !variant && availableEfforts.length === 0) {
            return null;
        }

        return {
            currentModelId: modelId ?? undefined,
            currentEffortId: variant ?? null,
            availableEfforts: availableEfforts.length > 0 ? availableEfforts : undefined
        };
    }

    /** Updates the cached thought-level currentValue after a successful session/set_mode call. */
    private updateThoughtLevelCurrentValue(sessionId: string, value: string): void {
        const existing = this.sessionThoughtLevelOptions.get(sessionId);
        if (!existing) return;
        this.sessionThoughtLevelOptions.set(sessionId, { ...existing, currentValue: value });
    }

    /**
     * Grok exposes its reasoning-effort ("thought level") options through
     * `_meta['x.ai/sessionConfig'].options` (category 'mode') on session/new,
     * session/load, and session/set_mode responses — a different convention
     * from OpenCode's generic `configOptions[].id === 'effort'` (handled by
     * extractConfigOptionsMetadata above). Synthesized as its own
     * `thought_level` option set, kept separate from
     * AcpSessionModelsMetadata.availableEfforts so OpenCode/Kimi behavior is
     * unaffected.
     */
    private captureThoughtLevelConfigOption(sessionId: string, response: unknown): void {
        if (!isObject(response)) return;
        const meta = isObject(response._meta) ? response._meta : null;
        const xaiConfig = meta && isObject(meta['x.ai/sessionConfig']) ? meta['x.ai/sessionConfig'] : null;
        const xaiOptions = xaiConfig && Array.isArray(xaiConfig.options)
            ? xaiConfig.options.filter((entry): entry is Record<string, unknown> => isObject(entry))
            : [];
        const modeOptions = xaiOptions.filter((entry) => asString(entry.category) === 'mode');
        if (modeOptions.length === 0) return;

        const options = modeOptions
            .map((entry) => ({
                value: asString(entry.id) ?? '',
                name: asString(entry.label) ?? undefined,
                selected: entry.selected === true
            }))
            .filter((entry) => entry.value.length > 0);
        if (options.length === 0) return;

        this.sessionThoughtLevelOptions.set(sessionId, {
            currentValue: options.find((entry) => entry.selected)?.value ?? null,
            options: options.map(({ value, name }) => (name ? { value, name } : { value }))
        });
    }

    /**
     * Captures the ACP agent's advertised slash commands, either scoped to a
     * session (from session/update's available_commands_update, or a
     * session/new|load|set_mode response) or globally (sessionId === null,
     * from the initialize response) — read from either a top-level
     * `availableCommands` array or a nested `_meta.availableCommands` array.
     */
    private captureAvailableCommands(sessionId: string | null, source: unknown): void {
        if (!isObject(source)) return;

        const meta = isObject(source._meta) ? source._meta : null;
        const rawCommands = Array.isArray(source.availableCommands)
            ? source.availableCommands
            : meta && Array.isArray(meta.availableCommands)
                ? meta.availableCommands
                : null;
        if (!rawCommands) return;

        const commands = new Set(
            rawCommands
                .filter((entry): entry is Record<string, unknown> => isObject(entry))
                .map((entry) => asString(entry.name) ?? '')
                .filter((name) => name.length > 0)
        );
        if (commands.size === 0) return;

        if (sessionId) {
            this.sessionAvailableCommands.set(sessionId, commands);
            return;
        }

        this.initialAvailableCommands.clear();
        for (const command of commands) {
            this.initialAvailableCommands.add(command);
        }
    }
}

function formatEffortName(effortId: string): string {
    return effortId
        .split(/[_-]/)
        .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join(' ');
}
