import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './index'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'

const navigate = vi.fn()
const sessionChatUnmounts = vi.fn()
const sessionChatMock = vi.fn()
let mockSessions: SessionSummary[]

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useSearch: () => ({})
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        sessions: mockSessions,
        isLoading: false,
    })
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: [], isLoading: false })
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: (_api: unknown, sessionId: string | null) => ({
        session: sessionId ? makeSession({ id: sessionId, metadata: { path: '/repo/app', name: 'Build app', flavor: 'claude' } }) : null,
        refetch: vi.fn(),
    })
}))

vi.mock('@/hooks/queries/useMessages', () => ({
    useMessages: () => ({
        messages: [],
        warning: null,
        isLoading: false,
        isLoadingMore: false,
        hasMore: false,
        loadMore: vi.fn(),
        refetch: vi.fn(),
        pendingCount: 0,
        messagesVersion: 0,
        flushPending: vi.fn(),
        setAtBottom: vi.fn(),
    })
}))

vi.mock('@/hooks/mutations/useSendMessage', () => ({
    useSendMessage: () => ({
        sendMessage: vi.fn(),
        retryMessage: vi.fn(),
        isSending: false,
        sendStatus: { attemptId: 7, state: 'accepted' },
    })
}))

vi.mock('@/hooks/queries/useSlashCommands', () => ({
    useSlashCommands: () => ({ commands: [], getSuggestions: vi.fn(async () => []) })
}))

vi.mock('@/hooks/queries/useSkills', () => ({
    useSkills: () => ({ getSuggestions: vi.fn(async () => []) })
}))

vi.mock('@/components/SessionChat', async () => {
    const React = await import('react')
    return {
        SessionChat: (props: {
            session: { id: string }
            onBack?: () => void
            onFocusSession?: () => void
            compactCloseLabel?: string
            compactCloseButtonRef?: React.Ref<HTMLButtonElement>
            compactMode?: boolean
            compactComposerMode?: boolean
            compactSendStatus?: { attemptId: number; state: string }
        }) => {
            sessionChatMock(props)
            const instanceId = React.useId()
            const [draft, setDraft] = React.useState('')
            React.useEffect(() => () => sessionChatUnmounts(props.session.id), [props.session.id])
            return (
                <div data-testid="pinned-panel-chat" data-instance-id={instanceId}>
                    <span>{props.session.id}</span>
                    <label>
                        Draft
                        <input
                            aria-label="Mock composer draft"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                        />
                    </label>
                    {props.onFocusSession ? (
                        <button type="button" onClick={props.onFocusSession}>Mock focus session</button>
                    ) : null}
                    {props.onBack ? (
                        <button
                            ref={props.compactCloseButtonRef}
                            type="button"
                            data-testid="mock-session-header-close"
                            aria-label={props.compactCloseLabel ?? 'Unpin this session'}
                            onClick={props.onBack}
                        >
                            Mock close session
                        </button>
                    ) : null}
                </div>
            )
        }
    }
})

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (key === 'dashboard.sessions' && params?.n !== undefined) return `${params.n} sessions`
            const messages: Record<string, string> = {
                'dialog.archive.description': 'Archive "{name}"? You can still find it in archived sessions.',
                'dialog.archive.terminalImpact': 'Archiving will stop all running terminals in this session.',
                'dialog.archive.terminalCount': 'Running terminals: {n}/{max}',
                'dialog.archiveAll.description': 'Archive {n} session(s)?',
                'dialog.archiveAll.terminalImpact': 'Archiving these sessions will stop their running terminals.',
                'dialog.archiveAll.terminalCount': 'Running terminals: {n}'
            }
            let value = messages[key]
            if (value) {
                for (const [param, replacement] of Object.entries(params ?? {})) {
                    value = value.replace(`{${param}}`, String(replacement))
                }
                return value
            }
            return key
        }
    })
}))

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        metadata: { path: '/repo', flavor: 'claude', ...overrides.metadata },
        todoProgress: null,
        pendingRequestsCount: 0,
        model: null,
        effort: null,
        ...overrides,
        id: overrides.id,
    }
}

function resetMockSessions() {
    mockSessions = [
        makeSession({ id: 'session-1', metadata: { path: '/repo/app', name: 'Build app', flavor: 'claude' } }),
    ]
}

function setMockSessions(count: number) {
    mockSessions = Array.from({ length: count }, (_, index) => makeSession({
        id: `session-${index + 1}`,
        metadata: { path: '/repo/app', name: `Build app ${index + 1}`, flavor: 'claude' }
    }))
}

type MockMediaQueryList = {
    matches: boolean
    addEventListener?: ReturnType<typeof vi.fn>
    removeEventListener?: ReturnType<typeof vi.fn>
    addListener?: ReturnType<typeof vi.fn>
    removeListener?: ReturnType<typeof vi.fn>
    trigger: (matches: boolean) => void
}

let mobileMedia: MockMediaQueryList | null = null

function createMockMediaQueryList(matches: boolean, legacy = false): MockMediaQueryList {
    const modernListeners = new Set<(event: { matches: boolean }) => void>()
    const legacyListeners = new Set<(event: { matches: boolean }) => void>()
    const media: MockMediaQueryList = {
        matches,
        trigger(nextMatches: boolean) {
            media.matches = nextMatches
            const event = { matches: nextMatches }
            modernListeners.forEach(listener => listener(event))
            legacyListeners.forEach(listener => listener(event))
        }
    }
    if (legacy) {
        media.addListener = vi.fn((listener: (event: { matches: boolean }) => void) => legacyListeners.add(listener))
        media.removeListener = vi.fn((listener: (event: { matches: boolean }) => void) => legacyListeners.delete(listener))
    } else {
        media.addEventListener = vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => modernListeners.add(listener))
        media.removeEventListener = vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => modernListeners.delete(listener))
    }
    return media
}

function setMediaMatches({ coarsePointer = false, mobileViewport = false, legacyMobileListener = false }: { coarsePointer?: boolean; mobileViewport?: boolean; legacyMobileListener?: boolean } = {}) {
    mobileMedia = createMockMediaQueryList(mobileViewport, legacyMobileListener)
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn((query: string) => {
            if (query.includes('pointer: coarse')) return createMockMediaQueryList(coarsePointer)
            if (query.includes('max-width: 768px')) return mobileMedia
            return createMockMediaQueryList(false)
        })
    })
}

function setCoarsePointer(matches: boolean) {
    setMediaMatches({ coarsePointer: matches })
}

function renderDashboard() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <Dashboard api={{} as ApiClient} />
        </QueryClientProvider>
    )
}

function dispatchPointer(target: Window | Document | Element, type: string, init: { pointerId: number; clientY: number }) {
    const event = new MouseEvent(type, { bubbles: true, clientY: init.clientY })
    Object.defineProperty(event, 'pointerId', { value: init.pointerId })
    fireEvent(target, event)
}

describe('Dashboard session context menu', () => {
    beforeEach(() => {
        navigate.mockClear()
        sessionChatUnmounts.mockClear()
        sessionChatMock.mockClear()
        sessionStorage.clear()
        resetMockSessions()
        mobileMedia = null
        setCoarsePointer(false)
    })

    afterEach(() => {
        cleanup()
        sessionStorage.clear()
    })

    it('opens the unified context menu from a session card right-click', () => {
        renderDashboard()

        fireEvent.contextMenu(screen.getByText('Build app'))

        expect(screen.getByText('dashboard.archiveSession')).toBeInTheDocument()
        expect(screen.getByText('dashboard.copySessionId')).toBeInTheDocument()
    })

    it('includes terminal impact copy in single-session archive confirm', () => {
        mockSessions = [
            makeSession({
                id: 'session-1',
                terminalLiveCount: 2,
                metadata: { path: '/repo/app', name: 'Build app', flavor: 'claude' }
            })
        ]
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
        renderDashboard()

        fireEvent.contextMenu(screen.getByText('Build app'))
        fireEvent.click(screen.getByText('dashboard.archiveSession'))

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Archiving will stop all running terminals in this session.'))
        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Running terminals: 2/3'))
        confirmSpy.mockRestore()
    })

    it('includes total terminal impact copy in group archive confirm', () => {
        mockSessions = [
            makeSession({ id: 'session-1', terminalLiveCount: 2, metadata: { path: '/repo/app', name: 'Build app 1', flavor: 'claude' } }),
            makeSession({ id: 'session-2', terminalLiveCount: 1, metadata: { path: '/repo/app', name: 'Build app 2', flavor: 'claude' } })
        ]
        renderDashboard()

        fireEvent.click(screen.getByTitle('dashboard.archiveAllTitle'))

        expect(screen.getByText(/Archiving these sessions will stop their running terminals/)).toBeInTheDocument()
        expect(screen.getByText(/Running terminals: 3/)).toBeInTheDocument()
    })

    it('pins from single-clicking a session card', () => {
        renderDashboard()
        const cardTitle = screen.getByText('Build app')

        fireEvent.click(cardTitle)
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe(JSON.stringify(['session-1']))
        expect(sessionChatMock).toHaveBeenCalledWith(expect.objectContaining({
            compactMode: true,
            compactComposerMode: true,
            compactSendStatus: { attemptId: 7, state: 'accepted' }
        }))
    })

    it('expands the existing pinned panel without remounting the session chat', () => {
        const { container } = renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        const chat = screen.getByTestId('pinned-panel-chat')
        const instanceId = chat.getAttribute('data-instance-id')
        fireEvent.change(screen.getByRole('textbox', { name: 'Mock composer draft' }), { target: { value: 'draft before focus' } })

        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))

        const focusedPanel = screen.getByRole('dialog', { name: 'Focus session Build app' })
        expect(focusedPanel).toHaveAttribute('aria-modal', 'true')
        expect(focusedPanel).toHaveAttribute('data-testid', 'focused-pinned-panel')
        expect(focusedPanel).toContainElement(screen.getByTestId('pinned-panel-chat'))
        expect(screen.getByTestId('pinned-panel-chat')).toHaveAttribute('data-instance-id', instanceId)
        expect(screen.getByRole('textbox', { name: 'Mock composer draft' })).toHaveValue('draft before focus')
        expect(screen.getByRole('button', { name: 'Close focus session' })).toHaveFocus()
        expect(container.querySelector('.db__pinned-focus-close')).not.toBeInTheDocument()
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe(JSON.stringify(['session-1']))

        fireEvent.click(screen.getByRole('button', { name: 'Close focus session' }))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('pinned-panel-chat')).toHaveAttribute('data-instance-id', instanceId)
        expect(screen.getByRole('textbox', { name: 'Mock composer draft' })).toHaveValue('draft before focus')
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe(JSON.stringify(['session-1']))
    })

    it('closes focused pinned panel with Escape without unmounting the chat', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))
        expect(screen.getByTestId('focused-pinned-panel')).toBeInTheDocument()

        fireEvent.keyDown(window, { key: 'Escape' })

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('keeps keyboard focus inside the focused pinned panel and restores focus on close', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        const focusButton = screen.getByRole('button', { name: 'Mock focus session' })
        focusButton.focus()
        fireEvent.click(focusButton)

        const focusedPanel = screen.getByRole('dialog', { name: 'Focus session Build app' })
        const closeButton = screen.getByRole('button', { name: 'Close focus session' })
        expect(closeButton).toHaveFocus()

        fireEvent.keyDown(focusedPanel, { key: 'Tab', shiftKey: true })
        expect(focusedPanel.contains(document.activeElement)).toBe(true)

        fireEvent.click(closeButton)
        expect(focusButton).toHaveFocus()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('closes focused pinned panel from backdrop without unmounting the chat or losing draft', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        const chat = screen.getByTestId('pinned-panel-chat')
        const instanceId = chat.getAttribute('data-instance-id')
        fireEvent.change(screen.getByRole('textbox', { name: 'Mock composer draft' }), { target: { value: 'draft before backdrop' } })
        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))

        expect(screen.queryByRole('button', { name: 'Close focus session backdrop' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByTestId('focused-pinned-backdrop'))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('pinned-panel-chat')).toHaveAttribute('data-instance-id', instanceId)
        expect(screen.getByRole('textbox', { name: 'Mock composer draft' })).toHaveValue('draft before backdrop')
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('closes the focused panel from the session header without unpinning', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))
        expect(screen.getByTestId('focused-pinned-panel')).toBeInTheDocument()

        fireEvent.click(screen.getByTestId('mock-session-header-close'))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Close focus session' })).not.toBeInTheDocument()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe(JSON.stringify(['session-1']))
    })

    it('closes focused pinned panel when viewport becomes mobile', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))
        expect(screen.getByTestId('focused-pinned-panel')).toBeInTheDocument()

        act(() => mobileMedia?.trigger(true))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('closes focused pinned panel through legacy mobile media listener', () => {
        setMediaMatches({ legacyMobileListener: true })
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        fireEvent.click(screen.getByRole('button', { name: 'Mock focus session' }))
        expect(screen.getByTestId('focused-pinned-panel')).toBeInTheDocument()
        expect(mobileMedia?.addListener).toHaveBeenCalled()

        act(() => mobileMedia?.trigger(true))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('opens focused pinned panel from context menu without unmounting the chat', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        const chat = screen.getByTestId('pinned-panel-chat')
        const instanceId = chat.getAttribute('data-instance-id')
        fireEvent.change(screen.getByRole('textbox', { name: 'Mock composer draft' }), { target: { value: 'draft from context menu' } })

        fireEvent.click(screen.getByTitle('dashboard.openSessionMenu'))
        fireEvent.click(screen.getByText('dashboard.focus'))

        const focusedPanel = screen.getByTestId('focused-pinned-panel')
        expect(focusedPanel).toContainElement(screen.getByTestId('pinned-panel-chat'))
        expect(screen.getByTestId('pinned-panel-chat')).toHaveAttribute('data-instance-id', instanceId)
        expect(screen.getByRole('textbox', { name: 'Mock composer draft' })).toHaveValue('draft from context menu')
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('restores focus to a stable context menu opener after closing context-menu focus', () => {
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        const menuButton = screen.getByTitle('dashboard.openSessionMenu')
        fireEvent.click(menuButton)
        fireEvent.click(screen.getByText('dashboard.focus'))

        expect(screen.getByRole('button', { name: 'Close focus session' })).toHaveFocus()

        fireEvent.click(screen.getByRole('button', { name: 'Close focus session' }))

        expect(menuButton).toHaveFocus()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('makes the three-pin placeholder inert while a pinned panel is focused', () => {
        setMockSessions(3)
        const { container } = renderDashboard()

        fireEvent.click(screen.getByText('Build app 1'))
        fireEvent.click(screen.getByText('Build app 2'))
        fireEvent.click(screen.getByText('Build app 3'))
        fireEvent.click(screen.getAllByRole('button', { name: 'Mock focus session' })[0])

        const placeholder = container.querySelector('.db__pinned-placeholder')
        expect(placeholder).toHaveAttribute('inert')
        expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    })

    it('does not open focused pinned panel on mobile viewport', () => {
        setMediaMatches({ mobileViewport: true })
        renderDashboard()

        fireEvent.click(screen.getByText('Build app'))
        fireEvent.click(screen.getByTitle('dashboard.openSessionMenu'))
        fireEvent.click(screen.getByText('dashboard.focus'))

        expect(screen.queryByTestId('focused-pinned-panel')).not.toBeInTheDocument()
        expect(sessionChatUnmounts).not.toHaveBeenCalled()
    })

    it('opens the unified context menu from the explicit menu button', () => {
        renderDashboard()

        fireEvent.click(screen.getByTitle('dashboard.openSessionMenu'))

        expect(screen.getByText('dashboard.archiveSession')).toBeInTheDocument()
        expect(screen.getByText('dashboard.copySessionId')).toBeInTheDocument()
    })

    it('hides open in new tab from the mobile context menu', () => {
        setCoarsePointer(true)
        renderDashboard()

        fireEvent.click(screen.getByTitle('dashboard.openSessionMenu'))

        expect(screen.queryByText('dashboard.openInNewTab')).not.toBeInTheDocument()
        expect(screen.getByText('dashboard.copySessionId')).toBeInTheDocument()
    })

    it('toggles pin directly from the pin button without opening the context menu', () => {
        renderDashboard()
        const pinButton = screen.getByTitle('dashboard.pinSession')

        fireEvent.click(pinButton)
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe(JSON.stringify(['session-1']))
        expect(screen.queryByText('dashboard.archiveSession')).not.toBeInTheDocument()

        fireEvent.click(screen.getByTitle('dashboard.unpinSession'))
        expect(sessionStorage.getItem('mc-pinned-ids')).toBe('[]')
    })
})

describe('Dashboard mobile session switcher handle', () => {
    beforeEach(() => {
        navigate.mockClear()
        sessionChatUnmounts.mockClear()
        sessionStorage.clear()
        localStorage.clear()
        setMockSessions(3)
        mobileMedia = null
        setMediaMatches({ coarsePointer: true, mobileViewport: true })
    })

    afterEach(() => {
        cleanup()
        sessionStorage.clear()
        localStorage.clear()
    })

    it('shows a small right-edge handle when a session is pinned and opens the overview drawer on tap', () => {
        renderDashboard()
        fireEvent.click(screen.getByText('Build app 1'))

        const handle = screen.getByRole('button', { name: 'Open session switcher' })
        expect(handle).toBeInTheDocument()

        fireEvent.click(handle)

        expect(screen.getAllByText('3 sessions').length).toBeGreaterThan(1)
        expect(screen.getAllByText('Build app 2').length).toBeGreaterThan(1)
    })

    it('drags the right-edge handle vertically and stores the clamped position without opening the drawer', () => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
        renderDashboard()
        fireEvent.click(screen.getByText('Build app 1'))

        const handle = screen.getByRole('button', { name: 'Open session switcher' })
        dispatchPointer(handle, 'pointerdown', { pointerId: 1, clientY: 260 })
        dispatchPointer(window, 'pointermove', { pointerId: 1, clientY: 360 })
        dispatchPointer(window, 'pointerup', { pointerId: 1, clientY: 360 })
        fireEvent.click(handle)

        expect(localStorage.getItem('hapi:mobile-session-switcher-top')).toBe('360')
        expect(screen.getAllByText('3 sessions')).toHaveLength(1)
    })

    it('keeps the handle hidden before any session is pinned', () => {
        renderDashboard()

        expect(screen.queryByRole('button', { name: 'Open session switcher' })).not.toBeInTheDocument()
    })
})
