import {
    AgentModelCatalogResultSchema,
    type AgentFlavor,
    type AgentModelCatalogResult,
    RPC_METHODS
} from '@hapi/protocol'
import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type {
    CodexModelSummary,
    CodexModelsResponse,
    CommandResponse,
    DeleteUploadResponse,
    DirectoryEntry,
    FileReadResponse,
    GeneratedImageResponse,
    ListDirectoryResponse,
    OpencodeModelsResponse,
    OpencodeModelSummary,
    PathExistsResponse,
    UploadFileResponse
} from '@hapi/protocol/schemas'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

export type RpcCommandResponse = CommandResponse
export type RpcReadFileResponse = FileReadResponse
export type RpcGeneratedImageResponse = GeneratedImageResponse
export type RpcReadFileRawResponse = {
    success: boolean
    data?: string
    mimeType?: string
    size?: number
    error?: string
}
export type RpcUploadFileResponse = UploadFileResponse
export type RpcEditorFileMutationResponse = {
    success: boolean
    path?: string
    size?: number
    error?: string
}
export type RpcDeleteUploadResponse = DeleteUploadResponse
export type RpcDirectoryEntry = DirectoryEntry
export type RpcListDirectoryResponse = ListDirectoryResponse
export type RpcPathExistsResponse = PathExistsResponse
export type RpcCodexModel = CodexModelSummary
export type RpcListCodexModelsResponse = CodexModelsResponse
export type RpcOpencodeModel = OpencodeModelSummary
export type RpcListOpencodeModelsResponse = OpencodeModelsResponse

export type RpcEditorProject = {
    path: string
    name: string
    hasGit: boolean
}

export type RpcEditorProjectsResponse = {
    success: boolean
    projects?: RpcEditorProject[]
    error?: string
}

export type RpcEditorGitRepositoryState = 'ready' | 'notRepository' | 'repoOutsideRoot' | 'detached' | 'initial'
export type RpcEditorGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
export type RpcEditorGitRepository = {
    root: string
    name: string
    branch: string | null
    state: RpcEditorGitRepositoryState
    gitDir?: string
}
export type RpcEditorGitFile = {
    fileName: string
    filePath: string
    fullPath: string
    status: RpcEditorGitFileStatus
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}
export type RpcEditorGitStatusResponse = {
    success: boolean
    state: RpcEditorGitRepositoryState
    repositories: RpcEditorGitRepository[]
    activeRepository?: RpcEditorGitRepository
    branch?: string | null
    upstream?: string
    ahead?: number
    behind?: number
    stagedFiles: RpcEditorGitFile[]
    unstagedFiles: RpcEditorGitFile[]
    totalStaged: number
    totalUnstaged: number
    error?: string
}
export type RpcEditorGitBranch = {
    name: string
    isCurrent: boolean
}

export type RpcEditorGitListBranchesResponse = {
    success: boolean
    branches: RpcEditorGitBranch[]
    currentBranch: string | null
    error?: string
}
export type RpcEditorGitStashEntry = {
    index: number
    branch: string
    message: string
}

export type RpcEditorGitStashListResponse = {
    success: boolean
    stashes: RpcEditorGitStashEntry[]
    error?: string
}


// Note: this fork has no shared `apiTypes.ts` module (deliberately not adopted
// — see docs/upstream-sync), so RpcPiModel/RpcListPiModelsResponse are kept
// local to this file, matching the existing RpcOpencodeModel/RpcCodexModel
// convention rather than a parallel shared type file.
export type RpcPiModel = {
    provider: string
    modelId: string
    name?: string
    contextWindow?: number
    reasoning?: boolean
    thinkingLevelMap?: Partial<Record<string, string | null>>
}

export type RpcListPiModelsResponse = {
    success: boolean
    availableModels?: RpcPiModel[]
    currentModelId?: string | null
    error?: string
}

// Same rationale as RpcPiModel above — no shared apiTypes.ts, so Grok's
// model/effort response shapes are kept local to this file too.
export type RpcGrokReasoningEffortOption = {
    value: string
    name?: string
    isDefault?: boolean
}

export type RpcGrokModel = {
    modelId: string
    name?: string
    reasoningEfforts?: RpcGrokReasoningEffortOption[]
}

export type RpcListGrokModelsResponse = {
    success: boolean
    availableModels?: RpcGrokModel[]
    currentModelId?: string | null
    autoPermissionModeSupported?: boolean
    error?: string
}

export type RpcListGrokReasoningEffortOptionsResponse = {
    success: boolean
    options?: RpcGrokReasoningEffortOption[]
    currentValue?: string | null
    error?: string
}

/**
 * tiann/hapi#916: thrown by {@link RpcGateway.rpcCall} when the target CLI is
 * unreachable (handler not registered or socket disconnected). Callers can
 * narrow on this to treat "CLI gone" as a benign condition (e.g. archive
 * still succeeds at the hub level) without swallowing real RPC errors like
 * timeouts or protocol failures.
 */
export class RpcTargetMissingError extends Error {
    readonly code: 'handler-not-registered' | 'socket-disconnected'
    readonly method: string

    constructor(method: string, reason: 'handler-not-registered' | 'socket-disconnected') {
        super(reason === 'handler-not-registered'
            ? `RPC handler for ${method} is not registered on the client`
            : `Client disconnected while executing RPC ${method}`)
        this.name = 'RpcTargetMissingError'
        this.code = reason
        this.method = method
    }
}

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode,
        recoveryContext?: string
            // Pi requires { provider, modelId } to uniquely identify a model
            // (two providers can share a modelId); every other flavor still
            // sends/receives a plain string.
            model?: { provider: string; modelId: string } | string | null
            modelReasoningEffort?: string | null
            effort?: string | null
            collaborationMode?: CodexCollaborationMode
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: AgentFlavor = 'claude',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
        permissionMode?: PermissionMode,
        recoveryContext?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                { type: 'spawn-in-directory', directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, resumeSessionId, effort, permissionMode, recoveryContext }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return { type: 'error', message: `Directory creation requires approval: ${obj.directory}` }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return { type: 'error', message: obj.message }
                }
            }
            const details = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result)
                    } catch {
                        return String(result)
                    }
                })()
            return { type: 'error', message: `Unexpected spawn result: ${details}` }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
        }
    }

    async listMachineDirectory(machineId: string, path: string): Promise<RpcListDirectoryResponse> {
        const result = await this.machineRpc(machineId, 'list-directory', { path }) as RpcListDirectoryResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected list-directory result' }
        }
        return result as RpcListDirectoryResponse
    }

    // ─── Editor Mode RPC ─────────────────────────────────────────────────

    async editorListDirectory(machineId: string, path: string): Promise<RpcListDirectoryResponse> {
        const result = await this.machineRpc(machineId, 'editor-list-directory', { path }) as RpcListDirectoryResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-list-directory result' }
        }
        return result as RpcListDirectoryResponse
    }

    async editorReadFile(machineId: string, path: string): Promise<RpcReadFileResponse> {
        const result = await this.machineRpc(machineId, 'editor-read-file', { path }) as RpcReadFileResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-read-file result' }
        }
        return result as RpcReadFileResponse
    }

    async editorReadFileRaw(machineId: string, path: string): Promise<RpcReadFileRawResponse> {
        const result = await this.machineRpc(machineId, 'editor-read-file-raw', { path }) as RpcReadFileRawResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-read-file-raw result' }
        }
        return result as RpcReadFileRawResponse
    }

    async editorListProjects(machineId: string): Promise<RpcEditorProjectsResponse> {
        const result = await this.machineRpc(machineId, 'editor-list-projects', {}) as RpcEditorProjectsResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-list-projects result' }
        }
        return result as RpcEditorProjectsResponse
    }

    async editorGitStatusV2(machineId: string, path: string, repoRoot?: string): Promise<RpcEditorGitStatusResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-status-v2', { path, repoRoot }) as RpcEditorGitStatusResponse | unknown
        if (!result || typeof result !== 'object') {
            return {
                success: false,
                state: 'notRepository',
                repositories: [],
                stagedFiles: [],
                unstagedFiles: [],
                totalStaged: 0,
                totalUnstaged: 0,
                error: 'Unexpected editor-git-status-v2 result'
            }
        }
        return result as RpcEditorGitStatusResponse
    }

    async editorGitDiffFile(machineId: string, path: string, filePath: string, staged?: boolean, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-diff-file', { path, repoRoot, filePath, staged }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-diff-file result' }
        return result as RpcCommandResponse
    }

    async editorGitStageFile(machineId: string, path: string, filePath: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-stage-file', { path, repoRoot, filePath }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-stage-file result' }
        return result as RpcCommandResponse
    }

    async editorGitUnstageFile(machineId: string, path: string, filePath: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-unstage-file', { path, repoRoot, filePath }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-unstage-file result' }
        return result as RpcCommandResponse
    }

    async editorGitStageAll(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-stage-all', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-stage-all result' }
        return result as RpcCommandResponse
    }

    async editorGitUnstageAll(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-unstage-all', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-unstage-all result' }
        return result as RpcCommandResponse
    }

    async editorGitCommit(machineId: string, path: string, message: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-commit', { path, repoRoot, message }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-commit result' }
        return result as RpcCommandResponse
    }

    async editorGitPull(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-pull', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-pull result' }
        return result as RpcCommandResponse
    }

    async editorGitPush(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-push', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-push result' }
        return result as RpcCommandResponse
    }


    async editorGitListBranches(machineId: string, path: string, repoRoot?: string): Promise<RpcEditorGitListBranchesResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-list-branches', { path, repoRoot }) as RpcEditorGitListBranchesResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, branches: [], currentBranch: null, error: 'Unexpected editor-git-list-branches result' }
        return result as RpcEditorGitListBranchesResponse
    }

    async editorGitCheckout(machineId: string, path: string, branch: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-checkout', { path, repoRoot, branch }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-checkout result' }
        return result as RpcCommandResponse
    }

    async editorGitCreateBranch(machineId: string, path: string, branch: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-create-branch', { path, repoRoot, branch }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-create-branch result' }
        return result as RpcCommandResponse
    }

    async editorGitFetch(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-fetch', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-fetch result' }
        return result as RpcCommandResponse
    }
    async editorGitDiscardFile(machineId: string, path: string, filePath: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-discard-file', { path, repoRoot, filePath }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-discard-file result' }
        return result as RpcCommandResponse
    }

    async editorGitDiscardAll(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-discard-all', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-discard-all result' }
        return result as RpcCommandResponse
    }

    async editorGitStashList(machineId: string, path: string, repoRoot?: string): Promise<RpcEditorGitStashListResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-stash-list', { path, repoRoot }) as RpcEditorGitStashListResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, stashes: [], error: 'Unexpected editor-git-stash-list result' }
        return result as RpcEditorGitStashListResponse
    }

    async editorGitStashPush(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-stash-push', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-stash-push result' }
        return result as RpcCommandResponse
    }

    async editorGitStashPop(machineId: string, path: string, repoRoot?: string): Promise<RpcCommandResponse> {
        const result = await this.machineRpc(machineId, 'editor-git-stash-pop', { path, repoRoot }) as RpcCommandResponse | unknown
        if (!result || typeof result !== 'object') return { success: false, error: 'Unexpected editor-git-stash-pop result' }
        return result as RpcCommandResponse
    }


    async editorWriteFile(machineId: string, path: string, content: string): Promise<RpcEditorFileMutationResponse> {
        const result = await this.machineRpc(machineId, 'editor-write-file', { path, content }) as RpcEditorFileMutationResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-write-file result' }
        }
        return result as RpcEditorFileMutationResponse
    }

    async editorCreateFile(machineId: string, path: string, content: string): Promise<RpcEditorFileMutationResponse> {
        const result = await this.machineRpc(machineId, 'editor-create-file', { path, content }) as RpcEditorFileMutationResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-create-file result' }
        }
        return result as RpcEditorFileMutationResponse
    }

    async editorDeleteFile(machineId: string, path: string): Promise<RpcEditorFileMutationResponse> {
        const result = await this.machineRpc(machineId, 'editor-delete-file', { path }) as RpcEditorFileMutationResponse | unknown
        if (!result || typeof result !== 'object') {
            return { success: false, error: 'Unexpected editor-delete-file result' }
        }
        return result as RpcEditorFileMutationResponse
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path }) as RpcReadFileResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
            error?: string
        }
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSkills', {}) as {
            success: boolean
            skills?: Array<{ name: string; description?: string }>
            error?: string
        }
    }

    async listCodexModelsForSession(sessionId: string): Promise<RpcListCodexModelsResponse> {
        return await this.sessionRpc(sessionId, 'listCodexModels', {}) as RpcListCodexModelsResponse
    }

    async listCodexModelsForMachine(machineId: string): Promise<RpcListCodexModelsResponse> {
        return await this.machineRpc(machineId, 'listCodexModels', {}) as RpcListCodexModelsResponse
    }

    async listAgentModelsForSession(
        sessionId: string,
        agent: AgentFlavor
    ): Promise<AgentModelCatalogResult> {
        return this.parseAgentModelCatalog(
            await this.sessionRpc(sessionId, 'listAgentModels', { agent })
        )
    }

    async listAgentModelsForMachine(
        machineId: string,
        agent: AgentFlavor,
        cwd?: string
    ): Promise<AgentModelCatalogResult> {
        return this.parseAgentModelCatalog(
            await this.machineRpc(machineId, 'listAgentModels', { agent, cwd })
        )
    }

    async listOpencodeModelsForSession(sessionId: string): Promise<RpcListOpencodeModelsResponse> {
        return await this.sessionRpc(sessionId, 'listOpencodeModels', {}) as RpcListOpencodeModelsResponse
    }

    async listOpencodeModelsForCwd(machineId: string, cwd: string): Promise<RpcListOpencodeModelsResponse> {
        return await this.machineRpc(machineId, 'listOpencodeModelsForCwd', { cwd }) as RpcListOpencodeModelsResponse
    }

    async listPiModelsForSession(sessionId: string): Promise<RpcListPiModelsResponse> {
        return await this.sessionRpc(sessionId, 'listPiModels', {}) as RpcListPiModelsResponse
    }

    async listGrokModelsForSession(sessionId: string): Promise<RpcListGrokModelsResponse> {
        return await this.sessionRpc(sessionId, 'listGrokModels', {}) as RpcListGrokModelsResponse
    }

    async listGrokModelsForCwd(machineId: string, cwd: string): Promise<RpcListGrokModelsResponse> {
        return await this.machineRpc(machineId, 'listGrokModelsForCwd', { cwd }) as RpcListGrokModelsResponse
    }

    async listGrokReasoningEffortOptionsForSession(sessionId: string): Promise<RpcListGrokReasoningEffortOptionsResponse> {
        return await this.sessionRpc(sessionId, 'listGrokReasoningEffortOptions', {}) as RpcListGrokReasoningEffortOptionsResponse
    }

    private parseAgentModelCatalog(value: unknown): AgentModelCatalogResult {
        const parsed = AgentModelCatalogResultSchema.parse(value)
        return parsed.error
            ? { ...parsed, error: 'Agent model discovery failed' }
            : parsed
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new RpcTargetMissingError(method, 'handler-not-registered')
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new RpcTargetMissingError(method, 'socket-disconnected')
        }

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}
