import { getCodexCollaborationModeOptions, getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import { ComposerPrimitive, useAssistantApi, useAssistantState } from '@assistant-ui/react'
import {
    type ChangeEvent as ReactChangeEvent,
    type ClipboardEvent as ReactClipboardEvent,
    type FormEvent as ReactFormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { AgentState, CodexCollaborationMode, PermissionMode } from '@/types/api'
import type { QuotaWindow } from '@/chat/reducer'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import type { ConversationStatus } from '@/realtime/types'
import { useActiveWord } from '@/hooks/useActiveWord'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { applySuggestion } from '@/utils/applySuggestion'
import { usePlatform } from '@/hooks/usePlatform'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { supportsEffort, supportsModelChange } from '@hapi/protocol'
import { markSkillUsed } from '@/lib/recent-skills'
import { useComposerDraft } from '@/hooks/useComposerDraft'
import type { SendStatus } from '@/hooks/mutations/useSendMessage'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { StatusBar } from '@/components/AssistantChat/StatusBar'
import { ComposerButtons } from '@/components/AssistantChat/ComposerButtons'
import {
    CompactComposerActionButton,
    CompactComposerAttachmentButton,
    CompactRuntimeControls
} from '@/components/AssistantChat/CompactComposerControls'
import type { CompactRuntimeChange } from '@/components/AssistantChat/CompactComposerControls'
import { SessionComposerSettingsPanel } from '@/components/AssistantChat/SessionComposerSettingsPanel'
import { AttachmentItem } from '@/components/AssistantChat/AttachmentItem'
import { useTranslation } from '@/lib/use-translation'
import { getModelOptionsForFlavor, getNextModelForFlavor } from './modelOptions'
import { getClaudeComposerEffortOptions } from './claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from './codexReasoningEffortOptions'
import { shouldSendComposerOnEnter } from './composerKeyboard'

export interface TextInputState {
    text: string
    selection: { start: number; end: number }
}

export function appendTextToComposerDraft(currentDraft: string, textToAppend: string): string {
    const additions = textToAppend
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    const existingText = currentDraft.trimEnd()
    const existingTokens = new Set(existingText.split(/\s+/).filter(Boolean))
    let nextText = existingText

    for (const addition of additions) {
        if (existingTokens.has(addition)) continue
        nextText = nextText.length === 0 ? addition : `${nextText}\n${addition}`
        existingTokens.add(addition)
    }

    return nextText
}

export function shouldUseMultilineComposerRadius(
    text: string,
    scrollHeight: number,
    clientHeight: number,
    singleLineHeight = clientHeight
): boolean {
    if (text.length === 0) return false
    const baselineHeight = singleLineHeight > 0 ? singleLineHeight : clientHeight
    return text.includes('\n') || scrollHeight > baselineHeight + 2
}

function getCompactComposerSingleLineHeight(input: HTMLTextAreaElement): number {
    const styles = window.getComputedStyle(input)
    const lineHeight = Number.parseFloat(styles.lineHeight)
    const paddingTop = Number.parseFloat(styles.paddingTop)
    const paddingBottom = Number.parseFloat(styles.paddingBottom)
    if (!Number.isFinite(lineHeight)) return input.clientHeight
    return lineHeight
        + (Number.isFinite(paddingTop) ? paddingTop : 0)
        + (Number.isFinite(paddingBottom) ? paddingBottom : 0)
}

const defaultSuggestionHandler = async (): Promise<Suggestion[]> => []

type CompactSendLifecycle =
    | { phase: 'idle' }
    | { phase: 'pre-run'; afterAttemptId: number }
    | { phase: 'running'; attemptId: number }

export function HappyComposer(props: {
    sessionId?: string
    disabled?: boolean
    sendDisabled?: boolean
    permissionMode?: PermissionMode
    collaborationMode?: CodexCollaborationMode
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    active?: boolean
    allowSendWhenInactive?: boolean
    thinking?: boolean
    agentState?: AgentState | null
    backgroundTaskCount?: number
    contextSize?: number
    contextCacheRead?: number
    contextWindow?: number | null
    quotaFiveHour?: QuotaWindow | null
    quotaSevenDay?: QuotaWindow | null
    controlledByUser?: boolean
    agentFlavor?: string | null
    availableModelOptions?: Array<{ value: string | null; label: string }>
    availableModelReasoningEffortOptions?: Array<{ value: string | null; label: string }>
    onCollaborationModeChange?: (mode: CodexCollaborationMode) => void
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string | null) => void
    onModelReasoningEffortChange?: (modelReasoningEffort: string | null) => void
    onEffortChange?: (effort: string | null) => void
    onCompactRuntimeChange?: (change: CompactRuntimeChange) => Promise<void>
    onSwitchToRemote?: () => void | Promise<void>
    onTerminal?: () => void
    terminalUnsupported?: boolean
    autocompletePrefixes?: string[]
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    // Voice assistant props
    voiceStatus?: ConversationStatus
    voiceMicMuted?: boolean
    onVoiceToggle?: () => void
    onVoiceMicToggle?: () => void
    appendText?: string
    onAppendTextConsumed?: () => void
    compactComposerMode?: boolean
    compactSendStatus?: SendStatus
}) {
    const { t } = useTranslation()
    const {
        sessionId,
        disabled = false,
        sendDisabled = false,
        permissionMode: rawPermissionMode,
        collaborationMode: rawCollaborationMode,
        model: rawModel,
        modelReasoningEffort: rawModelReasoningEffort,
        effort: rawEffort,
        active = true,
        allowSendWhenInactive = false,
        thinking = false,
        agentState,
        backgroundTaskCount,
        contextSize,
        contextCacheRead,
        contextWindow,
        quotaFiveHour,
        quotaSevenDay,
        controlledByUser = false,
        agentFlavor,
        availableModelOptions,
        availableModelReasoningEffortOptions,
        onCollaborationModeChange,
        onPermissionModeChange,
        onModelChange,
        onModelReasoningEffortChange,
        onEffortChange,
        onCompactRuntimeChange,
        onSwitchToRemote,
        onTerminal,
        terminalUnsupported = false,
        autocompletePrefixes = ['@', '/', '$'],
        autocompleteSuggestions = defaultSuggestionHandler,
        voiceStatus = 'disconnected',
        voiceMicMuted = false,
        onVoiceToggle,
        onVoiceMicToggle,
        appendText,
        onAppendTextConsumed,
        compactComposerMode = false,
        compactSendStatus
    } = props

    // Use ?? so missing values fall back to default (destructuring defaults only handle undefined)
    const permissionMode = rawPermissionMode ?? 'default'
    const collaborationMode = rawCollaborationMode ?? 'default'
    const model = rawModel ?? null
    const modelReasoningEffort = rawModelReasoningEffort ?? null
    const effort = rawEffort ?? null

    const api = useAssistantApi()
    const composerText = useAssistantState(({ composer }) => composer.text)
    const attachments = useAssistantState(({ composer }) => composer.attachments)
    const threadIsRunning = useAssistantState(({ thread }) => thread.isRunning)
    const threadIsDisabled = useAssistantState(({ thread }) => thread.isDisabled)

    const sessionControlsDisabled = disabled || (!active && !allowSendWhenInactive)
    const controlsDisabled = sessionControlsDisabled || sendDisabled || threadIsDisabled
    const composerInputDisabled = compactComposerMode && threadIsRunning
        ? sessionControlsDisabled
        : controlsDisabled
    const trimmed = composerText.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0
    const attachmentsReady = !hasAttachments || attachments.every((attachment) => {
        if (attachment.status.type === 'complete') {
            return true
        }
        if (attachment.status.type !== 'requires-action') {
            return false
        }
        const path = (attachment as { path?: string }).path
        return typeof path === 'string' && path.length > 0
    })
    const [inputState, setInputState] = useState<TextInputState>({
        text: '',
        selection: { start: 0, end: 0 }
    })
    const [showSettings, setShowSettings] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [isSwitching, setIsSwitching] = useState(false)
    const [isRuntimeChanging, setIsRuntimeChanging] = useState(false)
    const [showContinueHint, setShowContinueHint] = useState(false)
    const [composerMultiline, setComposerMultiline] = useState(false)
    const [compactSendLifecycle, setCompactSendLifecycle] = useState<CompactSendLifecycle>({ phase: 'idle' })
    const compactSendLocked = compactComposerMode && compactSendLifecycle.phase !== 'idle'
    const canSend = (hasText || hasAttachments)
        && attachmentsReady
        && !controlsDisabled
        && (!compactComposerMode || (!threadIsRunning && !compactSendLocked))

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const prevControlledByUser = useRef(controlledByUser)
    const composerTextRef = useRef(composerText)
    const isSwitchingRef = useRef(false)
    const runtimePendingRef = useRef(false)

    useEffect(() => {
        composerTextRef.current = composerText
    }, [composerText])

    useEffect(() => {
        if (!compactComposerMode) {
            if (compactSendLifecycle.phase !== 'idle') {
                setCompactSendLifecycle({ phase: 'idle' })
            }
            return
        }
        if (compactSendLifecycle.phase === 'idle') return

        if (compactSendLifecycle.phase === 'running') {
            if (!threadIsRunning) {
                setCompactSendLifecycle({ phase: 'idle' })
            }
            return
        }

        if (threadIsRunning) {
            setCompactSendLifecycle({
                phase: 'running',
                attemptId: compactSendStatus?.attemptId ?? compactSendLifecycle.afterAttemptId
            })
            return
        }

        if (
            compactSendStatus
            && compactSendStatus.attemptId > compactSendLifecycle.afterAttemptId
            && compactSendStatus.state === 'error'
        ) {
            setCompactSendLifecycle({ phase: 'idle' })
        }
    }, [
        compactComposerMode,
        compactSendLifecycle,
        compactSendStatus,
        threadIsRunning
    ])

    useComposerDraft(sessionId, composerText, (text) => api.composer().setText(text))

    useEffect(() => {
        if (!appendText) return

        const nextText = appendTextToComposerDraft(composerTextRef.current, appendText)
        api.composer().setText(nextText)
        composerTextRef.current = nextText
        setInputState({
            text: nextText,
            selection: { start: nextText.length, end: nextText.length }
        })
        onAppendTextConsumed?.()

        setTimeout(() => {
            const el = textareaRef.current
            if (!el) return
            el.setSelectionRange(nextText.length, nextText.length)
            try {
                el.focus({ preventScroll: true })
            } catch {
                el.focus()
            }
        }, 0)
    }, [appendText, api, onAppendTextConsumed])

    useEffect(() => {
        setInputState((prev) => {
            if (prev.text === composerText) return prev
            // When syncing from composerText, update selection to end of text
            // This ensures activeWord detection works correctly
            const newPos = composerText.length
            return { text: composerText, selection: { start: newPos, end: newPos } }
        })
    }, [composerText])

    useEffect(() => {
        if (!compactComposerMode) return

        const frame = window.requestAnimationFrame(() => {
            const input = textareaRef.current
            if (!input) return
            setComposerMultiline(shouldUseMultilineComposerRadius(
                composerText,
                input.scrollHeight,
                input.clientHeight,
                getCompactComposerSingleLineHeight(input)
            ))
        })

        return () => window.cancelAnimationFrame(frame)
    }, [compactComposerMode, composerText])

    useEffect(() => {
        if (!compactComposerMode) return
        const input = textareaRef.current
        if (!input || typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(() => {
            setComposerMultiline(shouldUseMultilineComposerRadius(
                input.value,
                input.scrollHeight,
                input.clientHeight,
                getCompactComposerSingleLineHeight(input)
            ))
        })
        observer.observe(input)

        return () => observer.disconnect()
    }, [compactComposerMode])

    // Track one-time "continue" hint after switching from local to remote.
    useEffect(() => {
        if (prevControlledByUser.current === true && controlledByUser === false) {
            setShowContinueHint(true)
        }
        if (controlledByUser) {
            setShowContinueHint(false)
        }
        prevControlledByUser.current = controlledByUser
    }, [controlledByUser])

    const { haptic: platformHaptic, isTouch } = usePlatform()
    const hasCoarsePointer = useMediaQuery('(pointer: coarse)')
    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    const bottomPaddingClass = isIOSPWA ? 'pb-0' : 'pb-2'
    const activeWord = useActiveWord(inputState.text, inputState.selection, autocompletePrefixes)
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeWord,
        autocompleteSuggestions,
        { clampSelection: true, wrapAround: true }
    )

    const haptic = useCallback((type: 'light' | 'success' | 'error' = 'light') => {
        if (type === 'light') {
            platformHaptic.impact('light')
        } else if (type === 'success') {
            platformHaptic.notification('success')
        } else {
            platformHaptic.notification('error')
        }
    }, [platformHaptic])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (!suggestion || !textareaRef.current) return
        if (suggestion.text.startsWith('$')) {
            markSkillUsed(suggestion.text.slice(1))
        }

        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            autocompletePrefixes,
            true
        )

        api.composer().setText(result.text)
        setInputState({
            text: result.text,
            selection: { start: result.cursorPosition, end: result.cursorPosition }
        })

        setTimeout(() => {
            const el = textareaRef.current
            if (!el) return
            el.setSelectionRange(result.cursorPosition, result.cursorPosition)
            try {
                el.focus({ preventScroll: true })
            } catch {
                el.focus()
            }
        }, 0)

        haptic('light')
    }, [api, suggestions, inputState, autocompletePrefixes, haptic])

    const abortDisabled = (compactComposerMode ? sessionControlsDisabled : controlsDisabled)
        || isAborting
        || !threadIsRunning
    const switchDisabled = controlsDisabled || isSwitching || isRuntimeChanging || !controlledByUser
    const showSwitchButton = Boolean(controlledByUser && onSwitchToRemote)
    const showTerminalButton = Boolean(onTerminal || terminalUnsupported)
    const terminalDisabled = controlsDisabled || terminalUnsupported
    const terminalLabel = terminalUnsupported ? t('terminal.unsupportedWindows') : t('composer.terminal')

    useEffect(() => {
        if (!isAborting) return
        if (threadIsRunning) return
        setIsAborting(false)
    }, [isAborting, threadIsRunning])

    useEffect(() => {
        if (!isSwitching) return
        if (controlledByUser) return
        isSwitchingRef.current = false
        setIsSwitching(false)
    }, [isSwitching, controlledByUser])

    const handleAbort = useCallback(() => {
        if (abortDisabled) return
        haptic('error')
        setIsAborting(true)
        api.thread().cancelRun()
    }, [abortDisabled, api, haptic])

    const handleSwitch = useCallback(async () => {
        if (switchDisabled || isSwitchingRef.current || runtimePendingRef.current || !onSwitchToRemote) return
        isSwitchingRef.current = true
        haptic('light')
        setIsSwitching(true)
        try {
            await onSwitchToRemote()
        } catch {
            isSwitchingRef.current = false
            setIsSwitching(false)
        }
    }, [switchDisabled, onSwitchToRemote, haptic])

    const handleRuntimePendingChange = useCallback((nextPending: boolean) => {
        runtimePendingRef.current = nextPending
        setIsRuntimeChanging(nextPending)
    }, [])

    const isRuntimeChangeBlocked = useCallback(() => isSwitchingRef.current, [])

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const collaborationModeOptions = useMemo(
        () => agentFlavor === 'codex' ? getCodexCollaborationModeOptions() : [],
        [agentFlavor]
    )
    const modelOptions = useMemo(
        () => getModelOptionsForFlavor(agentFlavor, model, availableModelOptions),
        [agentFlavor, model, availableModelOptions]
    )
    const modelReasoningEffortOptions = useMemo(
        () => agentFlavor === 'codex'
            ? getCodexComposerReasoningEffortOptions(modelReasoningEffort)
            : availableModelReasoningEffortOptions ?? [],
        [agentFlavor, modelReasoningEffort, availableModelReasoningEffortOptions]
    )
    const claudeEffortOptions = useMemo(
        () => getClaudeComposerEffortOptions(effort),
        [effort]
    )
    const permissionModes = useMemo(
        () => permissionModeOptions.map((option) => option.mode),
        [permissionModeOptions]
    )

    const beginCompactSend = useCallback(() => {
        if (compactComposerMode) {
            setCompactSendLifecycle({
                phase: 'pre-run',
                afterAttemptId: compactSendStatus?.attemptId ?? 0
            })
        }
    }, [compactComposerMode, compactSendStatus?.attemptId])

    const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        const key = e.key

        // Avoid intercepting IME composition keystrokes (Enter, arrows, etc.)
        if (e.nativeEvent.isComposing) {
            return
        }

        // Enter with suggestions visible: select the suggestion
        if (key === 'Enter' && suggestions.length > 0) {
            e.preventDefault()
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
            handleSuggestionSelect(indexToSelect)
            return
        }

        // Agent Mode supports drafting while a run is active, but never queues
        // another send. Leave Enter alone so it remains a drafting/newline action.
        if (key === 'Enter' && compactComposerMode && threadIsRunning) {
            return
        }

        // Mobile/tablet keyboard Enter should insert a newline; users can send
        // with the explicit send button. Desktop keeps plain Enter-to-send.
        if (key === 'Enter' && isTouch && hasCoarsePointer) {
            return
        }

        // Shift+Enter inserts a newline (standard desktop behavior)
        if (key === 'Enter' && e.shiftKey) {
            return
        }

        // Only plain desktop Enter sends; other modifier combos are ignored
        if (key === 'Enter') {
            e.preventDefault()
            if (shouldSendComposerOnEnter(e, { isTouch, hasCoarsePointer }) && canSend) {
                beginCompactSend()
                api.composer().send()
                setShowContinueHint(false)
            }
            return
        }

        if (suggestions.length > 0) {
            if (key === 'ArrowUp') {
                e.preventDefault()
                moveUp()
                return
            }
            if (key === 'ArrowDown') {
                e.preventDefault()
                moveDown()
                return
            }
            if ((key === 'Tab') && !e.shiftKey) {
                e.preventDefault()
                const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
                handleSuggestionSelect(indexToSelect)
                return
            }
            if (key === 'Escape') {
                e.preventDefault()
                clearSuggestions()
                return
            }
        }

        if (key === 'Escape' && threadIsRunning) {
            e.preventDefault()
            handleAbort()
            return
        }

        if (key === 'Tab' && e.shiftKey && onPermissionModeChange && permissionModes.length > 0) {
            e.preventDefault()
            const currentIndex = permissionModes.indexOf(permissionMode)
            const nextIndex = (currentIndex + 1) % permissionModes.length
            const nextMode = permissionModes[nextIndex] ?? 'default'
            onPermissionModeChange(nextMode)
            haptic('light')
        }
    }, [
        suggestions,
        selectedIndex,
        moveUp,
        moveDown,
        clearSuggestions,
        handleSuggestionSelect,
        threadIsRunning,
        handleAbort,
        onPermissionModeChange,
        permissionMode,
        permissionModes,
        canSend,
        api,
        isTouch,
        hasCoarsePointer,
        compactComposerMode,
        beginCompactSend,
        haptic
    ])

    useEffect(() => {
        const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'm' && (e.metaKey || e.ctrlKey) && onModelChange && supportsModelChange(agentFlavor)) {
                e.preventDefault()
                onModelChange(getNextModelForFlavor(agentFlavor, model, availableModelOptions))
                haptic('light')
            }
        }

        window.addEventListener('keydown', handleGlobalKeyDown)
        return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [model, onModelChange, haptic, agentFlavor, availableModelOptions])

    const handleChange = useCallback((e: ReactChangeEvent<HTMLTextAreaElement>) => {
        const selection = {
            start: e.target.selectionStart,
            end: e.target.selectionEnd
        }
        setInputState({ text: e.target.value, selection })
        if (compactComposerMode) {
            setComposerMultiline(shouldUseMultilineComposerRadius(
                e.target.value,
                e.target.scrollHeight,
                e.target.clientHeight,
                getCompactComposerSingleLineHeight(e.target)
            ))
        }
    }, [compactComposerMode])

    const handleSelect = useCallback((e: ReactSyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement
        setInputState(prev => ({
            ...prev,
            selection: { start: target.selectionStart, end: target.selectionEnd }
        }))
    }, [])

    const handlePaste = useCallback(async (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData?.files || [])
        const imageFiles = files.filter(file => file.type.startsWith('image/'))

        if (imageFiles.length === 0) return

        e.preventDefault()

        try {
            for (const file of imageFiles) {
                await api.composer().addAttachment(file)
            }
        } catch (error) {
            console.error('Error adding pasted image:', error)
        }
    }, [api])

    const handleSettingsToggle = useCallback(() => {
        haptic('light')
        setShowSettings(prev => !prev)
    }, [haptic])

    const handleSubmit = useCallback((event?: ReactFormEvent<HTMLFormElement>) => {
        if (event && !canSend) {
            event.preventDefault()
            return
        }
        beginCompactSend()
        setShowContinueHint(false)
    }, [beginCompactSend, canSend])

    const handlePermissionChange = useCallback((mode: PermissionMode) => {
        if (!onPermissionModeChange || controlsDisabled) return
        onPermissionModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onPermissionModeChange, controlsDisabled, haptic])

    const handleCollaborationChange = useCallback((mode: CodexCollaborationMode) => {
        if (!onCollaborationModeChange || controlsDisabled) return
        onCollaborationModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onCollaborationModeChange, controlsDisabled, haptic])

    const handleModelChange = useCallback((nextModel: string | null) => {
        if (!onModelChange || controlsDisabled) return
        onModelChange(nextModel)
        setShowSettings(false)
        haptic('light')
    }, [onModelChange, controlsDisabled, haptic])

    const handleModelReasoningEffortChange = useCallback((nextModelReasoningEffort: string | null) => {
        if (!onModelReasoningEffortChange || controlsDisabled) return
        onModelReasoningEffortChange(nextModelReasoningEffort)
        setShowSettings(false)
        haptic('light')
    }, [onModelReasoningEffortChange, controlsDisabled, haptic])

    const handleEffortChange = useCallback((nextEffort: string | null) => {
        if (!onEffortChange || controlsDisabled) return
        onEffortChange(nextEffort)
        setShowSettings(false)
        haptic('light')
    }, [onEffortChange, controlsDisabled, haptic])

    const showCollaborationSettings = Boolean(onCollaborationModeChange && collaborationModeOptions.length > 0)
    const showPermissionSettings = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)
    const showModelSettings = Boolean(onModelChange && supportsModelChange(agentFlavor) && modelOptions.length > 0)
    const showModelReasoningEffortSettings = Boolean(onModelReasoningEffortChange && modelReasoningEffortOptions.length > 0)
    const showEffortSettings = Boolean(onEffortChange && supportsEffort(agentFlavor))
    const showSettingsButton = Boolean(
        showCollaborationSettings
        || showPermissionSettings
        || showModelSettings
        || showModelReasoningEffortSettings
        || showEffortSettings
    )
    const showAbortButton = true
    const voiceEnabled = Boolean(onVoiceToggle)
    const compactEffort = showEffortSettings ? effort : modelReasoningEffort
    const compactEffortOptions = showEffortSettings ? claudeEffortOptions : modelReasoningEffortOptions
    const compactEffortLabel = showEffortSettings ? 'misc.effort' : 'misc.reasoningEffort'
    const compactEffortHandler = showEffortSettings
        ? handleEffortChange
        : showModelReasoningEffortSettings
            ? handleModelReasoningEffortChange
            : undefined

    const handleSend = useCallback(() => {
        if (!canSend) return
        beginCompactSend()
        api.composer().send()
    }, [api, beginCompactSend, canSend])

    const overlays = useMemo(() => {
        if (showSettings && (showCollaborationSettings || showPermissionSettings || showModelSettings || showModelReasoningEffortSettings || showEffortSettings)) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
                        <SessionComposerSettingsPanel
                            controlsDisabled={controlsDisabled}
                            collaborationMode={collaborationMode}
                            permissionMode={permissionMode}
                            model={model}
                            modelReasoningEffort={modelReasoningEffort}
                            effort={effort}
                            showCollaborationSettings={showCollaborationSettings}
                            showPermissionSettings={showPermissionSettings}
                            showModelSettings={showModelSettings}
                            showModelReasoningEffortSettings={showModelReasoningEffortSettings}
                            showEffortSettings={showEffortSettings}
                            collaborationModeOptions={collaborationModeOptions}
                            permissionModeOptions={permissionModeOptions}
                            modelOptions={modelOptions}
                            modelReasoningEffortOptions={modelReasoningEffortOptions}
                            claudeEffortOptions={claudeEffortOptions}
                            onCollaborationModeChange={handleCollaborationChange}
                            onPermissionModeChange={handlePermissionChange}
                            onModelChange={handleModelChange}
                            onModelReasoningEffortChange={handleModelReasoningEffortChange}
                            onEffortChange={handleEffortChange}
                        />
                    </FloatingOverlay>
                </div>
            )
        }

        if (suggestions.length > 0) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay>
                        <Autocomplete
                            suggestions={suggestions}
                            selectedIndex={selectedIndex}
                            onSelect={(index) => handleSuggestionSelect(index)}
                        />
                    </FloatingOverlay>
                </div>
            )
        }

        return null
    }, [
        showSettings,
        showCollaborationSettings,
        showPermissionSettings,
        showModelSettings,
        showModelReasoningEffortSettings,
        showEffortSettings,
        modelOptions,
        modelReasoningEffortOptions,
        claudeEffortOptions,
        suggestions,
        selectedIndex,
        controlsDisabled,
        collaborationMode,
        permissionMode,
        model,
        modelReasoningEffort,
        effort,
        collaborationModeOptions,
        permissionModeOptions,
        handleCollaborationChange,
        handlePermissionChange,
        handleModelChange,
        handleModelReasoningEffortChange,
        handleEffortChange,
        handleSuggestionSelect,
        t
    ])

    const statusBar = (
        <StatusBar
            active={active}
            thinking={thinking}
            agentState={agentState}
            backgroundTaskCount={backgroundTaskCount}
            contextSize={contextSize}
            contextCacheRead={contextCacheRead}
            contextWindow={contextWindow}
            quotaFiveHour={quotaFiveHour}
            quotaSevenDay={quotaSevenDay}
            model={model}
            modelReasoningEffort={modelReasoningEffort}
            permissionMode={permissionMode}
            collaborationMode={collaborationMode}
            agentFlavor={agentFlavor}
            voiceStatus={voiceStatus}
            compactControls={compactComposerMode ? (
                <CompactRuntimeControls
                    disabled={controlsDisabled || isSwitching}
                    model={model}
                    modelOptions={showModelSettings ? modelOptions : []}
                    effort={compactEffort}
                    effortLabel={compactEffortLabel}
                    effortOptions={compactEffortHandler ? compactEffortOptions : []}
                    permissionMode={permissionMode}
                    permissionModeOptions={showPermissionSettings ? permissionModeOptions : []}
                    collaborationMode={collaborationMode}
                    collaborationModeOptions={collaborationModeOptions}
                    onModelChange={showModelSettings ? handleModelChange : undefined}
                    onEffortChange={compactEffortHandler}
                    onPermissionModeChange={showPermissionSettings ? handlePermissionChange : undefined}
                    onCollaborationModeChange={showCollaborationSettings ? handleCollaborationChange : undefined}
                    onCompactRuntimeChange={onCompactRuntimeChange}
                    onPendingChange={handleRuntimePendingChange}
                    changeBlocked={isRuntimeChangeBlocked}
                    onSwitchToRemote={showSwitchButton ? handleSwitch : undefined}
                    switchDisabled={switchDisabled || isRuntimeChanging}
                    isSwitching={isSwitching}
                />
            ) : undefined}
        />
    )

    return (
        <div className={`px-2 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)]`}>
            <div className="mx-auto w-full max-w-full">
                <ComposerPrimitive.Root className="relative" onSubmit={handleSubmit}>
                    {overlays}

                    {!compactComposerMode ? statusBar : null}

                    {compactComposerMode ? (
                        <>
                            <div
                                className="compact-composer"
                                data-multiline={composerMultiline ? 'true' : 'false'}
                                data-has-attachments={hasAttachments ? 'true' : 'false'}
                            >
                                {attachments.length > 0 ? (
                                    <div className="compact-composer__attachments">
                                        <ComposerPrimitive.Attachments components={{ Attachment: AttachmentItem }} />
                                    </div>
                                ) : null}

                                <div className="compact-composer__row">
                                    <CompactComposerAttachmentButton disabled={controlsDisabled} />
                                    <ComposerPrimitive.Input
                                        ref={textareaRef}
                                        autoFocus={!composerInputDisabled && !isTouch}
                                        placeholder={showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')}
                                        disabled={composerInputDisabled}
                                        maxRows={5}
                                        submitOnEnter={false}
                                        cancelOnEscape={false}
                                        onChange={handleChange}
                                        onSelect={handleSelect}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        className="compact-composer__input"
                                    />
                                    <CompactComposerActionButton
                                        canSend={canSend}
                                        running={threadIsRunning}
                                        isAborting={isAborting}
                                        disabled={threadIsRunning ? abortDisabled : undefined}
                                        onSend={handleSend}
                                        onAbort={handleAbort}
                                    />
                                </div>
                            </div>
                            {statusBar}
                        </>
                    ) : (
                        <div className="overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)]">
                            {attachments.length > 0 ? (
                                <div className="flex flex-wrap gap-2 px-4 pt-3">
                                    <ComposerPrimitive.Attachments components={{ Attachment: AttachmentItem }} />
                                </div>
                            ) : null}

                            <div className="flex items-center px-4 py-3">
                                <ComposerPrimitive.Input
                                    ref={textareaRef}
                                    autoFocus={!controlsDisabled && !isTouch}
                                    placeholder={showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')}
                                    disabled={controlsDisabled}
                                    maxRows={5}
                                    submitOnEnter={false}
                                    cancelOnEscape={false}
                                    onChange={handleChange}
                                    onSelect={handleSelect}
                                    onKeyDown={handleKeyDown}
                                    onPaste={handlePaste}
                                    className="flex-1 resize-none bg-transparent text-sm leading-snug text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>

                            <ComposerButtons
                                canSend={canSend}
                                controlsDisabled={controlsDisabled}
                                showSettingsButton={showSettingsButton}
                                onSettingsToggle={handleSettingsToggle}
                                showTerminalButton={showTerminalButton}
                                terminalDisabled={terminalDisabled}
                                terminalLabel={terminalLabel}
                                onTerminal={onTerminal ?? (() => {})}
                                showAbortButton={showAbortButton}
                                abortDisabled={abortDisabled}
                                isAborting={isAborting}
                                onAbort={handleAbort}
                                showSwitchButton={showSwitchButton}
                                switchDisabled={switchDisabled}
                                isSwitching={isSwitching}
                                onSwitch={handleSwitch}
                                voiceEnabled={voiceEnabled}
                                voiceStatus={voiceStatus}
                                voiceMicMuted={voiceMicMuted}
                                onVoiceToggle={onVoiceToggle ?? (() => {})}
                                onVoiceMicToggle={onVoiceMicToggle}
                                onSend={handleSend}
                            />
                        </div>
                    )}
                </ComposerPrimitive.Root>
            </div>
        </div>
    )
}
