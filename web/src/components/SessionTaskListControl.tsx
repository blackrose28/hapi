import type { TodoItem } from '@/types/api'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/components/ui/dialog'
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
        <Dialog>
            <DialogTrigger asChild>
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
            </DialogTrigger>
            <DialogContent className="session-task-dialog" closeLabel={t('button.close')}>
                <DialogHeader>
                    <DialogTitle>{t('session.tasks.title')}</DialogTitle>
                    <DialogDescription>{t('session.tasks.progress', { completed, total })}</DialogDescription>
                </DialogHeader>
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
            </DialogContent>
        </Dialog>
    )
}
