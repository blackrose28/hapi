import { lazy, Suspense, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { TeamChatLayout } from '@/components/TeamChat/TeamChatLayout'
import { useAppContext } from '@/lib/app-context'
import { configureTeamSessionMember } from '@/lib/team-session-member'
import { queryKeys } from '@/lib/query-keys'
import { useSessions } from '@/hooks/queries/useSessions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useTeamChat } from '@/hooks/queries/useTeamChat'
import { useTeamChatActions } from '@/hooks/mutations/useTeamChatActions'
import { useTeamChatMessages } from '@/hooks/queries/useTeamChatMessages'
import { useTeamChatParticipants } from '@/hooks/queries/useTeamChatParticipants'
import { useTeamChatMentionRequests } from '@/hooks/queries/useTeamChatMentionRequests'
import type { TeamChatMessage, TeamParticipant } from '@/types/api'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'

const PARTICIPANT_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#fb7185', '#818cf8']
const TeamSessionChatModal = lazy(() => import('@/components/TeamChat/TeamSessionChatModal').then((module) => ({
    default: module.TeamSessionChatModal
})))

function mergeMessages(base: TeamChatMessage[], extra: TeamChatMessage[]): TeamChatMessage[] {
    const byId = new Map<string, TeamChatMessage>()
    for (const message of base) byId.set(message.id, message)
    for (const message of extra) byId.set(message.id, message)
    return Array.from(byId.values()).sort((a, b) => a.seq - b.seq)
}

function getNextParticipantColor(participants: TeamParticipant[]): string {
    const used = new Set(participants.map((participant) => participant.color))
    return PARTICIPANT_COLORS.find((color) => !used.has(color))
        ?? PARTICIPANT_COLORS[participants.length % PARTICIPANT_COLORS.length]
}

export default function TeamChatDetailPage() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const search = useSearch({ strict: false }) as { machine?: string; project?: string }
    const params = useParams({ strict: false }) as { teamChatId?: string }
    const teamChatId = params.teamChatId ?? null
    const { teamChat, isLoading } = useTeamChat(api, teamChatId)
    const { sessions } = useSessions(api)
    const { machines } = useMachines(api, true)
    const { messages } = useTeamChatMessages(api, teamChatId)
    const { participants } = useTeamChatParticipants(api, teamChatId)
    const { requests: mentionRequests } = useTeamChatMentionRequests(api, teamChatId, participants)
    const [aroundMessages, setAroundMessages] = useState<TeamChatMessage[]>([])
    const currentParticipant = participants.find((participant) => participant.type === 'user') ?? participants[0] ?? null
    const { sendTeamMessage, addTeamParticipant, updateTeamParticipant, removeTeamParticipant, deleteTeamChat, isPending } = useTeamChatActions(api, teamChatId)
    const [directChatParticipant, setDirectChatParticipant] = useState<TeamParticipant | null>(null)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)

    if (isLoading) {
        return <div className="p-3 text-sm text-[var(--app-hint)]">Loading Team Chat…</div>
    }

    const mergedMessages = mergeMessages(messages, aroundMessages)
    const editorProject = teamChat?.projectPath ?? search.project
    const editorMachine = search.machine
    const defaultMachineId = editorMachine
        ?? sessions.find((session) => session.metadata?.machineId)?.metadata?.machineId
        ?? machines[0]?.id
        ?? null

    return (
        <>
            <TeamChatLayout
                teamChat={teamChat}
                messages={mergedMessages}
                participants={participants}
                mentionRequests={mentionRequests}
                currentParticipantId={currentParticipant?.id ?? null}
                onSend={(text) => {
                    if (!currentParticipant) return
                    void sendTeamMessage({ authorParticipantId: currentParticipant.id, text })
                }}
                onOpenTeamChats={() => navigate({
                    to: '/team-chats',
                    search: {
                        machine: editorMachine,
                        project: editorProject
                    } as never
                })}
                onOpenAgentMode={() => navigate({ to: '/sessions' })}
                onOpenEditorMode={() => navigate({
                    to: '/editor',
                    search: {
                        machine: editorMachine,
                        project: editorProject
                    } as never
                })}
                onDeleteTeamChat={teamChat ? () => {
                    setDeleteError(null)
                    setDeleteConfirmOpen(true)
                } : undefined}
                api={api}
                availableSessions={sessions}
                machines={machines}
                defaultMachineId={defaultMachineId}
                defaultProjectPath={editorProject ?? null}
                onAddSession={(session, alias) => {
                    if (!teamChatId) return
                    return addTeamParticipant({
                        type: 'session',
                        sessionId: session.id,
                        displayName: alias,
                        role: 'general',
                        color: getNextParticipantColor(participants)
                    })
                }}
                onCreateSessionMember={api && teamChatId ? async (input) => {
                    await configureTeamSessionMember({
                        api,
                        sessionId: input.sessionId,
                        label: input.label,
                        alias: input.alias,
                        color: getNextParticipantColor(participants),
                        initialTask: input.initialTask,
                        addTeamParticipant
                    })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.session(input.sessionId) })
                } : undefined}
                onOpenSession={(participant) => setDirectChatParticipant(participant)}
                onUpdateParticipant={(participant, input) => updateTeamParticipant({
                    participantId: participant.id,
                    sessionId: participant.sessionId,
                    ...input
                })}
                onRemoveParticipant={(participant) => removeTeamParticipant({
                    participantId: participant.id,
                    sessionId: participant.sessionId
                })}
                onLoadAround={async (messageId) => {
                    if (!api || !teamChatId || !messageId) return
                    const response = await api.getTeamMessagesAround(teamChatId, messageId)
                    setAroundMessages((current) => mergeMessages(current, response.messages))
                }}
            />
            {api && directChatParticipant?.sessionId ? (
                <Suspense fallback={
                    <AppDialog open onOpenChange={(open) => !open && setDirectChatParticipant(null)}>
                        <AppDialogContent presentation="workspace" dismissible={false} className="max-w-sm">
                            <AppDialogHeader
                                title="Loading direct chat"
                                mobileNavigation="back"
                                mobileBackLabel="Back to Team Chat"
                                onMobileBack={() => setDirectChatParticipant(null)}
                            />
                            <AppDialogBody className="px-4 py-3 text-sm text-[var(--app-hint)]">
                                Loading direct chat…
                            </AppDialogBody>
                        </AppDialogContent>
                    </AppDialog>
                }>
                    <TeamSessionChatModal
                        api={api}
                        sessionId={directChatParticipant.sessionId}
                        alias={directChatParticipant.displayName}
                        onClose={() => setDirectChatParticipant(null)}
                        onOpenFullSession={(sessionId) => {
                            setDirectChatParticipant(null)
                            void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                        }}
                    />
                </Suspense>
            ) : null}
            {deleteConfirmOpen && teamChat && teamChatId ? (
                <AppDialog open onOpenChange={(open) => !open && setDeleteConfirmOpen(false)}>
                    <AppDialogContent presentation="alert" dismissible={false} className="max-w-md text-[var(--app-fg)]">
                        <AppDialogHeader
                            title="Delete Team Chat?"
                            closeDisabled={isPending}
                            subtitle={(
                                <span>
                                    This archives <span className="font-medium text-[var(--app-fg)]">{teamChat.name}</span>.
                                </span>
                            )}
                        />
                        <AppDialogBody className="p-4 text-sm text-[var(--app-hint)]">
                            <div>Sessions in this Team Chat will not be deleted.</div>
                        {deleteError ? <div className="mt-3 rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{deleteError}</div> : null}
                        </AppDialogBody>
                        <AppDialogFooter>
                            <button
                                type="button"
                                disabled={isPending}
                                onClick={() => setDeleteConfirmOpen(false)}
                                className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                    void (async () => {
                                        try {
                                            await deleteTeamChat(teamChatId)
                                            setDeleteConfirmOpen(false)
                                            navigate({
                                                to: '/team-chats',
                                                search: {
                                                    machine: editorMachine,
                                                    project: editorProject
                                                } as never
                                            })
                                        } catch (error) {
                                            setDeleteError(error instanceof Error ? error.message : 'Failed to delete Team Chat.')
                                        }
                                    })()
                                }}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                Delete Team Chat
                            </button>
                        </AppDialogFooter>
                    </AppDialogContent>
                </AppDialog>
            ) : null}
        </>
    )
}
