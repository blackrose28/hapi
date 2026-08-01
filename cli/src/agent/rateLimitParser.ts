import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { AgentMessage } from './types';

/**
 * Detect rate_limit_event JSON in agent text output and convert to
 * a standardized AgentMessage, so the web layer doesn't need to
 * parse undocumented Claude-internal JSON formats.
 *
 * Converted text format (pipe-delimited, parsed by web's reducerEvents.ts):
 *   - "Claude AI usage status|{unixSeconds}|{percentInt}|{rateLimitType}" (normal, sub-threshold usage)
 *     percentInt is empty when Claude didn't report a utilization figure (plain 'allowed'
 *     status below any warning threshold carries no percentage at all).
 *   - "Claude AI usage limit warning|{unixSeconds}|{percentInt}|{rateLimitType}"
 *   - "Claude AI usage limit reached|{unixSeconds}|{rateLimitType}"
 *
 * The 'allowed' status is forwarded (not suppressed) so the web app can track
 * live quota utilization continuously rather than only near a limit — the web
 * reducer treats it as silent state (never rendered as a chat bubble).
 *
 * Returns null if the text is not a rate_limit_event (pass through as-is).
 * Returns { suppress: true } for statuses with nothing usable to report.
 * Returns { suppress: false, message } for statuses worth forwarding.
 */
export type RateLimitResult =
    | null
    | { suppress: true }
    | { suppress: false; message: AgentMessage };

export function parseRateLimitText(text: string): RateLimitResult {
    if (text[0] !== '{') return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    // Unwrap { type: "output", data: { ... } } wrapper
    const record = parsed as Record<string, unknown>;
    let inner = record;
    if (record.type === 'output' && typeof record.data === 'object' && record.data !== null) {
        inner = record.data as Record<string, unknown>;
    }

    if (inner.type !== 'rate_limit_event') return null;

    const info = inner.rate_limit_info;
    if (typeof info !== 'object' || info === null) return null;

    const { status, resetsAt, utilization, rateLimitType } = info as Record<string, unknown>;

    if (typeof resetsAt !== 'number') {
        // Malformed rate_limit_event (missing resetsAt) — suppress to prevent
        // raw JSON from leaking into chat.
        return { suppress: true };
    }

    // Ensure integer for the pipe-delimited format (web regex uses \d+)
    const resetsAtInt = Math.round(resetsAt);
    const limitType = typeof rateLimitType === 'string' ? rateLimitType : '';
    const pct = typeof utilization === 'number' ? Math.round(utilization * 100) : null;

    if (status === 'allowed') {
        return {
            suppress: false,
            message: {
                type: 'text',
                text: `Claude AI usage status|${resetsAtInt}|${pct ?? ''}|${limitType}`,
            },
        };
    }

    if (status === 'allowed_warning') {
        return {
            suppress: false,
            message: {
                type: 'text',
                text: `Claude AI usage limit warning|${resetsAtInt}|${pct ?? ''}|${limitType}`,
            },
        };
    }

    if (status === 'rejected') {
        return {
            suppress: false,
            message: {
                type: 'text',
                text: `Claude AI usage limit reached|${resetsAtInt}|${limitType}`,
            },
        };
    }

    // Unknown status — suppress to prevent raw JSON from leaking into chat.
    // If a new status needs to be displayed, add an explicit branch above.
    return { suppress: true };
}
