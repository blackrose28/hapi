import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTaskListControl } from './SessionTaskListControl'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const messages: Record<string, string> = {
                'session.tasks.label': 'Tasks',
                'session.tasks.trigger': 'Session tasks: {completed} of {total} completed',
                'session.tasks.title': 'Session tasks',
                'session.tasks.progress': '{completed} of {total} completed',
                'session.tasks.status.pending': 'Pending',
                'session.tasks.status.in_progress': 'In progress',
                'session.tasks.status.completed': 'Completed',
                'button.close': 'Đóng'
            }
            let value = messages[key] ?? key
            for (const [param, replacement] of Object.entries(params ?? {})) {
                value = value.replace(`{${param}}`, String(replacement))
            }
            return value
        }
    })
}))

afterEach(cleanup)

const todos = [
    { id: '1', content: 'First task', status: 'completed' as const, priority: 'medium' as const },
    { id: '2', content: 'A very long second task that must wrap inside the mobile dialog', status: 'in_progress' as const, priority: 'high' as const }
]

describe('SessionTaskListControl', () => {
    it('hides empty snapshots and opens a read-only ordered dialog', async () => {
        const { rerender } = render(<SessionTaskListControl todos={[]} />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()

        rerender(<SessionTaskListControl todos={todos} />)
        const trigger = screen.getByRole('button', { name: 'Session tasks: 1 of 2 completed' })
        expect(trigger).not.toHaveTextContent('Tasks')
        expect(trigger).toHaveTextContent('1/2')

        trigger.focus()
        fireEvent.click(trigger)

        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAccessibleName('Session tasks')
        expect(dialog).toHaveAccessibleDescription('1 of 2 completed')
        expect(dialog).toContainElement(document.activeElement as HTMLElement)
        const progressbar = screen.getByRole('progressbar')
        expect(progressbar).toHaveAttribute('aria-valuenow', '1')
        expect(progressbar.parentElement).toHaveClass('session-task-progress')
        expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
        const items = screen.getAllByRole('listitem')
        expect(items.map((item) => item.textContent)).toEqual([
            expect.stringContaining('First task'),
            expect.stringContaining('A very long second task')
        ])
        expect(items[0].closest('ul')).toHaveClass('session-task-timeline')
        expect(items[0]).toHaveClass('session-task-row', 'session-task-row--completed')
        expect(items[1]).toHaveClass('session-task-row', 'session-task-row--in_progress')
        expect(items[1].querySelector('p')).toHaveClass('break-words')

        fireEvent.keyDown(document, { key: 'Escape' })

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('uses the same slim badge in compact mode', () => {
        render(<SessionTaskListControl todos={todos} compact />)

        const trigger = screen.getByRole('button')
        expect(trigger).toHaveTextContent('1/2')
        expect(trigger).not.toHaveTextContent('Tasks')
        expect(trigger).toHaveClass('session-task-badge', 'session-task-badge--active')
    })

    it('uses the shared mobile sheet presentation', () => {
        render(<SessionTaskListControl todos={todos} />)

        fireEvent.click(screen.getByRole('button'))

        expect(screen.getByRole('dialog'))
            .toHaveAttribute('data-app-dialog-presentation', 'sheet')
        expect(document.querySelector('[data-app-dialog-sheet-handle]')).toBeInTheDocument()
    })

    it('stops compact trigger double-clicks from bubbling', () => {
        const onDoubleClick = vi.fn()
        render(<div onDoubleClick={onDoubleClick}><SessionTaskListControl todos={todos} compact /></div>)

        fireEvent.doubleClick(screen.getByRole('button'))

        expect(onDoubleClick).not.toHaveBeenCalled()
    })

    it('keeps a fully completed snapshot visible', () => {
        render(<SessionTaskListControl todos={todos.map((todo) => ({ ...todo, status: 'completed' as const }))} />)

        expect(screen.getByRole('button')).not.toHaveTextContent('Tasks')
        expect(screen.getByRole('button')).toHaveTextContent('2/2')
        expect(screen.getByRole('button')).toHaveClass('session-task-badge--completed')
    })

    it.each([
        ['in_progress', 'session-task-badge--active'],
        ['pending', 'session-task-badge--pending'],
        ['completed', 'session-task-badge--completed']
    ] as const)('maps %s todos to the expected badge state', (status, className) => {
        render(<SessionTaskListControl todos={[
            { id: status, content: status, status, priority: 'medium' }
        ]} />)

        const trigger = screen.getByRole('button')
        expect(trigger).toHaveClass('session-task-badge', className)
        expect(trigger).toHaveTextContent(status === 'completed' ? '1/1' : '0/1')
        expect(trigger).not.toHaveTextContent('Tasks')
    })

    it('shows pending, in-progress, and completed statuses', () => {
        render(<SessionTaskListControl todos={[
            { id: 'pending', content: 'Queued task', status: 'pending', priority: 'low' },
            { id: 'active', content: 'Active task', status: 'in_progress', priority: 'medium' },
            { id: 'done', content: 'Done task', status: 'completed', priority: 'high' }
        ]} />)

        fireEvent.click(screen.getByRole('button'))

        expect(screen.getByText('Pending')).toBeInTheDocument()
        expect(screen.getByText('In progress')).toBeInTheDocument()
        expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('renders duplicate and empty todo IDs without React key warnings', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            render(<SessionTaskListControl todos={[
                { id: '', content: 'Empty ID', status: 'pending', priority: 'low' },
                { id: 'duplicate', content: 'Duplicate one', status: 'in_progress', priority: 'medium' },
                { id: 'duplicate', content: 'Duplicate two', status: 'completed', priority: 'high' }
            ]} />)
            fireEvent.click(screen.getByRole('button'))

            expect(screen.getAllByRole('listitem')).toHaveLength(3)
            expect(consoleErrorSpy).not.toHaveBeenCalled()
        } finally {
            consoleErrorSpy.mockRestore()
        }
    })
})
