import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexGoalState } from '@/chat/types'
import type { Session, TeamChat, TeamParticipant } from '@/types/api'
import { SessionHeader } from './SessionHeader'

const navigateMock = vi.fn()
const useTeamChatsMock = vi.fn<() => { teamChats: TeamChat[]; isLoading: boolean; error: string | null; refetch: () => Promise<unknown> | unknown }>(() => ({ teamChats: [], isLoading: false, error: null, refetch: vi.fn() }))
const useSessionTeamMembershipsMock = vi.fn<() => {
    memberships: Array<{ teamChat: TeamChat; participant: TeamParticipant }>
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown> | unknown
}>(() => ({ memberships: [], isLoading: false, error: null, refetch: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock
}))

vi.mock('@/hooks/useTelegram', () => ({
    isTelegramApp: () => false
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: [], isLoading: false })
}))

vi.mock('@/hooks/queries/useTeamChats', () => ({
    useTeamChats: () => useTeamChatsMock()
}))

vi.mock('@/hooks/queries/useSessionTeamMemberships', () => ({
    useSessionTeamMemberships: () => useSessionTeamMembershipsMock()
}))

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        archiveSession: vi.fn(),
        renameSession: vi.fn(),
        deleteSession: vi.fn(),
        isPending: false
    })
}))

vi.mock('@/components/SessionActionMenu', () => ({
    SessionActionMenu: (props: { isOpen: boolean; onArchive: () => void }) => (
        props.isOpen ? <button type="button" onClick={props.onArchive}>Archive session</button> : null
    )
}))

vi.mock('@/components/RenameSessionDialog', () => ({
    RenameSessionDialog: () => null
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: (props: { isOpen: boolean; description: string }) => (
        props.isOpen ? <div role="dialog">{props.description}</div> : null
    )
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const messages: Record<string, string> = {
                'dialog.archive.description': 'Archive "{name}"? You can still find it in archived sessions.',
                'dialog.archive.terminalImpact': 'Archiving will stop all running terminals in this session.',
                'dialog.archive.terminalCount': 'Running terminals: {n}/{max}',
                'session.tasks.label': 'Tasks',
                'session.tasks.trigger': 'Session tasks: {completed} of {total} completed',
                'session.tasks.title': 'Session tasks',
                'session.tasks.progress': '{completed} of {total} completed',
                'session.tasks.status.pending': 'Pending',
                'session.tasks.status.in_progress': 'In progress',
                'session.tasks.status.completed': 'Completed'
            }
            let value = messages[key] ?? key
            for (const [param, replacement] of Object.entries(params ?? {})) {
                value = value.replace(`{${param}}`, String(replacement))
            }
            return value
        }
    })
}))

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: { path: '/repo', host: 'host', machineId: 'machine-1', flavor: 'codex' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        backgroundTaskCount: 0,
        todos: undefined,
        teamState: undefined,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: undefined,
        ...overrides
    }
}

function makeGoal(overrides: Partial<CodexGoalState> = {}): CodexGoalState {
    return {
        threadId: 'thread-1',
        objective: 'Ship Codex goal header control',
        status: 'active',
        tokenBudget: 200_000,
        tokensUsed: 12_000,
        timeUsedSeconds: 90,
        createdAt: 1,
        updatedAt: 2,
        ...overrides
    }
}

function setDesktopViewport(isDesktop: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn((query: string) => ({
            matches: query.includes('max-width') ? !isDesktop : isDesktop,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn()
        }))
    })
}

function setLegacyDesktopViewport(isDesktop: boolean) {
    const media = {
        matches: !isDesktop,
        media: '(max-width: 768px)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
    }
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn(() => media)
    })
    return media
}

describe('SessionHeader editor entry point', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setDesktopViewport(true)
        useTeamChatsMock.mockReturnValue({ teamChats: [], isLoading: false, error: null, refetch: vi.fn() })
        useSessionTeamMembershipsMock.mockReturnValue({ memberships: [], isLoading: false, error: null, refetch: vi.fn() })
    })

    afterEach(() => {
        cleanup()
    })

    it('opens the session project in editor mode', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={null} /></QueryClientProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }))

        expect(navigateMock).toHaveBeenCalledWith({
            to: '/editor',
            search: { machine: 'machine-1', project: '/repo' }
        })
    })

    it('hides the editor action when machine or path is missing', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession({ metadata: { path: '/repo', host: 'host' } })} onBack={vi.fn()} api={null} /></QueryClientProvider>)

        expect(screen.queryByRole('button', { name: 'Open in Editor' })).not.toBeInTheDocument()
    })

    it('does not show the Codex goal button when no goal is available', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={null} onGoalCommand={vi.fn()} /></QueryClientProvider>)

        expect(screen.queryByRole('button', { name: 'Codex goal' })).not.toBeInTheDocument()
    })

    it('hides the session task control when the snapshot is empty', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession({ todos: [] })} onBack={vi.fn()} api={null} /></QueryClientProvider>)

        expect(screen.queryByRole('button', { name: /Session tasks:/ })).not.toBeInTheDocument()
    })

    it('shows the normal task counter and opens its dialog', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession({
                        todos: [
                            { id: '1', content: 'Done task', status: 'completed', priority: 'medium' },
                            { id: '2', content: 'Current task', status: 'in_progress', priority: 'high' }
                        ]
                    })}
                    onBack={vi.fn()}
                    api={null}
                />
            </QueryClientProvider>
        )

        const trigger = screen.getByRole('button', { name: 'Session tasks: 1 of 2 completed' })
        expect(trigger).not.toHaveTextContent('Tasks')
        expect(trigger).toHaveTextContent('1/2')
        expect(trigger.parentElement).toHaveClass('session-provider-tasks')
        expect(trigger.parentElement).toHaveTextContent('codex')

        fireEvent.click(trigger)

        expect(screen.getByRole('dialog')).toHaveTextContent('Done task')
        expect(screen.getByRole('dialog')).toHaveTextContent('Current task')
    })

    it('shows the compact task counter without the label and opens the same dialog', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession({
                        todos: [
                            { id: '1', content: 'Done task', status: 'completed', priority: 'medium' },
                            { id: '2', content: 'Current task', status: 'in_progress', priority: 'high' }
                        ]
                    })}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                />
            </QueryClientProvider>
        )

        const trigger = screen.getByRole('button', { name: 'Session tasks: 1 of 2 completed' })
        expect(trigger).toHaveTextContent('1/2')
        expect(trigger).not.toHaveTextContent('Tasks')
        expect(trigger.parentElement).toHaveClass('session-provider-tasks')
        expect(trigger.parentElement).toHaveTextContent('codex')
        expect(trigger.closest('.db-pinned__compact-actions')).toBeNull()

        fireEvent.click(trigger)

        expect(screen.getByRole('dialog')).toHaveTextContent('Done task')
        expect(screen.getByRole('dialog')).toHaveTextContent('Current task')
    })

    it('does not focus the session when double-clicking the compact task control', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onFocusSession = vi.fn()
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession({
                        todos: [{ id: '1', content: 'Task', status: 'pending', priority: 'medium' }]
                    })}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={onFocusSession}
                />
            </QueryClientProvider>
        )

        fireEvent.doubleClick(screen.getByRole('button', { name: 'Session tasks: 0 of 1 completed' }))

        expect(onFocusSession).not.toHaveBeenCalled()
    })

    it('shows the Codex goal button when a Codex session has goal state', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={null} codexGoal={makeGoal()} onGoalCommand={vi.fn()} /></QueryClientProvider>)

        const button = screen.getByRole('button', { name: 'Codex goal' })
        expect(button).toBeInTheDocument()
        expect(button).toHaveAttribute('title', 'Ship Codex goal header control')
    })

    it('shows archive terminal impact copy when terminal count is available', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader session={makeSession({ terminalLiveCount: 2 })} onBack={vi.fn()} api={null} />
            </QueryClientProvider>
        )

        fireEvent.click(screen.getByTitle('session.more'))
        fireEvent.click(screen.getByRole('button', { name: 'Archive session' }))

        expect(screen.getByRole('dialog')).toHaveTextContent('Archiving will stop all running terminals in this session.')
        expect(screen.getByRole('dialog')).toHaveTextContent('Running terminals: 2/3')
    })

    it('sends a clear goal command from the header goal modal', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onGoalCommand = vi.fn()
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={null} codexGoal={makeGoal()} onGoalCommand={onGoalCommand} /></QueryClientProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))
        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onGoalCommand).toHaveBeenCalledWith('/goal clear')
    })

    it('keeps an accidentally passed non-Codex goal viewable but disables actions', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onGoalCommand = vi.fn()
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession({ metadata: { path: '/repo', host: 'host', machineId: 'machine-1', flavor: 'claude' } })}
                    onBack={vi.fn()}
                    api={null}
                    codexGoal={makeGoal()}
                    onGoalCommand={onGoalCommand}
                />
            </QueryClientProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Ship Codex goal header control')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Unset goal' })).toBeDisabled()

        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onGoalCommand).not.toHaveBeenCalled()
    })

    it('keeps an inactive Codex goal viewable but disables actions', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onGoalCommand = vi.fn()
        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession({ active: false })}
                    onBack={vi.fn()}
                    api={null}
                    codexGoal={makeGoal()}
                    onGoalCommand={onGoalCommand}
                />
            </QueryClientProvider>
        )

        const button = screen.getByRole('button', { name: 'Codex goal' })
        expect(button).toBeInTheDocument()
        fireEvent.click(button)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Ship Codex goal header control')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Unset goal' })).toBeDisabled()

        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onGoalCommand).not.toHaveBeenCalled()
    })

    it('shows this sessions Team Chat aliases near the session title', () => {
        useSessionTeamMembershipsMock.mockReturnValue({
            memberships: [{
                teamChat: { id: 'team-1', namespace: 'default', name: 'Frontend Team', projectPath: '/repo', createdAt: 1, updatedAt: 2 },
                participant: { id: 'p1', teamChatId: 'team-1', type: 'session', sessionId: 'session-1', displayName: 'UI', role: 'frontend', color: '#60a5fa', joinedAt: 3 }
            }],
            isLoading: false,
            error: null,
            refetch: vi.fn()
        })
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={{} as never} /></QueryClientProvider>)

        expect(screen.getByText('Frontend Team: @UI')).toBeInTheDocument()
    })

    it('creates a Team Chat with the current session', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const api = {
            createTeamChat: vi.fn(async () => ({ teamChat: { id: 'team-1' } })),
            addTeamParticipant: vi.fn(async () => ({ participant: { id: 'participant-1' } }))
        }
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={api as never} /></QueryClientProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'Open Team Chat menu' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create Team Chat with this session' }))

        await vi.waitFor(() => expect(api.createTeamChat).toHaveBeenCalledWith({ name: 'repo', projectPath: '/repo' }))
        expect(api.addTeamParticipant).toHaveBeenCalledWith('team-1', {
            type: 'session',
            sessionId: 'session-1',
            displayName: 'repo',
            role: 'general',
            color: '#60a5fa'
        })
        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({
            to: '/team-chats/$teamChatId',
            params: { teamChatId: 'team-1' }
        }))
    })


    it('adds the current session to an existing Team Chat from the picker', async () => {
        useTeamChatsMock.mockReturnValue({
            teamChats: [
                { id: 'team-2', namespace: 'default', name: 'Frontend Team', projectPath: '/repo', createdAt: 1, updatedAt: 2 }
            ],
            isLoading: false,
            error: null,
            refetch: vi.fn()
        })
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const api = {
            createTeamChat: vi.fn(),
            addTeamParticipant: vi.fn(async () => ({ participant: { id: 'participant-1' } }))
        }
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={api as never} /></QueryClientProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'Open Team Chat menu' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add to Frontend Team' }))

        await waitFor(() => expect(api.addTeamParticipant).toHaveBeenCalledWith('team-2', {
            type: 'session',
            sessionId: 'session-1',
            displayName: 'repo',
            role: 'general',
            color: '#60a5fa'
        }))
        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({
            to: '/team-chats/$teamChatId',
            params: { teamChatId: 'team-2' }
        }))
    })

    it('uses the requested alias when adding the current session from the header menu', async () => {
        useTeamChatsMock.mockReturnValue({
            teamChats: [
                { id: 'team-2', namespace: 'default', name: 'Frontend Team', projectPath: '/repo', createdAt: 1, updatedAt: 2 }
            ],
            isLoading: false,
            error: null,
            refetch: vi.fn()
        })
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const api = {
            createTeamChat: vi.fn(),
            addTeamParticipant: vi.fn(async () => ({ participant: { id: 'participant-1' } }))
        }
        render(<QueryClientProvider client={qc}><SessionHeader session={makeSession()} onBack={vi.fn()} api={api as never} /></QueryClientProvider>)

        fireEvent.click(screen.getByRole('button', { name: 'Open Team Chat menu' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Team alias' }), { target: { value: 'UI' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add to Frontend Team' }))

        await waitFor(() => expect(api.addTeamParticipant).toHaveBeenCalledWith('team-2', expect.objectContaining({
            displayName: 'UI'
        })))
    })

    it('shows a desktop-only compact focus button and opens focus from it', () => {
        setDesktopViewport(true)
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onFocusSession = vi.fn()

        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession()}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={onFocusSession}
                />
            </QueryClientProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Focus session' }))

        expect(onFocusSession).toHaveBeenCalledTimes(1)
    })

    it('opens focus when double-clicking the compact header title on desktop', () => {
        setDesktopViewport(true)
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onFocusSession = vi.fn()

        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession()}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={onFocusSession}
                />
            </QueryClientProvider>
        )

        fireEvent.doubleClick(screen.getAllByText('repo')[0])

        expect(onFocusSession).toHaveBeenCalledTimes(1)
    })

    it('does not open focus when double-clicking compact header action buttons', () => {
        setDesktopViewport(true)
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onFocusSession = vi.fn()
        const onBack = vi.fn()

        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession()}
                    onBack={onBack}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={onFocusSession}
                />
            </QueryClientProvider>
        )

        fireEvent.doubleClick(screen.getByRole('button', { name: 'button.files' }))
        fireEvent.doubleClick(screen.getByRole('button', { name: 'button.terminal' }))
        fireEvent.doubleClick(screen.getByRole('button', { name: 'session.more' }))
        fireEvent.doubleClick(screen.getByRole('button', { name: 'Unpin this session' }))

        expect(onFocusSession).not.toHaveBeenCalled()
    })

    it('does not render compact focus controls or double-click behavior on mobile', () => {
        setDesktopViewport(false)
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const onFocusSession = vi.fn()

        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession()}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={onFocusSession}
                />
            </QueryClientProvider>
        )

        expect(screen.queryByRole('button', { name: 'Focus session' })).not.toBeInTheDocument()
        fireEvent.doubleClick(screen.getAllByText('repo')[0])

        expect(onFocusSession).not.toHaveBeenCalled()
    })


    it('uses legacy matchMedia listener fallback and cleanup when event listener APIs are missing', () => {
        const media = setLegacyDesktopViewport(true)
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        render(
            <QueryClientProvider client={qc}>
                <SessionHeader
                    session={makeSession()}
                    onBack={vi.fn()}
                    api={null}
                    compactMode
                    pinIndex={1}
                    onFocusSession={vi.fn()}
                />
            </QueryClientProvider>
        )

        expect(media.addListener).toHaveBeenCalledTimes(1)

        cleanup()

        expect(media.removeListener).toHaveBeenCalledTimes(1)
        expect(media.removeListener).toHaveBeenCalledWith(media.addListener.mock.calls[0][0])
    })

})
