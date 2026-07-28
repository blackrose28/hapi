
export type {
    CodexModelsResponse,
    CodexModelSummary,
    CommandResponse,
    CursorModelsResponse,
    CursorModelSummary,
    DeleteUploadResponse,
    DirectoryEntry,
    FileReadResponse,
    GitCommandResponse,
    ListDirectoryResponse,
    MachineDirectoryEntry,
    MachineListDirectoryResponse,
    MachinePathsExistsResponse,
    OpencodeModelsResponse,
    OpencodeModelSummary,
    OpencodeEffortSummary,
    PathExistsResponse,
    SessionPatch,
    SlashCommand,
    SlashCommandsResponse,
    UploadFileResponse
} from '@hapi/protocol/schemas'

import type { RunnerState } from '@hapi/protocol/schemas'

import type {
    CodexCollaborationMode,
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@hapi/protocol/types'
import type { AgentModelCatalogResult } from '@hapi/protocol'

export type {
    AgentState,
    AttachmentMetadata,
    CodexCollaborationMode,
    Metadata,
    PermissionMode,
    PendingRequest,
    PendingRequestKind,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    TeamMember,
    TeamMessage,
    TeamState,
    TeamTask,
    ThreadGoal,
    ThreadGoalStatus,
    TodoItem,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type { HapiSessionExport } from '@hapi/protocol/sessionExport'

export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
    invokedAt?: number | null
}



export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        workspaceRoot?: string
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionResponse = { session: Session; userCapability?: 'view' | 'interact' | 'operate' | 'manage' }
export type SessionsResponse = { sessions: SessionSummary[] }
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq?: number | null
        nextBeforeSeq: number | null
        nextBeforeAt?: number | null
        hasMore: boolean
    }
}

export type TeamChat = {
    id: string
    namespace: string
    name: string
    projectPath?: string | null
    createdAt: number
    updatedAt: number
}

export type TeamParticipantRole = 'backend' | 'frontend' | 'tests' | 'reviewer' | 'docs' | 'general'

export type TeamParticipant = {
    id: string
    teamChatId: string
    type: 'user' | 'session'
    userId?: string | null
    sessionId?: string | null
    displayName: string
    role: TeamParticipantRole
    color: string
    joinedAt: number
}

export type TeamReportType = 'reply' | 'progress' | 'done' | 'blocked' | 'question' | 'handoff'

export type TeamChatMessage = {
    id: string
    teamChatId: string
    seq: number
    authorParticipantId: string
    text: string
    reportType?: TeamReportType | null
    replyToMessageId?: string | null
    replyPreview?: { authorName: string; excerpt: string } | null
    mentions: Array<{ participantId: string; sessionId: string }>
    files: string[]
    createdAt: number
}

export type TeamChatsResponse = { teamChats: TeamChat[] }
export type TeamChatResponse = { teamChat: TeamChat }
export type SessionTeamMembership = {
    teamChat: TeamChat
    participant: TeamParticipant
}
export type SessionTeamMembershipsResponse = { memberships: SessionTeamMembership[] }
export type TeamMentionRequest = {
    id: string
    teamChatId: string
    sourceMessageId: string
    targetSessionId: string
    status: 'pending' | 'delivered' | 'seen' | 'processing' | 'responded' | 'no_action' | 'superseded' | 'failed'
    createdAt: number
    seenAt?: number | null
    resolvedAt?: number | null
}

export type TeamMessagesResponse = {
    messages: TeamChatMessage[]
    page: {
        limit: number
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}


export type { AgentModelCatalogResult } from '@hapi/protocol'
export type AgentModelsResponse = AgentModelCatalogResult

export type MachinesResponse = { machines: Machine[] }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }



export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}






export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}



export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}






/** Maps thinking levels to provider-specific values. null = unsupported. */
export type PiThinkingLevelMap = Partial<Record<string, string | null>>

export type PiModelSummary = {
    provider: string
    modelId: string
    name?: string
    contextWindow?: number
    /** Whether the model supports reasoning/thinking */
    reasoning?: boolean
    /** Maps Pi thinking levels to provider values; null = unsupported level */
    thinkingLevelMap?: PiThinkingLevelMap
}

export type PiModelsResponse = {
    success: boolean
    availableModels?: PiModelSummary[]
    currentModelId?: string | null
    error?: string
}

export type GrokReasoningEffortOption = {
    value: string
    name?: string
    isDefault?: boolean
}

export type GrokModelSummary = {
    modelId: string
    name?: string
    reasoningEfforts?: GrokReasoningEffortOption[]
}

export type GrokModelsResponse = {
    success: boolean
    availableModels?: GrokModelSummary[]
    currentModelId?: string | null
    error?: string
}

export type GrokReasoningEffortResponse = {
    success: boolean
    options?: GrokReasoningEffortOption[]
    currentValue?: string | null
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type CodexDesktopScriptResponse = {
    success: boolean
    message?: string
    pid?: number
    command?: string
    script?: string
    cwd?: string
    output?: string
    error?: string
    codexDesktopRunning?: boolean
    codexClientAvailable?: boolean
    // 中文注释：多选导入时返回实际处理完成的 Codex 会话数量，用于前端提示本次导入条数。
    syncedCount?: number
    // 中文注释：这里存放本次导入对应的 Codex thread ID 列表，方便日志和排查 direct import 结果。
    sessionIds?: string[]
    hapiSessionIds?: string[]
}

export type CodexLocalSessionSummary = {
    id: string
    title: string
    lastUserMessage?: string | null
    cwd?: string | null
    file: string
    modifiedAt: number
    originator?: string | null
    cliVersion?: string | null
    source?: string | null
    threadSource?: string | null
    forkedFromId?: string | null
}

export type CodexLocalSessionsResponse = {
    success: true
    sessions: CodexLocalSessionSummary[]
    machineId?: string
} | {
    success: false
    error: string
    sessions: []
    machineId?: string
}


export type CodexArchiveSessionResponse = {
    success: true
    archivedPath: string
    machineId?: string
} | {
    success: false
    error: string
    machineId?: string
}

export type CodexDesktopSyncRequest = {
    // 中文注释：前端弹窗直接提交 Codex thread ID，后端会按这些 transcript 直接导入到 Hapi。
    sessionIds: string[]
    cwd?: string | null
    machineId?: string | null
    model?: string | null
    modelReasoningEffort?: string | null
    serviceTier?: string | null
    collaborationMode?: CodexCollaborationMode
    yolo?: boolean
}

export type CodexDesktopStatusResponse = {
    success: true
    codexDesktopRunning: boolean
    codexClientAvailable: boolean
}

export type CodexDuplicateSessionGroup = {
    codexSessionId: string
    hapiSessionIds: string[]
    canonicalSessionId?: string
    removedSessionIds?: string[]
}

export type CodexDuplicateSessionsResponse = {
    success: true
    // 中文注释：这里只返回本次选中导入的 codexSessionId 中检测出来的重复会话，不包含未勾选的其它会话。
    duplicates: CodexDuplicateSessionGroup[]
} | {
    success: false
    error: string
}

export type CodexMergeDuplicateSessionsResponse = {
    success: true
    merged: CodexDuplicateSessionGroup[]
    mergedCount: number
} | {
    success: false
    error: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent

// ─── Editor Mode Types ────────────────────────────────────────────────────────

export type EditorDirectoryResponse = {
    success: boolean
    entries?: Array<{
        name: string
        type: 'file' | 'directory' | 'other'
        size?: number
        modified?: number
        gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
    }>
    error?: string
}

export type EditorFileResponse = {
    success: boolean
    content?: string    // base64 encoded
    size?: number
    error?: string
}

export type EditorFileMutationResponse = {
    success: boolean
    path?: string
    size?: number
    error?: string
}

export type EditorProjectsResponse = {
    success: boolean
    projects?: Array<{
        path: string
        name: string
        hasGit: boolean
    }>
    error?: string
}

export type EditorGitRepositoryState = 'ready' | 'notRepository' | 'repoOutsideRoot' | 'detached' | 'initial'
export type EditorGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
export type EditorGitRepository = {
    root: string
    name: string
    branch: string | null
    state: EditorGitRepositoryState
    gitDir?: string
}
export type EditorGitFile = {
    fileName: string
    filePath: string
    fullPath: string
    status: EditorGitFileStatus
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}
export type EditorGitStatusV2Response = {
    success: boolean
    state: EditorGitRepositoryState
    repositories: EditorGitRepository[]
    activeRepository?: EditorGitRepository
    branch?: string | null
    upstream?: string
    ahead?: number
    behind?: number
    stagedFiles: EditorGitFile[]
    unstagedFiles: EditorGitFile[]
    totalStaged: number
    totalUnstaged: number
    error?: string
}
export type EditorGitBranch = {
    name: string
    isCurrent: boolean
}

export type EditorGitListBranchesResponse = {
    success: boolean
    branches: EditorGitBranch[]
    currentBranch: string | null
    error?: string
}
export type EditorGitStashEntry = {
    index: number
    branch: string
    message: string
}

export type EditorGitStashListResponse = {
    success: boolean
    stashes: EditorGitStashEntry[]
    error?: string
}
