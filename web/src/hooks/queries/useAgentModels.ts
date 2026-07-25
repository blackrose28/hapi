import { useQuery } from '@tanstack/react-query'
import {
    CLAUDE_MODEL_PRESETS,
    getClaudeModelLabel,
    type AgentFlavor,
    type AgentModelCatalogStatus,
    type AgentModelDescriptor
} from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

function fallbackModels(agent: AgentFlavor): AgentModelDescriptor[] {
    if (agent !== 'claude') {
        return []
    }
    return CLAUDE_MODEL_PRESETS.map((id) => ({
        id,
        displayName: getClaudeModelLabel(id) ?? id
    }))
}

export function useAgentModels(args: {
    api: ApiClient | null
    agent: AgentFlavor
    sessionId?: string | null
    sessionActive?: boolean
    machineId?: string | null
    cwd?: string | null
    enabled?: boolean
}): {
    models: AgentModelDescriptor[]
    status: AgentModelCatalogStatus
    isLoading: boolean
    error: string | null
} {
    const { api, agent, sessionId, machineId, cwd } = args
    // A freshly spawned session isn't active yet (the CLI process hasn't connected back),
    // and the hub only serves models for inactive sessions from a cache that doesn't exist
    // until a live fetch succeeds — so fetching before activation is guaranteed to 404.
    const enabled = Boolean(args.enabled && api && (sessionId ? args.sessionActive : machineId))
    const queryKey = sessionId
        ? queryKeys.sessionAgentModels(sessionId, agent)
        : queryKeys.machineAgentModels(machineId ?? 'unknown', agent, cwd)

    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (sessionId) {
                return await api.getSessionAgentModels(sessionId, agent)
            }
            if (machineId) {
                return await api.getMachineAgentModels(machineId, agent, cwd?.trim() || undefined)
            }
            throw new Error('Agent models target unavailable')
        },
        enabled,
        staleTime: 30_000,
        retry: false
    })

    const transportError = query.error instanceof Error
        ? query.error.message
        : query.error
            ? 'Failed to load agent models'
            : null
    const catalogError = query.data?.status === 'failed'
        ? (query.data.error ?? 'Failed to load agent models')
        : null

    return {
        models: query.data?.models ?? fallbackModels(agent),
        status: query.data?.status ?? (transportError ? 'failed' : 'fallback'),
        isLoading: query.isLoading,
        error: catalogError ?? transportError
    }
}
