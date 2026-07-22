import { describe, expect, it } from 'vitest'
import type {
    AgentReasoningBlock,
    ChatBlock,
    ToolCallBlock,
    ToolPermission
} from '@/chat/types'
import {
    formatActivityDuration,
    formatActivityDurationValue,
    getActivityDurationMs,
    getActivityGroupDurationMs,
    getToolExpansionKind,
    isActivityRunning,
    isToolCallBlock,
    partitionActivityParts,
    type ActivityEntry,
    type ActivityPart
} from '@/components/ToolCard/toolRunModel'
import { reasoningToolCallId } from '@/lib/reasoningPart'

type BlockOptions = {
    input?: unknown
    result?: unknown
    state?: ToolCallBlock['tool']['state']
    startedAt?: number | null
    completedAt?: number | null
    permission?: ToolPermission
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
            input: options.input ?? {},
            state: options.state ?? 'completed',
            createdAt: 1000,
            startedAt: options.startedAt === undefined ? 1000 : options.startedAt,
            completedAt: options.completedAt === undefined ? 2000 : options.completedAt,
            description: null,
            result: options.result,
            permission: options.permission
        }
    }
}

function part(artifact: unknown, options: Partial<ActivityPart> = {}): ActivityPart {
    return { type: 'tool-call', artifact, ...options }
}

function reasoningBlock(id = 'reasoning-1'): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        id,
        localId: null,
        createdAt: 1000,
        text: `Reasoning ${id}`
    }
}

function reasoningPart(
    reasoning = reasoningBlock(),
    options: Partial<ActivityPart> = {}
): ActivityPart {
    return part(reasoning, {
        toolCallId: reasoningToolCallId(reasoning.id),
        ...options
    })
}

function toolEntry(name: string, options: BlockOptions = {}): ActivityEntry {
    return { kind: 'tool', block: block(name, options) }
}

function reasoningEntry(options: {
    id?: string
    isStreaming?: boolean
} = {}): ActivityEntry {
    return {
        kind: 'reasoning',
        block: reasoningBlock(options.id),
        isStreaming: options.isStreaming ?? false
    }
}

const permission = (status: ToolPermission['status']): ToolPermission => ({
    id: `permission-${status}`,
    status
})

describe('activity partitioning', () => {
    it('groups only the exact reasoning and routine-tool allowlist', () => {
        const parts = [
            reasoningPart(),
            part(block('CodexReasoning')),
            part(block('Read')),
            part(block('Grep')),
            part(block('Glob')),
            part(block('Bash')),
            part(block('CodexBash')),
            part(block('CodexPatch')),
            part(block('CodexDiff'))
        ]

        const segments = partitionActivityParts(parts)

        expect(segments).toHaveLength(1)
        expect(segments[0]).toMatchObject({
            kind: 'group',
            id: 'activity-group:reasoning-1',
            startOffset: 0,
            endOffset: 8
        })
        expect(segments[0]?.kind === 'group' && segments[0].entries.map((entry) =>
            entry.kind === 'reasoning' ? 'generic-reasoning' : entry.block.tool.name
        )).toEqual([
            'generic-reasoning',
            'CodexReasoning',
            'Read',
            'Grep',
            'Glob',
            'Bash',
            'CodexBash',
            'CodexPatch',
            'CodexDiff'
        ])
    })

    it.each([
        ['plan', block('update_plan')],
        ['todo', block('TodoWrite')],
        ['exit-plan', block('ExitPlanMode')],
        ['permission-pending', block('Read', { permission: permission('pending') })],
        ['permission-approved', block('Read', { permission: permission('approved') })],
        ['error', block('Read', { state: 'error' })],
        ['children', block('Read', { children: [block('Grep')] })],
        ['Task', block('Task')],
        ['Agent', block('Agent')],
        ['Skill', block('Skill')],
        ['MCP', block('mcp__server__tool')],
        ['unknown', block('UnknownTool')],
        ['HapiCliOutput', block('HapiCliOutput')],
        ['provider HapiReasoning collision', block('HapiReasoning')],
        ['case mismatch', block('read')]
    ])('keeps %s as a hard boundary', (_label, artifact) => {
        const segments = partitionActivityParts([
            part(block('Read')),
            part(artifact),
            part(block('Bash'))
        ])

        expect(segments.map((segment) => [
            segment.kind,
            segment.startOffset,
            segment.endOffset,
            segment.kind === 'single' ? segment.entry : undefined
        ])).toEqual([
            ['single', 0, 0, expect.objectContaining({ kind: 'tool' })],
            ['single', 1, 1, null],
            ['single', 2, 2, expect.objectContaining({ kind: 'tool' })]
        ])
    })

    it.each([
        ['null artifact', null],
        ['missing artifact', undefined],
        ['text-like artifact', {
            kind: 'agent-text',
            id: 'text-1',
            localId: null,
            createdAt: 1000,
            text: 'boundary'
        }],
        ['CLI artifact', {
            kind: 'cli-output',
            id: 'cli-1',
            localId: null,
            createdAt: 1000,
            text: 'boundary',
            source: 'assistant'
        }]
    ])('keeps %s as a lossless single', (_label, artifact) => {
        const segments = partitionActivityParts([
            part(block('Read')),
            part(artifact),
            part(block('Bash'))
        ])

        expect(segments.map((item) => [item.kind, item.startOffset, item.endOffset])).toEqual([
            ['single', 0, 0],
            ['single', 1, 1],
            ['single', 2, 2]
        ])
    })

    it.each([
        ['missing text', (() => {
            const value = { ...reasoningBlock() } as Record<string, unknown>
            delete value.text
            return value
        })()],
        ['non-finite createdAt', { ...reasoningBlock(), createdAt: Number.NaN }],
        ['invalid localId', { ...reasoningBlock(), localId: 42 }],
        ['wrong kind', { ...reasoningBlock(), kind: 'agent-text' }]
    ])('rejects malformed HapiReasoning: %s', (_label, artifact) => {
        const segments = partitionActivityParts([
            reasoningPart(),
            part(artifact, { toolCallId: reasoningToolCallId('reasoning-1') })
        ])

        expect(segments.map((segment) => segment.kind)).toEqual(['single', 'single'])
        expect(segments[1]).toMatchObject({ kind: 'single', entry: null })
    })

    it('rejects a valid reasoning artifact when its stable tool-call ID does not match', () => {
        const segments = partitionActivityParts([
            reasoningPart(reasoningBlock('reasoning-1')),
            reasoningPart(reasoningBlock('reasoning-2'), { toolCallId: 'reasoning:wrong' })
        ])

        expect(segments.map((segment) => segment.kind)).toEqual(['single', 'single'])
        expect(segments[1]).toMatchObject({ kind: 'single', entry: null })
    })

    it('captures presentation-only streaming state for generic reasoning', () => {
        const segments = partitionActivityParts([
            reasoningPart(reasoningBlock('streaming'), { isFinalRunningPart: true })
        ])

        expect(segments[0]).toMatchObject({
            kind: 'single',
            entry: {
                kind: 'reasoning',
                block: { id: 'streaming' },
                isStreaming: true
            }
        })
    })

    it('preserves every offset exactly once across groups and boundaries', () => {
        const parts = [
            reasoningPart(reasoningBlock('reasoning-offset')),
            part(block('Read')),
            part(block('update_plan')),
            part(block('CodexBash')),
            part(block('CodexDiff'))
        ]

        const segments = partitionActivityParts(parts)

        expect(segments.map((segment) => [
            segment.kind,
            segment.startOffset,
            segment.endOffset,
            segment.kind === 'group' ? segment.id : null
        ])).toEqual([
            ['group', 0, 1, 'activity-group:reasoning-offset'],
            ['single', 2, 2, null],
            ['group', 3, 4, 'activity-group:block-CodexBash']
        ])
        expect(segments.flatMap((segment) => Array.from(
            { length: segment.endOffset - segment.startOffset + 1 },
            (_, index) => segment.startOffset + index
        ))).toEqual(parts.map((_, offset) => offset))
    })

    it('recognizes only structurally valid tool-call blocks', () => {
        expect(isToolCallBlock(block('Read'))).toBe(true)
        expect(isToolCallBlock({ ...block('Read'), children: null })).toBe(false)
        expect(isToolCallBlock({ ...block('Read'), tool: { ...block('Read').tool, input: undefined } })).toBe(true)
        const missingInput = { ...block('Read').tool } as Record<string, unknown>
        delete missingInput.input
        expect(isToolCallBlock({ ...block('Read'), tool: missingInput })).toBe(false)
        expect(isToolCallBlock({ ...block('Read'), tool: { ...block('Read').tool, state: 'unknown' } })).toBe(false)
    })
})

describe('tool expansion', () => {
    it('opens structured Read output when file content is meaningful', () => {
        expect(getToolExpansionKind(block('Read', {
            result: { file: { content: 'const ready = true\n', filePath: '/workspace/ready.ts' } }
        }))).toBe('result')
    })

    it('does not bypass an authoritative blank Read file with fallback text', () => {
        expect(getToolExpansionKind(block('Read', {
            result: { file: { content: ' ' }, text: 'fallback text' }
        }))).toBeNull()
    })

    it.each([
        { file: { content: '', filePath: '/workspace/empty.ts' } },
        { file: { content: '   \n', filePath: '/workspace/blank.ts' } },
        { file: { filePath: '/workspace/missing.ts' } },
        { file: null }
    ])('keeps empty structured Read output collapsed for %#', (result) => {
        expect(getToolExpansionKind(block('Read', { result }))).toBeNull()
    })

    it('opens patch results only when their text is meaningful', () => {
        expect(getToolExpansionKind(block('CodexPatch', { result: null }))).toBeNull()
        expect(getToolExpansionKind(block('CodexPatch', { result: 'patched' }))).toBe('result')
        expect(getToolExpansionKind(block('CodexPatch', { result: 'Done' }))).toBeNull()
        expect(getToolExpansionKind(block('CodexPatch', { result: '(no output)' }))).toBeNull()
        expect(getToolExpansionKind(block('CodexPatch', { result: ' done (no output) ' }))).toBeNull()
    })

    it('applies completion sentinels only to mutation result views', () => {
        expect(getToolExpansionKind(block('Grep', { result: 'Done' }))).toBe('result')
        expect(getToolExpansionKind(block('Read', { result: '(no output)' }))).toBe('result')
        expect(getToolExpansionKind(block('CodexPatch', { result: 'Done' }))).toBeNull()
    })

    it('opens CodexDiff input for renderer-supported hunks and metadata-only diffs', () => {
        expect(getToolExpansionKind(block('CodexDiff', {
            input: {
                unified_diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b'
            }
        }))).toBe('input')
        for (const unifiedDiff of [
            'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts',
            'diff --git a/a.sh b/a.sh\nold mode 100644\nnew mode 100755',
            'diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ'
        ]) {
            expect(getToolExpansionKind(block('CodexDiff', {
                input: { unified_diff: unifiedDiff }
            }))).toBe('input')
        }
    })

    it('falls back to meaningful CodexDiff results when input is missing or malformed', () => {
        expect(getToolExpansionKind(block('CodexDiff', {
            input: {},
            result: 'result-only-diff'
        }))).toBe('result')
        expect(getToolExpansionKind(block('CodexDiff', {
            input: { unified_diff: 'not a diff' },
            result: 'result-fallback-diff'
        }))).toBe('result')
        expect(getToolExpansionKind(block('CodexDiff', {
            input: { unified_diff: 'not a diff' }
        }))).toBe('input')
        expect(getToolExpansionKind(block('CodexDiff', { input: {}, result: '  \n' }))).toBeNull()
    })

    it('opens shell results for any non-whitespace renderer-supported stdout or stderr', () => {
        expect(getToolExpansionKind(block('Bash', {
            result: { stdout: 'ready\n', stderr: '' }
        }))).toBe('result')
        expect(getToolExpansionKind(block('Bash', {
            result: { stdout: ' ', stderr: '' }
        }))).toBeNull()
        expect(getToolExpansionKind(block('CodexBash', {
            result: { stdout: '', stderr: 'failed' }
        }))).toBe('result')
        expect(getToolExpansionKind(block('CodexBash', {
            result: { stdout: 'Done', stderr: '(no output)' }
        }))).toBe('result')
        expect(getToolExpansionKind(block('Bash', {
            result: { output: { stdout: 'nested stdout', stderr: '' } }
        }))).toBe('result')
        expect(getToolExpansionKind(block('Bash', { result: 'Done' }))).toBe('result')
        expect(getToolExpansionKind(block('Bash', { result: '(no output)' }))).toBe('result')
    })

    it('does not bypass authoritative blank Bash stdio with a fallback message', () => {
        expect(getToolExpansionKind(block('Bash', {
            result: { stdout: '', stderr: '', message: 'Done' }
        }))).toBeNull()
    })
})

describe('activity timing', () => {
    it('uses exact completed tool timestamps', () => {
        expect(getActivityDurationMs(toolEntry('Read', {
            startedAt: 1000,
            completedAt: 2000
        }), 9000)).toBe(1000)
    })

    it('uses injected now while a tool runs and freezes on exact completion', () => {
        expect(getActivityDurationMs(toolEntry('Bash', {
            state: 'running',
            startedAt: 1000,
            completedAt: null
        }), 3500)).toBe(2500)
        expect(getActivityDurationMs(toolEntry('Bash', {
            state: 'completed',
            startedAt: 1000,
            completedAt: 2800
        }), 9000)).toBe(1800)
    })

    it('does not invent an item duration for generic reasoning', () => {
        expect(getActivityDurationMs(reasoningEntry(), 4000)).toBeNull()
    })

    it('reports running state from tool state and reasoning presentation state', () => {
        expect(isActivityRunning(toolEntry('Read', { state: 'pending' }))).toBe(true)
        expect(isActivityRunning(toolEntry('Read', { state: 'running' }))).toBe(true)
        expect(isActivityRunning(toolEntry('Read', { state: 'completed' }))).toBe(false)
        expect(isActivityRunning(reasoningEntry({ isStreaming: true }))).toBe(true)
        expect(isActivityRunning(reasoningEntry())).toBe(false)
    })

    it('uses now minus the first exact start while any group entry is running', () => {
        const entries = [
            toolEntry('Read', { startedAt: 1000, completedAt: 2000 }),
            toolEntry('Bash', { state: 'running', startedAt: 2500, completedAt: null })
        ]

        expect(getActivityGroupDurationMs(entries, 61000)).toBe(60000)
    })

    it('does not reset the running elapsed when another activity is appended', () => {
        const first = toolEntry('Read', { startedAt: 1000, completedAt: 2000 })
        const running = toolEntry('Bash', { state: 'running', startedAt: 2500, completedAt: null })

        expect(getActivityGroupDurationMs([first, running], 11000)).toBe(10000)
        expect(getActivityGroupDurationMs([
            first,
            toolEntry('Grep', { startedAt: 6000, completedAt: 7000 }),
            running
        ], 12000)).toBe(11000)
    })

    it('freezes a completed group at last completion minus first start', () => {
        expect(getActivityGroupDurationMs([
            toolEntry('Read', { startedAt: 1000, completedAt: 2000 }),
            toolEntry('Bash', { startedAt: 2500, completedAt: 6500 })
        ], 999999)).toBe(5500)
    })

    it.each([
        [[], 5000],
        [[reasoningEntry(), toolEntry('Read')], 5000],
        [[toolEntry('Read', { startedAt: null }), toolEntry('Bash')], 5000],
        [[toolEntry('Read'), reasoningEntry()], 5000],
        [[toolEntry('Read'), toolEntry('Bash', { completedAt: null })], 5000],
        [[toolEntry('Read', { startedAt: Number.NaN }), toolEntry('Bash')], 5000],
        [[toolEntry('Read', { startedAt: 6000 }), toolEntry('Bash', { state: 'running' })], 5000],
        [[toolEntry('Read', { startedAt: 6000 }), toolEntry('Bash', { completedAt: 5000 })], 9000]
    ])('hides a group total when exact boundary timing is unavailable: %#', (entries, now) => {
        expect(getActivityGroupDurationMs(entries as ActivityEntry[], now)).toBeNull()
    })

    it.each([
        ['null start', { startedAt: null }],
        ['NaN start', { startedAt: Number.NaN }],
        ['infinite completion', { completedAt: Number.POSITIVE_INFINITY }],
        ['negative start', { startedAt: -1 }],
        ['completion before start', { startedAt: 2000, completedAt: 1000 }]
    ] satisfies [string, BlockOptions][])('hides invalid item duration for %s', (_label, options) => {
        expect(getActivityDurationMs(toolEntry('Read', options), 4000)).toBeNull()
    })

    it('hides invalid running duration', () => {
        expect(getActivityDurationMs(toolEntry('Read', {
            state: 'running',
            startedAt: 1000,
            completedAt: null
        }), Number.NaN)).toBeNull()
    })

    it.each([
        [0, '0.0s'],
        [1, '<0.1s'],
        [99, '<0.1s'],
        [100, '0.1s'],
        [4600, '4.6s'],
        [59949, '59.9s'],
        [59999, '59.9s'],
        [60000, '1m 00s'],
        [1264000, '21m 04s'],
        [3599999, '59m 59s'],
        [3600000, '1h 00m'],
        [3900000, '1h 05m']
    ])('formats %dms as %s', (durationMs, expected) => {
        expect(formatActivityDuration(durationMs)).toBe(expected)
    })

    it.each([
        ['en', 4600, '4.6'],
        ['vi-VN', 4600, '4,6'],
        ['zh-CN', 4600, '4.6'],
        ['vi-VN', 50, '0,1']
    ] as const)('formats the spoken duration value for %s', (locale, durationMs, expected) => {
        expect(formatActivityDurationValue(durationMs, locale)).toBe(expected)
    })
})
