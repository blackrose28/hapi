import { PROTOCOL_VERSION } from "@hapi/protocol";
import { Hono } from 'hono'
import { z } from 'zod'
import { CreateOrLoadMachineRequestSchema, CreateOrLoadSessionRequestSchema, CursorMigrateToAcpRequestSchema, MarkTeamMentionNoActionInputSchema, ReportToTeamInputSchema } from '@hapi/protocol/schemas'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { RunnerAuthenticator } from '../../auth/runnerAuthenticator'
import { SessionIdentityConflictError } from '../../store/sessions'

const runnerAuthorizationSchema = z.string().regex(/^Runner\s+[^.\s]+\.[^\s]+$/i)

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
        authenticatedMachineId: string
        authenticatedRunnerId: string
    }
}

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string,
    runnerId: string,
    authorizeRunnerSession: (organizationId: string, runnerId: string, sessionId: string) => boolean
): { ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok && authorizeRunnerSession(namespace, runnerId, access.sessionId)) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    if (access.ok) return { ok: false, status: 403, error: 'Session access denied' }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    namespace: string
): { ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string } {
    const machine = engine.getMachineByNamespace(machineId, namespace)
    if (machine) {
        return { ok: true, machine }
    }
    if (engine.getMachine(machineId)) {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
}

export function createCliRoutes(
    getSyncEngine: () => SyncEngine | null,
    runnerAuthenticator: RunnerAuthenticator,
    authorizeRunnerSession: (organizationId: string, runnerId: string, sessionId: string) => boolean
): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header('X-Hapi-Protocol-Version', String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = runnerAuthorizationSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const match = /^Runner\s+([^.\s]+)\.([^\s]+)$/i.exec(parsed.data)
        const runner = match ? runnerAuthenticator.authenticateAny({ credentialId: match[1], secret: match[2] }) : null
        if (!runner) return c.json({ error: 'Invalid Runner credential' }, 401)
        const machineId = c.req.header('x-hapi-machine-id')
        if (!machineId || machineId !== runner.machineId) return c.json({ error: 'Machine binding mismatch' }, 403)
        c.set('namespace', runner.organizationId)
        c.set('authenticatedMachineId', runner.machineId)
        c.set('authenticatedRunnerId', runner.id)
        return await next()
    })

    app.post('/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadSessionRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const effectiveMachineId = (parsed.data.metadata && typeof parsed.data.metadata === 'object' && 'machineId' in parsed.data.metadata && typeof parsed.data.metadata.machineId === 'string')
            ? parsed.data.metadata.machineId
            : parsed.data.machine?.id
        if (!effectiveMachineId || effectiveMachineId !== c.get('authenticatedMachineId')) {
            return c.json({ error: 'Session machine binding mismatch' }, 403)
        }
        const namespace = c.get('namespace')
        const machineInput = parsed.data.machine
        if (machineInput) {
            const existingMachine = engine.getMachine(machineInput.id)
            if (existingMachine && existingMachine.namespace !== namespace) {
                return c.json({ error: 'Machine access denied' }, 403)
            }
            engine.getOrCreateMachine(
                machineInput.id,
                machineInput.metadata,
                machineInput.runnerState ?? null,
                namespace
            )
        }

        try {
            const session = engine.getOrCreateSession(
                parsed.data.tag,
                parsed.data.metadata,
                parsed.data.agentState ?? null,
                namespace,
                parsed.data.model,
                parsed.data.effort,
                parsed.data.modelReasoningEffort,
                parsed.data.id
            )
            return c.json({ session })
        } catch (error) {
            if (error instanceof SessionIdentityConflictError) {
                return c.json({ error: error.message }, 409)
            }
            throw error
        }
    })

    app.get('/sessions/resumable', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const machineId = c.req.query('machineId') || undefined
        const sessions = engine.listLocalResumableSessions(namespace, { machineId })
        return c.json({ sessions })
    })

    app.get('/sessions/:id/resume-target', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const result = engine.resolveLocalResumeTarget(c.req.param('id'), namespace)
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : 409
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ target: result.target })
    })

    app.post('/sessions/:id/handoff-local', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const result = await engine.handoffSessionToLocal(c.req.param('id'), namespace)
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : result.code === 'already_local' ? 409
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ ok: true })
    })

    app.get('/sessions/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace, c.get('authenticatedRunnerId'), authorizeRunnerSession)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ session: resolved.session })
    })

    app.get('/sessions/:id/messages', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace, c.get('authenticatedRunnerId'), authorizeRunnerSession)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        // Future-scheduled rows are excluded from CLI backfill — see
        // messages.ts:getDeliverableMessagesAfter for the rationale.  The
        // mature-scan path (releaseMatureScheduledMessages) is the sole
        // emit channel for scheduled rows.
        const messages = engine.getDeliverableMessagesAfter(resolved.sessionId, {
            afterSeq: parsed.data.afterSeq,
            limit,
            now: Date.now()
        })
        return c.json({ messages })
    })

    app.post('/sessions/:id/team-reports', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace, c.get('authenticatedRunnerId'), authorizeRunnerSession)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = ReportToTeamInputSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        try {
            return c.json(engine.reportToTeam({
                namespace,
                sourceSessionId: resolved.sessionId,
                ...parsed.data
            }), 201)
        } catch (error) {
            if (error instanceof Error && (error.message === 'TEAM_REPORT_TOO_LOW_SIGNAL' || error.message === 'TEAM_MENTION_HOP_LIMIT')) {
                return c.json({ error: error.message }, 400)
            }
            if (error instanceof Error && error.message.startsWith('TEAM_')) {
                return c.json({ error: 'Team Chat resource not found' }, 404)
            }
            throw error
        }
    })

    app.post('/sessions/:id/team-mentions/:requestId/no-action', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace, c.get('authenticatedRunnerId'), authorizeRunnerSession)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = MarkTeamMentionNoActionInputSchema.safeParse({ requestId: c.req.param('requestId') })
        if (!parsed.success) {
            return c.json({ error: 'Invalid request id' }, 400)
        }

        try {
            const request = engine.updateTeamMentionStatus({
                namespace,
                sessionId: resolved.sessionId,
                requestId: parsed.data.requestId,
                status: 'no_action'
            })
            return c.json({ request })
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('TEAM_')) {
                return c.json({ error: 'Team mention not found' }, 404)
            }
            throw error
        }
    })

    app.post('/sessions/:id/migrate-to-acp', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace, c.get('authenticatedRunnerId'), authorizeRunnerSession)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        const rawBody = await c.req.text()
        let body: unknown = {}
        if (rawBody.trim().length > 0) {
            try {
                body = JSON.parse(rawBody)
            } catch {
                return c.json({ error: 'Invalid JSON body' }, 400)
            }
        }
        const parsed = CursorMigrateToAcpRequestSchema.safeParse(body ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400)
        }
        const outcome = await engine.migrateLegacyCursorSession(resolved.sessionId, namespace, parsed.data)
        const status = outcome.ok ? 200
            : outcome.reason === 'already_acp' || outcome.reason === 'not_cursor_session' || outcome.reason === 'no_cursor_session_id' ? 409
                : outcome.reason === 'running_refused' ? 409
                    : outcome.reason === 'target_already_exists' ? 409
                        : outcome.reason === 'no_legacy_store_on_disk' ? 404
                            : 500
        return c.json(outcome, status)
    })

    app.post('/machines', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadMachineRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        if(parsed.data.id!==c.get('authenticatedMachineId'))return c.json({error:'Machine binding mismatch'},403)

        const namespace = c.get('namespace')
        const existing = engine.getMachine(parsed.data.id)
        if (existing && existing.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const machine = engine.getOrCreateMachine(parsed.data.id, parsed.data.metadata, parsed.data.runnerState ?? null, namespace)
        return c.json({ machine })
    })

    app.get('/machines/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        if(machineId!==c.get('authenticatedMachineId'))return c.json({error:'Machine binding mismatch'},403)
        const namespace = c.get('namespace')
        const resolved = resolveMachineForNamespace(engine, machineId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    return app
}
