import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useOrchestrators(api: ApiClient | null) {
    return useQuery({
        queryKey: queryKeys.orchestrators,
        queryFn: () => api!.getOrchestrators(),
        enabled: Boolean(api),
        select: (data) => data.orchestrators
    })
}

export function useOrchestrator(api: ApiClient | null, id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.orchestrator(id ?? ''),
        queryFn: () => api!.getOrchestrator(id!),
        enabled: Boolean(api && id),
        select: (data) => data.orchestrator
    })
}

export function useOrchestratorTranscript(api: ApiClient | null, id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.orchestratorTranscript(id ?? ''),
        queryFn: () => api!.getOrchestratorTranscript(id!, 300),
        enabled: Boolean(api && id)
    })
}
