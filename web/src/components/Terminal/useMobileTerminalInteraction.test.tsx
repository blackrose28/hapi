import { act, fireEvent, renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileTerminalInteraction } from './useMobileTerminalInteraction'

const { safeCopyToClipboard } = vi.hoisted(() => ({
    safeCopyToClipboard: vi.fn<(text: string) => Promise<void>>(),
}))

vi.mock('@/lib/clipboard', () => ({ safeCopyToClipboard }))

type Listener = () => void

type CoordinateConvention = 'zero' | 'one' | 'unknown' | 'missing'

type TerminalFixture = {
    root: HTMLDivElement
    terminalElement: HTMLDivElement
    screen: HTMLDivElement
    textarea: HTMLTextAreaElement
    terminal: Terminal
    emitBlur: () => void
    emitCursorMove: () => void
    emitSelectionChange: () => void
    emitResize: () => void
    dropSelectionPosition: () => void
    setViewportY: (viewportY: number) => void
    select: ReturnType<typeof vi.fn>
    selectAll: ReturnType<typeof vi.fn>
    clearSelection: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    blur: ReturnType<typeof vi.fn>
    input: ReturnType<typeof vi.fn>
    scrollLines: ReturnType<typeof vi.fn>
    onBlur: ReturnType<typeof vi.fn>
    onResize: ReturnType<typeof vi.fn>
    getSelectionPosition: ReturnType<typeof vi.fn>
}

const ROOT_RECT = {
    left: 10,
    top: 20,
    width: 800,
    height: 200,
    right: 810,
    bottom: 220,
    x: 10,
    y: 20,
    toJSON: () => undefined,
} satisfies DOMRect

function createTerminalFixture(
    coordinateConvention: CoordinateConvention = 'zero',
): TerminalFixture {
    const root = document.createElement('div')
    const terminalElement = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    terminalElement.append(screen)
    root.append(terminalElement)
    document.body.append(root)
    root.getBoundingClientRect = vi.fn(() => ROOT_RECT)
    screen.getBoundingClientRect = vi.fn(() => ROOT_RECT)

    const textarea = Object.assign(document.createElement('textarea'), {
        readOnly: false,
    })
    terminalElement.append(textarea)

    const listeners = {
        blur: new Set<Listener>(),
        cursor: new Set<Listener>(),
        selection: new Set<Listener>(),
        resize: new Set<Listener>(),
    }
    const subscribe = (bucket: Set<Listener>, listener: Listener) => {
        bucket.add(listener)
        return { dispose: vi.fn(() => bucket.delete(listener)) }
    }

    let selectionPosition:
        | { start: { x: number; y: number }; end: { x: number; y: number } }
        | undefined
    const runtimePosition = (
        start: { column: number; row: number },
        end: { column: number; row: number },
    ) => {
        if (coordinateConvention === 'missing') return undefined
        const adjustment = coordinateConvention === 'one'
            ? 1
            : coordinateConvention === 'unknown'
                ? 4
                : 0
        return {
            start: {
                x: start.column + adjustment,
                y: start.row + adjustment,
            },
            end: {
                x: end.column + adjustment,
                y: end.row + adjustment,
            },
        }
    }
    const select = vi.fn((column: number, row: number, length: number) => {
        const endOffset = (row * 80) + column + length
        selectionPosition = runtimePosition(
            { column, row },
            {
                column: endOffset % 80,
                row: Math.floor(endOffset / 80),
            },
        )
        listeners.selection.forEach((listener) => listener())
    })
    const selectAll = vi.fn(() => {
        selectionPosition = runtimePosition(
            { column: 0, row: 0 },
            { column: 80, row: 39 },
        )
        listeners.selection.forEach((listener) => listener())
    })
    const clearSelection = vi.fn(() => {
        selectionPosition = undefined
        listeners.selection.forEach((listener) => listener())
    })
    const focus = vi.fn(() => textarea.focus())
    const blur = vi.fn(() => textarea.blur())
    const input = vi.fn()
    const scrollLines = vi.fn((amount: number) => {
        activeBuffer.viewportY = Math.max(
            0,
            Math.min(activeBuffer.baseY, activeBuffer.viewportY + amount),
        )
    })
    const onBlur = vi.fn((listener: Listener) => subscribe(listeners.blur, listener))
    const onCursorMove = vi.fn((listener: Listener) => subscribe(listeners.cursor, listener))
    const onSelectionChange = vi.fn(
        (listener: Listener) => subscribe(listeners.selection, listener),
    )
    const onResize = vi.fn((listener: Listener) => subscribe(listeners.resize, listener))
    const activeBuffer = {
        cursorX: 4,
        cursorY: 2,
        baseY: 30,
        viewportY: 30,
        length: 40,
        getLine: (row: number) => {
            const text = row === 35
                ? 'git status --short'
                : row === 12
                    ? 'old command output'
                    : ''
            return {
                getCell: (column: number) => ({
                    getChars: () => text[column] ?? '',
                    getWidth: () => 1,
                }),
                translateToString: () => text,
            }
        },
    }

    const getSelectionPosition = vi.fn(() => selectionPosition)
    const terminal = {
        cols: 80,
        rows: 10,
        textarea,
        element: terminalElement,
        buffer: { active: activeBuffer },
        focus,
        blur,
        input,
        scrollLines,
        select,
        selectAll,
        clearSelection,
        getSelection: vi.fn(() => 'status'),
        getSelectionPosition,
        onBlur,
        onCursorMove,
        onSelectionChange,
        onResize,
    } as unknown as Terminal

    return {
        root,
        terminalElement,
        screen,
        textarea,
        terminal,
        emitBlur: () => textarea.dispatchEvent(new Event('blur')),
        emitCursorMove: () => listeners.cursor.forEach((listener) => listener()),
        emitSelectionChange: () => listeners.selection.forEach((listener) => listener()),
        emitResize: () => listeners.resize.forEach((listener) => listener()),
        dropSelectionPosition: () => {
            selectionPosition = undefined
            listeners.selection.forEach((listener) => listener())
        },
        setViewportY: (viewportY) => {
            activeBuffer.viewportY = viewportY
        },
        select,
        selectAll,
        clearSelection,
        focus,
        blur,
        input,
        scrollLines,
        onBlur,
        onResize,
        getSelectionPosition,
    }
}

function touch(identifier: number, clientX: number, clientY: number): Touch {
    return {
        identifier,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
        screenX: clientX,
        screenY: clientY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
        target: document.body,
    } as Touch
}

function dispatchTouch(
    target: HTMLElement,
    type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
    touches: Touch[],
    changedTouches = touches,
): TouchEvent {
    const event = new Event(type, {
        bubbles: true,
        cancelable: true,
    }) as TouchEvent
    Object.defineProperties(event, {
        touches: { value: touches },
        targetTouches: { value: touches },
        changedTouches: { value: changedTouches },
    })
    target.dispatchEvent(event)
    return event
}

function pointerEvent(
    currentTarget: HTMLElement,
    clientX: number,
    clientY: number,
    pointerId = 7,
) {
    return {
        clientX,
        clientY,
        pointerId,
        currentTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    }
}

function dispatchPointer(
    target: HTMLElement,
    type: 'pointermove' | 'pointerup' | 'pointercancel',
    clientX: number,
    clientY: number,
    pointerId = 7,
): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: pointerId },
    })
    target.dispatchEvent(event)
    return event
}

function renderInteraction(
    fixture: TerminalFixture,
    mobile = true,
    initialEnabled = true,
) {
    return renderHook(
        ({ dismissRequested, enabled }) => useMobileTerminalInteraction({
            terminal: fixture.terminal,
            root: fixture.root,
            enabled,
            mobile,
            dismissRequested,
        }),
        {
            initialProps: {
                dismissRequested: false,
                enabled: initialEnabled,
            },
        },
    )
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function installVisualViewport(initialHeight: number) {
    let height = initialHeight
    const viewport = new EventTarget()
    Object.defineProperty(viewport, 'height', {
        configurable: true,
        get: () => height,
    })
    vi.stubGlobal('visualViewport', viewport)
    return {
        setHeight(nextHeight: number) {
            height = nextHeight
            viewport.dispatchEvent(new Event('resize'))
        },
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    safeCopyToClipboard.mockReset()
    safeCopyToClipboard.mockResolvedValue()
})

afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
})

describe('useMobileTerminalInteraction', () => {
    it('reveals choice in the next task after the original TUI click', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)
        const clickModes: string[] = []
        fixture.terminalElement.addEventListener('click', () => {
            clickModes.push(result.current.overlayProps.mode)
        })
        fixture.textarea.focus()

        let endEvent: TouchEvent
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            endEvent = dispatchTouch(
                fixture.terminalElement,
                'touchend',
                [],
                [point],
            )
        })

        expect(endEvent!.defaultPrevented).toBe(false)
        expect(result.current.overlayProps.mode).toBe('idle')
        expect(fixture.blur).not.toHaveBeenCalled()

        act(() => fixture.terminalElement.click())
        expect(clickModes).toEqual(['idle'])
        expect(result.current.overlayProps.mode).toBe('idle')

        act(() => vi.runOnlyPendingTimers())
        expect(result.current.overlayProps.mode).toBe('choice')
        expect(result.current.overlayProps.choiceAnchor).toEqual({ x: 45, y: 60 })
        expect(fixture.textarea.readOnly).toBe(true)
        expect(fixture.focus).not.toHaveBeenCalled()
        expect(fixture.blur).toHaveBeenCalledOnce()
        expect(document.activeElement).not.toBe(fixture.textarea)
    })

    it('toggles the choice bubble off on the second terminal body tap', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const first = touch(1, 55, 130)
        const second = touch(2, 55, 130)
        fixture.terminalElement.addEventListener('click', () => {
            fixture.textarea.focus()
        })

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [first])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [first])
            fixture.terminalElement.click()
            vi.runOnlyPendingTimers()
        })
        expect(result.current.overlayProps.mode).toBe('choice')

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [second])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [second])
            fixture.terminalElement.click()
            vi.runOnlyPendingTimers()
        })

        expect(result.current.overlayProps.mode).toBe('idle')
        expect(document.activeElement).not.toBe(fixture.textarea)
    })

    it.each([
        'reset',
        'dismiss',
        'new touch',
        'scroll',
        'disable',
        'unmount',
    ])('cancels a pending choice reveal on %s', (action) => {
        const fixture = createTerminalFixture()
        const interaction = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
        })
        expect(interaction.result.current.overlayProps.mode).toBe('idle')

        act(() => {
            if (action === 'reset') {
                interaction.result.current.reset()
            } else if (action === 'dismiss') {
                interaction.rerender({
                    dismissRequested: true,
                    enabled: true,
                })
            } else if (action === 'new touch') {
                dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            } else if (action === 'scroll') {
                dispatchTouch(fixture.terminalElement, 'touchstart', [point])
                dispatchTouch(
                    fixture.terminalElement,
                    'touchmove',
                    [touch(1, 55, 80)],
                )
            } else if (action === 'disable') {
                interaction.rerender({
                    dismissRequested: false,
                    enabled: false,
                })
            } else {
                interaction.unmount()
            }
        })
        const blurCallsAfterCancellation = fixture.blur.mock.calls.length
        act(() => vi.advanceTimersByTime(0))

        if (action !== 'unmount') {
            expect(interaction.result.current.overlayProps.mode).toBe('idle')
        }
        expect(fixture.blur).toHaveBeenCalledTimes(blurCallsAfterCancellation)
    })

    it('cancels a pending choice reveal when the terminal is replaced', () => {
        const first = createTerminalFixture()
        const second = createTerminalFixture()
        const { result, rerender } = renderHook(
            ({ fixture }) => useMobileTerminalInteraction({
                terminal: fixture.terminal,
                root: fixture.root,
                enabled: true,
                mobile: true,
                dismissRequested: false,
            }),
            { initialProps: { fixture: first } },
        )
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(first.terminalElement, 'touchstart', [point])
            dispatchTouch(first.terminalElement, 'touchend', [], [point])
        })
        act(() => rerender({ fixture: second }))
        const firstBlurCallsAfterReplacement = first.blur.mock.calls.length
        const secondBlurCallsAfterReplacement = second.blur.mock.calls.length
        act(() => vi.advanceTimersByTime(0))

        expect(result.current.overlayProps.mode).toBe('idle')
        expect(first.blur).toHaveBeenCalledTimes(firstBlurCallsAfterReplacement)
        expect(second.blur).toHaveBeenCalledTimes(secondBlurCallsAfterReplacement)
    })

    it('keeps explicit Input active when chosen before a pending reveal', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            result.current.overlayProps.onInput()
            vi.runOnlyPendingTimers()
        })

        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.textarea.readOnly).toBe(false)
        expect(fixture.focus).toHaveBeenCalledOnce()
        expect(fixture.blur).not.toHaveBeenCalled()
    })

    it('sends Enter without opening input mode or dismissing the choice', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            vi.runOnlyPendingTimers()
        })
        expect(result.current.overlayProps.mode).toBe('choice')

        const onEnter = (
            result.current.overlayProps as typeof result.current.overlayProps & {
                onEnter?: () => void
            }
        ).onEnter
        expect(onEnter).toBeTypeOf('function')
        act(() => onEnter?.())

        expect(fixture.input).toHaveBeenCalledOnce()
        expect(fixture.input).toHaveBeenCalledWith('\r', true)
        expect(fixture.focus).not.toHaveBeenCalled()
        expect(fixture.textarea.readOnly).toBe(true)
        expect(result.current.overlayProps.mode).toBe('choice')
    })

    it('lets a new long press enter selection without a stale choice reveal', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })

        expect(result.current.overlayProps.mode).toBe('select')
        expect(fixture.select).toHaveBeenCalledOnce()
    })

    it('turns a 40px swipe into scrollback and does not show choice', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const start = touch(1, 110, 140)
        const end = touch(1, 110, 100)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [start])
            const move = dispatchTouch(fixture.terminalElement, 'touchmove', [end])
            expect(move.defaultPrevented).toBe(true)
            dispatchTouch(fixture.terminalElement, 'touchend', [], [end])
            vi.advanceTimersByTime(450)
        })

        expect(fixture.scrollLines).toHaveBeenCalledWith(2)
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('enters word selection after 450ms and suppresses the tap', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })

        expect(fixture.select).toHaveBeenCalledWith(4, 35, 6)
        expect(result.current.overlayProps.mode).toBe('select')

        let endEvent: TouchEvent
        act(() => {
            endEvent = dispatchTouch(
                fixture.terminalElement,
                'touchend',
                [],
                [point],
            )
        })
        expect(endEvent!.defaultPrevented).toBe(true)
        expect(result.current.overlayProps.mode).toBe('select')
    })

    it('keeps long-press selection active through later movement and release', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const start = touch(1, 55, 130)
        const moved = touch(1, 55, 80)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [start])
            vi.advanceTimersByTime(450)
            dispatchTouch(fixture.terminalElement, 'touchmove', [moved])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [moved])
        })

        expect(result.current.overlayProps.mode).toBe('select')
        expect(fixture.scrollLines).not.toHaveBeenCalled()
        expect(fixture.textarea.readOnly).toBe(true)
    })

    it('keeps historical-output selection usable after touch cancel and recovers the choice bubble', async () => {
        const fixture = createTerminalFixture()
        fixture.setViewportY(10)
        const { result } = renderInteraction(fixture)
        const oldOutputPoint = touch(1, 35, 70)

        act(() => {
            dispatchTouch(
                fixture.terminalElement,
                'touchstart',
                [oldOutputPoint],
            )
            vi.advanceTimersByTime(450)
        })

        expect(fixture.select).toHaveBeenCalledWith(0, 12, 3)
        expect(result.current.overlayProps.mode).toBe('select')
        fixture.clearSelection.mockClear()

        act(() => {
            dispatchTouch(
                fixture.terminalElement,
                'touchcancel',
                [],
                [oldOutputPoint],
            )
        })

        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.toolbarAnchor).not.toBeNull()
        expect(fixture.clearSelection).not.toHaveBeenCalled()

        await act(async () => result.current.overlayProps.onCopy())
        expect(safeCopyToClipboard).toHaveBeenCalledWith('status')

        const inputPoint = touch(2, 55, 130)
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [inputPoint])
            dispatchTouch(
                fixture.terminalElement,
                'touchend',
                [],
                [inputPoint],
            )
            vi.advanceTimersToNextTimer()
        })

        expect(result.current.overlayProps.mode).toBe('choice')
    })

    it('makes textarea writable and focuses only when Input is chosen', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            vi.advanceTimersToNextTimer()
        })
        expect(fixture.textarea.readOnly).toBe(true)
        expect(fixture.focus).not.toHaveBeenCalled()
        expect(fixture.blur).toHaveBeenCalledOnce()
        expect(document.activeElement).not.toBe(fixture.textarea)

        act(() => {
            result.current.overlayProps.onInput()
            vi.advanceTimersByTime(1)
        })
        expect(fixture.textarea.readOnly).toBe(false)
        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.focus).toHaveBeenCalledOnce()
        expect(document.activeElement).toBe(fixture.textarea)

        act(() => fixture.emitBlur())
        expect(fixture.textarea.readOnly).toBe(true)
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('keeps an initially disabled mobile terminal readonly and unfocused', () => {
        const fixture = createTerminalFixture()
        fixture.textarea.focus()

        const { result } = renderInteraction(fixture, true, false)

        expect(fixture.textarea.readOnly).toBe(true)
        expect(fixture.blur).toHaveBeenCalled()
        expect(document.activeElement).not.toBe(fixture.textarea)
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('forces readonly and blur when Input becomes disabled', () => {
        const fixture = createTerminalFixture()
        const { result, rerender } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            result.current.overlayProps.onInput()
        })
        expect(fixture.textarea.readOnly).toBe(false)
        expect(document.activeElement).toBe(fixture.textarea)
        fixture.blur.mockClear()
        fixture.clearSelection.mockClear()

        act(() => rerender({ dismissRequested: false, enabled: false }))

        expect(fixture.textarea.readOnly).toBe(true)
        expect(fixture.blur).toHaveBeenCalled()
        expect(document.activeElement).not.toBe(fixture.textarea)
        expect(fixture.clearSelection).toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('stays readonly after mobile interaction is re-enabled until Input is explicit', () => {
        const fixture = createTerminalFixture()
        const { result, rerender } = renderInteraction(fixture, true, false)
        const point = touch(1, 55, 130)

        act(() => rerender({ dismissRequested: false, enabled: true }))
        expect(fixture.textarea.readOnly).toBe(true)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            vi.advanceTimersToNextTimer()
        })
        expect(result.current.overlayProps.mode).toBe('choice')
        expect(fixture.textarea.readOnly).toBe(true)

        act(() => result.current.overlayProps.onInput())
        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.textarea.readOnly).toBe(false)
    })

    it('leaves a disabled desktop terminal writable and focused', () => {
        const fixture = createTerminalFixture()
        fixture.textarea.focus()

        const { result } = renderInteraction(fixture, false, false)

        expect(fixture.textarea.readOnly).toBe(false)
        expect(fixture.blur).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(fixture.textarea)
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('does not let terminal touch gestures leave input mode', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const start = touch(1, 55, 130)
        const moved = touch(1, 55, 80)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [start])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [start])
            result.current.overlayProps.onInput()
            dispatchTouch(fixture.terminalElement, 'touchstart', [start])
            dispatchTouch(fixture.terminalElement, 'touchmove', [moved])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [moved])
            dispatchTouch(fixture.terminalElement, 'touchcancel', [], [moved])
            vi.advanceTimersByTime(450)
        })

        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.textarea.readOnly).toBe(false)
        expect(fixture.scrollLines).not.toHaveBeenCalled()
    })

    it('leaves input mode when the observed soft keyboard viewport closes', () => {
        const viewport = installVisualViewport(700)
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            vi.advanceTimersToNextTimer()
            result.current.overlayProps.onInput()
        })
        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.textarea.readOnly).toBe(false)

        act(() => viewport.setHeight(380))
        expect(result.current.overlayProps.mode).toBe('input')
        expect(fixture.textarea.readOnly).toBe(false)

        act(() => viewport.setHeight(700))
        expect(result.current.overlayProps.mode).toBe('idle')
        expect(fixture.textarea.readOnly).toBe(true)
        expect(document.activeElement).not.toBe(fixture.textarea)

        const nextPoint = touch(2, 55, 130)
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [nextPoint])
            dispatchTouch(
                fixture.terminalElement,
                'touchend',
                [],
                [nextPoint],
            )
            vi.advanceTimersToNextTimer()
        })

        expect(result.current.overlayProps.mode).toBe('choice')
        expect(fixture.textarea.readOnly).toBe(true)
    })

    it('resets on a non-cancelable touchcancel without trying to prevent it', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)
        const cancelEvent = new Event('touchcancel', {
            bubbles: true,
            cancelable: false,
        }) as TouchEvent
        Object.defineProperties(cancelEvent, {
            touches: { value: [] },
            targetTouches: { value: [] },
            changedTouches: { value: [point] },
        })
        const preventDefault = vi.spyOn(cancelEvent, 'preventDefault')

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            fixture.terminalElement.dispatchEvent(cancelEvent)
            vi.advanceTimersByTime(451)
        })

        expect(preventDefault).not.toHaveBeenCalled()
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('prevents a cancelable touchcancel and clears its timer and state', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        let cancelEvent: TouchEvent
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            cancelEvent = dispatchTouch(
                fixture.terminalElement,
                'touchcancel',
                [],
                [point],
            )
            vi.advanceTimersByTime(451)
        })

        expect(cancelEvent!.defaultPrevented).toBe(true)
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('selects, extends, selects all and safely copies output', async () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            result.current.overlayProps.onSelect()
            vi.advanceTimersByTime(0)
        })

        expect(fixture.select).toHaveBeenLastCalledWith(4, 35, 6)
        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.startHandle).toEqual({ x: 45, y: 120 })
        expect(result.current.overlayProps.endHandle).toEqual({ x: 105, y: 120 })
        expect(result.current.overlayProps.toolbarAnchor).toEqual({
            x: 75,
            y: 100,
        })

        const layer = document.createElement('div')
        layer.setPointerCapture = vi.fn()
        layer.releasePointerCapture = vi.fn()
        layer.hasPointerCapture = vi.fn(() => true)

        act(() => {
            result.current.overlayProps.onSelectionPointerDown(
                pointerEvent(layer, 215, 130) as never,
            )
            dispatchPointer(layer, 'pointermove', 265, 130)
            dispatchPointer(layer, 'pointerup', 265, 130)
        })
        expect(layer.setPointerCapture).toHaveBeenCalledWith(7)
        expect(fixture.select).toHaveBeenLastCalledWith(20, 35, 6)

        act(() => {
            result.current.overlayProps.onHandlePointerDown(
                'start',
                pointerEvent(layer, 215, 130) as never,
            )
            dispatchPointer(layer, 'pointermove', 185, 130)
            dispatchPointer(layer, 'pointerup', 185, 130)
        })
        expect(fixture.select).toHaveBeenLastCalledWith(17, 35, 9)

        act(() => result.current.overlayProps.onSelectAll())
        expect(fixture.selectAll).toHaveBeenCalledOnce()
        expect(result.current.overlayProps.mode).toBe('select')

        await act(async () => result.current.overlayProps.onCopy())
        expect(safeCopyToClipboard).toHaveBeenCalledWith('status')
        expect(fixture.clearSelection).toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
        expect(result.current.overlayProps.feedback).toBe('copied')
    })

    it('keeps selection active when clipboard copy fails', async () => {
        safeCopyToClipboard.mockRejectedValueOnce(new Error('denied'))
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        fixture.clearSelection.mockClear()

        await act(async () => result.current.overlayProps.onCopy())

        expect(fixture.clearSelection).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.feedback).toBe('copy-error')
    })

    it('keeps copied feedback visible briefly and clears it on a deterministic timeout', async () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        await act(async () => result.current.overlayProps.onCopy())

        expect(result.current.overlayProps.mode).toBe('idle')
        expect(result.current.overlayProps.feedback).toBe('copied')

        act(() => vi.advanceTimersByTime(1_599))
        expect(result.current.overlayProps.feedback).toBe('copied')

        act(() => vi.advanceTimersByTime(1))
        expect(result.current.overlayProps.mode).toBe('idle')
        expect(result.current.overlayProps.feedback).toBeNull()
    })

    it('cancels copied-feedback cleanup when the interaction lifecycle resets', async () => {
        const fixture = createTerminalFixture()
        const { result, rerender, unmount } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        await act(async () => result.current.overlayProps.onCopy())
        expect(result.current.overlayProps.feedback).toBe('copied')
        expect(vi.getTimerCount()).toBe(1)

        act(() => rerender({ dismissRequested: false, enabled: false }))
        expect(result.current.overlayProps.feedback).toBeNull()
        expect(vi.getTimerCount()).toBe(0)

        unmount()
        act(() => vi.advanceTimersByTime(1_600))
        expect(vi.getTimerCount()).toBe(0)
    })

    it('cancels copied feedback when a new touch action starts', async () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        await act(async () => result.current.overlayProps.onCopy())
        expect(result.current.overlayProps.feedback).toBe('copied')

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
        })
        expect(result.current.overlayProps.feedback).toBeNull()
        expect(vi.getTimerCount()).toBe(1)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchcancel', [], [point])
        })
        expect(vi.getTimerCount()).toBe(0)
    })

    it('clears the copied-feedback timeout on unmount', async () => {
        const fixture = createTerminalFixture()
        const { result, unmount } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        await act(async () => result.current.overlayProps.onCopy())
        expect(vi.getTimerCount()).toBe(1)

        unmount()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps select-all actions reachable when both selection ends are offscreen', async () => {
        const fixture = createTerminalFixture()
        fixture.setViewportY(15)
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
            result.current.overlayProps.onSelectAll()
        })

        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.startHandle).toBeNull()
        expect(result.current.overlayProps.endHandle).toBeNull()
        expect(result.current.overlayProps.toolbarAnchor).not.toBeNull()

        act(() => result.current.overlayProps.onCancel())
        expect(result.current.overlayProps.mode).toBe('idle')
        expect(fixture.clearSelection).toHaveBeenCalled()

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
            result.current.overlayProps.onSelectAll()
        })
        await act(async () => result.current.overlayProps.onCopy())

        expect(safeCopyToClipboard).toHaveBeenCalledWith('status')
        expect(result.current.overlayProps.mode).toBe('idle')
    })

    it('supports the one-based selection positions declared by xterm typings', () => {
        const fixture = createTerminalFixture('one')
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })

        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.startHandle).toEqual({ x: 45, y: 120 })
        expect(result.current.overlayProps.endHandle).toEqual({ x: 105, y: 120 })
    })

    it('fails closed for unknown or missing xterm selection coordinates', () => {
        for (const convention of ['unknown', 'missing'] as const) {
            const fixture = createTerminalFixture(convention)
            const { result, unmount } = renderInteraction(fixture)
            const point = touch(1, 55, 130)

            act(() => {
                dispatchTouch(fixture.terminalElement, 'touchstart', [point])
                vi.advanceTimersByTime(450)
            })

            expect(result.current.overlayProps.mode).toBe('idle')
            expect(result.current.overlayProps.startHandle).toBeNull()
            expect(result.current.overlayProps.endHandle).toBeNull()
            expect(fixture.clearSelection).toHaveBeenCalled()
            unmount()
            fixture.root.remove()
        }
    })

    it('fails closed and cancels active drag when selection position disappears', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        expect(result.current.overlayProps.mode).toBe('select')

        const layer = document.createElement('div')
        layer.setPointerCapture = vi.fn()
        layer.releasePointerCapture = vi.fn()
        layer.hasPointerCapture = vi.fn(() => true)
        act(() => {
            result.current.overlayProps.onSelectionPointerDown(
                pointerEvent(layer, 215, 130) as never,
            )
            dispatchPointer(layer, 'pointermove', 215, 25)
            fixture.dropSelectionPosition()
            vi.advanceTimersByTime(100)
        })

        expect(result.current.overlayProps.mode).toBe('idle')
        expect(result.current.overlayProps.startHandle).toBeNull()
        expect(result.current.overlayProps.endHandle).toBeNull()
        expect(layer.releasePointerCapture).toHaveBeenCalledWith(7)
        expect(fixture.scrollLines).not.toHaveBeenCalled()
    })

    it('lets only the latest concurrent copy operation update selection state', async () => {
        const firstCopy = deferred<void>()
        const secondCopy = deferred<void>()
        safeCopyToClipboard
            .mockImplementationOnce(() => firstCopy.promise)
            .mockImplementationOnce(() => secondCopy.promise)
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
            result.current.overlayProps.onCopy()
            result.current.overlayProps.onCopy()
        })
        fixture.clearSelection.mockClear()

        await act(async () => {
            firstCopy.resolve()
            await firstCopy.promise
        })
        expect(result.current.overlayProps.mode).toBe('select')
        expect(fixture.clearSelection).not.toHaveBeenCalled()

        await act(async () => {
            secondCopy.reject(new Error('latest denied'))
            await secondCopy.promise.catch(() => undefined)
        })
        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.feedback).toBe('copy-error')
    })

    it('invalidates pending copy on select-all and handle drag', async () => {
        const selectAllCopy = deferred<void>()
        const handleCopy = deferred<void>()
        safeCopyToClipboard
            .mockImplementationOnce(() => selectAllCopy.promise)
            .mockImplementationOnce(() => handleCopy.promise)
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
            result.current.overlayProps.onCopy()
            result.current.overlayProps.onSelectAll()
        })
        fixture.clearSelection.mockClear()
        await act(async () => {
            selectAllCopy.resolve()
            await selectAllCopy.promise
        })
        expect(result.current.overlayProps.mode).toBe('select')
        expect(fixture.clearSelection).not.toHaveBeenCalled()

        const handle = document.createElement('button')
        handle.setPointerCapture = vi.fn()
        handle.releasePointerCapture = vi.fn()
        handle.hasPointerCapture = vi.fn(() => true)
        act(() => {
            result.current.overlayProps.onCopy()
            result.current.overlayProps.onHandlePointerDown(
                'start',
                pointerEvent(handle, 55, 130) as never,
            )
        })
        await act(async () => {
            handleCopy.reject(new Error('stale denial'))
            await handleCopy.promise.catch(() => undefined)
        })
        expect(result.current.overlayProps.mode).toBe('select')
        expect(result.current.overlayProps.feedback).toBeNull()
    })

    it('ignores a pending clipboard result after reset', async () => {
        let rejectCopy: ((reason: Error) => void) | undefined
        safeCopyToClipboard.mockImplementationOnce(() => new Promise((_, reject) => {
            rejectCopy = reject
        }))
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
            result.current.overlayProps.onCopy()
            result.current.reset()
        })
        await act(async () => {
            rejectCopy?.(new Error('late denial'))
            await Promise.resolve()
        })

        expect(result.current.overlayProps.mode).toBe('idle')
        expect(result.current.overlayProps.feedback).toBeNull()
    })

    it('resets and clears timers on dismiss, pointer cancel and unmount', () => {
        const fixture = createTerminalFixture()
        const { result, rerender, unmount } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            rerender({ dismissRequested: true, enabled: true })
        })
        act(() => {
            vi.advanceTimersByTime(450)
        })
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')

        act(() => {
            rerender({ dismissRequested: false, enabled: true })
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        expect(result.current.overlayProps.mode).toBe('select')

        const layer = document.createElement('div')
        layer.setPointerCapture = vi.fn()
        layer.releasePointerCapture = vi.fn()
        layer.hasPointerCapture = vi.fn(() => true)
        act(() => {
            result.current.overlayProps.onSelectionPointerDown(
                pointerEvent(layer, 215, 130) as never,
            )
            dispatchPointer(layer, 'pointercancel', 215, 130)
        })
        expect(layer.releasePointerCapture).toHaveBeenCalledWith(7)
        expect(fixture.clearSelection).toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            unmount()
            vi.advanceTimersByTime(450)
        })
        expect(fixture.select).toHaveBeenCalledTimes(2)
        expect(fixture.textarea.readOnly).toBe(false)
    })

    it('cancels touch and pointer work on environment resize and subscribes to xterm resize', () => {
        const fixture = createTerminalFixture()
        const { result, unmount } = renderInteraction(fixture)
        const point = touch(1, 55, 130)

        expect(fixture.onResize).toHaveBeenCalledOnce()
        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            fixture.emitResize()
            vi.advanceTimersByTime(450)
        })
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            window.dispatchEvent(new Event('orientationchange'))
            vi.advanceTimersByTime(450)
        })
        expect(fixture.select).not.toHaveBeenCalled()

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            window.dispatchEvent(new Event('resize'))
            vi.advanceTimersByTime(450)
        })
        expect(fixture.select).not.toHaveBeenCalled()

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            vi.advanceTimersByTime(450)
        })
        const layer = document.createElement('div')
        layer.setPointerCapture = vi.fn()
        layer.releasePointerCapture = vi.fn()
        layer.hasPointerCapture = vi.fn(() => true)
        fixture.scrollLines.mockClear()
        act(() => {
            result.current.overlayProps.onSelectionPointerDown(
                pointerEvent(layer, 215, 130) as never,
            )
            dispatchPointer(layer, 'pointermove', 215, 25)
            window.dispatchEvent(new Event('resize'))
            vi.advanceTimersByTime(100)
        })
        expect(layer.releasePointerCapture).toHaveBeenCalledWith(7)
        expect(fixture.scrollLines).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('select')

        unmount()
        expect(fixture.onResize.mock.results[0]?.value.dispose).toHaveBeenCalledOnce()
    })

    it('does not install mobile behavior when the media query is desktop', () => {
        const fixture = createTerminalFixture()
        const { result } = renderInteraction(fixture, false)
        const point = touch(1, 55, 130)

        act(() => {
            dispatchTouch(fixture.terminalElement, 'touchstart', [point])
            dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
            vi.advanceTimersByTime(450)
        })

        expect(fixture.textarea.readOnly).toBe(false)
        expect(fixture.onBlur).not.toHaveBeenCalled()
        expect(fixture.clearSelection).not.toHaveBeenCalled()
        expect(fixture.select).not.toHaveBeenCalled()
        expect(result.current.overlayProps.mode).toBe('idle')
    })
})
