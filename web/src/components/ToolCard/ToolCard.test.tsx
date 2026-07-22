import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ToolCallBlock, ToolPermission } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import en from '@/lib/locales/en'
import viVN from '@/lib/locales/vi-VN'
import zhCN from '@/lib/locales/zh-CN'
import { getToolPresentation } from './knownTools'
import { ToolCard } from './ToolCard'
import { ToolRunLayoutProvider } from './toolRunContext'

vi.mock('@/components/ToolCard/PermissionFooter', () => ({
    PermissionFooter: () => <div data-testid="permission-actions" />
}))
vi.mock('@/components/ToolCard/AskUserQuestionFooter', () => ({
    AskUserQuestionFooter: () => null
}))
vi.mock('@/components/ToolCard/RequestUserInputFooter', () => ({
    RequestUserInputFooter: () => null
}))
vi.mock('@/components/CodeBlock', () => ({
    CodeBlock: ({ code, collapseLongContent }: { code: string; collapseLongContent?: boolean }) => (
        <pre data-collapse-long-content={String(collapseLongContent === true)}>{code}</pre>
    )
}))

const oneFileDiff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new'
].join('\n')

const arrayPatchPayload = {
    changes: [{
        path: '/workspace/docs/plan.md',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new'
    }]
}

const fourFilePatchPayload = {
    changes: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({
        path: `/workspace/src/${path}`,
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new'
    }))
}

const pendingPermission = {
    id: 'permission-1',
    status: 'pending'
} satisfies ToolPermission

const api = {} as ApiClient

function makeToolBlock(
    name: string,
    input: unknown = {},
    permission?: ToolPermission,
    overrides: Partial<ToolCallBlock['tool']> = {}
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: `block-${name}`,
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: `tool-${name}`,
            name,
            input,
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null,
            permission,
            ...overrides
        }
    }
}

function toolCardElement(
    block: ToolCallBlock,
    displayMode: 'card' | 'group-row' = 'card',
    groupedNow?: number
) {
    const card = (
        <ToolCard
            api={api}
            sessionId="session-1"
            metadata={null}
            disabled={false}
            onDone={vi.fn()}
            block={block}
            displayMode={displayMode}
        />
    )

    return (
        <I18nProvider>
            {groupedNow === undefined
                ? card
                : <ToolRunLayoutProvider now={groupedNow}>{card}</ToolRunLayoutProvider>}
        </I18nProvider>
    )
}

function renderTool(
    block: ToolCallBlock,
    options: {
        locale?: 'en' | 'vi-VN' | 'zh-CN'
        displayMode?: 'card' | 'group-row'
        groupedNow?: number
    } = {}
) {
    localStorage.setItem('hapi-lang', options.locale ?? 'en')
    return render(toolCardElement(block, options.displayMode, options.groupedNow))
}

describe('ToolCard presentation hierarchy', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    it.each([
        ['Read', 'neutral'],
        ['mcp__server__tool', 'neutral'],
        ['update_plan', 'plan'],
        ['TodoWrite', 'plan'],
        ['ExitPlanMode', 'plan'],
        ['exit_plan_mode', 'plan'],
        ['CodexDiff', 'diff'],
        ['CodexPatch', 'neutral'],
        ['Edit', 'diff'],
        ['MultiEdit', 'diff'],
        ['Write', 'diff'],
        ['NotebookEdit', 'diff']
    ] as const)('maps %s to %s', (toolName, expectedTone) => {
        const presentation = getToolPresentation({
            toolName,
            input: {},
            result: null,
            childrenCount: 0,
            description: null,
            metadata: null
        })

        expect(presentation.tone).toBe(expectedTone)
    })

    it('localizes built-in tool titles through the selected dictionary', () => {
        const translations: Record<string, string> = {
            'tool.title.applyChanges': 'Áp dụng thay đổi',
            'tool.title.terminal': 'Dòng lệnh',
            'tool.title.reasoning': 'Lập luận',
            'tool.title.diff': 'Thay đổi',
            'tool.title.plan': 'Kế hoạch',
            'tool.title.readFile': 'Đọc tệp'
        }
        const t = (key: string) => translations[key] ?? key
        const presentationFor = (toolName: string) => getToolPresentation({
            toolName,
            input: {},
            result: null,
            childrenCount: 0,
            description: null,
            metadata: null,
            t
        }).title

        expect(presentationFor('CodexPatch')).toBe('Áp dụng thay đổi')
        expect(presentationFor('CodexBash')).toBe('Dòng lệnh')
        expect(presentationFor('CodexReasoning')).toBe('Lập luận')
        expect(presentationFor('CodexDiff')).toBe('Thay đổi')
        expect(presentationFor('update_plan')).toBe('Kế hoạch')
        expect(presentationFor('Read')).toBe('Đọc tệp')
    })

    it('lets pending approval override the underlying diff tone', () => {
        const { container } = renderTool(makeToolBlock('Write', {}, pendingPermission))

        expect(container.querySelector('[data-tool-surface="permission"]')).not.toBeNull()
    })

    it.each([
        ['Read', 'neutral'],
        ['mcp__server__tool', 'neutral'],
        ['Task', 'neutral'],
        ['Agent', 'neutral'],
        ['Skill', 'neutral'],
        ['update_plan', 'plan'],
        ['CodexDiff', 'diff'],
        ['Read', 'error'],
        ['AskUserQuestion', 'question'],
        ['request_user_input', 'question']
    ] as const)('uses the premium standalone shell for %s', (name, tone) => {
        const overrides = tone === 'error' ? { state: 'error' as const } : {}
        const { container } = renderTool(makeToolBlock(
            name,
            name.includes('Question') ? { questions: [] } : {},
            undefined,
            overrides
        ))
        const card = container.querySelector(`[data-tool-surface="${tone}"]`)

        expect(card).toHaveClass(
            'processing-card',
            'w-full',
            'max-w-[600px]',
            'rounded-[15px]'
        )
        expect(card?.querySelector('.processing-card__orb')).toHaveAttribute('aria-hidden', 'true')
    })

    it.each([
        ['completed', 'en', 'Completed'],
        ['running', 'en', 'Running'],
        ['error', 'en', 'Error'],
        ['completed', 'vi-VN', 'Đã hoàn tất'],
        ['running', 'vi-VN', 'Đang chạy'],
        ['error', 'vi-VN', 'Lỗi']
    ] as const)(
        'includes the localized %s state in the standalone trigger name for %s',
        (state, locale, stateLabel) => {
            const { container } = renderTool(
                makeToolBlock('Read', {}, undefined, { state }),
                { locale }
            )

            expect(container.querySelector('[data-tool-card-trigger]'))
                .toHaveAccessibleName(new RegExp(stateLabel))
        }
    )

    it('keeps pending approval amber instead of the underlying diff tone', () => {
        const { container } = renderTool(makeToolBlock('Write', {}, pendingPermission))

        expect(container.querySelector('[data-tool-surface="permission"]')).not.toBeNull()
        expect(container.querySelector('[data-tool-surface="diff"]')).toBeNull()
    })

    it('uses one compact trigger hit area without stacked header padding', () => {
        const { container } = renderTool(makeToolBlock('Read'))
        const card = container.querySelector('[data-tool-surface="neutral"]')
        const cardHeader = card?.firstElementChild
        const trigger = card?.querySelector('[data-tool-card-trigger]')

        expect(cardHeader).toHaveClass('p-0')
        expect(cardHeader).not.toHaveClass('px-3')
        expect(cardHeader).not.toHaveClass('py-2.5')
        expect(trigger).toHaveClass('min-h-[50px]', 'px-3', 'py-2')
    })

    it('treats error as terminal and removes stale pending approval actions', () => {
        const { container } = renderTool(makeToolBlock('Write', {}, pendingPermission, {
            state: 'error'
        }))

        expect(container.querySelector('[data-tool-surface="error"]')).not.toBeNull()
        expect(container.querySelector('[data-tool-surface="permission"]')).toBeNull()
        expect(screen.queryByText('Permission required')).not.toBeInTheDocument()
        expect(screen.queryByTestId('permission-actions')).not.toBeInTheDocument()
    })

    it('shows compact plan progress in the header without removing the checklist', () => {
        renderTool(makeToolBlock('update_plan', {
            plan: [
                { step: 'Done', status: 'completed' },
                { step: 'Next', status: 'pending' }
            ]
        }))

        expect(screen.getByText('50% · 1/2')).toHaveAccessibleName('1 / 2 steps')
        expect(screen.getByText(/Done/)).toBeInTheDocument()
        expect(screen.getByText(/Next/)).toBeInTheDocument()
    })

    it('adds the ambient processing edge only while a standalone card is running', () => {
        const completed = renderTool(makeToolBlock('Read'))
        expect(completed.container.querySelector('[data-tool-surface="neutral"]'))
            .not.toHaveClass('processing-surface--running')
        completed.unmount()

        const running = renderTool(makeToolBlock('Read', {}, undefined, { state: 'running' }))
        expect(running.container.querySelector('[data-tool-surface="neutral"]'))
            .toHaveClass('processing-surface--running')
    })

    it.each(['AskUserQuestion', 'request_user_input'])(
        'does not mislabel pending %s as a security permission',
        (name) => {
            const { container } = renderTool(makeToolBlock(name, { questions: [] }, pendingPermission))

            expect(container.querySelector('[data-tool-surface="question"]')).not.toBeNull()
            expect(screen.queryByText('Permission required')).not.toBeInTheDocument()
        }
    )

    it('keeps a question subtitle inside the compact header copy stack', () => {
        renderTool(makeToolBlock('request_user_input', {
            questions: [{
                id: 'density',
                question: 'Choose the preferred processing-card density',
                options: []
            }]
        }))

        const title = screen.getByText('density')
        const subtitle = screen.getByText('Choose the preferred processing-card density')
        expect(title.parentElement).toContainElement(subtitle)
        expect(title.parentElement).toHaveClass('flex', 'flex-col', 'items-start')
        expect(title).not.toHaveClass('max-w-[55%]')
        expect(subtitle).toHaveClass('truncate')
    })

    it('uses the subtitle and duration as descriptions instead of bloating the trigger name', () => {
        const { container } = renderTool(makeToolBlock('Bash', { command: 'bun run build:web' }, undefined, {
            state: 'completed',
            startedAt: 1000,
            completedAt: 5600
        }))
        const trigger = container.querySelector('[data-tool-card-trigger]')

        expect(trigger).toHaveAccessibleName('Terminal Completed')
        expect(trigger).toHaveAccessibleDescription('bun run build:web Activity duration: 4.6 seconds')
    })

    it('uses exact localized timing for a running standalone card without a createdAt fallback', () => {
        vi.useFakeTimers()
        vi.setSystemTime(5600)
        const running = renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
            state: 'running',
            startedAt: 1000,
            completedAt: null
        }), { locale: 'vi-VN' })

        expect(screen.getByText('4.6s')).toHaveAccessibleName('Thời gian hoạt động: 4,6 giây')
        running.unmount()

        renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
            state: 'running',
            startedAt: null,
            completedAt: null
        }), { locale: 'vi-VN' })
        expect(screen.queryByText(/s$/)).not.toBeInTheDocument()
    })

    it('keeps a singleton neutral tool inside a subtle visible surface', () => {
        const { container } = renderTool(makeToolBlock('Read'))
        const card = container.querySelector('[data-tool-surface="neutral"]')

        expect(card).toHaveClass(
            'border-[var(--app-border)]',
            'bg-[var(--app-secondary-bg)]'
        )
        expect(screen.getByRole('button', { name: /read/i })).toHaveClass(
            'hover:bg-[var(--app-subtle-bg)]'
        )
    })

    it('shows explicit artifact actions', () => {
        const { rerender } = renderTool(makeToolBlock('update_plan', {
            plan: [{ step: 'Ship', status: 'pending' }]
        }))

        expect(screen.getByText('Open plan')).toBeInTheDocument()
        rerender(toolCardElement(makeToolBlock('CodexDiff', { unified_diff: oneFileDiff })))
        expect(screen.getByText('Review diff')).toBeInTheDocument()
    })

    it('treats Apply changes as neutral without Review diff or subtitle 0', () => {
        const { container } = renderTool(makeToolBlock(
            'CodexPatch',
            arrayPatchPayload,
            undefined,
            { description: '0' }
        ))

        expect(container.querySelector('[data-tool-surface="neutral"]')).not.toBeNull()
        expect(screen.queryByText('Review diff')).not.toBeInTheDocument()
        expect(screen.queryByText('0')).not.toBeInTheDocument()
        expect(screen.getByText('plan.md')).toBeInTheDocument()
    })

    it('opens affected files and result from an Apply changes card', () => {
        renderTool(makeToolBlock(
            'CodexPatch',
            arrayPatchPayload,
            undefined,
            { result: { success: true } }
        ))

        fireEvent.click(screen.getByRole('button', { name: /apply changes/i }))

        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('plan.md')
        expect(dialog).toHaveTextContent('Result')
    })

    it('uses the selected locale for card title, dialog, and result copy', () => {
        renderTool(
            makeToolBlock('CodexPatch', arrayPatchPayload, undefined, {
                result: { success: true }
            }),
            { locale: 'vi-VN' }
        )

        fireEvent.click(screen.getByRole('button', { name: /Áp dụng thay đổi/i }))

        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('Áp dụng thay đổi')
        expect(dialog).toHaveTextContent('Đầu vào')
        expect(dialog).toHaveTextContent('Kết quả')
        expect(dialog).toHaveTextContent('(không có đầu ra)')
        expect(dialog).toHaveTextContent('JSON thô')
        expect(screen.getByRole('button', { name: 'Đóng' })).toBeVisible()
    })

    it('localizes skill and agent detail/result labels without translating provider content', () => {
        const { rerender } = renderTool(
            makeToolBlock('Skill', {}, undefined, { result: null }),
            { locale: 'vi-VN' }
        )

        fireEvent.click(screen.getByRole('button', { name: /Kỹ năng/i }))
        expect(screen.getByRole('dialog')).toHaveTextContent('Kỹ năng không xác định')
        expect(screen.getByRole('dialog')).toHaveTextContent('Đã tải kỹ năng')

        fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
        rerender(toolCardElement(makeToolBlock('Agent', {
            description: 'Keep this provider text',
            subagent_type: 'reviewer',
            run_in_background: true
        }, undefined, {
            result: 'Async agent launched successfully. agentId: agent-1'
        })))

        fireEvent.click(screen.getByRole('button', { name: /Keep this provider text/i }))
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('Keep this provider text')
        expect(dialog).toHaveTextContent('Loại: reviewer')
        expect(dialog).toHaveTextContent('Chạy nền')
        expect(dialog).toHaveTextContent('Đã khởi chạy agent')
    })

    it('localizes parsed command metadata labels', () => {
        renderTool(makeToolBlock('SomeUnknownTool', { command: 'pwd' }, undefined, {
            result: 'Exit code: 0\nWall time: 1.2 seconds\nOutput:\n/workspace'
        }), { locale: 'vi-VN' })

        fireEvent.click(screen.getByRole('button', { name: /SomeUnknownTool/i }))
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('Mã thoát: 0')
        expect(dialog).toHaveTextContent('Thời gian chạy: 1.2 seconds')
        expect(dialog).toHaveTextContent('/workspace')
    })

    it('localizes structured Codex command metadata', () => {
        renderTool(makeToolBlock('CodexBash', { command: 'pwd' }, undefined, {
            result: {
                stdout: '/workspace\n',
                exit_code: 0,
                status: 'completed'
            }
        }), { locale: 'vi-VN' })

        fireEvent.click(screen.getByRole('button', { name: /Dòng lệnh/i }))
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('Mã thoát: 0')
        expect(dialog).not.toHaveTextContent('exit 0')
    })

    it('uses a permission heading and lock icon for pending approval', () => {
        renderTool(makeToolBlock('Write', {}, pendingPermission))

        const heading = screen.getByText('Permission required')
        expect(heading.parentElement?.parentElement?.querySelector('svg')).not.toBeNull()
    })

    it('preserves the existing dialog trigger', () => {
        renderTool(makeToolBlock('Read'))

        const trigger = screen.getByRole('button', { name: /read/i })
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
        expect(trigger).toHaveAttribute('aria-controls')
    })

    it('keeps no-output rows compact but preserves details dialog', () => {
        const block = makeToolBlock('Read', { file_path: '/tmp/example.ts' })
        const { container } = renderTool(block, { displayMode: 'group-row' })

        expect(screen.queryByRole('button', { name: /show output/i })).not.toBeInTheDocument()
        expect(container.querySelector('[data-tool-display="group-row"]')).toHaveAttribute('data-tool-block-id', block.id)
        fireEvent.click(screen.getByRole('button', { name: /example\.ts/i }))
        expect(screen.getByRole('dialog')).toHaveTextContent('/tmp/example.ts')
    })

    it.each([
        ['completed', { state: 'completed', startedAt: 1000, completedAt: 5600 }],
        ['running', { state: 'running', startedAt: 1000, completedAt: null }]
    ] as const)('shows an exact %s duration from the shared group clock', (_label, timing) => {
        renderTool(makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
            ...timing,
            result: { stdout: 'ready\n', stderr: '', exitCode: 0 }
        }), {
            displayMode: 'group-row',
            groupedNow: 5600
        })

        expect(screen.getByText('4.6s')).toHaveAccessibleName('Activity duration: 4.6 seconds')
    })

    it.each([
        ['en', '21m 04s', 'Activity duration: 21 minutes 4 seconds'],
        ['vi-VN', '21m 04s', 'Thời gian hoạt động: 21 phút 4 giây'],
        ['zh-CN', '21m 04s', '活动用时：21分钟 4秒钟']
    ] as const)('localizes minute duration accessibly in %s', (locale, compact, accessible) => {
        renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
            startedAt: 1000,
            completedAt: 1265000
        }), { locale, displayMode: 'group-row', groupedNow: 1265000 })

        expect(screen.getByText(compact)).toHaveAccessibleName(accessible)
    })

    it.each([
        ['en', '1h 05m', 'Activity duration: 1 hour 5 minutes'],
        ['vi-VN', '1h 05m', 'Thời gian hoạt động: 1 giờ 5 phút'],
        ['zh-CN', '1h 05m', '活动用时：1小时 5分钟']
    ] as const)('localizes hour duration accessibly in %s', (locale, compact, accessible) => {
        renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
            startedAt: 1000,
            completedAt: 3901000
        }), { locale, displayMode: 'group-row', groupedNow: 3901000 })

        expect(screen.getByText(compact)).toHaveAccessibleName(accessible)
    })

    it('advances a running singleton duration across ticks and freezes after completion', () => {
        vi.useFakeTimers()
        vi.setSystemTime(5000)
        const running = makeToolBlock('Read', { file_path: '/tmp/live.ts' }, undefined, {
            state: 'running',
            startedAt: 1000,
            completedAt: null
        })
        const view = renderTool(running, { displayMode: 'group-row' })

        expect(screen.getByText('4.0s')).toBeVisible()
        act(() => vi.advanceTimersByTime(1000))
        expect(screen.getByText('5.0s')).toBeVisible()
        act(() => vi.advanceTimersByTime(1000))
        expect(screen.getByText('6.0s')).toBeVisible()

        view.rerender(toolCardElement({
            ...running,
            tool: { ...running.tool, state: 'completed', completedAt: 7500 }
        }, 'group-row'))
        expect(screen.getByText('6.5s')).toBeVisible()

        act(() => vi.advanceTimersByTime(1000))
        expect(screen.getByText('6.5s')).toBeVisible()
    })

    it('does not reserve a duration placeholder when exact timing is unavailable', () => {
        renderTool(makeToolBlock('Read', { file_path: '/tmp/example.ts' }, undefined, {
            startedAt: null,
            completedAt: 5600
        }), {
            displayMode: 'group-row',
            groupedNow: 5600
        })

        expect(screen.queryByLabelText(/activity duration/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/^(—|0\.0s)$/)).not.toBeInTheDocument()
    })

    it('orders row metadata as title, subtitle, duration, status, then output control', () => {
        const { container } = renderTool(makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
            startedAt: 1000,
            completedAt: 5600,
            result: { stdout: 'ready\n', stderr: '', exitCode: 0 }
        }), {
            displayMode: 'group-row',
            groupedNow: 5600
        })

        const row = container.querySelector('[data-tool-display="group-row"]')
        const title = screen.getByText('Terminal')
        const subtitle = screen.getByText('printf ready')
        const duration = screen.getByText('4.6s')
        const status = screen.getByLabelText('Completed')
        const output = screen.getByRole('button', { name: 'Show output' })
        const ordered = [title, subtitle, duration, status, output]
        const activityRow = container.querySelector('[data-tool-display="group-row"] > div')

        expect(row?.querySelector('button button')).toBeNull()
        expect(activityRow).toHaveClass('activity-row', 'min-h-[37px]')
        expect(container.querySelector('[data-tool-display="group-row"] .activity-orb')).not.toBeNull()
        expect(container.querySelector('[data-tool-display="group-row"] .uppercase')).toBeNull()
        for (let index = 0; index < ordered.length - 1; index += 1) {
            expect(ordered[index]?.compareDocumentPosition(ordered[index + 1]!)
                & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        }
    })

    it('marks only pending and running activity rows as current', () => {
        const running = renderTool(makeToolBlock('Bash', { command: 'pwd' }, undefined, {
            state: 'running',
            completedAt: null
        }), { displayMode: 'group-row' })
        expect(running.container.querySelector('.activity-row')).toHaveAttribute('data-running', 'true')
        running.unmount()

        const completed = renderTool(makeToolBlock('Bash', { command: 'pwd' }), {
            displayMode: 'group-row'
        })
        expect(completed.container.querySelector('.activity-row')).toHaveAttribute('data-running', 'false')
    })

    it('opens terminal output at full width with a 300px cap without internal truncation', () => {
        const { container } = renderTool(makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
            result: { stdout: 'ready\n', stderr: '', exitCode: 0 }
        }), { displayMode: 'group-row' })

        fireEvent.click(screen.getByRole('button', { name: /show output/i }))
        const output = container.querySelector('[data-tool-inline-output]')
        expect(output).toHaveClass('w-full', 'max-h-[300px]', 'overflow-auto')
        expect(output?.querySelector('pre')).toHaveAttribute('data-collapse-long-content', 'false')
    })

    it.each([
        ['literal shell output', 'Done', 'Done'],
        ['nested shell output', { output: { stdout: 'nested-shell-marker', stderr: '' } }, 'nested-shell-marker']
    ])('exposes and renders %s in a grouped Bash row', (_label, result, marker) => {
        const { container } = renderTool(makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
            result
        }), { displayMode: 'group-row' })

        fireEvent.click(screen.getByRole('button', { name: /show output/i }))
        expect(container.querySelector('[data-tool-inline-output]')).toHaveTextContent(marker)
    })

    it.each([
        ['Bash', { stdout: '', stderr: '', message: 'Done' }],
        ['Read', { file: { content: ' ' }, text: 'fallback text' }]
    ])('keeps authoritative blank %s output compact despite fallback fields', (toolName, result) => {
        renderTool(makeToolBlock(toolName, {}, undefined, { result }), {
            displayMode: 'group-row'
        })

        expect(screen.queryByRole('button', { name: /show output/i })).not.toBeInTheDocument()
    })

    it.each([
        {
            label: 'result view',
            block: makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
                result: { stdout: 'lazy-result-marker\n', stderr: '', exitCode: 0 }
            }),
            marker: 'lazy-result-marker'
        },
        {
            label: 'full input view',
            block: makeToolBlock('CodexDiff', {
                unified_diff: [
                    'diff --git a/lazy.ts b/lazy.ts',
                    '--- a/lazy.ts',
                    '+++ b/lazy.ts',
                    '@@ -1 +1 @@',
                    '-old',
                    '+lazy-diff-marker'
                ].join('\n')
            }),
            marker: 'lazy-diff-marker'
        }
    ])('mounts the heavy $label only while group output is expanded', ({ block, marker }) => {
        const { container } = renderTool(block, { displayMode: 'group-row' })
        const trigger = screen.getByRole('button', { name: /show output/i })
        const output = container.querySelector<HTMLElement>('[data-tool-inline-output]')
        const controlledId = trigger.getAttribute('aria-controls')

        expect(output).not.toBeNull()
        expect(output).toHaveAttribute('id', controlledId)
        expect(output).toHaveAttribute('hidden')
        expect(output).not.toHaveTextContent(marker)

        fireEvent.click(trigger)
        expect(output).not.toHaveAttribute('hidden')
        expect(output).toHaveTextContent(marker)

        fireEvent.click(trigger)
        expect(output).toHaveAttribute('hidden')
        expect(output).not.toHaveTextContent(marker)

        fireEvent.click(trigger)
        expect(output).not.toHaveAttribute('hidden')
        expect(output).toHaveTextContent(marker)
    })

    it('shows at most three Apply Changes files inline and every file in its dialog without an empty accordion', () => {
        renderTool(makeToolBlock('CodexPatch', fourFilePatchPayload), { displayMode: 'group-row' })

        expect(screen.getByText('a.ts')).toBeInTheDocument()
        expect(screen.getByText('b.ts')).toBeInTheDocument()
        expect(screen.getByText('c.ts')).toBeInTheDocument()
        expect(screen.queryByText('d.ts')).not.toBeInTheDocument()
        expect(screen.getByText('+1 more files')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /show output/i })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: /apply changes/i }))
        expect(screen.getByRole('dialog')).toHaveTextContent('d.ts')
    })

    it('expands renderer-supported Diff input, including raw malformed input without a result', () => {
        const valid = renderTool(
            makeToolBlock('CodexDiff', { unified_diff: oneFileDiff }),
            { displayMode: 'group-row' }
        )
        const outputButton = screen.getByRole('button', { name: /show output/i })
        expect(outputButton).toHaveAttribute('aria-expanded', 'false')
        expect(outputButton).toHaveAttribute('aria-controls')
        expect(valid.container.querySelector('button button')).toBeNull()
        fireEvent.click(outputButton)
        expect(screen.getByRole('region', { name: /diff output/i })).toHaveTextContent('old')
        valid.unmount()

        const malformed = renderTool(
            makeToolBlock('CodexDiff', { unified_diff: 'not a diff' }),
            { displayMode: 'group-row' }
        )
        fireEvent.click(screen.getByRole('button', { name: /show output/i }))
        expect(screen.getByRole('region', { name: /diff output/i })).toHaveTextContent('not a diff')
        expect(malformed.container.querySelector('button button')).toBeNull()
    })

    it('falls back to meaningful Diff result when malformed input cannot provide a structured view', () => {
        const { container } = renderTool(makeToolBlock('CodexDiff', {
            unified_diff: 'not a diff'
        }, undefined, {
            result: 'result-fallback-marker'
        }), { displayMode: 'group-row' })

        fireEvent.click(screen.getByRole('button', { name: /show output/i }))
        const output = container.querySelector('[data-tool-inline-output]')
        expect(output).toHaveTextContent('result-fallback-marker')
        expect(output).not.toHaveTextContent('not a diff')
    })

    it('lets the group output region scroll long Diff lines without clipping or wrapping', () => {
        const longLine = 'x'.repeat(400)
        const longLineDiff = [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -1 +1 @@',
            '-old',
            `+${longLine}`
        ].join('\n')
        const { container } = renderTool(
            makeToolBlock('CodexDiff', { unified_diff: longLineDiff }),
            { displayMode: 'group-row' }
        )

        fireEvent.click(screen.getByRole('button', { name: /show output/i }))

        const output = container.querySelector('[data-tool-inline-output]')
        const line = screen.getByText(`+ ${longLine}`)
        const diffRoot = line.closest('.rounded-md')
        expect(output).toHaveClass('overflow-auto')
        expect(diffRoot).toHaveClass('overflow-visible')
        expect(diffRoot).not.toHaveClass('overflow-hidden')
        expect(line).toHaveClass('whitespace-pre')
        expect(line).not.toHaveClass('whitespace-pre-wrap')
    })

    it('adds lossless block ids without changing the standalone card surface', () => {
        const block = makeToolBlock('Read')
        const { container } = renderTool(block)

        expect(container.querySelector('[data-tool-surface="neutral"]')).toHaveAttribute('data-tool-block-id', block.id)
        expect(container.querySelector('[data-tool-display="group-row"]')).toBeNull()
    })

    it('does not inspect group-only expansion output for a standalone card', () => {
        const result = {}
        Object.defineProperty(result, 'stdout', {
            get: () => {
                throw new Error('standalone output was classified eagerly')
            }
        })

        expect(() => renderTool(makeToolBlock('Bash', { command: 'true' }, undefined, {
            result
        }))).not.toThrow()
    })

    it('defines every new shell label in all supported locales', () => {
        const dictionaries: Array<Record<string, string>> = [en, viVN, zhCN]
        const keys = [
            'tool.details',
            'tool.openPlan',
            'tool.reviewDiff',
            'tool.permissionRequired',
            'tool.patchDetailsUnavailable',
            'tool.title.applyChanges',
            'tool.title.terminal',
            'tool.title.reasoning',
            'tool.title.diff',
            'tool.title.plan',
            'tool.title.readFile',
            'tool.status.pending',
            'tool.status.running',
            'tool.status.completed',
            'tool.status.error',
            'tool.result.waitingPermission',
            'tool.result.running',
            'tool.result.noOutput',
            'tool.result.done',
            'tool.result.rawJson',
            'tool.result.agentFailed',
            'tool.result.agentLaunched',
            'tool.result.skillLoaded',
            'tool.result.skillLoadFailed',
            'tool.result.skillNamedLoaded',
            'tool.result.exitCode',
            'tool.result.wallTime',
            'tool.detail.unknownSkill',
            'tool.detail.agentType',
            'tool.detail.background',
            'tool.group.activitiesCompleted',
            'tool.group.activitiesRunning',
            'tool.group.toggleActivities',
            'tool.group.live',
            'tool.group.activityDuration',
            'tool.group.totalDuration',
            'tool.duration.seconds',
            'tool.duration.lessThanSeconds',
            'tool.group.showOutput',
            'tool.group.hideOutput',
            'tool.group.outputRegion',
            'reasoning.toggle',
            'reasoning.streaming'
        ]

        for (const dictionary of dictionaries) {
            for (const key of keys) {
                expect(dictionary[key]).toEqual(expect.any(String))
                expect(dictionary[key].trim().length).toBeGreaterThan(0)
            }
        }

        expect(viVN['tool.group.showOutput']).toBe('Hiện kết quả')
        expect(viVN['tool.group.hideOutput']).toBe('Ẩn kết quả')
        expect(viVN['tool.group.outputRegion']).toBe('Kết quả của {tool}')
    })
})
