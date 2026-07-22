import {
    Children,
    Fragment,
    useEffect,
    useId,
    useRef,
    useState,
    type PropsWithChildren
} from 'react'
import { useAssistantState } from '@assistant-ui/react'
import type { ActivityEntry } from '@/components/ToolCard/toolRunModel'
import {
    getActivityGroupDurationMs,
    isActivityRunning,
    partitionActivityParts
} from '@/components/ToolCard/toolRunModel'
import {
    ToolRunLayoutProvider,
    useActivityClock,
    useFormattedActivityDuration
} from '@/components/ToolCard/toolRunContext'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

function ChevronIcon(props: { open: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'transition-transform motion-reduce:transition-none',
                props.open && 'rotate-90'
            )}
        >
            ›
        </span>
    )
}

function ActivityRun(props: PropsWithChildren<{
    id: string
    entries: ActivityEntry[]
}>) {
    const { t } = useTranslation()
    const running = props.entries.some(isActivityRunning)
    const [open, setOpen] = useState(() => running)
    const previousRunning = useRef(running)
    const regionId = useId()
    const durationDescriptionId = useId()
    const now = useActivityClock(running)
    const durationMs = getActivityGroupDurationMs(props.entries, now)
    const duration = useFormattedActivityDuration(durationMs)
    const statusLabel = t(
        running ? 'tool.group.activitiesRunning' : 'tool.group.activitiesCompleted',
        { count: props.entries.length }
    )

    useEffect(() => {
        if (running && !previousRunning.current) {
            setOpen(true)
        }
        previousRunning.current = running
    }, [running])

    return (
        <div
            data-testid="tool-run-group"
            data-tool-run-group
            data-activity-group
            data-running={running ? 'true' : 'false'}
            data-tool-run-id={props.id}
            className={cn(
                'processing-surface my-2 w-full max-w-[600px] min-w-0 overflow-hidden rounded-[15px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)]',
                running && 'processing-surface--running'
            )}
        >
            <button
                type="button"
                aria-expanded={open}
                aria-controls={regionId}
                aria-label={t('tool.group.toggleActivities', { status: statusLabel })}
                aria-describedby={duration ? durationDescriptionId : undefined}
                onClick={() => setOpen((value) => !value)}
                className="flex min-h-[42px] w-full min-w-0 items-center gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <ChevronIcon open={open} />
                <span className="min-w-0 flex-1 text-xs font-semibold">
                    {statusLabel}
                    {running ? (
                        <span aria-hidden="true" className="activity-live-marker ml-1.5 font-normal">
                            · {t('tool.group.live')}
                        </span>
                    ) : null}
                </span>
                {duration ? (
                    <>
                        <span
                            aria-hidden="true"
                            className="shrink-0 font-mono text-[11px] font-semibold text-[var(--app-hint)]"
                        >
                            {duration.compact}
                        </span>
                        <span id={durationDescriptionId} className="sr-only">
                            {t('tool.group.totalDuration', { duration: duration.accessible })}
                        </span>
                    </>
                ) : null}
            </button>
            <div
                id={regionId}
                hidden={!open}
                data-activity-scroll-region
                role="region"
                aria-label={statusLabel}
                tabIndex={0}
                className="activity-scroll-region min-w-0 max-h-[min(420px,55vh)] overflow-y-auto overscroll-contain border-t border-[var(--app-border)] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]"
            >
                <ToolRunLayoutProvider now={now}>{props.children}</ToolRunLayoutProvider>
            </div>
        </div>
    )
}

export function ToolRunGroup({
    startIndex,
    endIndex,
    children
}: PropsWithChildren<{
    startIndex: number
    endIndex: number
}>) {
    const content = useAssistantState(({ message }) => message.content)
    const status = useAssistantState(({ message }) => message.status)
    const parts = content
        .slice(startIndex, endIndex + 1)
        .map((part, offset) => ({
            type: part.type,
            toolCallId: part.type === 'tool-call' ? part.toolCallId : undefined,
            artifact: part.type === 'tool-call' ? part.artifact : undefined,
            isFinalRunningPart: status?.type === 'running'
                && startIndex + offset === content.length - 1
        }))
    const childArray = Children.toArray(children)
    const segments = partitionActivityParts(parts)

    return segments.map((segment) => {
        if (segment.kind === 'single') {
            return (
                <Fragment key={`single:${startIndex + segment.startOffset}`}>
                    {childArray[segment.startOffset]}
                </Fragment>
            )
        }

        return (
            <ActivityRun key={segment.id} id={segment.id} entries={segment.entries}>
                {childArray.slice(segment.startOffset, segment.endOffset + 1)}
            </ActivityRun>
        )
    })
}
