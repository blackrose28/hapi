import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Terminal } from '@xterm/xterm'
import { safeCopyToClipboard } from '@/lib/clipboard'
import type { MobileTerminalOverlayProps } from './MobileTerminalInteractionOverlay'
import {
    MobileTerminalSelectionLifecycle,
    beginSelectionLayerDrag,
    createHandleDrag,
    rangeForSelectionDrag,
    type SelectionDrag,
} from './mobileTerminalSelectionLifecycle'
import {
    XtermSelectionCoordinateAdapter,
    type RawXtermSelectionPosition,
} from './terminalSelectionCoordinates'
import {
    cellToScreenPoint,
    normalizeRange,
    pointToBufferCell,
    rangeToSelection,
    wordRangeAt,
    type TerminalBufferCell,
    type TerminalCell,
    type TerminalCellRange,
    type TerminalScreenMetrics,
} from './terminalSelection'

const MOVE_THRESHOLD_PX = 6
const LONG_PRESS_MS = 450
const EDGE_SCROLL_PX = 28
const COPIED_FEEDBACK_MS = 1_600
const SOFT_KEYBOARD_MIN_DELTA_PX = 80
const SOFT_KEYBOARD_CLOSE_TOLERANCE_PX = 32

type InteractionMode = 'idle' | 'choice' | 'input' | 'select'

type TouchSession = {
    identifier: number
    start: { x: number; y: number }
    last: { x: number; y: number }
    seedCell: TerminalCell
    scrolling: boolean
    longPressed: boolean
    dismissingChoice: boolean
}

type InputViewportSession = {
    closedHeight: number
    keyboardObserved: boolean
}

export type UseMobileTerminalInteractionOptions = {
    terminal: Terminal | null
    root: HTMLElement | null
    enabled: boolean
    mobile: boolean
    dismissRequested: boolean
}

export type MobileTerminalInteraction = {
    overlayProps: MobileTerminalOverlayProps
    reset: () => void
}

type OverlayState = {
    mode: InteractionMode
    choiceAnchor: { x: number; y: number } | null
    startHandle: { x: number; y: number } | null
    endHandle: { x: number; y: number } | null
    toolbarAnchor: { x: number; y: number } | null
    feedback: 'copied' | 'copy-error' | null
}

const IDLE_OVERLAY: OverlayState = {
    mode: 'idle',
    choiceAnchor: null,
    startHandle: null,
    endHandle: null,
    toolbarAnchor: null,
    feedback: null,
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum)
}

function viewportHeight(): number {
    return window.visualViewport?.height ?? window.innerHeight
}

export function useMobileTerminalInteraction(
    options: UseMobileTerminalInteractionOptions,
): MobileTerminalInteraction {
    const [overlay, setOverlay] = useState<OverlayState>(IDLE_OVERLAY)
    const overlayRef = useRef(overlay)
    const terminalRef = useRef(options.terminal)
    const rootRef = useRef(options.root)
    const enabledRef = useRef(options.enabled)
    const mobileRef = useRef(options.mobile)
    const activeRef = useRef(false)
    const touchRef = useRef<TouchSession | null>(null)
    const touchPixelRemainderRef = useRef(0)
    const longPressTimerRef = useRef<number | null>(null)
    const choiceRevealTimerRef = useRef<number | null>(null)
    const choiceBlurTimerRef = useRef<number | null>(null)
    const feedbackTimerRef = useRef<number | null>(null)
    const seedCellRef = useRef<TerminalCell | null>(null)
    const fallbackChoicePointRef = useRef<{ x: number; y: number } | null>(null)
    const lastUsableAnchorRef = useRef<{ x: number; y: number } | null>(null)
    const selectionRangeRef = useRef<TerminalCellRange | null>(null)
    const inputViewportRef = useRef<InputViewportSession | null>(null)
    const suppressSelectionEventRef = useRef(false)
    const coordinateAdapterRef = useRef(new XtermSelectionCoordinateAdapter())
    const selectionLifecycleRef = useRef(new MobileTerminalSelectionLifecycle())

    terminalRef.current = options.terminal
    rootRef.current = options.root
    enabledRef.current = options.enabled
    mobileRef.current = options.mobile

    const updateOverlay = useCallback((
        update: Partial<OverlayState> | ((current: OverlayState) => OverlayState),
    ) => {
        const current = overlayRef.current
        const next = typeof update === 'function'
            ? update(current)
            : { ...current, ...update }
        overlayRef.current = next
        setOverlay(next)
    }, [])

    const clearLongPressTimer = useCallback(() => {
        if (longPressTimerRef.current === null) return
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
    }, [])

    const clearChoiceBlurTimer = useCallback(() => {
        if (choiceBlurTimerRef.current === null) return
        window.clearTimeout(choiceBlurTimerRef.current)
        choiceBlurTimerRef.current = null
    }, [])

    const clearChoiceRevealTimer = useCallback(() => {
        if (choiceRevealTimerRef.current === null) return
        window.clearTimeout(choiceRevealTimerRef.current)
        choiceRevealTimerRef.current = null
    }, [])

    const clearFeedbackTimer = useCallback(() => {
        if (feedbackTimerRef.current === null) return
        window.clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = null
    }, [])

    const cancelTouch = useCallback(() => {
        clearLongPressTimer()
        touchRef.current = null
        touchPixelRemainderRef.current = 0
    }, [clearLongPressTimer])

    const cancelTransientWork = useCallback(() => {
        cancelTouch()
        clearChoiceRevealTimer()
        clearChoiceBlurTimer()
        clearFeedbackTimer()
        selectionLifecycleRef.current.reset()
        coordinateAdapterRef.current.reset()
        seedCellRef.current = null
        fallbackChoicePointRef.current = null
        lastUsableAnchorRef.current = null
        selectionRangeRef.current = null
        inputViewportRef.current = null
    }, [
        cancelTouch,
        clearChoiceBlurTimer,
        clearChoiceRevealTimer,
        clearFeedbackTimer,
    ])

    const clearTerminalSelection = useCallback((terminal: Terminal) => {
        suppressSelectionEventRef.current = true
        try {
            terminal.clearSelection()
        } finally {
            suppressSelectionEventRef.current = false
        }
    }, [])

    const getMetrics = useCallback((
        terminal = terminalRef.current,
    ): { metrics: TerminalScreenMetrics; screenRect: DOMRect; rootRect: DOMRect } | null => {
        const root = rootRef.current
        const screen = terminal?.element?.querySelector<HTMLElement>('.xterm-screen')
        if (!root || !screen || !terminal || terminal.cols <= 0 || terminal.rows <= 0) {
            return null
        }
        const screenRect = screen.getBoundingClientRect()
        const rootRect = root.getBoundingClientRect()
        if (screenRect.width <= 0 || screenRect.height <= 0) return null
        return {
            metrics: {
                rect: screenRect,
                cols: terminal.cols,
                rows: terminal.rows,
                viewportY: terminal.buffer.active.viewportY,
            },
            screenRect,
            rootRect,
        }
    }, [])

    const pointToCell = useCallback((clientX: number, clientY: number): TerminalCell | null => {
        const terminal = terminalRef.current
        const geometry = getMetrics(terminal)
        if (!terminal || !geometry) return null
        const cell = pointToBufferCell(
            { x: clientX, y: clientY },
            geometry.metrics,
        )
        return {
            column: clamp(cell.column, 0, Math.max(terminal.cols - 1, 0)),
            row: clamp(
                cell.row,
                0,
                Math.max(terminal.buffer.active.length - 1, 0),
            ),
        }
    }, [getMetrics])

    const cellToRootPoint = useCallback((
        cell: TerminalCell,
    ): { x: number; y: number } | null => {
        const geometry = getMetrics()
        if (!geometry) return null
        const point = cellToScreenPoint(cell, geometry.metrics)
        if (!point) return null
        return {
            x: clamp(
                (geometry.screenRect.left - geometry.rootRect.left) + point.x,
                0,
                geometry.rootRect.width,
            ),
            y: clamp(
                (geometry.screenRect.top - geometry.rootRect.top) + point.y,
                0,
                geometry.rootRect.height,
            ),
        }
    }, [getMetrics])

    const clientToRootPoint = useCallback((
        clientX: number,
        clientY: number,
    ): { x: number; y: number } | null => {
        const root = rootRef.current
        if (!root) return null
        const rect = root.getBoundingClientRect()
        return {
            x: clamp(clientX - rect.left, 0, rect.width),
            y: clamp(clientY - rect.top, 0, rect.height),
        }
    }, [])

    const failClosedSelection = useCallback(() => {
        clearLongPressTimer()
        selectionLifecycleRef.current.reset()
        coordinateAdapterRef.current.reset()
        selectionRangeRef.current = null
        const terminal = terminalRef.current
        if (terminal) {
            if (terminal.textarea) terminal.textarea.readOnly = true
            clearTerminalSelection(terminal)
        }
        updateOverlay(IDLE_OVERLAY)
    }, [clearLongPressTimer, clearTerminalSelection, updateOverlay])

    const resolveTerminalRange = useCallback((): TerminalCellRange | null => {
        const terminal = terminalRef.current
        if (!terminal) return null
        const resolution = coordinateAdapterRef.current.resolve(
            terminal.getSelectionPosition() as RawXtermSelectionPosition | undefined,
            {
                cols: terminal.cols,
                bufferLength: terminal.buffer.active.length,
            },
        )
        if (resolution.status !== 'resolved') {
            failClosedSelection()
            return null
        }
        selectionRangeRef.current = resolution.range
        return resolution.range
    }, [failClosedSelection])

    const syncSelectionOverlay = useCallback((): boolean => {
        if (overlayRef.current.mode !== 'select') return true
        const range = resolveTerminalRange()
        if (!range) return false
        const startHandle = cellToRootPoint(range.start)
        const endHandle = cellToRootPoint(range.end)
        const geometry = getMetrics()
        const rootRect = rootRef.current?.getBoundingClientRect()
        const rowHeight = geometry
            ? geometry.screenRect.height / geometry.metrics.rows
            : 0
        const visibleHandle = startHandle ?? endHandle
        const selectionAnchor = rootRect && visibleHandle
            ? {
                x: clamp(
                    startHandle && endHandle
                        ? (startHandle.x + endHandle.x) / 2
                        : visibleHandle.x,
                    0,
                    rootRect.width,
                ),
                y: clamp(
                    (startHandle && endHandle
                        ? Math.min(startHandle.y, endHandle.y)
                        : visibleHandle.y) - rowHeight,
                    0,
                    rootRect.height,
                ),
            }
            : null
        if (selectionAnchor) {
            lastUsableAnchorRef.current = selectionAnchor
        }
        const fallbackAnchor = rootRect
            ? lastUsableAnchorRef.current ?? {
                x: rootRect.width / 2,
                y: rootRect.height / 2,
            }
            : null
        const toolbarAnchor = fallbackAnchor && rootRect
            ? {
                x: clamp(fallbackAnchor.x, 0, rootRect.width),
                y: clamp(fallbackAnchor.y, 0, rootRect.height),
            }
            : null
        updateOverlay({ startHandle, endHandle, toolbarAnchor })
        return true
    }, [cellToRootPoint, getMetrics, resolveTerminalRange, updateOverlay])

    const syncChoiceAnchor = useCallback(() => {
        if (overlayRef.current.mode !== 'choice') return
        const terminal = terminalRef.current
        if (!terminal) return
        const buffer = terminal.buffer.active
        const cursorPoint = cellToRootPoint({
            column: clamp(buffer.cursorX, 0, Math.max(terminal.cols - 1, 0)),
            row: buffer.baseY + buffer.cursorY,
        })
        const choiceAnchor = cursorPoint ?? fallbackChoicePointRef.current
        if (choiceAnchor) {
            lastUsableAnchorRef.current = choiceAnchor
        }
        updateOverlay({ choiceAnchor })
    }, [cellToRootPoint, updateOverlay])

    const settleChoiceFocus = useCallback((terminal: Terminal) => {
        clearChoiceBlurTimer()
        if (terminal.textarea) terminal.textarea.readOnly = true
        terminal.blur()
        choiceBlurTimerRef.current = window.setTimeout(() => {
            choiceBlurTimerRef.current = null
            if (
                !activeRef.current
                || terminalRef.current !== terminal
                || overlayRef.current.mode === 'input'
                || overlayRef.current.mode === 'select'
            ) return
            if (terminal.textarea) terminal.textarea.readOnly = true
            terminal.blur()
        }, 0)
    }, [clearChoiceBlurTimer])

    const scheduleChoiceReveal = useCallback((terminal: Terminal) => {
        clearChoiceRevealTimer()
        choiceRevealTimerRef.current = window.setTimeout(() => {
            choiceRevealTimerRef.current = null
            if (
                !activeRef.current
                || terminalRef.current !== terminal
                || overlayRef.current.mode !== 'idle'
                || touchRef.current !== null
            ) return
            updateOverlay({
                ...IDLE_OVERLAY,
                mode: 'choice',
            })
            syncChoiceAnchor()
            settleChoiceFocus(terminal)
        }, 0)
    }, [
        clearChoiceRevealTimer,
        settleChoiceFocus,
        syncChoiceAnchor,
        updateOverlay,
    ])

    const applySelection = useCallback((range: TerminalCellRange): boolean => {
        const terminal = terminalRef.current
        if (!terminal || !activeRef.current) return false
        const normalized = normalizeRange(range.start, range.end)
        selectionLifecycleRef.current.selectionMutated()
        coordinateAdapterRef.current.expectSelection(normalized)
        selectionRangeRef.current = normalized
        const selection = rangeToSelection(normalized, terminal.cols)
        terminal.select(selection.column, selection.row, selection.length)
        if (overlayRef.current.mode !== 'select') return false
        return syncSelectionOverlay()
    }, [syncSelectionOverlay])

    const selectWord = useCallback((seedCell: TerminalCell) => {
        const terminal = terminalRef.current
        if (!terminal || !activeRef.current) return
        clearChoiceRevealTimer()
        const line = terminal.buffer.active.getLine(seedCell.row)
        const cells: TerminalBufferCell[] = Array.from(
            { length: terminal.cols },
            (_, column) => {
                const cell = line?.getCell(column)
                return {
                    chars: cell?.getChars() ?? '',
                    width: cell?.getWidth() ?? 1,
                }
            },
        )
        if (terminal.textarea) terminal.textarea.readOnly = true
        terminal.blur()
        clearFeedbackTimer()
        updateOverlay({
            ...IDLE_OVERLAY,
            mode: 'select',
        })
        applySelection(wordRangeAt(cells, seedCell))
    }, [
        applySelection,
        clearChoiceRevealTimer,
        clearFeedbackTimer,
        updateOverlay,
    ])

    const reset = useCallback(() => {
        const wasInput = overlayRef.current.mode === 'input'
        cancelTransientWork()
        const terminal = terminalRef.current
        if (terminal) {
            if (terminal.textarea && enabledRef.current && mobileRef.current) {
                terminal.textarea.readOnly = true
            }
            if (wasInput) terminal.blur()
            clearTerminalSelection(terminal)
        }
        updateOverlay(IDLE_OVERLAY)
    }, [cancelTransientWork, clearTerminalSelection, updateOverlay])

    const onInput = useCallback(() => {
        const terminal = terminalRef.current
        if (!terminal || !activeRef.current || !terminal.textarea) return
        cancelTouch()
        clearChoiceRevealTimer()
        clearChoiceBlurTimer()
        inputViewportRef.current = {
            closedHeight: viewportHeight(),
            keyboardObserved: false,
        }
        terminal.textarea.readOnly = false
        updateOverlay({
            ...IDLE_OVERLAY,
            mode: 'input',
        })
        terminal.focus()
    }, [
        cancelTouch,
        clearChoiceBlurTimer,
        clearChoiceRevealTimer,
        updateOverlay,
    ])

    const onEnter = useCallback(() => {
        const terminal = terminalRef.current
        if (
            !terminal
            || !activeRef.current
            || overlayRef.current.mode !== 'choice'
        ) return
        terminal.input('\r', true)
    }, [])

    const onSelect = useCallback(() => {
        const seedCell = seedCellRef.current
        if (seedCell) selectWord(seedCell)
    }, [selectWord])

    const onCopy = useCallback(async () => {
        const terminal = terminalRef.current
        if (!terminal || !activeRef.current) return
        clearFeedbackTimer()
        if (overlayRef.current.feedback) {
            updateOverlay({ feedback: null })
        }
        const token = selectionLifecycleRef.current.beginCopy()
        try {
            await safeCopyToClipboard(terminal.getSelection())
        } catch {
            if (
                terminalRef.current !== terminal
                || !activeRef.current
                || !selectionLifecycleRef.current.isCopyCurrent(token)
            ) return
            updateOverlay({ mode: 'select', feedback: 'copy-error' })
            return
        }
        if (
            terminalRef.current !== terminal
            || !activeRef.current
            || !selectionLifecycleRef.current.isCopyCurrent(token)
        ) return
        selectionLifecycleRef.current.selectionMutated()
        coordinateAdapterRef.current.reset()
        selectionRangeRef.current = null
        updateOverlay({
            ...IDLE_OVERLAY,
            feedback: 'copied',
        })
        clearTerminalSelection(terminal)
        feedbackTimerRef.current = window.setTimeout(() => {
            feedbackTimerRef.current = null
            if (overlayRef.current.feedback === 'copied') {
                updateOverlay({ feedback: null })
            }
        }, COPIED_FEEDBACK_MS)
    }, [clearFeedbackTimer, clearTerminalSelection, updateOverlay])

    const onSelectAll = useCallback(() => {
        const terminal = terminalRef.current
        if (!terminal || !activeRef.current) return
        clearChoiceRevealTimer()
        clearFeedbackTimer()
        selectionLifecycleRef.current.selectionMutated()
        updateOverlay({ mode: 'select', feedback: null })
        terminal.selectAll()
        if (overlayRef.current.mode === 'select') syncSelectionOverlay()
    }, [
        clearChoiceRevealTimer,
        clearFeedbackTimer,
        syncSelectionOverlay,
        updateOverlay,
    ])

    const edgeDirection = useCallback((clientY: number): -1 | 0 | 1 => {
        const terminal = terminalRef.current
        const geometry = getMetrics(terminal)
        if (!terminal || !geometry) return 0
        const buffer = terminal.buffer.active
        if (
            clientY - geometry.screenRect.top <= EDGE_SCROLL_PX
            && buffer.viewportY > 0
        ) {
            return -1
        }
        if (
            geometry.screenRect.bottom - clientY <= EDGE_SCROLL_PX
            && buffer.viewportY < buffer.baseY
        ) {
            return 1
        }
        return 0
    }, [getMetrics])

    const startPointerDrag = useCallback((
        target: HTMLElement,
        pointerId: number,
        drag: SelectionDrag,
    ) => {
        selectionLifecycleRef.current.startPointer({
            target,
            pointerId,
            edgeDirection,
            scrollEdge: (direction) => {
                terminalRef.current?.scrollLines(direction)
            },
            applyPoint: (clientX, clientY) => {
                const terminal = terminalRef.current
                const cell = pointToCell(clientX, clientY)
                if (!terminal || !cell) return
                applySelection(rangeForSelectionDrag(drag, cell, terminal.cols))
            },
            onCancel: reset,
        })
    }, [applySelection, edgeDirection, pointToCell, reset])

    const onSelectionPointerDown = useCallback((
        event: ReactPointerEvent<HTMLDivElement>,
    ) => {
        const terminal = terminalRef.current
        const cell = pointToCell(event.clientX, event.clientY)
        if (!terminal || !cell || overlayRef.current.mode !== 'select') return
        event.preventDefault()
        event.stopPropagation()
        if (!syncSelectionOverlay()) return
        const { drag, replacementRange } = beginSelectionLayerDrag(
            selectionRangeRef.current,
            cell,
            terminal.cols,
        )
        if (replacementRange && !applySelection(replacementRange)) return
        startPointerDrag(event.currentTarget, event.pointerId, drag)
    }, [
        applySelection,
        pointToCell,
        startPointerDrag,
        syncSelectionOverlay,
    ])

    const onHandlePointerDown = useCallback((
        edge: 'start' | 'end',
        event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
        if (overlayRef.current.mode !== 'select' || !syncSelectionOverlay()) return
        const range = selectionRangeRef.current
        if (!range) return
        event.preventDefault()
        event.stopPropagation()
        startPointerDrag(
            event.currentTarget,
            event.pointerId,
            createHandleDrag(range, edge),
        )
    }, [startPointerDrag, syncSelectionOverlay])

    useEffect(() => {
        const terminal = options.terminal
        const terminalElement = terminal?.element
        const textarea = terminal?.textarea
        const originalReadOnly = textarea?.readOnly ?? false
        if (
            !options.mobile
            || !terminal
            || !terminalElement
            || !options.root
        ) {
            activeRef.current = false
            cancelTransientWork()
            updateOverlay(IDLE_OVERLAY)
            return
        }

        const handleTouchStart = (event: TouchEvent) => {
            if (!activeRef.current) return
            if (
                overlayRef.current.mode === 'input'
                || overlayRef.current.mode === 'select'
            ) return
            const dismissingChoice = overlayRef.current.mode === 'choice'
            if (event.touches.length !== 1) {
                cancelTouch()
                return
            }
            clearChoiceRevealTimer()
            const touch = event.touches[0]
            clearFeedbackTimer()
            if (overlayRef.current.feedback) {
                updateOverlay({ feedback: null })
            }
            const seedCell = pointToCell(touch.clientX, touch.clientY)
            if (!seedCell) {
                cancelTouch()
                return
            }
            clearLongPressTimer()
            const session: TouchSession = {
                identifier: touch.identifier,
                start: { x: touch.clientX, y: touch.clientY },
                last: { x: touch.clientX, y: touch.clientY },
                seedCell,
                scrolling: false,
                longPressed: false,
                dismissingChoice,
            }
            touchRef.current = session
            touchPixelRemainderRef.current = 0
            seedCellRef.current = seedCell
            fallbackChoicePointRef.current = clientToRootPoint(
                touch.clientX,
                touch.clientY,
            )
            lastUsableAnchorRef.current = fallbackChoicePointRef.current
            if (dismissingChoice) {
                updateOverlay(IDLE_OVERLAY)
                settleChoiceFocus(terminal)
            } else {
                longPressTimerRef.current = window.setTimeout(() => {
                    longPressTimerRef.current = null
                    if (
                        touchRef.current !== session
                        || session.scrolling
                        || overlayRef.current.mode === 'input'
                    ) return
                    session.longPressed = true
                    selectWord(session.seedCell)
                }, LONG_PRESS_MS)
            }
        }

        const handleTouchMove = (event: TouchEvent) => {
            if (overlayRef.current.mode === 'input') return
            const session = touchRef.current
            if (!session) return
            const touch = Array.from(event.touches).find(
                (candidate) => candidate.identifier === session.identifier,
            )
            if (!touch) {
                cancelTouch()
                return
            }
            if (session.longPressed || overlayRef.current.mode === 'select') {
                event.preventDefault()
                session.last = { x: touch.clientX, y: touch.clientY }
                return
            }

            const movedX = touch.clientX - session.start.x
            const movedY = touch.clientY - session.start.y
            if (
                !session.scrolling
                && Math.hypot(movedX, movedY) <= MOVE_THRESHOLD_PX
            ) {
                session.last = { x: touch.clientX, y: touch.clientY }
                return
            }
            if (!session.scrolling) {
                session.scrolling = true
                clearChoiceRevealTimer()
                clearLongPressTimer()
                updateOverlay(IDLE_OVERLAY)
            }
            event.preventDefault()

            const geometry = getMetrics(terminal)
            const lineHeight = geometry && terminal.rows > 0
                ? geometry.screenRect.height / terminal.rows
                : 16
            touchPixelRemainderRef.current += session.last.y - touch.clientY
            session.last = { x: touch.clientX, y: touch.clientY }
            const lines = Math.trunc(touchPixelRemainderRef.current / lineHeight)
            if (lines !== 0) {
                terminal.scrollLines(lines)
                touchPixelRemainderRef.current -= lines * lineHeight
            }
        }

        const handleTouchEnd = (event: TouchEvent) => {
            if (overlayRef.current.mode === 'input') return
            const session = touchRef.current
            if (!session) return
            const ended = Array.from(event.changedTouches).some(
                (touch) => touch.identifier === session.identifier,
            )
            if (!ended) return
            clearLongPressTimer()
            if (session.scrolling || session.longPressed) {
                event.preventDefault()
            } else if (!session.dismissingChoice) {
                scheduleChoiceReveal(terminal)
            }
            touchRef.current = null
            touchPixelRemainderRef.current = 0
        }

        const handleTouchCancel = (event: TouchEvent) => {
            if (overlayRef.current.mode === 'input') return
            if (event.cancelable) {
                event.preventDefault()
            }
            const session = touchRef.current
            if (session?.longPressed && overlayRef.current.mode === 'select') {
                cancelTouch()
                return
            }
            reset()
        }
        const handleBlur = () => {
            if (terminal.textarea) terminal.textarea.readOnly = true
            if (overlayRef.current.mode === 'input') {
                inputViewportRef.current = null
                updateOverlay(IDLE_OVERLAY)
            }
        }
        const reconcileInputViewport = (): boolean => {
            if (overlayRef.current.mode !== 'input') return false
            const session = inputViewportRef.current
            if (!session) return true
            const keyboardDelta = session.closedHeight - viewportHeight()
            if (keyboardDelta >= SOFT_KEYBOARD_MIN_DELTA_PX) {
                session.keyboardObserved = true
                return true
            }
            if (
                session.keyboardObserved
                && keyboardDelta <= SOFT_KEYBOARD_CLOSE_TOLERANCE_PX
            ) {
                reset()
            }
            return true
        }
        const refreshOverlay = () => {
            syncChoiceAnchor()
            syncSelectionOverlay()
        }
        const handleSelectionChange = () => {
            if (suppressSelectionEventRef.current) return
            selectionLifecycleRef.current.selectionMutated()
            syncSelectionOverlay()
        }
        const handleEnvironmentChange = () => {
            if (reconcileInputViewport()) return
            cancelTouch()
            selectionLifecycleRef.current.cancelPointer()
            refreshOverlay()
        }

        terminalElement.addEventListener('touchstart', handleTouchStart, {
            passive: true,
        })
        terminalElement.addEventListener('touchmove', handleTouchMove, {
            passive: false,
        })
        terminalElement.addEventListener('touchend', handleTouchEnd, {
            passive: false,
        })
        terminalElement.addEventListener('touchcancel', handleTouchCancel, {
            passive: false,
        })
        textarea?.addEventListener('blur', handleBlur)
        window.visualViewport?.addEventListener(
            'resize',
            handleEnvironmentChange,
        )
        window.addEventListener('resize', handleEnvironmentChange)
        window.addEventListener('orientationchange', handleEnvironmentChange)
        const cursorDisposable = terminal.onCursorMove(refreshOverlay)
        const selectionDisposable = terminal.onSelectionChange(handleSelectionChange)
        const resizeDisposable = terminal.onResize(handleEnvironmentChange)

        return () => {
            activeRef.current = false
            cancelTransientWork()
            clearTerminalSelection(terminal)
            if (textarea) textarea.readOnly = originalReadOnly
            terminalElement.removeEventListener('touchstart', handleTouchStart)
            terminalElement.removeEventListener('touchmove', handleTouchMove)
            terminalElement.removeEventListener('touchend', handleTouchEnd)
            terminalElement.removeEventListener('touchcancel', handleTouchCancel)
            textarea?.removeEventListener('blur', handleBlur)
            window.visualViewport?.removeEventListener(
                'resize',
                handleEnvironmentChange,
            )
            window.removeEventListener('resize', handleEnvironmentChange)
            window.removeEventListener('orientationchange', handleEnvironmentChange)
            cursorDisposable.dispose()
            selectionDisposable.dispose()
            resizeDisposable.dispose()
        }
    }, [
        options.mobile,
        options.root,
        options.terminal,
        cancelTouch,
        cancelTransientWork,
        clearChoiceRevealTimer,
        clearLongPressTimer,
        clearTerminalSelection,
        clearFeedbackTimer,
        clientToRootPoint,
        getMetrics,
        pointToCell,
        reset,
        scheduleChoiceReveal,
        selectWord,
        settleChoiceFocus,
        syncChoiceAnchor,
        syncSelectionOverlay,
        updateOverlay,
    ])

    useEffect(() => {
        const terminal = options.terminal
        if (
            !options.mobile
            || !terminal
            || !terminal.element
            || !options.root
        ) return

        activeRef.current = false
        cancelTransientWork()
        clearTerminalSelection(terminal)
        if (terminal.textarea) {
            terminal.textarea.readOnly = true
        }
        updateOverlay(IDLE_OVERLAY)
        if (!options.enabled) {
            terminal.blur()
        }
        activeRef.current = options.enabled
    }, [
        options.enabled,
        options.mobile,
        options.root,
        options.terminal,
        cancelTransientWork,
        clearTerminalSelection,
        updateOverlay,
    ])

    useEffect(() => {
        if (options.dismissRequested) reset()
    }, [options.dismissRequested, reset])

    const overlayProps = useMemo<MobileTerminalOverlayProps>(() => ({
        ...overlay,
        onInput,
        onEnter,
        onSelect,
        onCopy,
        onSelectAll,
        onCancel: reset,
        onSelectionPointerDown,
        onHandlePointerDown,
    }), [
        onCopy,
        onHandlePointerDown,
        onEnter,
        onInput,
        onSelect,
        onSelectAll,
        onSelectionPointerDown,
        overlay,
        reset,
    ])

    return { overlayProps, reset }
}
