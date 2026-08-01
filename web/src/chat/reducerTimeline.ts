import type { ChatBlock, TeamMentionBlock, ToolCallBlock, ToolPermission } from '@/chat/types'
import type { TracedMessage } from '@/chat/tracer'
import { createCliOutputBlock, isCliOutputText, mergeCliOutputBlocks } from '@/chat/reducerCliOutput'
import { parseMessageAsEvent } from '@/chat/reducerEvents'
import { ensureToolBlock, extractTitleFromChangeTitleInput, isChangeTitleToolName, type PermissionEntry } from '@/chat/reducerTools'

/**
 * Recognizes subagent-spawning tool calls across agent flavors. Claude/Codex
 * use the bare name `Task`; some ACP agents label the tool itself `Agent`, and
 * Kimi emits titled variants like `Agent: <subagent name>` / `Task: <name>`
 * for the same concept. Keeping this permissive (name or prefix) lets the
 * sidechain-grouping logic below attach children regardless of flavor.
 */
function isSubagentToolName(name: string): boolean {
    return name === 'Task' || name === 'Agent' || name.startsWith('Agent:') || name.startsWith('Task:')
}

function getTeamMentionMeta(meta: unknown): { requestId: string; teamChatId: string; sourceMessageId: string } | null {
    if (!meta || typeof meta !== 'object') return null
    const candidate = meta as Record<string, unknown>
    if (candidate.sentFrom !== 'team-chat') return null
    if (typeof candidate.teamMentionRequestId !== 'string') return null
    if (typeof candidate.teamChatId !== 'string') return null
    if (typeof candidate.sourceMessageId !== 'string') return null
    return {
        requestId: candidate.teamMentionRequestId,
        teamChatId: candidate.teamChatId,
        sourceMessageId: candidate.sourceMessageId
    }
}

function stripTeamMentionEnvelope(text: string): string {
    if (!text.startsWith('[HAPI_TEAM_MENTION]')) return text
    const marker = 'From Team Chat:'
    const markerIndex = text.indexOf(marker)
    if (markerIndex === -1) return text.replace('[HAPI_TEAM_MENTION]', '').trim()
    const body = text.slice(markerIndex + marker.length)
    const contextIndex = body.indexOf('\n\nContext:')
    return (contextIndex === -1 ? body : body.slice(0, contextIndex)).trim()
}

export function reduceTimeline(
    messages: TracedMessage[],
    context: {
        permissionsById: Map<string, PermissionEntry>
        groups: Map<string, TracedMessage[]>
        consumedGroupIds: Set<string>
        titleChangesByToolUseId: Map<string, string>
        emittedTitleChangeToolUseIds: Set<string>
        teamMentionStatusesById?: Map<string, TeamMentionBlock['status']>
    }
): { blocks: ChatBlock[]; toolBlocksById: Map<string, ToolCallBlock>; hasReadyEvent: boolean } {
    const blocks: ChatBlock[] = []
    const toolBlocksById = new Map<string, ToolCallBlock>()
    let hasReadyEvent = false

    // Pre-scan: collect UUIDs of system-injected user turns (sidechain
    // prompts, task notifications, system reminders).  These are used below
    // to identify sentinel auto-replies ("No response requested.") whose
    // parentUUID points to one of these injected messages.
    const injectedTurnUuids = new Set<string>()
    for (const msg of messages) {
        if (msg.role !== 'agent' || !msg.isSidechain) continue
        for (const c of msg.content) {
            if (c.type === 'sidechain') {
                injectedTurnUuids.add(c.uuid)
            }
        }
    }

    for (const msg of messages) {
        if (msg.role === 'event') {
            if (msg.content.type === 'ready') {
                hasReadyEvent = true
                continue
            }
            if (msg.content.type === 'token-count' || msg.content.type === 'codex-goal') {
                continue
            }
            blocks.push({
                kind: 'agent-event',
                id: msg.id,
                createdAt: msg.createdAt,
                event: msg.content,
                meta: msg.meta
            })
            continue
        }

        const event = parseMessageAsEvent(msg)
        if (event) {
            // quota-update is silent state (see reducer.ts's latestQuota scan) — never a chat bubble.
            if (event.type === 'quota-update') {
                continue
            }
            blocks.push({
                kind: 'agent-event',
                id: msg.id,
                createdAt: msg.createdAt,
                event,
                meta: msg.meta
            })
            continue
        }

        if (msg.role === 'user') {
            const teamMention = getTeamMentionMeta(msg.meta)
            if (teamMention) {
                blocks.push({
                    kind: 'team-mention',
                    id: msg.id,
                    localId: msg.localId,
                    createdAt: msg.createdAt,
                    requestId: teamMention.requestId,
                    teamChatId: teamMention.teamChatId,
                    sourceMessageId: teamMention.sourceMessageId,
                    text: stripTeamMentionEnvelope(msg.content.text),
                    status: context.teamMentionStatusesById?.get(teamMention.requestId) ?? 'delivered',
                    meta: msg.meta
                })
                continue
            }
            if (isCliOutputText(msg.content.text, msg.meta)) {
                blocks.push(createCliOutputBlock({
                    id: msg.id,
                    localId: msg.localId,
                    createdAt: msg.createdAt,
                    text: msg.content.text,
                    source: 'user',
                    meta: msg.meta
                }))
                continue
            }
            blocks.push({
                kind: 'user-text',
                id: msg.id,
                localId: msg.localId,
                createdAt: msg.createdAt,
                text: msg.content.text,
                attachments: msg.content.attachments,
                status: msg.status,
                originalText: msg.originalText,
                meta: msg.meta
            })
            continue
        }

        if (msg.role === 'agent') {
            // When the message contains a Task tool_use, Claude often writes the
            // prompt as a text block before the tool_use block.  We only want to
            // suppress that exact prompt text — not every text block in the message.
            const taskToolCall = msg.content.find(
                (c) => c.type === 'tool-call' && isSubagentToolName(c.name)
            )
            const taskPromptText: string | null = (() => {
                if (!taskToolCall || taskToolCall.type !== 'tool-call') return null
                const input = taskToolCall.input
                if (typeof input === 'object' && input !== null && 'prompt' in input) {
                    const p = (input as { prompt: unknown }).prompt
                    if (typeof p === 'string') return p
                }
                return null
            })()

            for (let idx = 0; idx < msg.content.length; idx += 1) {
                const c = msg.content[idx]
                if (c.type === 'text') {
                    // Skip "No response requested." — Claude's sentinel auto-response
                    // to system-injected messages (task notifications, system reminders).
                    //
                    // Structural checks to avoid false positives:
                    //   1. msg.content.length === 1 — no tool calls or reasoning alongside
                    //   2. c.parentUUID points to a known injected turn UUID (collected
                    //      in pre-scan from sidechain content blocks)
                    //   3. Exact text match on the known sentinel phrase
                    if (
                        msg.content.length === 1 &&
                        c.parentUUID !== null &&
                        injectedTurnUuids.has(c.parentUUID)
                    ) {
                        const trimmedText = c.text.trim()
                        if (trimmedText === 'No response requested.' || trimmedText === 'No response requested') {
                            continue
                        }
                    }

                    // Skip text blocks that are just the Task tool prompt (already shown in tool card)
                    if (taskPromptText && c.text.trim() === taskPromptText.trim()) continue

                    if (isCliOutputText(c.text, msg.meta)) {
                        blocks.push(createCliOutputBlock({
                            id: `${msg.id}:${idx}`,
                            localId: msg.localId,
                            createdAt: msg.createdAt,
                            text: c.text,
                            source: 'assistant',
                            meta: msg.meta
                        }))
                        continue
                    }
                    blocks.push({
                        kind: 'agent-text',
                        id: `${msg.id}:${idx}`,
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'reasoning') {
                    blocks.push({
                        kind: 'agent-reasoning',
                        id: `${msg.id}:${idx}`,
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'summary') {
                    blocks.push({
                        kind: 'agent-event',
                        id: `${msg.id}:${idx}`,
                        createdAt: msg.createdAt,
                        event: { type: 'message', message: c.summary },
                        meta: msg.meta
                    })
                    continue
                }

                if (c.type === 'tool-call') {
                    if (isChangeTitleToolName(c.name)) {
                        const title = context.titleChangesByToolUseId.get(c.id) ?? extractTitleFromChangeTitleInput(c.input)
                        if (title && !context.emittedTitleChangeToolUseIds.has(c.id)) {
                            context.emittedTitleChangeToolUseIds.add(c.id)
                            blocks.push({
                                kind: 'agent-event',
                                id: `${msg.id}:${idx}`,
                                createdAt: msg.createdAt,
                                event: { type: 'title-changed', title },
                                meta: msg.meta
                            })
                        }
                        continue
                    }

                    const permission = context.permissionsById.get(c.id)?.permission

                    const block = ensureToolBlock(blocks, toolBlocksById, c.id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: c.name,
                        input: c.input,
                        description: c.description,
                        permission
                    })

                    if (block.tool.state === 'pending') {
                        block.tool.state = 'running'
                        block.tool.startedAt = msg.createdAt
                    }

                    if (isSubagentToolName(c.name) && !context.consumedGroupIds.has(msg.id)) {
                        const sidechain = context.groups.get(msg.id) ?? null
                        if (sidechain && sidechain.length > 0) {
                            context.consumedGroupIds.add(msg.id)
                            const child = reduceTimeline(sidechain, context)
                            hasReadyEvent = hasReadyEvent || child.hasReadyEvent
                            block.children = child.blocks
                        }
                    }
                    continue
                }

                if (c.type === 'tool-result') {
                    const title = context.titleChangesByToolUseId.get(c.tool_use_id) ?? null
                    if (title) {
                        if (!context.emittedTitleChangeToolUseIds.has(c.tool_use_id)) {
                            context.emittedTitleChangeToolUseIds.add(c.tool_use_id)
                            blocks.push({
                                kind: 'agent-event',
                                id: `${msg.id}:${idx}`,
                                createdAt: msg.createdAt,
                                event: { type: 'title-changed', title },
                                meta: msg.meta
                            })
                        }
                        continue
                    }

                    const permissionEntry = context.permissionsById.get(c.tool_use_id)
                    const permissionFromResult = c.permissions ? ({
                        id: c.tool_use_id,
                        status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                        date: c.permissions.date,
                        mode: c.permissions.mode,
                        allowedTools: c.permissions.allowedTools,
                        decision: c.permissions.decision
                    } satisfies ToolPermission) : undefined

                    const permission = (() => {
                        if (permissionFromResult && permissionEntry?.permission) {
                            return {
                                ...permissionEntry.permission,
                                ...permissionFromResult,
                                allowedTools: permissionFromResult.allowedTools ?? permissionEntry.permission.allowedTools,
                                decision: permissionFromResult.decision ?? permissionEntry.permission.decision
                            } satisfies ToolPermission
                        }
                        return permissionFromResult ?? permissionEntry?.permission
                    })()

                    const block = ensureToolBlock(blocks, toolBlocksById, c.tool_use_id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: permissionEntry?.toolName ?? 'Tool',
                        input: permissionEntry?.input ?? null,
                        description: null,
                        permission
                    })

                    block.tool.result = c.content
                    block.tool.completedAt = msg.createdAt
                    block.tool.state = c.is_error ? 'error' : 'completed'
                    continue
                }

                if (c.type === 'sidechain') {
                    // Extract task-notification summaries as visible events
                    const trimmedPrompt = c.prompt.trimStart()
                    if (trimmedPrompt.startsWith('<task-notification>')) {
                        const summary = trimmedPrompt.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim()
                        if (summary) {
                            blocks.push({
                                kind: 'agent-event',
                                id: `${msg.id}:${idx}`,
                                createdAt: msg.createdAt,
                                event: { type: 'message', message: summary },
                                meta: msg.meta
                            })
                        }
                    }
                    // Skip rendering prompt text (already in parent Task tool card or not user-visible)
                    continue
                }
            }
        }
    }

    return { blocks: mergeCliOutputBlocks(blocks), toolBlocksById, hasReadyEvent }
}
