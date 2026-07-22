import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ToolCallBlock } from '@/chat/types'
import { ChecklistList, extractTodoChecklist, extractUpdatePlanChecklist, getChecklistProgress } from '@/components/ToolCard/checklist'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolFullViewComponent, getToolViewComponent } from '@/components/ToolCard/views/_all'
import { UpdatePlanView } from '@/components/ToolCard/views/UpdatePlanView'
import { I18nProvider } from '@/lib/i18n-context'
import en from '@/lib/locales/en'
import viVN from '@/lib/locales/vi-VN'
import zhCN from '@/lib/locales/zh-CN'

afterEach(() => cleanup())

const fiveSteps = [
    { step: 'A', status: 'completed' },
    { step: 'B', status: 'completed' },
    { step: 'C', status: 'completed' },
    { step: 'D', status: 'in_progress' },
    { step: 'E', status: 'pending' }
]

function makeUpdatePlanBlock(input: unknown, result?: unknown): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'tool-1',
        localId: null,
        createdAt: 0,
        tool: {
            id: 'tool-1',
            name: 'update_plan',
            state: 'completed',
            input,
            createdAt: 0,
            startedAt: 0,
            completedAt: 0,
            description: null,
            result
        },
        children: []
    }
}

describe('extractUpdatePlanChecklist', () => {
    it('prefers input.plan over result.plan', () => {
        const items = extractUpdatePlanChecklist(
            {
                plan: [
                    { step: 'Patch root cause', status: 'completed' }
                ]
            },
            {
                plan: [
                    { step: 'Result fallback', status: 'pending' }
                ]
            }
        )

        expect(items).toEqual([
            { text: 'Patch root cause', status: 'completed', id: undefined }
        ])
    })

    it('falls back to result.plan when input.plan is absent', () => {
        const items = extractUpdatePlanChecklist(
            {},
            {
                plan: [
                    { step: 'Re-run build validation', status: 'in_progress' }
                ]
            }
        )

        expect(items).toEqual([
            { text: 'Re-run build validation', status: 'in_progress', id: undefined }
        ])
    })

    it('keeps valid steps and normalizes unknown status to pending', () => {
        const items = extractUpdatePlanChecklist(
            {
                plan: [
                    { step: 'Summarize fix', status: 'unknown_status' },
                    { step: 123, status: 'completed' },
                    { status: 'pending' }
                ]
            },
            null
        )

        expect(items).toEqual([
            { text: 'Summarize fix', status: 'pending', id: undefined }
        ])
    })
})

describe('extractTodoChecklist', () => {
    it('uses result.newTodos when input.todos is unavailable', () => {
        const items = extractTodoChecklist(
            null,
            {
                newTodos: [
                    { id: 'todo-1', content: 'Ship it', status: 'completed' }
                ]
            }
        )

        expect(items).toEqual([
            { id: 'todo-1', text: 'Ship it', status: 'completed' }
        ])
    })
})

describe('update_plan tool presentation', () => {
    it('shows plan title, step count, and expanded body when steps exist', () => {
        const presentation = getToolPresentation({
            toolName: 'update_plan',
            input: {
                plan: [
                    { step: 'Reproduce web build failure', status: 'completed' },
                    { step: 'Trace broken build path', status: 'completed' }
                ]
            },
            result: undefined,
            childrenCount: 0,
            description: null,
            metadata: null
        })

        expect(presentation.title).toBe('Plan')
        expect(presentation.subtitle).toBe('2 steps')
        expect(presentation.minimal).toBe(false)
    })

    it('stays minimal when there are no valid steps', () => {
        const presentation = getToolPresentation({
            toolName: 'update_plan',
            input: { plan: [{ status: 'completed' }] },
            result: undefined,
            childrenCount: 0,
            description: null,
            metadata: null
        })

        expect(presentation.subtitle).toBeNull()
        expect(presentation.minimal).toBe(true)
    })
})

describe('UpdatePlanView', () => {
    it('renders checklist rows with status styling', () => {
        render(
            <I18nProvider>
                <UpdatePlanView
                    block={makeUpdatePlanBlock({
                        plan: [
                            { step: 'Reproduce web build failure', status: 'completed' },
                            { step: 'Trace broken build path', status: 'in_progress' },
                            { step: 'Summarize fix', status: 'unknown_status' }
                        ]
                    })}
                    metadata={null}
                />
            </I18nProvider>
        )

        const completed = screen.getByText(/Reproduce web build failure/)
        const inProgress = screen.getByText(/Trace broken build path/)
        const pending = screen.getByText(/Summarize fix/)

        expect(completed).toBeInTheDocument()
        expect(completed.className).toContain('line-through')
        expect(inProgress.className).toContain('text-[var(--app-link)]')
        expect(pending.className).toContain('text-[var(--app-hint)]')
    })

    it('is registered as the compact tool view', () => {
        expect(getToolViewComponent('update_plan')).toBe(UpdatePlanView)
    })

    it('calculates rounded checklist progress', () => {
        expect(getChecklistProgress([
            { text: 'A', status: 'completed' },
            { text: 'B', status: 'completed' },
            { text: 'C', status: 'in_progress' }
        ])).toEqual({ completed: 2, total: 3, percent: 67 })
    })

    it('shows progress and at most three rows inline', () => {
        render(
            <I18nProvider>
                <UpdatePlanView
                    block={makeUpdatePlanBlock({ plan: fiveSteps })}
                    metadata={null}
                    surface="inline"
                />
            </I18nProvider>
        )

        expect(screen.getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute(
            'aria-valuenow',
            '60'
        )
        expect(screen.getByText('3 / 5 steps')).toBeInTheDocument()
        expect(screen.getByText('60%')).toBeInTheDocument()
        expect(screen.getByText('+2 more')).toBeInTheDocument()
        expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('shows every row in the dialog and is registered as the full view', () => {
        render(
            <I18nProvider>
                <UpdatePlanView
                    block={makeUpdatePlanBlock({ plan: fiveSteps })}
                    metadata={null}
                    surface="dialog"
                />
            </I18nProvider>
        )

        expect(screen.getAllByRole('listitem')).toHaveLength(5)
        expect(screen.queryByText('+2 more')).not.toBeInTheDocument()
        expect(getToolFullViewComponent('update_plan')).toBe(UpdatePlanView)
    })

    it('defines every new plan and diff count label in all locales', () => {
        const dictionaries: Array<Record<string, string>> = [en, viVN, zhCN]
        const keys = ['tool.planProgress', 'tool.stepsProgress', 'tool.moreItems', 'tool.moreFiles']

        for (const dictionary of dictionaries) {
            for (const key of keys) {
                expect(dictionary[key]).toEqual(expect.any(String))
                expect(dictionary[key].trim().length).toBeGreaterThan(0)
            }
        }
    })
})

describe('ChecklistList', () => {
    it('renders blank steps as empty placeholders', () => {
        render(
            <ChecklistList
                items={[
                    { text: '   ', status: 'pending' }
                ]}
            />
        )

        expect(screen.getByText(/\(empty\)/)).toBeInTheDocument()
        expect(screen.getByRole('list')).toBeInTheDocument()
        expect(screen.getByRole('listitem')).toBeInTheDocument()
    })
})
