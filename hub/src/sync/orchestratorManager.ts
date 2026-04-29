import type {
    DecryptedMessage,
    OrchestratorAuditEntry,
    OrchestratorPublic,
    OrchestratorStatus,
    OrchestratorTranscriptEntry,
    SyncEvent
} from '@hapi/protocol/types'
import { randomUUID } from 'node:crypto'
import type { SyncEngine } from './syncEngine'

const DEFAULT_SESSION_GOAL = `
Current goal:
Work with the AI Coding Agent to solve the current coding problem.

Constraints:
- Do not break unrelated features.
- Preserve existing behavior where possible.
- Prefer minimal edits over broad rewrites.
- Ask for impacted components and regression risks if the change is non-trivial.
`.trim()

const DEFAULT_SYSTEM_PROMPT = `
You are a proxy when talking to an AI Coding Agent.

Behavior:
- Prioritize finishing the requested task.
- Prefer the smallest safe change first.
- Strongly avoid breaking existing features.
- Avoid broad refactors unless clearly necessary.
- Prefer local, rollback-friendly changes.
- Ask the coding agent to call out regression risk when proposing risky edits.
- Prefer tests or validation steps around changed behavior.
- Be concise, practical, direct, and decisive.
- Do not ask unnecessary questions.
- If multiple approaches exist, prefer the one with lower regression risk.
`.trim()

const MAX_POLL_ITERATIONS = 10_000
const MAX_TRANSCRIPT_ENTRIES = 500
const MAX_AUDIT_ENTRIES = 1_000

export type CreateOrchestratorInput = {
    namespace: string
    sessionId: string
    initialMessage: string
    openaiApiKey: string
    openaiBaseUrl?: string | null
    model: string
    systemPrompt?: string
    sessionGoal?: string
    pollIntervalMs?: number
    pollLimit?: number
}

type TranscriptEntry = OrchestratorTranscriptEntry & { seq?: number | null }

type InternalRun = {
    namespace: string
    sessionId: string
    openaiApiKey: string
    openaiBaseUrl: string | null
    model: string
    systemPrompt: string
    sessionGoal: string
    pollIntervalMs: number
    pollLimit: number
    status: OrchestratorStatus
    error: string | null
    afterSeq: number
    transcript: TranscriptEntry[]
    auditLog: OrchestratorAuditEntry[]
    orchestratorTexts: Set<string>
    createdAt: number
    updatedAt: number
    pollIterations: number
    loopPromise: Promise<void> | null
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function unwrapRoleContent(event: unknown): { role: string; text: string } {
    if (event === null || typeof event !== 'object') {
        return { role: 'unknown', text: typeof event === 'string' ? event : JSON.stringify(event) }
    }

    const e = event as Record<string, unknown>
    let role: string
    let content: unknown

    if ('role' in e && 'content' in e) {
        role = String(e.role)
        content = e.content
    } else if (typeof e.message === 'object' && e.message !== null && 'role' in (e.message as object)) {
        const m = e.message as Record<string, unknown>
        role = String(m.role)
        content = m.content ?? ''
    } else if (
        typeof e.data === 'object'
        && e.data !== null
        && typeof (e.data as Record<string, unknown>).message === 'object'
        && (e.data as Record<string, unknown>).message !== null
        && 'role' in ((e.data as Record<string, unknown>).message as object)
    ) {
        const m = (e.data as Record<string, unknown>).message as Record<string, unknown>
        role = String(m.role)
        content = m.content ?? ''
    } else {
        role = typeof e.type === 'string' ? e.type : 'unknown'
        content = event
    }

    let text: string
    if (Array.isArray(content)) {
        const parts: string[] = []
        for (const block of content) {
            if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text') {
                parts.push(String((block as { text?: string }).text ?? ''))
            } else if (typeof block === 'string') {
                parts.push(block)
            }
        }
        text = parts.length > 0 ? parts.join('\n') : JSON.stringify(content)
    } else if (typeof content === 'string') {
        text = content
    } else {
        text = content ? JSON.stringify(content) : ''
    }

    return { role, text }
}

function shouldRespondFromContent(rawContent: unknown): boolean {
    if (rawContent === null || typeof rawContent !== 'object') {
        return false
    }
    const rc = rawContent as Record<string, unknown>
    const innerRaw = rc.content
    const inner = typeof innerRaw === 'object' && innerRaw !== null ? (innerRaw as Record<string, unknown>) : rc

    if (inner.type !== 'event') {
        return false
    }
    const data = inner.data
    if (typeof data !== 'object' || data === null) {
        return false
    }
    return (data as { type?: string }).type === 'ready'
}

function transcriptToBrainLines(entries: TranscriptEntry[]): string {
    return entries
        .slice(-30)
        .map((m) => `[${m.role}] ${m.content}`)
        .join('\n')
}

function extractResponsesOutputText(json: unknown): string {
    if (json === null || typeof json !== 'object') {
        return ''
    }
    const j = json as Record<string, unknown>
    if (typeof j.output_text === 'string') {
        return j.output_text.trim()
    }
    const output = j.output
    if (!Array.isArray(output)) {
        return ''
    }
    const parts: string[] = []
    for (const item of output) {
        if (typeof item !== 'object' || item === null) continue
        const o = item as Record<string, unknown>
        const content = o.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type === 'output_text' && typeof b.text === 'string') {
                parts.push(b.text)
            }
        }
    }
    return parts.join('').trim()
}

async function openaiResponse(params: {
    apiKey: string
    baseUrl: string | null
    model: string
    system: string
    user: string
}): Promise<string> {
    const base = (params.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    const url = `${base}/responses`
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${params.apiKey}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: params.model,
            input: [
                { role: 'system', content: params.system },
                { role: 'user', content: params.user }
            ]
        })
    })
    if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 500)}`)
    }
    const json: unknown = await res.json()
    return extractResponsesOutputText(json)
}

export class OrchestratorManager {
    private readonly runs = new Map<string, InternalRun>()
    private readonly getSyncEngine: () => SyncEngine | null
    private readonly broadcast: (event: SyncEvent) => void

    constructor(deps: { getSyncEngine: () => SyncEngine | null; broadcast: (event: SyncEvent) => void }) {
        this.getSyncEngine = deps.getSyncEngine
        this.broadcast = deps.broadcast
    }

    private toPublic(id: string, run: InternalRun): OrchestratorPublic {
        return {
            id,
            sessionId: run.sessionId,
            model: run.model,
            status: run.status,
            error: run.error,
            messageCount: run.transcript.length,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt
        }
    }

    private emit(id: string, run: InternalRun): void {
        run.updatedAt = Date.now()
        const data = this.toPublic(id, run)
        const event: SyncEvent = {
            type: 'orchestrator-updated',
            namespace: run.namespace,
            sessionId: run.sessionId,
            orchestratorId: id,
            data
        }
        this.broadcast(event)
    }

    create(input: CreateOrchestratorInput): OrchestratorPublic {
        const id = randomUUID()
        const now = Date.now()
        const run: InternalRun = {
            namespace: input.namespace,
            sessionId: input.sessionId,
            openaiApiKey: input.openaiApiKey,
            openaiBaseUrl: input.openaiBaseUrl?.replace(/\/$/, '') ?? null,
            model: input.model,
            systemPrompt: (input.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT).trim(),
            sessionGoal: (input.sessionGoal?.trim() || DEFAULT_SESSION_GOAL).trim(),
            pollIntervalMs: input.pollIntervalMs ?? 2000,
            pollLimit: input.pollLimit ?? 20,
            status: 'running',
            error: null,
            afterSeq: 0,
            transcript: [],
            auditLog: [],
            orchestratorTexts: new Set(),
            createdAt: now,
            updatedAt: now,
            pollIterations: 0,
            loopPromise: null
        }
        this.runs.set(id, run)
        this.emit(id, run)
        run.loopPromise = this.runLoop(id, run, input.initialMessage).catch((err) => {
            const r = this.runs.get(id)
            if (!r) return
            r.status = 'error'
            r.error = err instanceof Error ? err.message : String(err)
            this.emit(id, r)
        })
        return this.toPublic(id, run)
    }

    get(id: string, namespace: string): OrchestratorPublic | null {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return null
        }
        return this.toPublic(id, run)
    }

    list(namespace: string): OrchestratorPublic[] {
        const out: OrchestratorPublic[] = []
        for (const [id, run] of this.runs) {
            if (run.namespace === namespace) {
                out.push(this.toPublic(id, run))
            }
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt)
    }

    getTranscript(id: string, namespace: string, limit: number): OrchestratorTranscriptEntry[] | null {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return null
        }
        const slice = run.transcript.slice(-Math.min(limit, MAX_TRANSCRIPT_ENTRIES))
        return slice.map(({ id: eid, role, content, createdAt }) => ({
            id: eid,
            role,
            content,
            createdAt
        }))
    }

    getAuditLog(id: string, namespace: string, limit: number): OrchestratorAuditEntry[] | null {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return null
        }
        return run.auditLog.slice(-Math.min(limit, MAX_AUDIT_ENTRIES))
    }

    pause(id: string, namespace: string): OrchestratorPublic | null {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return null
        }
        if (run.status === 'running') {
            run.status = 'paused'
            this.emit(id, run)
        }
        return this.toPublic(id, run)
    }

    resume(id: string, namespace: string): OrchestratorPublic | null {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return null
        }
        if (run.status === 'paused') {
            run.status = 'running'
            this.emit(id, run)
        }
        return this.toPublic(id, run)
    }

    stop(id: string, namespace: string): boolean {
        const run = this.runs.get(id)
        if (!run || run.namespace !== namespace) {
            return false
        }
        this.appendAudit(run, {
            type: 'system-event',
            ts: Date.now(),
            reason: 'user-stop'
        })
        run.status = 'done'
        this.emit(id, run)
        this.runs.delete(id)
        return true
    }

    private appendTranscript(run: InternalRun, entry: Omit<TranscriptEntry, 'seq'> & { seq?: number | null }): void {
        run.transcript.push({
            id: entry.id,
            role: entry.role,
            content: entry.content,
            createdAt: entry.createdAt,
            seq: entry.seq ?? null
        })
        if (run.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
            run.transcript.splice(0, run.transcript.length - MAX_TRANSCRIPT_ENTRIES)
        }
    }

    private appendAudit(run: InternalRun, entry: OrchestratorAuditEntry): void {
        run.auditLog.push(entry)
        if (run.auditLog.length > MAX_AUDIT_ENTRIES) {
            run.auditLog.splice(0, run.auditLog.length - MAX_AUDIT_ENTRIES)
        }
    }

    private decodableRoleForUserText(run: InternalRun, text: string, hubRole: string): string {
        if (hubRole === 'user' && run.orchestratorTexts.has(text.trim())) {
            return 'proxy'
        }
        return hubRole
    }

    private async runLoop(orchestratorId: string, run: InternalRun, initialMessage: string): Promise<void> {
        const engine = this.getSyncEngine()
        if (!engine) {
            this.appendAudit(run, {
                type: 'system-event',
                ts: Date.now(),
                reason: 'engine-unavailable'
            })
            run.status = 'error'
            run.error = 'Sync engine unavailable'
            this.emit(orchestratorId, run)
            return
        }

        const access = engine.resolveSessionAccess(run.sessionId, run.namespace)
        if (!access.ok) {
            run.status = 'error'
            run.error = access.reason === 'not-found' ? 'Session not found' : 'Access denied'
            this.emit(orchestratorId, run)
            return
        }

        const initial = initialMessage.trim()
        run.orchestratorTexts.add(initial)
        await engine.sendMessage(run.sessionId, {
            text: initial,
            sentFrom: 'webapp'
        })

        while (this.runs.has(orchestratorId)) {
            const current = this.runs.get(orchestratorId)
            if (!current) {
                return
            }

            if (current.status === 'done' || current.status === 'error') {
                return
            }

            while (current.status === 'paused') {
                if (!this.runs.has(orchestratorId)) {
                    return
                }
                await sleep(200)
            }

            current.pollIterations += 1
            if (current.pollIterations > MAX_POLL_ITERATIONS) {
                this.appendAudit(current, {
                    type: 'system-event',
                    ts: Date.now(),
                    reason: 'max-iterations'
                })
                current.status = 'error'
                current.error = 'Max poll iterations reached'
                this.emit(orchestratorId, current)
                this.runs.delete(orchestratorId)
                return
            }

            if (current.transcript.length >= MAX_TRANSCRIPT_ENTRIES) {
                this.appendAudit(current, {
                    type: 'system-event',
                    ts: Date.now(),
                    reason: 'transcript-limit'
                })
                current.status = 'done'
                current.error = 'Transcript limit reached'
                this.emit(orchestratorId, current)
                this.runs.delete(orchestratorId)
                return
            }

            const eng = this.getSyncEngine()
            if (!eng) {
                this.appendAudit(current, {
                    type: 'system-event',
                    ts: Date.now(),
                    reason: 'engine-unavailable'
                })
                current.status = 'error'
                current.error = 'Sync engine unavailable'
                this.emit(orchestratorId, current)
                this.runs.delete(orchestratorId)
                return
            }

            const batch = eng.getMessagesAfter(current.sessionId, {
                afterSeq: current.afterSeq,
                limit: current.pollLimit
            })

            if (batch.length === 0) {
                await sleep(current.pollIntervalMs)
                continue
            }

            let readySeen = false
            let lastAgent: DecryptedMessage | null = null

            for (const msg of batch) {
                const seq = typeof msg.seq === 'number' ? msg.seq : 0
                current.afterSeq = Math.max(current.afterSeq, seq)

                const { role: rawRole, text } = unwrapRoleContent(msg.content)
                const role = this.decodableRoleForUserText(current, text, rawRole)

                this.appendTranscript(current, {
                    id: msg.id,
                    role,
                    content: text,
                    createdAt: msg.createdAt,
                    seq: msg.seq
                })
                this.emit(orchestratorId, current)

                if (
                    (rawRole === 'assistant' || rawRole === 'agent')
                    && shouldRespondFromContent(msg.content)
                ) {
                    readySeen = true
                }
                if ((rawRole === 'assistant' || rawRole === 'agent') && text.trim()) {
                    lastAgent = msg
                }
            }

            if (readySeen) {
                try {
                    const target = lastAgent ?? batch[batch.length - 1]
                    const done = await this.isTaskDone(current, target)
                    if (done) {
                        current.status = 'done'
                        this.emit(orchestratorId, current)
                        this.runs.delete(orchestratorId)
                        return
                    }

                    const reply = await this.generateReply(current, target)

                    if (reply.trim()) {
                        current.orchestratorTexts.add(reply.trim())
                        await eng.sendMessage(current.sessionId, {
                            text: reply,
                            sentFrom: 'webapp'
                        })
                    }
                } catch (e) {
                    current.status = 'error'
                    current.error = e instanceof Error ? e.message : String(e)
                    this.emit(orchestratorId, current)
                    return
                }
            }

            await sleep(current.pollIntervalMs)
        }
    }

    private async generateReply(run: InternalRun, latest: DecryptedMessage): Promise<string> {
        this.appendAudit(run, {
            type: 'reply-generated',
            ts: Date.now(),
            triggeredByMessageId: latest.id,
            triggeredBySeq: latest.seq ?? null
        })
        const { role, text } = unwrapRoleContent(latest.content)
        const historyText = transcriptToBrainLines(run.transcript.slice(0, -1))
        const userPrompt = `
Session instructions:
${run.sessionGoal}

Conversation so far:
${historyText}

Latest incoming message from AI Coding Agent:
[${role}] ${text}

Write a concise reply to the AI Coding Agent.

Rules:
- Be concise and practical.
- Prefer the smallest safe fix.
- Protect existing features.
- Push back on risky refactors unless necessary.
- If useful, ask for regression risks, affected modules, and validation steps.
- Output only the reply text.
`.trim()

        return await openaiResponse({
            apiKey: run.openaiApiKey,
            baseUrl: run.openaiBaseUrl,
            model: run.model,
            system: run.systemPrompt,
            user: userPrompt
        })
    }

    private async isTaskDone(run: InternalRun, latest: DecryptedMessage): Promise<boolean> {
        const historyText = transcriptToBrainLines(run.transcript)
        const prompt = `
You are evaluating whether a coding task is complete.

Session goal:
${run.sessionGoal}

Recent conversation:
${historyText}

Based on the conversation, has the coding agent fully completed the task described in the session goal?

Consider:
- Did the agent make all requested changes?
- Did the agent confirm the changes work (tests pass, build succeeds, etc.)?
- Are there remaining action items, open questions, or unresolved issues?
- Did the agent explicitly signal completion?

Respond with exactly one word: YES or NO
`.trim()

        try {
            const answer = await openaiResponse({
                apiKey: run.openaiApiKey,
                baseUrl: run.openaiBaseUrl,
                model: run.model,
                system: 'You evaluate task completion. Respond with exactly YES or NO.',
                user: prompt
            })
            const normalized = answer.trim().toUpperCase().startsWith('YES') ? 'YES' : 'NO'
            this.appendAudit(run, {
                type: 'done-check',
                ts: Date.now(),
                llmAnswer: normalized,
                rawAnswer: answer,
                triggeredByMessageId: latest.id,
                triggeredBySeq: latest.seq ?? null,
                historySize: run.transcript.length
            })
            return normalized === 'YES'
        } catch {
            this.appendAudit(run, {
                type: 'done-check',
                ts: Date.now(),
                llmAnswer: 'NO',
                rawAnswer: '',
                triggeredByMessageId: latest.id,
                triggeredBySeq: latest.seq ?? null,
                historySize: run.transcript.length
            })
            return false
        }
    }
}
