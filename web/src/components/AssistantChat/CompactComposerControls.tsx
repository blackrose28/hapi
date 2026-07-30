import { ComposerPrimitive } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CodexCollaborationMode, PermissionMode } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'

const VALUE_PREFIX = 'hapi-value:'
const OPTIMISTIC_EXPIRY_MS = 1_500

function encodeValue(value: string | null): string {
    return `${VALUE_PREFIX}${JSON.stringify(value)}`
}

function decodeValue(value: string): string | null | undefined {
    if (!value.startsWith(VALUE_PREFIX)) return undefined
    try {
        const decoded: unknown = JSON.parse(value.slice(VALUE_PREFIX.length))
        return decoded === null || typeof decoded === 'string' ? decoded : undefined
    } catch {
        return undefined
    }
}

type ValueOption = {
    value: string | null
    label: string
}

type PermissionOption = {
    mode: PermissionMode
    label: string
}

type CollaborationOption = {
    mode: CodexCollaborationMode
    label: string
}

export type CompactRuntimeChange =
    | { type: 'model'; value: string | null }
    | { type: 'effort'; value: string | null }
    | { type: 'permission'; value: PermissionMode }
    | { type: 'collaboration'; value: CodexCollaborationMode }

type OptimisticSelection = {
    value: string | null
    source: string | null
    settled: boolean
    sequence: number
}

type OptimisticSelections = Partial<Record<'model' | 'effort' | 'mode', OptimisticSelection>>

function AttachmentIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
        </svg>
    )
}

function SendIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
        </svg>
    )
}

function StopIcon(props: { spinning: boolean }) {
    return (
        <svg className={props.spinning ? 'animate-spin' : undefined} width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {props.spinning ? (
                <>
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </>
            ) : (
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
            )}
        </svg>
    )
}

function SwitchToRemoteIcon(props: { spinning: boolean }) {
    if (props.spinning) {
        return (
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" opacity="0.25" />
                <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
            </svg>
        )
    }

    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="6" y="2.5" width="12" height="19" rx="2" />
            <path d="M9.5 12h5" />
            <path d="m12.5 9 3 3-3 3" />
        </svg>
    )
}

export function CompactComposerAttachmentButton(props: { disabled: boolean }) {
    const { t } = useTranslation()

    return (
        <ComposerPrimitive.AddAttachment
            aria-label={t('composer.attach')}
            title={t('composer.attach')}
            disabled={props.disabled}
            className="compact-composer__attachment"
        >
            <AttachmentIcon />
        </ComposerPrimitive.AddAttachment>
    )
}

export function CompactComposerActionButton(props: {
    canSend: boolean
    running: boolean
    isAborting: boolean
    disabled?: boolean
    onSend: () => void
    onAbort: () => void
}) {
    const { t } = useTranslation()
    const state = props.running ? 'running' : props.canSend ? 'ready' : 'idle'
    const label = props.running ? t('composer.stop') : t('composer.send')
    const disabled = props.disabled || props.isAborting || (!props.running && !props.canSend)

    return (
        <button
            type="button"
            className="compact-composer__action"
            data-state={state}
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={props.running ? props.onAbort : props.onSend}
        >
            {props.running
                ? <StopIcon spinning={props.isAborting} />
                : <SendIcon />}
        </button>
    )
}

function ValueSelect(props: {
    label: string
    value: string | null
    options: ValueOption[]
    disabled: boolean
    busy: boolean
    onChange: (value: string | null) => void
}) {
    const options = props.options.some((option) => option.value === props.value)
        ? props.options
        : [{ value: props.value, label: props.value ?? 'Default' }, ...props.options]
    const uniqueOptions = options.filter((option, index) =>
        options.findIndex((candidate) => encodeValue(candidate.value) === encodeValue(option.value)) === index
    )

    return (
        <label className="compact-runtime-controls__field" title={props.label}>
            <span className="sr-only">{props.label}</span>
            <select
                aria-label={props.label}
                aria-busy={props.busy ? 'true' : undefined}
                value={encodeValue(props.value)}
                disabled={props.disabled}
                onChange={(event) => {
                    if (!uniqueOptions.some((option) => encodeValue(option.value) === event.target.value)) return
                    const value = decodeValue(event.target.value)
                    if (value !== undefined) props.onChange(value)
                }}
            >
                {uniqueOptions.map((option) => (
                    <option key={encodeValue(option.value)} value={encodeValue(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    )
}

export function CompactRuntimeControls(props: {
    disabled: boolean
    model: string | null
    modelOptions: ValueOption[]
    effort: string | null
    effortLabel: string
    effortOptions: ValueOption[]
    permissionMode: PermissionMode
    permissionModeOptions: PermissionOption[]
    collaborationMode?: CodexCollaborationMode
    collaborationModeOptions?: CollaborationOption[]
    onModelChange?: (model: string | null) => void | Promise<void>
    onEffortChange?: (effort: string | null) => void | Promise<void>
    onPermissionModeChange?: (mode: PermissionMode) => void | Promise<void>
    onCollaborationModeChange?: (mode: CodexCollaborationMode) => void | Promise<void>
    onCompactRuntimeChange?: (change: CompactRuntimeChange) => Promise<void>
    onPendingChange?: (pending: boolean) => void
    changeBlocked?: () => boolean
    onSwitchToRemote?: () => void
    switchDisabled?: boolean
    isSwitching?: boolean
}) {
    const { t } = useTranslation()
    const [pending, setPending] = useState(false)
    const [optimistic, setOptimistic] = useState<OptimisticSelections>({})
    const pendingRef = useRef(false)
    const changeSequenceRef = useRef(0)
    const showModel = Boolean(props.onModelChange && props.modelOptions.length > 0)
    const showEffort = Boolean(props.onEffortChange && props.effortOptions.length > 0)
    const currentCollaborationMode = props.collaborationMode ?? 'default'
    const collaborationActive = currentCollaborationMode !== 'default'
    const authoritativeMode = collaborationActive
        ? `collaboration:${currentCollaborationMode}`
        : `permission:${props.permissionMode}`

    const modeOptions = useMemo(() => {
        const permissionOptions = collaborationActive && !props.onCollaborationModeChange
            ? []
            : props.onPermissionModeChange
                ? props.permissionModeOptions
                : props.permissionModeOptions.filter((option) => option.mode === props.permissionMode)
        const collaborationOptions = props.onCollaborationModeChange
            ? (props.collaborationModeOptions ?? []).filter((option) => option.mode !== 'default')
            : collaborationActive
                ? (props.collaborationModeOptions ?? []).filter((option) => option.mode === currentCollaborationMode)
                : []
        const options = [
            ...permissionOptions.map((option) => ({
                value: `permission:${option.mode}`,
                label: option.label,
                kind: 'permission' as const,
                mode: option.mode
            })),
            ...collaborationOptions.map((option) => ({
                value: `collaboration:${option.mode}`,
                label: option.label,
                kind: 'collaboration' as const,
                mode: option.mode
            }))
        ]

        if (!options.some((option) => option.value === authoritativeMode)) {
            const label = collaborationActive
                ? (props.collaborationModeOptions ?? []).find((option) => option.mode === currentCollaborationMode)?.label
                    ?? currentCollaborationMode
                : props.permissionModeOptions.find((option) => option.mode === props.permissionMode)?.label
                    ?? props.permissionMode
            options.unshift(collaborationActive
                ? {
                    value: authoritativeMode,
                    label,
                    kind: 'collaboration' as const,
                    mode: currentCollaborationMode
                }
                : {
                    value: authoritativeMode,
                    label,
                    kind: 'permission' as const,
                    mode: props.permissionMode
                })
        }

        return options.filter((option, index) =>
            options.findIndex((candidate) => candidate.value === option.value) === index
        )
    }, [
        authoritativeMode,
        collaborationActive,
        currentCollaborationMode,
        props.collaborationModeOptions,
        props.onCollaborationModeChange,
        props.onPermissionModeChange,
        props.permissionMode,
        props.permissionModeOptions
    ])
    const showMode = Boolean(
        props.onPermissionModeChange
        || props.onCollaborationModeChange
    )
    const showSwitch = Boolean(props.onSwitchToRemote)
    const selectedModel = optimistic.model ? optimistic.model.value : props.model
    const selectedEffort = optimistic.effort ? optimistic.effort.value : props.effort
    const selectedMode = optimistic.mode ? optimistic.mode.value ?? authoritativeMode : authoritativeMode
    const selectorCount = Number(showModel) + Number(showEffort) + Number(showMode)
    const selectorsDisabled = props.disabled || pending
    const canChangeMode = modeOptions.some((option) => option.value !== selectedMode)

    useEffect(() => {
        const selection = optimistic.model
        if (!selection) return
        if (props.model === selection.value || (selection.settled && props.model !== selection.source)) {
            setOptimistic((current) => {
                if (current.model?.sequence !== selection.sequence) return current
                const { model: _model, ...rest } = current
                return rest
            })
            return
        }
        if (!selection.settled) return
        const timeout = window.setTimeout(() => {
            setOptimistic((current) => {
                if (current.model?.sequence !== selection.sequence) return current
                const { model: _model, ...rest } = current
                return rest
            })
        }, OPTIMISTIC_EXPIRY_MS)
        return () => window.clearTimeout(timeout)
    }, [optimistic.model, props.model])

    useEffect(() => {
        const selection = optimistic.effort
        if (!selection) return
        if (props.effort === selection.value || (selection.settled && props.effort !== selection.source)) {
            setOptimistic((current) => {
                if (current.effort?.sequence !== selection.sequence) return current
                const { effort: _effort, ...rest } = current
                return rest
            })
            return
        }
        if (!selection.settled) return
        const timeout = window.setTimeout(() => {
            setOptimistic((current) => {
                if (current.effort?.sequence !== selection.sequence) return current
                const { effort: _effort, ...rest } = current
                return rest
            })
        }, OPTIMISTIC_EXPIRY_MS)
        return () => window.clearTimeout(timeout)
    }, [optimistic.effort, props.effort])

    useEffect(() => {
        const selection = optimistic.mode
        if (!selection) return
        if (authoritativeMode === selection.value || (selection.settled && authoritativeMode !== selection.source)) {
            setOptimistic((current) => {
                if (current.mode?.sequence !== selection.sequence) return current
                const { mode: _mode, ...rest } = current
                return rest
            })
            return
        }
        if (!selection.settled) return
        const timeout = window.setTimeout(() => {
            setOptimistic((current) => {
                if (current.mode?.sequence !== selection.sequence) return current
                const { mode: _mode, ...rest } = current
                return rest
            })
        }, OPTIMISTIC_EXPIRY_MS)
        return () => window.clearTimeout(timeout)
    }, [authoritativeMode, optimistic.mode])

    const runChange = (
        control: keyof OptimisticSelections,
        source: string | null,
        value: string | null,
        operation: () => void | Promise<void>
    ) => {
        if (props.disabled || props.changeBlocked?.() || pendingRef.current) return

        const sequence = ++changeSequenceRef.current
        pendingRef.current = true
        setPending(true)
        props.onPendingChange?.(true)
        setOptimistic((current) => ({
            ...current,
            [control]: { value, source, settled: false, sequence }
        }))
        void (async () => {
            try {
                await operation()
                setOptimistic((current) => {
                    const selection = current[control]
                    if (selection?.sequence !== sequence) return current
                    return {
                        ...current,
                        [control]: { ...selection, settled: true }
                    }
                })
            } catch {
                setOptimistic((current) => {
                    if (current[control]?.sequence !== sequence) return current
                    const next = { ...current }
                    delete next[control]
                    return next
                })
            } finally {
                pendingRef.current = false
                setPending(false)
                props.onPendingChange?.(false)
            }
        })()
    }

    const handleModelChange = (model: string | null) => {
        runChange('model', props.model, model, () =>
            props.onCompactRuntimeChange
                ? props.onCompactRuntimeChange({ type: 'model', value: model })
                : props.onModelChange?.(model)
        )
    }

    const handleEffortChange = (effort: string | null) => {
        runChange('effort', props.effort, effort, () =>
            props.onCompactRuntimeChange
                ? props.onCompactRuntimeChange({ type: 'effort', value: effort })
                : props.onEffortChange?.(effort)
        )
    }

    const handleModeChange = (value: string) => {
        const option = modeOptions.find((candidate) => candidate.value === value)
        if (!option) return

        runChange('mode', authoritativeMode, value, async () => {
            if (option.kind === 'collaboration') {
                if (props.onCompactRuntimeChange) {
                    await props.onCompactRuntimeChange({ type: 'collaboration', value: option.mode })
                } else {
                    await props.onCollaborationModeChange?.(option.mode)
                }
                return
            }

            if (props.onCompactRuntimeChange) {
                await props.onCompactRuntimeChange({ type: 'permission', value: option.mode })
                return
            }

            if (collaborationActive) {
                await props.onCollaborationModeChange?.('default')
            }
            if (!props.onPermissionModeChange) return
            await props.onPermissionModeChange(option.mode)
        })
    }

    if (!showModel && !showEffort && !showMode && !showSwitch) return null

    return (
        <div className="compact-runtime-controls">
            {showSwitch && props.onSwitchToRemote ? (
                <button
                    type="button"
                    className="compact-runtime-controls__switch"
                    aria-label={t('composer.switchRemote')}
                    title={t('composer.switchRemote')}
                    disabled={props.switchDisabled || props.isSwitching || pending}
                    aria-busy={props.isSwitching ? 'true' : undefined}
                    onClick={props.onSwitchToRemote}
                >
                    <SwitchToRemoteIcon spinning={props.isSwitching === true} />
                </button>
            ) : null}

            {selectorCount > 0 ? (
                <div
                    className="compact-runtime-controls__selectors"
                    data-control-count={selectorCount}
                    aria-busy={pending ? 'true' : undefined}
                    style={{ '--compact-runtime-control-count': selectorCount } as CSSProperties}
                >
                    {showModel && props.onModelChange ? (
                        <ValueSelect
                            label={t('misc.model')}
                            value={selectedModel}
                            options={props.modelOptions}
                            disabled={selectorsDisabled}
                            busy={pending}
                            onChange={handleModelChange}
                        />
                    ) : null}

                    {showEffort && props.onEffortChange ? (
                        <ValueSelect
                            label={t(props.effortLabel)}
                            value={selectedEffort}
                            options={props.effortOptions}
                            disabled={selectorsDisabled}
                            busy={pending}
                            onChange={handleEffortChange}
                        />
                    ) : null}

                    {showMode ? (
                        <label className="compact-runtime-controls__field" title={t('misc.sessionMode')}>
                            <span className="sr-only">{t('misc.sessionMode')}</span>
                            <select
                                aria-label={t('misc.sessionMode')}
                                aria-busy={pending ? 'true' : undefined}
                                value={selectedMode}
                                disabled={selectorsDisabled || !canChangeMode}
                                onChange={(event) => handleModeChange(event.target.value)}
                            >
                                {modeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
