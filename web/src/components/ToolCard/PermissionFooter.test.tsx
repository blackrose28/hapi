import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import { PermissionFooter } from './PermissionFooter'

const { notification } = vi.hoisted(() => ({
    notification: vi.fn()
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTelegram: false,
        isTouch: false,
        haptic: {
            impact: vi.fn(),
            notification,
            selection: vi.fn()
        }
    })
}))

function makeTool(
    name: string,
    input: unknown,
    permission: ChatToolCall['permission'] = { id: 'permission-1', status: 'pending' }
): ChatToolCall {
    return {
        id: `tool-${name}`,
        name,
        state: 'pending',
        input,
        createdAt: 1,
        startedAt: null,
        completedAt: null,
        description: null,
        result: null,
        permission
    }
}

type PermissionMocks = {
    approvePermission: ReturnType<typeof vi.fn<ApiClient['approvePermission']>>
    denyPermission: ReturnType<typeof vi.fn<ApiClient['denyPermission']>>
    onDone: ReturnType<typeof vi.fn>
}

function renderFooter(tool: ChatToolCall): PermissionMocks {
    const approvePermission = vi.fn<ApiClient['approvePermission']>().mockResolvedValue(undefined)
    const denyPermission = vi.fn<ApiClient['denyPermission']>().mockResolvedValue(undefined)
    const onDone = vi.fn()
    const api = { approvePermission, denyPermission } as unknown as ApiClient

    render(
        <I18nProvider>
            <PermissionFooter
                api={api}
                sessionId="session-1"
                metadata={null}
                tool={tool}
                disabled={false}
                onDone={onDone}
            />
        </I18nProvider>
    )

    return { approvePermission, denyPermission, onDone }
}

type PermissionCase = {
    label: string
    tool: ChatToolCall
    expectedMethod: 'approvePermission' | 'denyPermission'
    expectedArgs: unknown[]
}

const cases: PermissionCase[] = [
    {
        label: 'Allow',
        tool: makeTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1']
    },
    {
        label: 'Allow all edits',
        tool: makeTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', 'acceptEdits']
    },
    {
        label: 'Allow for session',
        tool: makeTool('Read', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { allowTools: ['Read'] }]
    },
    {
        label: 'Deny',
        tool: makeTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'denyPermission',
        expectedArgs: ['session-1', 'permission-1']
    },
    {
        label: 'Yes',
        tool: makeTool('CodexPermission', {}),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'approved' }]
    },
    {
        label: 'Yes for session',
        tool: makeTool('CodexPermission', {}),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'approved_for_session' }]
    },
    {
        label: 'Abort',
        tool: makeTool('CodexPermission', {}),
        expectedMethod: 'denyPermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'abort' }]
    }
]

describe('PermissionFooter', () => {
    beforeEach(() => {
        localStorage.setItem('hapi-lang', 'en')
        notification.mockReset()
    })

    afterEach(() => {
        cleanup()
        localStorage.clear()
    })

    it.each(cases)('keeps the $label payload unchanged', async ({ label, tool, expectedMethod, expectedArgs }) => {
        const mocks = renderFooter(tool)

        fireEvent.click(screen.getByRole('button', { name: label }))

        await waitFor(() => {
            expect(mocks[expectedMethod]).toHaveBeenCalledWith(...expectedArgs)
        })
        expect(notification).toHaveBeenCalledWith('success')
        expect(mocks.onDone).toHaveBeenCalledTimes(1)
    })

    it('keeps Bash session approval scoped to the exact command', async () => {
        const mocks = renderFooter(makeTool('Bash', { command: 'bun test' }))

        fireEvent.click(screen.getByRole('button', { name: 'Allow for session' }))

        await waitFor(() => {
            expect(mocks.approvePermission).toHaveBeenCalledWith(
                'session-1',
                'permission-1',
                { allowTools: ['Bash(bun test)'] }
            )
        })
    })

    it('uses the approved primary and deny visual treatments', () => {
        renderFooter(makeTool('Write', { file_path: '/repo/a.ts' }))

        expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass(
            'rounded-full',
            'min-h-10',
            'bg-[var(--app-primary-action-bg)]',
            'text-[var(--app-primary-action-text)]'
        )
        expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass(
            'border-[var(--app-border)]',
            'text-[var(--app-badge-error-text)]'
        )
    })

    it('disables every visible action while approval is loading', async () => {
        let resolveRequest: (() => void) | undefined
        const mocks = renderFooter(makeTool('Write', { file_path: '/repo/a.ts' }))
        mocks.approvePermission.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveRequest = resolve
        }))

        fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

        await waitFor(() => {
            for (const button of screen.getAllByRole('button')) {
                expect(button).toBeDisabled()
            }
        })
        await act(async () => resolveRequest?.())
    })

    it('shows API rejection with the theme error token and does not finish', async () => {
        const mocks = renderFooter(makeTool('Write', { file_path: '/repo/a.ts' }))
        mocks.approvePermission.mockRejectedValueOnce(new Error('Approval failed'))

        fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

        const error = await screen.findByText('Approval failed')
        expect(error).toHaveClass('text-[var(--app-badge-error-text)]')
        expect(notification).toHaveBeenCalledWith('error')
        expect(mocks.onDone).not.toHaveBeenCalled()
    })

    it('uses the theme error token for a denied reason', () => {
        renderFooter(makeTool(
            'Write',
            { file_path: '/repo/a.ts' },
            { id: 'permission-1', status: 'denied', reason: 'Not allowed' }
        ))

        expect(screen.getByText('Not allowed')).toHaveClass('text-[var(--app-badge-error-text)]')
    })
})
