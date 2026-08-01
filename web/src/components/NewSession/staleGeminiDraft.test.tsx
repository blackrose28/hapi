import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Machine } from '@/types/api'
import { NewSession } from './index'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: vi.fn() } })
}))

vi.mock('@/hooks/mutations/useSpawnSession', () => ({
    useSpawnSession: () => ({ spawnSession: vi.fn(), isPending: false, error: null })
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
        pathExistence: {},
        checkPathsExists: vi.fn()
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
    useAgentModels: () => ({ models: [], status: 'dynamic', isLoading: false, error: null })
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

vi.mock('@/hooks/queries/useGrokModelsForCwd', () => ({
    useGrokModelsForCwd: () => ({
        availableModels: [],
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

describe('NewSession stale Gemini draft coercion', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        cleanup()
    })

    it('coerces a pre-removal gemini draft to claude and resets dependent fields', async () => {
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
                    agent: 'gemini' as never,
                    model: 'gemini-2.5-pro',
                    effort: 'high' as never,
                    modelReasoningEffort: 'high',
                    yoloMode: true,
                    sessionType: 'simple',
                    worktreeName: '',
                    resumeCodex: false,
                    resumeCodexSessionId: '',
                    opencodeSelectedModel: null,
                }}
                onDraftChange={onDraftChange}
            />
        )

        // The selector no longer offers Gemini at all, and the coerced agent
        // (claude) is selected instead of the stale draft value.
        expect(screen.queryByLabelText('Gemini')).not.toBeInTheDocument()
        expect(screen.getByLabelText('Claude')).toBeChecked()

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
                agent: 'claude',
                // agent-dependent fields reset so a Gemini model isn't carried into Claude
                model: 'auto',
                effort: 'auto',
                modelReasoningEffort: 'default',
                // agent-independent fields preserved
                yoloMode: true,
                machineId: 'machine-1',
            }))
        })
    })
})
