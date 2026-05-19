import type { SessionSummary } from './sessionSummary';
import { z } from 'zod'
import { CachedAgentModelCatalogSchema } from './agentModels'
import { CODEX_COLLABORATION_MODES, PERMISSION_MODES } from './modes'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export const CodexCollaborationModeSchema = z.enum(CODEX_COLLABORATION_MODES)
export const SessionEndReasonSchema = z.enum(['completed', 'terminated', 'error', 'handoff'])
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>

const MetadataSummarySchema = z.object({
    text: z.string(),
    updatedAt: z.number()
})


const CachedCodexModelsSchema = z.object({
    models: z.array(z.object({
        id: z.string(),
        displayName: z.string(),
        isDefault: z.boolean(),
        defaultReasoningEffort: z.string().nullable().optional(),
        supportedReasoningEfforts: z.array(z.string()).optional()
    })),
    cachedAt: z.number()
})

const CachedOpencodeModelsSchema = z.object({
    availableModels: z.array(z.object({
        modelId: z.string(),
        name: z.string().optional()
    })),
    currentModelId: z.string().nullable().optional(),
    availableEfforts: z.array(z.object({
        effortId: z.string(),
        name: z.string().optional()
    })).optional(),
    currentEffortId: z.string().nullable().optional(),
    cachedAt: z.number()
})

const CachedGrokModelsSchema = z.object({
    availableModels: z.array(z.object({
        modelId: z.string(),
        name: z.string().optional(),
        reasoningEfforts: z.array(z.object({
            value: z.string(),
            name: z.string().optional(),
            isDefault: z.boolean().optional()
        })).optional()
    })),
    currentModelId: z.string().nullable().optional(),
    autoPermissionModeSupported: z.boolean().optional(),
    cachedAt: z.number()
})

export const WorktreeMetadataSchema = z.object({
    basePath: z.string(),
    branch: z.string(),
    name: z.string(),
    worktreePath: z.string().optional(),
    createdAt: z.number().optional()
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    claudeSessionId: z.string().optional(),
    codexSessionId: z.string().optional(),
    geminiSessionId: z.string().optional(),
    opencodeSessionId: z.string().optional(),
    grokSessionId: z.string().optional(),
    cursorSessionId: z.string().optional(),
    cursorSessionProtocol: z.enum(['acp', 'stream-json']).optional(),
    kimiSessionId: z.string().optional(),
    piSessionId: z.string().optional(),
    tools: z.array(z.string()).optional(),
    slashCommands: z.array(z.string()).optional(),
    homeDir: z.string().optional(),
    happyHomeDir: z.string().optional(),
    happyLibDir: z.string().optional(),
    happyToolsDir: z.string().optional(),
    startedFromRunner: z.boolean().optional(),
    hostPid: z.number().optional(),
    startedBy: z.enum(['runner', 'terminal']).optional(),
    lifecycleState: z.string().optional(),
    lifecycleStateSince: z.number().optional(),
    archivedBy: z.string().optional(),
    archiveReason: z.string().optional(),
    preferredPermissionMode: PermissionModeSchema.optional(),
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional(),
    lastUserRequest: z.string().optional(),
    cachedAgentModels: CachedAgentModelCatalogSchema.optional(),
    cachedCodexModels: CachedCodexModelsSchema.optional(),
    cachedOpencodeModels: CachedOpencodeModelsSchema.optional(),
    cachedGrokModels: CachedGrokModelsSchema.optional(),
    // Cached Pi model list — written by CLI, read by web (inactive session fallback).
    // Minimal shape: each entry must have modelId; other fields (provider, name, etc.) pass through.
    piAvailableModels: z.array(z.object({ modelId: z.string() }).passthrough()).optional(),
    // Pi-selected model with provider identity. The legacy `session.model`
    // field stores only modelId (shared across all flavors); this preserves
    // the provider so web can resolve the exact model when two providers
    // share a modelId.
    piSelectedModel: z.object({ provider: z.string(), modelId: z.string() }).nullable().optional()
})

export type Metadata = z.infer<typeof MetadataSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish()
})

export type AgentStateRequest = z.infer<typeof AgentStateRequestSchema>

export const AgentStateCompletedRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    completedAt: z.number().nullish(),
    status: z.enum(['canceled', 'denied', 'approved']),
    reason: z.string().optional(),
    mode: z.string().optional(),
    decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    allowTools: z.array(z.string()).optional(),
    // Flat format: Record<string, string[]> (AskUserQuestion)
    // Nested format: Record<string, { answers: string[] }> (request_user_input)
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
})

export type AgentStateCompletedRequest = z.infer<typeof AgentStateCompletedRequestSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), AgentStateRequestSchema).nullish(),
    completedRequests: z.record(z.string(), AgentStateCompletedRequestSchema).nullish()
})

export type AgentState = z.infer<typeof AgentStateSchema>

export const TodoItemSchema = z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
    id: z.string().optional().default(''),
    activeForm: z.string().optional()
})

export type TodoItem = z.infer<typeof TodoItemSchema>

export const TodosSchema = z.array(TodoItemSchema)

export const TeamMemberSchema = z.object({
    name: z.string(),
    agentType: z.string().optional(),
    status: z.enum(['active', 'idle', 'shutdown']).optional()
})

export type TeamMember = z.infer<typeof TeamMemberSchema>

export const TeamTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
    owner: z.string().optional()
})

export type TeamTask = z.infer<typeof TeamTaskSchema>

export const TeamMessageSchema = z.object({
    from: z.string(),
    to: z.string(),
    summary: z.string(),
    type: z.enum(['message', 'broadcast', 'shutdown_request', 'shutdown_response']),
    timestamp: z.number()
})

export type TeamMessage = z.infer<typeof TeamMessageSchema>

export const TeamStateSchema = z.object({
    teamName: z.string(),
    description: z.string().optional(),
    members: z.array(TeamMemberSchema).optional(),
    tasks: z.array(TeamTaskSchema).optional(),
    messages: z.array(TeamMessageSchema).optional(),
    updatedAt: z.number()
})

export type TeamState = z.infer<typeof TeamStateSchema>

export const TeamParticipantRoleSchema = z.enum(['backend', 'frontend', 'tests', 'reviewer', 'docs', 'general'])

export type TeamParticipantRole = z.infer<typeof TeamParticipantRoleSchema>

export const TeamMentionStatusSchema = z.enum([
    'pending',
    'delivered',
    'seen',
    'processing',
    'responded',
    'no_action',
    'superseded',
    'failed'
])

export type TeamMentionStatus = z.infer<typeof TeamMentionStatusSchema>

export const TeamReportTypeSchema = z.enum(['reply', 'progress', 'done', 'blocked', 'question', 'handoff'])

export type TeamReportType = z.infer<typeof TeamReportTypeSchema>

export const TeamSharedContextSnapshotSchema = z.object({
    goal: z.string().optional(),
    decisions: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    relevantFiles: z.array(z.string()).default([])
})

export type TeamSharedContextSnapshot = z.infer<typeof TeamSharedContextSnapshotSchema>

export const TeamMentionContextSnapshotSchema = z.object({
    originalText: z.string(),
    replyPreview: z.object({
        authorName: z.string(),
        excerpt: z.string()
    }).optional(),
    sharedContext: TeamSharedContextSnapshotSchema,
    recentUpdates: z.array(z.object({
        messageId: z.string(),
        authorName: z.string(),
        excerpt: z.string()
    })).default([]),
    attachedFiles: z.array(z.string()).default([])
})

export type TeamMentionContextSnapshot = z.infer<typeof TeamMentionContextSnapshotSchema>

export const TeamChatSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    name: z.string(),
    projectPath: z.string().optional(),
    archivedAt: z.number().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number()
})

export type TeamChat = z.infer<typeof TeamChatSchema>

export const TeamParticipantSchema = z.object({
    id: z.string(),
    teamChatId: z.string(),
    type: z.enum(['user', 'session']),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    displayName: z.string(),
    role: TeamParticipantRoleSchema.default('general'),
    color: z.string(),
    archivedAt: z.number().nullable().optional(),
    joinedAt: z.number()
})

export type TeamParticipant = z.infer<typeof TeamParticipantSchema>

export const TeamChatMessageSchema = z.object({
    id: z.string(),
    teamChatId: z.string(),
    seq: z.number(),
    authorParticipantId: z.string(),
    text: z.string(),
    reportType: TeamReportTypeSchema.optional(),
    replyToMessageId: z.string().nullable().optional(),
    replyPreview: z.object({
        authorName: z.string(),
        excerpt: z.string()
    }).nullable().optional(),
    mentions: z.array(z.object({
        participantId: z.string(),
        sessionId: z.string()
    })).default([]),
    files: z.array(z.string()).default([]),
    createdAt: z.number()
})

export type TeamChatMessage = z.infer<typeof TeamChatMessageSchema>

export const TeamMentionRequestSchema = z.object({
    id: z.string(),
    teamChatId: z.string(),
    sourceMessageId: z.string(),
    targetSessionId: z.string(),
    status: TeamMentionStatusSchema,
    contextSnapshot: TeamMentionContextSnapshotSchema,
    hopDepth: z.number().int().min(0).default(0),
    parentRequestId: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    createdAt: z.number(),
    deliveredAt: z.number().nullable().optional(),
    seenAt: z.number().nullable().optional(),
    processingStartedAt: z.number().nullable().optional(),
    resolvedAt: z.number().nullable().optional()
})

export type TeamMentionRequest = z.infer<typeof TeamMentionRequestSchema>

export const ReportToTeamInputSchema = z.object({
    teamChatId: z.string().min(1),
    type: TeamReportTypeSchema,
    summary: z.string().trim().min(3).max(4_000),
    details: z.string().trim().max(20_000).optional(),
    replyToMessageId: z.string().nullable().optional(),
    replyToRequestId: z.string().nullable().optional(),
    mentions: z.array(z.string().min(1)).default([]),
    files: z.array(z.string().min(1)).default([])
})

export type ReportToTeamInput = z.input<typeof ReportToTeamInputSchema>

export const MarkTeamMentionNoActionInputSchema = z.object({
    requestId: z.string().min(1)
})

export type MarkTeamMentionNoActionInput = z.input<typeof MarkTeamMentionNoActionInputSchema>

export const AttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional()
})

export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>

export const DecryptedMessageSchema = z.object({
    id: z.string(),
    seq: z.number().nullable(),
    localId: z.string().nullable(),
    content: z.unknown(),
    createdAt: z.number(),
    invokedAt: z.number().nullable().optional(),
    scheduledAt: z.number().nullable().optional()
})

export type DecryptedMessage = z.infer<typeof DecryptedMessageSchema>

export const SessionSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MetadataSchema.nullable(),
    metadataVersion: z.number(),
    agentState: AgentStateSchema.nullable(),
    agentStateVersion: z.number(),
    thinking: z.boolean(),
    thinkingAt: z.number(),
    backgroundTaskCount: z.number().optional(),
    scratchlistUpdatedAt: z.number().optional(),
    todos: TodosSchema.optional(),
    teamState: TeamStateSchema.optional(),
    model: z.string().nullable().optional().default(null),
    modelReasoningEffort: z.string().nullable().optional().default(null),
    effort: z.string().nullable().optional().default(null),
    permissionMode: PermissionModeSchema.optional(),
    collaborationMode: CodexCollaborationModeSchema.optional(),
    terminalLiveCount: z.number().int().nonnegative().optional()
})

export type Session = z.infer<typeof SessionSchema>

export const SessionPatchSchema = z.object({
    active: z.boolean().optional(),
    thinking: z.boolean().optional(),
    activeAt: z.number().optional(),
    updatedAt: z.number().optional(),
    model: z.string().nullable().optional(),
    modelReasoningEffort: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    permissionMode: PermissionModeSchema.optional(),
    collaborationMode: CodexCollaborationModeSchema.optional(),
    backgroundTaskCount: z.number().optional(),
    scratchlistUpdatedAt: z.number().optional()
}).strict()

export type SessionPatch = z.infer<typeof SessionPatchSchema>

export const MachineMetadataSchema = z.object({
    host: z.string(),
    platform: z.string(),
    happyCliVersion: z.string(),
    displayName: z.string().optional(),
    homeDir: z.string().optional(),
    happyHomeDir: z.string().optional(),
    happyLibDir: z.string().optional(),
    workspaceRoots: z.array(z.string()).optional()
})

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>

export const RunnerStateSchema = z.object({
    status: z.union([z.enum(["running", "shutting-down"]), z.string()]),
    pid: z.number().optional(),
    httpPort: z.number().optional(),
    startedAt: z.number().optional(),
    shutdownRequestedAt: z.number().optional(),
    shutdownSource: z.union([z.enum(["mobile-app", "cli", "os-signal", "unknown"]), z.string()]).optional(),
    lastSpawnError: z.object({
        message: z.string(),
        pid: z.number().optional(),
        exitCode: z.number().nullable().optional(),
        signal: z.string().nullable().optional(),
        at: z.number()
    }).nullable().optional()
})

export type RunnerState = z.infer<typeof RunnerStateSchema>

export const MachineSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MachineMetadataSchema.nullable(),
    metadataVersion: z.number(),
    runnerState: RunnerStateSchema.nullable(),
    runnerStateVersion: z.number()
})

export type Machine = z.infer<typeof MachineSchema>

export const MachinePatchSchema = z.object({
    active: z.boolean().optional(),
    activeAt: z.number().optional(),
    updatedAt: z.number().optional()
}).strict()

export type MachinePatch = z.infer<typeof MachinePatchSchema>

export const SessionUpdatedDataSchema = z.union([SessionSchema, SessionPatchSchema])
export type SessionUpdatedData = z.infer<typeof SessionUpdatedDataSchema>

export const MachineUpdatedDataSchema = z.union([MachineSchema, MachinePatchSchema, z.null()])
export type MachineUpdatedData = z.infer<typeof MachineUpdatedDataSchema>


const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string()
})

const MachineChangedSchema = SessionEventBaseSchema.extend({
    machineId: z.string()
})

export const SyncEventSchema = z.discriminatedUnion('type', [
    SessionChangedSchema.extend({
        type: z.literal('session-added'),
        data: SessionUpdatedDataSchema.optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: SessionUpdatedDataSchema.optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('session-removed'),
        sessionId: z.string()
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-received'),
        message: DecryptedMessageSchema
    }),
    SessionChangedSchema.extend({
        type: z.literal('messages-invalidated')
    }),
    // Per-tool liveness heartbeat while a tool is still executing. Ephemeral by
    // design: never persisted as a message, and safe to drop — clients treat its
    // absence as "no information", not as "tool stopped".
    SessionChangedSchema.extend({
        type: z.literal('tool-progress'),
        toolUseId: z.string(),
        parentToolUseId: z.string().nullable().optional(),
        toolName: z.string().optional(),
        elapsedSeconds: z.number().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-ended'),
        reason: SessionEndReasonSchema.optional()
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: MachineUpdatedDataSchema.optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('toast'),
        data: z.object({
            title: z.string(),
            body: z.string(),
            sessionId: z.string(),
            url: z.string()
        })
    }),
    SessionChangedSchema.extend({
        type: z.literal('messages-consumed'),
        localIds: z.array(z.string()),
        invokedAt: z.number().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-cancelled'),
        messageId: z.string(),
        localId: z.string().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('heartbeat'),
        data: z.object({
            timestamp: z.number()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('connection-changed'),
        data: z.object({
            status: z.string(),
            subscriptionId: z.string().optional()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('team-chat-updated'),
        teamChatId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('team-message-created'),
        teamChatId: z.string(),
        messageId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('team-mention-updated'),
        teamChatId: z.string(),
        requestId: z.string(),
        sessionId: z.string(),
        targetSessionId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('team-participant-updated'),
        teamChatId: z.string(),
        participantId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('shared-hub-updated'),
        eventId: z.string(),
        name: z.string(),
        resourceType: z.string(),
        resourceId: z.string()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('terminal-snippets-updated')
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>

export const ScratchlistAttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
});
export type ScratchlistAttachmentMetadata = z.infer<typeof ScratchlistAttachmentMetadataSchema>;

export const ScratchlistEntrySchema = z.object({
    id: z.string().min(1),
    text: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    attachments: z.array(ScratchlistAttachmentMetadataSchema).optional()
});
export type ScratchlistEntry = z.infer<typeof ScratchlistEntrySchema>;

export const GetScratchlistResponseSchema = z.object({
    entries: z.array(ScratchlistEntrySchema)
});
export type GetScratchlistResponse = z.infer<typeof GetScratchlistResponseSchema>;

export const UpdateScratchlistRequestSchema = z.object({
    entries: z.array(ScratchlistEntrySchema)
});
export type UpdateScratchlistRequest = z.infer<typeof UpdateScratchlistRequestSchema>;

export const UploadScratchlistAttachmentResponseSchema = z.object({
    success: z.boolean(),
    attachment: ScratchlistAttachmentMetadataSchema.optional(),
    error: z.string().optional(),
    code: z.string().optional()
});
export type UploadScratchlistAttachmentResponse = z.infer<typeof UploadScratchlistAttachmentResponseSchema>;

export type CommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type GitCommandResponse = CommandResponse

export type FileReadResponse = {
    success: boolean
    content?: string
    size?: number
    error?: string
}

export type GeneratedImageResponse = {
    success: boolean
    content?: string
    size?: number
    mimeType?: string
    fileName?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
    gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type RpcListDirectoryResponse = ListDirectoryResponse

export type MachineDirectoryEntry = DirectoryEntry & {
    isGitRepo?: boolean
}

export type MachineListDirectoryResponse = {
    success: boolean
    entries?: MachineDirectoryEntry[]
    error?: string
}

export type PathExistsResponse = {
    exists: Record<string, boolean>
}

export type MachinePathsExistsResponse = PathExistsResponse

export type CodexModelSummary = {
    id: string
    displayName: string
    isDefault: boolean
    defaultReasoningEffort?: string | null
    supportedReasoningEfforts?: string[]
}

export type CodexModelsResponse = {
    success: boolean
    models?: CodexModelSummary[]
    error?: string
}

export type ListCodexModelsResponse = CodexModelsResponse

export type OpencodeModelSummary = {
    modelId: string
    name?: string
}

export type OpencodeEffortSummary = { effortId: string; name?: string }

export type OpencodeModelsResponse = {
    success: boolean
    availableModels?: OpencodeModelSummary[]
    currentModelId?: string | null
    availableEfforts?: OpencodeEffortSummary[]
    currentEffortId?: string | null
    error?: string
}

export type ListOpencodeModelsResponse = OpencodeModelsResponse

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export const CreateOrLoadSessionRequestSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional(),
    model: z.string().optional(),
    modelReasoningEffort: z.string().optional(),
    effort: z.string().optional()
})

export type CreateOrLoadSessionRequest = z.infer<typeof CreateOrLoadSessionRequestSchema>

export const CreateOrLoadMachineRequestSchema = z.object({
    id: z.string().min(1),
    metadata: z.unknown(),
    runnerState: z.unknown().nullable().optional()
})

export type CreateOrLoadMachineRequest = z.infer<typeof CreateOrLoadMachineRequestSchema>

export const CliMessagesResponseSchema = z.object({
    messages: z.array(z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        content: z.unknown()
    }))
})

export type CliMessagesResponse = z.infer<typeof CliMessagesResponseSchema>

export const CreateSessionResponseSchema = z.object({
    session: SessionSchema
})

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const CreateMachineResponseSchema = z.object({
    machine: MachineSchema
})

export type CreateMachineResponse = z.infer<typeof CreateMachineResponseSchema>

export const GetSessionResponseSchema = CreateSessionResponseSchema
export type GetSessionResponse = CreateSessionResponse

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        nextBeforeSeq: number | null
        nextBeforeAt: number | null
        hasMore: boolean
    }
}

export type ReopenSessionResponse = {
    sessionId: string
    resumed: boolean
    cursorSessionProtocol?: 'acp' | 'stream-json'
}

export type MachinesResponse = { machines: Machine[] }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type SqliteStorageUsageResponse = {
    path: string
    databaseBytes: number
    walBytes: number
    shmBytes: number
    totalBytes: number
}

export const CancelMessageResponseSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('cancelled'), localId: z.string().nullable() }),
    z.object({ status: z.literal('invoked'), message: DecryptedMessageSchema }),
])

export type CancelMessageResponse = z.infer<typeof CancelMessageResponseSchema>

