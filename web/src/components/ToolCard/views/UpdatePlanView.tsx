import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { ChecklistList, extractUpdatePlanChecklist, getChecklistProgress } from '@/components/ToolCard/checklist'
import { useTranslation } from '@/lib/use-translation'

export function UpdatePlanView(props: ToolViewProps) {
    const { t } = useTranslation()
    const steps = extractUpdatePlanChecklist(props.block.tool.input, props.block.tool.result)
    if (props.surface === 'dialog') return <ChecklistList items={steps} />

    const progress = getChecklistProgress(steps)
    const visible = steps.slice(0, 3)
    const remaining = steps.length - visible.length

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-[var(--app-fg)]">
                    {t('tool.stepsProgress', { completed: progress.completed, total: progress.total })}
                </span>
                <span className="font-mono text-[var(--app-tool-plan-accent)]">
                    {progress.percent}%
                </span>
            </div>
            <div
                role="progressbar"
                aria-label={t('tool.planProgress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
                className="h-1.5 overflow-hidden rounded-full bg-[var(--app-subtle-bg)]"
            >
                <div
                    className="h-full rounded-full bg-[var(--app-tool-plan-accent)]"
                    style={{ width: `${progress.percent}%` }}
                />
            </div>
            <ChecklistList items={visible} />
            {remaining > 0 ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {t('tool.moreItems', { count: remaining })}
                </div>
            ) : null}
        </div>
    )
}
