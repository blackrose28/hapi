export type TerminalCell = {
    column: number
    row: number
}

export type TerminalCellRange = {
    start: TerminalCell
    end: TerminalCell
}

export type TerminalScreenMetrics = {
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
    cols: number
    rows: number
    viewportY: number
}

type ScreenPoint = { x: number; y: number }

export type TerminalBufferCell = {
    chars: string
    width: number
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum)
}

function compareCells(left: TerminalCell, right: TerminalCell): number {
    return left.row === right.row
        ? left.column - right.column
        : left.row - right.row
}

export function pointToBufferCell(
    point: ScreenPoint,
    metrics: TerminalScreenMetrics,
): TerminalCell {
    const columnWidth = metrics.rect.width / metrics.cols
    const rowHeight = metrics.rect.height / metrics.rows
    return {
        column: clamp(Math.floor((point.x - metrics.rect.left) / columnWidth), 0, metrics.cols - 1),
        row: metrics.viewportY + clamp(
            Math.floor((point.y - metrics.rect.top) / rowHeight),
            0,
            metrics.rows - 1,
        ),
    }
}

export function cellToScreenPoint(
    cell: TerminalCell,
    metrics: TerminalScreenMetrics,
): ScreenPoint | null {
    const visibleRow = cell.row - metrics.viewportY
    if (visibleRow < 0 || visibleRow >= metrics.rows) {
        return null
    }
    return {
        x: (cell.column + 0.5) * metrics.rect.width / metrics.cols,
        y: (visibleRow + 1) * metrics.rect.height / metrics.rows,
    }
}

export function normalizeRange(
    anchor: TerminalCell,
    focus: TerminalCell,
): TerminalCellRange {
    return compareCells(anchor, focus) <= 0
        ? { start: anchor, end: focus }
        : { start: focus, end: anchor }
}

export function wordRangeAt(
    cells: readonly TerminalBufferCell[],
    cell: TerminalCell,
): TerminalCellRange {
    let column = clamp(cell.column, 0, Math.max(cells.length, 1) - 1)
    while (column > 0 && cells[column]?.width === 0) column -= 1
    const touched = cells[column]
    if (!touched?.chars || /^\s+$/u.test(touched.chars)) {
        return {
            start: { ...cell, column },
            end: { ...cell, column: column + 1 },
        }
    }

    let start = column
    let end = column + Math.max(touched.width, 1)
    while (start > 0) {
        let previous = start - 1
        while (previous > 0 && cells[previous]?.width === 0) previous -= 1
        const previousCell = cells[previous]
        if (!previousCell?.chars || /^\s+$/u.test(previousCell.chars)) break
        start = previous
    }
    while (end < cells.length) {
        const next = cells[end]
        if (!next?.chars || /^\s+$/u.test(next.chars)) break
        end += Math.max(next.width, 1)
    }
    return {
        start: { ...cell, column: start },
        end: { ...cell, column: end },
    }
}

export function rangeToSelection(
    range: TerminalCellRange,
    cols: number,
): { column: number; row: number; length: number } {
    return {
        column: range.start.column,
        row: range.start.row,
        length: Math.max(
            1,
            ((range.end.row - range.start.row) * cols)
                - range.start.column
                + range.end.column,
        ),
    }
}
