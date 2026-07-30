import { describe, expect, it, vi } from 'vitest'
import {
    XtermSelectionCoordinateAdapter,
    type RawXtermSelectionPosition,
} from './terminalSelectionCoordinates'
import type { TerminalCellRange } from './terminalSelection'

const expectedRange: TerminalCellRange = {
    start: { column: 4, row: 35 },
    end: { column: 10, row: 35 },
}

const bounds = { cols: 80, bufferLength: 40 }

describe('XtermSelectionCoordinateAdapter', () => {
    it('detects and normalizes a zero-based xterm runtime response', () => {
        const adapter = new XtermSelectionCoordinateAdapter()
        adapter.expectSelection(expectedRange)

        expect(adapter.resolve({
            start: { x: 4, y: 35 },
            end: { x: 10, y: 35 },
        }, bounds)).toEqual({
            status: 'resolved',
            base: 'zero',
            range: expectedRange,
        })
    })

    it('detects and normalizes the one-based convention declared by xterm typings', () => {
        const adapter = new XtermSelectionCoordinateAdapter()
        adapter.expectSelection(expectedRange)

        expect(adapter.resolve({
            start: { x: 5, y: 36 },
            end: { x: 11, y: 36 },
        }, bounds)).toEqual({
            status: 'resolved',
            base: 'one',
            range: expectedRange,
        })
    })

    it('fails closed when the response matches neither coordinate convention', () => {
        const adapter = new XtermSelectionCoordinateAdapter()
        adapter.expectSelection(expectedRange)

        expect(adapter.resolve({
            start: { x: 9, y: 12 },
            end: { x: 15, y: 12 },
        }, bounds)).toEqual({ status: 'unknown' })
    })

    it('treats a missing position as unavailable instead of reusing stale state', () => {
        const adapter = new XtermSelectionCoordinateAdapter()
        adapter.expectSelection(expectedRange)

        expect(adapter.resolve(
            undefined as RawXtermSelectionPosition | undefined,
            bounds,
        )).toEqual({ status: 'missing' })
    })

    it('adapts the coordinate contract of the installed xterm runtime', async () => {
        const canvasContext = vi.spyOn(
            HTMLCanvasElement.prototype,
            'getContext',
        ).mockReturnValue(null)
        const originalMatchMedia = window.matchMedia
        window.matchMedia = vi.fn(() => ({
            matches: false,
            media: '',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
        }))
        const { Terminal } = await import('@xterm/xterm')
        const host = document.createElement('div')
        document.body.append(host)
        const terminal = new Terminal({ cols: 80, rows: 10 })

        try {
            terminal.open(host)
            const range: TerminalCellRange = {
                start: { column: 4, row: 5 },
                end: { column: 10, row: 5 },
            }
            const adapter = new XtermSelectionCoordinateAdapter()
            adapter.expectSelection(range)
            terminal.select(4, 5, 6)

            expect(adapter.resolve(
                terminal.getSelectionPosition(),
                { cols: terminal.cols, bufferLength: terminal.buffer.active.length },
            )).toEqual({
                status: 'resolved',
                base: 'zero',
                range,
            })
        } finally {
            terminal.dispose()
            host.remove()
            window.matchMedia = originalMatchMedia
            canvasContext.mockRestore()
        }
    })
})
