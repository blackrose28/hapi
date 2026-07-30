import type { TerminalCell, TerminalCellRange } from './terminalSelection'

export type SelectionDrag = {
    kind: 'range' | 'start' | 'end'
    anchor: TerminalCell
}

type CopyToken = {
    version: number
}

type PointerSessionOptions = {
    target: HTMLElement
    pointerId: number
    applyPoint: (clientX: number, clientY: number) => void
    edgeDirection: (clientY: number) => -1 | 0 | 1
    scrollEdge: (direction: -1 | 1) => void
    onCancel: () => void
}

type PointerSession = PointerSessionOptions & {
    pendingPoint: { x: number; y: number } | null
    frameId: number | null
    removeListeners: () => void
}

function cellOffset(cell: TerminalCell, cols: number): number {
    return (cell.row * cols) + cell.column
}

function advanceCell(cell: TerminalCell, cols: number): TerminalCell {
    return {
        column: Math.min(cell.column + 1, cols),
        row: cell.row,
    }
}

function inclusiveRange(
    first: TerminalCell,
    second: TerminalCell,
    cols: number,
): TerminalCellRange {
    return cellOffset(first, cols) <= cellOffset(second, cols)
        ? { start: first, end: advanceCell(second, cols) }
        : { start: second, end: advanceCell(first, cols) }
}

export function beginSelectionLayerDrag(
    range: TerminalCellRange | null,
    cell: TerminalCell,
    cols: number,
): {
    drag: SelectionDrag
    replacementRange: TerminalCellRange | null
} {
    if (!range) {
        return {
            drag: { kind: 'range', anchor: cell },
            replacementRange: {
                start: cell,
                end: advanceCell(cell, cols),
            },
        }
    }

    const pointOffset = cellOffset(cell, cols)
    const startOffset = cellOffset(range.start, cols)
    const endOffset = cellOffset(range.end, cols)
    if (pointOffset < startOffset || pointOffset >= endOffset) {
        return {
            drag: { kind: 'range', anchor: cell },
            replacementRange: {
                start: cell,
                end: advanceCell(cell, cols),
            },
        }
    }

    const startDistance = pointOffset - startOffset
    const endDistance = Math.max(endOffset - 1 - pointOffset, 0)
    return startDistance <= endDistance
        ? {
            drag: { kind: 'start', anchor: range.end },
            replacementRange: null,
        }
        : {
            drag: { kind: 'end', anchor: range.start },
            replacementRange: null,
        }
}

export function createHandleDrag(
    range: TerminalCellRange,
    edge: 'start' | 'end',
): SelectionDrag {
    return {
        kind: edge,
        anchor: edge === 'start' ? range.end : range.start,
    }
}

export function rangeForSelectionDrag(
    drag: SelectionDrag,
    movingCell: TerminalCell,
    cols: number,
): TerminalCellRange {
    if (drag.kind === 'range') {
        return inclusiveRange(drag.anchor, movingCell, cols)
    }
    return cellOffset(movingCell, cols) < cellOffset(drag.anchor, cols)
        ? { start: movingCell, end: drag.anchor }
        : { start: drag.anchor, end: advanceCell(movingCell, cols) }
}

export class MobileTerminalSelectionLifecycle {
    private version = 0
    private pointer: PointerSession | null = null

    beginCopy(): CopyToken {
        this.version += 1
        return { version: this.version }
    }

    isCopyCurrent(token: CopyToken): boolean {
        return token.version === this.version
    }

    selectionMutated(): void {
        this.version += 1
    }

    reset(): void {
        this.version += 1
        this.cancelPointer()
    }

    cancelPointer(): void {
        this.stopPointer(true)
    }

    startPointer(options: PointerSessionOptions): void {
        this.cancelPointer()
        this.selectionMutated()

        const session: PointerSession = {
            ...options,
            pendingPoint: null,
            frameId: null,
            removeListeners: () => undefined,
        }

        const scheduleEdgeFrame = () => {
            if (session.frameId !== null) return
            session.frameId = window.requestAnimationFrame(() => {
                session.frameId = null
                const point = session.pendingPoint
                if (!point || this.pointer !== session) return
                const direction = session.edgeDirection(point.y)
                if (direction === 0) {
                    session.applyPoint(point.x, point.y)
                    return
                }
                session.scrollEdge(direction)
                session.applyPoint(point.x, point.y)
                scheduleEdgeFrame()
            })
        }

        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerId !== session.pointerId) return
            event.preventDefault()
            session.pendingPoint = { x: event.clientX, y: event.clientY }
            if (session.edgeDirection(event.clientY) !== 0) {
                scheduleEdgeFrame()
                return
            }
            if (session.frameId !== null) {
                window.cancelAnimationFrame(session.frameId)
                session.frameId = null
            }
            session.applyPoint(event.clientX, event.clientY)
        }
        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerId !== session.pointerId) return
            event.preventDefault()
            this.stopPointer(true)
        }
        const handlePointerCancel = (event: PointerEvent) => {
            if (event.pointerId !== session.pointerId) return
            event.preventDefault()
            this.stopPointer(true)
            session.onCancel()
        }
        const handleLostPointerCapture = (event: PointerEvent) => {
            if (event.pointerId !== session.pointerId) return
            this.stopPointer(false)
        }

        session.removeListeners = () => {
            session.target.removeEventListener('pointermove', handlePointerMove)
            session.target.removeEventListener('pointerup', handlePointerUp)
            session.target.removeEventListener('pointercancel', handlePointerCancel)
            session.target.removeEventListener(
                'lostpointercapture',
                handleLostPointerCapture,
            )
        }
        this.pointer = session
        session.target.addEventListener('pointermove', handlePointerMove)
        session.target.addEventListener('pointerup', handlePointerUp)
        session.target.addEventListener('pointercancel', handlePointerCancel)
        session.target.addEventListener(
            'lostpointercapture',
            handleLostPointerCapture,
        )
        try {
            session.target.setPointerCapture(session.pointerId)
        } catch {
            this.stopPointer(false)
            session.onCancel()
        }
    }

    private stopPointer(releaseCapture: boolean): void {
        const session = this.pointer
        if (!session) return
        this.pointer = null
        session.removeListeners()
        if (session.frameId !== null) {
            window.cancelAnimationFrame(session.frameId)
        }
        if (!releaseCapture) return
        try {
            if (session.target.hasPointerCapture?.(session.pointerId)) {
                session.target.releasePointerCapture(session.pointerId)
            }
        } catch {
            // Pointer capture may already have been released by the browser.
        }
    }
}
