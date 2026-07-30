import * as React from 'react'
import type { CodexGoalState } from '@/chat/types'
import { Button } from '@/components/ui/button'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogHeader,
    AppDialogTrigger,
} from '@/components/ui/app-dialog'
import { cn } from '@/lib/utils'

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) {
        const millions = tokens / 1_000_000
        return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`
    }

    if (tokens >= 1_000) {
        const thousands = tokens / 1_000
        return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`
    }

    return String(tokens)
}

function formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds))
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const remainingSeconds = safeSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${remainingSeconds}s`
    }

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`
    }

    return `${remainingSeconds}s`
}

function formatGoalProgress(goal: CodexGoalState): string {
    const tokenPart = goal.tokenBudget === null
        ? `${formatTokenCount(goal.tokensUsed)} tokens`
        : `${formatTokenCount(goal.tokensUsed)}/${formatTokenCount(goal.tokenBudget)} tokens`

    return `${goal.status} · ${tokenPart} · ${formatDuration(goal.timeUsedSeconds)}`
}

export function SessionGoalControl(props: {
    goal: CodexGoalState | null
    onGoalCommand: (command: string) => void
    disabled?: boolean
    compact?: boolean
}) {
    const { goal, onGoalCommand, disabled = false, compact = false } = props
    const [error, setError] = React.useState<string | null>(null)
    const [flashing, setFlashing] = React.useState(false)
    const previousUpdateRef = React.useRef<number | null>(goal?.updatedAt ?? null)

    React.useEffect(() => {
        setError(null)
    }, [goal?.updatedAt])

    React.useEffect(() => {
        if (goal === null) {
            previousUpdateRef.current = null
            setFlashing(false)
            return
        }

        const previousUpdatedAt = previousUpdateRef.current
        previousUpdateRef.current = goal.updatedAt
        if (previousUpdatedAt === null || previousUpdatedAt === goal.updatedAt) {
            return
        }

        setFlashing(true)
        const timeout = window.setTimeout(() => setFlashing(false), 1600)
        return () => window.clearTimeout(timeout)
    }, [goal])

    if (goal === null) {
        return null
    }

    const sendCommand = (command: string) => {
        if (disabled) {
            return
        }
        onGoalCommand(command)
    }

    const handleObjectiveChange = () => {
        if (error) {
            setError(null)
        }
    }

    const handleUpdate = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        const trimmedObjective = String(formData.get('objective') ?? '').trim()

        if (!trimmedObjective) {
            setError('Goal objective cannot be empty.')
            return
        }

        setError(null)
        sendCommand(`/goal ${trimmedObjective}`)
    }

    const isPaused = goal.status === 'paused'
    const progress = formatGoalProgress(goal)
    const objectiveErrorId = 'codex-goal-objective-error'

    return (
        <AppDialog>
            <AppDialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                        'relative h-8 w-8 p-0',
                        compact ? 'text-xs' : 'text-sm',
                        flashing ? 'animate-pulse ring-2 ring-blue-400 ring-offset-1 ring-offset-[var(--app-bg)]' : null
                    )}
                    aria-label="Codex goal"
                    title={goal.objective}
                    data-flashing={flashing ? 'true' : undefined}
                >
                    <span aria-hidden="true">🎯</span>
                </Button>
            </AppDialogTrigger>
            <AppDialogContent presentation="sheet" className="max-w-md">
                <AppDialogHeader
                    title="Codex goal"
                    subtitle="This goal is native Codex state. When active, Codex may continue working toward it when idle."
                />

                <AppDialogBody className="space-y-4 overflow-y-auto p-4">
                    <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">Progress</p>
                        <p className="mt-1 text-sm text-[var(--app-fg)]">{progress}</p>
                    </div>

                    <form className="space-y-3" onSubmit={handleUpdate}>
                        <div className="space-y-2">
                            <label htmlFor="codex-goal-objective" className="text-sm font-medium text-[var(--app-fg)]">
                                Goal objective
                            </label>
                            <textarea
                                id="codex-goal-objective"
                                name="objective"
                                className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-transparent px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                key={`${goal.threadId}:${goal.updatedAt}`}
                                defaultValue={goal.objective}
                                onChange={handleObjectiveChange}
                                onInput={handleObjectiveChange}
                                disabled={disabled}
                                aria-invalid={!!error}
                                aria-describedby={error ? objectiveErrorId : undefined}
                            />
                            {error ? (
                                <p id={objectiveErrorId} className="text-sm text-red-500">
                                    {error}
                                </p>
                            ) : null}
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            <Button type="submit" size="sm" disabled={disabled}>Update goal</Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={disabled}
                                onClick={() => sendCommand(isPaused ? '/goal resume' : '/goal pause')}
                            >
                                {isPaused ? 'Resume goal' : 'Pause goal'}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={disabled}
                                onClick={() => sendCommand('/goal clear')}
                            >
                                Unset goal
                            </Button>
                        </div>
                    </form>
                </AppDialogBody>
            </AppDialogContent>
        </AppDialog>
    )
}
