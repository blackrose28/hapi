import {
    normalizeRange,
    type TerminalCell,
    type TerminalCellRange,
} from './terminalSelection'

export type RawXtermSelectionPosition = {
    start: { x: number; y: number }
    end: { x: number; y: number }
}

type SelectionBounds = {
    cols: number
    bufferLength: number
}

type CoordinateBase = 'zero' | 'one'

export type SelectionCoordinateResolution =
    | {
        status: 'resolved'
        base: CoordinateBase
        range: TerminalCellRange
    }
    | { status: 'missing' | 'unknown' }

function offset(cell: TerminalCell, cols: number): number {
    return (cell.row * cols) + cell.column
}

function isIntegerPoint(point: { x: number; y: number }): boolean {
    return Number.isInteger(point.x) && Number.isInteger(point.y)
}

function normalizePosition(
    position: RawXtermSelectionPosition,
    base: CoordinateBase,
    bounds: SelectionBounds,
): TerminalCellRange | null {
    if (
        bounds.cols <= 0
        || bounds.bufferLength <= 0
        || !isIntegerPoint(position.start)
        || !isIntegerPoint(position.end)
    ) {
        return null
    }
    const adjustment = base === 'one' ? 1 : 0
    const start = {
        column: position.start.x - adjustment,
        row: position.start.y - adjustment,
    }
    const end = {
        column: position.end.x - adjustment,
        row: position.end.y - adjustment,
    }
    const maximumRow = bounds.bufferLength - 1
    if (
        start.column < 0
        || start.column >= bounds.cols
        || end.column < 0
        || end.column > bounds.cols
        || start.row < 0
        || start.row > maximumRow
        || end.row < 0
        || end.row > maximumRow
    ) {
        return null
    }
    return normalizeRange(start, end)
}

export class XtermSelectionCoordinateAdapter {
    private base: CoordinateBase | null = null
    private expectedRange: TerminalCellRange | null = null

    expectSelection(range: TerminalCellRange): void {
        this.expectedRange = normalizeRange(range.start, range.end)
    }

    reset(): void {
        this.base = null
        this.expectedRange = null
    }

    resolve(
        position: RawXtermSelectionPosition | undefined,
        bounds: SelectionBounds,
    ): SelectionCoordinateResolution {
        if (!position) return { status: 'missing' }

        let base = this.base
        if (!base) {
            const expected = this.expectedRange
            if (!expected) return { status: 'unknown' }
            const zeroBasedStartMatches = (
                position.start.x === expected.start.column
                && position.start.y === expected.start.row
            )
            const oneBasedStartMatches = (
                position.start.x === expected.start.column + 1
                && position.start.y === expected.start.row + 1
            )
            if (zeroBasedStartMatches === oneBasedStartMatches) {
                return { status: 'unknown' }
            }
            base = zeroBasedStartMatches ? 'zero' : 'one'
        }

        const range = normalizePosition(position, base, bounds)
        if (!range) return { status: 'unknown' }

        const expected = this.expectedRange
        if (
            expected
            && (
                offset(range.start, bounds.cols) !== offset(expected.start, bounds.cols)
                || offset(range.end, bounds.cols) !== offset(expected.end, bounds.cols)
            )
        ) {
            return { status: 'unknown' }
        }

        this.base = base
        this.expectedRange = null
        return { status: 'resolved', base, range }
    }
}
