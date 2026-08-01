import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GrokReasoningEffortOption } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGrokReasoningEffortOptions(args: {
    api: ApiClient | null
    sessionId?: string | null
    enabled?: boolean
}): {
    options: GrokReasoningEffortOption[]
    currentValue: string | null
    isLoading: boolean
    error: string | null
} {
    const { api, sessionId } = args
    const enabled = Boolean(args.enabled && api && sessionId)

    const query = useQuery({
        queryKey: sessionId
            ? queryKeys.sessionGrokReasoningEffortOptions(sessionId)
            : ['session-grok-reasoning-effort-options', 'unknown'] as const,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!sessionId) {
                throw new Error('Grok session unavailable')
            }
            return await api.getSessionGrokReasoningEffortOptions(sessionId)
        },
        enabled,
        staleTime: 30_000,
        retry: false,
    })

    return {
        options: query.data?.options ?? [],
        currentValue: query.data?.currentValue ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load Grok effort options')
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load Grok effort options'
                    : null,
    }
}
