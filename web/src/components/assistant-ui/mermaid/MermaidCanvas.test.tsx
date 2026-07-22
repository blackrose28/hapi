import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidCanvas } from './MermaidCanvas'

const { panzoom, Panzoom } = vi.hoisted(() => {
    const panzoom = {
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        zoom: vi.fn(),
        zoomWithWheel: vi.fn((event: WheelEvent) => event.preventDefault()),
        pan: vi.fn(),
        getPan: vi.fn(() => ({ x: 0, y: 0 })),
        getScale: vi.fn(() => 1),
        destroy: vi.fn(),
    }
    return { panzoom, Panzoom: vi.fn(() => panzoom) }
})

vi.mock('@panzoom/panzoom', () => ({ default: Panzoom }))

const SVG = '<svg viewBox="0 0 100 50"></svg>'

describe('MermaidCanvas', () => {
    afterEach(cleanup)

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('lets ordinary inline wheel bubble but zooms Ctrl/Cmd wheel', () => {
        const { container } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        const canvas = container.querySelector('[data-mermaid-canvas]')!
        const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true })
        canvas.dispatchEvent(plain)
        expect(plain.defaultPrevented).toBe(false)
        expect(panzoom.zoomWithWheel).not.toHaveBeenCalled()
        const modified = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true })
        canvas.dispatchEvent(modified)
        expect(panzoom.zoomWithWheel).toHaveBeenCalledWith(modified)
        expect(modified.defaultPrevented).toBe(true)
    })

    it('zooms fullscreen wheel without a modifier', () => {
        const { container } = render(<MermaidCanvas svg={SVG} fullscreen ariaLabel="Diagram" onScaleChange={() => {}} />)
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true })
        container.querySelector('[data-mermaid-canvas]')!.dispatchEvent(wheel)
        expect(panzoom.zoomWithWheel).toHaveBeenCalledWith(wheel)
    })

    it('supports keyboard pan, zoom, and fit', () => {
        const { getByRole } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        const canvas = getByRole('application')
        fireEvent.keyDown(canvas, { key: 'ArrowRight' })
        expect(panzoom.pan).toHaveBeenCalledWith(40, 0, expect.objectContaining({ relative: true }))
        fireEvent.keyDown(canvas, { key: '+' })
        expect(panzoom.zoomIn).toHaveBeenCalled()
        fireEvent.keyDown(canvas, { key: '0' })
        expect(panzoom.zoom).toHaveBeenCalled()
    })

    it('reports Panzoom scale changes', () => {
        const onScaleChange = vi.fn()
        const { container } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={onScaleChange} />)
        fireEvent(container.querySelector('.mermaid-preview__content')!, new CustomEvent('panzoomchange', { detail: { scale: 2 } }))
        expect(onScaleChange).toHaveBeenCalledWith(2)
    })

    it('sizes the transform wrapper from the SVG viewBox before fitting', () => {
        const { container } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        const content = container.querySelector('.mermaid-preview__content') as HTMLDivElement
        expect(content.style.width).toBe('100px')
        expect(content.style.height).toBe('50px')
    })

    it('destroys Panzoom and removes listeners on unmount', () => {
        const { unmount } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        unmount()
        expect(panzoom.destroy).toHaveBeenCalled()
    })

    it('fits after a bounded wait when web fonts never settle', async () => {
        vi.useFakeTimers()
        const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: new Promise<never>(() => {}) },
        })

        render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        await act(async () => { await vi.advanceTimersByTimeAsync(20) })
        panzoom.zoom.mockClear()
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600)
            await vi.runOnlyPendingTimersAsync()
        })
        expect(panzoom.zoom).toHaveBeenCalled()

        if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
        else Reflect.deleteProperty(document, 'fonts')
        vi.useRealTimers()
    })

    it('does not run the font fallback after fonts are ready', async () => {
        vi.useFakeTimers()
        const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: Promise.resolve() },
        })

        render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
        await act(async () => {
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(10)
        })
        const callsAfterFontsReady = panzoom.zoom.mock.calls.length
        await act(async () => { await vi.advanceTimersByTimeAsync(600) })
        expect(panzoom.zoom).toHaveBeenCalledTimes(callsAfterFontsReady)

        if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
        else Reflect.deleteProperty(document, 'fonts')
        vi.useRealTimers()
    })

    it('cancels a pending fit frame when the canvas unmounts', async () => {
        vi.useFakeTimers()
        const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
        const { unmount } = render(
            <MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />,
        )
        await act(async () => { await vi.advanceTimersByTimeAsync(0) })
        unmount()
        expect(cancelFrame).toHaveBeenCalled()
        cancelFrame.mockRestore()
        vi.useRealTimers()
    })
})
