import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/ui/app-dialog'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import type { RootSearch } from '@/router'

export function BrowserModal(props: { machineId?: string; initialPath?: string; onClose: () => void }) {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const search = useSearch({ strict: false }) as RootSearch
    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { t } = useTranslation()

    const handleStartSession = useCallback((machineId: string, directory: string) => {
        if (search.modalReturnTo === 'editor') {
            void navigate({
                to: '/editor',
                search: { machine: machineId, project: directory },
                replace: true
            })
            return
        }

        void navigate({
            search: (prev: any) => {
                const next = {
                    ...prev,
                    modal: 'new-session',
                    modalPath: directory,
                    modalMachineId: machineId,
                    modalReturnTo: search.modalReturnTo
                }
                delete next.modalParent
                return next
            }
        } as any)
    }, [navigate, search.modalReturnTo])

    return (
        <AppDialogContent
            presentation="workspace"
            className="h-[85vh] max-h-[85vh] w-[95vw] max-w-2xl"
        >
            <AppDialogHeader
                title={search.modalReturnTo === 'editor' ? 'Open project folder' : t('browse.title')}
                subtitle="Browse workspaces"
                mobileNavigation="back"
                mobileBackLabel="Back"
                onMobileBack={props.onClose}
            />
            <AppDialogBody className="overflow-hidden p-4">
                <WorkspaceBrowser
                    api={api}
                    machines={machines}
                    machinesLoading={machinesLoading}
                    onStartSession={handleStartSession}
                    initialMachineId={props.machineId}
                    initialPath={props.initialPath}
                    actionLabel={search.modalReturnTo === 'editor' ? 'Open Folder' : undefined}
                />
            </AppDialogBody>
        </AppDialogContent>
    )
}
