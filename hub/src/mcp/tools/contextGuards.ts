import type { Context } from 'hono'
import type { WebAppEnv } from '../../web/middleware/auth'
import type { SyncEngine } from '../../sync/syncEngine'

/** Result of successfully resolving MCP tool context. */
export type McpToolContext = {
    namespace: string
    engine: SyncEngine
}

/** Resolve the SyncEngine and namespace for an MCP tool invocation.
 *  Returns a Response on failure (engine down / namespace missing). */
export function resolveToolContext(
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): McpToolContext | Response {
    const engine = getSyncEngine()
    if (!engine) {
        return c.json({ error: 'Not connected' }, 503)
    }
    const namespace = c.get('namespace')
    if (!namespace) {
        return c.json({ error: 'Missing namespace' }, 401)
    }
    return { namespace, engine }
}

/** Require a session accessible within the caller\'s namespace.
 *  Returns a Response on failure (not found / access denied / inactive). */
export function requireSessionForTool(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    sessionId: string,
    namespace: string,
    options?: { requireActive?: boolean }
): { sessionId: string; session: import('../../sync/syncEngine').Session } | Response {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (!access.ok) {
        const status = access.reason === 'access-denied' ? 403 : 404
        const error = access.reason === 'access-denied'
            ? 'Session access denied'
            : 'Session not found'
        return c.json({ error }, status)
    }
    if (options?.requireActive && !access.session.active) {
        return c.json({ error: 'Session is inactive' }, 409)
    }
    return { sessionId: access.sessionId, session: access.session }
}
