import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecryptedMessage, Session } from '@/types/api'
import { SessionChat } from './SessionChat'

const navigateMock = vi.fn()
const onSendMock = vi.fn()
const useAgentModelsMock = vi.hoisted(() => vi.fn(() => ({
    models: [],
    status: 'fallback',
    isLoading: false,
    error: null
})))
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock
}))

vi.mock('@assistant-ui/react', () => ({
    AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/lib/assistant-runtime', () => ({
    useHappyRuntime: () => ({})
}))

vi.mock('@/lib/attachmentAdapter', () => ({
    createAttachmentAdapter: () => ({})
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: vi.fn() } })
}))

vi.mock('@/hooks/useTelegram', () => ({
    isTelegramApp: () => false
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: [], isLoading: false })
}))

vi.mock('@/hooks/queries/useTeamChats', () => ({
    useTeamChats: () => ({ teamChats: [], isLoading: false, error: null, refetch: vi.fn() })
}))

vi.mock('@/hooks/queries/useSessionTeamMemberships', () => ({
    useSessionTeamMemberships: () => ({ memberships: [], isLoading: false, error: null, refetch: vi.fn() })
}))

vi.mock('@/hooks/queries/useSessionTeamMentions', () => ({
    useSessionTeamMentions: () => ({ requests: [] })
}))

vi.mock('@/hooks/queries/useCodexModels', () => ({
    useCodexModels: () => ({ models: [], error: null })
}))

vi.mock('@/hooks/queries/useAgentModels', () => ({
    useAgentModels: useAgentModelsMock
}))

vi.mock('@/hooks/queries/useOpencodeModels', () => ({
    useOpencodeModels: () => ({ availableModels: [], availableEfforts: [] })
}))

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        abortSession: vi.fn(),
        switchSession: vi.fn(),
        setPermissionMode: vi.fn(),
        setCollaborationMode: vi.fn(),
        setModel: vi.fn(),
        setModelReasoningEffort: vi.fn(),
        setEffort: vi.fn(),
        archiveSession: vi.fn(),
        renameSession: vi.fn(),
        deleteSession: vi.fn(),
        isPending: false
    })
}))

vi.mock('@/lib/voice-context', () => ({
    useVoiceOptional: () => null
}))

vi.mock('@/realtime', () => ({
    RealtimeVoiceSession: () => null,
    registerSessionStore: vi.fn(),
    registerVoiceHooksStore: vi.fn(),
    voiceHooks: {
        onMessages: vi.fn(),
        onReady: vi.fn(),
        onPermissionRequested: vi.fn()
    }
}))

vi.mock('@/utils/terminalSupport', () => ({
    isRemoteTerminalSupported: () => false
}))

vi.mock('@/components/AssistantChat/HappyThread', () => ({
    HappyThread: () => <div data-testid="happy-thread" />
}))

vi.mock('@/components/AssistantChat/HappyComposer', () => ({
    HappyComposer: () => <div data-testid="happy-composer" />
}))

vi.mock('@/components/AssistantChat/QueuedMessagesBar', () => ({
    QueuedMessagesBar: () => null
}))

vi.mock('@/components/AssistantChat/TeamMentionQueueBar', () => ({
    TeamMentionQueueBar: () => null
}))

vi.mock('@/components/TeamPanel', () => ({
    TeamPanel: () => null
}))

vi.mock('@/components/SessionActionMenu', () => ({
    SessionActionMenu: () => null
}))

vi.mock('@/components/RenameSessionDialog', () => ({
    RenameSessionDialog: () => null
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: () => null
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
        metadata: { path: '/repo', host: 'host', machineId: 'machine-1', flavor: 'claude' },
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

function makeCodexGoalMessage(): DecryptedMessage {
    return {
        id: 'goal-1',
        seq: 1,
        localId: null,
        createdAt: 1_776_272_490,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'codex_goal',
                    action: 'updated',
                    goal: {
                        threadId: 'thread-1',
                        objective: 'Ship Codex goal header control',
                        status: 'active',
                        tokenBudget: 200000,
                        tokensUsed: 12000,
                        timeUsedSeconds: 90,
                        createdAt: 1_776_272_400,
                        updatedAt: 1_776_272_490
                    }
                }
            }
        }
    }
}

function renderChat(session: Session = makeSession()) {
    return render(
        <SessionChat
            api={null as never}
            session={session}
            messages={[makeCodexGoalMessage()]}
            messagesWarning={null}
            hasMoreMessages={false}
            isLoadingMessages={false}
            isLoadingMoreMessages={false}
            isSending={false}
            pendingCount={0}
            messagesVersion={1}
            onBack={vi.fn()}
            onRefresh={vi.fn()}
            onLoadMore={() => Promise.resolve()}
            onSend={onSendMock}
            onFlushPending={vi.fn()}
            onAtBottomChange={vi.fn()}
        />
    )
}

describe('SessionChat Codex goal header control', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn((query: string) => ({
                matches: query.includes('max-width') ? false : true,
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn()
            }))
        })
    })

    afterEach(() => {
        cleanup()
        consoleErrorSpy.mockRestore()
    })

    it('keeps a loaded Codex goal viewable on non-Codex sessions but disables goal actions', () => {
        renderChat(makeSession({ metadata: { path: '/repo', host: 'host', machineId: 'machine-1', flavor: 'claude' } }))

        fireEvent.click(screen.getByRole('button', { name: 'Codex goal' }))

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Ship Codex goal header control')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Unset goal' })).toBeDisabled()

        fireEvent.click(screen.getByRole('button', { name: 'Unset goal' }))

        expect(onSendMock).not.toHaveBeenCalled()
        const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((call: unknown[]) =>
            call.some((arg: unknown) => String(arg).includes('Encountered two children with the same key'))
        )
        expect(duplicateKeyWarnings).toEqual([])
    })

    it('treats legacy sessions without an explicit flavor as Claude', () => {
        renderChat(makeSession({
            metadata: { path: '/repo', host: 'host', machineId: 'machine-1' }
        }))

        expect(useAgentModelsMock).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            enabled: true
        }))
    })
})
