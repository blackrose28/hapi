import { useMessage, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { ReasoningDisclosure } from '@/components/assistant-ui/reasoning'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useTranslation } from '@/lib/use-translation'
import { isAgentReasoningBlock, reasoningToolCallId } from '@/lib/reasoningPart'
import { useToolRunLayout } from '@/components/ToolCard/toolRunContext'
import { cn } from '@/lib/utils'

export function ReasoningMessagePart(props: ToolCallMessagePartProps) {
    const { t } = useTranslation()
    const layout = useToolRunLayout()
    const message = useMessage({ optional: true })
    const artifact = props.artifact
    const valid = isAgentReasoningBlock(artifact)
        && props.toolCallId === reasoningToolCallId(artifact.id)

    if (!valid) return <HappyToolMessage {...props} />

    const finalPart = message?.content[message.content.length - 1]
    const isStreaming = message?.status?.type === 'running'
        && finalPart?.type === 'tool-call'
        && finalPart.toolCallId === props.toolCallId

    return (
        <div
            data-hapi-reasoning
            className={cn(!layout.grouped && 'py-1', 'min-w-0 max-w-full overflow-x-hidden')}
        >
            <ReasoningDisclosure
                label={t('tool.title.reasoning')}
                ariaLabel={isStreaming ? t('reasoning.streaming') : t('reasoning.toggle')}
                isStreaming={isStreaming}
                presentation={layout.grouped ? 'group-row' : 'standalone'}
                statusLabel={layout.grouped
                    ? t(isStreaming ? 'tool.status.running' : 'tool.status.completed')
                    : undefined}
            >
                <MarkdownRenderer content={artifact.text} />
            </ReasoningDisclosure>
        </div>
    )
}
