import { cleanup, render, screen } from '@testing-library/react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { CliOutputBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { I18nProvider } from '@/lib/i18n-context'
import { CliOutputMessagePart } from './CliOutputMessagePart'

const chatContext = {
    api: {} as ApiClient,
    sessionId: 'session-1',
    metadata: null,
    disabled: false,
    onRefresh: () => undefined
}

beforeAll(() => {
    window.matchMedia = vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

function harness(children: React.ReactNode) {
    return (
        <I18nProvider>
            <HappyChatProvider value={chatContext}>
                {children}
            </HappyChatProvider>
        </I18nProvider>
    )
}

function cli(source: CliOutputBlock['source']): CliOutputBlock {
    return {
        kind: 'cli-output',
        id: `cli-${source}`,
        localId: null,
        createdAt: 1000,
        text: 'Exit code: 0\nOutput:\nready',
        source,
        meta: null
    }
}

it('routes a valid CLI artifact to the CLI renderer', () => {
    const artifact = cli('assistant')
    const props = { artifact } as unknown as ToolCallMessagePartProps
    const { container } = render(harness(<CliOutputMessagePart {...props} />))

    expect(container.querySelector('[data-cli-output-part]')).toHaveTextContent('ready')
    expect(screen.queryByText('Tool: HapiCliOutput')).not.toBeInTheDocument()
})

it.each([
    ['a partial assistant CLI artifact', {
        kind: 'cli-output',
        id: 'partial-assistant-cli',
        text: 'partial-cli-text',
        source: 'assistant'
    }],
    ['a user-source CLI artifact', cli('user')]
])('falls back exactly once with provider fields for %s', (_label, artifact) => {
    const { container } = render(harness(
        <CliOutputMessagePart {...({
            artifact,
            toolName: 'HapiCliOutput',
            argsText: '{"query":"needle"}',
            result: 'provider-result',
            isError: true,
            status: { type: 'complete', reason: 'unknown' }
        } as unknown as ToolCallMessagePartProps)} />
    ))

    expect(container.querySelector('[data-cli-output-part]')).toBeNull()
    expect(screen.getAllByText('Tool: HapiCliOutput')).toHaveLength(1)
    expect(screen.getAllByText('{"query":"needle"}')).toHaveLength(1)
    expect(screen.getAllByText('provider-result')).toHaveLength(1)
    expect(screen.getAllByText('Error')).toHaveLength(1)
})
