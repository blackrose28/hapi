/**
 * Parse the SDK's `tool_progress` heartbeat into a liveness signal.
 *
 * The SDK emits one of these roughly every 30s while a tool is still executing,
 * so the consumer can tell "this tool is still working" apart from "the stream
 * stalled mid-tool". It carries no conversation content and must never enter the
 * message log — see SUPPRESSED_SDK_MESSAGE_TYPES in sdkToLogConverter.ts.
 *
 * Shape observed on the wire:
 *   { type: 'tool_progress', tool_use_id, tool_name, parent_tool_use_id,
 *     elapsed_time_seconds, heartbeat: true, session_id }
 */
export type ToolProgressSignal = {
    toolUseId: string
    parentToolUseId: string | null
    toolName?: string
    elapsedSeconds?: number
}

export const TOOL_PROGRESS_MESSAGE_TYPE = 'tool_progress'

export function parseToolProgressMessage(message: unknown): ToolProgressSignal | null {
    if (typeof message !== 'object' || message === null) return null

    const record = message as Record<string, unknown>
    if (record.type !== TOOL_PROGRESS_MESSAGE_TYPE) return null

    const toolUseId = record.tool_use_id
    if (typeof toolUseId !== 'string' || toolUseId === '') return null

    const signal: ToolProgressSignal = {
        toolUseId,
        parentToolUseId: typeof record.parent_tool_use_id === 'string' ? record.parent_tool_use_id : null
    }

    if (typeof record.tool_name === 'string' && record.tool_name !== '') {
        signal.toolName = record.tool_name
    }

    // Advisory only — the UI derives staleness from its own receive clock, so a
    // missing or nonsensical elapsed value costs nothing.
    const elapsed = record.elapsed_time_seconds
    if (typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0) {
        signal.elapsedSeconds = elapsed
    }

    return signal
}
