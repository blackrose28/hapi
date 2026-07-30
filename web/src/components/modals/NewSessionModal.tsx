import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { queryKeys } from '@/lib/query-keys'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/ui/app-dialog'
import { NewSession } from '@/components/NewSession'
import type { NewSessionDraft } from '@/components/NewSession/types'
import type { RootSearch } from '@/router'

export function NewSessionModal(props: {
    onClose: () => void
    draft?: NewSessionDraft | null
    onDraftChange?: (draft: NewSessionDraft) => void
}) {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()
    const search = useSearch({ strict: false }) as RootSearch
    const initialDirectory = search.modalPath
    const initialMachineId = search.modalMachineId
    const initialDraft = props.draft
        ? {
            ...props.draft,
            machineId: initialMachineId ?? props.draft.machineId,
            directory: initialDirectory ?? props.draft.directory,
        }
        : null

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })

        if (search.modalReturnTo === 'editor') {
            void navigate({
                search: (prev: any) => {
                    const newSearch = { ...prev }
                    delete newSearch.modal
                    delete newSearch.modalSessionId
                    delete newSearch.modalPath
                    delete newSearch.modalMachineId
                    delete newSearch.modalReplaceSessionId
                    delete newSearch.modalReturnTo
                    return { ...newSearch, modalNewSessionId: sessionId }
                },
                replace: true
            } as any)
            return
        }
        
        // Read pins from sessionStorage (per-tab, source of truth)
        let currentPins: string[] = []
        try {
            const saved = sessionStorage.getItem('mc-pinned-ids')
            if (saved) currentPins = JSON.parse(saved)
        } catch { /* ignore */ }

        const replaceSessionId = search.modalReplaceSessionId

        if (replaceSessionId) {
            // Replace in pins if pinned, otherwise just remove old and add new
            let newPins: string[]
            if (currentPins.includes(replaceSessionId)) {
                newPins = currentPins.map(id => id === replaceSessionId ? sessionId : id)
            } else if (currentPins.length < 4) {
                // Not pinned but room available — just auto-pin the new one
                newPins = Array.from(new Set([...currentPins, sessionId]))
            } else {
                // Not pinned, pins full — replace the replaceSessionId if it's there, else first slot
                // As fallback, just navigate to replace-pin modal
                void navigate({
                    search: (prev: any) => {
                        const newSearch = { ...prev }
                        delete newSearch.modalPath
                        delete newSearch.modalMachineId
                        delete newSearch.modalReplaceSessionId
                        delete newSearch.modalReturnTo
                        return { ...newSearch, modal: 'replace-pin', modalSessionId: sessionId }
                    },
                    replace: true
                } as any)
                return
            }
            sessionStorage.setItem('mc-pinned-ids', JSON.stringify(newPins))
            void navigate({
                to: '/sessions',
                search: (prev: any) => {
                    const newSearch = { ...prev }
                    delete newSearch.modal
                    delete newSearch.modalSessionId
                    delete newSearch.modalPath
                    delete newSearch.modalMachineId
                    delete newSearch.modalReplaceSessionId
                    delete newSearch.modalReturnTo
                    return { ...newSearch, modalNewSessionId: sessionId }
                },
                replace: true
            })
            return
        }

        if (currentPins.length < 4) {
            // Auto append
            const newPins = Array.from(new Set([...currentPins, sessionId]))
            sessionStorage.setItem('mc-pinned-ids', JSON.stringify(newPins))
            void navigate({
                to: '/sessions',
                search: (prev: any) => {
                    const newSearch = { ...prev }
                    delete newSearch.modal
                    delete newSearch.modalSessionId
                    delete newSearch.modalPath
                    delete newSearch.modalMachineId
                    delete newSearch.modalReplaceSessionId
                    delete newSearch.modalReturnTo
                    return { ...newSearch, modalNewSessionId: sessionId }
                },
                replace: true
            })
            return
        }

        // 4 pins already, need to open replace pin modal
        void navigate({
            search: (prev: any) => {
                const newSearch = { ...prev }
                delete newSearch.modalPath
                delete newSearch.modalMachineId
                delete newSearch.modalReplaceSessionId
                delete newSearch.modalReturnTo
                return { ...newSearch, modal: 'replace-pin', modalSessionId: sessionId }
            },
            replace: true
        } as any)
    }, [navigate, queryClient, search])

    const handleChooseFolder = useCallback((args: { machineId: string | null; directory: string }) => {
        void navigate({
            search: (prev: any) => ({
                ...prev,
                modal: 'browser',
                modalMachineId: args.machineId,
                modalPath: args.directory || undefined,
                modalParent: 'new-session',
                modalReturnTo: search.modalReturnTo
            })
        } as any)
    }, [navigate, search.modalReturnTo])

    return (
        <AppDialogContent
            presentation="workspace"
            className="max-h-[85vh] w-[95vw] max-w-2xl"
        >
            <AppDialogHeader title={t('newSession.title')} subtitle="Create a new session" />
            <AppDialogBody className="app-scroll-y p-4">
                {machinesError ? (
                    <div className="mb-3 p-3 text-sm text-red-600 rounded bg-red-50">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    onCancel={props.onClose}
                    onSuccess={handleSuccess}
                    onChooseFolder={handleChooseFolder}
                    initialDirectory={initialDirectory}
                    initialMachineId={initialMachineId}
                    initialDraft={initialDraft}
                    onDraftChange={props.onDraftChange}
                />
            </AppDialogBody>
        </AppDialogContent>
    )
}
