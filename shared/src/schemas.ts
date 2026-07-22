import { z } from 'zod'
import { CachedAgentModelCatalogSchema } from './agentModels'
import { CODEX_COLLABORATION_MODES, PERMISSION_MODES } from './modes'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export const CodexCollaborationModeSchema = z.enum(CODEX_COLLABORATION_MODES)

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
    cursorSessionId: z.string().optional(),
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
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional(),
    lastUserRequest: z.string().optional(),
    cachedAgentModels: CachedAgentModelCatalogSchema.optional(),
    cachedCodexModels: CachedCodexModelsSchema.optional(),
    cachedOpencodeModels: CachedOpencodeModelsSchema.optional()
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
    updatedAt: z.number().optional()
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
    invokedAt: z.number().nullable().optional()
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
        data: z.unknown().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: z.unknown().optional()
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
    SessionChangedSchema.extend({
        type: z.literal('session-ended'),
        reason: z.enum(['completed', 'terminated', 'error']).optional()
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: z.unknown().optional()
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
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
