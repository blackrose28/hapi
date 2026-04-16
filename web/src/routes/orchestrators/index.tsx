import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useOrchestrators } from '@/hooks/queries/useOrchestrators'
import { useTranslation } from '@/lib/use-translation'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { OrchestratorPublic } from '@/types/api'

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

export default function OrchestratorListPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const { data: list, isLoading, error } = useOrchestrators(api)

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <button
                    type="button"
                    onClick={goBack}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                >
                    <BackIcon />
                </button>
                <div className="flex-1 font-semibold">{t('orchestrator.list')}</div>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => navigate({ to: '/orchestrators/new' })}
                >
                    {t('orchestrator.new')}
                </Button>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0 p-3"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {isLoading ? (
                    <LoadingState label={t('misc.loading')} className="text-sm" />
                ) : error ? (
                    <div className="text-sm text-red-600">{String(error)}</div>
                ) : !list?.length ? (
                    <p className="text-sm text-[var(--app-hint)]">{t('orchestrator.empty')}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {list.map((o) => (
                            <li key={o.id}>
                                <button
                                    type="button"
                                    onClick={() => navigate({
                                        to: '/orchestrators/$id',
                                        params: { id: o.id },
                                    })}
                                    className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate font-medium text-sm">{o.sessionId.slice(0, 12)}…</span>
                                        <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--app-hint)]">
                                        {o.model} · {o.messageCount} msgs
                                        {o.error ? ` · ${o.error}` : ''}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}
