import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentReasoningBlock, ToolCallBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { ToolRunLayoutProvider } from '@/components/ToolCard/toolRunContext'
import { I18nProvider } from '@/lib/i18n-context'
import { REASONING_TOOL_NAME, reasoningToolCallId } from '@/lib/reasoningPart'
import { ReasoningMessagePart } from './ReasoningMessagePart'

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>
}))

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

function harness(children: React.ReactNode) {
    return (
        <I18nProvider>
            <HappyChatProvider value={chatContext}>
                {children}
            </HappyChatProvider>
        </I18nProvider>
    )
}

function reasoning(): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        id: 'reason-1',
        localId: null,
        createdAt: 1000,
        text: 'full reasoning text'
    }
}

function providerCollision(): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'provider-block',
        localId: null,
        createdAt: 1000,
        children: [],
        tool: {
            id: 'provider-call',
            name: REASONING_TOOL_NAME,
            input: { query: 'provider input' },
            state: 'completed',
            createdAt: 1000,
            startedAt: 1000,
            completedAt: 2000,
            description: null,
            result: 'provider result'
        }
    }
}

function props(artifact: unknown, toolCallId: string): ToolCallMessagePartProps {
    return {
        type: 'tool-call',
        toolName: REASONING_TOOL_NAME,
        toolCallId,
        args: {},
        argsText: '',
        artifact,
        result: 'provider result',
        isError: false,
        status: { type: 'complete' },
        addResult: vi.fn(),
        resume: vi.fn()
    }
}

afterEach(cleanup)

describe('ReasoningMessagePart', () => {
    it('renders a valid matching reasoning artifact through ReasoningDisclosure', () => {
        const artifact = reasoning()
        const { container } = render(harness(
            <ReasoningMessagePart {...props(artifact, reasoningToolCallId(artifact.id))} />
        ))

        expect(container.querySelectorAll('[data-hapi-reasoning]')).toHaveLength(1)
        expect(container.querySelector('[data-hapi-reasoning]')).toHaveClass('py-1')
        const toggle = screen.getByRole('button', { name: 'Toggle reasoning' })
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('full reasoning text')).toBeVisible()
    })

    it('renders generic grouped reasoning as a full-width status row without a duration placeholder', () => {
        const artifact = reasoning()
        const { container } = render(harness(
            <ToolRunLayoutProvider now={5600}>
                <ReasoningMessagePart {...props(artifact, reasoningToolCallId(artifact.id))} />
            </ToolRunLayoutProvider>
        ))

        const toggle = screen.getByRole('button', { name: 'Toggle reasoning' })
        expect(toggle).toHaveClass('w-full')
        expect(container.querySelector('[data-hapi-reasoning]')).not.toHaveClass('py-1')
        expect(container.querySelector('[data-reasoning-layout="group-row"]')).not.toHaveClass('border')
        expect(screen.getByRole('status', { name: 'Completed' })).toBeInTheDocument()
        expect(screen.getByText('Completed')).toHaveClass('sr-only')
        expect(screen.queryByLabelText(/activity duration/i)).not.toBeInTheDocument()
        expect(container.querySelector('button button')).toBeNull()
    })

    it('falls back exactly once for a provider tool named HapiReasoning', () => {
        const artifact = providerCollision()
        const { container } = render(harness(
            <ReasoningMessagePart {...props(artifact, artifact.tool.id)} />
        ))

        expect(container.querySelector('[data-hapi-reasoning]')).toBeNull()
        expect(container.querySelectorAll('[data-tool-block-id="provider-block"]')).toHaveLength(1)
        expect(screen.getAllByText(REASONING_TOOL_NAME)).toHaveLength(1)
    })

    it('falls back exactly once when the reasoning tool-call ID does not match', () => {
        const artifact = reasoning()
        const { container } = render(harness(
            <ReasoningMessagePart {...props(artifact, 'reasoning:other')} />
        ))

        expect(container.querySelector('[data-hapi-reasoning]')).toBeNull()
        expect(screen.getAllByText(`Tool: ${REASONING_TOOL_NAME}`)).toHaveLength(1)
        expect(screen.getAllByText('provider result')).toHaveLength(1)
    })
})
