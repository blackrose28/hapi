import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { SessionTerminalTabs } from '@/components/Terminal/SessionTerminalTabs'
import { LoadingState } from '@/components/LoadingState'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/ui/app-dialog'

export function TerminalModal(props: { sessionId: string; onClose: () => void }) {
    const sessionId = props.sessionId
    const { api } = useAppContext()
    const { session } = useSession(api, sessionId)
    const terminalSupported = isRemoteTerminalSupported(session?.metadata)

    if (!session) {
        return (
            <div className="flex h-full items-center justify-center">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    return (
        <AppDialogContent
            presentation="workspace"
            className="h-[85vh] max-h-[800px] w-[95vw] max-w-3xl"
        >
            <AppDialogHeader
                title="Terminal"
                subtitle={session.metadata?.name ?? session.metadata?.path}
                mobileNavigation="back"
                mobileBackLabel="Back to session"
                onMobileBack={props.onClose}
            />
            <AppDialogBody className="overflow-hidden p-0">
                <SessionTerminalTabs
                    sessionId={sessionId}
                    active={Boolean(session.active)}
                    terminalSupported={terminalSupported}
                    cwd={session.metadata?.path}
                    className="min-h-0 flex-1"
                />
            </AppDialogBody>
        </AppDialogContent>
    )
}
