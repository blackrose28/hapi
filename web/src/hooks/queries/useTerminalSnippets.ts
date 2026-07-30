import {
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient
} from '@tanstack/react-query'
import type {
    CreateTerminalSnippetInput,
    TerminalSnippet,
    TerminalSnippetsResponse,
    UpdateTerminalSnippetInput
} from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

function sortTerminalSnippets(
    left: TerminalSnippet,
    right: TerminalSnippet
): number {
    if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt
    }
    if (left.id === right.id) {
        return 0
    }
    return left.id < right.id ? 1 : -1
}

type TerminalSnippetsQueryKey = ReturnType<
    typeof queryKeys.terminalSnippets
>

type MutationScope = {
    api: ApiClient
    queryKey: TerminalSnippetsQueryKey
}

function invalidateMutationScope(
    queryClient: QueryClient,
    scope: MutationScope
) {
    return queryClient.invalidateQueries({
        queryKey: scope.queryKey,
        exact: true
    })
}

function withCreatedSnippet(
    previous: TerminalSnippetsResponse,
    snippet: TerminalSnippet
): TerminalSnippetsResponse {
    return {
        snippets: [
            ...previous.snippets.filter((item) => item.id !== snippet.id),
            snippet
        ].sort(sortTerminalSnippets)
    }
}

export function useTerminalSnippets(
    api: ApiClient | null,
    enabled: boolean
): {
    snippets: TerminalSnippet[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
    createSnippet: (input: CreateTerminalSnippetInput) => Promise<TerminalSnippet>
    ensureCreatedSnippetVisible: (snippet: TerminalSnippet) => Promise<void>
    updateSnippet: (id: string, input: UpdateTerminalSnippetInput) => Promise<TerminalSnippet>
    deleteSnippet: (id: string) => Promise<void>
    isPending: boolean
} {
    const queryClient = useQueryClient()
    const queryKey = queryKeys.terminalSnippets(
        api?.cacheScope ?? 'api-unavailable'
    )
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getTerminalSnippets()
        },
        enabled: Boolean(api) && enabled
    })

    const createMutation = useMutation({
        mutationFn: async (args: MutationScope & {
            input: CreateTerminalSnippetInput
        }) => {
            return (await args.api.createTerminalSnippet(args.input)).snippet
        },
        onSuccess: (snippet, args) => {
            queryClient.setQueryData<TerminalSnippetsResponse>(
                args.queryKey,
                (previous) => {
                    if (!previous) {
                        return previous
                    }
                    return withCreatedSnippet(previous, snippet)
                }
            )
        },
        onSettled: (_snippet, _error, args) => {
            return invalidateMutationScope(queryClient, args)
        }
    })

    const updateMutation = useMutation({
        mutationFn: async (args: MutationScope & {
            id: string
            input: UpdateTerminalSnippetInput
        }) => {
            return (
                await args.api.updateTerminalSnippet(args.id, args.input)
            ).snippet
        },
        onSuccess: (snippet, args) => {
            queryClient.setQueryData<TerminalSnippetsResponse>(
                args.queryKey,
                (previous) => {
                    if (!previous) {
                        return previous
                    }
                    return {
                        snippets: previous.snippets.map((item) => (
                            item.id === snippet.id ? snippet : item
                        ))
                    }
                }
            )
        },
        onSettled: (_snippet, _error, args) => {
            return invalidateMutationScope(queryClient, args)
        }
    })

    const deleteMutation = useMutation({
        mutationFn: async (args: MutationScope & { id: string }) => {
            await args.api.deleteTerminalSnippet(args.id)
            return args.id
        },
        onSuccess: (id, args) => {
            queryClient.setQueryData<TerminalSnippetsResponse>(
                args.queryKey,
                (previous) => {
                    if (!previous) {
                        return previous
                    }
                    return {
                        snippets: previous.snippets.filter((item) => item.id !== id)
                    }
                }
            )
        },
        onSettled: (_id, _error, args) => {
            return invalidateMutationScope(queryClient, args)
        }
    })

    return {
        snippets: query.data?.snippets ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error
            ? query.error.message
            : query.error
                ? 'Failed to load terminal snippets'
                : null,
        refetch: query.refetch,
        createSnippet: async (input) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await createMutation.mutateAsync({
                api,
                queryKey,
                input
            })
        },
        ensureCreatedSnippetVisible: async (snippet) => {
            const cached = queryClient.getQueryData<TerminalSnippetsResponse>(
                queryKey
            )
            if (cached?.snippets.some((item) => item.id === snippet.id)) {
                return
            }
            const result = await query.refetch()
            if (!result.isSuccess) {
                return
            }
            if (result.data.snippets.some((item) => item.id === snippet.id)) {
                return
            }
            queryClient.setQueryData<TerminalSnippetsResponse>(
                queryKey,
                (previous) => previous
                    ? withCreatedSnippet(previous, snippet)
                    : previous
            )
        },
        updateSnippet: async (id, input) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await updateMutation.mutateAsync({
                api,
                queryKey,
                id,
                input
            })
        },
        deleteSnippet: async (id) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await deleteMutation.mutateAsync({
                api,
                queryKey,
                id
            })
        },
        isPending: createMutation.isPending
            || updateMutation.isPending
            || deleteMutation.isPending
    }
}
