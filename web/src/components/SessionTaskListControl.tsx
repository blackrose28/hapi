import type { TodoItem } from '@/types/api'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogHeader,
    AppDialogTrigger,
} from '@/components/ui/app-dialog'
import { useTranslation } from '@/lib/use-translation'
import './SessionTaskListControl.css'

export function SessionTaskListControl({ todos, compact = false }: {
    todos: TodoItem[] | null | undefined
    compact?: boolean
}) {
    const { t } = useTranslation()

    if (!todos || todos.length === 0) return null

    const completed = todos.filter((todo) => todo.status === 'completed').length
    const total = todos.length
    const label = t('session.tasks.trigger', { completed, total })
    const visualState = todos.some((todo) => todo.status === 'in_progress')
        ? 'active'
        : todos.some((todo) => todo.status === 'pending')
            ? 'pending'
            : 'completed'

    return (
        <AppDialog>
            <AppDialogTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    title={label}
                    className={`session-task-badge session-task-badge--${visualState}`}
                    onDoubleClick={compact ? (event) => event.stopPropagation() : undefined}
                >
                    <span className="session-task-badge__dot" aria-hidden="true" />
                    <span>{completed}/{total}</span>
                </button>
            </AppDialogTrigger>
            <AppDialogContent presentation="sheet" className="session-task-dialog">
                <AppDialogHeader
                    title={t('session.tasks.title')}
                    subtitle={t('session.tasks.progress', { completed, total })}
                    closeLabel={t('button.close')}
                />
                <AppDialogBody className="overflow-y-auto px-4 pb-4">
                    <div className="session-task-progress">
                        <div
                            role="progressbar"
                            aria-label={label}
                            aria-valuemin={0}
                            aria-valuemax={total}
                            aria-valuenow={completed}
                            className="session-task-progress__track"
                        >
                            <div
                                className={`session-task-progress__fill session-task-progress__fill--${visualState}`}
                                style={{ width: `${Math.round((completed / total) * 100)}%` }}
                            />
                        </div>
                    </div>
                    <ul className="session-task-timeline">
                        {todos.map((todo, index) => (
                            <li
                                key={`${todo.id || 'todo'}:${index}`}
                                className={`session-task-row session-task-row--${todo.status}`}
                            >
                                <span className="session-task-row__dot" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="break-words text-sm">{todo.content}</p>
                                    <p className="session-task-row__status">{t(`session.tasks.status.${todo.status}`)}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </AppDialogBody>
            </AppDialogContent>
        </AppDialog>
    )
}
