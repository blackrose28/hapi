import { useEffect, useState } from 'react'
import { useRouter, useSearch } from '@tanstack/react-router'
import { AppDialog } from '@/components/ui/app-dialog'
import type { RootSearch } from '@/router'
import { SettingsModal } from '@/components/modals/SettingsModal'
import { NewSessionModal } from '@/components/modals/NewSessionModal'
import { FilesModal } from '@/components/modals/FilesModal'
import { TerminalModal } from '@/components/modals/TerminalModal'
import { BrowserModal } from '@/components/modals/BrowserModal'
import { ReplacePinModal } from '@/components/modals/ReplacePinModal'
import type { NewSessionDraft } from '@/components/NewSession/types'

export function GlobalModalManager() {
    const search = useSearch({ strict: false }) as RootSearch
    const router = useRouter()
    const { modal, modalSessionId, modalPath, modalMachineId } = search
    const [newSessionDraft, setNewSessionDraft] = useState<NewSessionDraft | null>(null)

    useEffect(() => {
        if (!modal) {
            setNewSessionDraft(null)
        }
    }, [modal])

    const handleClose = () => {
        if (modal === 'browser' && search.modalParent === 'new-session') {
            void router.navigate({
                search: (prev: any) => {
                    const next = { ...prev, modal: 'new-session' }
                    delete next.modalParent
                    return next
                },
                replace: true
            } as any)
            return
        }

        setNewSessionDraft(null)
        void router.navigate({
            search: (prev: any) => {
                const newSearch = { ...prev }
                delete newSearch.modal
                delete newSearch.modalSessionId
                delete newSearch.modalPath
                delete newSearch.modalMachineId
                delete newSearch.modalReturnTo
                delete newSearch.modalParent
                return newSearch
            },
            replace: true
        } as any)
    }

    if (!modal) return null

    return (
        <AppDialog open={!!modal} onOpenChange={(open) => !open && handleClose()}>
            {modal === 'settings' && <SettingsModal onClose={handleClose} />}
            {modal === 'new-session' && (
                <NewSessionModal
                    onClose={handleClose}
                    draft={newSessionDraft}
                    onDraftChange={setNewSessionDraft}
                />
            )}
            {modal === 'files' && <FilesModal sessionId={modalSessionId!} path={modalPath} onClose={handleClose} />}
            {modal === 'terminal' && <TerminalModal sessionId={modalSessionId!} onClose={handleClose} />}
            {modal === 'browser' && <BrowserModal machineId={modalMachineId} initialPath={modalPath} onClose={handleClose} />}
            {modal === 'replace-pin' && <ReplacePinModal onClose={handleClose} />}
        </AppDialog>
    )
}
