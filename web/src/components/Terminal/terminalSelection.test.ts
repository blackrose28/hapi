import { describe, expect, it } from 'vitest'
import {
    cellToScreenPoint,
    normalizeRange,
    pointToBufferCell,
    rangeToSelection,
    wordRangeAt,
} from './terminalSelection'

const metrics = {
    rect: { left: 10, top: 20, width: 320, height: 200 },
    cols: 80,
    rows: 10,
    viewportY: 30,
}

describe('terminalSelection', () => {
    it('maps and clamps a screen point to the visible buffer', () => {
        expect(pointToBufferCell({ x: 170, y: 130 }, metrics)).toEqual({ column: 40, row: 35 })
        expect(pointToBufferCell({ x: -20, y: 999 }, metrics)).toEqual({ column: 0, row: 39 })
    })

    it('maps a visible buffer cell back to a screen anchor', () => {
        expect(cellToScreenPoint({ column: 40, row: 35 }, metrics)).toEqual({ x: 162, y: 120 })
        expect(cellToScreenPoint({ column: 2, row: 10 }, metrics)).toBeNull()
    })

    it('selects the non-whitespace word under the touched cell', () => {
        const cells = Array.from('git status --short', (chars) => ({ chars, width: 1 }))
        expect(wordRangeAt(cells, { column: 5, row: 8 })).toEqual({
            start: { column: 4, row: 8 },
            end: { column: 10, row: 8 },
        })
    })

    it('uses a one-cell range when the touched cell is blank', () => {
        const cells = Array.from('git  status', (chars) => ({ chars, width: 1 }))
        expect(wordRangeAt(cells, { column: 3, row: 8 })).toEqual({
            start: { column: 3, row: 8 },
            end: { column: 4, row: 8 },
        })
    })

    it('keeps a wide glyph and its continuation cell in one word', () => {
        const cells = [
            { chars: '你', width: 2 },
            { chars: '', width: 0 },
            { chars: '好', width: 2 },
            { chars: '', width: 0 },
            { chars: ' ', width: 1 },
        ]
        expect(wordRangeAt(cells, { column: 1, row: 8 })).toEqual({
            start: { column: 0, row: 8 },
            end: { column: 4, row: 8 },
        })
    })

    it('normalizes reverse drags and converts the range for xterm.select', () => {
        const range = normalizeRange(
            { column: 12, row: 7 },
            { column: 3, row: 6 },
        )
        expect(range).toEqual({
            start: { column: 3, row: 6 },
            end: { column: 12, row: 7 },
        })
        expect(rangeToSelection(range, 80)).toEqual({ column: 3, row: 6, length: 89 })
    })
})
