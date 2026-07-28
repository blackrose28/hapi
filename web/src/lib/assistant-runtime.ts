import { useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import type { AppendMessage, AttachmentAdapter, ThreadMessageLike } from '@assistant-ui/react'
import { useExternalMessageConverter, useExternalStoreRuntime } from '@assistant-ui/react'
import type { PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import { resolvePendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import { safeStringify } from '@hapi/protocol'
import { renderEventLabel } from '@/chat/presentation'
import type { ChatBlock, CliOutputBlock, CodexReview, ToolGroupBlock, UsageData } from '@/chat/types'
import type { AgentEvent, TeamMentionBlock, ToolCallBlock } from '@/chat/types'
import { REASONING_TOOL_NAME, reasoningToolCallId } from '@/lib/reasoningPart'
import type { AttachmentMetadata, MessageStatus as HappyMessageStatus, Session } from '@/types/api'

export type HappyChatMessageMetadata = {
    kind: 'user' | 'assistant' | 'tool' | 'event' | 'cli-output' | 'team-mention' | 'codex-review'
    status?: HappyMessageStatus
    localId?: string | null
    invokedAt?: number | null
    originalText?: string
    toolCallId?: string
    event?: AgentEvent
    source?: CliOutputBlock['source']
    attachments?: AttachmentMetadata[]
    teamMention?: TeamMentionBlock
    durationMs?: number
    usage?: UsageData
    model?: string | null
    review?: CodexReview
}

export type HappyRuntimeExtras = Readonly<{
    messagesVersion: number
    historyVersion: number
}>

function formatCodexReviewText(review: CodexReview): string {
    const lines = ['Codex review']
    if (review.overallCorrectness) {
        lines.push(`Overall: ${review.overallCorrectness}`)
    }
    if (review.overallExplanation) {
        lines.push('', review.overallExplanation)
    }
    if (review.findings.length > 0) {
        lines.push('', 'Findings:')
        for (const finding of review.findings) {
            const priority = finding.priority === null ? '' : `[P${finding.priority}] `
            const location = finding.filePath
                ? ` (${finding.filePath}${finding.lineStart === null ? '' : `:${finding.lineStart}${finding.lineEnd !== null && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''}`})`
                : ''
            lines.push(`- ${priority}${finding.title}${location}`)
            lines.push(`  ${finding.body}`)
        }
    }
    return lines.join('\n')
}

export type BlockWithThreadMessageId = {
    block: ChatBlock
    threadMessageId: string
}

/**
 * Stable, unique IDs for assistant-ui's linear MessageRepository.
 * Uses `${kind}:${block.id}`; suffixes `~1`, `~2`, … when the same kind+id
 * appears more than once (should be rare — indicates duplicate hub rows or
 * a reducer bug, but must not crash the thread).
 *
 * Reuses `{ block, threadMessageId }` objects from `wrapperCache` when the
 * reconciled `block` reference and computed id match, so
 * `useExternalMessageConverter`'s WeakMap caches stay warm across streaming
 * appends.
 */
export function assignThreadMessageIdsWithStableWrappers(
    blocks: readonly ChatBlock[],
    wrapperCache: WeakMap<ChatBlock, BlockWithThreadMessageId>
): BlockWithThreadMessageId[] {
    const seen = new Map<string, number>()
    return blocks.map((block) => {
        const base = `${block.kind}:${block.id}`
        const occurrence = seen.get(base) ?? 0
        seen.set(base, occurrence + 1)
        const threadMessageId = occurrence === 0 ? base : `${base}~${occurrence}`
        const cached = wrapperCache.get(block)
        if (cached?.threadMessageId === threadMessageId) {
            return cached
        }
        const next: BlockWithThreadMessageId = { block, threadMessageId }
        wrapperCache.set(block, next)
        return next
    })
}

export function assignThreadMessageIds(
    blocks: readonly ChatBlock[]
): BlockWithThreadMessageId[] {
    return assignThreadMessageIdsWithStableWrappers(blocks, new WeakMap())
}

export function toThreadMessageLike(block: ChatBlock, threadMessageId: string): ThreadMessageLike {
    if (block.kind === 'team-mention') {
        return {
            role: 'user',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: block.text }],
            metadata: {
                custom: {
                    kind: 'team-mention',
                    localId: block.localId,
                    teamMention: block
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'user-text') {
        return {
            role: 'user',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: block.text }],
            metadata: {
                custom: {
                    kind: 'user',
                    status: block.status,
                    localId: block.localId,
                    originalText: block.originalText,
                    attachments: block.attachments
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'agent-text') {
        return {
            role: 'assistant',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: block.text }],
            metadata: {
                custom: { kind: 'assistant' } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'generated-image') {
        return {
            role: 'assistant',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{
                type: 'tool-call',
                toolCallId: block.id,
                toolName: 'GeneratedImage',
                argsText: '',
                artifact: block
            }],
            metadata: {
                custom: {
                    kind: 'tool',
                    toolCallId: block.id,
                    invokedAt: block.invokedAt ?? null
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'agent-reasoning') {
        return {
            role: 'assistant',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{
                type: 'tool-call',
                toolCallId: reasoningToolCallId(block.id),
                toolName: REASONING_TOOL_NAME,
                argsText: '',
                result: block.text,
                artifact: block
            }],
            metadata: {
                custom: { kind: 'assistant' } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'codex-review') {
        return {
            role: 'assistant',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: formatCodexReviewText(block.review) }],
            metadata: {
                custom: {
                    kind: 'codex-review',
                    invokedAt: block.invokedAt,
                    durationMs: block.durationMs,
                    usage: block.usage,
                    model: block.model,
                    review: block.review
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'agent-event') {
        return {
            role: 'system',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: renderEventLabel(block.event) }],
            metadata: {
                custom: { kind: 'event', event: block.event } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'cli-output') {
        return {
            role: block.source === 'user' ? 'user' : 'assistant',
            id: threadMessageId,
            createdAt: new Date(block.createdAt),
            content: [{ type: 'text', text: block.text }],
            metadata: {
                custom: {
                    kind: 'cli-output',
                    source: block.source,
                    invokedAt: block.invokedAt,
                    durationMs: block.durationMs,
                    usage: block.usage,
                    model: block.model
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    if (block.kind === 'tool-group') {
        const groupBlock: ToolGroupBlock = block
        return {
            role: 'assistant',
            id: threadMessageId,
            createdAt: new Date(groupBlock.createdAt),
            content: [{
                type: 'tool-call',
                toolCallId: groupBlock.id,
                toolName: 'ToolGroup',
                argsText: '',
                artifact: groupBlock
            }],
            metadata: {
                custom: {
                    kind: 'tool',
                    toolCallId: groupBlock.id,
                    invokedAt: groupBlock.invokedAt ?? null
                } satisfies HappyChatMessageMetadata
            }
        }
    }

    const toolBlock: ToolCallBlock = block
    const inputText = safeStringify(toolBlock.tool.input)

    return {
        role: 'assistant',
        id: threadMessageId,
        createdAt: new Date(toolBlock.createdAt),
        content: [{
            type: 'tool-call',
            toolCallId: toolBlock.id,
            toolName: toolBlock.tool.name,
            argsText: inputText,
            result: toolBlock.tool.result,
            isError: toolBlock.tool.state === 'error',
            artifact: toolBlock
        }],
        metadata: {
            custom: { kind: 'tool', toolCallId: toolBlock.id } satisfies HappyChatMessageMetadata
        }
    }
}

type TextMessagePart = { type: 'text'; text: string }

function getTextFromParts(parts: readonly { type: string }[] | undefined): string {
    if (!parts) return ''

    return parts
        .filter((part): part is TextMessagePart => part.type === 'text' && typeof (part as TextMessagePart).text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim()
}

type ExtractedAttachmentMetadata = { __attachmentMetadata: AttachmentMetadata }

function isAttachmentMetadataJson(text: string): ExtractedAttachmentMetadata | null {
    try {
        const parsed = JSON.parse(text) as unknown
        if (parsed && typeof parsed === 'object' && '__attachmentMetadata' in parsed) {
            return parsed as ExtractedAttachmentMetadata
        }
        return null
    } catch {
        return null
    }
}

function extractMessageContent(message: AppendMessage): { text: string; attachments: AttachmentMetadata[] } {
    if (message.role !== 'user') return { text: '', attachments: [] }

    // Extract attachments from attachment content
    const attachments: AttachmentMetadata[] = []
    const otherAttachmentTexts: string[] = []

    const attachmentParts = message.attachments?.flatMap((attachment) => attachment.content ?? []) ?? []
    for (const part of attachmentParts) {
        if (part.type === 'text' && typeof (part as TextMessagePart).text === 'string') {
            const textPart = part as TextMessagePart
            const extracted = isAttachmentMetadataJson(textPart.text)
            if (extracted) {
                attachments.push(extracted.__attachmentMetadata)
            } else {
                otherAttachmentTexts.push(textPart.text)
            }
        }
    }

    const contentText = getTextFromParts(message.content)
    const text = [otherAttachmentTexts.join('\n'), contentText]
        .filter((value) => value.length > 0)
        .join('\n\n')
        .trim()

    return { text, attachments }
}

export function useHappyRuntime(props: {
    session: Session
    blocks: readonly ChatBlock[]
    messagesVersion?: number
    historyVersion?: number
    isSending: boolean
    isRunning?: boolean
    onSendMessage: (text: string, attachments?: AttachmentMetadata[], scheduledAt?: number | null) => void
    onAbort: () => Promise<void>
    attachmentAdapter?: AttachmentAdapter
    allowSendWhenInactive?: boolean
    allowDraftWhileRunning?: boolean
    isAgentRunning?: boolean
    pendingScheduleRef?: React.RefObject<PendingSchedule | null>
}) {
    const isAgentRunning = props.isAgentRunning ?? props.isRunning ?? props.session.thinking

    const threadIdWrapperCacheRef = useRef(
        new WeakMap<ChatBlock, BlockWithThreadMessageId>()
    )
    const blocksWithThreadIds = useMemo(
        () => assignThreadMessageIdsWithStableWrappers(
            props.blocks,
            threadIdWrapperCacheRef.current
        ),
        [props.blocks]
    )

    const convertBlock = useCallback(
        ({ block, threadMessageId }: BlockWithThreadMessageId): ThreadMessageLike => {
            return toThreadMessageLike(block, threadMessageId)
        },
        []
    )

    // Use cached message converter for performance optimization
    // This prevents re-converting all messages on every render
    const convertedMessages = useExternalMessageConverter<BlockWithThreadMessageId>({
        callback: convertBlock,
        messages: blocksWithThreadIds,
        isRunning: isAgentRunning,
    })

    const sessionUnavailable = !props.session.active && !props.allowSendWhenInactive
    const internalSendBlocked = props.isSending
        || sessionUnavailable
        || (props.allowDraftWhileRunning === true && isAgentRunning)

    const onNew = useCallback(async (message: AppendMessage) => {
        if (internalSendBlocked) return
        const { text, attachments } = extractMessageContent(message)
        if (!text && attachments.length === 0) return
        // Resolve pendingSchedule at send time (Date.now()) so preset-type schedules
        // ("5 minutes from now") are relative to the actual send action, not the
        // moment the user clicked the preset button.
        const sendNow = Date.now()
        const scheduledAt = resolvePendingSchedule(props.pendingScheduleRef?.current ?? null, sendNow)
        props.onSendMessage(text, attachments.length > 0 ? attachments : undefined, scheduledAt)
    }, [internalSendBlocked, props.onSendMessage, props.pendingScheduleRef])

    const onCancel = useCallback(async () => {
        await props.onAbort()
    }, [props.onAbort])

    const extras = useMemo<HappyRuntimeExtras>(() => ({
        messagesVersion: props.messagesVersion,
        historyVersion: props.historyVersion
    }), [props.messagesVersion, props.historyVersion])

    // Memoize the adapter to avoid recreating on every render
    // useExternalStoreRuntime may use adapter identity for subscriptions
    const adapter = useMemo(() => ({
        isDisabled: props.allowDraftWhileRunning && isAgentRunning && !sessionUnavailable
            ? false
            : props.isSending || sessionUnavailable,
        isRunning: isAgentRunning,
        messages: convertedMessages,
        extras,
        onNew,
        onCancel,
        adapters: props.attachmentAdapter ? { attachments: props.attachmentAdapter } : undefined,
        unstable_capabilities: { copy: true }
    }), [
        props.session.active,
        props.isSending,
        props.allowSendWhenInactive,
        props.allowDraftWhileRunning,
        isAgentRunning,
        sessionUnavailable,
        convertedMessages,
        extras,
        onNew,
        onCancel,
        props.attachmentAdapter
    ])

    // Note: pendingScheduleRef is intentionally not in the deps above.
    // The ref is read at send time inside onNew (not at render time), so changes
    // to pendingSchedule do not need to invalidate the adapter or re-run onNew.

    return useExternalStoreRuntime(adapter)
}
