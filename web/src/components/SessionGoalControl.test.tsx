import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexGoalState } from '@/chat/types'
import { SessionGoalControl } from './SessionGoalControl'

afterEach(() => {
    cleanup()
})

function makeGoal(overrides: Partial<CodexGoalState> = {}): CodexGoalState {
    return {
        threadId: 'thread-1',
        objective: 'Ship Codex goal UI',
        status: 'active',
        tokenBudget: 200_000,
        tokensUsed: 12_000,
        timeUsedSeconds: 90,
        createdAt: 1,
        updatedAt: 2,
        ...overrides
    }
}

describe('SessionGoalControl', () => {
    it('renders nothing when goal null', () => {
        const { container } = render(<SessionGoalControl goal={null} onGoalCommand={vi.fn()} />)

        expect(container).toBeEmptyDOMElement()
    })

    it('opens modal with objective and progress from the icon button', () => {
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={vi.fn()} />)

        const button = screen.getByRole('button', { name: 'Codex goal' })
        expect(button).toHaveAttribute('title', 'Ship Codex goal UI')

        fireEvent.click(button)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('dialog'))
            .toHaveAttribute('data-app-dialog-presentation', 'sheet')
        expect(screen.getByDisplayValue('Ship Codex goal UI')).toBeInTheDocument()
        expect(screen.getByText('active · 12k/200k tokens · 1m 30s')).toBeInTheDocument()
        expect(screen.getByText('This goal is native Codex state. When active, Codex may continue working toward it when idle.')).toBeInTheDocument()
    })

    it('sends a goal update command', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={onGoalCommand} />)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        const objectiveInput = screen.getByLabelText('Goal objective')
        fireEvent.input(objectiveInput, { target: { value: 'new objective' } })
        expect(objectiveInput).toHaveValue('new objective')
        fireEvent.click(screen.getByRole('button', { name: 'Update goal' }))

        expect(onGoalCommand).toHaveBeenCalledWith('/goal new objective')
    })

    it('sends pause for an active goal', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal({ status: 'active' })} onGoalCommand={onGoalCommand} />)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Pause goal' }))

        expect(onGoalCommand).toHaveBeenCalledWith('/goal pause')
    })

    it('sends resume for a paused goal', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal({ status: 'paused' })} onGoalCommand={onGoalCommand} />)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Resume goal' }))

        expect(onGoalCommand).toHaveBeenCalledWith('/goal resume')
    })

    it('sends clear when unsetting the goal', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={onGoalCommand} />)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onGoalCommand).toHaveBeenCalledWith('/goal clear')
    })

    it('does not send an empty update and shows validation feedback', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={onGoalCommand} />)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        const objectiveInput = screen.getByLabelText('Goal objective')
        fireEvent.input(objectiveInput, { target: { value: '   ' } })
        expect(objectiveInput).toHaveValue('   ')
        fireEvent.click(screen.getByRole('button', { name: 'Update goal' }))

        expect(onGoalCommand).not.toHaveBeenCalled()
        const error = screen.getByText('Goal objective cannot be empty.')
        expect(error).toHaveAttribute('id', 'codex-goal-objective-error')
        expect(objectiveInput).toHaveAttribute('aria-invalid', 'true')
        expect(objectiveInput).toHaveAttribute('aria-describedby', 'codex-goal-objective-error')
    })

    it('keeps the goal modal viewable while disabled but blocks edits and actions', () => {
        const onGoalCommand = vi.fn()
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={onGoalCommand} disabled />)

        const trigger = screen.getByRole('button', { name: 'Codex goal' })
        expect(trigger).not.toBeDisabled()
        fireEvent.click(trigger)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Ship Codex goal UI')).toBeInTheDocument()
        expect(screen.getByText('active · 12k/200k tokens · 1m 30s')).toBeInTheDocument()

        const objectiveInput = screen.getByLabelText('Goal objective')
        expect(objectiveInput).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Update goal' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Pause goal' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Unset goal' })).toBeDisabled()

        fireEvent.click(screen.getByRole('button', { name: 'Update goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Pause goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onGoalCommand).not.toHaveBeenCalled()
    })

    it('keeps the goal button icon-only and uses objective as title', () => {
        render(<SessionGoalControl goal={makeGoal()} onGoalCommand={vi.fn()} />)

        const button = screen.getByRole('button', { name: 'Codex goal' })
        expect(button).toHaveAttribute('title', 'Ship Codex goal UI')
        expect(button).toHaveTextContent('🎯')
        expect(button).not.toHaveTextContent('Ship Codex goal UI')
    })

    it('flashes the goal button when the goal updates', () => {
        const { rerender } = render(<SessionGoalControl goal={makeGoal({ updatedAt: 2 })} onGoalCommand={vi.fn()} />)

        const button = screen.getByRole('button', { name: 'Codex goal' })
        expect(button).not.toHaveAttribute('data-flashing', 'true')

        rerender(<SessionGoalControl goal={makeGoal({ updatedAt: 3 })} onGoalCommand={vi.fn()} />)

        expect(button).toHaveAttribute('data-flashing', 'true')
    })
})
