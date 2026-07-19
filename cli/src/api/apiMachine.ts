import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * WebSocket client for machine/runner communication with hapi-hub
 */

import { io, type Socket } from 'socket.io-client'
import type { ApiAuthentication } from './api'
import { readdir, realpath, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'
import type { ClientToServerEvents, ServerToClientEvents, Update, UpdateMachineBody } from '@hapi/protocol'
import {
    CLI_CAPABILITIES,
    TerminalClosePayloadSchema,
    TerminalDetachPayloadSchema,
    TerminalHistoryRequestSchema,
    TerminalOpenPayloadSchema,
    TerminalResizePayloadSchema,
    TerminalWritePayloadSchema,
    ArchiveCodexSessionRpcRequestSchema,
    ListCodexSessionsRpcRequestSchema,
    type ArchiveCodexSessionRpcResponse,
    type ListCodexSessionsRpcResponse,
    type MachineDirectoryEntry,
    type MachineListDirectoryResponse,
    type PathExistsResponse
} from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
>>>>>>> 64834467 (feat(codex): import and resume sessions from runners (#1088))
import type { RunnerState, Machine, MachineMetadata } from './types'
import { RunnerStateSchema, MachineMetadataSchema } from './types'
import { backoff } from '@/utils/time'
import { getInvokedCwd } from '@/utils/invokedCwd'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import { registerEditorRpcHandlers } from '../modules/editorRpc'
import { TerminalManager } from '@/terminal/TerminalManager'
import {
    listOpencodeModelsForCwd,
    type ListOpencodeModelsForCwdRequest,
    type ListOpencodeModelsForCwdResponse
} from '../modules/common/opencodeModels'
import {
    listGrokModelsForCwd,
    type ListGrokModelsForCwdRequest,
    type ListGrokModelsForCwdResponse
} from '../modules/common/grokModels'
import type { SpawnSessionOptions, SpawnSessionResult } from '../modules/common/rpcTypes'
import { applyVersionedAck } from './versionedUpdate'
import { archiveLocalCodexSession, listLocalCodexSessionSummaries, listLocalCodexSessionsWithMessagesByIds } from '../modules/common/codexSessions'
import { buildSocketIoExtraHeaderOptions } from './hubExtraHeaders'

type MachineRpcHandlers = {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
    stopSession: (sessionId: string) => boolean
    requestShutdown: () => void
}

interface PathExistsRequest {
    paths: string[]
}

interface PathExistsResponse {
    exists: Record<string, boolean>
}

interface ListMachineDirectoryRequest {
    path: string
}

interface ListMachineDirectoryEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
    isGitRepo?: boolean
}

interface ListMachineDirectoryResponse {
    success: boolean
    entries?: ListMachineDirectoryEntry[]
    error?: string
}

export class ApiMachineClient {
    private socket!: Socket<ServerToClientEvents, ClientToServerEvents>
    private keepAliveInterval: NodeJS.Timeout | null = null
    private rpcHandlerManager: RpcHandlerManager
    private readonly terminalManager: TerminalManager

    private readonly normalizedWorkspaceRoot: string | undefined

    constructor(
        private readonly authentication: ApiAuthentication,
        private readonly machine: Machine,
        private readonly workspaceRoot?: string
    ) {
        // realpath the root once so all subsequent comparisons are against
        // the canonical, symlink-resolved path. Falls back to a lexical
        // resolve if realpath fails (e.g. unusual permission setup) so we
        // still get *some* protection rather than skipping the check.
        if (workspaceRoot) {
            try {
                this.normalizedWorkspaceRoot = realpathSync(workspaceRoot)
            } catch {
                this.normalizedWorkspaceRoot = resolvePath(workspaceRoot)
            }
        } else {
            this.normalizedWorkspaceRoot = undefined
        }

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.machine.id,
            logger: (msg, data) => logger.debug(msg, data)
        })

        registerCommonHandlers(this.rpcHandlerManager, getInvokedCwd())
        registerEditorRpcHandlers(this.rpcHandlerManager, this.workspaceRoot ?? this.machine.metadata?.homeDir ?? getInvokedCwd())
        this.terminalManager = new TerminalManager({
            machineId: this.machine.id,
            getSessionPath: () => this.workspaceRoot ?? this.machine.metadata?.homeDir ?? getInvokedCwd(),
            onReady: (payload) => this.socket.emit('terminal:ready', payload),
            onOutput: (payload) => this.socket.emit('terminal:output', payload),
            onExit: (payload) => this.socket.emit('terminal:exit', payload),
            onError: (payload) => this.socket.emit('terminal:error', payload)
        })

        this.rpcHandlerManager.registerHandler<PathExistsRequest, PathExistsResponse>(RPC_METHODS.PathExists, async (params) => {
            const rawPaths = Array.isArray(params?.paths) ? params.paths : []
            const uniquePaths = Array.from(new Set(rawPaths.filter((path): path is string => typeof path === 'string')))
            const exists: Record<string, boolean> = {}

            await Promise.all(uniquePaths.map(async (path) => {
                const trimmed = path.trim()
                if (!trimmed) return
                try {
                    const stats = await stat(trimmed)
                    exists[trimmed] = stats.isDirectory()
                } catch {
                    exists[trimmed] = false
                }
            }))

            return { exists }
        })

        this.rpcHandlerManager.registerHandler<ListMachineDirectoryRequest, ListMachineDirectoryResponse>(RPC_METHODS.ListMachineDirectory, async (params) => {
            if (!this.normalizedWorkspaceRoot) {
                return { success: false, error: 'Workspace browsing is not enabled for this machine' }
            }

            const rawPath = typeof params?.path === 'string' ? params.path.trim() : ''
            if (!rawPath) {
                return { success: false, error: 'Path is required' }
            }

            const targetPath = await this.resolveForWorkspaceCheck(rawPath)
            if (!this.isWithinWorkspaceRoot(targetPath)) {
                return { success: false, error: 'Path is outside workspace root' }
            }

            try {
                const dirStat = await stat(targetPath)
                if (!dirStat.isDirectory()) {
                    return { success: false, error: 'Path is not a directory' }
                }

                const dirEntries = await readdir(targetPath, { withFileTypes: true })
                const entries: ListMachineDirectoryEntry[] = []

                await Promise.all(dirEntries.map(async (entry) => {
                    if (entry.name.startsWith('.')) return

                    const fullPath = join(targetPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined
                    let isGitRepo = false

                    if (entry.isDirectory()) {
                        type = 'directory'
                        try {
                            const gitStat = await stat(join(fullPath, '.git'))
                            isGitRepo = gitStat.isDirectory() || gitStat.isFile()
                        } catch {
                            // not a git repo
                        }
                    } else if (entry.isFile()) {
                        type = 'file'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch {
                            // ignore stat errors
                        }
                    }

                    entries.push({ name: entry.name, type, size, modified, isGitRepo })
                }))

                entries.sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1
                    if (a.type !== 'directory' && b.type === 'directory') return 1
                    return a.name.localeCompare(b.name)
                })

                return { success: true, entries }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }
            }
        })

        // OpenCode model discovery spawns an `opencode acp` subprocess scoped to the
        // requested cwd, so it must obey the same workspace-root containment as
        // `list-directory` and `spawn-happy-session`. Re-register the handler that
        // `registerCommonHandlers` installed unguarded with a guarded version that
        // resolves symlinks and rejects paths outside the configured root before
        // delegating to the lower-level probe. This intentionally overwrites the
        // earlier registration on the same scoped method name.
        this.rpcHandlerManager.registerHandler<ListOpencodeModelsForCwdRequest, ListOpencodeModelsForCwdResponse>(
            'listOpencodeModelsForCwd',
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) {
                    return { success: false, error: 'cwd is required' }
                }

                const resolvedCwd = await this.resolveForWorkspaceCheck(rawCwd)
                if (!this.isWithinWorkspaceRoot(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace root' }
                }

                return await listOpencodeModelsForCwd(resolvedCwd)
            }
        )

        // Grok model discovery spawns a `grok` ACP subprocess scoped to the
        // requested cwd, so it obeys the same workspace-root containment as
        // the OpenCode handler above.
        this.rpcHandlerManager.registerHandler<ListGrokModelsForCwdRequest, ListGrokModelsForCwdResponse>(
            'listGrokModelsForCwd',
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) {
                    return { success: false, error: 'cwd is required' }
                }

                const resolvedCwd = await this.resolveForWorkspaceCheck(rawCwd)
                if (!this.isWithinWorkspaceRoot(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace root' }
                }

                return await listGrokModelsForCwd(resolvedCwd)
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ListCodexSessionsRpcResponse>(
            RPC_METHODS.ListCodexSessions,
            async (params) => {
                const parsed = ListCodexSessionsRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Codex sessions request' }
                const rawCwd = typeof parsed.data.cwd === 'string' ? parsed.data.cwd.trim() : ''
                if (rawCwd) {
                    const resolvedCwd = await this.resolveForWorkspaceCheck(rawCwd)
                    if (!this.isWithinWorkspaceRoots(resolvedCwd)) {
                        return { success: false, error: 'Path is outside workspace roots' }
                    }
                }
                const requestedIds = parsed.data.sessionIds
                    ? new Set(parsed.data.sessionIds)
                    : null
                const allSessions = requestedIds
                    ? listLocalCodexSessionsWithMessagesByIds(requestedIds)
                    : listLocalCodexSessionSummaries()
                const sessions = []
                for (const session of allSessions) {
                    if (await this.isCodexSessionWithinWorkspaceRoots(session)) {
                        sessions.push(session)
                    }
                }
                return { success: true, sessions }
            }
        )

        this.rpcHandlerManager.registerHandler<unknown, ArchiveCodexSessionRpcResponse>(
            RPC_METHODS.ArchiveCodexSession,
            async (params) => {
                const parsed = ArchiveCodexSessionRpcRequestSchema.safeParse(params)
                if (!parsed.success) return { success: false, error: 'Invalid Codex archive request' }
                const sessionId = parsed.data.sessionId.trim()
                return await archiveLocalCodexSession(sessionId, {
                    canArchive: (session) => this.isCodexSessionWithinWorkspaceRoots(session)
                })
            }
        )
    }

    private async isCodexSessionWithinWorkspaceRoots(session: { cwd?: string | null }): Promise<boolean> {
        if (!this.normalizedWorkspaceRoots?.length) return true
        const cwd = session.cwd?.trim()
        if (!cwd) return false
        const resolvedCwd = await this.resolveForWorkspaceCheck(cwd)
        return this.isWithinWorkspaceRoots(resolvedCwd)
    }

    private isWithinWorkspaceRoot(absolutePath: string): boolean {
        if (!this.normalizedWorkspaceRoot) return true
        const rel = relative(this.normalizedWorkspaceRoot, absolutePath)
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }

    /**
     * Canonicalize a path for workspace-root containment checks. Resolves
     * symlinks via realpath so a symlink such as `/safe/out -> /etc` cannot
     * be used to escape the configured root with a lexical-only check.
     *
     * If the path doesn't exist (e.g. a session is being spawned in a
     * directory we'll create), walks up to the nearest existing ancestor
     * and realpaths *that*, joining the missing tail back on. This way the
     * check still runs against the real on-disk location once any
     * intermediate symlink in the parent chain has been resolved.
     */
    private async resolveForWorkspaceCheck(path: string): Promise<string> {
        const absolute = resolvePath(path)
        try {
            return await realpath(absolute)
        } catch {
            const missing: string[] = []
            let cursor = absolute
            while (cursor !== dirname(cursor)) {
                missing.unshift(basename(cursor))
                cursor = dirname(cursor)
                try {
                    return join(await realpath(cursor), ...missing)
                } catch {
                    // keep walking to the nearest existing parent
                }
            }
            return absolute
        }
    }

    setRPCHandlers({ spawnSession, stopSession, requestShutdown }: MachineRpcHandlers): void {
        this.rpcHandlerManager.registerHandler(RPC_METHODS.SpawnHappySession, async (params: any) => {
            const { directory, sessionId, existingSessionId, resumeSessionId, machineId, approvedNewDirectoryCreation, agent, model, effort, modelReasoningEffort, yolo, permissionMode, serviceTier, token, sessionType, worktreeName, recoveryContext } = params || {}

            if (!directory) {
                throw new Error('Directory is required')
            }

            const resolvedDirectory = await this.resolveForWorkspaceCheck(directory)
            if (!this.isWithinWorkspaceRoot(resolvedDirectory)) {
                return { type: 'error', errorMessage: 'Directory is outside this machine\'s workspace root' }
            }

            const result = await spawnSession({
                directory,
                sessionId,
                existingSessionId,
                resumeSessionId,
                machineId,
                approvedNewDirectoryCreation,
                agent,
                model,
                effort,
                modelReasoningEffort,
                yolo,
                permissionMode,
                token,
                sessionType,
                worktreeName,
                recoveryContext
            })

            switch (result.type) {
                case 'success':
                    return { type: 'success', sessionId: result.sessionId }
                case 'requestToApproveDirectoryCreation':
                    return { type: 'requestToApproveDirectoryCreation', directory: result.directory }
                case 'error':
                    return { type: 'error', errorMessage: result.errorMessage }
            }
        })

        this.rpcHandlerManager.registerHandler(RPC_METHODS.StopSession, (params: any) => {
            const { sessionId } = params || {}
            if (!sessionId) {
                throw new Error('Session ID is required')
            }

            const success = stopSession(sessionId)
            if (!success) {
                throw new Error('Session not found or failed to stop')
            }

            return { message: 'Session stopped' }
        })

        this.rpcHandlerManager.registerHandler(RPC_METHODS.StopRunner, () => {
            setTimeout(() => requestShutdown(), 100)
            return { message: 'Runner stop request acknowledged' }
        })
    }

    async updateMachineMetadata(handler: (metadata: MachineMetadata | null) => MachineMetadata): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.metadata)

            const answer = await this.socket.emitWithAck('machine-update-metadata', {
                machineId: this.machine.id,
                metadata: updated,
                expectedVersion: this.machine.metadataVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'metadata',
                parseValue: (value) => {
                    const parsed = MachineMetadataSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.metadata = value
                },
                applyVersion: (version) => {
                    this.machine.metadataVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid metadata value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-metadata response',
                errorMessage: 'Machine metadata update failed',
                versionMismatchMessage: 'Metadata version mismatch'
            })
        })
    }

    async updateRunnerState(handler: (state: RunnerState | null) => RunnerState): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.runnerState)

            const answer = await this.socket.emitWithAck('machine-update-state', {
                machineId: this.machine.id,
                runnerState: updated,
                expectedVersion: this.machine.runnerStateVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'runnerState',
                parseValue: (value) => {
                    const parsed = RunnerStateSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.runnerState = value
                },
                applyVersion: (version) => {
                    this.machine.runnerStateVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid runnerState value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-state response',
                errorMessage: 'Machine state update failed',
                versionMismatchMessage: 'Runner state version mismatch'
            })
        })
    }

    connect(): void {
        this.socket = io(`${configuration.apiUrl}/cli`, {
            transports: ['websocket'],
            auth: {
                kind: 'runner' as const,
                credential: this.authentication.credential,
                machineId: this.authentication.machineId,
                clientType: 'machine-scoped' as const,
                capabilities: CLI_CAPABILITIES
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            ...buildSocketIoExtraHeaderOptions()
        })

        this.socket.on('connect', () => {
            logger.debug('[API MACHINE] Connected to bot')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            this.updateRunnerState((state) => ({
                ...(state ?? {}),
                status: 'running',
                pid: process.pid,
                httpPort: this.machine.runnerState?.httpPort,
                startedAt: Date.now()
            })).catch((error) => {
                logger.debug('[API MACHINE] Failed to update runner state on connect', error)
            })

            const hubWorkspaceRoot = this.machine.metadata?.workspaceRoots?.[0]
            const desiredWorkspaceRoot = this.workspaceRoot
            if (desiredWorkspaceRoot !== hubWorkspaceRoot) {
                if (desiredWorkspaceRoot) {
                    console.log(`[HAPI] Syncing workspace root to hub: ${desiredWorkspaceRoot} (current hub value: ${hubWorkspaceRoot ?? 'none'})`)
                } else {
                    console.log(`[HAPI] Clearing workspace root on hub (was: ${hubWorkspaceRoot})`)
                }
                this.updateMachineMetadata((current) => {
                    const base = current ?? this.machine.metadata
                    if (!base) {
                        return { workspaceRoots: desiredWorkspaceRoot ? [desiredWorkspaceRoot] : undefined } as unknown as MachineMetadata
                    }
                    if (desiredWorkspaceRoot) {
                        return { ...base, workspaceRoots: desiredWorkspaceRoot ? [desiredWorkspaceRoot] : undefined }
                    }
                    const { workspaceRoots: _omit, ...rest } = base
                    return rest as MachineMetadata
                }).then(() => {
                    console.log(`[HAPI] Workspace root synced: ${this.machine.metadata?.workspaceRoots?.[0] ?? '(none)'}`)
                }).catch((error) => {
                    console.error('[HAPI] Failed to sync workspace root:', error instanceof Error ? error.message : error)
                })
            } else if (desiredWorkspaceRoot) {
                console.log(`[HAPI] Workspace root already up to date on hub: ${desiredWorkspaceRoot}`)
            }

            this.startKeepAlive()
        })

        this.socket.on('disconnect', () => {
            logger.debug('[API MACHINE] Disconnected from bot')
            this.rpcHandlerManager.onSocketDisconnect()
            this.terminalManager.closeAll()
            this.stopKeepAlive()
        })

        this.socket.on('rpc-request', async (data: { method: string; params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        const handleTerminalEvent = <T extends { terminalId: string }>(
            schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
            handler: (payload: T & { machineId: string }) => void | Promise<void>
        ) => (data: unknown) => {
            const parsed = schema.safeParse(data)
            if (!parsed.success) {
                return
            }
            if (!('machineId' in parsed.data) || parsed.data.machineId !== this.machine.id) {
                return
            }
            void handler(parsed.data as T & { machineId: string })
        }

        this.socket.on('terminal:open', handleTerminalEvent(TerminalOpenPayloadSchema, async (payload) => {
            const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
            if (cwd && this.normalizedWorkspaceRoot) {
                const resolvedCwd = await this.resolveForWorkspaceCheck(cwd)
                if (!this.isWithinWorkspaceRoot(resolvedCwd)) {
                    this.socket.emit('terminal:error', {
                        machineId: this.machine.id,
                        terminalId: payload.terminalId,
                        message: 'Terminal path is outside this machine workspace root.'
                    })
                    return
                }
                this.terminalManager.create(payload.terminalId, payload.cols, payload.rows, resolvedCwd, payload.replay === true)
                return
            }
            this.terminalManager.create(payload.terminalId, payload.cols, payload.rows, cwd, payload.replay === true)
        }))

        this.socket.on('terminal:write', handleTerminalEvent(TerminalWritePayloadSchema, (payload) => {
            this.terminalManager.write(payload.terminalId, payload.data)
        }))

        this.socket.on('terminal:resize', handleTerminalEvent(TerminalResizePayloadSchema, (payload) => {
            this.terminalManager.resize(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:close', handleTerminalEvent(TerminalClosePayloadSchema, (payload) => {
            this.terminalManager.close(payload.terminalId)
        }))

        this.socket.on('terminal:detach', handleTerminalEvent(TerminalDetachPayloadSchema, (payload) => {
            this.terminalManager.detach(payload.terminalId)
        }))

        this.socket.on('terminal:history', handleTerminalEvent(TerminalHistoryRequestSchema, (payload) => {
            this.socket.emit('terminal:history-result', this.terminalManager.getHistory(payload))
        }))

        this.socket.on('update', (data: Update) => {
            if (data.body.t !== 'update-machine') {
                return
            }

            const update = data.body as UpdateMachineBody
            if (update.machineId !== this.machine.id) {
                return
            }

            if (update.metadata) {
                const parsed = MachineMetadataSchema.safeParse(update.metadata.value)
                if (parsed.success) {
                    this.machine.metadata = parsed.data
                } else {
                    logger.debug('[API MACHINE] Ignoring invalid metadata update', { version: update.metadata.version })
                }
                this.machine.metadataVersion = update.metadata.version
            }

            if (update.runnerState) {
                const next = update.runnerState.value
                if (next == null) {
                    this.machine.runnerState = null
                } else {
                    const parsed = RunnerStateSchema.safeParse(next)
                    if (parsed.success) {
                        this.machine.runnerState = parsed.data
                    } else {
                        logger.debug('[API MACHINE] Ignoring invalid runnerState update', { version: update.runnerState.version })
                    }
                }
                this.machine.runnerStateVersion = update.runnerState.version
            }
        })

        this.socket.on('connect_error', (error) => {
            logger.debug(`[API MACHINE] Connection error: ${error.message}`)
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API MACHINE] Socket error:', payload)
        })
    }

    private startKeepAlive(): void {
        this.stopKeepAlive()
        this.keepAliveInterval = setInterval(() => {
            this.socket.emit('machine-alive', {
                machineId: this.machine.id,
                time: Date.now()
            })
        }, 20_000)
    }

    private stopKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval)
            this.keepAliveInterval = null
        }
    }

    shutdown(): void {
        this.stopKeepAlive()
        this.terminalManager.closeAll()
        if (this.socket) {
            this.socket.close()
        }
    }
}
