import { isObject } from '@hapi/protocol'

export type CodexPatchFile = {
    path: string
}

export function extractCodexPatchFiles(input: unknown): CodexPatchFile[] {
    if (!isObject(input)) return []

    const changes = input.changes
    if (Array.isArray(changes)) {
        return changes.flatMap((change) => {
            if (!isObject(change) || typeof change.path !== 'string' || change.path.length === 0) {
                return []
            }
            return [{ path: change.path }]
        })
    }

    if (isObject(changes)) {
        return Object.keys(changes).map((path) => ({ path }))
    }

    return []
}
