import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../../sync/syncEngine'
import type { WebAppEnv } from '../../middleware/auth'
import { createMcpHttpRoutes } from '../mcpHttp'

// ---- Helpers ----

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'claude' as const
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

function createApp(
    namespace: string,
    engine: Partial<SyncEngine>,
) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        c.set('userId', 1)
        await next()
    })
    app.route('/api', createMcpHttpRoutes(() => engine as SyncEngine))
    return app
}

describe('MCP HTTP endpoint', () => {
    describe('initialize', () => {
        it('returns server info and capabilities', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('initialize'))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.jsonrpc).toBe('2.0')
            expect(json.id).toBe(1)
            expect(json.result.protocolVersion).toBe('2025-03-26')
            expect(json.result.serverInfo.name).toBe('HAPI Hub MCP')
            expect(json.result.capabilities.tools).toBeDefined()
        })
    })

    describe('tools/list', () => {
        it('returns all hub tools', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/list'))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            const toolNames = json.result.tools.map((t: any) => t.name)
            expect(toolNames).toContain('change_title')
            expect(toolNames).toContain('list_sessions')
            expect(toolNames).toContain('get_session')
        })

        it('tools have inputSchema with required sessionId where needed', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/list'))
            const json = await res.json() as any

            const changeTitle = json.result.tools.find((t: any) => t.name === 'change_title')
            expect(changeTitle.inputSchema.required).toContain('sessionId')
            expect(changeTitle.inputSchema.required).toContain('title')

            const getSession = json.result.tools.find((t: any) => t.name === 'get_session')
            expect(getSession.inputSchema.required).toContain('sessionId')
        })
    })

    describe('tools/call - change_title', () => {
        it('changes title with explicit sessionId', async () => {
            const session = createSession()
            const renameCalls: Array<[string, string]> = []
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                renameSession: async (id: string, name: string) => { renameCalls.push([id, name]) }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { sessionId: 'session-1', title: 'New Title' }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.content[0].text).toContain('New Title')
            expect(json.result.isError).toBeFalsy()
            expect(renameCalls).toEqual([['session-1', 'New Title']])
        })

        it('returns -32602 when sessionId is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { title: 'New Title' }
            }, 42))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
            expect(json.id).toBe(42)
        })

        it('returns -32001 when session not found', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'not-found' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { sessionId: 'nonexistent', title: 'Title' }
            }, 99))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32001)
            expect(json.error.message).toContain('Session not found')
            expect(json.id).toBe(99)
        })

        it('returns -32002 when session belongs to different namespace', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { sessionId: 'session-1', title: 'Title' }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32002)
            expect(json.error.message).toContain('Session access denied')
        })
    })

    describe('tools/call - list_sessions', () => {
        it('returns sessions in the caller namespace', async () => {
            const sessions = [
                createSession({ id: 's1', namespace: 'default', active: true, updatedAt: 2 }),
                createSession({ id: 's2', namespace: 'default', active: false, updatedAt: 1 }),
            ]
            const app = createApp('default', {
                getSessionsByNamespace: () => sessions
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'list_sessions',
                arguments: {}
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            const parsed = JSON.parse(json.result.content[0].text) as any[]
            expect(parsed).toHaveLength(2)
            expect(parsed[0].id).toBe('s1')
            expect(parsed[1].id).toBe('s2')
        })

        it('returns empty list when no sessions', async () => {
            const app = createApp('default', {
                getSessionsByNamespace: () => []
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'list_sessions',
                arguments: {}
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            const parsed = JSON.parse(json.result.content[0].text) as any[]
            expect(parsed).toHaveLength(0)
        })
    })

    describe('tools/call - get_session', () => {
        it('returns session details with explicit sessionId', async () => {
            const session = createSession({ id: 'session-1' })
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_session',
                arguments: { sessionId: 'session-1' }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            const parsed = JSON.parse(json.result.content[0].text) as any
            expect(parsed.id).toBe('session-1')
        })

        it('returns -32602 when sessionId is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_session',
                arguments: {}
            }, 55))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('sessionId is required')
            expect(json.id).toBe(55)
        })
    })

    describe('protocol validation', () => {
        it('rejects invalid content-type', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', {
                method: 'POST',
                headers: { 'content-type': 'text/xml' },
                body: '{}'
            })
            expect(res.status).toBe(400)
            const json = await res.json() as any
            expect(json.error.code).toBe(-32600)
            expect(json.id).toBeNull()
        })

        it('rejects malformed JSON', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: 'not-json'
            })
            expect(res.status).toBe(400)
            const json = await res.json() as any
            expect(json.error.code).toBe(-32700)
            expect(json.id).toBeNull()
        })

        it('rejects non-2.0 jsonrpc', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '1.0', method: 'initialize', id: 1 })
            })
            expect(res.status).toBe(400)
            const json = await res.json() as any
            expect(json.error.code).toBe(-32600)
        })

        it('rejects unknown method', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('foo/bar'))
            expect(res.status).toBe(200)
            const json = await res.json() as any
            expect(json.error.code).toBe(-32601)
            expect(json.id).toBe(1)
        })

        it('returns -32602 for unknown tool', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'nonexistent_tool',
                arguments: {}
            }, 77))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('unknown tool')
            expect(json.id).toBe(77)
        })
    })

    describe('multi-session', () => {
        it('operates on different sessions in same request', async () => {
            const session1 = createSession({ id: 's1', namespace: 'default' })
            const session2 = createSession({ id: 's2', namespace: 'default' })
            const renameCalls: Array<[string, string]> = []
            const accessMap: Record<string, Session> = { 's1': session1, 's2': session2 }

            const app = createApp('default', {
                resolveSessionAccess: (_id: string) => {
                    const s = accessMap[_id]
                    if (!s) return { ok: false, reason: 'not-found' }
                    return { ok: true, sessionId: s.id, session: s }
                },
                renameSession: async (id: string, name: string) => { renameCalls.push([id, name]) }
            })

            const res1 = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { sessionId: 's1', title: 'Title 1' }
            }))
            const res2 = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { sessionId: 's2', title: 'Title 2' }
            }))

            expect(res1.status).toBe(200)
            expect(res2.status).toBe(200)
            expect(renameCalls).toEqual([['s1', 'Title 1'], ['s2', 'Title 2']])
        })
    })

    describe('no implicit current session', () => {
        it('change_title returns -32602 when sessionId omitted even if sessions exist', async () => {
            const session = createSession({ id: 'only-session', namespace: 'default' })
            const app = createApp('default', {
                getSessionsByNamespace: () => [session],
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'change_title',
                arguments: { title: 'No Session' }
            }))
            const json = await res.json() as any

            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('get_session returns -32602 when sessionId omitted even if sessions exist', async () => {
            const session = createSession({ id: 'only-session', namespace: 'default' })
            const app = createApp('default', {
                getSessionsByNamespace: () => [session],
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_session',
                arguments: {}
            }))
            const json = await res.json() as any

            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('sessionId is required')
        })
    })
})
