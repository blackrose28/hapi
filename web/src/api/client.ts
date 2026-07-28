import type { SqliteStorageUsageResponse } from "@hapi/protocol/schemas"
import type {
    AttachmentMetadata,
    EditorDirectoryResponse,
    EditorFileResponse,
    EditorFileMutationResponse,
    EditorGitStatusV2Response,
    EditorGitListBranchesResponse,
    EditorGitStashListResponse,
    EditorProjectsResponse,
    AgentModelsResponse,
    CodexLocalSessionsResponse,
    CodexDuplicateSessionsResponse,
    CodexMergeDuplicateSessionsResponse,
    CodexDesktopScriptResponse,
    CodexDesktopSyncRequest,
    CodexDesktopStatusResponse,
    CodexArchiveSessionResponse,
    CodexCollaborationMode,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitCommandResponse,
    MachineListDirectoryResponse,
    MachinePathsExistsResponse,
    MachinesResponse,
    MessagesResponse,
    CodexModelsResponse,
    OpencodeModelsResponse,
    PiModelsResponse,
    GrokModelsResponse,
    GrokReasoningEffortResponse,
    PermissionMode,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    UploadFileResponse,
    VisibilityPayload,
    HapiSessionExport,
    SessionResponse,
    SessionTeamMembershipsResponse,
    SessionsResponse,
    TeamChatResponse,
    TeamChatsResponse,
    TeamMessagesResponse,
    TeamParticipant,
    TeamMentionRequest,
    TeamChatMessage
} from '@/types/api'
import type {
    CancelMessageResponse,
    CursorMigrateOutcome,
    CursorMigrateToAcpRequest,
    CursorModelsResponse,
    ListOpencodeReasoningEffortOptionsResponse as OpencodeReasoningEffortResponse,
    ReopenSessionResponse
} from '@hapi/protocol/schemas'
import {
    TerminalSnippetResponseSchema,
    TerminalSnippetsResponseSchema,
    type AgentFlavor,
    type CreateTerminalSnippetInput,
    type TerminalSnippetResponse,
    type TerminalSnippetsResponse,
    type UpdateTerminalSnippetInput
} from '@hapi/protocol'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
    cacheScopeId?: string
}

type ErrorPayload = {
    error?: unknown
    code?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        if (typeof parsed.code === 'string') return parsed.code
        if (typeof parsed.error === 'string') return parsed.error
        return undefined
    } catch {
        return undefined
    }
}

function readCsrfCookie(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)__Host-hapi_csrf=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : null
}

function normalizeCacheBaseUrl(baseUrl: string | null | undefined): string {
    const fallbackOrigin = typeof globalThis.location?.origin === 'string'
        ? globalThis.location.origin
        : 'same-origin'
    const candidate = baseUrl?.trim() || fallbackOrigin

    try {
        return new URL(candidate).origin
    } catch {
        return candidate.replace(/\/+$/, '') || 'same-origin'
    }
}

export function deriveApiCacheScope(
    baseUrl: string | null | undefined,
    scopeId: string | null | undefined
): string {
    return JSON.stringify([
        normalizeCacheBaseUrl(baseUrl),
        scopeId?.trim() || 'unknown'
    ])
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    readonly cacheScope: string
    private readonly baseUrl: string | null

    constructor(options?: ApiClientOptions) {
        this.cacheScope = deriveApiCacheScope(options?.baseUrl, options?.cacheScopeId)
        this.baseUrl = options?.baseUrl ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async requestBlob(
        path: string,
        init?: RequestInit
    ): Promise<Blob> {
        const headers = new Headers(init?.headers)
        const method = init?.method ?? 'GET'
        const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
        if (isMutation) {
            const csrfToken = readCsrfCookie()
            if (csrfToken) headers.set('x-csrf-token', csrfToken)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers,
            credentials: 'include'
        })

        if (res.status === 401) {
            window.location.href = (this.baseUrl ?? '') + '/api/auth/login'
            throw new Error('Session expired.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.blob()
    }

    private async request<T>(
        path: string,
        init?: RequestInit
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const method = init?.method ?? 'GET'
        const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
        if (isMutation) {
            const csrfToken = readCsrfCookie()
            if (csrfToken) headers.set('x-csrf-token', csrfToken)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers,
            credentials: 'include'
        })

        if (res.status === 401) {
            window.location.href = (this.baseUrl ?? '') + '/api/auth/login'
            throw new Error('Session expired.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        if (res.status === 204) return undefined as T
        return await res.json().catch(() => undefined) as T
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getTerminalSnippets(): Promise<TerminalSnippetsResponse> {
        return TerminalSnippetsResponseSchema.parse(
            await this.request<unknown>('/api/terminal-snippets')
        )
    }

    async createTerminalSnippet(
        input: CreateTerminalSnippetInput
    ): Promise<TerminalSnippetResponse> {
        return TerminalSnippetResponseSchema.parse(
            await this.request<unknown>('/api/terminal-snippets', {
                method: 'POST',
                body: JSON.stringify(input)
            })
        )
    }

    async updateTerminalSnippet(
        id: string,
        input: UpdateTerminalSnippetInput
    ): Promise<TerminalSnippetResponse> {
        return TerminalSnippetResponseSchema.parse(
            await this.request<unknown>(
                `/api/terminal-snippets/${encodeURIComponent(id)}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(input)
                }
            )
        )
    }

    async deleteTerminalSnippet(id: string): Promise<void> {
        await this.request(`/api/terminal-snippets/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        })
    }

    async getTeamChats(): Promise<TeamChatsResponse> {
        return await this.request<TeamChatsResponse>('/api/team-chats')
    }

    async createTeamChat(input: { name: string; projectPath?: string | null }): Promise<TeamChatResponse> {
        return await this.request<TeamChatResponse>('/api/team-chats', {
            method: 'POST',
            body: JSON.stringify(input)
        })
    }

    async getTeamChat(teamChatId: string): Promise<TeamChatResponse> {
        return await this.request<TeamChatResponse>(`/api/team-chats/${encodeURIComponent(teamChatId)}`)
    }

    async deleteTeamChat(teamChatId: string): Promise<void> {
        await this.request(`/api/team-chats/${encodeURIComponent(teamChatId)}`, {
            method: 'DELETE'
        })
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async syncCodexSession(payload?: CodexDesktopSyncRequest): Promise<CodexDesktopScriptResponse> {
        // 中文注释：当前按钮语义已改为“从 Codex 导入到 Hapi”；这里提交的是本地 transcript 对应的 Codex thread ID 列表。
        return await this.request<CodexDesktopScriptResponse>('/api/codex/sync-session', {
            method: 'POST',
            ...(payload ? { body: JSON.stringify(payload) } : {})
        })
    }

    async getCodexSessions(cwd?: string | null, machineId?: string | null): Promise<CodexLocalSessionsResponse> {
        const params = new URLSearchParams()
        if (cwd?.trim()) params.set('cwd', cwd.trim())
        if (machineId?.trim()) params.set('machineId', machineId.trim())
        const query = params.size ? `?${params.toString()}` : ''
        return await this.request<CodexLocalSessionsResponse>(`/api/codex/sessions${query}`)
    }

    async archiveCodexSession(sessionId: string, machineId?: string | null): Promise<CodexArchiveSessionResponse> {
        return await this.request<CodexArchiveSessionResponse>('/api/codex/archive-session', {
            method: 'POST',
            body: JSON.stringify({ sessionId, machineId: machineId ?? undefined })
        })
    }

    async getCodexDesktopStatus(): Promise<CodexDesktopStatusResponse> {
        return await this.request<CodexDesktopStatusResponse>('/api/codex/status')
    }

    async getCodexDuplicateSessions(payload: CodexDesktopSyncRequest): Promise<CodexDuplicateSessionsResponse> {
        // 中文注释：重复会话检测只传本次用户勾选导入的 codexSessionId，避免把未选中的历史会话也纳入提示。
        return await this.request<CodexDuplicateSessionsResponse>('/api/codex/duplicate-sessions', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async mergeCodexDuplicateSessions(payload: CodexDesktopSyncRequest): Promise<CodexMergeDuplicateSessionsResponse> {
        // 中文注释：真正执行合并时沿用同一批选中 codexSessionId，保证检测范围与执行范围一致。
        return await this.request<CodexMergeDuplicateSessionsResponse>('/api/codex/merge-duplicate-sessions', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async restartCodexDesktop(): Promise<CodexDesktopScriptResponse> {
        return await this.request<CodexDesktopScriptResponse>('/api/codex/restart-desktop', {
            method: 'POST'
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getTeamMessages(teamChatId: string, opts?: { limit?: number; beforeSeq?: number | null }): Promise<TeamMessagesResponse> {
        const params = new URLSearchParams()
        if (opts?.limit) params.set('limit', String(opts.limit))
        if (opts?.beforeSeq) params.set('beforeSeq', String(opts.beforeSeq))
        const qs = params.toString()
        return await this.request<TeamMessagesResponse>(`/api/team-chats/${encodeURIComponent(teamChatId)}/messages${qs ? `?${qs}` : ''}`)
    }

    async sendTeamMessage(teamChatId: string, input: { authorParticipantId: string; text: string; replyToMessageId?: string | null }): Promise<{ message: TeamChatMessage }> {
        return await this.request<{ message: TeamChatMessage }>(`/api/team-chats/${encodeURIComponent(teamChatId)}/messages`, {
            method: 'POST',
            body: JSON.stringify(input)
        })
    }

    async getTeamMessagesAround(teamChatId: string, messageId: string): Promise<TeamMessagesResponse> {
        return await this.request<TeamMessagesResponse>(`/api/team-chats/${encodeURIComponent(teamChatId)}/messages/${encodeURIComponent(messageId)}/context`)
    }

    async getTeamParticipants(teamChatId: string): Promise<{ participants: TeamParticipant[] }> {
        return await this.request<{ participants: TeamParticipant[] }>(`/api/team-chats/${encodeURIComponent(teamChatId)}/participants`)
    }

    async addTeamParticipant(
        teamChatId: string,
        input: {
            type: 'user' | 'session'
            userId?: string | null
            sessionId?: string | null
            displayName: string
            role: TeamParticipant['role']
            color: string
        }
    ): Promise<{ participant: TeamParticipant }> {
        return await this.request<{ participant: TeamParticipant }>(`/api/team-chats/${encodeURIComponent(teamChatId)}/participants`, {
            method: 'POST',
            body: JSON.stringify(input)
        })
    }

    async updateTeamParticipant(
        teamChatId: string,
        participantId: string,
        input: {
            displayName: string
            role: TeamParticipant['role']
            color: string
        }
    ): Promise<{ participant: TeamParticipant }> {
        return await this.request<{ participant: TeamParticipant }>(`/api/team-chats/${encodeURIComponent(teamChatId)}/participants/${encodeURIComponent(participantId)}`, {
            method: 'PATCH',
            body: JSON.stringify(input)
        })
    }

    async deleteTeamParticipant(teamChatId: string, participantId: string): Promise<void> {
        await this.request(`/api/team-chats/${encodeURIComponent(teamChatId)}/participants/${encodeURIComponent(participantId)}`, {
            method: 'DELETE'
        })
    }

    async getSessionTeamMentions(sessionId: string): Promise<{ requests: TeamMentionRequest[] }> {
        return await this.request<{ requests: TeamMentionRequest[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/team-mentions`)
    }

    async getSessionTeamMemberships(sessionId: string): Promise<SessionTeamMembershipsResponse> {
        return await this.request<SessionTeamMembershipsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/team-memberships`)
    }

    async updateTeamMentionStatus(
        sessionId: string,
        requestId: string,
        status: TeamMentionRequest['status']
    ): Promise<{ request: TeamMentionRequest }> {
        return await this.request<{ request: TeamMentionRequest }>(`/api/sessions/${encodeURIComponent(sessionId)}/team-mentions/${encodeURIComponent(requestId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        })
    }

    async getSessionExport(sessionId: string, options?: { signal?: AbortSignal }): Promise<HapiSessionExport> {
        return await this.request<HapiSessionExport>(
            `/api/sessions/${encodeURIComponent(sessionId)}/export`,
            { signal: options?.signal }
        )
    }

    async getMessages(
        sessionId: string,
        options: {
            beforeSeq?: number | null
            beforeAt?: number | null
            byPosition?: boolean
            limit?: number
        }
    ): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.byPosition || options.beforeAt !== undefined && options.beforeAt !== null) {
            params.set('byPosition', '1')
        }
        if (options.beforeAt !== undefined && options.beforeAt !== null) {
            params.set('beforeAt', `${options.beforeAt}`)
        }
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string, opts?: { permissionMode?: string }): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            {
                method: 'POST',
                ...(opts?.permissionMode !== undefined && {
                    body: JSON.stringify({ permissionMode: opts.permissionMode })
                })
            }
        )
        return response.sessionId
    }

    async sendMessage(
        sessionId: string,
        text: string,
        localId?: string | null,
        attachments?: AttachmentMetadata[],
        scheduledAt?: number | null
    ): Promise<{ status: 'sent'; sessionId: string } | { status: 'resuming'; sessionId: string }> {
        const headers = new Headers({
            'content-type': 'application/json'
        })
        const csrfToken = readCsrfCookie()
        if (csrfToken) headers.set('x-csrf-token', csrfToken)

        const res = await fetch(this.buildUrl(`/api/sessions/${encodeURIComponent(sessionId)}/messages`), {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined,
                scheduledAt: scheduledAt ?? undefined
            })
        })

        if (res.status === 202) {
            const body = await res.json().catch(() => null) as { sessionId?: string } | null
            return { status: 'resuming', sessionId: body?.sessionId ?? sessionId }
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`)
        }

        const body = await res.json().catch(() => null) as { sessionId?: string } | null
        return { status: 'sent', sessionId: body?.sessionId ?? sessionId }
    }

    async cancelMessage(sessionId: string, messageId: string): Promise<CancelMessageResponse> {
        const response = await this.request(
            `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
            { method: 'DELETE' }
        )
        return response as CancelMessageResponse
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async reopenSession(sessionId: string): Promise<ReopenSessionResponse> {
        return await this.request<ReopenSessionResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/reopen`,
            {
                method: 'POST',
                body: JSON.stringify({})
            }
        )
    }

    /**
     * Migrate a legacy stream-json Cursor session to ACP. See tiann/hapi#824.
     *
     * Refusals (e.g. running session, missing on-disk store, target collision)
     * are returned as structured `{ok: false, reason, message}` outcomes
     * rather than thrown - the UI surfaces the reason to the operator and the
     * underlying state on disk is unchanged.
     *
     * 401s trigger the same onUnauthorized refresh path as the shared
     * `request()` helper so an expired JWT silently re-auths instead of
     * hard-failing the migration dialog (Codex review #34 P2).
     */
    async migrateCursorSessionToAcp(sessionId: string, body: CursorMigrateToAcpRequest = {}): Promise<CursorMigrateOutcome> {
        const path = `/api/sessions/${encodeURIComponent(sessionId)}/migrate-to-acp`
        try {
            return await this.request<CursorMigrateOutcome>(path, {
                method: 'POST',
                body: JSON.stringify(body)
            })
        } catch (err) {
            if (err instanceof ApiError && err.body) {
                try {
                    const parsed = JSON.parse(err.body)
                    if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
                        return parsed as CursorMigrateOutcome
                    }
                } catch {
                    // Fallthrough
                }
            }
            throw err
        }
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setCollaborationMode(sessionId: string, mode: CodexCollaborationMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/collaboration-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModel(sessionId: string, model: { provider: string; modelId: string } | string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async getSessionPiModels(sessionId: string): Promise<PiModelsResponse> {
        return await this.request<PiModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/pi-models`
        )
    }

    async setModelReasoningEffort(sessionId: string, modelReasoningEffort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model-reasoning-effort`, {
            method: 'POST',
            body: JSON.stringify({ modelReasoningEffort })
        })
    }

    async setEffort(sessionId: string, effort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/effort`, {
            method: 'POST',
            body: JSON.stringify({ effort })
        })
    }

    async setServiceTier(sessionId: string, serviceTier: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/service-tier`, {
            method: 'POST',
            body: JSON.stringify({ serviceTier })
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }

    async listMachineDirectory(
        machineId: string,
        path: string
    ): Promise<MachineListDirectoryResponse> {
        return await this.request<MachineListDirectoryResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/list-directory`,
            {
                method: 'POST',
                body: JSON.stringify({ path })
            }
        )
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: AgentFlavor,
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        effort?: string,
        resumeSessionId?: string,
        permissionMode?: PermissionMode,
        serviceTier?: 'fast' | 'standard',
        collaborationMode?: 'default' | 'plan'
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({ directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, effort, resumeSessionId, permissionMode, serviceTier, collaborationMode })
        })
    }

    async getMachineCodexModels(machineId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/codex-models`
        )
    }

    async getSessionCodexModels(sessionId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/codex-models`
        )
    }

    async getMachineAgentModels(
        machineId: string,
        agent: AgentFlavor,
        cwd?: string
    ): Promise<AgentModelsResponse> {
        const params = new URLSearchParams({ agent })
        if (cwd) {
            params.set('cwd', cwd)
        }
        return await this.request<AgentModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/models?${params.toString()}`
        )
    }

    async getSessionAgentModels(
        sessionId: string,
        agent: AgentFlavor
    ): Promise<AgentModelsResponse> {
        return await this.request<AgentModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/models?agent=${encodeURIComponent(agent)}`
        )
    }

    async getSessionOpencodeModels(sessionId: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/opencode-models`
        )
    }

    async getSessionOpencodeReasoningEffortOptions(sessionId: string): Promise<OpencodeReasoningEffortResponse> {
        return await this.request<OpencodeReasoningEffortResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/opencode-reasoning-effort-options`
        )
    }

    async getSessionCursorModels(sessionId: string): Promise<CursorModelsResponse> {
        return await this.request<CursorModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/cursor-models`
        )
    }

    async getMachineCursorModels(machineId: string): Promise<CursorModelsResponse> {
        return await this.request<CursorModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/cursor-models`
        )
    }

    async getMachineOpencodeModelsForCwd(machineId: string, cwd: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/opencode-models?cwd=${encodeURIComponent(cwd)}`
        )
    }

    async getSessionGrokModels(sessionId: string): Promise<GrokModelsResponse> {
        return await this.request<GrokModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/grok-models`
        )
    }

    async getMachineGrokModelsForCwd(machineId: string, cwd: string): Promise<GrokModelsResponse> {
        return await this.request<GrokModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/grok-models?cwd=${encodeURIComponent(cwd)}`
        )
    }

    async getSessionGrokReasoningEffortOptions(sessionId: string): Promise<GrokReasoningEffortResponse> {
        return await this.request<GrokReasoningEffortResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/grok-reasoning-effort-options`
        )
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }


    async listEditorDirectory(
        machineId: string,
        path: string
    ): Promise<EditorDirectoryResponse> {
        return await this.request<EditorDirectoryResponse>(
            `/api/editor/directory`,
            {
                method: "POST",
                body: JSON.stringify({ machineId, path })
            }
        )
    }

    async readEditorFile(
        machineId: string,
        path: string
    ): Promise<EditorFileResponse> {
        return await this.request<EditorFileResponse>(
            `/api/editor/file`,
            {
                method: "POST",
                body: JSON.stringify({ machineId, path })
            }
        )
    }

    async getEditorFileRawBlob(
        machineId: string,
        path: string
    ): Promise<Blob> {
        return await this.requestBlob(
            '/api/editor/file/raw',
            {
                method: 'POST',
                body: JSON.stringify({ machineId, path })
            }
        )
    }

    async writeEditorFile(
        machineId: string,
        path: string,
        content: string
    ): Promise<EditorFileMutationResponse> {
        return await this.request<EditorFileMutationResponse>(
            `/api/editor/file/write`,
            {
                method: "POST",
                body: JSON.stringify({ machineId, path, content })
            }
        )
    }

    async createEditorFile(
        machineId: string,
        path: string,
        content: string = ''
    ): Promise<EditorFileMutationResponse> {
        return await this.request<EditorFileMutationResponse>(
            `/api/editor/file/create`,
            {
                method: "POST",
                body: JSON.stringify({ machineId, path, content })
            }
        )
    }

    async deleteEditorFile(
        machineId: string,
        path: string
    ): Promise<EditorFileMutationResponse> {
        return await this.request<EditorFileMutationResponse>(
            `/api/editor/file/delete`,
            {
                method: "POST",
                body: JSON.stringify({ machineId, path })
            }
        )
    }

    async listEditorProjects(
        machineId: string
    ): Promise<EditorProjectsResponse> {
        return await this.request<EditorProjectsResponse>(
            `/api/editor/projects`,
            {
                method: "POST",
                body: JSON.stringify({ machineId })
            }
        )
    }

    async getEditorGitStatusV2(machineId: string, projectPath: string, repoRoot?: string): Promise<EditorGitStatusV2Response> {
        return await this.request<EditorGitStatusV2Response>('/api/editor/git-status-v2', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async getEditorGitDiffFile(machineId: string, projectPath: string, filePath: string, staged?: boolean, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-diff-file', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, filePath, staged })
        })
    }

    async stageEditorGitFile(machineId: string, projectPath: string, filePath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-stage-file', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, filePath })
        })
    }

    async unstageEditorGitFile(machineId: string, projectPath: string, filePath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-unstage-file', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, filePath })
        })
    }

    async stageAllEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-stage-all', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async unstageAllEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-unstage-all', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async commitEditorGit(machineId: string, projectPath: string, message: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-commit', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, message })
        })
    }

    async pullEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-pull', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async pushEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-push', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }
    async listEditorGitBranches(machineId: string, projectPath: string, repoRoot?: string): Promise<EditorGitListBranchesResponse> {
        return await this.request<EditorGitListBranchesResponse>('/api/editor/git-list-branches', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async checkoutEditorGitBranch(machineId: string, projectPath: string, branch: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-checkout', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, branch })
        })
    }

    async createEditorGitBranch(machineId: string, projectPath: string, branch: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-create-branch', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, branch })
        })
    }

    async fetchEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-fetch', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }
    async discardEditorGitFile(machineId: string, projectPath: string, filePath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-discard-file', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot, filePath })
        })
    }

    async discardAllEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-discard-all', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async listEditorGitStashes(machineId: string, projectPath: string, repoRoot?: string): Promise<EditorGitStashListResponse> {
        return await this.request<EditorGitStashListResponse>('/api/editor/git-stash-list', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async stashPushEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-stash-push', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }

    async stashPopEditorGit(machineId: string, projectPath: string, repoRoot?: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>('/api/editor/git-stash-pop', {
            method: 'POST',
            body: JSON.stringify({ machineId, path: projectPath, repoRoot })
        })
    }


    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async archiveAllSessions(): Promise<{ archived: number }> {
        return await this.request('/api/sessions/archive-all', {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async getSqliteStorageUsage(): Promise<SqliteStorageUsageResponse> {
        return await this.request<SqliteStorageUsageResponse>('/api/storage/sqlite')
    }

    async deleteArchivedSessions(): Promise<{ deleted: number }> {
        return await this.request('/api/sessions/archived', {
            method: 'DELETE'
        })
    }

    
    async getScratchlist(sessionId: string): Promise<{ entries: import('@hapi/protocol/schemas').ScratchlistEntry[] }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/scratchlist`)
    }

    async updateScratchlist(sessionId: string, entries: import('@hapi/protocol/schemas').ScratchlistEntry[]): Promise<{ ok: boolean }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/scratchlist`, {
            method: 'PUT',
            body: JSON.stringify({ entries })
        })
    }

    async uploadScratchlistAttachment(
        sessionId: string,
        filename: string,
        content: string,
        mimeType: string
    ): Promise<{ success: boolean; attachment?: import('@hapi/protocol/schemas').ScratchlistAttachmentMetadata; error?: string; code?: string }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/scratchlist/attachments`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async fetchScratchlistAttachmentBlob(sessionId: string, attachmentId: string): Promise<Blob> {
        return new Blob(['mock content'])
    }

    async deleteScratchlistAttachment(sessionId: string, attachmentId: string): Promise<void> {
        const { entries } = await this.getScratchlist(sessionId);
        const next = entries.map(e => ({
            ...e,
            attachments: e.attachments?.filter(a => a.id !== attachmentId)
        }));
        await this.updateScratchlist(sessionId, next);
    }

    async createScratchlistEntry(
        sessionId: string,
        body: { text: string; id?: string; createdAt?: number; attachments?: import('@hapi/protocol/schemas').ScratchlistAttachmentMetadata[] }
    ): Promise<{ entry: import('@hapi/protocol/schemas').ScratchlistEntry }> {
        const { entries } = await this.getScratchlist(sessionId);
        const entry = {
            id: body.id || crypto.randomUUID(),
            text: body.text,
            createdAt: body.createdAt || Date.now(),
            updatedAt: Date.now(),
            attachments: body.attachments || []
        };
        await this.updateScratchlist(sessionId, [entry, ...entries]);
        return { entry };
    }

    async updateScratchlistEntry(
        sessionId: string,
        id: string,
        text: string
    ): Promise<{ entry: import('@hapi/protocol/schemas').ScratchlistEntry }> {
        const { entries } = await this.getScratchlist(sessionId);
        const entry = entries.find(e => e.id === id);
        if (!entry) throw new Error('Not found');
        entry.text = text;
        entry.updatedAt = Date.now();
        await this.updateScratchlist(sessionId, entries);
        return { entry };
    }

    async deleteScratchlistEntry(sessionId: string, id: string): Promise<void> {
        const { entries } = await this.getScratchlist(sessionId);
        await this.updateScratchlist(sessionId, entries.filter(e => e.id !== id));
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }

    async createEnrollment(ownerMembershipId?: string): Promise<{ enrollmentId: string; code: string; expiresAt: number }> {
        return await this.request('/api/runner-enrollments', {
            method: 'POST',
            body: JSON.stringify(ownerMembershipId ? { ownerMembershipId } : {})
        })
    }

    async listEnrollments(): Promise<{ enrollments: Array<{ id: string; ownerMembershipId: string; expiresAt: number; consumed: boolean; cancelled: boolean; status: string }> }> {
        return await this.request('/api/runner-enrollments')
    }

    async cancelEnrollment(enrollmentId: string): Promise<void> {
        await this.request(`/api/runner-enrollments/${encodeURIComponent(enrollmentId)}`, { method: 'DELETE' })
    }

    async listRunners(): Promise<{ runners: Array<{ id: string; organizationId: string; ownerMembershipId: string; machineId: string; profile: string; name: string; status: string; createdAt: number }> }> {
        return await this.request('/api/runners')
    }

    async revokeRunner(runnerId: string): Promise<{ runnerId: string; revoked: boolean }> {
        return await this.request(`/api/runners/${encodeURIComponent(runnerId)}/revoke`, { method: 'POST' })
    }

    async cleanupRunner(runnerId: string): Promise<{ runnerId: string; cleaned: boolean }> {
        return await this.request(`/api/runners/${encodeURIComponent(runnerId)}/cleanup`, { method: 'POST' })
    }

    async listMembers(): Promise<{ members: Array<{ membershipId: string; invitedEmail: string; role: string; status: string; identityId: string | null; identityIssuer: string | null; identitySubject: string | null; createdAt: number }> }> {
        return await this.request('/api/members')
    }

    async listInvitations(): Promise<{ invitations: Array<{ id: string; email: string; role: 'admin' | 'member' | 'viewer'; expiresAt: number; status: 'active' | 'claimed' | 'cancelled' | 'expired'; createdAt: number }> }> {
        return await this.request('/api/invitations')
    }

    async createInvitation(email: string, role: 'admin' | 'member' | 'viewer'): Promise<{ invitationId: string; token: string; expiresAt: number }> {
        return await this.request('/api/invitations', {
            method: 'POST',
            body: JSON.stringify({ email, role })
        })
    }

    async cancelInvitation(invitationId: string): Promise<void> {
        await this.request(`/api/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
    }

    async updateMemberRole(membershipId: string, role: string): Promise<void> {
        await this.request(`/api/members/${encodeURIComponent(membershipId)}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role })
        })
    }

    async updateMemberStatus(membershipId: string, status: string): Promise<void> {
        await this.request(`/api/members/${encodeURIComponent(membershipId)}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        })
    }

    async listTeams(): Promise<{ teams: Array<{ id: string; organizationId: string; name: string; archivedAt: number | null }> }> {
        return await this.request('/api/teams')
    }

    async createTeam(name: string, ownerMembershipId: string): Promise<{ team: { id: string; name: string } }> {
        return await this.request('/api/teams', {
            method: 'POST',
            body: JSON.stringify({ name, ownerMembershipId })
        })
    }

    async listTeamMembers(teamId: string): Promise<{ members: Array<{ membershipId: string; role: 'owner' | 'member' }> }> {
        return await this.request(`/api/teams/${encodeURIComponent(teamId)}/members`)
    }

    async addTeamMember(teamId: string, membershipId: string, role: 'owner' | 'member' = 'member'): Promise<void> {
        await this.request(`/api/teams/${encodeURIComponent(teamId)}/members`, { method: 'POST', body: JSON.stringify({ membershipId, role }) })
    }

    async removeTeamMember(teamId: string, membershipId: string): Promise<void> {
        await this.request(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' })
    }

    async transferTeamOwnership(teamId: string, sourceMembershipId: string, targetMembershipId: string): Promise<void> {
        await this.request(`/api/teams/${encodeURIComponent(teamId)}/ownership-transfer`, { method: 'POST', body: JSON.stringify({ sourceMembershipId, targetMembershipId }) })
    }

    async archiveTeam(teamId: string): Promise<void> {
        await this.request(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' })
    }

    async transferRunner(runnerId: string, targetMembershipId: string): Promise<void> {
        await this.request(`/api/runners/${encodeURIComponent(runnerId)}/transfer`, { method: 'POST', body: JSON.stringify({ targetMembershipId }) })
    }

    async createGrant(input: {
        principalType: 'user' | 'team'
        principalId: string
        resourceType: 'runner' | 'session'
        resourceId: string
        capability: 'view' | 'interact' | 'spawn' | 'operate' | 'manage'
        expiresAt: number | null
    }): Promise<{ id: string; capability: string }> {
        return await this.request('/api/grants', {
            method: 'POST',
            body: JSON.stringify(input)
        })
    }

    async revokeGrant(grantId: string): Promise<void> {
        await this.request(`/api/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE' })
    }

    async listGrants(): Promise<{ grants: Array<{ id: string; principalType: 'user' | 'team'; principalId: string; resourceType: 'runner' | 'session'; resourceId: string; capability: 'view' | 'interact' | 'spawn' | 'operate' | 'manage'; expiresAt: number | null; createdByMembershipId: string; createdAt: number }> }> {
        return await this.request('/api/grants')
    }

    async listAuditEvents(limit = 100): Promise<{ events: Array<{ id: string; actorType: 'user' | 'runner'; actorId: string; action: string; resourceType: string; resourceId: string; outcome: string; createdAt: number }> }> {
        return await this.request(`/api/audit-events?limit=${encodeURIComponent(String(limit))}`)
    }
}
