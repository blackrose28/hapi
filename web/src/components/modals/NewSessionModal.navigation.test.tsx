import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { NewSessionModal } from './NewSessionModal'

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
    useSearch: () => ({}),
}))

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: [], isLoading: false, error: null }),
}))

vi.mock('@/components/NewSession', () => ({
    NewSession: (props: {
        onChooseFolder?: (args: { machineId: string | null; directory: string }) => void
    }) => (
        <button
            type="button"
            onClick={() => props.onChooseFolder?.({
                machineId: 'machine-1',
                directory: '/repo/current',
            })}
        >
            Browse
        </button>
    ),
}))

describe('NewSessionModal navigation', () => {
    it('marks Browser as a child flow and carries the current directory', () => {
        mocks.navigate.mockReset()
        render(
            <Dialog open>
                <NewSessionModal onClose={vi.fn()} />
            </Dialog>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

        const navigation = mocks.navigate.mock.calls[0][0] as {
            search: (previous: Record<string, unknown>) => Record<string, unknown>
        }
        expect(navigation.search({ modal: 'new-session' })).toEqual({
            modal: 'browser',
            modalMachineId: 'machine-1',
            modalPath: '/repo/current',
            modalParent: 'new-session',
            modalReturnTo: undefined,
        })
    })
})
