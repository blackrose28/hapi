import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { beforeEach, describe, expect, it, vi } from 'vitest'

var ioMock = vi.fn()
var axiosGetMock = vi.fn()
var axiosPostMock = vi.fn()

vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => ioMock(...args)
}))

vi.mock('axios', () => ({
    default: {
        get: (...args: unknown[]) => axiosGetMock(...args),
        post: (...args: unknown[]) => axiosPostMock(...args)
    }
}))

vi.mock('../modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: () => { }
}))

import { ApiSessionClient, isExternalUserMessage, IncomingMessageFilter } from './apiSession'
import { TerminalManager } from '@/terminal/TerminalManager'
import { configuration } from '@/configuration'
import type { Metadata, Session } from './types'

describe('isExternalUserMessage', () => {
    const baseUserMsg = {
        type: 'user' as const,
        uuid: 'test-uuid',
        userType: 'external' as const,
        isSidechain: false,
        message: { role: 'user', content: 'hello' },
    }

    it('returns true for a real user text message', () => {
        expect(isExternalUserMessage(baseUserMsg)).toBe(true)
    })

    it('returns false when isMeta is true (skill injections)', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isMeta: true })).toBe(false)
    })

    it('returns false when isSidechain is true', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isSidechain: true })).toBe(false)
    })

    it('returns false when content is an array (tool results)', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] },
            } as never)
        ).toBe(false)
    })

    it('returns false for assistant messages', () => {
        expect(
            isExternalUserMessage({
                type: 'assistant',
                uuid: 'test-uuid',
                message: { role: 'assistant', content: 'hi' },
            } as never)
        ).toBe(false)
    })

    // System-injected content detection
    it('returns false for <task-notification> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<task-notification>\n<task-id>abc123</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })

    it('returns false for <command-name> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<command-name>/clear</command-name>' },
            })
        ).toBe(false)
    })

    it('returns false for <local-command-caveat> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' },
            })
        ).toBe(false)
    })

    it('returns false for <system-reminder> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<system-reminder>\nToday is 2026.\n</system-reminder>' },
            })
        ).toBe(false)
    })

    it('returns true for user text that mentions XML-like strings but is not injected', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: 'How do I use the <task-notification> tag?' },
            })
        ).toBe(true)
    })

    it('returns false for <task-notification> with leading whitespace', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '  \n<task-notification>\n<task-id>x</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })
})

<<<<<<< HEAD

describe('ApiSessionClient.updateMetadata', () => {
    const now = 1_710_000_000_000

    beforeEach(() => {
        vi.restoreAllMocks()
        ioMock.mockReset()
        axiosGetMock.mockReset()
        axiosPostMock.mockReset()
    })

    function makeSocket() {
        const handlers = new Map<string, (...args: unknown[]) => void>()
        return {
            handlers,
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                handlers.set(event, handler)
            }),
            off: vi.fn(),
            connect: vi.fn(),
            emit: vi.fn(),
            emitWithAck: vi.fn(async () => ({ result: 'success', version: 2, metadata: { path: '/tmp/project', host: 'test-host' } })),
            volatile: { emit: vi.fn() },
            trigger(event: string, payload: unknown): void {
                const handler = handlers.get(event)
                if (!handler) throw new Error(`No handler registered for ${event}`)
                handler(payload)
            }
        }
    }

    function makeSession(metadata: Metadata): Session {
        return {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: now,
            updatedAt: now,
            active: true,
            activeAt: now,
            metadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: now,
            todos: [],
            model: null,
            modelReasoningEffort: null,
            effort: null,
            permissionMode: undefined,
            collaborationMode: undefined
        }
    }

    it('does not emit when handler returns the current metadata object', async () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const current: Metadata = { path: '/tmp/project', host: 'test-host' }
        const client = new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession(current))

        await new Promise<void>((resolve) => {
            client.updateMetadata((metadata) => {
                expect(metadata).toBe(current)
                resolve()
                return metadata
            })
        })

        await Promise.resolve()

        expect(fakeSocket.emitWithAck).not.toHaveBeenCalled()
    })

    it('advertises terminal history support during the CLI socket handshake', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)

        new ApiSessionClient(
            { kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' },
            makeSession({ path: '/tmp/project', host: 'test-host' })
        )

        expect(ioMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                auth: expect.objectContaining({
                    capabilities: expect.arrayContaining(['terminal-history-v1'])
                })
            })
        )
    })



    it('marks a Team mention no-action through the CLI session-scoped route', async () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        configuration._setApiUrl('http://hub.test')
        axiosPostMock.mockResolvedValue({
            data: {
                request: {
                    id: 'req/1',
                    teamChatId: 'team/1',
                    sourceMessageId: 'msg/1',
                    targetSessionId: 'session-1',
                    status: 'no_action',
                    contextSnapshot: {
                        originalText: '@Backend check this',
                        sharedContext: { goal: '', decisions: [], openQuestions: [] },
                        attachedFiles: []
                    },
                    hopDepth: 0,
                    createdAt: 1,
                    resolvedAt: 2
                }
            }
        })
        const client = new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        const result = await client.markTeamMentionNoAction({ requestId: 'req/1' })

        expect(result.request.id).toBe('req/1')
        expect(axiosPostMock).toHaveBeenCalledWith(
            'http://hub.test/cli/sessions/session-1/team-mentions/req%2F1/no-action',
            {},
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: `Runner cred.${'x'.repeat(32)}`,
                    'X-Hapi-Machine-Id': 'machine'
                }),
                timeout: 15_000
            })
        )
    })





    it('does not close session terminals when the CLI socket disconnects', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const closeAllSpy = vi.spyOn(TerminalManager.prototype, 'closeAll')
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('disconnect', 'transport close')

        expect(closeAllSpy).not.toHaveBeenCalled()
        closeAllSpy.mockRestore()
    })

    it('emits terminal list when hub requests session terminal list', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:list', { scopeType: 'session', sessionId: 'session-1' })

        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: []
        })
    })

    it('handles terminal keepalive without shell input and re-emits updated list', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:keepalive', { scopeType: 'session', sessionId: 'session-1', terminalId: 't1' })

        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: []
        })
        expect(fakeSocket.emit).not.toHaveBeenCalledWith('terminal:write', expect.anything())
    })

    it('returns live history for a valid session terminal request', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const result = {
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: 'request-1',
            status: 'ok' as const,
            shell: 'bash',
            entries: [{ index: 3, command: 'git status' }]
        }
        const historySpy = vi.spyOn(TerminalManager.prototype, 'getHistory').mockReturnValue(result)
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:history', {
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: 'request-1',
            limit: 100
        })

        expect(historySpy).toHaveBeenCalledWith({
            sessionId: 'session-1',
            terminalId: 't1',
            requestId: 'request-1',
            limit: 100
        })
        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:history-result', result)
    })

    it('ignores history requests for another session', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const historySpy = vi.spyOn(TerminalManager.prototype, 'getHistory')
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:history', {
            sessionId: 'other-session',
            terminalId: 't1',
            requestId: 'request-1'
        })

        expect(historySpy).not.toHaveBeenCalled()
        expect(fakeSocket.emit).not.toHaveBeenCalledWith('terminal:history-result', expect.anything())
    })

    it('emits updated terminal list with closed_user after explicit close-one', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const closedTerminal = {
            scopeType: 'session' as const,
            sessionId: 'session-1',
            terminalId: 't1',
            label: 'Terminal 1',
            cwd: 'project',
            cols: 80,
            rows: 24,
            status: 'closed_user' as const,
            closeReason: 'user_close' as const,
            createdAt: 1,
            lastActivityAt: 2,
            idleWarningAt: null,
            hardExpiresAt: 3
        }
        const liveT2 = { ...closedTerminal, terminalId: 't2', label: 'Terminal 2', status: 'running' as const, closeReason: null }
        const liveT3 = { ...closedTerminal, terminalId: 't3', label: 'Terminal 3', status: 'detached' as const, closeReason: null }
        const closeSpy = vi.spyOn(TerminalManager.prototype, 'close').mockImplementation(() => {})
        vi.spyOn(TerminalManager.prototype, 'list').mockReturnValue([closedTerminal, liveT2, liveT3])
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:close', { sessionId: 'session-1', terminalId: 't1' })

        expect(closeSpy).toHaveBeenCalledWith('t1')
        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [closedTerminal, liveT2, liveT3]
        })
    })



    it('handles valid internal close-all by closing terminals and emitting archived list', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const closeAllSpy = vi.spyOn(TerminalManager.prototype, 'closeAll').mockImplementation(() => {})
        const archivedTerminal = {
            scopeType: 'session' as const,
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            label: 'Terminal 1',
            cwd: '/tmp/project',
            cols: 80,
            rows: 24,
            status: 'closed_archive' as const,
            closeReason: 'archive' as const,
            createdAt: 1,
            lastActivityAt: 2,
            idleWarningAt: null,
            hardExpiresAt: 3
        }
        vi.spyOn(TerminalManager.prototype, 'list').mockReturnValue([archivedTerminal])
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        fakeSocket.trigger('terminal:close-all', {
            scopeType: 'session',
            sessionId: 'session-1',
            reason: 'archive'
        })

        expect(closeAllSpy).toHaveBeenCalledTimes(1)
        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:list', {
            scopeType: 'session',
            sessionId: 'session-1',
            terminals: [archivedTerminal]
        })
    })

    it('ignores invalid internal close-all payloads', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const closeAllSpy = vi.spyOn(TerminalManager.prototype, 'closeAll').mockImplementation(() => {})
        new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        for (const payload of [
            { scopeType: 'session', sessionId: 'other-session', reason: 'archive' },
            { scopeType: 'session', sessionId: 'session-1' },
            { scopeType: 'machine', machineId: 'machine-1', reason: 'archive' },
            { scopeType: 'session', sessionId: 'session-1', reason: 'archive', extra: true },
            'not-an-object'
        ]) {
            fakeSocket.trigger('terminal:close-all', payload)
        }

        expect(closeAllSpy).not.toHaveBeenCalled()
        expect(fakeSocket.emit).not.toHaveBeenCalledWith('terminal:list', expect.anything())
    })

    it('emits terminal:warning when TerminalManager reports a session warning', () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        const client = new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))
        const payload = {
            scopeType: 'session' as const,
            sessionId: 'session-1',
            terminalId: 't1',
            reason: 'idle' as const,
            message: 'Terminal has been idle and will stop if no activity occurs.',
            closesAt: 123
        }

        ;(client as unknown as { terminalManager: { onWarning?: (value: typeof payload) => void } })
            .terminalManager
            .onWarning?.(payload)

        expect(fakeSocket.emit).toHaveBeenCalledWith('terminal:warning', payload)
    })

    it('posts ReportToTeam through the CLI session-scoped route', async () => {
        const fakeSocket = makeSocket()
        ioMock.mockReturnValue(fakeSocket)
        configuration._setApiUrl('http://hub.test')
        axiosPostMock.mockResolvedValue({
            data: {
                message: {
                    id: 'msg-report',
                    teamChatId: 'team/1',
                    seq: 1,
                    authorParticipantId: 'p1',
                    text: 'Implemented tests',
                    reportType: 'done',
                    replyToMessageId: null,
                    replyPreview: null,
                    mentions: [],
                    files: [],
                    createdAt: 1
                }
            }
        })
        const client = new ApiSessionClient({ kind: 'runner' as const, credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, makeSession({ path: '/tmp/project', host: 'test-host' }))

        const result = await client.reportToTeam({
            teamChatId: 'team/1',
            type: 'done',
            summary: 'Implemented tests'
        })

        expect(result.message.id).toBe('msg-report')
        expect(axiosPostMock).toHaveBeenCalledWith(
            'http://hub.test/cli/sessions/session-1/team-reports',
            { teamChatId: 'team/1', type: 'done', summary: 'Implemented tests' },
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: `Runner cred.${'x'.repeat(32)}`,
                    'X-Hapi-Machine-Id': 'machine'
                }),
                timeout: 15_000
            })
        )
    })
})

describe('IncomingMessageFilter (HAPI Bot R3 finding #1)', () => {
    it('accepts a mature scheduled message whose seq is below the latest cursor', () => {
        // schedule seq=10, immediate seq=11 acks first → cursor=11.
        // seq=10 matures: seq-only dedup would drop it; id-based dedup must accept.
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ id: 'msg-imm', seq: 11 })).toBe(true)
        expect(filter.accept({ id: 'msg-sched', seq: 10 })).toBe(true)
    })

    it('rejects an exact id duplicate (re-emit on the next mature tick)', () => {
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ id: 'msg-1', seq: 1 })).toBe(true)
        expect(filter.accept({ id: 'msg-1', seq: 1 })).toBe(false)
    })

    it('falls back to seq-only dedup for messages without an id', () => {
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ seq: 5 })).toBe(true)
        // seq <= cursor and no id → drop (legacy behaviour preserved).
        expect(filter.accept({ seq: 4 })).toBe(false)
        expect(filter.accept({ seq: 5 })).toBe(false)
    })

    it('advances cursorSeq monotonically regardless of arrival order', () => {
        const filter = new IncomingMessageFilter()
        filter.accept({ id: 'a', seq: 11 })
        filter.accept({ id: 'b', seq: 10 })
        expect(filter.cursorSeq()).toBe(11)
    })

    it('bounds the seen-id set to the configured capacity (LRU eviction)', () => {
        const filter = new IncomingMessageFilter(3)
        filter.accept({ id: 'a', seq: 1 })
        filter.accept({ id: 'b', seq: 2 })
        filter.accept({ id: 'c', seq: 3 })
        filter.accept({ id: 'd', seq: 4 })
        // 'a' should have been evicted — re-presenting it is treated as new.
        expect(filter.accept({ id: 'a', seq: 5 })).toBe(true)
        // 'd' is still in the set.
        expect(filter.accept({ id: 'd', seq: 6 })).toBe(false)
    })

    it('refreshes recency on dedup hit so re-emits survive bursts of unrelated ids', () => {
        // Models the documented contract: the hub re-emits the same id every 5 s
        // until the CLI acks.  If the dedup were FIFO (insert-order only), a
        // burst of capacity-many unrelated ids between re-emits would evict the
        // pending id and the next re-emit would double-deliver.
        const filter = new IncomingMessageFilter(3)
        // Pre-fill so 'pending' is not at the head.
        filter.accept({ id: 'a', seq: 1 })
        filter.accept({ id: 'pending', seq: 2 })
        filter.accept({ id: 'b', seq: 3 })
        // Re-emit pending → recency refresh moves it to the tail.
        expect(filter.accept({ id: 'pending', seq: 4 })).toBe(false)
        // Burst that evicts oldest entries.  Without the refresh 'pending' would
        // be at insert position 2 and would be evicted; with the refresh it is
        // now the newest entry and survives.
        filter.accept({ id: 'c', seq: 5 })
        filter.accept({ id: 'd', seq: 6 })
        // 'a' (oldest) and then 'b' should have been evicted; 'pending' must
        // still dedup.
        expect(filter.accept({ id: 'pending', seq: 7 })).toBe(false)
        expect(filter.accept({ id: 'a', seq: 8 })).toBe(true)
        expect(filter.accept({ id: 'b', seq: 9 })).toBe(true)
    })
})
