import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    MobileTerminalSelectionLifecycle,
    beginSelectionLayerDrag,
    createHandleDrag,
    rangeForSelectionDrag,
} from './mobileTerminalSelectionLifecycle'
import type { TerminalCellRange } from './terminalSelection'

const selectedRange: TerminalCellRange = {
    start: { column: 4, row: 35 },
    end: { column: 10, row: 35 },
}

function dispatchPointer(
    target: HTMLElement,
    type: 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
    clientX: number,
    clientY: number,
    pointerId = 7,
): void {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: pointerId },
    })
    target.dispatchEvent(event)
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
})

describe('mobile terminal selection lifecycle', () => {
    it('chooses replacement or nearest-edge drags and preserves the pinned edge', () => {
        const outside = beginSelectionLayerDrag(
            selectedRange,
            { column: 20, row: 35 },
            80,
        )
        expect(outside).toEqual({
            drag: {
                kind: 'range',
                anchor: { column: 20, row: 35 },
            },
            replacementRange: {
                start: { column: 20, row: 35 },
                end: { column: 21, row: 35 },
            },
        })
        expect(rangeForSelectionDrag(
            outside.drag,
            { column: 25, row: 35 },
            80,
        )).toEqual({
            start: { column: 20, row: 35 },
            end: { column: 26, row: 35 },
        })

        const inside = beginSelectionLayerDrag(
            selectedRange,
            { column: 5, row: 35 },
            80,
        )
        expect(inside.drag).toEqual({
            kind: 'start',
            anchor: selectedRange.end,
        })
        expect(rangeForSelectionDrag(
            inside.drag,
            { column: 2, row: 35 },
            80,
        )).toEqual({
            start: { column: 2, row: 35 },
            end: selectedRange.end,
        })

        expect(createHandleDrag(selectedRange, 'end')).toEqual({
            kind: 'end',
            anchor: selectedRange.start,
        })
    })

    it('uses latest-operation and selection-version wins for copy tokens', () => {
        const lifecycle = new MobileTerminalSelectionLifecycle()

        const firstCopy = lifecycle.beginCopy()
        const secondCopy = lifecycle.beginCopy()
        expect(lifecycle.isCopyCurrent(firstCopy)).toBe(false)
        expect(lifecycle.isCopyCurrent(secondCopy)).toBe(true)

        lifecycle.selectionMutated()
        expect(lifecycle.isCopyCurrent(secondCopy)).toBe(false)

        const thirdCopy = lifecycle.beginCopy()
        lifecycle.reset()
        expect(lifecycle.isCopyCurrent(thirdCopy)).toBe(false)
    })

    it('stops pointer capture and edge-scroll frames when capture is lost', () => {
        const lifecycle = new MobileTerminalSelectionLifecycle()
        const layer = document.createElement('div')
        let captured = false
        layer.setPointerCapture = vi.fn(() => {
            captured = true
        })
        layer.hasPointerCapture = vi.fn(() => captured)
        layer.releasePointerCapture = vi.fn(() => {
            captured = false
        })
        const applyPoint = vi.fn()
        const scrollEdge = vi.fn()
        const onCancel = vi.fn()

        lifecycle.startPointer({
            target: layer,
            pointerId: 7,
            applyPoint,
            edgeDirection: () => 1,
            scrollEdge,
            onCancel,
        })
        dispatchPointer(layer, 'pointermove', 40, 198)
        vi.advanceTimersByTime(20)
        expect(scrollEdge).toHaveBeenCalledWith(1)
        expect(applyPoint).toHaveBeenCalledWith(40, 198)

        captured = false
        dispatchPointer(layer, 'lostpointercapture', 40, 198)
        const scrollCount = scrollEdge.mock.calls.length
        vi.advanceTimersByTime(100)

        expect(scrollEdge).toHaveBeenCalledTimes(scrollCount)
        expect(onCancel).not.toHaveBeenCalled()
        expect(layer.releasePointerCapture).not.toHaveBeenCalled()
    })
})
