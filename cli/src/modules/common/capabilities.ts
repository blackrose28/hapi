import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export function normalizeCapabilityName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
}

export function mergeCapabilityNames(
    existing: readonly string[] | undefined,
    incoming: readonly unknown[] | undefined
): string[] {
    const names = new Set<string>()

    for (const value of existing ?? []) {
        const normalized = normalizeCapabilityName(value)
        if (normalized !== null) {
            names.add(normalized)
        }
    }

    for (const value of incoming ?? []) {
        const normalized = normalizeCapabilityName(value)
        if (normalized !== null) {
            names.add(normalized)
        }
    }

    return Array.from(names).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export function toProviderCommandName(provider: 'opencode' | 'gemini', commandName: unknown): string | null {
    const normalized = normalizeCapabilityName(commandName)
    return normalized === null ? null : `${provider}:${normalized}`
}

export function sameCapabilityNames(left?: readonly string[], right?: readonly string[]): boolean {
    const normalizedLeft = mergeCapabilityNames(left, undefined)
    const normalizedRight = mergeCapabilityNames(right, undefined)

    if (normalizedLeft.length !== normalizedRight.length) {
        return false
    }

    return normalizedLeft.every((name, index) => name === normalizedRight[index])
}
