import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { AgentReasoningBlock, ChatBlock, ToolCallBlock } from '@/chat/types'
import type { ActivityPart } from '@/components/ToolCard/toolRunModel'
import { ToolRunGroup } from '@/components/ToolCard/ToolRunGroup'
import {
    ToolRunLayoutProvider,
    useToolRunLayout
} from '@/components/ToolCard/toolRunContext'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { en, viVN, zhCN } from '@/lib/locales'

const assistantState = vi.hoisted(() => ({
    parts: [] as ActivityPart[],
    status: { type: 'complete' }
}))

const translationState = vi.hoisted(() => ({
    dictionary: null as Record<string, string> | null,
    locale: 'en' as 'en' | 'vi-VN' | 'zh-CN'
}))

vi.mock('@assistant-ui/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@assistant-ui/react')>()
    return {
        ...actual,
        useAssistantState: (selector: (state: {
            message: {
                content: ActivityPart[]
                parts: ActivityPart[]
                status: { type: string }
            }
        }) => unknown) => selector({
            message: {
                content: assistantState.parts,
                parts: assistantState.parts,
                status: assistantState.status
            }
        })
    }
})

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        locale: translationState.locale,
        t: (key: string, params?: Record<string, string | number>) => {
            const template = translationState.dictionary?.[key]
            if (!template) return `${key}:${params ? JSON.stringify(params) : ''}`
            return template.replace(/\{(\w+)\}/g, (match, name: string) => {
                const value = params?.[name]
                return value === undefined ? match : String(value)
            })
        }
    })
}))

vi.mock('@/components/AssistantChat/context', () => ({
    useHappyChatContext: () => ({
        api: undefined,
        sessionId: 'session-1',
        metadata: null,
        disabled: false,
        onRefresh: vi.fn()
    })
}))

vi.mock('@/components/ToolCard/ToolCard', () => ({
    ToolCard: (props: { displayMode?: string; block: ToolCallBlock }) => (
        <div data-testid="tool-card" data-display-mode={props.displayMode}>
            {props.block.tool.name}
        </div>
    )
}))

type BlockOptions = {
    state?: ToolCallBlock['tool']['state']
    startedAt?: number | null
    completedAt?: number | null
    children?: ChatBlock[]
}

function block(name: string, options: BlockOptions = {}): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: `block-${name}`,
        localId: null,
        createdAt: 1000,
        children: options.children ?? [],
        tool: {
            id: `tool-${name}`,
            name,
            input: {},
            state: options.state ?? 'completed',
            createdAt: 1000,
            startedAt: options.startedAt === undefined ? 1000 : options.startedAt,
            completedAt: options.completedAt === undefined ? 2000 : options.completedAt,
            description: null
        }
    }
}

function reasoning(id: string): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        id,
        localId: null,
        createdAt: 1000,
        text: `${id} body`
    }
}

function part(artifact: unknown): ActivityPart {
    return {
        type: 'tool-call',
        toolCallId: artifact && typeof artifact === 'object' && 'kind' in artifact
            && artifact.kind === 'agent-reasoning' && 'id' in artifact
            ? `reasoning:${String(artifact.id)}`
            : undefined,
        artifact
    }
}

function setMessageParts(parts: ActivityPart[], status: 'running' | 'complete' = 'complete') {
    assistantState.parts = parts
    assistantState.status = { type: status }
}

function toolMessageProps(artifact: ToolCallBlock): ToolCallMessagePartProps {
    return {
        type: 'tool-call',
        toolName: artifact.tool.name,
        toolCallId: artifact.tool.id,
        args: {},
        argsText: '{}',
        artifact,
        result: artifact.tool.result,
        isError: false,
        status: { type: 'complete' },
        addResult: vi.fn(),
        resume: vi.fn()
    }
}

function LayoutProbe(props: { name: string; children: ReactNode }) {
    const layout = useToolRunLayout()
    return (
        <span data-testid={props.name} data-grouped={layout.grouped} data-now={layout.now}>
            {props.children}
        </span>
    )
}

afterEach(() => {
    cleanup()
    translationState.dictionary = null
    translationState.locale = 'en'
    vi.useRealTimers()
})

describe('ToolRunGroup', () => {
    it('groups five reasoning and tool activities in original order with the approved header', () => {
        const first = block('CodexReasoning')
        const terminal = block('Bash')
        const diff = block('CodexDiff')
        const thought = reasoning('reason-middle')
        const patch = block('CodexPatch', { completedAt: 5000 })
        setMessageParts([
            part(first),
            part(terminal),
            part(diff),
            part(thought),
            part(patch)
        ])

        const { container } = render(
            <ToolRunGroup startIndex={0} endIndex={4}>
                <span>reasoning-title</span>
                <span>terminal-child</span>
                <span>diff-child</span>
                <span>reasoning-generic</span>
                <span>patch-child</span>
            </ToolRunGroup>
        )

        const group = screen.getByTestId('tool-run-group')
        const trigger = screen.getByRole('button')
        expect(group).toHaveClass('w-full', 'max-w-[600px]')
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(trigger).toHaveAccessibleName(/tool\.group\.toggleActivities/)
        expect(trigger).toHaveAccessibleDescription(
            'tool.group.totalDuration:{"duration":"tool.duration.seconds:{\\"duration\\":\\"4.0\\"}"}'
        )
        expect(trigger).toHaveTextContent('tool.group.activitiesCompleted:{"count":5}')
        expect(trigger).toHaveTextContent('4.0s')
        expect(trigger).not.toHaveTextContent('Terminal')
        expect(trigger).not.toHaveTextContent('Diff')
        expect(trigger.querySelector('.rounded-full')).toBeNull()
        expect(trigger.querySelector('.h-2.w-2')).toBeNull()
        expect(trigger.querySelector('time')).toBeNull()

        const orderedText = container.textContent ?? ''
        const labels = [
            'reasoning-title',
            'terminal-child',
            'diff-child',
            'reasoning-generic',
            'patch-child'
        ]
        for (const label of labels) {
            expect(screen.getAllByText(label)).toHaveLength(1)
        }
        expect(labels.map((label) => orderedText.indexOf(label))).toEqual(
            [...labels].map((label) => orderedText.indexOf(label)).sort((a, b) => a - b)
        )
    })

    it.each([
        ['English', 'en', en, 'Toggle activity group: 2 activities completed', 'Total duration: 4.0 seconds'],
        ['Vietnamese', 'vi-VN', viVN, 'Mở hoặc đóng nhóm hoạt động: 2 hoạt động đã hoàn tất', 'Tổng thời gian: 4,0 giây'],
        ['Chinese', 'zh-CN', zhCN, '展开或收起活动组：已完成 2 项活动', '总用时：4.0 秒']
    ])('exposes the translated group total as the %s toggle description', (
        _language,
        locale,
        dictionary,
        accessibleName,
        accessibleDescription
    ) => {
        translationState.locale = locale as 'en' | 'vi-VN' | 'zh-CN'
        translationState.dictionary = dictionary
        setMessageParts([
            part(block('Read', { completedAt: 2000 })),
            part(block('Bash', { startedAt: 2500, completedAt: 5000 }))
        ])

        render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )

        expect(screen.getByRole('button', { name: accessibleName }))
            .toHaveAccessibleDescription(accessibleDescription)
    })

    it('renders an internal boundary exactly once between two valid activity groups', () => {
        const before = reasoning('reason-before')
        setMessageParts([
            { type: 'text' },
            part(before),
            part(block('Bash')),
            part(block('Agent')),
            part(block('CodexDiff')),
            part(block('CodexPatch')),
            { type: 'text' }
        ])

        const { container } = render(
            <ToolRunGroup startIndex={1} endIndex={5}>
                <span>reason-before</span>
                <span>terminal-before</span>
                <span>boundary</span>
                <span>diff-after</span>
                <span>patch-after</span>
            </ToolRunGroup>
        )

        for (const text of ['reason-before', 'terminal-before', 'boundary', 'diff-after', 'patch-after']) {
            expect(screen.getAllByText(text)).toHaveLength(1)
        }
        expect(screen.getAllByTestId('tool-run-group')).toHaveLength(2)
        expect(container.textContent).toMatch(
            /reason-before.*terminal-before.*boundary.*diff-after.*patch-after/
        )
    })

    it('uses a mount-only default and keeps children mounted while closed', () => {
        setMessageParts([part(block('Read')), part(block('Bash'))])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        const trigger = screen.getByRole('button')
        const scroller = view.container.querySelector<HTMLElement>('[data-activity-scroll-region]')
        expect(scroller).not.toBeNull()
        if (!scroller) throw new Error('Expected activity scroll region')
        const readChild = screen.getByText('read-child')
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(scroller).toHaveAttribute('hidden')
        expect(scroller).toContainElement(readChild)

        fireEvent.click(trigger)
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(scroller).not.toHaveAttribute('hidden')
        expect(screen.getByText('read-child')).toBe(readChild)

        fireEvent.click(trigger)
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(scroller).toHaveAttribute('hidden')
        expect(screen.getByText('read-child')).toBe(readChild)

        fireEvent.click(trigger)
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(scroller).not.toHaveAttribute('hidden')
        expect(screen.getByText('read-child')).toBe(readChild)

        setMessageParts([
            part(block('Read', { state: 'running', completedAt: null })),
            part(block('Bash', { state: 'running', completedAt: null }))
        ])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('does not auto-close when a mounted running group completes', () => {
        setMessageParts([
            part(block('Read', { state: 'running', completedAt: null })),
            part(block('Bash', { state: 'running', completedAt: null }))
        ])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>body</span>
                <span>tail</span>
            </ToolRunGroup>
        )
        expect(screen.getByTestId('tool-run-group')).toHaveClass('processing-surface')
        expect(screen.getByTestId('tool-run-group')).toHaveAttribute('data-running', 'true')
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')

        setMessageParts([part(block('Read')), part(block('Bash'))])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>body</span>
                <span>tail</span>
            </ToolRunGroup>
        )
        expect(screen.getByTestId('tool-run-group')).toHaveAttribute('data-running', 'false')
        expect(screen.getByTestId('tool-run-group')).not.toHaveClass('processing-surface--running')
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens once when a collapsed completed group starts running again', () => {
        setMessageParts([part(block('Read')), part(block('Bash'))])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        const trigger = screen.getByRole('button')
        expect(trigger).toHaveAttribute('aria-expanded', 'false')

        setMessageParts([
            part(block('Read', { state: 'running', completedAt: null })),
            part(block('Bash', { state: 'running', completedAt: null }))
        ])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        expect(trigger).toHaveAttribute('aria-expanded', 'true')

        fireEvent.click(trigger)
        expect(trigger).toHaveAttribute('aria-expanded', 'false')

        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens when the final generic reasoning is the running message part and stays open on completion', () => {
        const finalReasoning = reasoning('reason-final')
        setMessageParts([
            part(block('Bash')),
            part(finalReasoning)
        ], 'running')
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>terminal</span>
                <span>reasoning</span>
            </ToolRunGroup>
        )
        const trigger = screen.getByRole('button')
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(trigger).toHaveTextContent('tool.group.activitiesRunning:{"count":2}')

        setMessageParts([part(block('Bash')), part(finalReasoning)], 'complete')
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>terminal</span>
                <span>reasoning</span>
            </ToolRunGroup>
        )
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(trigger).toHaveTextContent('tool.group.activitiesCompleted:{"count":2}')
    })

    it('refreshes the shared clock immediately when a completed group becomes active', () => {
        vi.useFakeTimers()
        vi.setSystemTime(3000)
        const read = block('Read', { completedAt: 2000 })
        const bash = block('Bash', { completedAt: 2500 })
        setMessageParts([part(read), part(bash)])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read-child</span>
                <span>bash-child</span>
            </ToolRunGroup>
        )
        fireEvent.click(screen.getByRole('button'))

        vi.setSystemTime(10000)
        const runningReasoning = block('CodexReasoning', {
            state: 'running',
            startedAt: 6000,
            completedAt: null
        })
        setMessageParts([part(read), part(bash), part(runningReasoning)])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={2}>
                <span>read-child</span>
                <span>bash-child</span>
                <HappyToolMessage {...toolMessageProps(runningReasoning)} />
            </ToolRunGroup>
        )

        expect(screen.getByRole('button', { name: 'tool.title.reasoning:' }))
            .toHaveAccessibleDescription(
                'tool.group.activityDuration:{"duration":"tool.duration.seconds:{\\"duration\\":\\"4.0\\"}"}'
            )
    })

    it('shows a live group total, advances each second, and does not reset on append', () => {
        vi.useFakeTimers()
        vi.setSystemTime(61000)
        const first = block('Read', { startedAt: 1000, completedAt: 2000 })
        const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
        setMessageParts([part(first), part(running)])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )

        expect(screen.getByRole('button')).toHaveTextContent('1m 00s')
        expect(screen.getByRole('button')).toHaveTextContent('tool.group.live:')
        act(() => vi.advanceTimersByTime(1000))
        expect(screen.getByRole('button')).toHaveTextContent('1m 01s')

        setMessageParts([part(first), part(block('Grep')), part(running)])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={2}>
                <span>read</span><span>grep</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(screen.getByRole('button')).toHaveTextContent('1m 01s')
    })

    it('freezes the total when the running group completes', () => {
        vi.useFakeTimers()
        vi.setSystemTime(5000)
        const first = block('Read', { startedAt: 1000, completedAt: 2000 })
        const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
        setMessageParts([part(first), part(running)])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(vi.getTimerCount()).toBe(1)

        setMessageParts([part(first), part(block('Bash', {
            startedAt: 2500,
            completedAt: 7500
        }))])
        view.rerender(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(vi.getTimerCount()).toBe(0)
        expect(screen.getByRole('button')).toHaveTextContent('6.5s')
        expect(screen.getByRole('button')).not.toHaveTextContent('tool.group.live:')
        act(() => vi.advanceTimersByTime(3000))
        expect(screen.getByRole('button')).toHaveTextContent('6.5s')

        view.unmount()
        setMessageParts([part(first), part(running)])
        const runningView = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(vi.getTimerCount()).toBe(1)
        runningView.unmount()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('derives elapsed from timestamps after prepend and remount instead of resetting', () => {
        vi.useFakeTimers()
        vi.setSystemTime(61000)
        const first = block('Read', { startedAt: 1000, completedAt: 2000 })
        const running = block('Bash', { state: 'running', startedAt: 2500, completedAt: null })
        setMessageParts([part(first), part(running)])
        const view = render(
            <ToolRunGroup startIndex={0} endIndex={1}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(screen.getByRole('button')).toHaveTextContent('1m 00s')

        setMessageParts([{ type: 'text' }, part(first), part(running)])
        view.rerender(
            <ToolRunGroup startIndex={1} endIndex={2}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(screen.getByRole('button')).toHaveTextContent('1m 00s')

        view.unmount()
        vi.setSystemTime(71000)
        render(
            <ToolRunGroup startIndex={1} endIndex={2}>
                <span>read</span><span>bash</span>
            </ToolRunGroup>
        )
        expect(screen.getByRole('button')).toHaveTextContent('1m 10s')
    })

    it('keeps the header outside a named scroll region and preserves 46 rows in order', () => {
        const tools = Array.from({ length: 46 }, (_, index) => {
            const value = block(index % 2 === 0 ? 'Read' : 'Bash')
            return {
                ...value,
                id: `activity-${index}`,
                tool: { ...value.tool, id: `tool-${index}` }
            }
        })
        setMessageParts(tools.map(part))
        const { container } = render(
            <ToolRunGroup startIndex={0} endIndex={45}>
                {tools.map((tool, index) => (
                    <span key={tool.id} data-activity-id={tool.id}>activity-{index}</span>
                ))}
            </ToolRunGroup>
        )

        const group = screen.getByTestId('tool-run-group')
        const header = screen.getByRole('button')
        const scroller = container.querySelector<HTMLElement>('[data-activity-scroll-region]')
        expect(scroller).not.toBeNull()
        if (!scroller) throw new Error('Expected activity scroll region')
        expect(scroller).toHaveClass(
            'max-h-[min(420px,55vh)]',
            'overflow-y-auto',
            'overscroll-contain'
        )
        expect(scroller.contains(header)).toBe(false)
        expect(group.querySelector('[aria-live]')).toBeNull()
        expect(group).toHaveClass('max-w-[600px]')
        const activityRows = scroller.querySelectorAll('[data-activity-id]')
        expect(container.querySelectorAll('[data-activity-id]')).toHaveLength(46)
        expect(activityRows).toHaveLength(46)
        expect(Array.from(activityRows).map((node) =>
            node.getAttribute('data-activity-id')
        )).toEqual(tools.map((tool) => tool.id))
    })

    it('renders a singleton without a group wrapper', () => {
        setMessageParts([part(block('Read'))])
        const { container } = render(
            <ToolRunGroup startIndex={0} endIndex={0}>
                <span>only</span>
            </ToolRunGroup>
        )

        expect(screen.getByText('only')).toBeInTheDocument()
        expect(container.querySelector('[data-tool-run-group]')).toBeNull()
    })

    it('keeps unknown and child-bearing tools outside the layout provider', () => {
        setMessageParts([
            part({ kind: 'unknown' }),
            part(block('Read', { children: [block('Bash')] })),
            part(block('Bash'))
        ])

        render(
            <ToolRunGroup startIndex={0} endIndex={2}>
                <LayoutProbe name="unknown">unknown</LayoutProbe>
                <LayoutProbe name="children">children</LayoutProbe>
                <LayoutProbe name="single">single</LayoutProbe>
            </ToolRunGroup>
        )

        expect(screen.queryByTestId('tool-run-group')).not.toBeInTheDocument()
        for (const testId of ['unknown', 'children', 'single']) {
            expect(screen.getByTestId(testId)).toHaveAttribute('data-grouped', 'false')
        }
    })
})

describe('HappyToolMessage group layout', () => {
    it('uses group-row for safe singletons and grouped tools but keeps special tools as cards', () => {
        const props = toolMessageProps(block('Read'))
        const standalone = render(<HappyToolMessage {...props} />)
        expect(screen.getByTestId('tool-card')).toHaveAttribute('data-display-mode', 'group-row')
        standalone.unmount()

        render(
            <ToolRunLayoutProvider now={1000}>
                <HappyToolMessage {...props} />
            </ToolRunLayoutProvider>
        )
        expect(screen.getByTestId('tool-card')).toHaveAttribute('data-display-mode', 'group-row')

        cleanup()
        render(<HappyToolMessage {...toolMessageProps(block('Agent'))} />)
        expect(screen.getByTestId('tool-card')).toHaveAttribute('data-display-mode', 'card')
    })

    it('shows an exact grouped Codex reasoning duration from the shared clock', () => {
        const artifact = block('CodexReasoning', { completedAt: 5600 })
        render(
            <ToolRunLayoutProvider now={5600}>
                <HappyToolMessage {...toolMessageProps(artifact)} />
            </ToolRunLayoutProvider>
        )

        expect(screen.getByRole('button', { name: 'tool.title.reasoning:' }))
            .toHaveAccessibleDescription(
                'tool.group.activityDuration:{"duration":"tool.duration.seconds:{\\"duration\\":\\"4.6\\"}"}'
            )
    })

    it('removes outer row padding only for grouped tool and Codex reasoning rows', () => {
        const toolProps = toolMessageProps(block('Read'))
        const standaloneTool = render(<HappyToolMessage {...toolProps} />)
        expect(screen.getByTestId('tool-card').parentElement).toHaveClass('py-1')
        standaloneTool.unmount()

        render(
            <ToolRunLayoutProvider now={1000}>
                <HappyToolMessage {...toolProps} />
            </ToolRunLayoutProvider>
        )
        expect(screen.getByTestId('tool-card').parentElement).not.toHaveClass('py-1')
        cleanup()

        const reasoningProps = toolMessageProps(block('CodexReasoning'))
        const standaloneReasoning = render(<HappyToolMessage {...reasoningProps} />)
        expect(standaloneReasoning.container.querySelector('[data-codex-reasoning]'))
            .toHaveClass('py-1')
        standaloneReasoning.unmount()

        const groupedReasoning = render(
            <ToolRunLayoutProvider now={1000}>
                <HappyToolMessage {...reasoningProps} />
            </ToolRunLayoutProvider>
        )
        expect(groupedReasoning.container.querySelector('[data-codex-reasoning]'))
            .not.toHaveClass('py-1')
    })

    it('shows exact duration for standalone Codex reasoning without a group wrapper', () => {
        const completed = block('CodexReasoning', {
            state: 'completed',
            startedAt: 1000,
            completedAt: 7500
        })
        const view = render(<HappyToolMessage {...toolMessageProps(completed)} />)

        expect(screen.getByText('6.5s')).toBeVisible()
        expect(view.container.querySelector('[data-activity-group]')).toBeNull()
    })
})
