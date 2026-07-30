import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTeamChats } from '@/hooks/queries/useTeamChats'
import { useTeamChatActions } from '@/hooks/mutations/useTeamChatActions'
import type { TeamChat } from '@/types/api'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'

function getProjectName(project?: string): string {
    if (!project) return 'Team Chat'
    const parts = project.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ? `${parts.at(-1)} Team` : 'Team Chat'
}

export default function TeamChatsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const search = useSearch({ strict: false }) as { machine?: string; project?: string }
    const { teamChats, isLoading, error } = useTeamChats(api)
    const { createTeamChat, addTeamParticipantTo, deleteTeamChat, isPending } = useTeamChatActions(api, null)
    const [createOpen, setCreateOpen] = useState(false)
    const [teamName, setTeamName] = useState('')
    const [projectPath, setProjectPath] = useState('')
    const [createError, setCreateError] = useState<string | null>(null)
    const [deleteCandidate, setDeleteCandidate] = useState<TeamChat | null>(null)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const defaultTeamName = useMemo(() => getProjectName(search.project), [search.project])

    const openCreateDialog = () => {
        setTeamName(defaultTeamName)
        setProjectPath(search.project ?? '')
        setCreateError(null)
        setCreateOpen(true)
    }

    const handleCreateTeamChat = async () => {
        const normalizedName = teamName.trim()
        if (!normalizedName) {
            setCreateError('Team Chat name is required.')
            return
        }
        setCreateError(null)
        const normalizedProjectPath = projectPath.trim()
        try {
            const teamChatId = await createTeamChat({
                name: normalizedName,
                projectPath: normalizedProjectPath || null
            })
            await addTeamParticipantTo(teamChatId, {
                type: 'user',
                userId: null,
                sessionId: null,
                displayName: 'You',
                role: 'general',
                color: '#34d399'
            })
            setCreateOpen(false)
            navigate({
                to: '/team-chats/$teamChatId',
                params: { teamChatId },
                search: {
                    machine: search.machine,
                    project: normalizedProjectPath || search.project
                } as never
            })
        } catch (createFailure) {
            setCreateError(createFailure instanceof Error ? createFailure.message : 'Failed to create Team Chat.')
        }
    }

    const handleDeleteTeamChat = async () => {
        if (!deleteCandidate) return
        setDeleteError(null)
        try {
            await deleteTeamChat(deleteCandidate.id)
            setDeleteCandidate(null)
        } catch (deleteFailure) {
            setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : 'Failed to delete Team Chat.')
        }
    }

    if (isLoading) {
        return <div className="p-3 text-sm text-[var(--app-hint)]">Loading Team Chats…</div>
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)] text-[var(--app-fg)]">
            <div className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                        Team Chat
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">Team Chats</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">
                            Collaborate across HAPI sessions{search.project ? ` · ${search.project}` : ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={openCreateDialog}
                        className="rounded-md bg-[var(--app-button)] px-2.5 py-1 text-xs font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90"
                    >
                        + New Team Chat
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/sessions' })}
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                    >
                        Agent Mode
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate({
                            to: '/editor',
                            search: {
                                machine: search.machine,
                                project: search.project
                            } as never
                        })}
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                    >
                        Editor
                    </button>
                </div>
            </div>
            {error ? <div className="p-3 text-sm text-red-600">{error}</div> : null}
            <div className="app-scroll-y flex-1 min-h-0 p-3">
                {teamChats.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] p-5 text-sm text-[var(--app-hint)]">
                        <div className="text-sm font-semibold text-[var(--app-fg)]">No Team Chats yet.</div>
                        <div className="mt-1">Create a room first, then add the sessions you want from the member panel.</div>
                        <button
                            type="button"
                            onClick={openCreateDialog}
                            className="mt-3 rounded-md bg-[var(--app-button)] px-3 py-1.5 text-xs font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90"
                        >
                            Create first Team Chat
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {teamChats.map((chat) => (
                            <div
                                key={chat.id}
                                className="flex items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] p-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                <Link
                                    to="/team-chats/$teamChatId"
                                    params={{ teamChatId: chat.id }}
                                    search={{
                                        machine: search.machine,
                                        project: search.project
                                    } as never}
                                    className="min-w-0 flex-1 rounded-lg px-1 py-1"
                                >
                                    <div className="truncate text-sm font-medium">{chat.name}</div>
                                    {chat.projectPath ? <div className="mt-1 truncate text-xs text-[var(--app-hint)]">{chat.projectPath}</div> : null}
                                </Link>
                                <button
                                    type="button"
                                    aria-label={`Delete ${chat.name}`}
                                    onClick={() => {
                                        setDeleteCandidate(chat)
                                        setDeleteError(null)
                                    }}
                                    className="shrink-0 rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {createOpen ? (
                <AppDialog open onOpenChange={(open) => !open && setCreateOpen(false)}>
                    <AppDialogContent presentation="alert" dismissible={false} className="max-w-md text-[var(--app-fg)]">
                        <AppDialogHeader
                            title="New Team Chat"
                            subtitle="Start with an empty room. You can add sessions after it opens."
                            closeDisabled={isPending}
                        />
                        <AppDialogBody className="space-y-3 p-4">
                            <div>
                                <label htmlFor="team-chat-name" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Team Chat name</label>
                                <input
                                    id="team-chat-name"
                                    aria-label="Team Chat name"
                                    value={teamName}
                                    onChange={(event) => setTeamName(event.target.value)}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)]"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label htmlFor="team-chat-project" className="mb-1 block text-xs font-medium text-[var(--app-hint)]">Project path</label>
                                <input
                                    id="team-chat-project"
                                    aria-label="Project path"
                                    value={projectPath}
                                    onChange={(event) => setProjectPath(event.target.value)}
                                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-card-bg,var(--app-bg))] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)]"
                                    placeholder="Optional"
                                />
                            </div>
                        {createError ? <div className="mt-3 rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">{createError}</div> : null}
                        </AppDialogBody>
                        <AppDialogFooter>
                            <button
                                type="button"
                                disabled={isPending}
                                onClick={() => setCreateOpen(false)}
                                className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isPending || !teamName.trim()}
                                onClick={() => { void handleCreateTeamChat() }}
                                className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                Create Team Chat
                            </button>
                        </AppDialogFooter>
                    </AppDialogContent>
                </AppDialog>
            ) : null}
            {deleteCandidate ? (
                <AppDialog open onOpenChange={(open) => !open && setDeleteCandidate(null)}>
                    <AppDialogContent presentation="alert" dismissible={false} className="max-w-md text-[var(--app-fg)]">
                        <AppDialogHeader
                            title="Delete Team Chat?"
                            closeDisabled={isPending}
                            subtitle={(
                                <span>
                                    This archives <span className="font-medium text-[var(--app-fg)]">{deleteCandidate.name}</span>.
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
                                onClick={() => setDeleteCandidate(null)}
                                className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isPending}
                                onClick={() => { void handleDeleteTeamChat() }}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                Delete Team Chat
                            </button>
                        </AppDialogFooter>
                    </AppDialogContent>
                </AppDialog>
            ) : null}
        </div>
    )
}
