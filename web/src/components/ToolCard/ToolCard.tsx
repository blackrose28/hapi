import type { ToolCallBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { memo, useId, useMemo, useState, type ReactNode } from 'react'
import { isObject, safeStringify } from '@hapi/protocol'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { DiffView } from '@/components/DiffView'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PermissionFooter } from '@/components/ToolCard/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/ToolCard/AskUserQuestionFooter'
import { RequestUserInputFooter } from '@/components/ToolCard/RequestUserInputFooter'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import {
    extractTodoChecklist,
    extractUpdatePlanChecklist,
    getChecklistProgress
} from '@/components/ToolCard/checklist'
import { getToolFullViewComponent, getToolViewComponent } from '@/components/ToolCard/views/_all'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { formatTaskChildLabel, TaskStateIcon } from '@/components/ToolCard/helpers'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { getInputString, getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { TraceSection } from '@/components/ToolCard/trace'
import { LockIcon } from '@/components/ToolCard/icons'
import { getActivityDurationMs, getToolExpansionKind } from '@/components/ToolCard/toolRunModel'
import {
    useActivityClock,
    useFormattedActivityDuration,
    useToolRunLayout
} from '@/components/ToolCard/toolRunContext'

const SURFACE_CLASS = {
    neutral: '[--processing-surface-tint:var(--app-tool-neutral-surface)] border-[var(--app-border)]',
    plan: '[--processing-surface-tint:var(--app-tool-plan-surface)] border-[var(--app-tool-plan-border)]',
    diff: '[--processing-surface-tint:var(--app-tool-diff-surface)] border-[var(--app-tool-diff-border)]',
    question: '[--processing-surface-tint:var(--app-tool-question-surface)] border-[var(--app-tool-question-border)]',
    permission: '[--processing-surface-tint:var(--app-tool-attention-bg)] border-[var(--app-tool-attention-border)]',
    error: '[--processing-surface-tint:var(--app-badge-error-bg)] border-[var(--app-badge-error-border)]'
} as const

const ORB_CLASS = {
    neutral: 'bg-[var(--app-tool-neutral-surface)] text-[var(--app-tool-neutral-accent)]',
    plan: 'bg-[var(--app-tool-plan-surface)] text-[var(--app-tool-plan-accent)]',
    diff: 'bg-[var(--app-tool-diff-surface)] text-[var(--app-tool-diff-accent)]',
    question: 'bg-[var(--app-tool-question-surface)] text-[var(--app-tool-question-accent)]',
    permission: 'bg-[var(--app-tool-attention-bg)] text-[var(--app-tool-attention-accent)]',
    error: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
} as const

function getTaskSummaryChildren(block: ToolCallBlock): { visible: ToolCallBlock[]; remaining: number } | null {
    if (block.tool.name !== 'Task') return null

    const children = block.children
        .filter((child): child is ToolCallBlock => child.kind === 'tool-call')
        .filter((child) => child.tool.state === 'pending' || child.tool.state === 'running' || child.tool.state === 'completed' || child.tool.state === 'error')

    if (children.length === 0) return null

    const visible = children.slice(-3)
    return { visible, remaining: children.length - visible.length }
}

function renderTaskSummary(
    block: ToolCallBlock,
    metadata: SessionMetadataSummary | null,
    t: (key: string, params?: Record<string, string | number>) => string
): ReactNode | null {
    const summary = getTaskSummaryChildren(block)
    if (!summary) return null

    const visible = summary.visible
    const remaining = summary.remaining

    return (
        <div className="flex flex-col gap-1 px-1">
            <div className="flex flex-col gap-1">
                {visible.map((child) => (
                    <div key={child.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 font-mono text-xs text-[var(--app-hint)]">
                            <span className="mr-2 inline-block w-4 text-center align-middle">
                                <TaskStateIcon state={child.tool.state} />
                            </span>
                            <span className="align-middle break-all">
                                {formatTaskChildLabel(child, metadata, t)}
                            </span>
                        </div>
                    </div>
                ))}
                {remaining > 0 ? (
                    <div className="text-xs text-[var(--app-hint)] italic">
                        (+{remaining} more)
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function renderEditInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
    const oldString = getInputString(input, 'old_string')
    const newString = getInputString(input, 'new_string')
    if (oldString === null || newString === null) return null

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath}
        />
    )
}

function renderExitPlanModeInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const plan = getInputString(input, 'plan')
    if (!plan) return null
    return <MarkdownRenderer content={plan} />
}

function renderToolInput(block: ToolCallBlock, surface: 'inline' | 'dialog' = 'inline'): ReactNode {
    const collapseLongContent = surface === 'inline'
    const toolName = block.tool.name
    const input = block.tool.input

    if (toolName === 'Task' && isObject(input) && typeof input.prompt === 'string') {
        return <MarkdownRenderer content={input.prompt} />
    }

    if (toolName === 'Edit') {
        const diff = renderEditInput(input)
        if (diff) return diff
    }

    if (toolName === 'MultiEdit' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
        const edits = Array.isArray(input.edits) ? input.edits : null
        if (edits && edits.length > 0) {
            const rendered = edits
                .slice(0, 3)
                .map((edit, idx) => {
                    if (!isObject(edit)) return null
                    const oldString = getInputString(edit, 'old_string')
                    const newString = getInputString(edit, 'new_string')
                    if (oldString === null || newString === null) return null
                    return (
                        <div key={idx}>
                            <DiffView oldString={oldString} newString={newString} filePath={filePath} />
                        </div>
                    )
                })
                .filter(Boolean)

            if (rendered.length > 0) {
                return (
                    <div className="flex flex-col gap-2">
                        {rendered}
                        {edits.length > 3 ? (
                            <div className="text-xs text-[var(--app-hint)]">
                                (+{edits.length - 3} more edits)
                            </div>
                        ) : null}
                    </div>
                )
            }
        }
    }

    if (toolName === 'Write' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const content = getInputStringAny(input, ['content', 'text'])
        if (filePath && content !== null) {
            return (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" collapseLongContent={collapseLongContent} />
                </div>
            )
        }
    }

    if (toolName === 'CodexDiff' && isObject(input) && typeof input.unified_diff === 'string') {
        return <CodeBlock code={input.unified_diff} language="diff" collapseLongContent={collapseLongContent} />
    }

    if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode') {
        const plan = renderExitPlanModeInput(input)
        if (plan) return plan
    }

    const commandArray = isObject(input) && Array.isArray(input.command) ? input.command : null
    if ((toolName === 'CodexBash' || toolName === 'Bash') && (typeof commandArray?.[0] === 'string' || typeof input === 'object')) {
        const cmd = Array.isArray(commandArray)
            ? commandArray.filter((part) => typeof part === 'string').join(' ')
            : getInputStringAny(input, ['command', 'cmd'])
        if (cmd) {
            return <CodeBlock code={cmd} language="bash" collapseLongContent={collapseLongContent} />
        }
    }

    return <CodeBlock code={safeStringify(input)} language="json" collapseLongContent={collapseLongContent} />
}

function StatusIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )
    }
    if (props.state === 'error') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    if (props.state === 'pending') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <rect x="4.5" y="7" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 7V5.8a2 2 0 0 1 4 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    return (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}

function statusColorClass(state: ToolCallBlock['tool']['state']): string {
    if (state === 'completed') return 'text-emerald-600'
    if (state === 'error') return 'text-red-600'
    if (state === 'pending') return 'text-amber-600'
    return 'text-[var(--app-hint)]'
}

function DetailsIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
    displayMode?: 'card' | 'group-row'
}

function ToolCardInner(props: ToolCardProps) {
    const { t } = useTranslation()
    const layout = useToolRunLayout()
    const displayMode = props.displayMode ?? 'card'
    const standaloneRunning = !layout.grouped
        && (props.block.tool.state === 'pending' || props.block.tool.state === 'running')
    const standaloneNow = useActivityClock(standaloneRunning)
    const expansionKind = displayMode === 'group-row'
        ? getToolExpansionKind(props.block)
        : null
    const [outputOpen, setOutputOpen] = useState(false)
    const outputId = useId()
    const titleId = useId()
    const subtitleId = useId()
    const stateId = useId()
    const permissionId = useId()
    const durationId = useId()
    const durationDescriptionId = useId()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata,
        t
    }), [
        props.block.tool.name,
        props.block.tool.input,
        props.block.tool.result,
        props.block.children.length,
        props.block.tool.description,
        props.metadata,
        t
    ])

    const toolName = props.block.tool.name
    const planItems = toolName === 'update_plan'
        ? extractUpdatePlanChecklist(props.block.tool.input, props.block.tool.result)
        : toolName === 'TodoWrite'
            ? extractTodoChecklist(props.block.tool.input, props.block.tool.result)
            : []
    const planProgress = planItems.length > 0 ? getChecklistProgress(planItems) : null
    const toolTitle = presentation.title
    const subtitle = presentation.subtitle ?? props.block.tool.description
    const taskSummary = renderTaskSummary(props.block, props.metadata, t)
    const showInline = !presentation.minimal && toolName !== 'Task'
    const CompactToolView = showInline ? getToolViewComponent(toolName) : null
    const FullToolView = getToolFullViewComponent(toolName)
    const ResultToolView = getToolResultViewComponent(toolName)
    const permission = props.block.tool.permission
    const isAskUserQuestion = isAskUserQuestionToolName(toolName)
    const isRequestUserInput = isRequestUserInputToolName(toolName)
    const isQuestionTool = isAskUserQuestion || isRequestUserInput
    const permissionIsStale = props.block.tool.state === 'error'
    const hasActionablePendingPermission = permission?.status === 'pending' && !permissionIsStale
    const hasPendingApproval = hasActionablePendingPermission && !isQuestionTool
    const surfaceTone = props.block.tool.state === 'error'
        ? 'error'
        : hasPendingApproval
            ? 'permission'
            : isQuestionTool
                ? 'question'
                : presentation.tone
    const actionLabel = surfaceTone === 'plan'
        ? t('tool.openPlan')
        : surfaceTone === 'diff'
            ? t('tool.reviewDiff')
            : t('tool.details')
    const showsPermissionFooter = !permissionIsStale && Boolean(permission && (
        permission.status === 'pending'
        || ((permission.status === 'denied' || permission.status === 'canceled') && Boolean(permission.reason))
    ))
    const hasBody = showInline || taskSummary !== null || showsPermissionFooter
    const stateColor = statusColorClass(props.block.tool.state)
    const activityDurationMs = getActivityDurationMs(
        { kind: 'tool', block: props.block },
        layout.grouped ? layout.now : standaloneNow
    )
    const activityDuration = useFormattedActivityDuration(activityDurationMs)
    const stateLabel = t(`tool.status.${props.block.tool.state}`)
    const durationLabel = activityDuration
        ? t('tool.group.activityDuration', { duration: activityDuration.accessible })
        : null
    const triggerLabelledBy = [
        hasPendingApproval ? permissionId : null,
        titleId,
        stateId
    ].filter(Boolean).join(' ')
    const triggerDescribedBy = [
        subtitle ? subtitleId : null,
        durationLabel ? durationDescriptionId : null
    ].filter(Boolean).join(' ') || undefined
    const { suppressFocusRing, onTriggerPointerDown, onTriggerKeyDown, onTriggerBlur } = usePointerFocusRing()
    const isQuestionToolWithAnswers = Boolean(
        isQuestionTool
        && permission?.answers
        && Object.keys(permission.answers).length > 0
    )

    const detailsDialog = (
        <DialogContent
            className="max-w-2xl"
            aria-describedby={undefined}
            closeLabel={t('button.close')}
        >
            <DialogHeader>
                <DialogTitle>{toolTitle}</DialogTitle>
            </DialogHeader>
            <div className="mt-3 flex max-h-[75vh] flex-col gap-4 overflow-auto">
                <div>
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                        {isQuestionToolWithAnswers
                            ? t('tool.questionsAnswers')
                            : t('tool.input')}
                    </div>
                    {FullToolView ? (
                        <FullToolView
                            block={props.block}
                            metadata={props.metadata}
                            surface="dialog"
                            t={t}
                        />
                    ) : (
                        renderToolInput(props.block, 'dialog')
                    )}
                </div>
                <TraceSection block={props.block} metadata={props.metadata} />
                {!isQuestionToolWithAnswers ? (
                    <div>
                        <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                            {t('tool.result')}
                        </div>
                        <ResultToolView
                            block={props.block}
                            metadata={props.metadata}
                            surface="dialog"
                            t={t}
                        />
                    </div>
                ) : null}
            </div>
        </DialogContent>
    )

    if (displayMode === 'group-row') {
        return (
            <div
                data-tool-display="group-row"
                data-tool-block-id={props.block.id}
                className="w-full min-w-0"
            >
                <div
                    data-running={props.block.tool.state === 'pending' || props.block.tool.state === 'running' ? 'true' : 'false'}
                    className="activity-row flex min-h-[37px] w-full min-w-0 items-center gap-1 rounded-[11px]"
                >
                    <Dialog>
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className="flex min-h-[37px] min-w-0 flex-1 items-center gap-2 rounded-[11px] px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                <span
                                    aria-hidden="true"
                                    className="activity-orb grid h-[25px] w-[25px] shrink-0 place-items-center rounded-full bg-[var(--app-tool-neutral-surface)] text-[var(--app-tool-neutral-accent)]"
                                >
                                    {presentation.icon}
                                </span>
                                <span className="shrink-0 text-xs font-medium">
                                    {toolTitle}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--app-hint)]">
                                    {subtitle}
                                </span>
                                {activityDuration ? (
                                    <span
                                        aria-label={t('tool.group.activityDuration', {
                                            duration: activityDuration.accessible
                                        })}
                                        className="shrink-0 font-mono text-[10px] text-[var(--app-hint)]"
                                    >
                                        {activityDuration.compact}
                                    </span>
                                ) : null}
                                <span role="status" aria-label={stateLabel} className={stateColor}>
                                    <StatusIcon state={props.block.tool.state} />
                                </span>
                            </button>
                        </DialogTrigger>
                        {detailsDialog}
                    </Dialog>
                    {expansionKind ? (
                        <button
                            type="button"
                            aria-expanded={outputOpen}
                            aria-controls={outputId}
                            aria-label={t(outputOpen ? 'tool.group.hideOutput' : 'tool.group.showOutput')}
                            onClick={() => setOutputOpen((value) => !value)}
                            className="grid min-h-10 min-w-10 shrink-0 place-items-center rounded-md text-[var(--app-hint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        >
                            <DetailsIcon />
                        </button>
                    ) : null}
                </div>
                {toolName === 'CodexPatch' && FullToolView ? (
                    <div data-tool-patch-files className="px-7 pb-1 text-xs text-[var(--app-hint)]">
                        <FullToolView
                            block={props.block}
                            metadata={props.metadata}
                            surface="inline"
                            t={t}
                        />
                    </div>
                ) : null}
                {expansionKind ? (
                    <div
                        id={outputId}
                        hidden={!outputOpen}
                        role="region"
                        aria-label={t('tool.group.outputRegion', { tool: toolTitle })}
                        data-tool-inline-output
                        className="w-full min-w-0 max-h-[300px] overflow-auto overscroll-contain"
                    >
                        {outputOpen ? (
                            expansionKind === 'input' && FullToolView ? (
                                <FullToolView
                                    block={props.block}
                                    metadata={props.metadata}
                                    surface="group-output"
                                    t={t}
                                />
                            ) : (
                                <ResultToolView
                                    block={props.block}
                                    metadata={props.metadata}
                                    surface="group-output"
                                    t={t}
                                />
                            )
                        ) : null}
                    </div>
                ) : null}
            </div>
        )
    }

    const header = (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                    <div
                        aria-hidden="true"
                        className={cn(
                            'processing-card__orb grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full leading-none',
                            ORB_CLASS[surfaceTone]
                        )}
                    >
                        {hasPendingApproval ? (
                            <span aria-hidden="true">
                                <LockIcon className="h-3.5 w-3.5" />
                            </span>
                        ) : presentation.icon}
                    </div>
                    <div className="min-w-0">
                        {hasPendingApproval ? (
                            <div id={permissionId} className="text-xs font-semibold text-[var(--app-tool-attention-accent)]">
                                {t('tool.permissionRequired')}
                            </div>
                        ) : null}
                        <div className="flex min-w-0 flex-col items-start gap-0.5">
                            <CardTitle id={titleId} className="w-full min-w-0 truncate text-sm font-medium leading-tight">
                                {toolTitle}
                            </CardTitle>
                            {subtitle ? (
                                <CardDescription id={subtitleId} className="w-full min-w-0 truncate font-mono text-xs leading-tight opacity-80">
                                    {truncate(subtitle, 160)}
                                </CardDescription>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {planProgress ? (
                        <span
                            aria-label={t('tool.stepsProgress', {
                                completed: planProgress.completed,
                                total: planProgress.total
                            })}
                            className="shrink-0 font-mono text-[11px] text-[var(--app-tool-plan-accent)]"
                        >
                            {planProgress.percent}% · {planProgress.completed}/{planProgress.total}
                        </span>
                    ) : null}
                    {activityDuration && durationLabel ? (
                        <>
                            <span
                                id={durationId}
                                aria-label={durationLabel}
                                className="shrink-0 font-mono text-[11px] text-[var(--app-hint)]"
                            >
                                {activityDuration.compact}
                            </span>
                            <span id={durationDescriptionId} className="sr-only">
                                {durationLabel}
                            </span>
                        </>
                    ) : null}
                    <span aria-hidden="true" className={stateColor}>
                        <StatusIcon state={props.block.tool.state} />
                    </span>
                    <span id={stateId} className="sr-only">{stateLabel}</span>
                    <span className={cn(
                        'text-xs font-medium',
                        surfaceTone === 'plan' && 'text-[var(--app-tool-plan-accent)]',
                        surfaceTone === 'diff' && 'text-[var(--app-tool-diff-accent)]',
                        surfaceTone !== 'plan' && surfaceTone !== 'diff' && 'sr-only'
                    )}>
                        {actionLabel}
                    </span>
                    <span aria-hidden="true" className="text-[var(--app-hint)]">
                        <DetailsIcon />
                    </span>
                </div>
            </div>
        </div>
    )

    return (
        <Card
            data-tool-surface={surfaceTone}
            data-tool-block-id={props.block.id}
            className={cn(
                'processing-card processing-surface w-full max-w-[600px] overflow-hidden rounded-[15px] border bg-[var(--app-secondary-bg)] shadow-none',
                props.block.tool.state === 'running' && 'processing-surface--running',
                SURFACE_CLASS[surfaceTone]
            )}
        >
            <CardHeader className="p-0 space-y-0">
                <Dialog>
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            data-tool-card-trigger
                            aria-labelledby={triggerLabelledBy}
                            aria-describedby={triggerDescribedBy}
                            className={cn(
                                'min-h-[50px] w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                suppressFocusRing && 'focus-visible:ring-0'
                            )}
                            onPointerDown={onTriggerPointerDown}
                            onKeyDown={onTriggerKeyDown}
                            onBlur={onTriggerBlur}
                        >
                            {header}
                        </button>
                    </DialogTrigger>
                    {detailsDialog}
                </Dialog>
            </CardHeader>

            {hasBody ? (
                <CardContent className="px-3 pb-3 pt-0">
                    {taskSummary ? (
                        <div className="mt-2">
                            {taskSummary}
                        </div>
                    ) : null}

                    {showInline ? (
                        CompactToolView ? (
                            <div className="mt-3">
                                <CompactToolView block={props.block} metadata={props.metadata} surface="inline" t={t} />
                            </div>
                        ) : (
                            <div className="mt-3 flex flex-col gap-3">
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.input')}</div>
                                    {renderToolInput(props.block, 'inline')}
                                </div>
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} surface="inline" t={t} />
                                </div>
                            </div>
                        )
                    ) : null}

                    {showsPermissionFooter && isAskUserQuestion && hasActionablePendingPermission ? (
                        <AskUserQuestionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : showsPermissionFooter && isRequestUserInput && hasActionablePendingPermission ? (
                        <RequestUserInputFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : showsPermissionFooter ? (
                        <PermissionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            metadata={props.metadata}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : null}
                </CardContent>
            ) : null}
        </Card>
    )
}

export const ToolCard = memo(ToolCardInner)
