import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { ReasoningDisclosure, ReasoningGroup } from './reasoning'

const { useMessageMock } = vi.hoisted(() => ({
    useMessageMock: vi.fn()
}))

vi.mock('@assistant-ui/react', () => ({
    useMessage: () => useMessageMock()
}))

function mockMessage(value: {
    status: { type: string }
    content: Array<{ type: string; text?: string }>
}) {
    useMessageMock.mockReturnValue(value)
}

function renderReasoning() {
    return render(
        <I18nProvider>
            <ReasoningGroup><span>Body</span></ReasoningGroup>
        </I18nProvider>
    )
}

function LocalizedGroupRowDisclosure() {
    const { t, locale } = useTranslation()
    const duration = '4.6s'
    const durationValue = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }).format(4.6)
    const title = t('tool.title.reasoning')
    return (
        <ReasoningDisclosure
            label={title}
            ariaLabel={title}
            isStreaming={false}
            presentation="group-row"
            duration={duration}
            durationAriaLabel={t('tool.group.activityDuration', {
                duration: t('tool.duration.seconds', { duration: durationValue })
            })}
            statusLabel={t('tool.status.completed')}
        >
            <span>Body</span>
        </ReasoningDisclosure>
    )
}

describe('ReasoningGroup', () => {
    afterEach(() => {
        cleanup()
        useMessageMock.mockReset()
        localStorage.removeItem('hapi-lang')
    })

    it('renders a compact unboxed disclosure', () => {
        mockMessage({ status: { type: 'complete' }, content: [] })

        const { container } = renderReasoning()

        const trigger = screen.getByRole('button', { name: /reasoning/i })
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(container.querySelector('[data-reasoning-layout="standalone"]')).toHaveClass('my-1')
        expect(trigger).not.toHaveClass('w-full', 'border', 'bg-[var(--app-bg)]')
        expect(container.querySelector('[data-reasoning-body]')).not.toHaveClass('border-l-2')
    })

    it('opens from its semantic button', () => {
        mockMessage({ status: { type: 'complete' }, content: [] })
        renderReasoning()

        const trigger = screen.getByRole('button', { name: /reasoning/i })
        fireEvent.click(trigger)

        expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('auto-opens while streaming and does not close on completion', () => {
        mockMessage({
            status: { type: 'running' },
            content: [{ type: 'reasoning', text: 'Working' }]
        })

        const view = renderReasoning()
        const trigger = screen.getByRole('button', { name: /reasoning in progress/i })

        expect(trigger).toHaveAttribute('aria-expanded', 'true')

        mockMessage({
            status: { type: 'complete' },
            content: [{ type: 'reasoning', text: 'Done' }]
        })
        view.rerender(
            <I18nProvider>
                <ReasoningGroup><span>Body</span></ReasoningGroup>
            </I18nProvider>
        )
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(trigger).toHaveAccessibleName('Toggle reasoning')
    })

    it('links the disclosure to a body hidden from accessibility while collapsed', () => {
        mockMessage({ status: { type: 'complete' }, content: [] })
        const { container } = renderReasoning()

        const trigger = screen.getByRole('button', { name: /reasoning/i })
        const body = container.querySelector('[data-reasoning-body]')
        expect(body).toHaveAttribute('id')
        expect(body).toHaveAttribute('hidden')
        expect(trigger).toHaveAttribute('aria-controls', body?.id)

        fireEvent.click(trigger)
        expect(body).not.toHaveAttribute('hidden')
    })

    it('does not cap or scroll expanded reasoning content', () => {
        mockMessage({ status: { type: 'complete' }, content: [] })
        const { container } = renderReasoning()

        fireEvent.click(screen.getByRole('button', { name: /reasoning/i }))
        const body = container.querySelector('[data-reasoning-body]')
        expect(body).not.toHaveClass('max-h-[5000px]', 'overflow-auto')
        expect(body?.className).not.toMatch(/max-h-/)
    })

    it('disables disclosure and chevron transitions for reduced motion', () => {
        mockMessage({ status: { type: 'complete' }, content: [] })
        const { container } = renderReasoning()

        const trigger = screen.getByRole('button', { name: /reasoning/i })
        const panel = container.querySelector('[data-reasoning-body]')
        const chevron = trigger.querySelector('svg')
        expect(trigger).toHaveClass('motion-reduce:transition-none')
        expect(panel).toHaveClass('motion-reduce:transition-none')
        expect(chevron).toHaveClass('motion-reduce:transition-none')
    })

    it('disables the streaming pulse for reduced motion', () => {
        mockMessage({
            status: { type: 'running' },
            content: [{ type: 'reasoning', text: 'Working' }]
        })
        const { container } = renderReasoning()

        expect(container.querySelector('.animate-pulse')).toHaveClass('motion-reduce:animate-none')
    })
})

describe('ReasoningDisclosure group row', () => {
    afterEach(() => {
        cleanup()
        localStorage.removeItem('hapi-lang')
    })

    it('renders full-width borderless metadata in duration then status order without nested buttons', () => {
        const groupRowProps = {
            label: 'Inspect current structure',
            ariaLabel: 'Toggle reasoning',
            isStreaming: false,
            presentation: 'group-row' as const,
            duration: '4.6s',
            durationAriaLabel: 'Activity duration: 4.6s',
            statusLabel: 'Completed'
        }
        const { container } = render(
            <ReasoningDisclosure {...groupRowProps}>
                <span>Body</span>
            </ReasoningDisclosure>
        )

        const trigger = screen.getByRole('button', { name: 'Toggle reasoning' })
        const duration = trigger.querySelector('.font-mono')
        const status = screen.getByRole('status', { name: 'Completed' })
        expect(trigger).toHaveClass('activity-row', 'min-h-[37px]', 'w-full')
        expect(container.querySelector('[data-reasoning-layout="group-row"]')).not.toHaveClass('my-1')
        expect(trigger).not.toHaveClass('uppercase')
        expect(container.querySelector('[data-reasoning-layout="group-row"]')).not.toHaveClass('border')
        expect(trigger).toHaveAccessibleDescription('Activity duration: 4.6s')
        expect(duration).toHaveAttribute('aria-hidden', 'true')
        expect(duration!.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText('Completed')).toHaveClass('sr-only')
        expect(container.querySelector('button button')).toBeNull()
    })

    it('marks only streaming reasoning rows as current', () => {
        const { rerender } = render(
            <ReasoningDisclosure
                label="Inspecting"
                ariaLabel="Inspecting"
                isStreaming
                presentation="group-row"
            >
                <span>Body</span>
            </ReasoningDisclosure>
        )
        expect(screen.getByRole('button', { name: 'Inspecting' })).toHaveAttribute('data-running', 'true')

        rerender(
            <ReasoningDisclosure
                label="Inspecting"
                ariaLabel="Inspecting"
                isStreaming={false}
                presentation="group-row"
            >
                <span>Body</span>
            </ReasoningDisclosure>
        )
        expect(screen.getByRole('button', { name: 'Inspecting' })).toHaveAttribute('data-running', 'false')
    })

    it.each([
        ['en', 'Reasoning', 'Activity duration: 4.6 seconds'],
        ['vi-VN', 'Lập luận', 'Thời gian hoạt động: 4,6 giây'],
        ['zh-CN', '推理', '活动用时：4.6 秒']
    ] satisfies [Locale, string, string][])('exposes the translated per-activity duration in %s', (
        locale,
        accessibleName,
        accessibleDescription
    ) => {
        localStorage.setItem('hapi-lang', locale)
        render(
            <I18nProvider>
                <LocalizedGroupRowDisclosure />
            </I18nProvider>
        )

        expect(screen.getByRole('button', { name: accessibleName }))
            .toHaveAccessibleDescription(accessibleDescription)
    })

    it('shows exact duration on a standalone Codex reasoning disclosure', () => {
        render(
            <ReasoningDisclosure
                label="Inspecting"
                ariaLabel="Inspecting"
                isStreaming={false}
                duration="4.6s"
                durationAriaLabel="Activity duration: 4.6 seconds"
            >
                <span>Body</span>
            </ReasoningDisclosure>
        )

        expect(screen.getByText('4.6s')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Inspecting' }))
            .toHaveAccessibleDescription('Activity duration: 4.6 seconds')
    })
})
