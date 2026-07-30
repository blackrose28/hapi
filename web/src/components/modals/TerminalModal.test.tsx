import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { TerminalModal } from './TerminalModal'

const sharedTabsMock = vi.fn()
const legacyCloseMock = vi.fn()

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: null, token: 'test-token', baseUrl: 'http://localhost:3000' })
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: { id: 'session-1', active: true, metadata: { path: '/tmp/project' } }
    })
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: () => ({ close: legacyCloseMock })
}))

vi.mock('@/components/Terminal/SessionTerminalTabs', () => ({
    SessionTerminalTabs: (props: unknown) => {
        sharedTabsMock(props)
        return <div data-testid="session-terminal-tabs" />
    }
}))

function renderModal(onClose = vi.fn()) {
    return render(
        <Dialog open>
            <TerminalModal sessionId="session-1" onClose={onClose} />
        </Dialog>
    )
}

describe('TerminalModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders shared session terminal tabs with session state', () => {
        renderModal()

        expect(screen.getByTestId('session-terminal-tabs')).toBeInTheDocument()
        expect(sharedTabsMock).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            active: true,
            terminalSupported: true
        }))
        expect(sharedTabsMock).toHaveBeenCalledWith(expect.not.objectContaining({
            header: expect.anything()
        }))
        expect(screen.getByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
        expect(screen.getByText('/tmp/project')).toBeInTheDocument()
        expect(document.querySelector('[data-app-dialog-content]')).toBeInTheDocument()
    })

    it('uses the shared slim close control in the dialog header', () => {
        renderModal()

        const close = screen.getByRole('button', { name: 'Close' })
        expect(close).toHaveClass('h-11', 'w-11')
        expect(close.firstElementChild).toHaveClass('h-[28px]', 'w-[28px]', 'border')
    })

    it('uses the mobile workspace presentation and returns to the session', () => {
        const onClose = vi.fn()
        renderModal(onClose)

        expect(screen.getByRole('dialog'))
            .toHaveAttribute('data-app-dialog-presentation', 'workspace')

        fireEvent.click(screen.getByRole('button', { name: 'Back to session' }))

        expect(onClose).toHaveBeenCalledOnce()
    })

    it('unmounts through shared tabs without legacy close', () => {
        const rendered = renderModal()

        rendered.unmount()

        expect(legacyCloseMock).not.toHaveBeenCalled()
    })
})
