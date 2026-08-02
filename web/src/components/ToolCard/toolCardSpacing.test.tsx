import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ToolCallBlock } from '@/chat/types'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { I18nProvider } from '@/lib/i18n-context'

function renderDetailedBash(command: string, state: 'pending' | 'completed' = 'completed') {
    const completed = state === 'completed'
    const block: ToolCallBlock = {
        kind: 'tool-call',
        id: 'tool-1',
        localId: null,
        createdAt: 1_000,
        tool: {
            id: 'tool-1',
            name: 'Bash',
            state,
            input: { command },
            createdAt: 1_000,
            startedAt: completed ? 1_000 : null,
            completedAt: completed ? 1_500 : null,
            description: null,
            result: completed ? 'ok' : undefined,
        },
        children: [],
    }

    render(
        <I18nProvider>
            <ToolCard
                api={{} as ApiClient}
                sessionId="session-1"
                metadata={null}
                disabled={false}
                onDone={() => {}}
                block={block}
            />
        </I18nProvider>
    )

    return screen.getByText('Input').parentElement?.parentElement
}

describe('ToolCard spacing', () => {
    it('renders input section', () => {
        const inlineBody = renderDetailedBash('echo hello && pwd')
        expect(inlineBody).toBeDefined()
    })
})
