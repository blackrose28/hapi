import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalModalManager } from './GlobalModalManager'

const mocks = vi.hoisted(() => ({
    search: {} as Record<string, unknown>,
    navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
    useSearch: () => mocks.search,
    useRouter: () => ({ navigate: mocks.navigate }),
}))

vi.mock('@/components/ui/app-dialog', () => ({
    AppDialog: (props: { children: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('@/components/modals/NewSessionModal', () => ({
    NewSessionModal: (props: {
        draft?: { directory?: string } | null
        onDraftChange?: (draft: { directory: string }) => void
    }) => (
        <div>
            <span>Draft: {props.draft?.directory ?? 'empty'}</span>
            <button
                type="button"
                onClick={() => props.onDraftChange?.({ directory: '/repo/draft' })}
            >
                Save draft
            </button>
        </div>
    ),
}))

vi.mock('@/components/modals/BrowserModal', () => ({
    BrowserModal: (props: { onClose: () => void }) => (
        <button type="button" onClick={props.onClose}>Back from browser</button>
    ),
}))

vi.mock('@/components/modals/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('@/components/modals/FilesModal', () => ({ FilesModal: () => null }))
vi.mock('@/components/modals/TerminalModal', () => ({ TerminalModal: () => null }))
vi.mock('@/components/modals/ReplacePinModal', () => ({ ReplacePinModal: () => null }))

describe('GlobalModalManager', () => {
    beforeEach(() => {
        mocks.search = {}
        mocks.navigate.mockReset()
    })

    it('keeps the New Session draft while Browser temporarily replaces the modal', () => {
        mocks.search = { modal: 'new-session' }
        const rendered = render(<GlobalModalManager />)

        fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

        mocks.search = { modal: 'browser', modalParent: 'new-session' }
        rendered.rerender(<GlobalModalManager />)
        expect(screen.getByRole('button', { name: 'Back from browser' })).toBeInTheDocument()

        mocks.search = { modal: 'new-session' }
        rendered.rerender(<GlobalModalManager />)

        expect(screen.getByText('Draft: /repo/draft')).toBeInTheDocument()
    })

    it('returns Browser to its New Session parent instead of closing the whole flow', () => {
        mocks.search = {
            modal: 'browser',
            modalParent: 'new-session',
            modalMachineId: 'machine-1',
            modalPath: '/repo',
        }
        render(<GlobalModalManager />)

        fireEvent.click(screen.getByRole('button', { name: 'Back from browser' }))

        expect(mocks.navigate).toHaveBeenCalledOnce()
        const navigation = mocks.navigate.mock.calls[0][0] as {
            search: (previous: Record<string, unknown>) => Record<string, unknown>
        }
        expect(navigation.search(mocks.search)).toEqual({
            modal: 'new-session',
            modalMachineId: 'machine-1',
            modalPath: '/repo',
        })
    })
})
