import type { MarkdownTextPrimitiveProps, SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { CodeBlock } from '@/components/CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import { MermaidErrorBoundary } from './MermaidErrorBoundary'

function EmptyMermaidHeader() {
    return null
}

function MermaidCodeBlock(props: SyntaxHighlighterProps) {
    return (
        <MermaidErrorBoundary
            resetKey={props.code}
            fallback={<CodeBlock code={props.code} language="text" />}
        >
            <MermaidBlock {...props} />
        </MermaidErrorBoundary>
    )
}

export const MERMAID_LANGUAGE_COMPONENTS = {
    mermaid: {
        CodeHeader: EmptyMermaidHeader,
        SyntaxHighlighter: MermaidCodeBlock,
    },
} satisfies NonNullable<MarkdownTextPrimitiveProps['componentsByLanguage']>
