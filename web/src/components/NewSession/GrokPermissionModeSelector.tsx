import {
    getPermissionModeOptionsForFlavor,
    type GrokPermissionMode
} from '@hapi/protocol'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType } from './types'

// NOTE: upstream also offers an 'auto' permission mode here (Grok classifies
// safe tool calls automatically) with an "unavailable" fallback state. Our
// GROK_PERMISSION_MODES intentionally omits 'auto' this round — it depends on
// the master PERMISSION_MODES enum gaining 'auto', which is the separate,
// still-pending `claude-permission-mode-auto` cart. Re-add the auto option
// (and the autoPermissionModeSupported unavailable messaging) once that lands.
export function GrokPermissionModeSelector(props: {
    agent: AgentType
    value: GrokPermissionMode
    isDisabled: boolean
    onChange: (value: GrokPermissionMode) => void
}) {
    const { t } = useTranslation()

    if (props.agent !== 'grok') return null

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('misc.permissionMode')}
            </label>
            <select
                value={props.value}
                onChange={(event) => props.onChange(event.target.value as GrokPermissionMode)}
                disabled={props.isDisabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {getPermissionModeOptionsForFlavor('grok').map((option) => (
                    <option key={option.mode} value={option.mode}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    )
}
