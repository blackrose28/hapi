export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    model: string | null
    modelReasoningEffort: string | null
    effort: string | null
    serviceTier: string | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
    invokedAt: number | null
    scheduledAt: number | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type StoredTerminalSnippet = {
    id: string
    namespace: string
    name: string
    command: string
    description: string | null
    createdAt: number
    updatedAt: number
}

export type StoredTeamChat = {
    id: string
    namespace: string
    ownerMembershipId: string | null
    name: string
    projectPath: string | null
    sharedContext: unknown | null
    archivedAt: number | null
    createdAt: number
    updatedAt: number
}

export type StoredTeamParticipant = {
    id: string
    namespace: string
    teamChatId: string
    type: 'user' | 'session'
    userId: string | null
    sessionId: string | null
    displayName: string
    role: 'backend' | 'frontend' | 'tests' | 'reviewer' | 'docs' | 'general'
    color: string
    archivedAt: number | null
    joinedAt: number
}

export type StoredTeamMessage = {
    id: string
    namespace: string
    teamChatId: string
    seq: number
    authorParticipantId: string
    text: string
    reportType: 'reply' | 'progress' | 'done' | 'blocked' | 'question' | 'handoff' | null
    replyToMessageId: string | null
    replyPreview: unknown | null
    mentions: unknown
    files: unknown
    createdAt: number
}

export type StoredTeamMentionRequest = {
    id: string
    namespace: string
    teamChatId: string
    sourceMessageId: string
    targetSessionId: string
    status: 'pending' | 'delivered' | 'seen' | 'processing' | 'responded' | 'no_action' | 'superseded' | 'failed'
    contextSnapshot: unknown
    hopDepth: number
    parentRequestId: string | null
    error: string | null
    createdAt: number
    deliveredAt: number | null
    seenAt: number | null
    processingStartedAt: number | null
    resolvedAt: number | null
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }

export type DbScratchlistRow = {
    session_id: string
    id: string
    text: string
    created_at: number
    updated_at: number
    attachments: string | null
}
