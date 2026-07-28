import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CREATABLE_AGENT_FLAVORS, GROK_PERMISSION_MODES, type GrokPermissionMode } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { CodexLocalSessionSummary, Machine } from '@/types/api'
import type { CodexCollaborationMode } from '@hapi/protocol'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { usePlatform } from '@/hooks/usePlatform'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useAgentModels } from '@/hooks/queries/useAgentModels'
import { useCursorModelsForMachine } from '@/hooks/queries/useCursorModelsForMachine'
import { useOpencodeModelsForCwd } from '@/hooks/queries/useOpencodeModelsForCwd'
import { useGrokModelsForCwd } from '@/hooks/queries/useGrokModelsForCwd'
import { useSessions } from '@/hooks/queries/useSessions'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { useTranslation } from '@/lib/use-translation'
import type {
    AgentType,
    LaunchEffort,
    NewSessionDraft,
    NewSessionServiceTier,
    ReasoningEffort,
    SessionType,
} from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { CollaborationModeSelector } from './CollaborationModeSelector'
import { DirectorySection } from './DirectorySection'
import { FastModeSelector } from './FastModeSelector'
import { MachineSelector } from './MachineSelector'
import { ModelSelector } from './ModelSelector'
import { OpencodeModelSelector } from './OpencodeModelSelector'
import { LaunchEffortSelector } from './LaunchEffortSelector'
import { GrokPermissionModeSelector } from './GrokPermissionModeSelector'
import { CodexResumeSection } from './CodexResumeSection'
import { shouldEnableOpencodeModelDiscovery } from './opencodeModelsGate'
import { buildGrokEffortOptions, buildGrokModelOptions, shouldEnableGrokModelDiscovery } from './grokModels'
import { ReasoningEffortSelector } from './ReasoningEffortSelector'
import {
    loadPreferredAgent,
    loadPreferredYoloMode,
    savePreferredAgent,
    savePreferredYoloMode,
} from './preferences'
import { SessionTypeSelector } from './SessionTypeSelector'
import { YoloToggle } from './YoloToggle'
import { CodexSessionSyncDialog } from '@/components/CodexSessionSyncDialog'
import { formatRunnerSpawnError } from '../../utils/formatRunnerSpawnError'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'




function CodexImportSelectButton(props: {
    selectedSession: CodexLocalSessionSummary | null
    isLoading: boolean
    isDisabled: boolean
    error: string | null
    onOpen: () => void
    onClear: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--app-hint)]">{t('codexSync.newSessionInline.title')}</div>
                    <div className="truncate text-[11px] text-[var(--app-hint)]">
                        {props.selectedSession ? props.selectedSession.title : t('codexSync.newSessionInline.description')}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {props.selectedSession ? (
                        <button type="button" className="text-xs text-[var(--app-link)]" onClick={props.onClear} disabled={props.isDisabled}>
                            {t('codexSync.newSessionInline.clear')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                        onClick={props.onOpen}
                        disabled={props.isDisabled || props.isLoading}
                    >
                        {props.isLoading ? t('codexSync.confirm.loading') : t('codexSync.newSessionInline.choose')}
                    </button>
                </div>
            </div>
            {props.error ? <div className="text-xs text-red-600">{props.error}</div> : null}
        </div>
    )
}

export function NewSession(props: {
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string) => void
    onCancel: () => void
    onChooseFolder?: (args: { machineId: string | null; directory: string }) => void
    initialDirectory?: string
    initialMachineId?: string
    initialDraft?: Partial<NewSessionDraft> | null
    onDraftChange?: (draft: NewSessionDraft) => void
    createLabel?: string
    canCreateExtra?: boolean
}) {
    const { haptic } = usePlatform()
    const { t } = useTranslation()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
    const { sessions } = useSessions(props.api)
    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()

    const [machineId, setMachineId] = useState<string | null>(
        props.initialDraft?.machineId !== undefined
            ? props.initialDraft.machineId
            : (props.initialMachineId ?? null)
    )
    const [directory, setDirectory] = useState(
        props.initialDraft?.directory ?? props.initialDirectory ?? ''
    )
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)

    const initialDraftAgent = props.initialDraft?.agent
    const initialAgentCoerced = initialDraftAgent !== undefined
        && !(CREATABLE_AGENT_FLAVORS as readonly AgentType[]).includes(initialDraftAgent)
    const resolvedInitialAgent: AgentType | undefined = initialDraftAgent === undefined
        ? undefined
        : (initialAgentCoerced ? 'claude' : initialDraftAgent)
    const [agent, setAgent] = useState<AgentType>(
        resolvedInitialAgent ?? loadPreferredAgent
    )
    const [model, setModel] = useState(
        initialAgentCoerced ? 'auto' : (props.initialDraft?.model ?? 'auto')
    )
    const [effort, setEffort] = useState<LaunchEffort>(
        initialAgentCoerced ? 'auto' : (props.initialDraft?.effort ?? 'auto')
    )
    const [grokPermissionMode, setGrokPermissionMode] = useState<GrokPermissionMode>(
        props.initialDraft?.grokPermissionMode && !initialAgentCoerced
            && (GROK_PERMISSION_MODES as readonly string[]).includes(props.initialDraft.grokPermissionMode)
            ? props.initialDraft.grokPermissionMode
            : 'default'
    )
    const [modelReasoningEffort, setModelReasoningEffort] = useState<ReasoningEffort>(
        initialAgentCoerced ? 'default' : (props.initialDraft?.modelReasoningEffort ?? 'default')
    )
    const [yoloMode, setYoloMode] = useState(
        props.initialDraft?.yoloMode ?? loadPreferredYoloMode
    )
    const [sessionType, setSessionType] = useState<SessionType>(
        props.initialDraft?.sessionType ?? 'simple'
    )
    const [worktreeName, setWorktreeName] = useState(
        props.initialDraft?.worktreeName ?? ''
    )
    const [resumeCodex, setResumeCodex] = useState(
        props.initialDraft?.resumeCodex ?? false
    )
    const [resumeCodexSessionId, setResumeCodexSessionId] = useState(
        props.initialDraft?.resumeCodexSessionId ?? ''
    )
    const [serviceTier, setServiceTier] = useState<NewSessionServiceTier>('standard')
    const [collaborationMode, setCollaborationMode] = useState<CodexCollaborationMode>('default')
    const [directoryCreationConfirmed, setDirectoryCreationConfirmed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [codexImportSessions, setCodexImportSessions] = useState<CodexLocalSessionSummary[]>([])
    const [selectedCodexImportSessionId, setSelectedCodexImportSessionId] = useState<string | null>(null)
    const [codexImportMachineId, setCodexImportMachineId] = useState<string | null>(null)
    const [isLoadingCodexImportSessions, setIsLoadingCodexImportSessions] = useState(false)
    const [codexImportError, setCodexImportError] = useState<string | null>(null)
    const [isImportingCodexSession, setIsImportingCodexSession] = useState(false)
    const [isCodexImportDialogOpen, setIsCodexImportDialogOpen] = useState(false)
    const isFormDisabled = Boolean(isPending || props.isLoading || isImportingCodexSession)
    const worktreeInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    const previousAgentRef = useRef(agent)
    useEffect(() => {
        if (previousAgentRef.current === agent) return
        previousAgentRef.current = agent
        setModel('auto')
        setEffort('auto')
        setGrokPermissionMode('default')
        setServiceTier('standard')
        setCollaborationMode('default')
    }, [agent])

    useEffect(() => {
        savePreferredAgent(agent)
    }, [agent])

    useEffect(() => {
        if (agent !== 'codex') {
            setSelectedCodexImportSessionId(null)
            setCodexImportSessions([])
            setCodexImportMachineId(null)
            setCodexImportError(null)
        }
    }, [agent])

    useEffect(() => {
        savePreferredYoloMode(yoloMode)
    }, [yoloMode])

    useEffect(() => {
        if (agent !== 'codex') {
            setResumeCodex(false)
            setResumeCodexSessionId('')
        }
    }, [agent])

    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? props.machines.find((m) => m.id === lastUsed) : null

        if (foundLast) {
            setMachineId(foundLast.id)
            if (!props.initialDirectory) {
                const paths = getRecentPaths(foundLast.id)
                if (paths[0]) setDirectory(paths[0])
            }
        } else if (props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [props.machines, machineId, getLastUsedMachineId, getRecentPaths, props.initialDirectory])

    const selectedMachine = useMemo(
        () => (machineId ? props.machines.find((machine) => machine.id === machineId) ?? null : null),
        [machineId, props.machines]
    )
    const trimmedDirectory = directory.trim()
    const deferredDirectory = useDeferredValue(trimmedDirectory)
    const codexModelsState = useCodexModels({
        api: props.api,
        machineId,
        enabled: agent === 'codex' && Boolean(machineId)
    })
    const claudeModelsState = useAgentModels({
        api: props.api,
        agent: 'claude',
        machineId,
        cwd: deferredDirectory,
        enabled: agent === 'claude' && Boolean(machineId) && Boolean(deferredDirectory)
    })
    const previousModelContextRef = useRef(`${machineId ?? ''}\0${deferredDirectory}`)
    useEffect(() => {
        const nextContext = `${machineId ?? ''}\0${deferredDirectory}`
        if (previousModelContextRef.current === nextContext) return
        previousModelContextRef.current = nextContext
        setModel('auto')
    }, [machineId, deferredDirectory])
    const [opencodeSelectedModel, setOpencodeSelectedModel] = useState<string | null>(
        props.initialDraft?.opencodeSelectedModel ?? null
    )
    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(selectedMachine),
        [selectedMachine]
    )
    const codexModelOptions = useMemo(() => {
        const options = [{ value: 'auto', label: 'Default' }]
        for (const codexModel of codexModelsState.models) {
            options.push({
                value: codexModel.id,
                label: codexModel.displayName
            })
        }
        if (model !== 'auto' && !options.some((option) => option.value === model)) {
            options.splice(1, 0, { value: model, label: model })
        }
        return options
    }, [codexModelsState.models, model])
    const claudeModelOptions = useMemo(() => {
        const options = [
            { value: 'auto', label: 'Default' },
            ...claudeModelsState.models.map((claudeModel) => ({
                value: claudeModel.id,
                label: claudeModel.displayName
            }))
        ]
        if (model !== 'auto' && !options.some((option) => option.value === model)) {
            options.splice(1, 0, { value: model, label: model })
        }
        return options
    }, [claudeModelsState.models, model])

    const showCodexFastMode = agent === 'codex'
        && !codexModelsState.error
        && codexModelAdvertisesFastTier(model === 'auto' ? null : model, codexModelsState.models)

    useEffect(() => {
        if (agent === 'codex' && codexModelsState.isLoading) {
            return
        }
        if (!showCodexFastMode && serviceTier !== 'standard') {
            setServiceTier('standard')
        }
    }, [agent, codexModelsState.isLoading, showCodexFastMode, serviceTier])
    const cursorModelsState = useCursorModelsForMachine({
        api: props.api,
        machineId,
        enabled: agent === 'cursor' && Boolean(machineId)
    })
    const cursorModelOptions = useMemo(() => {
        const options = [{ value: 'auto', label: 'Default' }]
        for (const cursorModel of cursorModelsState.availableModels) {
            if (cursorModel.modelId === 'auto') {
                continue
            }
            options.push({
                value: cursorModel.modelId,
                label: cursorModel.name ?? cursorModel.modelId
            })
        }
        if (model !== 'auto' && !options.some((option) => option.value === model)) {
            options.splice(1, 0, { value: model, label: model })
        }
        return options
    }, [cursorModelsState.availableModels, model])

    const recentPaths = useMemo(
        () => getRecentPaths(machineId),
        [getRecentPaths, machineId]
    )

    const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)

    const pathsToCheck = useMemo(
        () => Array.from(new Set([
            ...(deferredDirectory ? [deferredDirectory] : []),
            ...allPaths
        ])).slice(0, 1000),
        [allPaths, deferredDirectory]
    )

    const { pathExistence, checkPathsExists } = useMachinePathsExists(props.api, machineId, pathsToCheck)

    const verifiedPaths = useMemo(
        () => allPaths.filter((path) => pathExistence[path]),
        [allPaths, pathExistence]
    )

    const deferredDirectoryExists = deferredDirectory
        ? pathExistence[deferredDirectory]
        : undefined
    const opencodeModelsState = useOpencodeModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        // Gate on positive existence: typing partial paths must not spawn an
        // expensive `opencode acp` probe for a non-existent cwd while the
        // existence check is in flight.
        enabled: shouldEnableOpencodeModelDiscovery({
            agent,
            machineId,
            cwd: deferredDirectory,
            cwdExists: deferredDirectoryExists,
        })
    })
    const grokModelsState = useGrokModelsForCwd({
        api: props.api,
        machineId,
        cwd: deferredDirectory,
        enabled: shouldEnableGrokModelDiscovery({
            agent,
            machineId,
            cwd: deferredDirectory,
            cwdExists: deferredDirectoryExists,
        })
    })
    const grokModelOptions = useMemo(
        () => buildGrokModelOptions(grokModelsState.availableModels),
        [grokModelsState.availableModels]
    )
    const grokEffortOptions = useMemo(
        () => buildGrokEffortOptions(
            grokModelsState.availableModels,
            model,
            grokModelsState.currentModelId
        ),
        [grokModelsState.availableModels, grokModelsState.currentModelId, model]
    )
    useEffect(() => {
        // Auto-pick the OpenCode default model when discovery finishes, so the
        // form has a sensible value if the user hits Enter without scrolling.
        if (agent !== 'opencode') return
        if (opencodeSelectedModel !== null) return
        const fallback = opencodeModelsState.currentModelId
            ?? opencodeModelsState.availableModels[0]?.modelId
            ?? null
        if (fallback) {
            setOpencodeSelectedModel(fallback)
        }
    }, [agent, opencodeSelectedModel, opencodeModelsState.currentModelId, opencodeModelsState.availableModels])
    const previousOpencodeContextRef = useRef(`${agent}\0${machineId ?? ''}\0${deferredDirectory}`)
    useEffect(() => {
        const nextContext = `${agent}\0${machineId ?? ''}\0${deferredDirectory}`
        if (previousOpencodeContextRef.current === nextContext) return
        previousOpencodeContextRef.current = nextContext
        // Reset selection when agent / machine / directory changes; new probe = new defaults.
        setOpencodeSelectedModel(null)
        setModelReasoningEffort('default')
    }, [agent, machineId, deferredDirectory])

    useEffect(() => {
        props.onDraftChange?.({
            machineId,
            directory,
            agent,
            model,
            effort,
            modelReasoningEffort,
            yoloMode,
            grokPermissionMode,
            sessionType,
            worktreeName,
            resumeCodex,
            resumeCodexSessionId,
            opencodeSelectedModel,
        })
    }, [
        props.onDraftChange,
        machineId,
        directory,
        agent,
        model,
        effort,
        modelReasoningEffort,
        yoloMode,
        grokPermissionMode,
        sessionType,
        worktreeName,
        resumeCodex,
        resumeCodexSessionId,
        opencodeSelectedModel,
    ])
    const opencodeReasoningEffortOptions = useMemo(() => {
        if (agent !== 'opencode' || opencodeModelsState.availableEfforts.length === 0) {
            return []
        }
        return [
            { value: 'default', label: 'Default' },
            ...opencodeModelsState.availableEfforts
                .filter((effort) => effort.effortId !== 'default')
                .map((effort) => ({
                    value: effort.effortId,
                    label: effort.name ?? effort.effortId
                }))
        ]
    }, [agent, opencodeModelsState.availableEfforts])

    const currentDirectoryExists = trimmedDirectory ? pathExistence[trimmedDirectory] : undefined
    const needsDirectoryCreationWarning = sessionType === 'simple' && trimmedDirectory !== '' && currentDirectoryExists === false
    const missingWorktreeDirectory = sessionType === 'worktree' && trimmedDirectory !== '' && currentDirectoryExists === false
    const directoryStatusMessage = missingWorktreeDirectory
        ? t('session.directoryMissingWorktree')
        : needsDirectoryCreationWarning
            ? (
                directoryCreationConfirmed
                    ? t('session.directoryMissingSimpleConfirm')
                    : t('session.directoryMissingSimple')
            )
            : null
    const directoryStatusTone = missingWorktreeDirectory ? 'error' : needsDirectoryCreationWarning ? 'warning' : null
    const createLabel = needsDirectoryCreationWarning && directoryCreationConfirmed
        ? t('session.createAndCreateDirectory')
        : props.createLabel

    useEffect(() => {
        setDirectoryCreationConfirmed(false)
    }, [machineId, sessionType, trimmedDirectory])

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return verifiedPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [verifiedPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory

    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )



    const handleArchiveCodexImportSession = useCallback(async (session: CodexLocalSessionSummary) => {
        if (!props.api) return
        const result = await props.api.archiveCodexSession(session.id, codexImportMachineId ?? machineId)
        if (!result.success) {
            throw new Error(result.error)
        }
        setCodexImportSessions((current) => current.filter((item) => item.id !== session.id))
        if (selectedCodexImportSessionId === session.id) {
            setSelectedCodexImportSessionId(null)
        }
    }, [codexImportMachineId, machineId, props.api, selectedCodexImportSessionId])

    const loadCodexImportSessions = useCallback(async () => {
        if (agent !== 'codex' || !machineId) return
        setIsLoadingCodexImportSessions(true)
        setCodexImportError(null)
        try {
            const result = await props.api.getCodexSessions(trimmedDirectory || null, machineId)
            setCodexImportSessions(result.sessions)
            setCodexImportMachineId(result.machineId ?? machineId)
            setSelectedCodexImportSessionId((current) => current && result.sessions.some((session) => session.id === current) ? current : null)
        } catch (e) {
            setCodexImportSessions([])
            setCodexImportMachineId(null)
            setSelectedCodexImportSessionId(null)
            setCodexImportError(e instanceof Error ? e.message : t('codexSync.failed.body'))
        } finally {
            setIsLoadingCodexImportSessions(false)
        }
    }, [agent, machineId, props.api, trimmedDirectory, t])

    const selectedCodexImportSession = useMemo(
        () => codexImportSessions.find((session) => session.id === selectedCodexImportSessionId) ?? null,
        [codexImportSessions, selectedCodexImportSessionId]
    )

    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        setModel('auto')
        setSelectedCodexImportSessionId(null)
        setCodexImportSessions([])
        setCodexImportMachineId(null)
        const paths = getRecentPaths(newMachineId)
        if (paths[0]) {
            setDirectory(paths[0])
        } else {
            setDirectory('')
        }
    }, [getRecentPaths])

    const handleChooseFolderClick = useCallback(() => {
        if (!props.onChooseFolder) {
            return
        }
        props.onChooseFolder({ machineId, directory: trimmedDirectory })
    }, [
        props.onChooseFolder,
        machineId,
        trimmedDirectory
    ])

    const handleSelectCodexImportSession = useCallback((session: CodexLocalSessionSummary) => {
        setSelectedCodexImportSessionId(session.id)
        if (session.cwd?.trim()) {
            setDirectory(session.cwd.trim())
        }
    }, [])

    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        setSuppressSuggestions(false)
        setDirectory(value)
    }, [])

    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    const chooseFolderCallback = props.onChooseFolder
    const workspaceRootAvailable = Boolean(selectedMachine?.metadata?.workspaceRoot)
    const handleChooseFolder = useMemo(() => {
        if (!chooseFolderCallback || !workspaceRootAvailable) return undefined
        return () => chooseFolderCallback({ machineId, directory: trimmedDirectory })
    }, [chooseFolderCallback, workspaceRootAvailable, machineId, trimmedDirectory])

    async function handleCreate() {
        if (!machineId || !trimmedDirectory) return

        setError(null)
        try {
            const existsResult = await checkPathsExists([trimmedDirectory])
            const directoryExists = existsResult[trimmedDirectory]

            if (sessionType === 'worktree' && directoryExists === false) {
                haptic.notification('error')
                setError(t('session.directoryMissingWorktree'))
                return
            }

            if (sessionType === 'simple' && directoryExists === false && !directoryCreationConfirmed) {
                setDirectoryCreationConfirmed(true)
                return
            }

            const resolvedModel = agent === 'opencode'
                ? (opencodeSelectedModel ?? undefined)
                : (model !== 'auto' ? model : undefined)
            const resolvedEffort = (agent === 'claude' || agent === 'grok') && effort !== 'auto'
                ? effort
                : undefined
            const resolvedModelReasoningEffort = (agent === 'codex' || agent === 'opencode') && modelReasoningEffort !== 'default'
                ? modelReasoningEffort
                : undefined
            const trimmedResumeCodexSessionId = resumeCodexSessionId.trim()
            const resolvedServiceTier = agent === 'codex' && showCodexFastMode
                ? serviceTier
                : undefined
            const resolvedCollaborationMode = agent === 'codex' && collaborationMode !== 'default'
                ? collaborationMode
                : undefined

            if (agent === 'codex' && selectedCodexImportSession) {
                setIsImportingCodexSession(true)
                const result = await props.api.syncCodexSession({
                    sessionIds: [selectedCodexImportSession.id],
                    cwd: selectedCodexImportSession.cwd ?? trimmedDirectory,
                    machineId: codexImportMachineId ?? machineId,
                    model: resolvedModel ?? null,
                    modelReasoningEffort: resolvedModelReasoningEffort ?? null,
                    serviceTier: resolvedServiceTier,
                    collaborationMode: resolvedCollaborationMode ?? 'default',
                    yolo: yoloMode
                })
                if (result.success) {
                    const importedSessionId = result.hapiSessionIds?.[0]
                    if (!importedSessionId) {
                        throw new Error('Imported session id missing')
                    }
                    // 中文注释：Codex transcript 导入只会创建 Hapi 记录，不会自动启动 agent。
                    // 这里立刻 resume，避免进入会话页时先看到离线，等首条消息才触发启动。
                    const resumedSessionId = await props.api.resumeSession(
                        importedSessionId,
                        yoloMode ? { permissionMode: 'yolo' } : undefined
                    )
                    haptic.notification('success')
                    markCodexSessionsImported([selectedCodexImportSession.id])
                    setLastUsedMachineId(machineId)
                    addRecentPath(machineId, trimmedDirectory)
                    props.onSuccess(resumedSessionId)
                    return
                }
                setIsImportingCodexSession(false)
                haptic.notification('error')
                setError(result.error || result.message || t('codexSync.failed.body'))
                return
            }

            const result = await spawnSession({
                machineId,
                directory: trimmedDirectory,
                agent,
                model: resolvedModel,
                effort: resolvedEffort,
                modelReasoningEffort: resolvedModelReasoningEffort,
                yolo: agent === 'grok' ? undefined : yoloMode,
                permissionMode: agent === 'grok' ? grokPermissionMode : undefined,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined,
                resumeSessionId: agent === 'codex' && resumeCodex && trimmedResumeCodexSessionId
                    ? trimmedResumeCodexSessionId
                    : undefined,
                serviceTier: resolvedServiceTier,
                collaborationMode: resolvedCollaborationMode
            })

            if (result.type === 'success') {
                haptic.notification('success')
                setLastUsedMachineId(machineId)
                addRecentPath(machineId, trimmedDirectory)
                props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            setIsImportingCodexSession(false)
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to create session')
        }
    }

    const fastModeSelectionPending = agent === 'codex'
        && serviceTier === 'fast'
        && codexModelsState.isLoading
    const resumeCodexSessionIdRequired = agent === 'codex' && resumeCodex
    const canCreate = Boolean(
        machineId
        && trimmedDirectory
        && !isFormDisabled
        && !missingWorktreeDirectory
        && (!resumeCodexSessionIdRequired || resumeCodexSessionId.trim())
        && (props.canCreateExtra ?? true)
        && !fastModeSelectionPending
    )

    return (
        <div className="flex flex-col divide-y divide-[var(--app-divider)]">
            <MachineSelector
                machines={props.machines}
                machineId={machineId}
                isLoading={props.isLoading}
                isDisabled={isFormDisabled}
                onChange={handleMachineChange}
            />
            {runnerSpawnError ? (
                <div className="px-3 py-2 text-xs text-red-600">
                    Runner last spawn error: {runnerSpawnError}
                </div>
            ) : null}
            <DirectorySection
                directory={directory}
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                isDisabled={isFormDisabled}
                recentPaths={recentPaths}
                statusMessage={directoryStatusMessage}
                statusTone={directoryStatusTone}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
                onChooseFolder={handleChooseFolder}
            />
            <SessionTypeSelector
                sessionType={sessionType}
                worktreeName={worktreeName}
                worktreeInputRef={worktreeInputRef}
                isDisabled={isFormDisabled}
                onSessionTypeChange={setSessionType}
                onWorktreeNameChange={setWorktreeName}
            />
            <AgentSelector
                agent={agent}
                isDisabled={isFormDisabled}
                onAgentChange={setAgent}
            />
            {agent === 'codex' ? (
                <CodexImportSelectButton
                    selectedSession={selectedCodexImportSession}
                    isLoading={isLoadingCodexImportSessions}
                    isDisabled={isFormDisabled}
                    error={codexImportError}
                    onOpen={() => {
                        setIsCodexImportDialogOpen(true)
                        void loadCodexImportSessions()
                    }}
                    onClear={() => setSelectedCodexImportSessionId(null)}
                />
            ) : null}
            {agent === 'opencode' ? (
                <OpencodeModelSelector
                    cwd={deferredDirectory}
                    machineId={machineId}
                    isLoading={opencodeModelsState.isLoading}
                    error={opencodeModelsState.error}
                    availableModels={opencodeModelsState.availableModels}
                    currentModelId={opencodeModelsState.currentModelId}
                    selectedModel={opencodeSelectedModel}
                    onModelChange={setOpencodeSelectedModel}
                    onRetry={opencodeModelsState.refetch}
                />
            ) : (
                <ModelSelector
                    agent={agent}
                    model={model}
                    options={agent === 'codex'
                        ? codexModelOptions
                        : agent === 'claude'
                            ? claudeModelOptions
                            : agent === 'grok'
                                ? grokModelOptions
                                : agent === 'cursor'
                                    ? cursorModelOptions
                                    : undefined}
                    isDisabled={isFormDisabled
                        || (agent === 'codex' && Boolean(codexModelsState.error))
                        || (agent === 'claude' && claudeModelsState.isLoading)
                        || (agent === 'grok' && Boolean(grokModelsState.error))
                        || (agent === 'cursor' && Boolean(cursorModelsState.error))}
                    isLoading={(agent === 'codex' && codexModelsState.isLoading)
                        || (agent === 'claude' && claudeModelsState.isLoading)
                        || (agent === 'grok' && grokModelsState.isLoading)
                        || (agent === 'cursor' && cursorModelsState.isLoading)}
                    error={agent === 'codex' && codexModelsState.error
                        ? `${t('newSession.model.loadFailed')}: ${codexModelsState.error}`
                        : agent === 'claude' && claudeModelsState.error
                            ? `${t('newSession.agentModelsLoadFailed')}: ${claudeModelsState.error}`
                            : agent === 'grok' && grokModelsState.error
                                ? `${t('newSession.model.loadFailed')}: ${grokModelsState.error}`
                                : agent === 'cursor' && cursorModelsState.error
                                    ? `${t('newSession.model.loadFailed')}: ${cursorModelsState.error}`
                                    : null}
                    onModelChange={setModel}
                />
            )}
            <LaunchEffortSelector
                agent={agent}
                effort={effort}
                isDisabled={isFormDisabled}
                onEffortChange={setEffort}
                grokOptions={agent === 'grok' ? grokEffortOptions : undefined}
            />
            <ReasoningEffortSelector
                agent={agent}
                value={modelReasoningEffort}
                options={opencodeReasoningEffortOptions}
                isDisabled={isFormDisabled}
                onChange={setModelReasoningEffort}
            />
            <GrokPermissionModeSelector
                agent={agent}
                value={grokPermissionMode}
                isDisabled={isFormDisabled}
                onChange={setGrokPermissionMode}
            />
            <CollaborationModeSelector
                agent={agent}
                value={collaborationMode}
                isDisabled={isFormDisabled}
                onChange={setCollaborationMode}
            />
            <FastModeSelector
                visible={showCodexFastMode}
                value={serviceTier}
                isDisabled={isFormDisabled}
                onChange={setServiceTier}
            />
            {agent !== 'grok' ? (
                <YoloToggle
                    yoloMode={yoloMode}
                    isDisabled={isFormDisabled}
                    onToggle={setYoloMode}
                />
            ) : null}

            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            <ActionButtons
                isPending={isPending || isImportingCodexSession}
                canCreate={canCreate}
                isDisabled={isFormDisabled}
                createLabel={createLabel}
                onCancel={props.onCancel}
                onCreate={handleCreate}
            />
            <CodexSessionSyncDialog
                isOpen={isCodexImportDialogOpen}
                onClose={() => setIsCodexImportDialogOpen(false)}
                sessions={codexImportSessions}
                currentCodexSessionId={selectedCodexImportSessionId}
                currentWorkDirectory={trimmedDirectory}
                selectionMode="single"
                onSelectOnly={(session) => {
                    handleSelectCodexImportSession(session)
                    setIsCodexImportDialogOpen(false)
                }}
                onConfirm={async () => {}}
                onRestartCodexDesktop={async () => { await loadCodexImportSessions() }}
                onArchiveSession={handleArchiveCodexImportSession}
                isPending={false}
                isRestartingCodexDesktop={false}
                isLoading={isLoadingCodexImportSessions}
            />
        </div>
    )
}
