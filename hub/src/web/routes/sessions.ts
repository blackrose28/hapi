import { getPermissionModesForFlavor, isPermissionModeAllowedForFlavor, supportsEffort, supportsModelChange, toSessionSummary } from '@hapi/protocol'
import { CodexCollaborationModeSchema, PermissionModeSchema } from '@hapi/protocol/schemas'
import { Hono } from 'hono'
import { isKnownFlavor } from '@hapi/protocol'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import type { Capability, OrganizationRole } from '@hapi/protocol/auth'
import { requireCapability, requireSessionFromParam, requireSyncEngine, type RestCapabilityResolver } from './guards'

const permissionModeSchema = z.object({
    mode: PermissionModeSchema
})

const resumeBodySchema = z.object({
    permissionMode: PermissionModeSchema.optional()
})

const collaborationModeSchema = z.object({
    mode: CodexCollaborationModeSchema
})

const modelSchema = z.object({
    // Pi requires { provider, modelId } to uniquely identify a model (two
    // providers can share a modelId); every other flavor still sends a
    // plain string.
    model: z.union([
        z.string().trim().min(1),
        z.object({
            provider: z.string().trim().min(1),
            modelId: z.string().trim().min(1)
        })
    ]).nullable()
})

const modelReasoningEffortSchema = z.object({
    modelReasoningEffort: z.string().trim().min(1).nullable()
})

const effortSchema = z.object({
    effort: z.string().trim().min(1).nullable()
})

const renameSessionSchema = z.object({
    name: z.string().min(1).max(255)
})

const uploadSchema = z.object({
    filename: z.string().min(1).max(255),
    content: z.string().min(1),
    mimeType: z.string().min(1).max(255)
})

const uploadDeleteSchema = z.object({
    path: z.string().min(1)
})

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function estimateBase64Bytes(base64: string): number {
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

export type SessionsRoutesOptions = {
    capabilityResolver: RestCapabilityResolver
    getTerminalLiveCount?: (sessionId: string, organizationId: string) => number | undefined
    getUserCapability?: (input: {
        organizationId: string
        membershipId: string
        role: OrganizationRole
        sessionId: string
    }) => Capability | null
}

function withKnownTerminalCount<T extends { terminalLiveCount?: number }>(
    summary: T,
    terminalLiveCount: number | undefined
): T {
    if (terminalLiveCount === undefined || !Number.isInteger(terminalLiveCount) || terminalLiveCount < 0) {
        return summary
    }
    return {
        ...summary,
        terminalLiveCount
    }
}

export function createSessionsRoutes(
    getSyncEngine: () => SyncEngine | null,
    options: SessionsRoutesOptions
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const getPendingCount = (s: Session) => s.agentState?.requests ? Object.keys(s.agentState.requests).length : 0

        const organizationId = c.get('organizationId')
        const sessions = engine.getSessionsByNamespace(organizationId)
            .filter((session) => !(requireCapability(
                c, options.capabilityResolver, 'session', session.id, 'view'
            ) instanceof Response))
            .sort((a, b) => {
                // Active sessions first
                if (a.active !== b.active) {
                    return a.active ? -1 : 1
                }
                // Within active sessions, sort by pending requests count
                const aPending = getPendingCount(a)
                const bPending = getPendingCount(b)
                if (a.active && aPending !== bPending) {
                    return bPending - aPending
                }
                // Then by updatedAt
                return b.updatedAt - a.updatedAt
            })
            .map((session) => withKnownTerminalCount(
                toSessionSummary(session),
                options.getTerminalLiveCount?.(session.id, organizationId)
            ))

        return c.json({ sessions })
    })

    app.post('/sessions/archive-all', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const organizationId = c.get('organizationId')
        const sessions = engine.getSessionsByNamespace(organizationId)
        const activeSessions = sessions.filter((s) => s.active && !(requireCapability(
            c, options.capabilityResolver, 'session', s.id, 'view'
        ) instanceof Response))
        if (activeSessions.some((session) => requireCapability(
            c, options.capabilityResolver, 'session', session.id, 'operate'
        ) instanceof Response)) {
            return c.json({ error: 'Resource access denied', code: 'forbidden' }, 403)
        }

        let archived = 0
        for (const s of activeSessions) {
            try {
                await engine.archiveSession(s.id)
                archived++
            } catch {
                // Skip sessions that fail to archive (e.g. already archived)
            }
        }

        return c.json({ ok: true, archived })
    })

    app.delete('/sessions/archived', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const organizationId = c.get('organizationId')
        const sessions = engine.getSessionsByNamespace(organizationId)
        const inactiveSessions = sessions.filter((s) => !s.active && !(requireCapability(
            c, options.capabilityResolver, 'session', s.id, 'view'
        ) instanceof Response))
        if (inactiveSessions.some((session) => requireCapability(
            c, options.capabilityResolver, 'session', session.id, 'operate'
        ) instanceof Response)) {
            return c.json({ error: 'Resource access denied', code: 'forbidden' }, 403)
        }

        let deleted = 0
        for (const s of inactiveSessions) {
            try {
                await engine.deleteSession(s.id)
                deleted++
            } catch {
                // Skip sessions that fail to delete
            }
        }

        return c.json({ ok: true, deleted })
    })

    app.get('/sessions/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const organizationId = c.get('organizationId')
        const userCapability = options.getUserCapability?.({
            organizationId,
            membershipId: c.get('membershipId'),
            role: c.get('organizationRole'),
            sessionId: sessionResult.session.id
        }) ?? null
        if (!userCapability) {
            return c.json({ error: 'Session access denied' }, 403)
        }
        return c.json({
            session: withKnownTerminalCount(
                sessionResult.session,
                options.getTerminalLiveCount?.(sessionResult.session.id, organizationId)
            ),
            userCapability
        })
    })

    app.post('/sessions/:id/resume', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'spawn'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = body ? resumeBodySchema.safeParse(body) : { success: true as const, data: {} }
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const { permissionMode } = parsed.data
        if (permissionMode !== undefined) {
            const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
            if (!isPermissionModeAllowedForFlavor(permissionMode, flavor)) {
                return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
            }
        }

        const organizationId = c.get('organizationId')
        const result = await engine.resumeSession(
            sessionResult.sessionId,
            organizationId,
            permissionMode !== undefined ? { permissionMode } : undefined
        )
        if (result.type === 'error') {
            const status = result.code === 'no_machine_online' ? 503
                : result.code === 'access_denied' ? 403
                    : result.code === 'session_not_found' ? 404
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.post('/sessions/:id/upload', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const estimatedBytes = estimateBase64Bytes(parsed.data.content)
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
            return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
        }

        try {
            const result = await engine.uploadFile(
                sessionResult.sessionId,
                parsed.data.filename,
                parsed.data.content,
                parsed.data.mimeType
            )
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    app.post('/sessions/:id/upload/delete', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadDeleteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.deleteUploadFile(sessionResult.sessionId, parsed.data.path)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete upload'
            }, 500)
        }
    })

    app.post('/sessions/:id/abort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.abortSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/archive', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.archiveSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/switch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.switchSession(sessionResult.sessionId, 'remote')
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/permission-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = permissionModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        const mode = parsed.data.mode

        const allowedModes = getPermissionModesForFlavor(flavor)
        if (allowedModes.length === 0) {
            return c.json({ error: 'Permission mode not supported for session flavor' }, 400)
        }

        if (!isPermissionModeAllowedForFlavor(mode, flavor)) {
            return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { permissionMode: mode })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply permission mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/collaboration-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex') {
            return c.json({ error: 'Collaboration mode is only supported for Codex sessions' }, 400)
        }
        if (sessionResult.session.agentState?.controlledByUser === true) {
            return c.json({ error: 'Collaboration mode can only be changed for remote Codex sessions' }, 409)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = collaborationModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { collaborationMode: parsed.data.mode })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply collaboration mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/model', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = modelSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (!supportsModelChange(flavor)) {
            return c.json({ error: 'Model selection is not supported for this session' }, 400)
        }
        if (flavor === 'codex' && sessionResult.session.agentState?.controlledByUser === true) {
            return c.json({ error: 'Model selection can only be changed for remote Codex sessions' }, 409)
        }
        if (flavor === 'grok' && sessionResult.session.agentState?.controlledByUser === true) {
            return c.json({ error: 'Model selection can only be changed for remote Grok sessions' }, 409)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { model: parsed.data.model })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply model'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/model-reasoning-effort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex' && flavor !== 'opencode') {
            return c.json({ error: 'Model reasoning effort is only supported for Codex and OpenCode sessions' }, 400)
        }
        if (sessionResult.session.agentState?.controlledByUser === true) {
            return c.json({ error: 'Model reasoning effort can only be changed for remote Codex/OpenCode sessions' }, 409)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = modelReasoningEffortSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, {
                modelReasoningEffort: parsed.data.modelReasoningEffort
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply model reasoning effort'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/effort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            requireActive: true, capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = effortSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (!supportsEffort(flavor)) {
            return c.json({ error: 'Effort selection is not supported for this session type' }, 400)
        }
        if (flavor === 'grok' && sessionResult.session.agentState?.controlledByUser === true) {
            return c.json({ error: 'Effort can only be changed for remote Grok sessions' }, 409)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { effort: parsed.data.effort })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply effort'
            return c.json({ error: message }, 409)
        }
    })

    app.patch('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = renameSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: name is required' }, 400)
        }

        try {
            await engine.renameSession(sessionResult.sessionId, parsed.data.name)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to rename session'
            // Map concurrency/version errors to 409 conflict
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.delete('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.active) {
            return c.json({ error: 'Cannot delete active session. Archive it first.' }, 409)
        }

        try {
            await engine.deleteSession(sessionResult.sessionId)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete session'
            // Map "active session" error to 409 conflict (race condition: session became active)
            if (message.includes('active')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    
    app.get('/sessions/:id/scratchlist', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) return sessionResult

        const entries = engine.listScratchlistEntrys(sessionResult.sessionId)
        return c.json({ entries })
    })

    app.put('/sessions/:id/scratchlist', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) return sessionResult

        const body = await c.req.json().catch(() => null)
        if (!body || !Array.isArray(body.entries)) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        
        // Minimal validation, assumes frontend sends correct shape
        engine.replaceScratchlistEntrys(sessionResult.sessionId, body.entries)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/scratchlist/attachments', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'operate'
        })
        if (sessionResult instanceof Response) return sessionResult

        const body = await c.req.json().catch(() => null)
        if (!body || !body.filename || !body.content) {
            return c.json({ error: 'Missing filename or content' }, 400)
        }
        
        const attachmentId = crypto.randomUUID()
        const attachment = {
            id: attachmentId,
            filename: body.filename,
            mimeType: body.mimeType || 'application/octet-stream',
            size: body.content.length, // approximation
            path: `hapi-hub:scratchlist/${attachmentId}`
        }
        
        return c.json({ success: true, attachment })
    })

    app.get('/sessions/:id/slash-commands', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // Get agent type from session metadata, default to 'claude'
        const agent = sessionResult.session.metadata?.flavor ?? 'claude'

        try {
            const result = await engine.listSlashCommands(sessionResult.sessionId, agent)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list slash commands'
            })
        }
    })

    app.get('/sessions/:id/skills', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = await engine.listSkills(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list skills'
            })
        }
    })

    app.get('/sessions/:id/codex-models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex') {
            return c.json({
                success: false,
                error: 'Codex models are only available for Codex sessions'
            }, 400)
        }

        if (!sessionResult.session.active) {
            const cached = sessionResult.session.metadata?.cachedCodexModels
            if (!cached) {
                return c.json({ success: false, error: 'No cached Codex models available for this session' })
            }
            return c.json({ success: true, models: cached.models })
        }

        try {
            const result = await engine.listCodexModelsForSession(sessionResult.sessionId)
            engine.cacheCodexModelsForSession?.(sessionResult.sessionId, result)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Codex models'
            }, 500)
        }
    })

    app.get('/sessions/:id/models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const agent = c.req.query('agent')
        if (!isKnownFlavor(agent)) {
            return c.json({ error: 'Invalid agent' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== agent) {
            return c.json({ error: 'Agent models are only available for matching sessions' }, 400)
        }

        if (!sessionResult.session.active) {
            const cached = sessionResult.session.metadata?.cachedAgentModels
            if (!cached || cached.agent !== agent) {
                return c.json({ error: 'No cached agent models available for this session' }, 404)
            }
            return c.json({
                status: cached.status,
                models: cached.models,
                source: cached.source
            })
        }

        try {
            const result = await engine.listAgentModelsForSession(sessionResult.sessionId, agent)
            if (result.status === 'dynamic' || result.status === 'fallback') {
                engine.cacheAgentModelsForSession(sessionResult.sessionId, agent, result)
            }
            return c.json(result)
        } catch {
            return c.json({ error: 'Failed to list agent models' }, 500)
        }
    })

    app.get('/sessions/:id/opencode-models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'opencode') {
            return c.json({
                success: false,
                error: 'OpenCode models are only available for OpenCode sessions'
            }, 400)
        }

        if (!sessionResult.session.active) {
            const cached = sessionResult.session.metadata?.cachedOpencodeModels
            if (!cached) {
                return c.json({ success: false, error: 'No cached OpenCode models available for this session' })
            }
            return c.json({
                success: true,
                availableModels: cached.availableModels,
                currentModelId: cached.currentModelId ?? null,
                availableEfforts: cached.availableEfforts ?? [],
                currentEffortId: cached.currentEffortId ?? null
            })
        }

        try {
            const result = await engine.listOpencodeModelsForSession(sessionResult.sessionId)
            engine.cacheOpencodeModelsForSession?.(sessionResult.sessionId, result)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list OpenCode models'
            }, 500)
        }
    })

    app.get('/sessions/:id/pi-models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'pi') {
            return c.json({
                success: false,
                error: 'Pi models are only available for Pi sessions'
            }, 400)
        }

        if (!sessionResult.session.active) {
            const cached = sessionResult.session.metadata?.piAvailableModels
            if (!cached) {
                return c.json({ success: false, error: 'No cached Pi models available for this session' })
            }
            return c.json({
                success: true,
                availableModels: cached,
                currentModelId: sessionResult.session.model ?? null
            })
        }

        try {
            const result = await engine.listPiModelsForSession(sessionResult.sessionId)
            engine.cachePiModelsForSession(sessionResult.sessionId, result)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Pi models'
            }, 500)
        }
    })

    app.get('/sessions/:id/grok-models', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'grok') {
            return c.json({
                success: false,
                error: 'Grok models are only available for Grok sessions'
            }, 400)
        }

        if (!sessionResult.session.active) {
            const cached = sessionResult.session.metadata?.cachedGrokModels
            if (!cached) {
                return c.json({ success: false, error: 'No cached Grok models available for this session' })
            }
            return c.json({
                success: true,
                availableModels: cached.availableModels,
                currentModelId: cached.currentModelId ?? null,
                autoPermissionModeSupported: cached.autoPermissionModeSupported
            })
        }

        try {
            const result = await engine.listGrokModelsForSession(sessionResult.sessionId)
            engine.cacheGrokModelsForSession(sessionResult.sessionId, result)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Grok models'
            }, 500)
        }
    })

    app.get('/sessions/:id/grok-reasoning-effort-options', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, {
            capabilityResolver: options.capabilityResolver, requiredCapability: 'view'
        })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'grok') {
            return c.json({
                success: false,
                error: 'Grok effort options are only available for Grok sessions'
            }, 400)
        }

        try {
            const result = await engine.listGrokReasoningEffortOptionsForSession(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Grok effort options'
            }, 500)
        }
    })

    return app
}
