import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow } from '@/lib/message-window-store'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { classifySessionAttention } from '@/lib/sessionAttention'
import { getAttentionLabel, SessionAttentionIndicator } from '@/components/SessionAttentionIndicator'
import { HoverTooltip, SESSION_ROW_TOOLTIP_FOCUS_CLASS, useSessionRowTooltipIds } from '@/components/HoverTooltip'
import { formatRelativeTime } from '@/lib/relativeTime'
import { formatScheduledTooltipDetail } from '@/lib/scheduledTime'
import { formatReopenError } from '@/lib/reopenError'
import { compareSessionGroupOrder } from '@/lib/session-group-order'
import { getArchiveAllDescription, getArchiveSessionDescription, getTotalKnownTerminalLiveCount } from '@/lib/archiveConfirmation'
import { getCodexImportedAt, subscribeCodexImportedSessions } from '@/lib/codexImportedSessions'

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

function SessionsEmptyState(props: {
    onNewSession: () => void
    onBrowse?: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--app-hint)] opacity-60"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 14h8" />
                <path d="M8 17h5" />
            </svg>
            <div className="text-base font-medium text-[var(--app-fg)]">
                {t('sessions.empty.title')}
            </div>
            <div className="max-w-sm text-sm text-[var(--app-hint)]">
                {t('sessions.empty.hint')}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
                >
                    {t('sessions.empty.startSession')}
                </button>
                {props.onBrowse && (
                    <button
                        type="button"
                        onClick={props.onBrowse}
                        className="px-4 py-1.5 text-sm rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('sessions.empty.browse')}
                    </button>
                )}
            </div>
        </div>
    )
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    hasActiveSession: boolean
    latestUpdatedAt: number
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export const UNKNOWN_MACHINE_ID = '__unknown__'
export const GROUP_SESSION_PREVIEW_LIMIT = 8

export function deduplicateSessionsByAgentId(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    const byAgentId = new Map<string, SessionSummary[]>()
    const result: SessionSummary[] = []

    for (const session of sessions) {
        const agentId = session.metadata?.agentSessionId
        if (!agentId) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(agentId)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(agentId, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? UNKNOWN_MACHINE_ID}::${path}`
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: []
            })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = [...group.sessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = group.sessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = group.sessions.some(s => s.active)
            const displayName = getGroupDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession
            }
        })
        .sort((a, b) => compareSessionGroupOrder({
            label: a.displayName,
            latestUpdatedAt: a.latestUpdatedAt,
            hasActiveSession: a.hasActiveSession
        }, {
            label: b.displayName,
            latestUpdatedAt: b.latestUpdatedAt,
            hasActiveSession: b.hasActiveSession
        }))
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    for (const g of groups) {
        const key = g.machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId: g.machineId,
                label: resolveMachineLabel(g.machineId),
                projectGroups: [],
                totalSessions: 0,
                hasActiveSession: false,
                latestUpdatedAt: 0,
            }
            map.set(key, mg)
        }
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.hasActiveSession) mg.hasActiveSession = true
        if (g.latestUpdatedAt > mg.latestUpdatedAt) mg.latestUpdatedAt = g.latestUpdatedAt
    }
    return [...map.values()].sort((a, b) => compareSessionGroupOrder({
        label: a.label,
        latestUpdatedAt: a.latestUpdatedAt,
        hasActiveSession: a.hasActiveSession
    }, {
        label: b.label,
        latestUpdatedAt: b.latestUpdatedAt,
        hasActiveSession: b.hasActiveSession
    }))
}

function CopyPathButton({ path, className }: { path: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-[var(--app-badge-success-text)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'} ${className ?? ''}`}
            title={copied ? 'Copied!' : `Copy: ${path}`}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5" />
                : <CopyIcon className="h-3.5 w-3.5" />
            }
        </button>
    )
}


function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function LoaderIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
        </svg>
    )
}


function EditorIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m8 10 3 3-3 3" />
            <path d="M13 16h3" />
        </svg>
    )
}

function ArchiveBoxIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <rect x="2" y="3" width="20" height="5" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

export function getSessionTitle(session: SessionSummary): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

export function normalizeSearch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

export function sessionMatchesQuery(session: SessionSummary, query: string, machineLabel: string): boolean {
    if (!query) return true
    const searchable = [
        getSessionTitle(session),
        session.id,
        session.metadata?.path,
        session.metadata?.worktree?.basePath,
        session.metadata?.name,
        session.metadata?.summary?.text,
        session.metadata?.flavor,
        machineLabel,
    ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n')
        .toLowerCase()
    return searchable.includes(query)
}


export function getVisibleSessionPreview(
    sessions: SessionSummary[],
    options: {
        expanded?: boolean
        selectedSessionId?: string | null
        limit?: number
    } = {}
): SessionSummary[] {
    const limit = options.limit ?? GROUP_SESSION_PREVIEW_LIMIT
    if (options.expanded || sessions.length <= limit) return sessions

    const requiredIds = new Set<string>()
    for (const session of sessions) {
        if (session.active) requiredIds.add(session.id)
    }
    if (options.selectedSessionId && sessions.some(session => session.id === options.selectedSessionId)) {
        requiredIds.add(options.selectedSessionId)
    }

    const visible: SessionSummary[] = sessions.filter((session, index) => {
        return index < limit || requiredIds.has(session.id)
    })

    for (let index = visible.length - 1; visible.length > limit && index >= 0; index -= 1) {
        const session = visible[index]
        if (!session || requiredIds.has(session.id)) continue
        visible.splice(index, 1)
    }

    return visible
}

function SessionListSearch(props: {
    value: string
    onChange: (value: string) => void
}) {
    const { t } = useTranslation()
    return (
        <div className="relative px-3 pb-2">
            <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-hint)]" />
            <input
                type="search"
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={t('sessions.search.placeholder')}
                className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-8 pr-8 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)]"
            />
            {props.value ? (
                <button
                    type="button"
                    onClick={() => props.onChange('')}
                    className="absolute right-5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    title={t('sessions.search.clear')}
                >
                    <XIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    )
}

const FLAVOR_BADGES: Record<string, { label: string; colors: string }> = {
    claude: {
        label: 'Cl',
        colors: 'bg-[#d97706] text-white',
    },
    codex: {
        label: 'Cx',
        colors: 'bg-[#111827] text-white',
    },
    cursor: {
        label: 'Cu',
        colors: 'bg-[#0f766e] text-white',
    },
    gemini: {
        label: 'Gm',
        colors: 'bg-[#2563eb] text-white',
    },
    kimi: {
        label: 'Km',
        colors: 'bg-[#7c3aed] text-white',
    },
    grok: {
        label: 'Gr',
        colors: 'bg-[#111111] text-white',
    },
    opencode: {
        label: 'Op',
        colors: 'bg-[#15803d] text-white',
    },
    pi: {
        label: 'Pi',
        colors: 'bg-[#5b21b6] text-white',
    },
}

function FlavorIcon({ flavor, className }: { flavor?: string | null; className?: string }) {
    const badge = FLAVOR_BADGES[(flavor ?? 'claude').trim().toLowerCase()] ?? FLAVOR_BADGES.claude
    return (
        <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none ${badge.colors} ${className ?? 'h-4 w-4'}`}
        >
            {badge.label}
        </span>
    )
}

function MachineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
    )
}


function ScheduleIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    )
}

function formatCodexImportedRelativeTime(
    value: number,
    t: (key: string, params?: Record<string, string | number>) => string
): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.importedFromCodex.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.importedFromCodex.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.importedFromCodex.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.importedFromCodex.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function getSessionTimeLabel(session: SessionSummary, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const codexSessionId = session.metadata?.agentSessionId
    const importedAt = session.metadata?.flavor === 'codex'
        ? getCodexImportedAt(codexSessionId)
        : null

    // 中文注释：导入标记存在时优先显示“xx 前从 Codex 客户端导入”；等用户在 Hapi 里继续发消息后，再由发送逻辑清除该标记。
    if (importedAt !== null) {
        return formatCodexImportedRelativeTime(importedAt, t)
    }

    return formatRelativeTime(session.updatedAt, t)
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
}) {
    const { t } = useTranslation()
    const showDetailedStatus = true
    const { session: s, onSelect, showPath = true, api, selected = false } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const { archiveSession, reopenSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleReopen = async () => {
        setReopenError(null)
        try {
            const result = await reopenSession()
            // resumeSession may merge the row into a freshly-spawned sessionId.
            // Follow it so the operator lands on the live session.
            if (result.sessionId && result.sessionId !== s.id) {
                onSelect(result.sessionId)
            }
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const todoProgress = getTodoProgress(s)
    const attention = useMemo(
        () => showDetailedStatus
            ? classifySessionAttention(s, {
                selected,
                lastSeenAt: undefined
            })
            : null,
        [s, selected, showDetailedStatus]
    )
    const attentionLabel = attention ? getAttentionLabel(attention, t) : null
    const scheduledCount = s.futureScheduledMessageCount ?? 0
    const scheduledLabel = scheduledCount > 1
        ? t('session.item.scheduledMessages', { count: scheduledCount })
        : t('session.item.scheduledMessage')
    const hasScheduleTooltip = showDetailedStatus && scheduledCount > 0
    const { attentionId, scheduleId, describedBy } = useSessionRowTooltipIds(
        Boolean(attention),
        hasScheduleTooltip
    )
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item group/session-row flex w-full flex-col gap-1 py-2 pl-2.5 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
                aria-describedby={describedBy}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        {/* Status dot */}
                        <span
                            className="shrink-0 inline-block rounded-full"
                            style={{
                                width: 7,
                                height: 7,
                                background: !s.active
                                    ? '#475569'
                                    : s.thinking
                                        ? '#818cf8'
                                        : s.pendingRequestsCount > 0
                                            ? '#f59e0b'
                                            : '#22c55e',
                                animation: s.active && (s.thinking || s.pendingRequestsCount > 0)
                                    ? 'sl-dot-pulse 1.4s ease-in-out infinite'
                                    : undefined,
                            }}
                            title={
                                !s.active ? 'Archived'
                                    : s.thinking ? 'Thinking…'
                                        : s.pendingRequestsCount > 0 ? `Waiting (${s.pendingRequestsCount})`
                                            : 'Active'
                            }
                        />
                        <FlavorIcon flavor={s.metadata?.flavor} className="h-4 w-4 shrink-0" />
                        <div className={`truncate text-sm font-medium ${s.active ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}>
                            {sessionName}
                        </div>
                        {s.active && s.thinking ? (
                            <LoaderIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)] animate-spin-slow" />
                        ) : attention ? (
                            <SessionAttentionIndicator
                                attention={attention}
                                summary={s}
                                label={attentionLabel ?? ''}
                                tooltipId={attentionId!}
                            />
                        ) : null}
                        {hasScheduleTooltip ? (
                            <HoverTooltip
                                id={scheduleId!}
                                target={<ScheduleIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />}
                                side="bottom"
                                align="start"
                                className="shrink-0"
                                revealOnParentFocusClass={SESSION_ROW_TOOLTIP_FOCUS_CLASS}
                            >
                                <span className="block">
                                    <span className="block font-medium">{scheduledLabel}</span>
                                    <span className="mt-1 block text-[var(--app-hint)]">
                                        {formatScheduledTooltipDetail(s, t)}
                                    </span>
                                </span>
                            </HoverTooltip>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                        {todoProgress ? (
                            <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                <BulbIcon className="h-3 w-3" />
                                {todoProgress.completed}/{todoProgress.total}
                            </span>
                        ) : null}
                        {s.pendingRequestsCount > 0 ? (
                            <span className="text-[var(--app-badge-warning-text)]">
                                {t('session.item.pending')} {s.pendingRequestsCount}
                            </span>
                        ) : null}
                        <span className="text-[var(--app-hint)]">
                            {getSessionTimeLabel(s, t)}
                        </span>
                    </div>
                </div>
                {showPath ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        {s.metadata?.path ?? s.id}
                    </div>
                ) : null}
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onReopen={handleReopen}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                />
            ) : null}

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={getArchiveSessionDescription(t, { name: sessionName, terminalLiveCount: s.terminalLiveCount })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

function ProjectGroupActions(props: {
    group: SessionGroup
    api: ApiClient | null
    onNewSessionInDirectory?: (input: { machineId: string | null; directory: string }) => void
}) {
    const { group, api, onNewSessionInDirectory } = props
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [archiveAllOpen, setArchiveAllOpen] = useState(false)
    const [deleteArchivedOpen, setDeleteArchivedOpen] = useState(false)

    const activeSessions = useMemo(() => group.sessions.filter(s => s.active), [group.sessions])
    const inactiveSessions = useMemo(() => group.sessions.filter(s => !s.active), [group.sessions])
    const editorProjectLabel = group.displayName.split(/[\\/]+/).filter(Boolean).pop() ?? group.displayName
    const canOpenInEditor = Boolean(group.machineId && group.directory && group.directory !== 'Other')

    const archiveAllMutation = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            for (const s of activeSessions) {
                try { await api.archiveSession(s.id) } catch { /* skip */ }
            }
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const deleteArchivedMutation = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            for (const s of inactiveSessions) {
                try {
                    await api.deleteSession(s.id)
                    clearMessageWindow(s.id)
                } catch { /* skip */ }
            }
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const handleArchiveAll = useCallback(async () => {
        await archiveAllMutation.mutateAsync()
    }, [archiveAllMutation])

    const handleDeleteArchived = useCallback(async () => {
        await deleteArchivedMutation.mutateAsync()
    }, [deleteArchivedMutation])

    if (activeSessions.length === 0 && inactiveSessions.length === 0) return null

    return (
        <>
            <div className="flex items-center gap-0 opacity-0 group-hover/project:opacity-100 transition-opacity duration-150 shrink-0">
                {onNewSessionInDirectory && group.directory && group.directory !== 'Other' ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onNewSessionInDirectory({
                                machineId: group.machineId,
                                directory: group.directory!
                            })
                        }}
                        className="p-1 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                        title="New session in this directory"
                        aria-label="New session in this directory"
                    >
                        <PlusIcon className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {canOpenInEditor ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            navigate({ to: '/editor', search: { machine: group.machineId!, project: group.directory } })
                        }}
                        className="p-1 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                        title="Open in Editor"
                        aria-label={`Open ${editorProjectLabel} in Editor`}
                    >
                        <EditorIcon className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {activeSessions.length > 0 ? (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setArchiveAllOpen(true) }}
                        className="p-1 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                        title={t('dialog.archiveAll.title')}
                    >
                        <ArchiveBoxIcon className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {inactiveSessions.length > 0 ? (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteArchivedOpen(true) }}
                        className="p-1 rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-[var(--app-subtle-bg)] transition-colors"
                        title={t('dialog.deleteArchived.title')}
                    >
                        <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                ) : null}
            </div>

            <ConfirmDialog
                isOpen={archiveAllOpen}
                onClose={() => setArchiveAllOpen(false)}
                title={t('dialog.archiveAll.title')}
                description={getArchiveAllDescription(t, {
                    sessionCount: activeSessions.length,
                    terminalLiveCount: getTotalKnownTerminalLiveCount(activeSessions)
                })}
                confirmLabel={t('dialog.archiveAll.confirm')}
                confirmingLabel={t('dialog.archiveAll.confirming')}
                onConfirm={handleArchiveAll}
                isPending={archiveAllMutation.isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteArchivedOpen}
                onClose={() => setDeleteArchivedOpen(false)}
                title={t('dialog.deleteArchived.title')}
                description={t('dialog.deleteArchived.description', { n: inactiveSessions.length })}
                confirmLabel={t('dialog.deleteArchived.confirm')}
                confirmingLabel={t('dialog.deleteArchived.confirming')}
                onConfirm={handleDeleteArchived}
                isPending={deleteArchivedMutation.isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onNewSessionInDirectory?: (input: { machineId: string | null; directory: string }) => void
    onBrowse?: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    machineLabelsById?: Record<string, string>
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, machineLabelsById = {} } = props
    const [searchQuery, setSearchQuery] = useState('')
    const [, setCodexImportedSessionsVersion] = useState(0)
    const normalizedQuery = normalizeSearch(searchQuery)
    const isSearching = normalizedQuery.length > 0

    useEffect(() => {
        // 中文注释：监听导入标记变化，让列表在“导入完成”或“用户已在 Hapi 中继续会话”后立即刷新时间文案。
        return subscribeCodexImportedSessions(() => {
            setCodexImportedSessionsVersion((value) => value + 1)
        })
    }, [])

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const allSessions = useMemo(
        () => deduplicateSessionsByAgentId(props.sessions, selectedSessionId),
        [props.sessions, selectedSessionId]
    )
    const visibleSessions = useMemo(
        () => isSearching
            ? allSessions.filter(session => sessionMatchesQuery(
                session,
                normalizedQuery,
                resolveMachineLabel(session.metadata?.machineId ?? null)
            ))
            : allSessions,
        [allSessions, isSearching, normalizedQuery, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const allGroups = useMemo(
        () => groupSessionsByDirectory(allSessions),
        [allSessions]
    )
    const groups = useMemo(
        () => groupSessionsByDirectory(visibleSessions),
        [visibleSessions]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        if (isSearching) return false
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId)
            : false
        return !group.hasActiveSession && !hasSelectedSession
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    const isSessionGroupExpanded = (group: SessionGroup): boolean => {
        if (isSearching || group.sessions.length <= GROUP_SESSION_PREVIEW_LIMIT) return true
        const key = `sessions::${group.key}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return !override
        return false
    }

    const toggleSessionGroup = (group: SessionGroup) => {
        const key = `sessions::${group.key}`
        const expanded = isSessionGroupExpanded(group)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, expanded)
            return next
        })
    }

    const getVisibleGroupSessions = (group: SessionGroup): SessionSummary[] => {
        return getVisibleSessionPreview(
            group.sessions,
            {
                expanded: isSessionGroupExpanded(group),
                selectedSessionId
            }
        )
    }

    const machineGroups = useMemo(
        () => groupByMachine(groups, resolveMachineLabel),
        [groups, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )

    const isMachineCollapsed = (mg: MachineGroup): boolean => {
        if (isSearching) return false
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return override
        const hasSelected = selectedSessionId
            ? mg.projectGroups.some(pg => pg.sessions.some(s => s.id === selectedSessionId))
            : false
        return !mg.hasActiveSession && !hasSelected
    }

    const toggleMachine = (mg: MachineGroup) => {
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const current = isMachineCollapsed(mg)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, !current)
            return next
        })
    }

    const prevSelectedSessionIdRef = useRef(selectedSessionId)
    useEffect(() => {
        if (!selectedSessionId) return
        if (prevSelectedSessionIdRef.current === selectedSessionId) return
        prevSelectedSessionIdRef.current = selectedSessionId
        setCollapseOverrides(prev => {
            const group = allGroups.find(g =>
                g.sessions.some(s => s.id === selectedSessionId)
            )
            if (!group) return prev
            const next = new Map(prev)
            let changed = false
            // Expand project group if collapsed
            if (prev.has(group.key) && prev.get(group.key)) {
                next.delete(group.key)
                changed = true
            }
            // Expand machine group if collapsed
            const machineKey = `machine::${group.machineId ?? UNKNOWN_MACHINE_ID}`
            if (prev.has(machineKey) && prev.get(machineKey)) {
                next.delete(machineKey)
                changed = true
            }
            return changed ? next : prev
        })
    }, [selectedSessionId, allGroups])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of allGroups) {
                knownKeys.add(g.key)
                knownKeys.add(`sessions::${g.key}`)
                knownKeys.add(`machine::${g.machineId ?? UNKNOWN_MACHINE_ID}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="session-list-scrollbar-offset mx-auto w-full max-w-content shrink-0">
            {renderHeader ? (
<<<<<<< HEAD
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {isSearching
                            ? t('sessions.search.count', { n: visibleSessions.length, total: allSessions.length })
                            : t('sessions.count', { n: props.sessions.length, m: allGroups.length })}
                    </div>
=======
                <div className="flex items-center justify-end px-2 py-1">
>>>>>>> adb9e209 (fix(web): stabilize session list alignment and scrolling (#1196))
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            {props.sessions.length > 0 ? (
                <SessionListSearch value={searchQuery} onChange={setSearchQuery} />
            ) : null}

            {props.sessions.length === 0 && (
                <SessionsEmptyState
                    onNewSession={props.onNewSession}
                    onBrowse={props.onBrowse}
                />
            )}

            {props.sessions.length > 0 && isSearching && visibleSessions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                    {t('sessions.search.noResults')}
                </div>
            ) : null}

<<<<<<< HEAD
            <div className="flex flex-col gap-3 px-2 pt-1 pb-2">
                {machineGroups.map((mg) => {
                    const machineCollapsed = isMachineCollapsed(mg)
                    return (
                        <div key={mg.machineId ?? UNKNOWN_MACHINE_ID}>
                            {/* Level 1: Machine */}
                            <button
                                type="button"
                                onClick={() => toggleMachine(mg)}
                                className="flex w-full items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] select-none"
=======
            {showMachineFilterBar ? (
                <MachineFilterBar
                    machines={machineFilters.map((mg) => {
                        const machine = mg.machineId ? machinesById[mg.machineId] : undefined
                        return {
                            id: mg.machineId ?? UNKNOWN_MACHINE_ID,
                            label: mg.label,
                            sessionCount: mg.totalSessions,
                            healthPresentation: presentMachineHealth(
                                machine?.health,
                                getMachinePlatform(machine)
                            )
                        }
                    })}
                    totalCount={allSessions.length}
                    value={activeMachineFilter}
                    onChange={setMachineFilter}
                />
            ) : null}
            </div>

            <div className="app-scroll-y session-list-scrollbar-left min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-content flex-col gap-1 pl-1.5 pr-2 pt-1 pb-2">
                {groups.map((group) => {
                    const isCollapsed = isGroupCollapsed(group)
                    const visibleGroupSessions = getVisibleGroupSessions(group)
                    const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
                    const canCollapseSessions = getGroupVisibleCount(group) > sessionPreviewLimit
                    const showMoreCount = Math.min(sessionPreviewLimit, hiddenSessionCount)
                    const canStartInGroupDirectory = group.directory !== 'Other'
                    // With multiple machines in the unfiltered view, disambiguate
                    // same-named directories by suffixing the machine label.
                    const groupTitle = showMachineFilterBar && activeMachineFilter === null
                        ? `${group.displayName} · ${resolveMachineLabel(group.machineId)}`
                        : group.displayName
                    return (
                        <div key={group.key}>
                            <div
                                className="group/project sticky top-0 z-10 flex items-center gap-2 py-1.5 pl-2 pr-2 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] cursor-pointer min-w-0 w-full select-none"
                                onClick={() => toggleGroup(group.key, isCollapsed)}
                                title={group.directory}
>>>>>>> adb9e209 (fix(web): stabilize session list alignment and scrolling (#1196))
                            >
                                <ChevronIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" collapsed={machineCollapsed} />
                                <MachineIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" />
                                <span className="text-sm font-semibold truncate flex-1">{mg.label}</span>
                                <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">({mg.totalSessions})</span>
                            </button>

                            {/* Level 2: Projects */}
                            <div className="collapsible-panel" data-open={!machineCollapsed || undefined}>
                                <div className="collapsible-inner">
<<<<<<< HEAD
                                <div className="flex flex-col ml-3.5 pl-1 mt-0.5">
                                    {mg.projectGroups.map((group) => {
                                        const isCollapsed = isGroupCollapsed(group)
                                        const visibleGroupSessions = getVisibleGroupSessions(group)
                                        const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
                                        const sessionGroupExpanded = isSessionGroupExpanded(group)
                                        return (
                                            <div key={group.key}>
                                                <div
                                                    className="group/project sticky top-0 z-10 flex items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] cursor-pointer min-w-0 w-full select-none"
                                                    onClick={() => toggleGroup(group.key, isCollapsed)}
                                                    title={group.directory}
                                                >
                                                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                                                    <span className="font-medium text-sm truncate flex-1">
                                                        {group.displayName}
                                                    </span>
                                                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                                                    <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                                                        ({group.sessions.length})
                                                    </span>
                                                    <ProjectGroupActions
                                                        group={group}
                                                        api={api}
                                                        onNewSessionInDirectory={props.onNewSessionInDirectory}
                                                    />
                                                </div>

                                                {/* Level 3: Sessions */}
                                                <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                                                    <div className="collapsible-inner">
                                                    <div className="flex flex-col gap-0.5 ml-3 pl-1 pr-1 py-1">
                                                        {visibleGroupSessions.map((s) => (
                                                            <SessionItem
                                                                key={s.id}
                                                                session={s}
                                                                onSelect={props.onSelect}
                                                                showPath={false}
                                                                api={api}
                                                                selected={s.id === selectedSessionId}
                                                            />
                                                        ))}
                                                        {!isSearching && group.sessions.length > GROUP_SESSION_PREVIEW_LIMIT && (sessionGroupExpanded || hiddenSessionCount > 0) ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleSessionGroup(group)}
                                                                className={cn(
                                                                    'mx-2 my-1 rounded-md px-2 py-1 text-left text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                                                                    hiddenSessionCount > 0 && 'border border-dashed border-[var(--app-border)]'
                                                                )}
                                                            >
                                                                {sessionGroupExpanded
                                                                    ? t('sessions.group.showLess')
                                                                    : t('sessions.group.showMore', { n: hiddenSessionCount })}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
=======
                                <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                                    {visibleGroupSessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                        />
                                    ))}
                                    {group.sessions.length > sessionPreviewLimit && (hiddenSessionCount > 0 || canCollapseSessions) ? (
                                        <button
                                            type="button"
                                            onClick={() => hiddenSessionCount > 0
                                                ? showMoreSessions(group)
                                                : collapseSessionGroup(group)}
                                            className={cn(
                                                'ml-2.5 mr-2 my-1 rounded-md px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                                                hiddenSessionCount > 0 && 'border border-dashed border-[var(--app-border)]'
                                            )}
                                        >
                                            {hiddenSessionCount > 0
                                                ? t('sessions.group.showMore', { n: showMoreCount })
                                                : t('sessions.group.showLess')}
                                        </button>
                                    ) : null}
>>>>>>> adb9e209 (fix(web): stabilize session list alignment and scrolling (#1196))
                                </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            </div>
        </div>
    )
}
