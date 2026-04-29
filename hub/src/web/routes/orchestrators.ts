import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { OrchestratorManager } from '../../sync/orchestratorManager'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const createBodySchema = z.object({
    sessionId: z.string().min(1),
    initialMessage: z.string().min(1),
    openaiApiKey: z.string().min(1),
    model: z.string().min(1),
    openaiBaseUrl: z.string().max(2048).optional().nullable(),
    systemPrompt: z.string().optional(),
    sessionGoal: z.string().optional(),
    pollIntervalMs: z.number().int().min(500).max(120_000).optional(),
    pollLimit: z.number().int().min(1).max(100).optional()
})

const patchBodySchema = z.object({
    action: z.enum(['pause', 'resume'])
})

export function createOrchestratorsRoutes(
    getSyncEngine: () => SyncEngine | null,
    getOrchestratorManager: () => OrchestratorManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/orchestrators', (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const namespace = c.get('namespace')
        return c.json({ orchestrators: mgr.list(namespace) })
    })

    app.post('/orchestrators', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON' }, 400)
        }

        const parsed = createBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400)
        }

        const namespace = c.get('namespace')
        const access = engine.resolveSessionAccess(parsed.data.sessionId, namespace)
        if (!access.ok) {
            return c.json({ error: access.reason === 'not-found' ? 'Session not found' : 'Access denied' }, 404)
        }

        const created = mgr.create({
            namespace,
            sessionId: parsed.data.sessionId,
            initialMessage: parsed.data.initialMessage,
            openaiApiKey: parsed.data.openaiApiKey,
            openaiBaseUrl: parsed.data.openaiBaseUrl ?? null,
            model: parsed.data.model,
            systemPrompt: parsed.data.systemPrompt,
            sessionGoal: parsed.data.sessionGoal,
            pollIntervalMs: parsed.data.pollIntervalMs,
            pollLimit: parsed.data.pollLimit
        })

        return c.json({ orchestrator: created }, 201)
    })

    app.get('/orchestrators/:id', (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const id = c.req.param('id')
        const namespace = c.get('namespace')
        const orch = mgr.get(id, namespace)
        if (!orch) {
            return c.json({ error: 'Not found' }, 404)
        }
        return c.json({ orchestrator: orch })
    })

    app.get('/orchestrators/:id/transcript', (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const id = c.req.param('id')
        const namespace = c.get('namespace')
        const limitRaw = c.req.query('limit')
        const limit = limitRaw ? Math.min(500, Math.max(1, Number.parseInt(limitRaw, 10) || 200)) : 200
        const transcript = mgr.getTranscript(id, namespace, limit)
        if (transcript === null) {
            return c.json({ error: 'Not found' }, 404)
        }
        return c.json({ transcript })
    })

    app.get('/orchestrators/:id/audit-log', (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const id = c.req.param('id')
        const namespace = c.get('namespace')
        const limitRaw = c.req.query('limit')
        const limit = limitRaw ? Math.min(1000, Math.max(1, Number.parseInt(limitRaw, 10) || 300)) : 300
        const auditLog = mgr.getAuditLog(id, namespace, limit)
        if (auditLog === null) {
            return c.json({ error: 'Not found' }, 404)
        }
        return c.json({ auditLog })
    })

    app.patch('/orchestrators/:id', async (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const id = c.req.param('id')
        const namespace = c.get('namespace')

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON' }, 400)
        }

        const parsed = patchBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400)
        }

        const orch =
            parsed.data.action === 'pause'
                ? mgr.pause(id, namespace)
                : mgr.resume(id, namespace)

        if (!orch) {
            return c.json({ error: 'Not found' }, 404)
        }
        return c.json({ orchestrator: orch })
    })

    app.delete('/orchestrators/:id', (c) => {
        const mgr = getOrchestratorManager()
        if (!mgr) {
            return c.json({ error: 'Orchestrator unavailable' }, 503)
        }
        const id = c.req.param('id')
        const namespace = c.get('namespace')
        const ok = mgr.stop(id, namespace)
        if (!ok) {
            return c.json({ error: 'Not found' }, 404)
        }
        return c.json({ ok: true })
    })

    return app
}
