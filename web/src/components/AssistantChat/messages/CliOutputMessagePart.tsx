import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { isAssistantCliOutputBlock } from '@/lib/cliOutputPart'

export function CliOutputMessagePart(props: ToolCallMessagePartProps) {
    if (!isAssistantCliOutputBlock(props.artifact)) return <HappyToolMessage {...props} />

    return (
        <div data-cli-output-part className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <CliOutputBlock text={props.artifact.text} />
        </div>
    )
}
