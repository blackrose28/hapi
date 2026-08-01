import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { runCodex } from './runCodex'

const mockCodexSession = vi.hoisted(() => ({
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    setModelReasoningEffort: vi.fn(),
    setCollaborationMode: vi.fn(),
    setServiceTier: vi.fn(),
    stopKeepAlive: vi.fn()
}))

const harness = vi.hoisted(() => ({
    bootstrapArgs: [] as Array<Record<string, unknown>>,
    loopArgs: [] as Array<Record<string, unknown>>,
    sessionInfo: null as Record<string, unknown> | null,
    session: {
        onUserMessage: vi.fn(),
        onCancelQueuedMessage: vi.fn(),
        rpcHandlerManager: {
            registerHandler: vi.fn()
        }
    }
}))

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: vi.fn(async (options: Record<string, unknown>) => {
        harness.bootstrapArgs.push(options)
        return {
            api: {},
            session: harness.session,
            sessionInfo: harness.sessionInfo
        }
    }),
    bootstrapLazySession: vi.fn(async (options: Record<string, unknown>) => {
        harness.bootstrapArgs.push({ ...options, lazy: true })
        return {
            api: {},
            session: harness.session,
            sessionInfo: harness.sessionInfo
        }
    }),
    bootstrapExistingSession: vi.fn(async (options: Record<string, unknown>) => {
        harness.bootstrapArgs.push(options)
        return {
            api: {},
            session: harness.session,
            sessionInfo: harness.sessionInfo
        }
    })
}))

vi.mock('./loop', () => ({
    loop: vi.fn(async (options: Record<string, unknown>) => {
        harness.loopArgs.push(options)
        const onSessionReady = options.onSessionReady as ((session: unknown) => void) | undefined
        onSessionReady?.(mockCodexSession)
    })
}))

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: vi.fn()
}))

const lifecycleMock = vi.hoisted(() => ({
    registerProcessHandlers: vi.fn(),
    cleanupAndExit: vi.fn(async () => {}),
    markCrash: vi.fn(),
    setExitCode: vi.fn(),
    setArchiveReason: vi.fn(),
    setSessionEndReason: vi.fn()
}))

vi.mock('@/agent/runnerLifecycle', () => ({
    createModeChangeHandler: vi.fn(() => vi.fn()),
    createRunnerLifecycle: vi.fn(() => lifecycleMock),
    setControlledByUser: vi.fn()
}))

vi.mock('@/agent/localHandoff', () => ({
    registerLocalHandoffHandler: vi.fn()
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}))

vi.mock('@/utils/attachmentFormatter', () => ({
    formatMessageWithAttachments: vi.fn((text: string) => text)
}))

vi.mock('@/modules/common/slashCommands', () => ({
    listSlashCommands: vi.fn(async () => [])
}))

vi.mock('./utils/slashCommands', () => ({
    resolveCodexSlashCommand: vi.fn(() => ({
        kind: 'passthrough'
    }))
}))

vi.mock('./codexSpecialCommands', () => ({
    parseCodexSpecialCommand: vi.fn(() => ({}))
}))

vi.mock('./utils/codexCliOverrides', () => ({
    parseCodexCliOverrides: vi.fn(() => ({}))
}))

import { runCodex as runCodexImpl } from './runCodex'

describe('runCodex', () => {
    beforeEach(() => {
        harness.bootstrapArgs.length = 0
        harness.loopArgs.length = 0
        harness.session.onUserMessage.mockReset()
        harness.session.onCancelQueuedMessage.mockReset()
        harness.session.rpcHandlerManager.registerHandler.mockReset()
        mockCodexSession.setPermissionMode.mockReset()
        mockCodexSession.setModel.mockReset()
        mockCodexSession.setModelReasoningEffort.mockReset()
        mockCodexSession.setCollaborationMode.mockReset()
        lifecycleMock.registerProcessHandlers.mockClear()
        lifecycleMock.cleanupAndExit.mockClear()
        lifecycleMock.markCrash.mockClear()
        lifecycleMock.setExitCode.mockClear()
        lifecycleMock.setArchiveReason.mockClear()
        lifecycleMock.setSessionEndReason.mockClear()
    })

    it('uses the requested collaboration mode when resuming locally', async () => {
        const options = {
            existingSessionId: 'hapi-session-1',
            workingDirectory: '/tmp/project',
            resumeSessionId: 'codex-thread-1',
            collaborationMode: 'plan'
        } as Parameters<typeof runCodex>[0] & { collaborationMode: 'plan' }

        await runCodexImpl(options)

        expect(harness.bootstrapArgs[0]).toEqual(expect.objectContaining({
            sessionId: 'hapi-session-1',
            workingDirectory: '/tmp/project'
        }))
        expect(harness.loopArgs[0]).toEqual(expect.objectContaining({
            resumeSessionId: 'codex-thread-1',
            collaborationMode: 'plan',
            replayTranscriptHistoryOnStart: false
        }))
        expect(mockCodexSession.setCollaborationMode).toHaveBeenLastCalledWith('plan')
    })

    it('uses lazy bootstrap for a fresh terminal launch', async () => {
        await runCodexImpl({ workingDirectory: '/tmp/project' })

        expect(harness.bootstrapArgs[0]).toEqual(expect.objectContaining({
            workingDirectory: '/tmp/project',
            lazy: true
        }))
        expect(harness.loopArgs[0]).toEqual(expect.objectContaining({
            replayTranscriptHistoryOnStart: true
        }))
    })

    it('keeps eager bootstrap for runner launches', async () => {
        await runCodexImpl({
            startedBy: 'runner',
            workingDirectory: '/tmp/project'
        })

        expect(harness.bootstrapArgs[0]).not.toHaveProperty('lazy')
    })
    it('replays transcript history when attaching a new Hapi session to an existing Codex thread', async () => {
        await runCodexImpl({
            workingDirectory: '/tmp/project',
            resumeSessionId: 'codex-thread-2'
        })

        expect(harness.loopArgs[0]).toEqual(expect.objectContaining({
            resumeSessionId: 'codex-thread-2',
            replayTranscriptHistoryOnStart: true
        }))
    })
})
