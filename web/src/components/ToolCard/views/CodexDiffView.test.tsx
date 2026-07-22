import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import {
    CodexDiffCompactView,
    CodexDiffFullView,
    summarizeUnifiedDiff
} from './CodexDiffView'

const { diffViewMock } = vi.hoisted(() => ({
    diffViewMock: vi.fn()
}))

vi.mock('@/components/DiffView', () => ({
    DiffView: (props: Record<string, unknown>) => {
        diffViewMock(props)
        return <div data-testid="diff-view" />
    }
}))

function makeBlock(unifiedDiff: string): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'block-diff',
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: 'tool-diff',
            name: 'CodexDiff',
            state: 'completed',
            input: { unified_diff: unifiedDiff },
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null
        }
    }
}

function fileDiff(path: string, removed: string[], added: string[]): string {
    return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -1,${removed.length} +1,${added.length} @@`,
        ...removed.map((line) => `-${line}`),
        ...added.map((line) => `+${line}`)
    ].join('\n')
}

const twoFileDiff = [
    fileDiff('src/a.ts', ['old a'], ['new a', 'extra a']),
    fileDiff('src/b.ts', ['old b'], ['new b'])
].join('\n')

describe('summarizeUnifiedDiff', () => {
    afterEach(() => {
        cleanup()
        diffViewMock.mockReset()
    })

    it('summarizes additions and removals for one file', () => {
        expect(summarizeUnifiedDiff(fileDiff('src/a.ts', ['old'], ['new', 'extra']))).toEqual({
            added: 2,
            removed: 1,
            files: [{ path: 'src/a.ts', added: 2, removed: 1 }]
        })
    })

    it('summarizes multiple files', () => {
        expect(summarizeUnifiedDiff(twoFileDiff)).toEqual({
            added: 3,
            removed: 2,
            files: [
                { path: 'src/a.ts', added: 2, removed: 1 },
                { path: 'src/b.ts', added: 1, removed: 1 }
            ]
        })
    })

    it.each(['', 'not a diff'])('returns an empty summary for %j', (input) => {
        expect(summarizeUnifiedDiff(input)).toEqual({ added: 0, removed: 0, files: [] })
    })

    it('handles quoted paths and hunk content beginning with +++ or ---', () => {
        const tricky = [
            'diff --git "a/src/a b.ts" "b/src/a b.ts"',
            '--- "a/src/a b.ts"',
            '+++ "b/src/a b.ts"',
            '@@ -1 +1 @@',
            '---old-starts-dashes',
            '+++new-starts-pluses'
        ].join('\n')

        expect(summarizeUnifiedDiff(tricky)).toEqual({
            added: 1,
            removed: 1,
            files: [{ path: 'src/a b.ts', added: 1, removed: 1 }]
        })
    })

    it('renders only three inline file rows and a localized remainder', () => {
        const fourFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
            .map((path) => fileDiff(path, ['old'], ['new']))
            .join('\n')

        render(
            <I18nProvider>
                <CodexDiffCompactView block={makeBlock(fourFiles)} metadata={null} surface="inline" />
            </I18nProvider>
        )

        expect(screen.getAllByRole('listitem')).toHaveLength(3)
        expect(screen.getByText('+1 more files')).toBeInTheDocument()
        expect(screen.getByText('+4')).toBeInTheDocument()
        expect(screen.getByText('-4')).toBeInTheDocument()
    })

    it('leaves malformed compact input as a header-only ToolCard fallback', () => {
        const { container } = render(
            <I18nProvider>
                <CodexDiffCompactView block={makeBlock('not a diff')} metadata={null} surface="inline" />
            </I18nProvider>
        )

        expect(container).toBeEmptyDOMElement()
    })

    it('keeps the existing full DiffView dialog rendering contract', () => {
        render(
            <I18nProvider>
                <CodexDiffFullView block={makeBlock(fileDiff('src/a.ts', ['old'], ['new']))} metadata={null} surface="dialog" />
            </I18nProvider>
        )

        expect(diffViewMock).toHaveBeenCalledWith(expect.objectContaining({
            filePath: 'src/a.ts',
            variant: 'inline',
            overflowMode: 'contained'
        }))
    })

    it('delegates group output overflow to the parent scroll owner', () => {
        render(
            <I18nProvider>
                <CodexDiffFullView
                    block={makeBlock(fileDiff('src/a.ts', ['old'], ['new']))}
                    metadata={null}
                    surface="group-output"
                />
            </I18nProvider>
        )

        expect(diffViewMock).toHaveBeenCalledWith(expect.objectContaining({
            overflowMode: 'parent-scroll'
        }))
    })

    it('renders each file in a multi-file unified diff without flattening their changes', () => {
        render(
            <I18nProvider>
                <CodexDiffFullView block={makeBlock(twoFileDiff)} metadata={null} surface="dialog" />
            </I18nProvider>
        )

        expect(diffViewMock).toHaveBeenCalledTimes(2)
        expect(diffViewMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            filePath: 'src/a.ts',
            oldString: 'old a',
            newString: 'new a\nextra a'
        }))
        expect(diffViewMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            filePath: 'src/b.ts',
            oldString: 'old b',
            newString: 'new b'
        }))
    })

    it('keeps large diffs expanded now that the inline summary is bounded', () => {
        const unifiedDiff = fileDiff('src/large.ts', ['old'], Array.from({ length: 60 }, (_, index) => `new ${index}`))
        const presentation = getToolPresentation({
            toolName: 'CodexDiff',
            input: { unified_diff: unifiedDiff },
            result: null,
            childrenCount: 0,
            description: null,
            metadata: null
        })

        expect(presentation.minimal).toBe(false)
    })
})
