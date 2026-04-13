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
            expect(toolNames).toContain('send_message')
            expect(toolNames).toContain('get_messages_after')
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

    describe('tools/call - send_message', () => {
        it('sends message to active session', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default', active: true })
            const sentMessages: Array<{ sessionId: string; payload: any }> = []
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                sendMessage: async (id: string, payload: any) => { sentMessages.push({ sessionId: id, payload }) }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'session-1', text: 'Hello, world!' }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.content[0].text).toContain('Message sent successfully')
            expect(json.result.isError).toBeFalsy()
            expect(sentMessages).toHaveLength(1)
            expect(sentMessages[0].sessionId).toBe('session-1')
            expect(sentMessages[0].payload.text).toBe('Hello, world!')
        })

        it('uses canonical session ID from resolveSessionAccess', async () => {
            const session = createSession({ id: 'canonical-session-123', namespace: 'default', active: true })
            const sentMessages: Array<{ sessionId: string; payload: any }> = []
            const app = createApp('default', {
                resolveSessionAccess: (inputId: string) => {
                    if (inputId === 'alias-abc') {
                        return { ok: true, sessionId: 'canonical-session-123', session }
                    }
                    return { ok: false, reason: 'not-found' }
                },
                sendMessage: async (id: string, payload: any) => { sentMessages.push({ sessionId: id, payload }) }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'alias-abc', text: 'Hello alias!' }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            expect(sentMessages).toHaveLength(1)
            expect(sentMessages[0].sessionId).toBe('canonical-session-123')
            expect(sentMessages[0].payload.text).toBe('Hello alias!')
            expect(json.result.content[0].text).toContain('canonical-session-123')
        })

        it('returns -32602 when sessionId is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { text: 'Hello' }
            }, 43))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('returns -32602 when text is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'session-1' }
            }, 44))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('returns -32001 when session not found', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'not-found' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'nonexistent', text: 'Hello' }
            }, 45))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32001)
            expect(json.error.message).toContain('Session not found')
        })

        it('returns -32002 when access denied', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'other-ns-session', text: 'Hello' }
            }, 46))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32002)
            expect(json.error.message).toContain('Session access denied')
        })

        it('returns -32602 when session is inactive', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default', active: false })
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'send_message',
                arguments: { sessionId: 'session-1', text: 'Hello' }
            }, 47))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Session is inactive')
        })
    })

    describe('tools/call - get_messages_after', () => {
        it('returns messages after given seq', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default' })
            const mockMessages = [
                { id: "msg-3", seq: 3, localId: null, content: "Hi there", createdAt: 101 },
                { id: "msg-2", seq: 2, localId: null, content: "Hello", createdAt: 100 }
            ]
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                getMessagesAfter: (_id: string, options: { afterSeq: number; limit: number }) => {
                    return mockMessages.filter(m => m.seq > options.afterSeq).sort((a, b) => a.seq - b.seq)
                }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1', afterSeq: 1 }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            const messages = JSON.parse(json.result.content[0].text)
            expect(messages).toHaveLength(2)
            expect(messages[0].seq).toBe(2)
            expect(messages[1].seq).toBe(3)
        })

        it('respects limit parameter', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default' })
            const mockMessages = [
                { id: "msg-2", seq: 2, localId: null, content: "Message 1", createdAt: 100 },
                { id: "msg-3", seq: 3, localId: null, content: "Message 2", createdAt: 101 },
                { id: "msg-4", seq: 4, localId: null, content: "Message 3", createdAt: 102 }
            ]
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                getMessagesAfter: (_id: string, options: { afterSeq: number; limit: number }) => {
                    return mockMessages.filter(m => m.seq > options.afterSeq).slice(0, options.limit)
                }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1', afterSeq: 1, limit: 2 }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            const messages = JSON.parse(json.result.content[0].text)
            expect(messages).toHaveLength(2)
        })

        it('defaults limit to 200 when not provided', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default' })
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                getMessagesAfter: (_id: string, options: { afterSeq: number; limit: number }) => {
                    expect(options.limit).toBe(200)
                    return []
                }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1', afterSeq: 0 }
            }))

            expect(res.status).toBe(200)
        })

        it('returns -32602 when sessionId is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { afterSeq: 0 }
            }, 48))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('returns -32602 when afterSeq is missing', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1' }
            }, 49))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('returns -32001 when session not found', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'not-found' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'nonexistent', afterSeq: 0 }
            }, 50))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32001)
            expect(json.error.message).toContain('Session not found')
        })

        it('returns -32002 when access denied', async () => {
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: false, reason: 'access-denied' })
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'other-ns-session', afterSeq: 0 }
            }, 51))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32002)
            expect(json.error.message).toContain('Session access denied')
        })
    })

    describe('tools/call - get_messages_after limit contract', () => {
        it('rejects limit exceeding schema maximum of 200', async () => {
            const app = createApp('default', {})
            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1', afterSeq: 0, limit: 500 }
            }, 99))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.error.code).toBe(-32602)
            expect(json.error.message).toContain('Invalid params')
        })

        it('accepts limit at schema maximum of 200', async () => {
            const session = createSession({ id: 'session-1', namespace: 'default' })
            const capturedLimit: number[] = []
            const app = createApp('default', {
                resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
                getMessagesAfter: (_id: string, options: { afterSeq: number; limit: number }) => {
                    capturedLimit.push(options.limit)
                    return []
                }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'session-1', afterSeq: 0, limit: 200 }
            }))

            expect(res.status).toBe(200)
            expect(capturedLimit).toHaveLength(1)
            expect(capturedLimit[0]).toBe(200)
        })
    })

    describe('session ID alias resolution', () => {
        it('get_messages_after uses canonical session ID from resolveSessionAccess', async () => {
            const session = createSession({ id: 'canonical-session-123', namespace: 'default' })
            const getMessagesAfterCalls: Array<{ sessionId: string; afterSeq: number; limit: number }> = []
            
            const app = createApp('default', {
                resolveSessionAccess: (inputId: string) => {
                    // Simulate alias resolution: input 'alias-abc' resolves to 'canonical-session-123'
                    if (inputId === 'alias-abc') {
                        return { ok: true, sessionId: 'canonical-session-123', session }
                    }
                    return { ok: false, reason: 'not-found' }
                },
                getMessagesAfter: (sessionId: string, options: { afterSeq: number; limit: number }) => {
                    getMessagesAfterCalls.push({ sessionId, afterSeq: options.afterSeq, limit: options.limit })
                    return [
                        { id: 'msg-1', seq: 1, localId: null, content: 'Test message', createdAt: 100 }
                    ]
                }
            })

            const res = await app.request('/api/mcp', mcpRequest('tools/call', {
                name: 'get_messages_after',
                arguments: { sessionId: 'alias-abc', afterSeq: 0, limit: 50 }
            }))
            const json = await res.json() as any

            expect(res.status).toBe(200)
            expect(json.result.isError).toBeFalsy()
            
            // Assert that getMessagesAfter was called with the canonical ID, not the alias
            expect(getMessagesAfterCalls).toHaveLength(1)
            expect(getMessagesAfterCalls[0].sessionId).toBe('canonical-session-123')
            expect(getMessagesAfterCalls[0].afterSeq).toBe(0)
            expect(getMessagesAfterCalls[0].limit).toBe(50)
            
            // Verify the response contains the messages
            const messages = JSON.parse(json.result.content[0].text)
            expect(messages).toHaveLength(1)
            expect(messages[0].id).toBe('msg-1')
        })
    })
