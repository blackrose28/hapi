import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import { CodexPatchView } from './CodexPatchView'

const arrayPayload = {
    changes: [{
        path: '/workspace/docs/plan.md',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new'
    }]
}

function makePatchBlock(input: unknown): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'patch-block',
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: 'patch-tool',
            name: 'CodexPatch',
            input,
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: '0',
            result: { success: true }
        }
    }
}

function renderPatch(input: unknown) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            <CodexPatchView
                block={makePatchBlock(input)}
                metadata={null}
                surface="dialog"
            />
        </I18nProvider>
    )
}

describe('CodexPatchView', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => cleanup())

    it('renders the real array payload with the full path available', () => {
        renderPatch(arrayPayload)

        expect(screen.getByText('plan.md')).toHaveAttribute(
            'title',
            '/workspace/docs/plan.md'
        )
    })

    it('renders an explicit fallback instead of blank details', () => {
        renderPatch({ changes: [] })

        expect(screen.getByText('Patch details unavailable')).toHaveClass(
            'text-[var(--app-hint)]'
        )
    })
})
