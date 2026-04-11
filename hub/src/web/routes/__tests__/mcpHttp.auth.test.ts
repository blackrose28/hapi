import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import type { Session, SyncEngine } from '../../../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from '../../middleware/auth'
import { createMcpHttpRoutes } from '../mcpHttp'

// ---- Helpers ----

const JWT_SECRET = new TextEncoder().encode('test-secret-key-for-mcp-auth-tests')

async function createToken(namespace: string): Promise<string> {
    return await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(JWT_SECRET)
}

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'claude' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'ns-alpha',
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
        effort: null,
    }
    return {
        ...base,
        ...overrides,
        metadata: overrides?.metadata === undefined
            ? base.metadata
            : overrides.metadata === null
                ? null
                : { ...baseMetadata, ...overrides.metadata },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function mcpRequest(method: string, params?: Record<string, unknown>, id: string | number = 1) {
    return {
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    }
}

function createAppWithAuth(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('/api/*', createAuthMiddleware(JWT_SECRET))
    app.route('/api', createMcpHttpRoutes(() => engine as SyncEngine))
    return app
}

async function authRequest(
    app: Hono<WebAppEnv>,
    token: string,
    method: string,
    params?: Record<string, unknown>,
    id: string | number = 1
) {
    return app.request('/api/mcp', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
}

describe('MCP HTTP auth', () => {
    it('rejects requests without authorization token', async () => {
        const app = createAppWithAuth({})
        const res = await app.request('/api/mcp', mcpRequest('initialize'))
        expect(res.status).toBe(401)
    })

    it('rejects requests with invalid token', async () => {
        const app = createAppWithAuth({})
        const res = await app.request('/api/mcp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer invalid-token'
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
        })
        expect(res.status).toBe(401)
    })

    it('allows requests with valid token', async () => {
        const app = createAppWithAuth({})
        const token = await createToken('default')
        const res = await authRequest(app, token, 'initialize')
        expect(res.status).toBe(200)
        const json = await res.json() as any
        expect(json.result.protocolVersion).toBe('2025-03-26')
    })

    it('scopes list_sessions to the token namespace', async () => {
        const sessionsAlpha = [createSession({ id: 's1', namespace: 'ns-alpha' })]
        const sessionsBeta = [createSession({ id: 's2', namespace: 'ns-beta' })]
        const nsSessions: Record<string, Session[]> = {
            'ns-alpha': sessionsAlpha,
            'ns-beta': sessionsBeta
        }

        const app = createAppWithAuth({
            getSessionsByNamespace: (ns: string) => nsSessions[ns] ?? []
        })

        const tokenAlpha = await createToken('ns-alpha')
        const resAlpha = await authRequest(app, tokenAlpha, 'tools/call', { name: 'list_sessions', arguments: {} })
        const jsonAlpha = await resAlpha.json() as any
        const alphaSessions = JSON.parse(jsonAlpha.result.content[0].text) as any[]
        expect(alphaSessions).toHaveLength(1)
        expect(alphaSessions[0].id).toBe('s1')

        const tokenBeta = await createToken('ns-beta')
        const resBeta = await authRequest(app, tokenBeta, 'tools/call', { name: 'list_sessions', arguments: {} }, 2)
        const jsonBeta = await resBeta.json() as any
        const betaSessions = JSON.parse(jsonBeta.result.content[0].text) as any[]
        expect(betaSessions).toHaveLength(1)
        expect(betaSessions[0].id).toBe('s2')
    })

    it('denies cross-namespace session access with -32002', async () => {
        const app = createAppWithAuth({
            resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' })
        })

        const tokenBeta = await createToken('ns-beta')
        const res = await authRequest(app, tokenBeta, 'tools/call', {
            name: 'change_title',
            arguments: { sessionId: 's1', title: 'Hacked' }
        }, 10)
        const json = await res.json() as any

        expect(json.error.code).toBe(-32002)
        expect(json.error.message).toContain('Session access denied')
        expect(json.id).toBe(10)
    })

    it('denies expired token', async () => {
        const app = createAppWithAuth({})
        const token = await new SignJWT({ uid: 1, ns: 'default' })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('0s')
            .sign(JWT_SECRET)

        await new Promise(resolve => setTimeout(resolve, 100))

        const res = await app.request('/api/mcp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
        })
        expect(res.status).toBe(401)
    })

    it('returns -32001 for session not found within authorized namespace', async () => {
        const app = createAppWithAuth({
            resolveSessionAccess: () => ({ ok: false, reason: 'not-found' })
        })

        const token = await createToken('ns-alpha')
        const res = await authRequest(app, token, 'tools/call', {
            name: 'get_session',
            arguments: { sessionId: 'nonexistent' }
        }, 20)
        const json = await res.json() as any

        expect(json.error.code).toBe(-32001)
        expect(json.error.message).toContain('Session not found')
        expect(json.id).toBe(20)
    })
})
