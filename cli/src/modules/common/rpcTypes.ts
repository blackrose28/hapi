import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    existingSessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string
    effort?: string
    modelReasoningEffort?: string
    yolo?: boolean
    permissionMode?: string
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    serviceTier?: string
    recoveryContext?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
