import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Machine } from '@/types/api'
import { NewSession } from './index'

const spawnSessionMock = vi.fn()
const checkPathsExistsMock = vi.fn()
let agentModelsState = {
    models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
    status: 'dynamic' as const,
    isLoading: false,
    error: null as string | null
}

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: vi.fn() } })
}))

vi.mock('@/hooks/mutations/useSpawnSession', () => ({
    useSpawnSession: () => ({ spawnSession: spawnSessionMock, isPending: false, error: null })
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({ sessions: [] })
}))

vi.mock('@/hooks/useRecentPaths', () => ({
    useRecentPaths: () => ({
        getRecentPaths: () => [],
        addRecentPath: vi.fn(),
        getLastUsedMachineId: () => null,
        setLastUsedMachineId: vi.fn()
    })
}))

vi.mock('@/hooks/useMachinePathsExists', () => ({
    useMachinePathsExists: () => ({
        pathExistence: { '/repo': true },
        checkPathsExists: checkPathsExistsMock
    })
}))

vi.mock('@/hooks/useDirectorySuggestions', () => ({
    useDirectorySuggestions: () => []
}))

vi.mock('@/hooks/useActiveSuggestions', () => ({
    useActiveSuggestions: () => [[], -1, vi.fn(), vi.fn(), vi.fn()]
}))

vi.mock('@/hooks/queries/useCodexModels', () => ({
    useCodexModels: () => ({ models: [], isLoading: false, error: null })
}))

vi.mock('@/hooks/queries/useAgentModels', () => ({
    useAgentModels: () => agentModelsState
}))

vi.mock('@/hooks/queries/useOpencodeModelsForCwd', () => ({
    useOpencodeModelsForCwd: () => ({
        availableModels: [],
        availableEfforts: [],
        currentModelId: null,
        isLoading: false,
        error: null,
        refetch: vi.fn()
    })
}))

function makeMachine(): Machine {
    return {
        id: 'machine-1',
        active: true,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '1.0.0',
            workspaceRoot: '/repo'
        },
        runnerState: null
    }
}

describe('NewSession Codex resume', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        checkPathsExistsMock.mockResolvedValue({ '/repo': true })
        spawnSessionMock.mockResolvedValue({ type: 'success', sessionId: 'session-1' })
        agentModelsState = {
            models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
            status: 'dynamic',
            isLoading: false,
            error: null
        }
    })

    afterEach(() => {
        cleanup()
    })

    it('sends trimmed resumeSessionId when creating a Codex resume session', async () => {
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine()]}
                initialMachineId="machine-1"
                initialDirectory="/repo"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        fireEvent.click(screen.getByLabelText('codex'))
        fireEvent.click(screen.getByRole('checkbox', { name: /newSession.codexResume.title/ }))
        fireEvent.change(screen.getByLabelText('newSession.codexResume.sessionId'), {
            target: { value: ' 019ed35e-db26-7770-abb3-1c7ee3c92f52 ' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'newSession.create' }))

        await waitFor(() => {
            expect(spawnSessionMock).toHaveBeenCalledWith(expect.objectContaining({
                agent: 'codex',
                directory: '/repo',
                resumeSessionId: '019ed35e-db26-7770-abb3-1c7ee3c92f52'
            }))
        })
    })

    it('does not show Codex resume controls for non-Codex agents', () => {
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine()]}
                initialMachineId="machine-1"
                initialDirectory="/repo"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        expect(screen.queryByRole('checkbox', { name: /newSession.codexResume.title/ })).not.toBeInTheDocument()
        expect(screen.queryByLabelText('newSession.codexResume.sessionId')).not.toBeInTheDocument()
    })

    it('requires a Codex session id when resume mode is enabled', () => {
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine()]}
                initialMachineId="machine-1"
                initialDirectory="/repo"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        fireEvent.click(screen.getByLabelText('codex'))
        fireEvent.click(screen.getByRole('checkbox', { name: /newSession.codexResume.title/ }))

        expect(screen.getByRole('button', { name: 'newSession.create' })).toBeDisabled()
    })

    it('keeps Claude model selection disabled while provider policy is loading', () => {
        agentModelsState = { ...agentModelsState, isLoading: true }
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine()]}
                initialMachineId="machine-1"
                initialDirectory="/repo"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        expect(screen.getAllByRole('combobox')[1]).toBeDisabled()
    })

    it('resets a selected Claude model when the machine changes', async () => {
        const secondMachine = {
            ...makeMachine(),
            id: 'machine-2',
            metadata: { ...makeMachine().metadata!, host: 'second-host' }
        }
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine(), secondMachine]}
                initialMachineId="machine-1"
                initialDirectory="/repo"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        const [machineSelect, modelSelect] = screen.getAllByRole('combobox')
        fireEvent.change(modelSelect, { target: { value: 'claude-custom' } })
        expect(modelSelect).toHaveValue('claude-custom')
        fireEvent.change(machineSelect, { target: { value: 'machine-2' } })

        await waitFor(() => expect(modelSelect).toHaveValue('auto'))
    })

    it('restores and reports a modal draft across workspace navigation', async () => {
        const onDraftChange = vi.fn()
        render(
            <NewSession
                api={{} as never}
                machines={[makeMachine()]}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
                initialDraft={{
                    machineId: 'machine-1',
                    directory: '/repo',
                    agent: 'codex',
                    model: 'auto',
                    effort: 'auto',
                    modelReasoningEffort: 'high',
                    yoloMode: true,
                    sessionType: 'worktree',
                    worktreeName: 'mobile-dialogs',
                    resumeCodex: false,
                    resumeCodexSessionId: '',
                    opencodeSelectedModel: null,
                }}
                onDraftChange={onDraftChange}
            />
        )

        expect(screen.getByPlaceholderText('newSession.placeholder')).toHaveValue('/repo')
        expect(screen.getByLabelText('codex')).toBeChecked()
        expect(document.getElementById('session-type-worktree')).toBeChecked()
        expect(screen.getByPlaceholderText('newSession.type.worktree.placeholder'))
            .toHaveValue('mobile-dialogs')

        fireEvent.change(screen.getByPlaceholderText('newSession.placeholder'), {
            target: { value: '/repo/next' }
        })

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                machineId: 'machine-1',
                directory: '/repo/next',
                agent: 'codex',
                sessionType: 'worktree',
                worktreeName: 'mobile-dialogs',
            }))
        })
    })

})
