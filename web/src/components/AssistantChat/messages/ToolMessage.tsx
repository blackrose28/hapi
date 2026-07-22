import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { ToolCallBlock } from '@/chat/types'
import { safeStringify } from '@hapi/protocol'
import { getEventPresentation } from '@/chat/presentation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import {
    getActivityDurationMs,
    isGroupableToolBlock,
    isToolCallBlock
} from '@/components/ToolCard/toolRunModel'
import {
    useActivityClock,
    useFormattedActivityDuration,
    useToolRunLayout
} from '@/components/ToolCard/toolRunContext'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { ReasoningDisclosure } from '@/components/assistant-ui/reasoning'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function splitTaskChildren(block: ToolCallBlock): { pending: ChatBlock[]; rest: ChatBlock[] } {
    const pending: ChatBlock[] = []
    const rest: ChatBlock[] = []

    for (const child of block.children) {
        if (isPendingPermissionBlock(child)) {
            pending.push(child)
        } else {
            rest.push(child)
        }
    }

    return { pending, rest }
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
}) {
    const ctx = useHappyChatContext()

    return (
        <div className="flex flex-col gap-3">
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const userBubbleClass = 'w-fit max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined

                    return (
                        <div key={`user:${block.id}`} className={userBubbleClass}>
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <LazyRainbowText text={block.text} />
                                </div>
                                {status ? (
                                    <div className="shrink-0 self-end pb-0.5">
                                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={`agent:${block.id}`} className="px-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    const presentation = getEventPresentation(block.event)
                    return (
                        <div key={`event:${block.id}`} className="py-1">
                            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    const isTask = block.tool.name === 'Task'
                    const taskChildren = isTask ? splitTaskChildren(block) : null

                    return (
                        <div key={`tool:${block.id}`} className="py-1">
                            <ToolCard
                                api={ctx.api}
                                sessionId={ctx.sessionId}
                                metadata={ctx.metadata}
                                disabled={ctx.disabled}
                                onDone={ctx.onRefresh}
                                block={block}
                            />
                            {block.children.length > 0 ? (
                                isTask ? (
                                    <>
                                        {taskChildren && taskChildren.pending.length > 0 ? (
                                            <div className="mt-2 pl-3">
                                                <HappyNestedBlockList blocks={taskChildren.pending} />
                                            </div>
                                        ) : null}
                                        {taskChildren && taskChildren.rest.length > 0 ? (
                                            <details className="mt-2">
                                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                                    Task details ({taskChildren.rest.length})
                                                </summary>
                                                <div className="mt-2 pl-3">
                                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                                </div>
                                            </details>
                                        ) : null}
                                    </>
                                ) : (
                                    <div className="mt-2 pl-3">
                                        <HappyNestedBlockList blocks={block.children} />
                                    </div>
                                )
                            ) : null}
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const layout = useToolRunLayout()
    const grouped = layout.grouped
    const artifact = props.artifact
    const standaloneCodexRunning = !grouped
        && isToolCallBlock(artifact)
        && artifact.tool.name === 'CodexReasoning'
        && (artifact.tool.state === 'pending' || artifact.tool.state === 'running')
    const standaloneNow = useActivityClock(standaloneCodexRunning)
    const codexDurationMs = isToolCallBlock(artifact) && artifact.tool.name === 'CodexReasoning'
        ? getActivityDurationMs(
            { kind: 'tool', block: artifact },
            grouped ? layout.now : standaloneNow
        )
        : null
    const codexDuration = useFormattedActivityDuration(codexDurationMs)

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className={cn(!grouped && 'py-1', 'min-w-0 max-w-full overflow-x-hidden')}>
                <div className="rounded-xl bg-[var(--app-secondary-bg)] p-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="font-mono text-[var(--app-hint)]">
                            Tool: {props.toolName}
                        </div>
                        {props.isError ? (
                            <span className="text-red-500">Error</span>
                        ) : null}
                        {props.status.type === 'running' && !hasResult ? (
                            <span className="text-[var(--app-hint)]">Running…</span>
                        ) : null}
                    </div>

                    {hasArgsText ? (
                        <div className="mt-2">
                            <CodeBlock code={argsText} language="json" />
                        </div>
                    ) : null}

                    {hasResult ? (
                        <div className="mt-2">
                            <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    const block = artifact
    const isCodexReasoning = block.tool.name === 'CodexReasoning'
        && block.tool.state !== 'error'
        && block.tool.permission === undefined
        && block.children.length === 0

    if (isCodexReasoning) {
        const presentation = getToolPresentation({
            toolName: block.tool.name,
            input: block.tool.input,
            result: block.tool.result,
            childrenCount: block.children.length,
            description: block.tool.description,
            metadata: ctx.metadata,
            t
        })
        const ResultView = getToolResultViewComponent(block.tool.name)
        const isStreaming = block.tool.state === 'pending' || block.tool.state === 'running'
        return (
            <div
                data-codex-reasoning
                data-tool-block-id={block.id}
                className={cn(!grouped && 'py-1', 'min-w-0 max-w-full overflow-x-hidden')}
            >
                <ReasoningDisclosure
                    label={presentation.title}
                    ariaLabel={presentation.title}
                    isStreaming={isStreaming}
                    presentation={grouped ? 'group-row' : 'standalone'}
                    duration={codexDuration?.compact}
                    durationAriaLabel={codexDuration
                        ? t('tool.group.activityDuration', {
                            duration: codexDuration.accessible
                        })
                        : undefined}
                    statusLabel={grouped
                        ? t(isStreaming ? 'tool.status.running' : 'tool.status.completed')
                        : undefined}
                >
                    <ResultView
                        block={block}
                        metadata={ctx.metadata}
                        surface="group-output"
                        t={t}
                    />
                </ReasoningDisclosure>
            </div>
        )
    }

    const isTask = block.tool.name === 'Task'
    const taskChildren = isTask ? splitTaskChildren(block) : null
    const standaloneCompact = !grouped && isGroupableToolBlock(block)
    const compact = grouped || standaloneCompact

    return (
        <div
            data-tool-singleton-compact={standaloneCompact ? '' : undefined}
            className={cn(
                !grouped && 'py-1',
                'min-w-0 max-w-full overflow-x-hidden',
                standaloneCompact && 'w-full max-w-[600px]'
            )}
        >
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
                displayMode={compact ? 'group-row' : 'card'}
            />
            {block.children.length > 0 ? (
                isTask ? (
                    <>
                        {taskChildren && taskChildren.pending.length > 0 ? (
                            <div className="mt-2 pl-3">
                                <HappyNestedBlockList blocks={taskChildren.pending} />
                            </div>
                        ) : null}
                        {taskChildren && taskChildren.rest.length > 0 ? (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                    Task details ({taskChildren.rest.length})
                                </summary>
                                <div className="mt-2 pl-3">
                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : (
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={block.children} />
                    </div>
                )
            ) : null}
        </div>
    )
}
