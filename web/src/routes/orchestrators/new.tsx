import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useSessions } from '@/hooks/queries/useSessions'
import { useCreateOrchestrator } from '@/hooks/mutations/useOrchestratorMutations'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { ActionButtons } from '@/components/NewSession/ActionButtons'

const ORCHESTRATOR_DEFAULTS_STORAGE_KEY = 'hapi:orchestrator:new:defaults'
const DEFAULT_MODEL = 'gpt-5.4'

type OrchestratorDefaults = {
    sessionGoal: string
    systemPrompt: string
    model: string
    openaiBaseUrl: string
    openaiApiKey: string
}

function loadOrchestratorDefaults(): OrchestratorDefaults {
    try {
        const raw = localStorage.getItem(ORCHESTRATOR_DEFAULTS_STORAGE_KEY)
        if (!raw) {
            return {
                sessionGoal: '',
                systemPrompt: '',
                model: DEFAULT_MODEL,
                openaiBaseUrl: '',
                openaiApiKey: '',
            }
        }
        const parsed = JSON.parse(raw) as Partial<OrchestratorDefaults>
        return {
            sessionGoal: typeof parsed.sessionGoal === 'string' ? parsed.sessionGoal : '',
            systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
            model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : DEFAULT_MODEL,
            openaiBaseUrl: typeof parsed.openaiBaseUrl === 'string' ? parsed.openaiBaseUrl : '',
            openaiApiKey: typeof parsed.openaiApiKey === 'string' ? parsed.openaiApiKey : '',
        }
    } catch {
        return {
            sessionGoal: '',
            systemPrompt: '',
            model: DEFAULT_MODEL,
            openaiBaseUrl: '',
            openaiApiKey: '',
        }
    }
}

function saveOrchestratorDefaults(defaults: OrchestratorDefaults): void {
    try {
        localStorage.setItem(ORCHESTRATOR_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults))
    } catch {
        // Ignore storage write errors.
    }
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

export default function OrchestratorNewPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { sessions, isLoading: sessionsLoading } = useSessions(api)
    const createMutation = useCreateOrchestrator(api)

    const defaults = useMemo(loadOrchestratorDefaults, [])

    const [sessionId, setSessionId] = useState('')
    const [initialMessage, setInitialMessage] = useState('')
    const [sessionGoal, setSessionGoal] = useState(defaults.sessionGoal)
    const [systemPrompt, setSystemPrompt] = useState(defaults.systemPrompt)
    const [model, setModel] = useState(defaults.model)
    const [openaiBaseUrl, setOpenaiBaseUrl] = useState(defaults.openaiBaseUrl)
    const [openaiApiKey, setOpenaiApiKey] = useState(defaults.openaiApiKey)

    const canCreate = useMemo(() => {
        return Boolean(
            sessionId.trim()
            && initialMessage.trim()
            && model.trim()
            && openaiApiKey.trim()
        )
    }, [sessionId, initialMessage, model, openaiApiKey])

    const onCreate = useCallback(async () => {
        if (!api || !canCreate) {
            return
        }
        try {
            const res = await createMutation.mutateAsync({
                sessionId: sessionId.trim(),
                initialMessage: initialMessage.trim(),
                sessionGoal: sessionGoal.trim() || undefined,
                systemPrompt: systemPrompt.trim() || undefined,
                model: model.trim(),
                openaiBaseUrl: openaiBaseUrl.trim() || undefined,
                openaiApiKey: openaiApiKey.trim(),
            })
            saveOrchestratorDefaults({
                sessionGoal: sessionGoal.trim(),
                systemPrompt: systemPrompt.trim(),
                model: model.trim(),
                openaiBaseUrl: openaiBaseUrl.trim(),
                openaiApiKey: openaiApiKey.trim(),
            })
            navigate({
                to: '/orchestrators/$id',
                params: { id: res.orchestrator.id },
            })
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            addToast({
                title: t('orchestrator.error'),
                body: message,
                sessionId: '',
                url: '',
            })
        }
    }, [
        api,
        canCreate,
        createMutation,
        sessionId,
        initialMessage,
        sessionGoal,
        systemPrompt,
        model,
        openaiBaseUrl,
        openaiApiKey,
        navigate,
        addToast,
        t,
    ])

    const fieldClass =
        'mt-1 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]'

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
                <div className="flex-1 font-semibold">{t('orchestrator.new')}</div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0 px-3 pt-3"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {sessionsLoading ? (
                    <LoadingState label={t('misc.loading')} className="text-sm" />
                ) : (
                    <div className="mx-auto w-full max-w-content flex flex-col gap-4 pb-4">
                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.session')}</span>
                            <select
                                className={fieldClass}
                                value={sessionId}
                                onChange={(e) => setSessionId(e.target.value)}
                            >
                                <option value="">—</option>
                                {(sessions ?? []).map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.metadata?.name ?? s.metadata?.path ?? s.id.slice(0, 8)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.initialMessage')}</span>
                            <textarea
                                className={`${fieldClass} min-h-[100px] font-mono`}
                                value={initialMessage}
                                onChange={(e) => setInitialMessage(e.target.value)}
                                placeholder="First instruction to the coding agent…"
                            />
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.sessionGoal')}</span>
                            <textarea
                                className={`${fieldClass} min-h-[80px]`}
                                value={sessionGoal}
                                onChange={(e) => setSessionGoal(e.target.value)}
                            />
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.systemPrompt')}</span>
                            <textarea
                                className={`${fieldClass} min-h-[80px]`}
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.model')}</span>
                            <input
                                className={fieldClass}
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                            />
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.baseUrl')}</span>
                            <input
                                className={`${fieldClass} font-mono text-xs`}
                                value={openaiBaseUrl}
                                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                            />
                        </label>

                        <label className="block text-sm">
                            <span className="text-[var(--app-hint)]">{t('orchestrator.apiKey')}</span>
                            <input
                                type="password"
                                autoComplete="off"
                                className={fieldClass}
                                value={openaiApiKey}
                                onChange={(e) => setOpenaiApiKey(e.target.value)}
                            />
                        </label>
                    </div>
                )}
            </div>

            <ActionButtons
                isPending={createMutation.isPending}
                canCreate={canCreate}
                isDisabled={sessionsLoading}
                createLabel={t('orchestrator.start')}
                onCancel={goBack}
                onCreate={() => void onCreate()}
            />
        </div>
    )
}
