import { describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '@/router'

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: () => null,
}))

const sessionChatSources = import.meta.glob('/src/components/SessionChat.tsx', {
    eager: true,
    import: 'default',
    query: '?raw',
}) as Record<string, string>

describe('terminal modal-only navigation', () => {
    it('does not register the legacy session terminal route', () => {
        const router = createAppRouter() as unknown as {
            routesByPath: Record<string, unknown>
        }

        expect(router.routesByPath['/sessions/$sessionId/terminal']).toBeUndefined()
    })

    it('opens terminal from session chat through modal search state', () => {
        const source = sessionChatSources['/src/components/SessionChat.tsx']

        expect(source).not.toContain("to: '/sessions/$sessionId/terminal'")
        expect(source).toContain("modal: 'terminal'")
        expect(source).toContain('modalSessionId: props.session.id')
    })
})
