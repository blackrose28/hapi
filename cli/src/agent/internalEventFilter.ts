import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Detect internal session-metadata JSON that leaks into agent text output.
 *
 * Claude's SDK occasionally emits internal control messages as text chunks.
 * The known leaked shape is the session metadata envelope:
 *   { type: "output", data: { parentUuid, sessionId, userType, ... } }
 *
 * A single chunk may carry several such envelopes back to back (e.g. a burst of
 * tool-progress heartbeats), separated by whitespace or blank lines. We split
 * the chunk into top-level JSON objects and suppress it only when *every* one
 * is an internal envelope — a chunk that mixes real content with an envelope is
 * left alone, since dropping it would lose visible output.
 *
 * We match on the specific structure rather than a broad type allowlist to
 * avoid accidentally suppressing legitimate assistant JSON.
 *
 * Only called for text whose first non-whitespace char is '{', so the fast-path
 * for normal prose has zero overhead.
 */
export function isInternalEventJson(text: string): boolean {
    const start = firstNonWhitespaceIndex(text);
    if (start < 0 || text[start] !== '{') return false;

    const objects = splitTopLevelJsonObjects(text, start);
    if (!objects || objects.length === 0) return false;

    return objects.every(isInternalEventObject);
}

function isWhitespace(char: string): boolean {
    return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function firstNonWhitespaceIndex(text: string): number {
    for (let i = 0; i < text.length; i += 1) {
        if (!isWhitespace(text[i])) return i;
    }
    return -1;
}

/**
 * Split text into its top-level JSON object substrings.
 *
 * Returns null when the text is not exclusively a whitespace-separated
 * sequence of balanced JSON objects — unbalanced braces, a truncated tail from
 * mid-stream chunking, or any prose between/after the objects. Callers treat
 * null as "not internal event JSON" and let the text through.
 */
function splitTopLevelJsonObjects(text: string, start: number): string[] | null {
    const objects: string[] = [];
    let index = start;

    while (index < text.length) {
        if (isWhitespace(text[index])) {
            index += 1;
            continue;
        }
        if (text[index] !== '{') return null;

        const end = findObjectEnd(text, index);
        if (end < 0) return null;

        objects.push(text.slice(index, end + 1));
        index = end + 1;
    }

    return objects;
}

/**
 * Index of the '}' closing the object that starts at `start`, or -1 if the
 * object never closes. String literals (and their escapes) are skipped so
 * braces inside values do not affect the depth count.
 */
function findObjectEnd(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }

    return -1;
}

/**
 * Match the known leaked metadata envelope:
 * { type: "output", data: { parentUuid, sessionId, userType, ... } }
 */
function isInternalEventObject(json: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return false;
    }
    if (typeof parsed !== 'object' || parsed === null) return false;

    const record = parsed as Record<string, unknown>;
    if (record.type !== 'output') return false;
    if (typeof record.data !== 'object' || record.data === null) return false;

    const data = record.data as Record<string, unknown>;
    const hasParentUuid = typeof data.parentUuid === 'string' || data.parentUuid === null;
    return hasParentUuid
        && typeof data.sessionId === 'string'
        && typeof data.userType === 'string';
}
