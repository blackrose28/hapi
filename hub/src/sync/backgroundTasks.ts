import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'

/**
 * Extract background task start/completion signals from a message.
 *
 * Uses role-aware parsing to avoid false positives:
 *  - Started:   agent-role output with tool_result containing
 *               "Command running in background with ID:" (background bash)
 *               or "Async agent launched successfully." + "agentId:" (async subagent,
 *               text form), or a structured { agentId, output_file } object (async
 *               subagent, object form) — the SDK uses either shape depending on version
 *  - Completed: agent-role output wrapping a user-type message (system-injected)
 *               starting with "<task-notification>" — this fires for both kinds,
 *               since a subagent's own turn finishing doesn't mean its background
 *               work is done, only this completion notification does.
 *
 * Both signals arrive as { role: 'agent', content: { type: 'output', data: {...} } }
 * because the CLI wraps all messages in agent envelopes.
 */
export function extractBackgroundTaskDelta(messageContent: unknown): { started: number; completed: number } | null {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record || record.role !== 'agent') return null
    if (!isObject(record.content) || record.content.type !== 'output') return null

    const data = isObject(record.content.data) ? record.content.data : null
    if (!data) return null

    const started = countTaskStarts(record.content)
    const completed = data.type === 'user' ? countTaskCompletions(data) : 0

    if (started === 0 && completed === 0) return null
    return { started, completed }
}

/**
 * Count background task starts from tool_result blocks.
 */
function countTaskStarts(content: Record<string, unknown>): number {
    const data = isObject(content.data) ? content.data : null
    if (!data) return 0

    // Direct tool_result
    if (data.type === 'tool_result') {
        return isBackgroundStartResult(data) ? 1 : 0
    }

    // Assistant message with content array containing tool_result blocks
    if (data.type === 'assistant') {
        const message = isObject(data.message) ? data.message : null
        const modelContent = message?.content
        if (!Array.isArray(modelContent)) return 0

        let count = 0
        for (const block of modelContent) {
            if (isObject(block) && block.type === 'tool_result' && isBackgroundStartResult(block)) {
                count++
            }
        }
        return count
    }

    return 0
}

function isBackgroundStartResult(block: Record<string, unknown>): boolean {
    // The SDK sometimes returns the async-launch metadata as a structured
    // object (content: { agentId, output_file }) instead of the text form
    // below — check that first, same as the web ToolCard's Agent result view.
    if (isObject(block.content) && ('agentId' in block.content || 'output_file' in block.content)) {
        return true
    }

    const text = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
            ? block.content.map((c: unknown) => isObject(c) && typeof c.text === 'string' ? c.text : '').join('')
            : ''
    return text.includes('Command running in background with ID:')
        || (text.startsWith('Async agent launched successfully.') && text.includes('agentId:'))
}

/**
 * Count task completions from system-injected user messages.
 *
 * These arrive as: { type: 'user', message: { content: '<task-notification>...' } }
 * inside the agent output envelope.
 */
function countTaskCompletions(data: Record<string, unknown>): number {
    // { type: 'user', message: { content: '<task-notification>...' } }
    if (isObject(data.message)) {
        const msg = data.message as Record<string, unknown>
        if (typeof msg.content === 'string' && msg.content.trimStart().startsWith('<task-notification>')) {
            return 1
        }
    }

    // { type: 'user', uuid: '...', content: '<task-notification>...' }
    if (typeof data.content === 'string' && data.content.trimStart().startsWith('<task-notification>')) {
        return 1
    }

    return 0
}
