import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { UserBubbleContent, getUserBubbleClassName, shouldShowMessageStatus } from '@/components/AssistantChat/messages/user-bubble'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { TeamMentionMessage } from '@/components/AssistantChat/messages/TeamMentionMessage'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { getConversationMessageAnchorId } from '@/chat/outline'

export function HappyUserMessage() {
    const ctx = useHappyChatContext()
    const { copied, copy } = useCopyToClipboard()
    const role = useAssistantState(({ message }) => message.role)
    const messageId = useAssistantState(({ message }) => message.id)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'user') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const status = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAssistantState(({ message }) => {
        if (message.role !== 'user') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const isTeamMention = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'team-mention'
    })
    const teamMention = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.teamMention ?? null
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    if (role !== 'user') return null
    if (isTeamMention && teamMention) {
        return (
            <MessagePrimitive.Root
                id={getConversationMessageAnchorId(messageId)}
                className="scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <TeamMentionMessage
                    block={teamMention}
                    onOpenTeamChat={() => { window.location.href = `/team-chats/${encodeURIComponent(teamMention.teamChatId)}` }}
                    onReplyToTeam={() => { window.location.href = `/team-chats/${encodeURIComponent(teamMention.teamChatId)}` }}
                    onPostUpdate={() => { window.location.href = `/team-chats/${encodeURIComponent(teamMention.teamChatId)}` }}
                    onViewOriginal={() => { window.location.href = `/team-chats/${encodeURIComponent(teamMention.teamChatId)}` }}
                    onNoAction={() => { void ctx.api.updateTeamMentionStatus(ctx.sessionId, teamMention.requestId, 'no_action').catch(() => undefined) }}
                    onSeen={() => { void ctx.api.updateTeamMentionStatus(ctx.sessionId, teamMention.requestId, 'seen').catch(() => undefined) }}
                />
            </MessagePrimitive.Root>
        )
    }
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const showStatus = shouldShowMessageStatus(status)

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root
                id={getConversationMessageAnchorId(messageId)}
                className="scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <div className="ml-auto w-full max-w-[92%]">
                    <CliOutputBlock text={cliText} />
                </div>
            </MessagePrimitive.Root>
        )
    }

    const hasText = text.length > 0
    const hasAttachments = attachments && attachments.length > 0

    return (
        <MessagePrimitive.Root
            id={getConversationMessageAnchorId(messageId)}
            className={`${getUserBubbleClassName(status)} group/msg scroll-mt-4`}
        >
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    {hasText ? <UserBubbleContent text={text} /> : null}
                    {hasAttachments ? <MessageAttachments attachments={attachments} /> : null}
                </div>
                {(hasText || showStatus) && (
                    <div className="happy-message-actions-first-line flex shrink-0 items-center gap-1">
                        {hasText && (
                            <button
                                type="button"
                                title="Copy"
                                className="rounded-md p-0.5 opacity-60 transition-[opacity,background-color] hover:bg-[var(--app-chat-user-chip-bg)] sm:opacity-0 sm:group-hover/msg:opacity-100"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    copy(text)
                                }}
                            >
                                {copied
                                    ? <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                                    : <CopyIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />}
                            </button>
                        )}
                        {showStatus ? <MessageStatusIndicator status={status} onRetry={onRetry} /> : null}
                    </div>
                )}
            </div>
        </MessagePrimitive.Root>
    )
}
