import type { AgentReasoningBlock, ToolCallBlock } from '@/chat/types'
import {
    extractCodexBashDisplay,
    extractStdoutStderr,
    extractTextFromResult
} from '@/components/ToolCard/views/_results'
import { isAgentReasoningBlock, reasoningToolCallId } from '@/lib/reasoningPart'
import { isObject } from '@hapi/protocol'
import { parsePatch } from 'diff'
import type { Locale } from '@/lib/i18n-context'

const GROUPABLE_TOOL_NAMES = new Set([
    'CodexReasoning',
    'Read',
    'Grep',
    'Glob',
    'Bash',
    'CodexBash',
    'CodexPatch',
    'CodexDiff'
])

const EMPTY_MUTATION_RESULT = /^(done|\(no output\)|done\s*\(no output\))$/i

export type ActivityPart = {
    type?: string
    toolCallId?: string
    artifact?: unknown
    isFinalRunningPart?: boolean
}

export type ActivityEntry =
    | {
        kind: 'reasoning'
        block: AgentReasoningBlock
        isStreaming: boolean
    }
    | {
        kind: 'tool'
        block: ToolCallBlock
    }

export type ActivitySegment =
    | {
        kind: 'group'
        id: string
        startOffset: number
        endOffset: number
        entries: ActivityEntry[]
    }
    | {
        kind: 'single'
        startOffset: number
        endOffset: number
        entry: ActivityEntry | null
    }

export function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value) || value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number' || !Array.isArray(value.children)) return false
    if (!isObject(value.tool) || typeof value.tool.name !== 'string' || !('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    return value.tool.state === 'pending'
        || value.tool.state === 'running'
        || value.tool.state === 'completed'
        || value.tool.state === 'error'
}

export function isGroupableToolBlock(block: ToolCallBlock): boolean {
    return GROUPABLE_TOOL_NAMES.has(block.tool.name)
        && block.tool.state !== 'error'
        && block.tool.permission === undefined
        && block.children.length === 0
}

function activityEntryFromPart(part: ActivityPart): ActivityEntry | null {
    if (part.type !== 'tool-call') return null

    if (isAgentReasoningBlock(part.artifact)) {
        return part.toolCallId === reasoningToolCallId(part.artifact.id)
            ? {
                kind: 'reasoning',
                block: part.artifact,
                isStreaming: part.isFinalRunningPart === true
            }
            : null
    }

    if (!isToolCallBlock(part.artifact) || !isGroupableToolBlock(part.artifact)) return null
    return { kind: 'tool', block: part.artifact }
}

function activityGroupId(first: ActivityEntry): string {
    return `activity-group:${first.block.id}`
}

export function partitionActivityParts(parts: readonly ActivityPart[]): ActivitySegment[] {
    const segments: ActivitySegment[] = []
    let runStart = -1
    let runEntries: ActivityEntry[] = []

    const flushRun = () => {
        if (runEntries.length === 0) return

        const endOffset = runStart + runEntries.length - 1
        segments.push(runEntries.length >= 2
            ? {
                kind: 'group',
                id: activityGroupId(runEntries[0]!),
                startOffset: runStart,
                endOffset,
                entries: runEntries
            }
            : {
                kind: 'single',
                startOffset: runStart,
                endOffset,
                entry: runEntries[0]
            })
        runStart = -1
        runEntries = []
    }

    parts.forEach((part, offset) => {
        const entry = activityEntryFromPart(part)
        if (entry) {
            if (runEntries.length === 0) runStart = offset
            runEntries.push(entry)
            return
        }

        flushRun()
        segments.push({
            kind: 'single',
            startOffset: offset,
            endOffset: offset,
            entry: null
        })
    })
    flushRun()
    return segments
}

function hasNonWhitespaceText(value: string | null | undefined): boolean {
    const text = value?.trim() ?? ''
    return text.length > 0
}

function hasMeaningfulMutationText(value: string | null | undefined): boolean {
    const text = value?.trim() ?? ''
    return text.length > 0 && !EMPTY_MUTATION_RESULT.test(text)
}

function hasRenderableUnifiedDiff(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) return false

    try {
        return parsePatch(value).some((patch) => patch.hunks.length > 0)
    } catch {
        return false
    }
}

function getStructuredReadExpansionKind(result: unknown): 'result' | null | undefined {
    if (!isObject(result) || !isObject(result.file)) return undefined
    if (typeof result.file.content !== 'string') return undefined
    return hasNonWhitespaceText(result.file.content) ? 'result' : null
}

export function getToolExpansionKind(block: ToolCallBlock): 'input' | 'result' | null {
    if (block.tool.name === 'CodexDiff') {
        const input = block.tool.input
        const unifiedDiff = isObject(input) && typeof input.unified_diff === 'string'
            ? input.unified_diff
            : null
        if (hasRenderableUnifiedDiff(unifiedDiff)) return 'input'
        if (hasNonWhitespaceText(extractTextFromResult(block.tool.result))) return 'result'
        return hasNonWhitespaceText(unifiedDiff) ? 'input' : null
    }

    if (block.tool.name === 'Bash') {
        const stdio = extractStdoutStderr(block.tool.result)
        if (stdio) {
            return hasNonWhitespaceText(stdio.stdout) || hasNonWhitespaceText(stdio.stderr)
                ? 'result'
                : null
        }
        return hasNonWhitespaceText(extractTextFromResult(block.tool.result)) ? 'result' : null
    }

    if (block.tool.name === 'CodexBash') {
        const display = extractCodexBashDisplay(block.tool.result)
        if (display && (hasNonWhitespaceText(display.stdout) || hasNonWhitespaceText(display.stderr))) {
            return 'result'
        }
        return hasNonWhitespaceText(extractTextFromResult(block.tool.result)) ? 'result' : null
    }

    if (block.tool.name === 'Read') {
        const structuredRead = getStructuredReadExpansionKind(block.tool.result)
        if (structuredRead !== undefined) return structuredRead
    }

    const text = extractTextFromResult(block.tool.result)
    if (block.tool.name === 'CodexPatch') {
        return hasMeaningfulMutationText(text) ? 'result' : null
    }
    return hasNonWhitespaceText(text) ? 'result' : null
}

function isExactTimestamp(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value >= 0
}

export function isActivityRunning(entry: ActivityEntry): boolean {
    if (entry.kind === 'reasoning') return entry.isStreaming
    return entry.block.tool.state === 'running' || entry.block.tool.state === 'pending'
}

export function getActivityDurationMs(entry: ActivityEntry, now: number): number | null {
    if (entry.kind === 'reasoning') return null

    const start = entry.block.tool.startedAt
    if (!isExactTimestamp(start)) return null

    const end = isActivityRunning(entry) ? now : entry.block.tool.completedAt
    if (!isExactTimestamp(end)) return null

    const duration = end - start
    return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function getActivityGroupDurationMs(
    entries: readonly ActivityEntry[],
    now: number
): number | null {
    if (entries.length === 0) return null

    const first = entries[0]
    if (first?.kind !== 'tool') return null

    const start = first.block.tool.startedAt
    if (!isExactTimestamp(start)) return null

    const running = entries.some(isActivityRunning)
    const last = entries[entries.length - 1]
    const end = running
        ? now
        : last?.kind === 'tool'
            ? last.block.tool.completedAt
            : null
    if (!isExactTimestamp(end)) return null

    const duration = end - start
    return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function formatActivityDuration(durationMs: number): string {
    if (durationMs > 0 && durationMs < 100) return '<0.1s'
    if (durationMs < 60000) return `${(Math.floor(durationMs / 100) / 10).toFixed(1)}s`

    const totalSeconds = Math.floor(durationMs / 1000)
    if (durationMs < 3600000) {
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`
    }

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function formatActivityDurationValue(durationMs: number, locale: Locale): string {
    const seconds = durationMs > 0 && durationMs < 100
        ? 0.1
        : Math.floor(durationMs / 100) / 10
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }).format(seconds)
}
