import { useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useOrchestrator, useOrchestratorAuditLog, useOrchestratorTranscript } from '@/hooks/queries/useOrchestrators'
import { useOrchestratorControl } from '@/hooks/mutations/useOrchestratorMutations'
import { useTranslation } from '@/lib/use-translation'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { OrchestratorPublic } from '@/types/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

function formatMessageRef(
    transcript: Array<{ id: string; role: string; content: string }>,
    messageId: string | null
): string {
    if (!messageId) {
        return 'msg n/a'
    }

    const matched = transcript.find((entry) => entry.id === messageId)
    if (!matched) {
        return `msg ...${messageId.slice(-8)}`
    }

    const previewBase = matched.content.replace(/\s+/g, ' ').trim()
    const preview = previewBase.length > 80 ? `${previewBase.slice(0, 80)}...` : previewBase
    return `[${matched.role}] ${preview || '(empty)'}`
}

function formatSeqLabel(seq: number | null | undefined): string {
    return typeof seq === 'number' ? `Msg #${seq}` : 'seq unknown'
}

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function statusVariant(status: OrchestratorPublic['status']): 'default' | 'success' | 'warning' | 'destructive' {
    switch (status) {
        case 'running':
            return 'success'
        case 'paused':
            return 'warning'
        case 'error':
            return 'destructive'
        case 'done':
            return 'default'
        default:
            return 'default'
    }
}

export default function OrchestratorDetailPage() {
    const { api } = useAppContext()
    const { id } = useParams({ from: '/orchestrators/$id' })
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const { data: orch, isLoading, isError, error, refetch } = useOrchestrator(api, id)
    const { data: transcriptData, refetch: refetchTranscript } = useOrchestratorTranscript(api, id)
    const { data: auditData, refetch: refetchAuditLog } = useOrchestratorAuditLog(api, id)
    const { pause, resume, stop } = useOrchestratorControl(api, id)
    const [stopOpen, setStopOpen] = useState(false)

    const transcript = transcriptData?.transcript ?? []
    const auditLog = auditData?.auditLog ?? []

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Orchestrator</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{id}</div>
                    </div>
                </div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0 p-3"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {isLoading ? (
                    <LoadingState label={t('misc.loading')} className="text-sm" />
                ) : isError || !orch ? (
                    <div className="space-y-2 text-sm">
                        <p className="text-[var(--app-hint)]">
                            {error instanceof Error ? error.message : t('orchestrator.empty')}
                        </p>
                        <Button type="button" variant="secondary" onClick={() => void navigate({ to: '/orchestrators' })}>
                            {t('orchestrator.list')}
                        </Button>
                    </div>
                ) : (
                    <div className="mx-auto w-full max-w-content flex flex-col gap-4">
                        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={statusVariant(orch.status)}>{orch.status}</Badge>
                                <span className="text-xs text-[var(--app-hint)]">{orch.model}</span>
                                <span className="text-xs text-[var(--app-hint)]">{orch.messageCount} msgs</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" asChild>
                                    <Link
                                        to="/sessions/$sessionId"
                                        params={{ sessionId: orch.sessionId }}
                                    >
                                        {t('orchestrator.openSession')}
                                    </Link>
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        void refetch()
                                        void refetchTranscript()
                                        void refetchAuditLog()
                                    }}
                                >
                                    {t('orchestrator.refresh')}
                                </Button>
                            </div>
                        </div>

                        {orch.error ? (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                                {orch.error}
                            </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                            {orch.status === 'running' ? (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={pause.isPending}
                                    onClick={() => void pause.mutateAsync()}
                                >
                                    {t('orchestrator.pause')}
                                </Button>
                            ) : null}
                            {orch.status === 'paused' ? (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={resume.isPending}
                                    onClick={() => void resume.mutateAsync()}
                                >
                                    {t('orchestrator.resume')}
                                </Button>
                            ) : null}
                            {(orch.status === 'running' || orch.status === 'paused' || orch.status === 'error') ? (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    disabled={stop.isPending}
                                    onClick={() => setStopOpen(true)}
                                >
                                    {t('orchestrator.stop')}
                                </Button>
                            ) : null}
                        </div>

                        <div>
                            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                {t('orchestrator.transcript')}
                            </h2>
                            <ul className="flex flex-col gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                                {transcript.length === 0 ? (
                                    <li className="text-sm text-[var(--app-hint)]">…</li>
                                ) : (
                                    transcript.map((line) => (
                                        <li key={line.id} className="rounded-md bg-[var(--app-secondary-bg)] px-3 py-2 text-sm">
                                            <span className="font-medium uppercase tracking-wide text-[var(--app-hint)]">{line.role}</span>
                                            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[var(--app-fg)]">
                                                {line.content}
                                            </pre>
                                        </li>
                                    ))
                                )}
                            </ul>
                        </div>

                        <div>
                            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                Audit Log
                            </h2>
                            <ul className="flex flex-col gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                                {auditLog.length === 0 ? (
                                    <li className="text-sm text-[var(--app-hint)]">…</li>
                                ) : (
                                    auditLog.map((entry, index) => (
                                        <li key={`${entry.ts}-${entry.type}-${index}`} className="rounded-md bg-[var(--app-secondary-bg)] px-3 py-2 text-sm">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium uppercase tracking-wide text-[var(--app-hint)]">{entry.type}</span>
                                                <span className="text-xs text-[var(--app-hint)]">{new Date(entry.ts).toLocaleString()}</span>
                                                {entry.type === 'done-check' ? (
                                                    <Badge variant={entry.llmAnswer === 'YES' ? 'success' : 'default'}>
                                                        {entry.llmAnswer}
                                                    </Badge>
                                                ) : null}
                                            </div>
                                            {entry.type === 'done-check' ? (
                                                <div className="mt-1 text-xs text-[var(--app-hint)]">
                                                    {formatMessageRef(transcript, entry.triggeredByMessageId)}
                                                    {' | '}
                                                    {formatSeqLabel(entry.triggeredBySeq)}
                                                    {' | '}
                                                    History: {entry.historySize} msgs
                                                    {' | '}
                                                    Evaluated: {entry.evaluatedMessagePreview}
                                                </div>
                                            ) : null}
                                            {entry.type === 'reply-generated' ? (
                                                <div className="mt-1 text-xs text-[var(--app-hint)]">
                                                    {formatMessageRef(transcript, entry.triggeredByMessageId)}
                                                    {' | '}
                                                    {formatSeqLabel(entry.triggeredBySeq)}
                                                </div>
                                            ) : null}
                                            {entry.type === 'system-event' ? (
                                                <div className="mt-1 text-xs text-[var(--app-hint)]">{entry.reason}</div>
                                            ) : null}
                                        </li>
                                    ))
                                )}
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            <ConfirmDialog
                isOpen={stopOpen}
                onClose={() => setStopOpen(false)}
                title={t('orchestrator.stop')}
                description="Stop this orchestrator run? This cannot be undone."
                confirmLabel={t('orchestrator.stop')}
                confirmingLabel={t('misc.loading')}
                isPending={stop.isPending}
                destructive
                onConfirm={async () => {
                    await stop.mutateAsync()
                    void navigate({ to: '/orchestrators' })
                }}
            />
        </div>
    )
}
