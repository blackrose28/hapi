import type { NormalizedMessage } from './types'

/**
 * Conservative fallback for providers that stream tool events before their
 * session-level thinking flag becomes observable in the web client.
 *
 * A ready event is the authoritative turn boundary. We intentionally do not
 * guess that a later user-shaped message means an older tool has finished.
 */
export function hasInFlightToolCall(messages: readonly NormalizedMessage[]): boolean {
    const inFlightToolCallIds = new Set<string>()

    for (const message of messages) {
        if (message.role === 'event') {
            if (message.content.type === 'ready') {
                inFlightToolCallIds.clear()
            }
            continue
        }
        if (message.role !== 'agent') continue

        for (const content of message.content) {
            if (content.type === 'tool-call') {
                inFlightToolCallIds.add(content.id)
            } else if (content.type === 'tool-result') {
                inFlightToolCallIds.delete(content.tool_use_id)
            }
        }
    }

    return inFlightToolCallIds.size > 0
}
