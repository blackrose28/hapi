import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    CodexCollaborationMode,
    DecryptedMessage,
    PermissionMode,
    PiModelSummary,
    Session,
    SlashCommand
} from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import type { SendStatus } from '@/hooks/mutations/useSendMessage'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { hasInFlightToolCall } from '@/chat/running'
import { buildConversationOutline, getConversationMessageAnchorId } from '@/chat/outline'
import { isQueuedForInvocation } from '@/lib/messages'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import type { CompactRuntimeChange } from '@/components/AssistantChat/CompactComposerControls'
import type { PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import { resolvePendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { QueuedMessagesBar } from '@/components/AssistantChat/QueuedMessagesBar'
import { TeamMentionQueueBar } from '@/components/AssistantChat/TeamMentionQueueBar'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { useTranslation } from '@/lib/use-translation'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useAgentModels } from '@/hooks/queries/useAgentModels'
import { useOpencodeModels } from '@/hooks/queries/useOpencodeModels'
import { useGrokModels } from '@/hooks/queries/useGrokModels'
import { useGrokReasoningEffortOptions } from '@/hooks/queries/useGrokReasoningEffortOptions'
import { usePiModels } from '@/hooks/queries/usePiModels'
import { useSessionTeamMentions } from '@/hooks/queries/useSessionTeamMentions'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'

/**
 * Returns whether a PendingSchedule should trigger an auto-clear timer.
 *
 * Only 'absolute' schedules expire (the chosen instant passes).
 * 'preset' schedules are relative to send time and have no fixed expiry.
 *
 * Used both by the auto-clear useEffect and by unit tests, so a future
 * variant of PendingSchedule only needs to update this single helper.
 */
export function shouldAutoClearPendingSchedule(pending: PendingSchedule | null): boolean {
    return pending !== null && pending.type === 'absolute'
}

function getOutlineTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        return session.metadata.path
    }
    return session.id.slice(0, 8)
}

export function SessionChat(props: {
    api: ApiClient
    session: Session
    readOnly?: boolean
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    messagesVersion: number
    onBack: () => void
    onSessionDeleted?: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    // Resolves true when the send was accepted by the underlying mutation, false when
    // pre-mutation guards (no-api / no-session / pending) rejected the call OR async
    // inactive-session resume failed. Composer state that should only be cleared on
    // actual send (pendingSchedule) must await this — see handleSend below.
    onSend: (text: string, attachments?: AttachmentMetadata[], scheduledAt?: number | null) => Promise<boolean>
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    availableSlashCommands?: readonly SlashCommand[]
    disableVoice?: boolean
    hideHeader?: boolean
    compactMode?: boolean
    compactComposerMode?: boolean
    compactSendStatus?: SendStatus
    pinIndex?: number
    composerAppendText?: string
    onComposerAppendTextConsumed?: () => void
    onNewSessionRequested?: () => void
    onFocusSession?: () => void
    compactCloseLabel?: string
    compactCloseButtonRef?: Ref<HTMLButtonElement>
}) {
    const { requests: teamMentionRequests } = useSessionTeamMentions(props.api, props.session.id)
    const { haptic } = usePlatform()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const sessionInactive = !props.session.active
    const readOnly = props.readOnly ?? false
    const terminalSupported = isRemoteTerminalSupported(props.session.metadata)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [outlineOpen, setOutlineOpen] = useState(false)
    const agentFlavor = props.session.metadata?.flavor ?? 'claude'
    const controlledByUser = props.session.agentState?.controlledByUser === true
    const codexCollaborationModeSupported = agentFlavor === 'codex' && !controlledByUser
    const codexModelsState = useCodexModels({
        api: props.api,
        sessionId: props.session.id,
        enabled: agentFlavor === 'codex' && !controlledByUser
    })
    const claudeModelsState = useAgentModels({
        api: props.api,
        agent: 'claude',
        sessionId: props.session.id,
        sessionActive: props.session.active,
        enabled: agentFlavor === 'claude'
    })
    const [codexErrorDismissed, setCodexErrorDismissed] = useState(false)
    const [claudeErrorDismissed, setClaudeErrorDismissed] = useState(false)
    const codexModelOptions = useMemo(() => {
        if (agentFlavor !== 'codex') {
            return undefined
        }

        const options: Array<{ value: string | null; label: string }> = []
        for (const codexModel of codexModelsState.models) {
            options.push({
                value: codexModel.id,
                label: codexModel.displayName
            })
        }
        return options
    }, [agentFlavor, codexModelsState.models])
    const claudeModelOptions = useMemo(() => {
        if (agentFlavor !== 'claude') {
            return undefined
        }
        return [
            { value: null, label: 'Default' },
            ...claudeModelsState.models.map((claudeModel) => ({
                value: claudeModel.id,
                label: claudeModel.displayName
            }))
        ]
    }, [agentFlavor, claudeModelsState.models])
    const opencodeModelsState = useOpencodeModels({
        api: props.api,
        sessionId: props.session.id,
        enabled: agentFlavor === 'opencode'
    })
    const opencodeModelOptions = useMemo(() => {
        if (agentFlavor !== 'opencode') {
            return undefined
        }

        return opencodeModelsState.availableModels.map((opencodeModel) => ({
            value: opencodeModel.modelId,
            label: opencodeModel.name ?? opencodeModel.modelId
        }))
    }, [agentFlavor, opencodeModelsState.availableModels])
    const opencodeReasoningEffortOptions = useMemo(() => {
        if (agentFlavor !== 'opencode' || opencodeModelsState.availableEfforts.length === 0) {
            return undefined
        }

        return opencodeModelsState.availableEfforts.map((effort) => ({
            value: effort.effortId === 'default' ? null : effort.effortId,
            label: effort.name ?? effort.effortId
        }))
    }, [agentFlavor, opencodeModelsState.availableEfforts])
    const grokModelsState = useGrokModels({
        api: props.api,
        sessionId: props.session.id,
        enabled: agentFlavor === 'grok' && props.session.active && !controlledByUser
    })
    const grokEffortState = useGrokReasoningEffortOptions({
        api: props.api,
        sessionId: props.session.id,
        enabled: agentFlavor === 'grok' && props.session.active && !controlledByUser
    })
    const grokModelOptions = useMemo(() => {
        if (agentFlavor !== 'grok') {
            return undefined
        }
        return [
            { value: null, label: 'Default' },
            ...grokModelsState.availableModels.map((grokModel) => ({
                value: grokModel.modelId,
                label: grokModel.name ?? grokModel.modelId
            }))
        ]
    }, [agentFlavor, grokModelsState.availableModels])
    const piModelsState = usePiModels({
        api: props.api,
        sessionId: props.session.id,
        enabled: agentFlavor === 'pi' && props.session.active
    })
    // Fallback to cached models from metadata when session is inactive
    const piMetadata = props.session.metadata as Record<string, unknown> | null
    const piCachedModels = piMetadata?.piAvailableModels as PiModelSummary[] | undefined ?? []
    // Provider-qualified selected model — disambiguates when two providers
    // share a modelId (hub persists this alongside the legacy modelId string).
    const piSelectedModel = piMetadata?.piSelectedModel as { provider: string; modelId: string } | null | undefined
    const codexModelsError = props.session.active ? codexModelsState.error : null
    const {
        abortSession,
        switchSession,
        setPermissionMode,
        setCollaborationMode,
        setModel,
        setModelReasoningEffort,
        setEffort
    } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor,
        codexCollaborationModeSupported
    )

    // Voice assistant integration — disabled in multi-pin mode to avoid conflicts
    const voiceRaw = useVoiceOptional()
    const voice = props.disableVoice ? null : voiceRaw

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => props.onSend(message),
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

    // Track and report new messages to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    // Report ready event when thinking stops
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    // Report permission requests to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
        setOutlineOpen(false)
    }, [props.session.id])

    // Exclude user messages that haven't been invoked yet — those appear in the
    // QueuedMessagesBar above the composer, not in the thread timeline. The
    // `isQueuedForInvocation` predicate is shared with the window store and the
    // floating bar so the three views never disagree about queued state.
    const visibleMessages = useMemo(
        () => props.messages.filter((m) => !isQueuedForInvocation(m)),
        [props.messages]
    )

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of visibleMessages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [visibleMessages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState, teamMentionRequests),
        [normalizedMessages, props.session.agentState, teamMentionRequests]
    )
    const effectiveAgentRunning = props.session.thinking
        || (props.compactComposerMode === true && hasInFlightToolCall(normalizedMessages))
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    const outlineItems = useMemo(
        () => buildConversationOutline(reconciled.blocks),
        [reconciled.blocks]
    )

    const outlineTitle = useMemo(
        () => getOutlineTitle(props.session),
        [props.session]
    )

    const handleReviewTeamMention = useCallback((requestId: string) => {
        const targetBlock = reconciled.blocks.find((block) => block.kind === 'team-mention' && block.requestId === requestId)
        if (!targetBlock) return
        const element = document.getElementById(getConversationMessageAnchorId(`team-mention:${targetBlock.id}`))
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [reconciled.blocks])

    const handleOpenTeamChatFromQueue = useCallback((teamChatId: string) => {
        void navigate({ to: '/team-chats/$teamChatId', params: { teamChatId } })
    }, [navigate])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    const handleCollaborationModeChange = useCallback(async (mode: CodexCollaborationMode) => {
        try {
            await setCollaborationMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set collaboration mode:', e)
        }
    }, [setCollaborationMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelChange = useCallback(async (model: { provider: string; modelId: string } | string | null) => {
        try {
            await setModel(model)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model:', e)
        }
    }, [setModel, props.onRefresh, haptic])

    const handleModelReasoningEffortChange = useCallback(async (modelReasoningEffort: string | null) => {
        try {
            await setModelReasoningEffort(modelReasoningEffort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model reasoning effort:', e)
        }
    }, [setModelReasoningEffort, props.onRefresh, haptic])

    const handleEffortChange = useCallback(async (effort: string | null) => {
        try {
            await setEffort(effort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set effort:', e)
        }
    }, [setEffort, props.onRefresh, haptic])

    const handleCompactRuntimeChange = useCallback(async (change: CompactRuntimeChange) => {
        try {
            switch (change.type) {
                case 'model':
                    await setModel(change.value)
                    break
                case 'effort':
                    if (agentFlavor === 'codex' || agentFlavor === 'opencode') {
                        await setModelReasoningEffort(change.value)
                    } else {
                        await setEffort(change.value)
                    }
                    break
                case 'collaboration':
                    await setCollaborationMode(change.value)
                    break
                case 'permission':
                    if (props.session.collaborationMode && props.session.collaborationMode !== 'default') {
                        await setCollaborationMode('default')
                    }
                    await setPermissionMode(change.value)
                    break
            }
            haptic.notification('success')
            props.onRefresh()
        } catch (error) {
            haptic.notification('error')
            console.error(`Failed to set compact runtime ${change.type}:`, error)
            throw error
        }
    }, [
        agentFlavor,
        haptic,
        props.onRefresh,
        props.session.collaborationMode,
        setCollaborationMode,
        setEffort,
        setModel,
        setModelReasoningEffort,
        setPermissionMode
    ])

    // Abort handler
    const handleAbort = useCallback(async () => {
        await abortSession()
        props.onRefresh()
    }, [abortSession, props.onRefresh])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            search: (previous: any) => ({
                ...previous,
                modal: 'terminal',
                modalSessionId: props.session.id,
            }),
        } as any)
    }, [navigate, props.session.id])

    // Scheduled message state — lifted here so useHappyRuntime can read the ref.
    //
    // pendingSchedule holds what the user selected (preset or absolute ms).
    // The ref is read at send time; resolvePendingSchedule converts it to an
    // absolute epoch-ms using Date.now() at that moment (send-time base for presets).
    const [pendingSchedule, setPendingSchedule] = useState<PendingSchedule | null>(null)
    const pendingScheduleRef = useRef<PendingSchedule | null>(null)
    // Keep render ref in sync so onNew can snapshot at send time
    pendingScheduleRef.current = pendingSchedule

    // Auto-clear absolute-type pendingSchedule when the chosen time expires so
    // the composer clock button doesn't stay active past the scheduled instant.
    // Preset-type schedules are relative so they don't expire until send — the
    // shouldAutoClearPendingSchedule predicate is the single source of truth so
    // adding a new PendingSchedule variant only needs to update that helper.
    useEffect(() => {
        if (!shouldAutoClearPendingSchedule(pendingSchedule)) return
        // Narrowed to 'absolute' by the predicate above.
        const ms = (pendingSchedule as Extract<PendingSchedule, { type: 'absolute' }>).ms
        const remaining = ms - Date.now()
        if (remaining <= 0) {
            setPendingSchedule(null)
            return
        }
        const timer = setTimeout(() => setPendingSchedule(null), remaining)
        return () => clearTimeout(timer)
    }, [pendingSchedule])

    const handleSend = useCallback(async (text: string, attachments?: AttachmentMetadata[], scheduledAt?: number | null) => {
        const accepted = await props.onSend(text, attachments, scheduledAt)
        if (!accepted) return
        // Clear pendingSchedule only after the mutation is actually accepted —
        // covers both pre-mutation guards AND async inactive-session resume
        // failure. SessionChat is the single owner of schedule clear (HappyComposer
        // no longer clears on its own send path).
        setPendingSchedule(null)
        setForceScrollToken((token) => token + 1)
    }, [props.onSend])

    const handleGoalCommand = useCallback((command: string) => {
        if (effectiveAgentRunning) return
        handleSend(command)
    }, [effectiveAgentRunning, handleSend])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter,
        allowSendWhenInactive: true,
        allowDraftWhileRunning: props.compactComposerMode === true,
        isAgentRunning: effectiveAgentRunning,
        pendingScheduleRef
    })

    return (
        <div className="flex h-full min-h-0 flex-col">
            {!props.hideHeader && (
                <SessionHeader
                    session={props.session}
                    onBack={props.onBack}
                    onViewFiles={terminalSupported ? handleViewFiles : undefined}
                    onOpenOutline={() => setOutlineOpen(true)}
                    api={props.api}
                    onSessionDeleted={props.onSessionDeleted ?? props.onBack}
                    compactMode={props.compactMode}
                    pinIndex={props.pinIndex}
                    onFocusSession={props.onFocusSession}
                    compactCloseLabel={props.compactCloseLabel}
                    compactCloseButtonRef={props.compactCloseButtonRef}
                    codexGoal={reduced.latestGoal}
                    onGoalCommand={effectiveAgentRunning ? undefined : handleGoalCommand}
                />
            )}

            {props.session.teamState && (
                <TeamPanel teamState={props.session.teamState} />
            )}


            {readOnly && !sessionInactive && (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-yellow-500/10 border border-yellow-500/20 p-2 text-xs text-yellow-600">
                        Read-only shared view — you cannot send messages to this session.
                    </div>
                </div>
            )}

            {sessionInactive ? (() => {
                const meta = props.session.metadata
                const hasResumeToken = !!(
                    meta?.claudeSessionId ||
                    meta?.codexSessionId ||
                    meta?.geminiSessionId ||
                    meta?.opencodeSessionId ||
                    meta?.cursorSessionId ||
                    meta?.piSessionId ||
                    meta?.grokSessionId
                )
                if (!hasResumeToken) {
                    return (
                        <div className="px-3 pt-3">
                            <div className="mx-auto w-full max-w-full rounded-md bg-[var(--app-subtle-bg)] p-2 text-xs flex items-center justify-between gap-2">
                                <p className="text-[var(--app-hint)]">
                                    This session cannot be resumed — no agent session token was saved.
                                </p>
                                <button
                                    type="button"
                                    style={{ background: 'rgb(99,102,241)', color: '#fff', whiteSpace: 'nowrap' }}
                                    className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                                    onClick={() => {
                                        if (props.onNewSessionRequested) {
                                            props.onNewSessionRequested()
                                            return
                                        }
                                        void navigate({
                                            search: (prev: any) => ({
                                                ...prev,
                                                modal: 'new-session',
                                                modalReplaceSessionId: props.session.id,
                                                modalPath: meta?.path,
                                                modalMachineId: meta?.machineId
                                            })
                                        } as any)
                                    }}
                                >
                                    + New Session
                                </button>
                            </div>
                        </div>
                    )
                }
                return (
                    <div className="px-3 pt-3">
                        <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-2 text-xs text-[var(--app-hint)]">
                            Session is inactive. Sending will resume it automatically.
                        </div>
                    </div>
                )
            })() : null}


            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={`thread-${props.session.id}`}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive || readOnly}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={props.onAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={visibleMessages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                        outlineOpen={outlineOpen}
                        outlineTitle={outlineTitle}
                        outlineItems={outlineItems}
                        onOutlineOpenChange={setOutlineOpen}
                    />

                    {codexCollaborationModeSupported && codexModelsError && !codexErrorDismissed ? (
                        <div className="px-3 pb-2">
                            <div className="mx-auto w-full max-w-full rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-red-500 flex items-center justify-between gap-3">
                                <span className="flex-1 min-w-0">
                                    {t('session.codexModelsLoadFailed')}: {codexModelsError}
                                </span>
                                <button
                                    type="button"
                                    className="shrink-0 text-xs px-2 py-1 rounded border border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors"
                                    onClick={() => setCodexErrorDismissed(true)}
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {agentFlavor === 'claude' && claudeModelsState.error && !claudeErrorDismissed ? (
                        <div className="px-3 pb-2">
                            <div className="mx-auto flex w-full max-w-full items-center justify-between gap-3 rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-red-500">
                                <span className="min-w-0 flex-1">
                                    {t('session.agentModelsLoadFailed')}: {claudeModelsState.error}
                                </span>
                                <button
                                    type="button"
                                    className="shrink-0 rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                    onClick={() => setClaudeErrorDismissed(true)}
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    ) : null}

                    <div className="px-3">
                        <TeamMentionQueueBar
                            requests={teamMentionRequests}
                            onReviewFirst={handleReviewTeamMention}
                            onOpenTeamChat={handleOpenTeamChatFromQueue}
                        />
                    </div>

                    <div className="px-3">
                        <QueuedMessagesBar
                            sessionId={props.session.id}
                            api={props.api}
                            onEdit={({ pendingSchedule: restored }) => {
                                // Restore the schedule so the clock button re-activates
                                setPendingSchedule(restored)
                            }}
                        />
                    </div>

                    <HappyComposer
                        key={`composer-${props.session.id}`}
                        sessionId={props.session.id}
                        disabled={readOnly || undefined}
                        sendDisabled={props.isSending}
                        pendingSchedule={pendingSchedule}
                        onSchedule={setPendingSchedule}
                        onClearSchedule={() => setPendingSchedule(null)}
                        permissionMode={props.session.permissionMode}
                        collaborationMode={
                            agentFlavor === 'codex' && (props.compactComposerMode || codexCollaborationModeSupported)
                                ? props.session.collaborationMode
                                : undefined
                        }
                        model={props.session.model}
                        modelReasoningEffort={
                            agentFlavor === 'codex' || agentFlavor === 'opencode'
                                ? props.session.modelReasoningEffort
                                : undefined
                        }
                        effort={props.session.effort}
                        agentFlavor={agentFlavor}
                        availableModelOptions={
                            agentFlavor === 'codex'
                                ? codexModelOptions
                                : agentFlavor === 'claude'
                                    ? claudeModelOptions
                                : agentFlavor === 'opencode'
                                    ? opencodeModelOptions
                                    : agentFlavor === 'grok'
                                        ? grokModelOptions
                                        : undefined
                        }
                        piModels={agentFlavor === 'pi' ? (piModelsState.availableModels.length > 0 ? piModelsState.availableModels : piCachedModels) : undefined}
                        piSelectedModel={agentFlavor === 'pi' ? piSelectedModel : undefined}
                        availableModelReasoningEffortOptions={opencodeReasoningEffortOptions}
                        availableEffortOptions={
                            agentFlavor === 'grok' && grokEffortState.options.length > 0
                                ? grokEffortState.options
                                : undefined
                        }
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={effectiveAgentRunning}
                        agentState={props.session.agentState}
                        backgroundTaskCount={props.session.backgroundTaskCount}
                        contextSize={reduced.latestUsage?.contextSize}
                        contextCacheRead={reduced.latestUsage?.cacheRead}
                        contextWindow={reduced.latestUsage?.contextWindow}
                        quotaFiveHour={reduced.latestQuota.fiveHour}
                        quotaSevenDay={reduced.latestQuota.sevenDay}
                        controlledByUser={controlledByUser}
                        onCollaborationModeChange={
                            codexCollaborationModeSupported && !controlledByUser && !readOnly
                                ? handleCollaborationModeChange
                                : undefined
                        }
                        onPermissionModeChange={readOnly ? undefined : handlePermissionModeChange}
                        onModelChange={readOnly ? undefined : handleModelChange}
                        onModelReasoningEffortChange={
                            (agentFlavor === 'codex' || agentFlavor === 'opencode') && !controlledByUser && !readOnly
                                ? handleModelReasoningEffortChange
                                : undefined
                        }
                        onEffortChange={readOnly ? undefined : handleEffortChange}
                        onCompactRuntimeChange={props.compactComposerMode && !readOnly ? handleCompactRuntimeChange : undefined}
                        onSwitchToRemote={readOnly ? undefined : handleSwitchToRemote}
                        onTerminal={props.session.active && terminalSupported ? handleViewTerminal : undefined}
                        terminalUnsupported={props.session.active && !terminalSupported}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                        appendText={props.composerAppendText}
                        onAppendTextConsumed={props.onComposerAppendTextConsumed}
                        compactComposerMode={props.compactComposerMode}
                        compactSendStatus={props.compactComposerMode ? props.compactSendStatus : undefined}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && !props.disableVoice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
