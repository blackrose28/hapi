/**
 * MCP Streamable HTTP route.
 *
 * Single POST endpoint at /api/mcp that handles MCP JSON-RPC requests.
 * Protected by the same JWT auth middleware as other /api/* routes.
 *
 * The endpoint is namespace-scoped: all operations are confined to the
 * namespace embedded in the caller\'s JWT. Tools that target a session
 * require an explicit sessionId in their arguments - no implicit
 * "current session" is ever assumed.
 */

import { Hono } from 'hono'
import { handleMcpRequest } from '../../mcp/server/createHubMcpHttpServer'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function createMcpHttpRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/mcp', async (c) => {
        const contentType = c.req.header('content-type') ?? ''
        if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
            return c.json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Invalid Request: Content-Type must be application/json' }
            }, 400)
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error: invalid JSON' }
            }, 400)
        }

        // MCP Streamable HTTP: single JSON-RPC request per POST
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return c.json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Invalid Request: expected a single JSON-RPC request object' }
            }, 400)
        }

        const request = body as Record<string, unknown>
        if (request.jsonrpc !== '2.0') {
            return c.json({
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
            }, 400)
        }

        const response = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                id: request.id as string | number | null | undefined,
                method: request.method as string,
                params: request.params as Record<string, unknown> | undefined
            },
            c,
            getSyncEngine
        )

        return c.json(response)
    })

    return app
}
