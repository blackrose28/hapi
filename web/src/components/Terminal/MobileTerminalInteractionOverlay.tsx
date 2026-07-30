import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent,
    type PointerEvent,
    type PointerEventHandler,
    type ReactNode,
} from 'react'
import { useTranslation } from '@/lib/use-translation'

type ScreenPoint = {
    x: number
    y: number
}

const MOBILE_TOOLBAR_MARGIN = 8
const MOBILE_TOOLBAR_GAP = 8
const COMPACT_TOOLBAR_CLASS = 'absolute flex overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-0.5 shadow-lg backdrop-blur'
const COMPACT_ACTION_CLASS = 'min-h-[44px] min-w-[44px] px-3 text-[13px] font-medium'

type ToolbarPlacement = 'above' | 'below' | 'clamped'

type ToolbarLayout = {
    left: number
    top: number
    placement: ToolbarPlacement
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum)
}

function calculateToolbarLayout(
    anchor: ScreenPoint,
    rootRect: DOMRect,
    toolbarRect: DOMRect,
    belowAnchorY = anchor.y,
): ToolbarLayout {
    const maximumLeft = Math.max(
        MOBILE_TOOLBAR_MARGIN,
        rootRect.width - MOBILE_TOOLBAR_MARGIN - toolbarRect.width,
    )
    const left = clamp(
        anchor.x - (toolbarRect.width / 2),
        MOBILE_TOOLBAR_MARGIN,
        maximumLeft,
    )
    const maximumTop = Math.max(
        MOBILE_TOOLBAR_MARGIN,
        rootRect.height - MOBILE_TOOLBAR_MARGIN - toolbarRect.height,
    )
    const aboveTop = anchor.y - MOBILE_TOOLBAR_GAP - toolbarRect.height
    const belowTop = belowAnchorY + MOBILE_TOOLBAR_GAP

    if (aboveTop >= MOBILE_TOOLBAR_MARGIN && aboveTop <= maximumTop) {
        return { left, top: aboveTop, placement: 'above' }
    }
    if (belowTop >= MOBILE_TOOLBAR_MARGIN && belowTop <= maximumTop) {
        return { left, top: belowTop, placement: 'below' }
    }

    const clampedAbove = clamp(aboveTop, MOBILE_TOOLBAR_MARGIN, maximumTop)
    const clampedBelow = clamp(belowTop, MOBILE_TOOLBAR_MARGIN, maximumTop)
    return {
        left,
        top: Math.abs(clampedAbove - aboveTop) <= Math.abs(clampedBelow - belowTop)
            ? clampedAbove
            : clampedBelow,
        placement: 'clamped',
    }
}

type PositionedToolbarProps = {
    anchor: ScreenPoint
    belowAnchorY?: number
    label: string
    className?: string
    children: ReactNode
    onPointerDown?: PointerEventHandler<HTMLDivElement>
}

function PositionedToolbar(props: PositionedToolbarProps) {
    const toolbarRef = useRef<HTMLDivElement>(null)
    const [layout, setLayout] = useState<ToolbarLayout | null>(null)

    const measure = useCallback(() => {
        const toolbar = toolbarRef.current
        const root = toolbar?.closest<HTMLElement>(
            '[data-mobile-terminal-overlay-root]',
        )
        if (!root || !toolbar) return
        const next = calculateToolbarLayout(
            props.anchor,
            root.getBoundingClientRect(),
            toolbar.getBoundingClientRect(),
            props.belowAnchorY,
        )
        setLayout((current) => (
            current?.left === next.left
            && current.top === next.top
            && current.placement === next.placement
                ? current
                : next
        ))
    }, [props.anchor, props.belowAnchorY])

    useLayoutEffect(() => {
        measure()
        window.addEventListener('resize', measure)
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(measure)
        const root = toolbarRef.current?.closest<HTMLElement>(
            '[data-mobile-terminal-overlay-root]',
        )
        if (root) resizeObserver?.observe(root)
        if (toolbarRef.current) resizeObserver?.observe(toolbarRef.current)

        return () => {
            window.removeEventListener('resize', measure)
            resizeObserver?.disconnect()
        }
    }, [measure])

    return (
        <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={props.label}
            data-placement={layout?.placement}
            className={props.className}
            style={layout
                ? { left: layout.left, top: layout.top }
                : { visibility: 'hidden' }}
            onPointerDown={props.onPointerDown}
        >
            {props.children}
        </div>
    )
}

export type MobileTerminalOverlayProps = {
    mode: 'idle' | 'choice' | 'input' | 'select'
    choiceAnchor: ScreenPoint | null
    startHandle: ScreenPoint | null
    endHandle: ScreenPoint | null
    toolbarAnchor: ScreenPoint | null
    feedback: 'copied' | 'copy-error' | null
    onInput: () => void
    onEnter: () => void
    onSelect: () => void
    onCopy: () => void
    onSelectAll: () => void
    onCancel: () => void
    onSelectionPointerDown: PointerEventHandler<HTMLDivElement>
    onHandlePointerDown: (
        edge: 'start' | 'end',
        event: PointerEvent<HTMLButtonElement>,
    ) => void
}

type SelectionHandleProps = {
    edge: 'start' | 'end'
    label: string
    point: ScreenPoint | null
    onPointerDown: MobileTerminalOverlayProps['onHandlePointerDown']
}

function SelectionHandle(props: SelectionHandleProps) {
    if (!props.point) return null

    return (
        <button
            type="button"
            aria-label={props.label}
            className="absolute flex h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            style={{ left: props.point.x, top: props.point.y }}
            onPointerDown={(event) => props.onPointerDown(props.edge, event)}
        >
            <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full border-2 border-white bg-violet-500 shadow-md"
            />
        </button>
    )
}

type SelectionToolbarProps = Pick<
    MobileTerminalOverlayProps,
    | 'toolbarAnchor'
    | 'startHandle'
    | 'endHandle'
    | 'onCopy'
    | 'onSelectAll'
    | 'onCancel'
> & {
    toolbarLabel: string
    copyLabel: string
    selectAllLabel: string
    cancelLabel: string
}

function SelectionToolbar(props: SelectionToolbarProps) {
    if (!props.toolbarAnchor) return null
    const belowAnchorY = Math.max(
        props.startHandle?.y ?? props.toolbarAnchor.y,
        props.endHandle?.y ?? props.toolbarAnchor.y,
    )

    return (
        <PositionedToolbar
            anchor={props.toolbarAnchor}
            belowAnchorY={belowAnchorY}
            label={props.toolbarLabel}
            className={COMPACT_TOOLBAR_CLASS}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <button
                type="button"
                className={COMPACT_ACTION_CLASS}
                onClick={props.onCopy}
            >
                {props.copyLabel}
            </button>
            <span aria-hidden="true" className="my-2 w-px bg-[var(--app-border)]" />
            <button
                type="button"
                className={COMPACT_ACTION_CLASS}
                onClick={props.onSelectAll}
            >
                {props.selectAllLabel}
            </button>
            <span aria-hidden="true" className="my-2 w-px bg-[var(--app-border)]" />
            <button
                type="button"
                className={COMPACT_ACTION_CLASS}
                onClick={props.onCancel}
            >
                {props.cancelLabel}
            </button>
        </PositionedToolbar>
    )
}

function ChoiceAction(props: {
    children: ReactNode
    onActivate: () => void
}) {
    const pointerArmedRef = useRef(false)
    const pointerArmedAtRef = useRef(0)

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        const keyboardActivation = event.detail === 0
        const pointerAge = event.timeStamp - pointerArmedAtRef.current
        const freshPointerActivation = pointerArmedRef.current
            && pointerAge >= 0
            && pointerAge <= 1_000
        if (!keyboardActivation && !freshPointerActivation) {
            event.preventDefault()
            event.stopPropagation()
            return
        }
        pointerArmedRef.current = false
        props.onActivate()
    }

    return (
        <button
            type="button"
            className={COMPACT_ACTION_CLASS}
            onPointerDown={(event) => {
                pointerArmedRef.current = true
                pointerArmedAtRef.current = event.timeStamp
            }}
            onPointerCancel={() => {
                pointerArmedRef.current = false
            }}
            onClick={handleClick}
        >
            {props.children}
        </button>
    )
}

export function MobileTerminalInteractionOverlay(props: MobileTerminalOverlayProps) {
    const { t } = useTranslation()

    const hasInteraction = props.mode === 'choice' || props.mode === 'select'
    if (!hasInteraction && !props.feedback) return null

    return (
        <div
            data-mobile-terminal-overlay-root=""
            data-testid="mobile-terminal-overlay-root"
            className="pointer-events-none absolute inset-0 z-20 lg:hidden"
        >
            {props.mode === 'choice' && props.choiceAnchor ? (
                <PositionedToolbar
                    anchor={props.choiceAnchor}
                    label={t('terminal.interaction.choice')}
                    className={`pointer-events-auto ${COMPACT_TOOLBAR_CLASS}`}
                >
                    <ChoiceAction onActivate={props.onInput}>
                        {t('terminal.interaction.input')}
                    </ChoiceAction>
                    <span aria-hidden="true" className="my-2.5 w-px bg-[var(--app-border)]" />
                    <ChoiceAction onActivate={props.onEnter}>
                        {t('terminal.interaction.enter')}
                    </ChoiceAction>
                    <span aria-hidden="true" className="my-2.5 w-px bg-[var(--app-border)]" />
                    <ChoiceAction onActivate={props.onSelect}>
                        {t('terminal.interaction.select')}
                    </ChoiceAction>
                </PositionedToolbar>
            ) : null}

            {props.mode === 'select' ? (
                <div
                    data-testid="terminal-selection-layer"
                    className="pointer-events-auto absolute inset-0 touch-none"
                    onPointerDown={props.onSelectionPointerDown}
                >
                    <SelectionHandle
                        edge="start"
                        label={t('terminal.interaction.selectionStart')}
                        point={props.startHandle}
                        onPointerDown={props.onHandlePointerDown}
                    />
                    <SelectionHandle
                        edge="end"
                        label={t('terminal.interaction.selectionEnd')}
                        point={props.endHandle}
                        onPointerDown={props.onHandlePointerDown}
                    />
                    <SelectionToolbar
                        toolbarAnchor={props.toolbarAnchor}
                        startHandle={props.startHandle}
                        endHandle={props.endHandle}
                        toolbarLabel={t('terminal.interaction.selectionToolbar')}
                        copyLabel={t('terminal.interaction.copy')}
                        selectAllLabel={t('terminal.interaction.selectAll')}
                        cancelLabel={t('terminal.interaction.cancel')}
                        onCopy={props.onCopy}
                        onSelectAll={props.onSelectAll}
                        onCancel={props.onCancel}
                    />
                </div>
            ) : null}

            {props.feedback ? (
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className={`pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border px-3 py-1.5 text-sm shadow-lg backdrop-blur ${
                        props.feedback === 'copy-error'
                            ? 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300'
                            : 'border-[var(--app-border)] bg-[var(--app-bg)]/95 text-[var(--app-fg)]'
                    }`}
                >
                    {props.feedback === 'copied'
                        ? t('terminal.interaction.copied')
                        : t('terminal.interaction.copyFailed')}
                </div>
            ) : null}
        </div>
    )
}
