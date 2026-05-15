import type { AgentState, TeamMentionRequest, ThreadGoal } from '@/types/api'
import type { AgentEvent, ChatBlock, NormalizedMessage, UsageData } from '@/chat/types'
import { traceMessages, type TracedMessage } from '@/chat/tracer'
import { dedupeAgentEvents, foldApiErrorEvents, parseMessageAsEvent } from '@/chat/reducerEvents'
import { collectTitleChanges, collectToolIdsFromMessages, ensureToolBlock, getPermissions } from '@/chat/reducerTools'
import { reduceTimeline } from '@/chat/reducerTimeline'

// Model-scoped weekly rate limits (seven_day_opus, seven_day_sonnet, ...) all share the 7d window display.
const SEVEN_DAY_LIMIT_TYPES = new Set(['seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included'])

// Calculate context size from usage data
function calculateContextSize(usage: UsageData): number {
    if (typeof usage.context_tokens === 'number') {
        return usage.context_tokens
    }
    return (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + usage.input_tokens
}

export type LatestUsage = {
    inputTokens: number
    outputTokens: number
    cacheCreation: number
    cacheRead: number
    contextSize: number
    contextWindow: number | null
    timestamp: number
}

export type QuotaWindow = {
    limitType: string
    utilization: number | null
    endsAt: number
    reached: boolean
    timestamp: number
}

export type LatestQuota = {
    fiveHour: QuotaWindow | null
    sevenDay: QuotaWindow | null
}

function getLatestThreadGoal(normalized: NormalizedMessage[]): ThreadGoal | null {
    for (let i = normalized.length - 1; i >= 0; i--) {
        const msg = normalized[i]
        if (msg.role !== 'event') continue
        const event = msg.content as AgentEvent
        if (event.type === 'thread-goal-cleared') return null
        if (event.type === 'thread-goal-updated') {
            return (event as { goal?: ThreadGoal }).goal ?? null
        }
    }
    return null
}

export function reduceChatBlocks(
    normalized: NormalizedMessage[],
    agentState: AgentState | null | undefined,
    teamMentionRequests: TeamMentionRequest[] = []
): { blocks: ChatBlock[]; hasReadyEvent: boolean; latestUsage: LatestUsage | null; latestGoal: ThreadGoal | null; latestQuota: LatestQuota } {
    const permissionsById = getPermissions(agentState)
    const toolIdsInMessages = collectToolIdsFromMessages(normalized)
    const titleChangesByToolUseId = collectTitleChanges(normalized)

    const traced = traceMessages(normalized)
    const groups = new Map<string, TracedMessage[]>()
    const root: TracedMessage[] = []

    for (const msg of traced) {
        if (msg.sidechainId) {
            const existing = groups.get(msg.sidechainId) ?? []
            existing.push(msg)
            groups.set(msg.sidechainId, existing)
        } else {
            root.push(msg)
        }
    }

    const consumedGroupIds = new Set<string>()
    const emittedTitleChangeToolUseIds = new Set<string>()
    const teamMentionStatusesById = new Map(teamMentionRequests.map((request) => [request.id, request.status]))
    const reducerContext = { permissionsById, groups, consumedGroupIds, titleChangesByToolUseId, emittedTitleChangeToolUseIds, teamMentionStatusesById }
    const rootResult = reduceTimeline(root, reducerContext)
    let hasReadyEvent = rootResult.hasReadyEvent

    // Only create permission-only tool cards when there is no tool call/result in the transcript.
    // Also skip if the permission is older than the oldest message in the current view,
    // to avoid mixing old tool cards with newer messages when paginating.
    const oldestMessageTime = normalized.length > 0
        ? Math.min(...normalized.map(m => m.createdAt))
        : null

    for (const [id, entry] of permissionsById) {
        if (toolIdsInMessages.has(id)) continue
        if (rootResult.toolBlocksById.has(id)) continue

        const createdAt = entry.permission.createdAt ?? Date.now()

        // Skip permissions that are older than the oldest message in the current view.
        // These will be shown when the user loads older messages.
        if (oldestMessageTime !== null && createdAt < oldestMessageTime) {
            continue
        }

        const block = ensureToolBlock(rootResult.blocks, rootResult.toolBlocksById, id, {
            createdAt,
            localId: null,
            name: entry.toolName,
            input: entry.input,
            description: null,
            permission: entry.permission
        })

        if (entry.permission.status === 'approved') {
            block.tool.state = 'completed'
            block.tool.completedAt = entry.permission.completedAt ?? createdAt
            if (block.tool.result === undefined) {
                block.tool.result = 'Approved'
            }
        } else if (entry.permission.status === 'denied' || entry.permission.status === 'canceled') {
            block.tool.state = 'error'
            block.tool.completedAt = entry.permission.completedAt ?? createdAt
            if (block.tool.result === undefined && entry.permission.reason) {
                block.tool.result = { error: entry.permission.reason }
            }
        }
    }

    // Calculate latest usage from messages (find the most recent message with usage data)
    let latestUsage: LatestUsage | null = null
    for (let i = normalized.length - 1; i >= 0; i--) {
        const msg = normalized[i]
        if (msg.usage) {
            latestUsage = {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheCreation: msg.usage.cache_creation_input_tokens ?? 0,
                cacheRead: msg.usage.cache_read_input_tokens ?? 0,
                contextSize: calculateContextSize(msg.usage),
                contextWindow: msg.usage.context_window ?? null,
                timestamp: msg.createdAt
            }
            break
        }
    }

    // Find the most recent quota (rate limit) event per window type (five_hour / seven_day).
    const latestQuota: LatestQuota = { fiveHour: null, sevenDay: null }
    for (let i = normalized.length - 1; i >= 0 && (!latestQuota.fiveHour || !latestQuota.sevenDay); i--) {
        const msg = normalized[i]
        const event = parseMessageAsEvent(msg)
        if (!event || (event.type !== 'limit-warning' && event.type !== 'limit-reached' && event.type !== 'quota-update')) continue

        const quotaEvent = event as { type: 'limit-warning' | 'limit-reached' | 'quota-update'; limitType: string; endsAt: number; utilization?: number | null }
        const key = quotaEvent.limitType === 'five_hour'
            ? 'fiveHour'
            : SEVEN_DAY_LIMIT_TYPES.has(quotaEvent.limitType) ? 'sevenDay' : null
        if (!key || latestQuota[key]) continue

        latestQuota[key] = {
            limitType: quotaEvent.limitType,
            utilization: quotaEvent.type !== 'limit-reached' ? quotaEvent.utilization ?? null : null,
            endsAt: quotaEvent.endsAt,
            reached: quotaEvent.type === 'limit-reached',
            timestamp: msg.createdAt
        }
    }

    return {
        blocks: dedupeAgentEvents(foldApiErrorEvents(rootResult.blocks)),
        hasReadyEvent,
        latestUsage,
        latestGoal: getLatestThreadGoal(normalized),
        latestQuota
    }
}
