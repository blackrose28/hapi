import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import type { SyncEngine } from '../sync/syncEngine'
import type { IdentityService } from '../auth/identityService'
import { createSharedAuthMiddleware } from './middleware/sharedAuth'
import { createSharedAuthRoutes, type SharedAuthRouteOptions } from './routes/sharedAuth'
import { createSharedTeamsRoutes } from './routes/sharedTeams'
import { createSharedMembersRoutes } from './routes/sharedMembers'
import type { TeamAuthorizationService } from '../application/teamAuthorizationService'
import type { SharedWebAppEnv } from './sharedAuthEnv'
import type { RunnerEnrollmentService } from '../application/runnerEnrollmentService'
import type { RunnerLifecycleService } from '../application/runnerLifecycleService'
import { createRunnerEnrollmentRoutes, createRunnerExchangeRoutes } from './routes/runnerEnrollments'
import type { RunnerAuthenticator } from '../auth/runnerAuthenticator'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createMessagesRoutes } from './routes/messages'
import { createPermissionsRoutes } from './routes/permissions'
import { createMachinesRoutes } from './routes/machines'
import { createTeamChatsRoutes } from './routes/teamChats'
import { createTerminalSnippetsRoutes } from './routes/terminalSnippets'
import { createGitRoutes } from './routes/git'
import { createCliRoutes } from './routes/cli'
import { createEditorRoutes } from './routes/editor'
import { createPushRoutes } from './routes/push'
import { createVoiceRoutes } from './routes/voice'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import type { Store } from '../store'
import type { RestCapabilityResolver } from './routes/guards'
import { createResourceCapabilityResolver } from '../auth/resourceCapability'
import { canAccessTeamChat } from '../auth/teamChatAuthorization'

const SENSITIVE_RATE_WINDOW_MS = 60_000
const SENSITIVE_RATE_LIMIT = 30

export function createRestCapabilityResolver(teamAuthorization: TeamAuthorizationService): RestCapabilityResolver {
    return createResourceCapabilityResolver(teamAuthorization)
}

function requestClientKey(request: Request): string {
    return request.headers.get('cf-connecting-ip')
        ?? request.headers.get('x-real-ip')
        ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? 'unknown'
}

function findWebappDistDir(): { distDir: string; indexHtmlPath: string } {
    const candidates = [
        join(process.cwd(), '..', 'web', 'dist'),
        join(import.meta.dir, '..', '..', '..', 'web', 'dist'),
        join(process.cwd(), 'web', 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { distDir, indexHtmlPath: join(distDir, 'index.html') }
}

function serveEmbeddedAsset(asset: EmbeddedWebAsset): Response {
    return new Response(Bun.file(asset.sourcePath), {
        headers: {
            'Content-Type': asset.mimeType
        }
    })
}

export function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    getTerminalLiveCount?: (sessionId: string, namespace: string) => number | undefined
    store: Store
    sharedAuth: {
        routes: SharedAuthRouteOptions
        identity: Pick<IdentityService, 'validateSession'>
    }
    teamAuthorization: TeamAuthorizationService
    runnerEnrollment?: RunnerEnrollmentService
    runnerLifecycle?: RunnerLifecycleService
    runnerAuthenticator: RunnerAuthenticator
    authorizeRunnerSession: (organizationId: string, runnerId: string, sessionId: string) => boolean
    onMemberDisabled?: (organizationId: string, membershipId: string) => void
    vapidPublicKey: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    relayMode?: boolean
    officialWebUrl?: string
}): Hono<SharedWebAppEnv> {
    const app = new Hono<SharedWebAppEnv>()

    app.use('*', async (c, next) => {
        await next()
        c.header('X-Content-Type-Options', 'nosniff')
        c.header('X-Frame-Options', 'DENY')
        c.header('Referrer-Policy', 'no-referrer')
        c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        c.header('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'")
        c.header('Cross-Origin-Resource-Policy', 'same-site')
    })

    app.use('*', logger())

    // Health check endpoint (no auth required)
    app.get('/health', (c) => c.json({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    if (corsOrigins.includes('*')) {
        throw new Error('Shared Hub requires an explicit CORS origin allowlist.')
    }
    const corsOriginOption = corsOrigins
    const corsMiddleware = cors({
        origin: corsOriginOption,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['content-type', 'x-csrf-token'],
        credentials: true
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.use('/api/*', async (c, next) => {
        const origin = c.req.header('origin')
        if (origin && !corsOrigins.includes(origin)) {
            return c.json({ error: 'origin_not_allowed', code: 'origin_not_allowed' }, 403)
        }
        return await next()
    })

    const sensitiveRequests = new Map<string, { count: number; resetAt: number }>()
    app.use('/api/*', async (c, next) => {
        const sensitive = c.req.path === '/api/auth/login'
            || c.req.path === '/api/auth/invitation'
            || c.req.path === '/api/auth/callback'
            || c.req.path === '/api/runner-enrollments/exchange'
        if (!sensitive) return await next()
        const now = Date.now()
        const key = `${requestClientKey(c.req.raw)}:${c.req.path}`
        if (!sensitiveRequests.has(key) && sensitiveRequests.size >= 10_000) {
            for (const [candidate, value] of sensitiveRequests) {
                if (value.resetAt <= now) sensitiveRequests.delete(candidate)
            }
            if (sensitiveRequests.size >= 10_000) {
                return c.json({ error: 'rate_limited', code: 'rate_limited' }, 429)
            }
        }
        const existing = sensitiveRequests.get(key)
        const entry = !existing || existing.resetAt <= now
            ? { count: 1, resetAt: now + SENSITIVE_RATE_WINDOW_MS }
            : { count: existing.count + 1, resetAt: existing.resetAt }
        sensitiveRequests.set(key, entry)
        c.header('RateLimit-Limit', String(SENSITIVE_RATE_LIMIT))
        c.header('RateLimit-Remaining', String(Math.max(0, SENSITIVE_RATE_LIMIT - entry.count)))
        c.header('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
        if (entry.count > SENSITIVE_RATE_LIMIT) {
            c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
            return c.json({ error: 'rate_limited', code: 'rate_limited' }, 429)
        }
        return await next()
    })

    app.route('/cli', createCliRoutes(options.getSyncEngine, options.runnerAuthenticator, options.authorizeRunnerSession))

    app.route('/api', createSharedAuthRoutes(options.sharedAuth.routes))
    if (options.runnerEnrollment) app.route('/api', createRunnerExchangeRoutes(options.runnerEnrollment))

    app.use('/api/*', createSharedAuthMiddleware(options.sharedAuth.identity))
    if (options.runnerEnrollment && options.runnerLifecycle) app.route('/api', createRunnerEnrollmentRoutes(options.runnerEnrollment, options.runnerLifecycle))
    app.route('/api', createSharedTeamsRoutes(options.teamAuthorization))
    app.route('/api', createSharedMembersRoutes(options.sharedAuth.routes.identity, options.onMemberDisabled))
    const resolveRestCapability = createRestCapabilityResolver(options.teamAuthorization)
    app.route('/api', createEventsRoutes(
        options.getSseManager,
        options.getSyncEngine,
        options.getVisibilityTracker,
        resolveRestCapability,
        ({ organizationId, membershipId, teamChatId }) => {
            const engine = options.getSyncEngine()
            const actor = options.teamAuthorization.resolveLiveSubject(organizationId, membershipId)
            return Boolean(engine && actor && canAccessTeamChat(engine, actor, teamChatId, 'view'))
        }
    ))
    app.route('/api', createSessionsRoutes(options.getSyncEngine, {
        getTerminalLiveCount: options.getTerminalLiveCount,
        capabilityResolver: resolveRestCapability,
        getUserCapability: ({ organizationId, membershipId, role, sessionId }) =>
            options.teamAuthorization.resolveEffectiveCapability({
                organizationId,
                membershipId,
                role,
                disabled: false
            }, 'session', sessionId)
    }))
    app.route('/api', createMessagesRoutes(options.getSyncEngine, resolveRestCapability))
    app.route('/api', createTeamChatsRoutes(options.getSyncEngine, options.teamAuthorization, resolveRestCapability))
    app.route('/api', createTerminalSnippetsRoutes(options.store, options.getSseManager))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine, resolveRestCapability))
    app.route('/api', createMachinesRoutes(options.getSyncEngine, resolveRestCapability))
    app.route('/api', createEditorRoutes(options.getSyncEngine, resolveRestCapability))
    app.route('/api', createGitRoutes(options.getSyncEngine, resolveRestCapability))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))
    app.route('/api', createVoiceRoutes())

    // Skip static serving in relay mode, show helpful message on root
    if (options.relayMode) {
        const officialUrl = options.officialWebUrl || 'https://app.hapi.run'
        app.get('/', (c) => {
            return c.html(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HAPI Hub</title></head>
<body style="font-family: system-ui; padding: 2rem; max-width: 600px;">
<h1>HAPI Hub</h1>
<p>This hub is running in relay mode. Please use the official web app:</p>
<p><a href="${officialUrl}">${officialUrl}</a></p>
<details>
<summary>Why am I seeing this?</summary>
<p style="margin-top: 0.5rem; color: #666;">
When relay mode is enabled, all traffic flows through our relay infrastructure with end-to-end encryption.
To reduce bandwidth and improve performance, the frontend is served separately
from GitHub Pages instead of through the relay tunnel.
</p>
</details>
</body>
</html>`)
        })
        return app
    }

    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const indexHtmlAsset = embeddedAssetMap.get('/index.html')

        if (!indexHtmlAsset) {
            app.get('*', (c) => {
                return c.text(
                    'Embedded Mini App is missing index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            })
            return app
        }

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(asset)
            }

            return await next()
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            return serveEmbeddedAsset(indexHtmlAsset)
        })

        return app
    }

    const { distDir, indexHtmlPath } = findWebappDistDir()

    if (!existsSync(indexHtmlPath)) {
        app.get('/', (c) => {
            return c.text(
                'Mini App is not built.\n\nRun:\n  cd web\n  bun install\n  bun run build\n',
                503
            )
        })
        return app
    }

    app.use('/assets/*', serveStatic({ root: distDir }))

    app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return await serveStatic({ root: distDir })(c, next)
    })

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return await serveStatic({ root: distDir, path: 'index.html' })(c, next)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    getTerminalLiveCount?: (sessionId: string, namespace: string) => number | undefined
    store: Store
    sharedAuth: {
        routes: SharedAuthRouteOptions
        identity: Pick<IdentityService, 'validateSession'>
    }
    teamAuthorization: TeamAuthorizationService
    runnerEnrollment?: RunnerEnrollmentService
    runnerLifecycle?: RunnerLifecycleService
    runnerAuthenticator: RunnerAuthenticator
    authorizeRunnerSession: (organizationId: string, runnerId: string, sessionId: string) => boolean
    onMemberDisabled?: (organizationId: string, membershipId: string) => void
    vapidPublicKey: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
    relayMode?: boolean
    officialWebUrl?: string
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        getTerminalLiveCount: options.getTerminalLiveCount,
        store: options.store,
        sharedAuth: options.sharedAuth,
        teamAuthorization: options.teamAuthorization,
        runnerEnrollment: options.runnerEnrollment,
        runnerLifecycle: options.runnerLifecycle,
        runnerAuthenticator: options.runnerAuthenticator,
        authorizeRunnerSession: options.authorizeRunnerSession,
        onMemberDisabled: options.onMemberDisabled,
        vapidPublicKey: options.vapidPublicKey,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap,
        relayMode: options.relayMode,
        officialWebUrl: options.officialWebUrl
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        maxRequestBodySize: Math.max(socketHandler.maxRequestBodySize, 68 * 1024 * 1024),
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    console.log(`[Web] hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    console.log(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
