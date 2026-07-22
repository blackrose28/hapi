import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'codex' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: baseMetadata,
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default'
    }

    return {
        ...base,
        ...overrides,
        metadata: overrides?.metadata === undefined
            ? base.metadata
            : overrides.metadata === null
                ? null
                : {
                    ...baseMetadata,
                    ...overrides.metadata
                },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function createApp(session: Session, opts?: {
    resumeSession?: (sessionId: string, namespace: string, resumeOpts?: { permissionMode?: string }) => Promise<{ type: string; sessionId?: string; message?: string; code?: string }>
    getTerminalLiveCount?: (sessionId: string, namespace: string) => number | undefined
    getUserCapability?: () => 'view' | 'interact' | 'spawn' | 'operate' | 'manage' | null
    listAgentModelsForSession?: () => Promise<{
        status: 'dynamic' | 'fallback' | 'unsupported' | 'failed'
        models: Array<{ id: string; displayName: string }>
        source: string
        error?: string
    }>
}) {
    const applySessionConfigCalls: Array<[string, Record<string, unknown>]> = []
    const applySessionConfig = async (sessionId: string, config: Record<string, unknown>) => {
        applySessionConfigCalls.push([sessionId, config])
    }
    const listCodexModelsForSession = async () => ({
        success: true,
        models: [
            { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
        ]
    })
    const listOpencodeModelsForSession = async () => ({
        success: true,
        availableModels: [
            { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
            { modelId: 'mlx/qwen3:0.6b', name: 'MLX/Qwen3 0.6B' }
        ],
        currentModelId: 'ollama/exaone:4.5-33b-q8'
    })
    const listAgentModelsForSession = opts?.listAgentModelsForSession ?? (async () => ({
        status: 'dynamic' as const,
        models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
        source: 'gateway:example.test/v1'
    }))
    const cacheCodexModelsForSessionCalls: Array<[string, unknown]> = []
    const cacheOpencodeModelsForSessionCalls: Array<[string, unknown]> = []
    const cacheAgentModelsForSessionCalls: Array<[string, string, unknown]> = []
    const cacheCodexModelsForSession = (sessionId: string, result: unknown) => {
        cacheCodexModelsForSessionCalls.push([sessionId, result])
    }
    const cacheOpencodeModelsForSession = (sessionId: string, result: unknown) => {
        cacheOpencodeModelsForSessionCalls.push([sessionId, result])
    }
    const cacheAgentModelsForSession = (sessionId: string, agent: string, result: unknown) => {
        cacheAgentModelsForSessionCalls.push([sessionId, agent, result])
    }
    const resumeSession = opts?.resumeSession ?? (async (sessionId: string) => ({ type: 'success', sessionId }))
    const engine = {
        getSessionsByNamespace: (namespace: string) => session.namespace === namespace ? [session] : [],
        resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
        applySessionConfig,
        listCodexModelsForSession,
        listOpencodeModelsForSession,
        listAgentModelsForSession,
        cacheCodexModelsForSession,
        cacheOpencodeModelsForSession,
        cacheAgentModelsForSession,
        resumeSession
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', session.namespace)
        c.set('organizationId', session.namespace)
        c.set('membershipId', 'member-1')
        c.set('organizationRole', 'member')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine as SyncEngine, {
        capabilityResolver: () => opts?.getUserCapability ? opts.getUserCapability() : 'manage',
        getTerminalLiveCount: opts?.getTerminalLiveCount,
        getUserCapability: opts?.getUserCapability ?? (() => 'interact')
    }))

    return {
        app,
        applySessionConfigCalls,
        cacheCodexModelsForSessionCalls,
        cacheOpencodeModelsForSessionCalls,
        cacheAgentModelsForSessionCalls
    }
}

describe('sessions routes', () => {
    it('filters ungranted collections and rejects read-only bulk control', async () => {
        const session = createSession()
        const denied = createApp(session, { getUserCapability: () => null })
        const readOnly = createApp(session, { getUserCapability: () => 'view' })

        expect(await (await denied.app.request('/api/sessions')).json()).toEqual({ sessions: [] })
        expect((await readOnly.app.request('/api/sessions/archive-all', { method: 'POST' })).status).toBe(403)
    })

    it('returns and caches a generic model catalog for an active matching session', async () => {
        const session = createSession({
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        const { app, cacheAgentModelsForSessionCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/models?agent=claude')
        const expected = {
            status: 'dynamic',
            models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
            source: 'gateway:example.test/v1'
        }

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expected)
        expect(cacheAgentModelsForSessionCalls).toEqual([
            ['session-1', 'claude', expected]
        ])
    })

    it('returns the cached catalog for an inactive matching session', async () => {
        const session = createSession({
            active: false,
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                cachedAgentModels: {
                    agent: 'claude',
                    status: 'dynamic',
                    models: [{ id: 'claude-cached', displayName: 'Claude Cached' }],
                    source: 'gateway:cached.test/v1',
                    cachedAt: 123
                }
            }
        })
        const { app, cacheAgentModelsForSessionCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/models?agent=claude')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            status: 'dynamic',
            models: [{ id: 'claude-cached', displayName: 'Claude Cached' }],
            source: 'gateway:cached.test/v1'
        })
        expect(cacheAgentModelsForSessionCalls).toEqual([])
    })

    it('does not replace a good cache with a transient failed catalog', async () => {
        const session = createSession({
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        const { app, cacheAgentModelsForSessionCalls } = createApp(session, {
            listAgentModelsForSession: async () => ({
                status: 'failed',
                models: [{ id: 'sonnet', displayName: 'Sonnet' }],
                source: 'gateway:example.test/v1',
                error: 'Agent model discovery failed'
            })
        })

        const response = await app.request('/api/sessions/session-1/models?agent=claude')

        expect(response.status).toBe(200)
        expect((await response.json() as { status: string }).status).toBe('failed')
        expect(cacheAgentModelsForSessionCalls).toEqual([])
    })

    it('rejects flavor mismatch and inactive cache miss', async () => {
        const { app: mismatchApp } = createApp(createSession())
        const mismatch = await mismatchApp.request('/api/sessions/session-1/models?agent=claude')
        expect(mismatch.status).toBe(400)

        const inactive = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        const { app: inactiveApp } = createApp(inactive)
        const cacheMiss = await inactiveApp.request('/api/sessions/session-1/models?agent=claude')
        expect(cacheMiss.status).toBe(404)
        expect(await cacheMiss.json()).toEqual({ error: 'No cached agent models available for this session' })
    })

    it('includes known namespace-scoped live terminal count in session summaries', async () => {
        const session = createSession({ namespace: 'ns-a' })
        const { app } = createApp(session, {
            getTerminalLiveCount: (sessionId, namespace) => (
                sessionId === 'session-1' && namespace === 'ns-a' ? 2 : undefined
            )
        })

        const response = await app.request('/api/sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            sessions: [
                {
                    id: 'session-1',
                    terminalLiveCount: 2
                }
            ]
        })
    })

    it('returns the server-resolved effective capability and denies missing access', async () => {
        const allowed = createApp(createSession(), { getUserCapability: () => 'view' })
        const allowedResponse = await allowed.app.request('/api/sessions/session-1')
        expect(allowedResponse.status).toBe(200)
        expect(await allowedResponse.json()).toMatchObject({ userCapability: 'view' })

        const denied = createApp(createSession(), { getUserCapability: () => null })
        expect((await denied.app.request('/api/sessions/session-1')).status).toBe(403)
    })

    it('omits terminal count when live terminal count is unknown', async () => {
        const { app } = createApp(createSession(), {
            getTerminalLiveCount: () => undefined
        })

        const response = await app.request('/api/sessions')
        const body = await response.json() as { sessions: Array<{ terminalLiveCount?: number }> }

        expect(response.status).toBe(200)
        expect(body.sessions[0].terminalLiveCount).toBeUndefined()
    })

    it('includes known live terminal count in session detail responses', async () => {
        const session = createSession({ namespace: 'ns-a' })
        const { app } = createApp(session, {
            getTerminalLiveCount: (sessionId, namespace) => (
                sessionId === 'session-1' && namespace === 'ns-a' ? 2 : undefined
            )
        })

        const response = await app.request('/api/sessions/session-1')

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            session: {
                id: 'session-1',
                terminalLiveCount: 2
            }
        })
    })


    it('rejects collaboration mode changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects collaboration mode changes for non-Codex sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode is only supported for Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies collaboration mode changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { collaborationMode: 'plan' }]
        ])
    })

    it('applies collaboration mode changes for inactive remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession({ active: false }))

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { collaborationMode: 'plan' }]
        ])
    })

    it('rejects model reasoning effort changes for flavors without model reasoning support', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort is only supported for Codex and OpenCode sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model reasoning effort changes for remote OpenCode sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'opencode'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { modelReasoningEffort: 'high' }]
        ])
    })

    it('rejects model reasoning effort changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort can only be changed for remote Codex/OpenCode sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model reasoning effort changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'xhigh' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { modelReasoningEffort: 'xhigh' }]
        ])
    })

    it('applies model reasoning effort changes for inactive remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession({ active: false }))

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'xhigh' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { modelReasoningEffort: 'xhigh' }]
        ])
    })

    it('applies model changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.5' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gpt-5.5' }]
        ])
    })

    it('applies model changes for inactive remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession({ active: false }))

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.5' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gpt-5.5' }]
        ])
    })

    it('rejects model changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.5' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model selection can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model changes for OpenCode sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'opencode'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'ollama/exaone:4.5-33b-q8' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'ollama/exaone:4.5-33b-q8' }]
        ])
    })

    it('applies model changes for Gemini sessions (regression: opencode addition does not break Gemini)', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'gemini'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-2.5-pro' })
        })

        expect(response.status).toBe(200)
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gemini-2.5-pro' }]
        ])
    })

    it('rejects model changes for Cursor sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'cursor'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'sonnet' })
        })

        expect(response.status).toBe(400)
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects effort changes for non-Claude sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Effort selection is only supported for Claude sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies effort changes for Claude sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'max' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { effort: 'max' }]
        ])
    })

    it('returns Codex models for active Codex sessions and caches them', async () => {
        const { app, cacheCodexModelsForSessionCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/codex-models')

        const expected = {
            success: true,
            models: [
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        }
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expected)
        expect(cacheCodexModelsForSessionCalls).toEqual([
            ['session-1', expected]
        ])
    })

    it('returns cached Codex models for inactive Codex sessions', async () => {
        const session = createSession({
            active: false,
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex',
                cachedCodexModels: {
                    cachedAt: 123,
                    models: [
                        { id: 'provider-model', displayName: 'Provider Model', isDefault: false }
                    ]
                }
            }
        })
        const { app, cacheCodexModelsForSessionCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            models: [
                { id: 'provider-model', displayName: 'Provider Model', isDefault: false }
            ]
        })
        expect(cacheCodexModelsForSessionCalls).toEqual([])
    })

    it('returns a cache miss for inactive Codex sessions without cached models', async () => {
        const { app } = createApp(createSession({ active: false }))

        const response = await app.request('/api/sessions/session-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: false,
            error: 'No cached Codex models available for this session'
        })
    })

    it('returns OpenCode models for active OpenCode sessions and caches them', async () => {
        const session = createSession({
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }
        })
        const { app, cacheOpencodeModelsForSessionCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/opencode-models')

        const expected = {
            success: true,
            availableModels: [
                { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
                { modelId: 'mlx/qwen3:0.6b', name: 'MLX/Qwen3 0.6B' }
            ],
            currentModelId: 'ollama/exaone:4.5-33b-q8'
        }
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expected)
        expect(cacheOpencodeModelsForSessionCalls).toEqual([
            ['session-1', expected]
        ])
    })

    it('returns cached OpenCode models for inactive OpenCode sessions', async () => {
        const session = createSession({
            active: false,
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'opencode',
                cachedOpencodeModels: {
                    cachedAt: 123,
                    availableModels: [
                        { modelId: 'provider/opencode-model', name: 'Provider OpenCode Model' }
                    ],
                    currentModelId: 'provider/opencode-model',
                    availableEfforts: [
                        { effortId: 'high', name: 'High' }
                    ],
                    currentEffortId: 'high'
                }
            }
        })
        const { app, cacheOpencodeModelsForSessionCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/opencode-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'provider/opencode-model', name: 'Provider OpenCode Model' }
            ],
            currentModelId: 'provider/opencode-model',
            availableEfforts: [
                { effortId: 'high', name: 'High' }
            ],
            currentEffortId: 'high'
        })
        expect(cacheOpencodeModelsForSessionCalls).toEqual([])
    })

    it('returns a cache miss for inactive OpenCode sessions without cached models', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }
        })
        const { app } = createApp(session)

        const response = await app.request('/api/sessions/session-1/opencode-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: false,
            error: 'No cached OpenCode models available for this session'
        })
    })

    it('rejects opencode-models for non-OpenCode sessions', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/opencode-models')

        expect(response.status).toBe(400)
    })

    it('applies permission mode changes for inactive sessions', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/permission-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'bypassPermissions' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { permissionMode: 'bypassPermissions' }]
        ])
    })

    it('rejects unsupported permission mode for flavor via resume body', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'codex' }
        })
        const { app } = createApp(session)

        const response = await app.request('/api/sessions/session-1/resume', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ permissionMode: 'bypassPermissions' })
        })

        expect(response.status).toBe(400)
    })

    it('passes permissionMode from resume body to resumeSession', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        let capturedResumeOpts: { permissionMode?: string } | undefined
        const { app } = createApp(session, {
            resumeSession: async (sessionId, _namespace, resumeOpts) => {
                capturedResumeOpts = resumeOpts
                return { type: 'success', sessionId }
            }
        })

        const response = await app.request('/api/sessions/session-1/resume', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ permissionMode: 'bypassPermissions' })
        })

        expect(response.status).toBe(200)
        expect(capturedResumeOpts).toEqual({ permissionMode: 'bypassPermissions' })
    })
})
