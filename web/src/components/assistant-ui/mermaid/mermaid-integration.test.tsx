import { TextMessagePartProvider } from '@assistant-ui/react'
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@assistant-ui/react', async () => {
    const React = await import('react')
    const TextContext = React.createContext('')
    return {
        TextMessagePartProvider: ({ text, children }: { text: string; children: React.ReactNode }) => (
            <TextContext.Provider value={text}>{children}</TextContext.Provider>
        ),
        useMessagePartText: () => ({
            text: React.useContext(TextContext),
            status: { type: 'complete' as const },
        }),
    }
})

vi.mock('@assistant-ui/react-markdown', async () => {
    const React = await import('react')
    const { useMessagePartText } = await import('@assistant-ui/react')
    type PrimitiveProps = {
        componentsByLanguage?: Record<string, { SyntaxHighlighter?: React.ComponentType<SyntaxHighlighterProps> }>
        className?: string
    }
    function MarkdownTextPrimitive({ componentsByLanguage, className }: PrimitiveProps) {
        const { text } = useMessagePartText()
        const match = text.match(/^```(\w*)\n([\s\S]*?)\n```$/)
        const language = match?.[1] ?? ''
        const code = match?.[2] ?? text
        const Override = componentsByLanguage?.[language]?.SyntaxHighlighter
        if (!Override) return <pre className={className}>{code}</pre>
        return (
            <Override
                language={language}
                code={code}
                components={{
                    Pre: (props) => <pre {...props} />,
                    Code: (props) => <code {...props} />,
                }}
            />
        )
    }
    return {
        MarkdownTextPrimitive,
        unstable_memoizeMarkdownComponents: <T,>(components: T) => components,
        useIsMarkdownCodeBlock: () => true,
    }
})

vi.mock('./MermaidBlock', () => ({
    MermaidBlock: ({ code }: SyntaxHighlighterProps) => <div data-testid="mermaid-block">{code}</div>,
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))

function renderMarkdown(text: string) {
    return render(
        <I18nProvider>
            <TextMessagePartProvider text={text}>
                <MarkdownText />
            </TextMessagePartProvider>
        </I18nProvider>,
    )
}

function rerenderMarkdown(rerender: ReturnType<typeof render>['rerender'], text: string): void {
    rerender(
        <I18nProvider>
            <TextMessagePartProvider text={text}>
                <MarkdownText />
            </TextMessagePartProvider>
        </I18nProvider>,
    )
}

describe('Mermaid Markdown routing', () => {
    afterEach(cleanup)

    it('routes lowercase mermaid fences to MermaidBlock', () => {
        renderMarkdown('```mermaid\nflowchart LR\nA-->B\n```')
        expect(screen.getByTestId('mermaid-block')).toHaveTextContent('flowchart LR')
    })

    it('keeps other and unlabeled fences on the existing code path', () => {
        const { rerender } = renderMarkdown('```ts\nconst x = 1\n```')
        expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
        rerenderMarkdown(rerender, '```\nflowchart LR\n```')
        expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
        rerenderMarkdown(rerender, '```Mermaid\nflowchart LR\n```')
        expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
    })

    it('does not enable Mermaid in generic MarkdownRenderer surfaces', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer content={'```mermaid\nflowchart LR\n```'} />
            </I18nProvider>,
        )
        expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
    })
})
