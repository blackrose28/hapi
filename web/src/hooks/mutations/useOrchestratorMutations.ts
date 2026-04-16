import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { CreateOrchestratorPayload } from '@/types/api'

export function useCreateOrchestrator(api: ApiClient | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (payload: CreateOrchestratorPayload) => {
            if (!api) {
                throw new Error('No API client')
            }
            return api.createOrchestrator(payload)
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrators })
        }
    })
}

export function useOrchestratorControl(api: ApiClient | null, orchestratorId: string | undefined) {
    const queryClient = useQueryClient()
    const pause = useMutation({
        mutationFn: () => {
            if (!api || !orchestratorId) {
                throw new Error('No API client')
            }
            return api.patchOrchestrator(orchestratorId, 'pause')
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrator(orchestratorId ?? '') })
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrators })
        }
    })
    const resume = useMutation({
        mutationFn: () => {
            if (!api || !orchestratorId) {
                throw new Error('No API client')
            }
            return api.patchOrchestrator(orchestratorId, 'resume')
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrator(orchestratorId ?? '') })
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrators })
        }
    })
    const stop = useMutation({
        mutationFn: () => {
            if (!api || !orchestratorId) {
                throw new Error('No API client')
            }
            return api.deleteOrchestrator(orchestratorId)
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrators })
            void queryClient.removeQueries({ queryKey: queryKeys.orchestrator(orchestratorId ?? '') })
        }
    })
    return { pause, resume, stop }
}
