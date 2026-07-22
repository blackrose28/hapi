import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { CliOutputMessagePart } from '@/components/AssistantChat/messages/CliOutputMessagePart'
import { ReasoningMessagePart } from '@/components/AssistantChat/messages/ReasoningMessagePart'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { ToolRunGroup } from '@/components/ToolCard/ToolRunGroup'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { CLI_OUTPUT_TOOL_NAME } from '@/lib/cliOutputPart'
import { REASONING_TOOL_NAME } from '@/lib/reasoningPart'
import { getAssistantCopyText } from '@/components/AssistantChat/messages/assistantCopyText'
import { getConversationMessageAnchorId } from '@/chat/outline'

const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage,
    by_name: {
        [CLI_OUTPUT_TOOL_NAME]: CliOutputMessagePart,
        [REASONING_TOOL_NAME]: ReasoningMessagePart
    }
} as const

const MESSAGE_PART_COMPONENTS = {
    Text: MarkdownText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    ToolGroup: ToolRunGroup,
    tools: TOOL_COMPONENTS
} as const

export function HappyAssistantMessage() {
    const { copied, copy } = useCopyToClipboard()
    const messageId = useAssistantState(({ message }) => message.id)
    const toolOnly = useAssistantState(({ message }) => {
        if (message.role !== 'assistant') return false
        const parts = message.content
        return parts.length > 0 && parts.every((part) => part.type === 'tool-call')
    })
    const copyText = useAssistantState(({ message }) => {
        if (message.role !== 'assistant') return ''
        return getAssistantCopyText(message.content)
    })
    const rootClass = toolOnly
        ? 'py-1 min-w-0 max-w-full overflow-x-hidden'
        : 'px-1 min-w-0 max-w-full overflow-x-hidden'

    return (
        <MessagePrimitive.Root
            id={getConversationMessageAnchorId(messageId)}
            className={`${rootClass} ${copyText ? 'group/msg' : ''} scroll-mt-4`}
        >
            <div className="min-w-0">
                <MessagePrimitive.Content components={MESSAGE_PART_COMPONENTS} />
            </div>
            {copyText && (
                <div className="hidden sm:flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <button
                        type="button"
                        title="Copy"
                        className="p-0.5 rounded hover:bg-[var(--app-subtle-bg)] transition-colors"
                        onClick={() => copy(copyText)}
                    >
                        {copied
                            ? <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                            : <CopyIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />}
                    </button>
                </div>
            )}
        </MessagePrimitive.Root>
    )
}
