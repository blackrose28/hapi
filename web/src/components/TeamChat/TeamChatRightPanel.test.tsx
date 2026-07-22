import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamChatRightPanel } from './TeamChatRightPanel'

vi.mock('@/components/NewSession', () => ({
    NewSession: (props: {
        initialDirectory?: string
        initialMachineId?: string
        createLabel?: string
        onSuccess: (sessionId: string) => void
        onChooseFolder?: (args: { machineId: string | null; directory: string }) => void
    }) => (
        <div aria-label="Full New Session form">
            <div>Recent paths</div>
            <button type="button" onClick={() => props.onChooseFolder?.({ machineId: props.initialMachineId ?? null, directory: props.initialDirectory ?? '' })}>Browse</button>
            <label>Agent<select><option>Codex</option></select></label>
            <label>Model<select><option>Default</option></select></label>
            <label>Reasoning effort<select><option>Default</option></select></label>
            <label><input type="checkbox" /> YOLO mode</label>
            <button type="button" onClick={() => props.onSuccess('session-new')}>{props.createLabel ?? 'Create'}</button>
        </div>
    )
}))

afterEach(() => {
    cleanup()
})

it('renders needs attention items from blocked reports and pending mentions', () => {
    render(<TeamChatRightPanel
        participants={[{ id: 'p1', teamChatId: 'team-1', type: 'session', sessionId: 's1', displayName: 'Backend', role: 'backend', color: '#60a5fa', joinedAt: 1 }]}
        messages={[{ id: 'm1', teamChatId: 'team-1', seq: 1, authorParticipantId: 'p1', text: 'Blocked on schema', reportType: 'blocked', mentions: [], files: [], createdAt: 2 }]}
        mentionRequests={[{ id: 'r1', teamChatId: 'team-1', sourceMessageId: 'm0', targetSessionId: 's1', status: 'pending', createdAt: 1 }]}
    />)

    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Waiting for response')).toBeInTheDocument()
})

it('lets the user add an existing session from a grouped status tree', async () => {
    const onAddSession = vi.fn()
    const onCreateSessionMember = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p1', teamChatId: 'team-1', type: 'session', sessionId: 's1', displayName: 'Backend', role: 'backend', color: '#60a5fa', joinedAt: 1 }]}
        availableSessions={[
            { id: 's1', active: true, thinking: false, activeAt: 1, updatedAt: 1, metadata: { path: '/repo/hapi', machineId: 'machine-a', name: 'Backend' }, todoProgress: null, pendingRequestsCount: 0, model: null, effort: null },
            { id: 's2', active: true, thinking: true, activeAt: 2, updatedAt: 4, metadata: { path: '/repo/hapi', machineId: 'machine-a', name: 'Frontend polish' }, todoProgress: null, pendingRequestsCount: 0, model: null, effort: null },
            { id: 's3', active: false, thinking: false, activeAt: 3, updatedAt: 3, metadata: { path: '/repo/hapi', machineId: 'machine-a', name: 'Old review' }, todoProgress: null, pendingRequestsCount: 0, model: null, effort: null },
            { id: 's4', active: true, thinking: false, activeAt: 4, updatedAt: 2, metadata: { path: '/repo/hub', machineId: 'machine-a', name: 'Hub API' }, todoProgress: null, pendingRequestsCount: 1, model: null, effort: null }
        ]}
        onAddSession={onAddSession}
        onCreateSessionMember={onCreateSessionMember}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Add member/i }))

    expect(screen.getByRole('dialog', { name: /Add member/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Existing session/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /New session/i })).toBeInTheDocument()

    const tree = screen.getByRole('tree', { name: /Available sessions/i })
    expect(within(tree).getByRole('treeitem', { name: /hapi/i })).toBeInTheDocument()
    expect(within(tree).getByRole('treeitem', { name: /hub/i })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /Frontend polish.*Working/i })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /Hub API.*Needs input/i })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /Old review.*Idle/i })).toBeInTheDocument()

    fireEvent.click(within(tree).getByRole('button', { name: /Frontend polish.*Working/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /Team alias/i }), { target: { value: 'UI' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to Team/i }))

    expect(onAddSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), 'UI')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Add member/i })).not.toBeInTheDocument())
})

it('lets the user create a full NewSession member with a session label, default alias, and optional initial task', async () => {
    const onCreateSessionMember = vi.fn()
    render(<TeamChatRightPanel
        api={{} as never}
        participants={[{ id: 'p1', teamChatId: 'team-1', type: 'user', displayName: 'You', role: 'general', color: '#34d399', joinedAt: 1 }]}
        machines={[
            { id: 'machine-a', active: true, metadata: { host: 'local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Local' } }
        ]}
        defaultMachineId="machine-a"
        defaultProjectPath="/repo/hapi"
        onCreateSessionMember={onCreateSessionMember}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Add member/i }))
    fireEvent.click(screen.getByRole('tab', { name: /New session/i }))
    expect(screen.getByLabelText('Full New Session form')).toBeInTheDocument()
    expect(screen.getByText('Recent paths')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Agent/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Reasoning effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/YOLO mode/i)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /Session label/i }), { target: { value: 'Backend API' } })
    expect(screen.getByRole('textbox', { name: /Team alias/i })).toHaveValue('Backend API')
    fireEvent.change(screen.getByRole('textbox', { name: /Team alias/i }), { target: { value: 'Backend API' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Initial task/i }), { target: { value: 'Review the Team Chat API.' } })
    fireEvent.click(screen.getByRole('button', { name: /Create session & add to Team/i }))

    expect(onCreateSessionMember).toHaveBeenCalledWith({
        sessionId: 'session-new',
        label: 'Backend API',
        alias: 'Backend API',
        initialTask: 'Review the Team Chat API.'
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Add member/i })).not.toBeInTheDocument())
})

it('prevents duplicate aliases in the Team Chat picker', () => {
    const onAddSession = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p1', teamChatId: 'team-1', type: 'session', sessionId: 's1', displayName: 'Backend', role: 'backend', color: '#60a5fa', joinedAt: 1 }]}
        availableSessions={[
            { id: 's2', active: true, thinking: false, activeAt: 1, updatedAt: 2, metadata: { path: '/repo/hapi', name: 'Frontend polish' }, todoProgress: null, pendingRequestsCount: 0, model: null, effort: null }
        ]}
        onAddSession={onAddSession}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Add member/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /Team alias/i }), { target: { value: 'backend' } })

    expect(screen.getByText('Alias already used in this Team Chat.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add to Team/i })).toBeDisabled()
})

it('opens member actions from the three-dot menu with view configure and remove options', () => {
    const onOpenSession = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p2', teamChatId: 'team-1', type: 'session', sessionId: 's2', displayName: 'UI', role: 'frontend', color: '#a78bfa', joinedAt: 1 }]}
        availableSessions={[{ id: 's2', active: true, thinking: false, activeAt: 2, updatedAt: 4, metadata: { path: '/repo/hapi', machineId: 'machine-a', name: 'Frontend polish', flavor: 'codex' }, todoProgress: null, pendingRequestsCount: 0, model: 'gpt-5.4', effort: null }]}
        onOpenSession={onOpenSession}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Actions for @UI/i }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Xem' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Cấu hình' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Remove khỏi Team Chat/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Xem' }))

    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', sessionId: 's2' }))
})

it('confirms removing a member from the Team Chat', async () => {
    const onRemoveParticipant = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p2', teamChatId: 'team-1', type: 'session', sessionId: 's2', displayName: 'UI', role: 'frontend', color: '#a78bfa', joinedAt: 1 }]}
        onRemoveParticipant={onRemoveParticipant}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Actions for @UI/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove khỏi Team Chat/i }))

    expect(screen.getByRole('dialog', { name: /Remove @UI/i })).toBeInTheDocument()
    expect(screen.getByText(/Session gốc sẽ không bị xoá/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }))

    expect(onRemoveParticipant).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', sessionId: 's2' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Remove @UI/i })).not.toBeInTheDocument())
})

it('configures Team-scoped member alias role and color', async () => {
    const onUpdateParticipant = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p2', teamChatId: 'team-1', type: 'session', sessionId: 's2', displayName: 'UI', role: 'frontend', color: '#a78bfa', joinedAt: 1 }]}
        onUpdateParticipant={onUpdateParticipant}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Actions for @UI/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cấu hình' }))

    expect(screen.getByRole('dialog', { name: /Cấu hình @UI/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Member' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.change(screen.getByRole('textbox', { name: /Team alias/i }), { target: { value: 'UI Lead' } })
    fireEvent.change(screen.getByLabelText(/Role/i), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Color$/i }), { target: { value: '#60a5fa' } })
    fireEvent.click(screen.getByRole('button', { name: /Save member config/i }))

    expect(onUpdateParticipant).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p2' }),
        { displayName: 'UI Lead', role: 'reviewer', color: '#60a5fa' }
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Cấu hình @UI/i })).not.toBeInTheDocument())
})

it('renders original session settings from the member config Session tab', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const api = {
        getSession: vi.fn(async () => ({
            session: {
                id: 's2',
                active: true,
                thinking: false,
                activeAt: 1,
                updatedAt: 1,
                metadata: { path: '/repo/hapi', flavor: 'claude', name: 'Frontend polish' },
                agentState: null,
                permissionMode: 'default',
                collaborationMode: 'default',
                model: null,
                modelReasoningEffort: null,
                effort: null,
                todos: [],
                messages: []
            }
        }))
    }

    render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <TeamChatRightPanel
                    api={api as never}
                    participants={[{ id: 'p2', teamChatId: 'team-1', type: 'session', sessionId: 's2', displayName: 'UI', role: 'frontend', color: '#a78bfa', joinedAt: 1 }]}
                />
            </I18nProvider>
        </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Actions for @UI/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cấu hình' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Session' }))

    expect(await screen.findByText(/These settings affect the original session/i)).toBeInTheDocument()
    expect(screen.getByText(/Permission Mode/i)).toBeInTheDocument()
    expect(await screen.findByText(/^Model$/i)).toBeInTheDocument()
})

it('shows live session status in members and opens the direct chat for a member', () => {
    const onOpenSession = vi.fn()
    render(<TeamChatRightPanel
        participants={[{ id: 'p2', teamChatId: 'team-1', type: 'session', sessionId: 's2', displayName: 'UI', role: 'frontend', color: '#a78bfa', joinedAt: 1 }]}
        availableSessions={[
            {
                id: 's2',
                active: true,
                thinking: true,
                activeAt: 2,
                updatedAt: 4,
                metadata: { path: '/repo/hapi', machineId: 'machine-a', name: 'Frontend polish' },
                todoProgress: { completed: 2, total: 5 },
                pendingRequestsCount: 0,
                model: 'gpt-5.4',
                effort: 'high'
            }
        ]}
        onOpenSession={onOpenSession}
    />)

    const memberButton = screen.getByRole('button', { name: /Open @UI direct chat.*Working/i })
    expect(memberButton).toHaveTextContent('@UI')
    expect(memberButton).toHaveTextContent('Frontend polish')
    expect(memberButton).toHaveTextContent('Working')
    expect(memberButton).toHaveTextContent('gpt-5.4')
    expect(memberButton).toHaveTextContent('2/5 todo')

    fireEvent.click(memberButton)

    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', sessionId: 's2', displayName: 'UI' }))
})
