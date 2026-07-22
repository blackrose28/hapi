import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
    formatActivityDuration,
    formatActivityDurationValue
} from '@/components/ToolCard/toolRunModel'
import { useTranslation } from '@/lib/use-translation'

type ToolRunLayout = {
    grouped: boolean
    now: number
}

const ToolRunLayoutContext = createContext<ToolRunLayout>({
    grouped: false,
    now: 0
})

export function ToolRunLayoutProvider(props: { children: ReactNode; now: number }) {
    return (
        <ToolRunLayoutContext.Provider value={{ grouped: true, now: props.now }}>
            {props.children}
        </ToolRunLayoutContext.Provider>
    )
}

export function useToolRunLayout(): ToolRunLayout {
    return useContext(ToolRunLayoutContext)
}

export function useActivityClock(active: boolean): number {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!active) return
        setNow(Date.now())
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [active])

    return now
}

export function useFormattedActivityDuration(durationMs: number | null): {
    compact: string
    accessible: string
} | null {
    const { locale, t } = useTranslation()
    if (durationMs === null) return null

    const unit = (value: number, name: 'second' | 'minute' | 'hour') =>
        new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: name,
            unitDisplay: 'long',
            maximumFractionDigits: 0
        }).format(value)
    let accessible: string
    if (durationMs < 60000) {
        const value = formatActivityDurationValue(durationMs, locale)
        accessible = t(
            durationMs > 0 && durationMs < 100
                ? 'tool.duration.lessThanSeconds'
                : 'tool.duration.seconds',
            { duration: value }
        )
    } else if (durationMs < 3600000) {
        const totalSeconds = Math.floor(durationMs / 1000)
        accessible = `${unit(Math.floor(totalSeconds / 60), 'minute')} ${unit(totalSeconds % 60, 'second')}`
    } else {
        const totalSeconds = Math.floor(durationMs / 1000)
        accessible = `${unit(Math.floor(totalSeconds / 3600), 'hour')} ${unit(Math.floor((totalSeconds % 3600) / 60), 'minute')}`
    }

    return {
        compact: formatActivityDuration(durationMs),
        accessible
    }
}
