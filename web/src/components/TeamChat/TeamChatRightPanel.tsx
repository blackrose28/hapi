import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCodexCollaborationModeOptions, getPermissionModeOptionsForFlavor, supportsEffort, supportsModelChange } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { CodexCollaborationMode, Machine, PermissionMode, Session, SessionSummary, TeamChatMessage, TeamMentionRequest, TeamParticipant } from '@/types/api'
import { NewSession } from '@/components/NewSession'
import { SessionComposerSettingsPanel } from '@/components/AssistantChat/SessionComposerSettingsPanel'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { compareSessionGroupOrder } from '@/lib/session-group-order'
import { queryKeys } from '@/lib/query-keys'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useAgentModels } from '@/hooks/queries/useAgentModels'
import { useOpencodeModels } from '@/hooks/queries/useOpencodeModels'
import { getModelOptionsForFlavor } from '@/components/AssistantChat/modelOptions'
import { getClaudeComposerEffortOptions } from '@/components/AssistantChat/claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { cn } from '@/lib/utils'
import { getParticipantAccent } from './teamColors'

type AttentionItem =
    | { kind: 'blocked' | 'question'; message: TeamChatMessage; createdAt: number }
    | { kind: 'failed-delivery' | 'needs-user-input'; request: TeamMentionRequest; createdAt: number }

type SessionPickerGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
    workingCount: number
    activeCount: number
}

const PARTICIPANT_ROLE_OPTIONS: Array<{ value: TeamParticipant['role']; label: string }> = [
    { value: 'general', label: 'General' },
    { value: 'backend', label: 'Backend' },
    { value: 'frontend', label: 'Frontend' },
    { value: 'tests', label: 'Tests' },
    { value: 'reviewer', label: 'Reviewer' },
    { value: 'docs', label: 'Docs' }
]

const PARTICIPANT_COLOR_OPTIONS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#fb7185', '#818cf8']

function getAttentionItems(messages: TeamChatMessage[], mentionRequests: TeamMentionRequest[]): AttentionItem[] {
    return [
        ...messages
            .filter((message) => message.reportType === 'blocked' || message.reportType === 'question')
            .map((message) => ({ kind: message.reportType as 'blocked' | 'question', message, createdAt: message.createdAt })),
        ...mentionRequests
            .filter((request) => request.status === 'failed' || request.status === 'pending')
            .map((request) => ({
                kind: request.status === 'failed' ? 'failed-delivery' : 'needs-user-input',
                request,
                createdAt: request.createdAt
            } as AttentionItem))
    ].sort((a, b) => b.createdAt - a.createdAt)
}

function getAttentionLabel(item: AttentionItem): string {
    if (item.kind === 'blocked') return 'Blocked'
    if (item.kind === 'question') return 'Question'
    if (item.kind === 'failed-delivery') return 'Failed delivery'
    return 'Waiting for response'
}

function getPathBasename(path?: string | null): string | null {
    if (!path) return null
    const parts = path.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? path
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function getSessionDisplayName(session: SessionSummary): string {
    return session.metadata?.name
        ?? session.metadata?.summary?.text
        ?? getPathBasename(session.metadata?.path)
        ?? session.id.slice(0, 8)
}

function suggestSessionAlias(session: SessionSummary): string {
    const displayName = getSessionDisplayName(session).trim()
    if (displayName.length <= 32) return displayName
    const pathName = getPathBasename(session.metadata?.path)?.trim()
    if (pathName && pathName.length <= 32) return pathName
    return displayName.slice(0, 32).trim()
}

function normalizeAlias(alias: string): string {
    return alias.trim().replace(/\s+/g, ' ')
}

function getSessionProjectPath(session: SessionSummary): string {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
}

function getSessionStatus(session: SessionSummary): {
    label: string
    rank: number
    dotClassName: string
    pillClassName: string
} {
    if (session.pendingRequestsCount > 0) {
        return {
            label: 'Needs input',
            rank: 0,
            dotClassName: 'bg-amber-400',
            pillClassName: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        }
    }
    if (session.thinking) {
        return {
            label: 'Working',
            rank: 1,
            dotClassName: 'bg-sky-400',
            pillClassName: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        }
    }
    if (session.active) {
        return {
            label: 'Active',
            rank: 2,
            dotClassName: 'bg-emerald-400',
            pillClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        }
    }
    return {
        label: 'Idle',
        rank: 3,
        dotClassName: 'bg-[var(--app-border)]',
        pillClassName: 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
    }
}

function getSessionDetails(session: SessionSummary): string {
    return [
        session.model,
        session.effort ? `${session.effort} effort` : null,
        session.todoProgress ? `${session.todoProgress.completed}/${session.todoProgress.total} todo` : null,
        session.pendingRequestsCount > 0 ? `${session.pendingRequestsCount} request${session.pendingRequestsCount === 1 ? '' : 's'}` : null
    ].filter((item): item is string => Boolean(item)).join(' · ')
}

function sortSessionsForPicker(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => {
        const statusA = getSessionStatus(a)
        const statusB = getSessionStatus(b)
        if (statusA.rank !== statusB.rank) return statusA.rank - statusB.rank
        return b.updatedAt - a.updatedAt
    })
}

function groupSessionsForPicker(sessions: SessionSummary[]): SessionPickerGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    for (const session of sessions) {
        const directory = getSessionProjectPath(session)
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? 'unknown'}::${directory}`
        const existing = groups.get(key)
        if (existing) {
            existing.sessions.push(session)
        } else {
            groups.set(key, { directory, machineId, sessions: [session] })
        }
    }

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = sortSessionsForPicker(group.sessions)
            const latestUpdatedAt = group.sessions.reduce((max, session) => Math.max(max, session.updatedAt), 0)
            const hasActiveSession = group.sessions.some((session) => session.active)
            return {
                key,
                directory: group.directory,
                displayName: getGroupDisplayName(group.directory),
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession,
                workingCount: group.sessions.filter((session) => session.thinking).length,
                activeCount: group.sessions.filter((session) => session.active).length
            }
        })
        .sort((a, b) => compareSessionGroupOrder({
            label: a.displayName,
            latestUpdatedAt: a.latestUpdatedAt,
            hasActiveSession: a.hasActiveSession
        }, {
            label: b.displayName,
            latestUpdatedAt: b.latestUpdatedAt,
            hasActiveSession: b.hasActiveSession
        }))
}

function SessionPickerTree(props: {
    groups: SessionPickerGroup[]
    selectedSessionId: string
    onSelectSession: (sessionId: string) => void
}) {
    return (
        <div
            role="tree"
            aria-label="Available sessions"
            className="app-scroll-y max-h-72 space-y-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2"
        >
            {props.groups.map((group) => (
                <div key={group.key}>
                    <div
                        role="treeitem"
                        aria-expanded="true"
                        title={group.directory}
                        className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-xs text-[var(--app-hint)]"
                    >
                        <span aria-hidden="true" className="text-[10px]">▾</span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold text-[var(--app-fg)]">{group.displayName}</div>
                            <div className="truncate">
                                {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
                                {group.activeCount > 0 ? ` · ${group.activeCount} active` : ''}
                                {group.workingCount > 0 ? ` · ${group.workingCount} working` : ''}
                                {group.machineId ? ` · ${group.machineId.slice(0, 8)}` : ''}
                            </div>
                        </div>
                    </div>
                    <div role="group" className="ml-2 space-y-1 border-l border-[var(--app-border)] pl-2">
                        {group.sessions.map((session) => {
                            const status = getSessionStatus(session)
                            const isSelected = session.id === props.selectedSessionId
                            const displayName = getSessionDisplayName(session)
                            return (
                                <button
                                    key={session.id}
                                    type="button"
                                    aria-label={`${displayName} ${status.label}`}
                                    aria-pressed={isSelected}
                                    onClick={() => props.onSelectSession(session.id)}
                                    className={cn(
                                        'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
                                        isSelected
                                            ? 'border-[var(--app-link)] bg-[var(--app-link)]/10'
                                            : 'border-transparent hover:border-[var(--app-border)] hover:bg-[var(--app-secondary-bg)]'
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn('h-2 w-2 shrink-0 rounded-full', status.dotClassName, session.thinking ? 'animate-pulse' : '')}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-[var(--app-fg)]">{displayName}</div>
                                        <div className="truncate text-[11px] text-[var(--app-hint)]">
                                            {session.model ?? 'auto model'}{session.metadata?.lastUserRequest ? ` · ${session.metadata.lastUserRequest}` : ''}
                                        </div>
                                    </div>
                                    <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', status.pillClassName)}>
                                        {status.label}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

function TeamMemberSessionSettings(props: {
    api?: ApiClient | null
    participant: TeamParticipant
    summary?: SessionSummary | null
}) {
    const sessionId = props.participant.sessionId ?? null
    const sessionQuery = useQuery({
        queryKey: sessionId ? queryKeys.session(sessionId) : ['team-member-session-config', 'missing'],
        queryFn: async () => {
            if (!props.api || !sessionId) throw new Error('Session unavailable')
            return await props.api.getSession(sessionId)
        },
        enabled: Boolean(props.api && sessionId)
    })
    const session = sessionQuery.data?.session as Session | undefined
    const [error, setError] = useState<string | null>(null)

    if (!sessionId) {
        return <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">This member is not backed by a session.</div>
    }

    if (!props.api) {
        return <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">API unavailable. Cannot configure the original session.</div>
    }

    if (sessionQuery.isLoading || !session) {
        return (
            <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">
                Loading session settings for {props.summary ? getSessionDisplayName(props.summary) : `@${props.participant.displayName}`}…
            </div>
        )
    }

    if (sessionQuery.isError) {
        return <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">Failed to load session settings.</div>
    }

    return <TeamMemberLoadedSessionSettings api={props.api} session={session} error={error} setError={setError} />
}

function TeamMemberLoadedSessionSettings(props: {
    api: ApiClient
    session: Session
    error: string | null
    setError: (error: string | null) => void
}) {
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
        enabled: agentFlavor === 'claude'
    })
    const codexModelOptions = useMemo(() => {
        if (agentFlavor !== 'codex') return undefined
        return codexModelsState.models.map((codexModel) => ({
            value: codexModel.id,
            label: codexModel.displayName
        }))
    }, [agentFlavor, codexModelsState.models])
    const claudeModelOptions = useMemo(() => {
        if (agentFlavor !== 'claude') return undefined
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
        if (agentFlavor !== 'opencode') return undefined
        return opencodeModelsState.availableModels.map((opencodeModel) => ({
            value: opencodeModel.modelId,
            label: opencodeModel.name ?? opencodeModel.modelId
        }))
    }, [agentFlavor, opencodeModelsState.availableModels])
    const opencodeReasoningEffortOptions = useMemo(() => {
        if (agentFlavor !== 'opencode' || opencodeModelsState.availableEfforts.length === 0) return undefined
        return opencodeModelsState.availableEfforts.map((effort) => ({
            value: effort.effortId === 'default' ? null : effort.effortId,
            label: effort.name ?? effort.effortId
        }))
    }, [agentFlavor, opencodeModelsState.availableEfforts])
    const { setPermissionMode, setCollaborationMode, setModel, setModelReasoningEffort, setEffort, isPending } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor,
        codexCollaborationModeSupported
    )

    const permissionMode = props.session.permissionMode ?? 'default'
    const collaborationMode = props.session.collaborationMode ?? 'default'
    const model = props.session.model ?? null
    const modelReasoningEffort = props.session.modelReasoningEffort ?? null
    const effort = props.session.effort ?? null
    const permissionModeOptions = useMemo(() => getPermissionModeOptionsForFlavor(agentFlavor), [agentFlavor])
    const collaborationModeOptions = useMemo(() => agentFlavor === 'codex' ? getCodexCollaborationModeOptions() : [], [agentFlavor])
    const modelOptions = useMemo(
        () => getModelOptionsForFlavor(
            agentFlavor,
            model,
            agentFlavor === 'codex'
                ? codexModelOptions
                : agentFlavor === 'claude'
                    ? claudeModelOptions
                    : agentFlavor === 'opencode'
                        ? opencodeModelOptions
                        : undefined
        ),
        [agentFlavor, model, codexModelOptions, claudeModelOptions, opencodeModelOptions]
    )
    const modelReasoningEffortOptions = useMemo(
        () => agentFlavor === 'codex'
            ? getCodexComposerReasoningEffortOptions(modelReasoningEffort)
            : opencodeReasoningEffortOptions ?? [],
        [agentFlavor, modelReasoningEffort, opencodeReasoningEffortOptions]
    )
    const claudeEffortOptions = useMemo(() => getClaudeComposerEffortOptions(effort), [effort])
    const codexModelsError = props.session.active ? codexModelsState.error : null
    const agentModelsError = props.session.active && agentFlavor === 'claude'
        ? claudeModelsState.error
        : null

    const runSessionSetting = async (action: () => Promise<void>) => {
        props.setError(null)
        try {
            await action()
        } catch (error) {
            props.setError(error instanceof Error ? error.message : 'Failed to update session setting.')
        }
    }

    const hasSettings = Boolean(
        collaborationModeOptions.length > 0
        || permissionModeOptions.length > 0
        || modelOptions.length > 0
        || modelReasoningEffortOptions.length > 0
        || supportsEffort(agentFlavor)
    )

    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                These settings affect the original session, so Agent Mode and Editor Mode will see the same changes.
            </div>
            {controlledByUser ? (
                <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-xs text-[var(--app-hint)]">
                    This session is currently controlled locally. Some model/reasoning settings are locked, matching Session Composer behavior.
                </div>
            ) : null}
            {codexModelsError ? (
                <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-xs text-[var(--app-hint)]">
                    Provider model discovery is unavailable right now. Existing session model is preserved.
                </div>
            ) : null}
            {agentModelsError ? (
                <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-xs text-[var(--app-hint)]">
                    Provider model discovery is unavailable right now. Fallback Claude models remain available.
                </div>
            ) : null}
            {hasSettings ? (
                <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))]">
                    <SessionComposerSettingsPanel
                        controlsDisabled={isPending}
                        collaborationMode={collaborationMode as CodexCollaborationMode}
                        permissionMode={permissionMode as PermissionMode}
                        model={model}
                        modelReasoningEffort={modelReasoningEffort}
                        effort={effort}
                        showCollaborationSettings={Boolean(codexCollaborationModeSupported && collaborationModeOptions.length > 0)}
                        showPermissionSettings={permissionModeOptions.length > 0}
                        showModelSettings={Boolean(
                            supportsModelChange(agentFlavor)
                            && modelOptions.length > 0
                            && !(agentFlavor === 'codex' && (controlledByUser || codexModelsError))
                            && !(agentFlavor === 'claude' && claudeModelsState.isLoading)
                        )}
                        showModelReasoningEffortSettings={Boolean((agentFlavor === 'codex' || agentFlavor === 'opencode') && !controlledByUser && modelReasoningEffortOptions.length > 0)}
                        showEffortSettings={supportsEffort(agentFlavor)}
                        collaborationModeOptions={collaborationModeOptions}
                        permissionModeOptions={permissionModeOptions}
                        modelOptions={modelOptions}
                        modelReasoningEffortOptions={modelReasoningEffortOptions}
                        claudeEffortOptions={claudeEffortOptions}
                        onCollaborationModeChange={(mode) => void runSessionSetting(() => setCollaborationMode(mode))}
                        onPermissionModeChange={(mode) => void runSessionSetting(() => setPermissionMode(mode))}
                        onModelChange={(nextModel) => void runSessionSetting(() => setModel(nextModel))}
                        onModelReasoningEffortChange={(nextEffort) => void runSessionSetting(() => setModelReasoningEffort(nextEffort))}
                        onEffortChange={(nextEffort) => void runSessionSetting(() => setEffort(nextEffort))}
                    />
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">No configurable session settings are available for this provider.</div>
            )}
            {props.error ? <div className="rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{props.error}</div> : null}
        </div>
    )
}

export function TeamChatRightPanel(props: {
    api?: ApiClient | null
    participants: TeamParticipant[]
    messages?: TeamChatMessage[]
    mentionRequests?: TeamMentionRequest[]
    availableSessions?: SessionSummary[]
    machines?: Machine[]
    defaultMachineId?: string | null
    defaultProjectPath?: string | null
    onAddSession?: (session: SessionSummary, alias: string) => Promise<void> | void
    onCreateSessionMember?: (input: { sessionId: string; label?: string; alias: string; initialTask?: string }) => Promise<void> | void
    onOpenSession?: (participant: TeamParticipant) => void
    onUpdateParticipant?: (participant: TeamParticipant, input: { displayName: string; role: TeamParticipant['role']; color: string }) => Promise<void> | void
    onRemoveParticipant?: (participant: TeamParticipant) => Promise<void> | void
    className?: string
}) {
    const [isAddingMember, setIsAddingMember] = useState(false)
    const [addMemberTab, setAddMemberTab] = useState<'existing' | 'new'>('existing')
    const [selectedSessionId, setSelectedSessionId] = useState('')
    const [alias, setAlias] = useState('')
    const [newSessionLabel, setNewSessionLabel] = useState('')
    const [newAlias, setNewAlias] = useState('')
    const [newAliasTouched, setNewAliasTouched] = useState(false)
    const [newInitialTask, setNewInitialTask] = useState('')
    const [newSessionSeed, setNewSessionSeed] = useState<{ machineId: string | null; directory: string }>({ machineId: null, directory: '' })
    const [isBrowsingNewSessionPath, setIsBrowsingNewSessionPath] = useState(false)
    const [dialogError, setDialogError] = useState<string | null>(null)
    const [isSubmittingMember, setIsSubmittingMember] = useState(false)
    const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null)
    const [configParticipant, setConfigParticipant] = useState<TeamParticipant | null>(null)
    const [configTab, setConfigTab] = useState<'member' | 'session'>('member')
    const [configAlias, setConfigAlias] = useState('')
    const [configRole, setConfigRole] = useState<TeamParticipant['role']>('general')
    const [configColor, setConfigColor] = useState('#60a5fa')
    const [removeParticipant, setRemoveParticipant] = useState<TeamParticipant | null>(null)
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const attentionItems = getAttentionItems(props.messages ?? [], props.mentionRequests ?? [])
    const sessionsById = useMemo(() => new Map((props.availableSessions ?? []).map((session) => [session.id, session])), [props.availableSessions])
    const addableSessions = useMemo(() => {
        const existingSessionIds = new Set(
            props.participants
                .map((participant) => participant.sessionId)
                .filter((sessionId): sessionId is string => Boolean(sessionId))
        )
        return (props.availableSessions ?? []).filter((session) => !existingSessionIds.has(session.id))
    }, [props.availableSessions, props.participants])
    const sessionGroups = useMemo(() => groupSessionsForPicker(addableSessions), [addableSessions])
    const sortedAddableSessions = useMemo(() => sessionGroups.flatMap((group) => group.sessions), [sessionGroups])

    const selectedSession = sortedAddableSessions.find((session) => session.id === selectedSessionId) ?? sortedAddableSessions[0] ?? null
    const normalizedAlias = normalizeAlias(alias)
    const aliasExists = props.participants.some((participant) => participant.displayName.toLowerCase() === normalizedAlias.toLowerCase())
    const aliasError = !normalizedAlias
        ? 'Alias is required.'
        : normalizedAlias.length > 32
            ? 'Alias must be 32 characters or fewer.'
            : aliasExists
                ? 'Alias already used in this Team Chat.'
                : null
    const normalizedNewSessionLabel = normalizeAlias(newSessionLabel)
    const normalizedNewAlias = normalizeAlias(newAlias)
    const newAliasExists = props.participants.some((participant) => participant.displayName.toLowerCase() === normalizedNewAlias.toLowerCase())
    const newAliasError = !normalizedNewAlias
        ? 'Alias is required.'
        : normalizedNewAlias.length > 32
            ? 'Alias must be 32 characters or fewer.'
            : newAliasExists
                ? 'Alias already used in this Team Chat.'
                : null
    const normalizedInitialTask = newInitialTask.trim()
    const normalizedConfigAlias = normalizeAlias(configAlias)
    const configAliasExists = props.participants.some((participant) => (
        participant.id !== configParticipant?.id
        && participant.displayName.toLowerCase() === normalizedConfigAlias.toLowerCase()
    ))
    const configAliasError = !normalizedConfigAlias
        ? 'Alias is required.'
        : normalizedConfigAlias.length > 32
            ? 'Alias must be 32 characters or fewer.'
            : configAliasExists
                ? 'Alias already used in this Team Chat.'
                : null
    const canAddMembers = Boolean(props.onAddSession || props.onCreateSessionMember)

    const handleStartAdding = () => {
        const firstSession = sortedAddableSessions[0] ?? null
        const firstMachineId = props.defaultMachineId
            ?? firstSession?.metadata?.machineId
            ?? props.machines?.[0]?.id
            ?? ''
        const firstProjectPath = props.defaultProjectPath
            ?? firstSession?.metadata?.path
            ?? ''
        setSelectedSessionId(firstSession?.id ?? '')
        setAlias(firstSession ? suggestSessionAlias(firstSession) : '')
        setNewSessionLabel('')
        setNewAlias('')
        setNewAliasTouched(false)
        setNewInitialTask('')
        setNewSessionSeed({ machineId: firstMachineId || null, directory: firstProjectPath })
        setIsBrowsingNewSessionPath(false)
        setDialogError(null)
        setAddMemberTab(props.onAddSession && firstSession ? 'existing' : 'new')
        setIsAddingMember(true)
    }

    const handleSelectSession = (sessionId: string) => {
        setSelectedSessionId(sessionId)
        const session = sortedAddableSessions.find((item) => item.id === sessionId)
        setAlias(session ? suggestSessionAlias(session) : '')
    }

    const handleAddSelectedSession = async () => {
        if (!selectedSession || aliasError) return
        setDialogError(null)
        setIsSubmittingMember(true)
        try {
            await props.onAddSession?.(selectedSession, normalizedAlias)
            setIsAddingMember(false)
            setSelectedSessionId('')
            setAlias('')
        } catch (error) {
            setDialogError(error instanceof Error ? error.message : 'Failed to add member.')
        } finally {
            setIsSubmittingMember(false)
        }
    }

    const handleNewSessionLabelChange = (value: string) => {
        setNewSessionLabel(value)
        if (!newAliasTouched) {
            setNewAlias(value)
        }
    }

    const handleCreateSessionMember = async (sessionId: string) => {
        if (!props.onCreateSessionMember || newAliasError) {
            setDialogError(newAliasError ?? 'Team alias is required.')
            return
        }
        setDialogError(null)
        setIsSubmittingMember(true)
        try {
            await props.onCreateSessionMember({
                sessionId,
                label: normalizedNewSessionLabel || undefined,
                alias: normalizedNewAlias,
                initialTask: normalizedInitialTask || undefined
            })
            setIsAddingMember(false)
            setNewSessionLabel('')
            setNewAlias('')
            setNewAliasTouched(false)
            setNewInitialTask('')
        } catch (error) {
            setDialogError(error instanceof Error ? error.message : 'Failed to configure session member.')
        } finally {
            setIsSubmittingMember(false)
        }
    }

    const clearLongPressTimer = () => {
        if (!longPressTimerRef.current) return
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
    }

    const startLongPressMenu = (participantId: string) => {
        clearLongPressTimer()
        longPressTimerRef.current = setTimeout(() => {
            setOpenMemberMenuId(participantId)
        }, 450)
    }

    const openConfigModal = (participant: TeamParticipant) => {
        setConfigParticipant(participant)
        setConfigTab('member')
        setConfigAlias(participant.displayName)
        setConfigRole(participant.role)
        setConfigColor(participant.color)
        setDialogError(null)
    }

    const handleSaveMemberConfig = async () => {
        if (!configParticipant || configAliasError) return
        setDialogError(null)
        setIsSubmittingMember(true)
        try {
            await props.onUpdateParticipant?.(configParticipant, {
                displayName: normalizedConfigAlias,
                role: configRole,
                color: configColor
            })
            setConfigParticipant(null)
        } catch (error) {
            setDialogError(error instanceof Error ? error.message : 'Failed to update member.')
        } finally {
            setIsSubmittingMember(false)
        }
    }

    return (
        <aside className={cn('hidden w-72 shrink-0 border-l border-[var(--app-border)] bg-[var(--app-bg)] p-3 lg:block', props.className)}>
            {attentionItems.length > 0 ? (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Needs attention</div>
                    <div className="mt-2 space-y-2">
                        {attentionItems.slice(0, 4).map((item) => (
                            <div key={`${item.kind}:${item.createdAt}`} className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5 text-xs">
                                <div className="font-medium text-[var(--app-fg)]">{getAttentionLabel(item)}</div>
                                {'message' in item ? (
                                    <div className="mt-0.5 line-clamp-2 text-[var(--app-hint)]">{item.message.text}</div>
                                ) : (
                                    <div className="mt-0.5 text-[var(--app-hint)]">Mention request {item.request.id.slice(0, 8)}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">Members</div>
                {canAddMembers ? (
                    <button
                        type="button"
                        onClick={handleStartAdding}
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] px-2 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        + Add member
                    </button>
                ) : null}
            </div>
            {isAddingMember ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Add member"
                    className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
                >
                    <div className="flex h-full w-full flex-col border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-2xl sm:h-auto sm:max-h-[calc(100vh-32px)] sm:max-w-3xl sm:rounded-2xl lg:max-w-5xl">
                        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
                            <div>
                                <div className="text-base font-semibold">Add member</div>
                                <div className="mt-0.5 text-xs text-[var(--app-hint)]">Add an existing session or create a new one with a Team alias.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAddingMember(false)}
                                className="rounded-md border border-[var(--app-border)] px-2.5 py-1 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Close
                            </button>
                        </div>
                        <div className="flex shrink-0 gap-2 border-b border-[var(--app-border)] px-4 py-2" role="tablist" aria-label="Add member mode">
                            {props.onAddSession ? (
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={addMemberTab === 'existing'}
                                    onClick={() => setAddMemberTab('existing')}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                        addMemberTab === 'existing'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
                                    )}
                                >
                                    Existing session
                                </button>
                            ) : null}
                            {props.onCreateSessionMember ? (
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={addMemberTab === 'new'}
                                    onClick={() => setAddMemberTab('new')}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                        addMemberTab === 'new'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
                                    )}
                                >
                                    New session
                                </button>
                            ) : null}
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            {addMemberTab === 'existing' && props.onAddSession ? (
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">Existing sessions</div>
                                        <div className="mt-1 text-xs text-[var(--app-hint)]">Grouped by project. Working and active sessions stay on top.</div>
                                        <div className="mt-3">
                                            {sessionGroups.length > 0 ? (
                                                <SessionPickerTree
                                                    groups={sessionGroups}
                                                    selectedSessionId={selectedSession?.id ?? ''}
                                                    onSelectSession={handleSelectSession}
                                                />
                                            ) : (
                                                <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">
                                                    No existing sessions available. Use New session to create one for this Team Chat.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] p-3">
                                        <label htmlFor="team-chat-member-alias" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">
                                            Team alias
                                        </label>
                                        <input
                                            id="team-chat-member-alias"
                                            aria-label="Team alias"
                                            value={alias}
                                            maxLength={64}
                                            onChange={(event) => setAlias(event.target.value)}
                                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                            placeholder="Backend, UI, Tester…"
                                        />
                                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                                            <span className="truncate text-[var(--app-hint)]">
                                                Tag preview: <span className="font-mono">@{normalizedAlias || 'alias'}</span>
                                            </span>
                                            <span className="text-[var(--app-hint)]">{normalizedAlias.length}/32</span>
                                        </div>
                                        {aliasError ? <div className="mt-1 text-xs text-red-600">{aliasError}</div> : null}
                                        <div className="mt-3 min-w-0 truncate text-xs text-[var(--app-hint)]">
                                            {selectedSession ? `Selected: ${getSessionDisplayName(selectedSession)}` : 'Pick a session'}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                            {addMemberTab === 'new' && props.onCreateSessionMember ? (
                                isBrowsingNewSessionPath && props.api ? (
                                    <div className="min-h-[520px] overflow-hidden rounded-xl border border-[var(--app-border)]">
                                        <div className="flex items-center justify-between gap-2 border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2">
                                            <div>
                                                <div className="text-sm font-semibold">Choose project path</div>
                                                <div className="text-xs text-[var(--app-hint)]">Pick a folder, then return to the Team member setup.</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setIsBrowsingNewSessionPath(false)}
                                                className="rounded-md border border-[var(--app-border)] px-2.5 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                            >
                                                Back to setup
                                            </button>
                                        </div>
                                        <div className="h-[min(64vh,620px)] min-h-0">
                                            <WorkspaceBrowser
                                                api={props.api}
                                                machines={props.machines ?? []}
                                                machinesLoading={false}
                                                initialMachineId={newSessionSeed.machineId ?? undefined}
                                                initialPath={newSessionSeed.directory || undefined}
                                                actionLabel="Use this folder"
                                                onStartSession={(machineId, directory) => {
                                                    setNewSessionSeed({ machineId, directory })
                                                    setIsBrowsingNewSessionPath(false)
                                                }}
                                            />
                                        </div>
                                    </div>
                                ) : props.api ? (
                                    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
                                        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] p-3">
                                            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">Team setup</div>
                                            <div className="mt-1 text-xs text-[var(--app-hint)]">Label names the session globally. Alias is how this Team Chat mentions it.</div>
                                            <div className="mt-3">
                                                <label htmlFor="team-chat-new-session-label" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Session label</label>
                                                <input
                                                    id="team-chat-new-session-label"
                                                    aria-label="Session label"
                                                    value={newSessionLabel}
                                                    maxLength={80}
                                                    onChange={(event) => handleNewSessionLabelChange(event.target.value)}
                                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                                    placeholder="Backend API"
                                                />
                                            </div>
                                            <div className="mt-3">
                                                <label htmlFor="team-chat-new-alias" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Team alias</label>
                                                <input
                                                    id="team-chat-new-alias"
                                                    aria-label="Team alias"
                                                    value={newAlias}
                                                    maxLength={64}
                                                    onChange={(event) => {
                                                        setNewAliasTouched(true)
                                                        setNewAlias(event.target.value)
                                                    }}
                                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                                    placeholder="Backend API"
                                                />
                                                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                                                    <span className="truncate text-[var(--app-hint)]">Tag preview: <span className="font-mono">@{normalizedNewAlias || 'alias'}</span></span>
                                                    <span className="text-[var(--app-hint)]">{normalizedNewAlias.length}/32</span>
                                                </div>
                                                {newAliasError ? <div className="mt-1 text-xs text-red-600">{newAliasError}</div> : null}
                                            </div>
                                            <div className="mt-3">
                                                <label htmlFor="team-chat-new-initial-task" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Initial task</label>
                                                <textarea
                                                    id="team-chat-new-initial-task"
                                                    aria-label="Initial task"
                                                    value={newInitialTask}
                                                    onChange={(event) => setNewInitialTask(event.target.value)}
                                                    rows={5}
                                                    className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                                    placeholder="Optional. Send the first instruction to this new session."
                                                />
                                            </div>
                                        </div>
                                        <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))]">
                                            <div className="border-b border-[var(--app-border)] px-3 py-2">
                                                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">New Session config</div>
                                                <div className="mt-1 text-xs text-[var(--app-hint)]">Uses the same form as New Session: recent paths, browse, agent, model, reasoning, session type, and YOLO.</div>
                                            </div>
                                            <NewSession
                                                key={`${newSessionSeed.machineId ?? 'auto'}:${newSessionSeed.directory}`}
                                                api={props.api}
                                                machines={props.machines ?? []}
                                                initialMachineId={newSessionSeed.machineId ?? undefined}
                                                initialDirectory={newSessionSeed.directory}
                                                createLabel="Create session & add to Team"
                                                canCreateExtra={!newAliasError}
                                                onCancel={() => setIsAddingMember(false)}
                                                onChooseFolder={(args) => {
                                                    setNewSessionSeed({ machineId: args.machineId, directory: args.directory })
                                                    setIsBrowsingNewSessionPath(true)
                                                }}
                                                onSuccess={(sessionId) => void handleCreateSessionMember(sessionId)}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-dashed border-[var(--app-border)] p-3 text-sm text-[var(--app-hint)]">API unavailable. Cannot create a session member.</div>
                                )
                            ) : null}

                            {dialogError ? <div className="mt-3 rounded-lg bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{dialogError}</div> : null}
                        </div>
                        {addMemberTab === 'existing' ? (
                            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3">
                                <div className="min-w-0 truncate text-xs text-[var(--app-hint)]">Adds the selected session with a room-specific alias.</div>
                                <div className="flex shrink-0 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingMember(false)}
                                        disabled={isSubmittingMember}
                                        className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleAddSelectedSession()}
                                        disabled={isSubmittingMember || !selectedSession || Boolean(aliasError)}
                                        className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                                    >
                                        {isSubmittingMember ? 'Adding…' : 'Add to Team'}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : props.onAddSession && addableSessions.length === 0 ? (
                <div className="mt-2 text-xs text-[var(--app-hint)]">All available sessions are already in this Team Chat.</div>
            ) : null}
            <div className="mt-3 space-y-2">
                {props.participants.map((participant) => {
                    const backingSession = participant.sessionId ? sessionsById.get(participant.sessionId) : null
                    const backingName = backingSession ? getSessionDisplayName(backingSession) : null
                    const secondary = backingName && backingName !== participant.displayName ? backingName : participant.role
                    const status = backingSession ? getSessionStatus(backingSession) : null
                    const details = backingSession ? getSessionDetails(backingSession) : ''
                    const canOpenSession = participant.type === 'session' && Boolean(participant.sessionId && props.onOpenSession)
                    const isMenuOpen = openMemberMenuId === participant.id
                    const content = (
                        <>
                            <div className="relative shrink-0">
                                <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: getParticipantAccent(participant.color) }} />
                                {status ? (
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--app-card-bg,var(--app-bg))]',
                                            status.dotClassName,
                                            backingSession?.thinking ? 'animate-pulse' : ''
                                        )}
                                    />
                                ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-[var(--app-fg)]">@{participant.displayName}</div>
                                <div className="truncate text-xs text-[var(--app-hint)]">{secondary}</div>
                                {details ? <div className="truncate text-[11px] text-[var(--app-hint)]">{details}</div> : null}
                            </div>
                            {status ? (
                                <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', status.pillClassName)}>
                                    {status.label}
                                </span>
                            ) : null}
                        </>
                    )
                    return (
                        <div
                            key={participant.id}
                            className="relative flex items-stretch rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] transition-colors hover:border-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]"
                            onContextMenu={(event) => {
                                event.preventDefault()
                                setOpenMemberMenuId(participant.id)
                            }}
                            onTouchStart={() => startLongPressMenu(participant.id)}
                            onTouchEnd={clearLongPressTimer}
                            onTouchCancel={clearLongPressTimer}
                        >
                            {canOpenSession ? (
                                <button
                                    type="button"
                                    aria-label={`Open @${participant.displayName} direct chat${status ? ` ${status.label}` : ''}`}
                                    onClick={() => props.onOpenSession?.(participant)}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-l-xl p-2 text-left focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]/40"
                                >
                                    {content}
                                </button>
                            ) : (
                                <div className="flex min-w-0 flex-1 items-center gap-2 p-2">{content}</div>
                            )}
                            <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={isMenuOpen}
                                aria-label={`Actions for @${participant.displayName}`}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setOpenMemberMenuId(isMenuOpen ? null : participant.id)
                                }}
                                className="flex w-9 shrink-0 items-center justify-center rounded-r-xl border-l border-[var(--app-border)] text-lg leading-none text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]/40"
                            >
                                ⋯
                            </button>
                            {isMenuOpen ? (
                                <div
                                    role="menu"
                                    className="absolute right-1 top-10 z-20 min-w-44 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] py-1 text-sm shadow-xl"
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        disabled={!canOpenSession}
                                        onClick={() => {
                                            setOpenMemberMenuId(null)
                                            props.onOpenSession?.(participant)
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Xem
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            setOpenMemberMenuId(null)
                                            openConfigModal(participant)
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                    >
                                        Cấu hình
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            setOpenMemberMenuId(null)
                                            setRemoveParticipant(participant)
                                        }}
                                        className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-500/10 dark:text-red-400"
                                    >
                                        Remove khỏi Team Chat
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )
                })}
            </div>
            {configParticipant ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Cấu hình @${configParticipant.displayName}`}
                    className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
                >
                    <div className="flex h-full w-full max-w-2xl flex-col border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-2xl sm:h-auto sm:max-h-[calc(100vh-32px)] sm:rounded-2xl">
                        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
                            <div>
                                <div className="text-base font-semibold">Cấu hình @{configParticipant.displayName}</div>
                                <div className="mt-0.5 text-xs text-[var(--app-hint)]">Member settings apply only in this Team Chat. Session settings affect the original session.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setConfigParticipant(null)
                                    setDialogError(null)
                                }}
                                className="rounded-md border border-[var(--app-border)] px-2.5 py-1 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Close
                            </button>
                        </div>
                        <div role="tablist" aria-label="Member config sections" className="flex shrink-0 gap-2 border-b border-[var(--app-border)] px-4 py-2">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={configTab === 'member'}
                                onClick={() => setConfigTab('member')}
                                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', configTab === 'member' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]')}
                            >
                                Member
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={configTab === 'session'}
                                disabled={!configParticipant.sessionId}
                                onClick={() => setConfigTab('session')}
                                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', configTab === 'session' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]')}
                            >
                                Session
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            {configTab === 'member' ? (
                                <div className="space-y-3">
                                    <div>
                                        <label htmlFor="team-member-config-alias" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Team alias</label>
                                        <input
                                            id="team-member-config-alias"
                                            aria-label="Team alias"
                                            value={configAlias}
                                            maxLength={64}
                                            onChange={(event) => setConfigAlias(event.target.value)}
                                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                        />
                                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                                            <span className="truncate text-[var(--app-hint)]">Tag preview: <span className="font-mono">@{normalizedConfigAlias || 'alias'}</span></span>
                                            <span className="text-[var(--app-hint)]">{normalizedConfigAlias.length}/32</span>
                                        </div>
                                        {configAliasError ? <div className="mt-1 text-xs text-red-600">{configAliasError}</div> : null}
                                    </div>
                                    <div>
                                        <label htmlFor="team-member-config-role" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Role</label>
                                        <select
                                            id="team-member-config-role"
                                            aria-label="Role"
                                            value={configRole}
                                            onChange={(event) => setConfigRole(event.target.value as TeamParticipant['role'])}
                                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                        >
                                            {PARTICIPANT_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="team-member-config-color" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Color</label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {PARTICIPANT_COLOR_OPTIONS.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    aria-label={`Use color ${color}`}
                                                    aria-pressed={configColor.toLowerCase() === color.toLowerCase()}
                                                    onClick={() => setConfigColor(color)}
                                                    className={cn('h-7 w-7 rounded-full border-2', configColor.toLowerCase() === color.toLowerCase() ? 'border-[var(--app-fg)]' : 'border-transparent')}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                            <input
                                                id="team-member-config-color"
                                                aria-label="Color"
                                                value={configColor}
                                                onChange={(event) => setConfigColor(event.target.value)}
                                                className="min-w-28 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 font-mono text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <TeamMemberSessionSettings
                                    api={props.api}
                                    participant={configParticipant}
                                    summary={configParticipant.sessionId ? sessionsById.get(configParticipant.sessionId) ?? null : null}
                                />
                            )}
                            {dialogError ? <div className="mt-3 rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{dialogError}</div> : null}
                        </div>
                        {configTab === 'member' ? (
                            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--app-border)] px-4 py-3">
                                <button
                                    type="button"
                                    disabled={isSubmittingMember}
                                    onClick={() => setConfigParticipant(null)}
                                    className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={isSubmittingMember || Boolean(configAliasError) || !/^#[0-9a-f]{6}$/i.test(configColor) || !props.onUpdateParticipant}
                                    onClick={() => void handleSaveMemberConfig()}
                                    className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                    {isSubmittingMember ? 'Saving…' : 'Save member config'}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {removeParticipant ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Remove @${removeParticipant.displayName}`}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
                >
                    <div className="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] p-4 text-[var(--app-fg)] shadow-2xl">
                        <div className="text-base font-semibold">Remove @{removeParticipant.displayName}?</div>
                        <div className="mt-2 text-sm text-[var(--app-hint)]">
                            Remove this member khỏi Team Chat này. Session gốc sẽ không bị xoá.
                        </div>
                        {dialogError ? <div className="mt-3 rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{dialogError}</div> : null}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                disabled={isSubmittingMember}
                                onClick={() => {
                                    setRemoveParticipant(null)
                                    setDialogError(null)
                                }}
                                className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isSubmittingMember || !props.onRemoveParticipant}
                                onClick={() => {
                                    void (async () => {
                                        setDialogError(null)
                                        setIsSubmittingMember(true)
                                        try {
                                            await props.onRemoveParticipant?.(removeParticipant)
                                            setRemoveParticipant(null)
                                        } catch (error) {
                                            setDialogError(error instanceof Error ? error.message : 'Failed to remove member.')
                                        } finally {
                                            setIsSubmittingMember(false)
                                        }
                                    })()
                                }}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </aside>
    )
}
