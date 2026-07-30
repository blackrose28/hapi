# Mobile Terminal Input and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit `Nhập | Chọn` mobile terminal interaction, sweep-plus-handle output selection, safe copy, and helper keys that never summon the native phone keyboard.

**Architecture:** Keep xterm ownership in `TerminalView`, move buffer/cell math into pure helpers, and render all mobile-only affordances through a focused overlay component. A dedicated hook owns the four-state interaction lifecycle and manipulates xterm only through public APIs; `SessionTerminalTabs` only supplies enabled/dismiss signals.

**Tech Stack:** React 19, TypeScript 5.9 strict, xterm 6 public API, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Apply only below the existing `lg` breakpoint (`max-width: 1023px`).
- Web-only; no Hub, CLI, PTY protocol or persistence changes.
- Only explicit `Nhập` may make the xterm helper textarea writable and focus it.
- Touch movement threshold is 6px; long-press threshold is 450ms.
- Primary touch hit areas are at least 44×44px.
- Desktop focus, mouse selection and keyboard behavior remain unchanged.
- Do not include the separate PTY-width/horizontal-overflow correction.
- Use existing HAPI theme tokens and `safeCopyToClipboard`; add no dependency.

---

## File Map

| File | Responsibility |
|---|---|
| `web/src/components/Terminal/terminalSelection.ts` | Pure cell, word, range and screen-coordinate calculations |
| `web/src/components/Terminal/terminalSelection.test.ts` | Boundary and wrapped-line tests for the pure helpers |
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx` | Choice bubble, handles, selection toolbar and live feedback |
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx` | Visual-state and action routing tests |
| `web/src/components/Terminal/useMobileTerminalInteraction.ts` | Mobile gesture state machine and xterm public-API adapter |
| `web/src/components/Terminal/useMobileTerminalInteraction.test.tsx` | Tap/scroll/long-press/input/select/copy lifecycle tests |
| `web/src/components/Terminal/TerminalView.tsx` | Create xterm host, install the mobile controller and render overlay |
| `web/src/components/Terminal/TerminalView.test.tsx` | Mount integration and desktop/mobile regression |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | Supply enabled and dock-dismiss state to `TerminalView` |
| `web/src/components/Terminal/TerminalControlDock.tsx` | Rename Keyboard to Keys and remove all implicit terminal focus |
| `web/src/components/Terminal/TerminalControlDock.test.tsx` | Verify Paste/Keys/helper actions do not focus xterm |
| `web/src/components/Terminal/SessionTerminalTabs.test.tsx` | Shared terminal-shell wiring regression |
| `web/src/lib/locales/en.ts` | English interaction labels |
| `web/src/lib/locales/vi-VN.ts` | Vietnamese interaction labels |
| `web/src/lib/locales/zh-CN.ts` | Chinese interaction labels |

---

### Task 1: Pure terminal selection geometry

**Files:**
- Create: `web/src/components/Terminal/terminalSelection.ts`
- Create: `web/src/components/Terminal/terminalSelection.test.ts`

**Interfaces:**
- Produces:
  - `TerminalCell`
  - `TerminalCellRange`
  - `TerminalScreenMetrics`
  - `pointToBufferCell(point, metrics)`
  - `cellToScreenPoint(cell, metrics)`
  - `wordRangeAt(cells, cell)`
  - `normalizeRange(anchor, focus)`
  - `rangeToSelection(range, cols)`

- [ ] **Step 1: Write failing tests for coordinate conversion, word selection and reversed ranges**

```ts
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
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is missing**

Run:

```bash
bun --cwd web test src/components/Terminal/terminalSelection.test.ts
```

Expected: FAIL resolving `./terminalSelection`.

- [ ] **Step 3: Implement zero-based, end-exclusive selection helpers**

```ts
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
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun --cwd web test src/components/Terminal/terminalSelection.test.ts
bun --cwd web typecheck
```

Expected: all focused tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit the helper slice**

```bash
git add web/src/components/Terminal/terminalSelection.ts \
  web/src/components/Terminal/terminalSelection.test.ts
git commit -m "feat(web): add terminal selection geometry"
```

---

### Task 2: Mobile choice and selection overlay

**Files:**
- Create: `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx`
- Create: `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx`

**Interfaces:**
- Consumes: `TerminalCellRange` and screen points from Task 1.
- Produces:

```ts
export type MobileTerminalOverlayProps = {
    mode: 'idle' | 'choice' | 'input' | 'select'
    choiceAnchor: { x: number; y: number } | null
    startHandle: { x: number; y: number } | null
    endHandle: { x: number; y: number } | null
    toolbarAnchor: { x: number; y: number } | null
    feedback: 'copied' | 'copy-error' | null
    onInput: () => void
    onSelect: () => void
    onCopy: () => void
    onSelectAll: () => void
    onCancel: () => void
    onSelectionPointerDown: React.PointerEventHandler<HTMLDivElement>
    onHandlePointerDown: (
        edge: 'start' | 'end',
        event: React.PointerEvent<HTMLButtonElement>,
    ) => void
}
```

- [ ] **Step 1: Write failing rendering and action-routing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileTerminalInteractionOverlay } from './MobileTerminalInteractionOverlay'

const baseProps = {
    mode: 'idle' as const,
    choiceAnchor: null,
    startHandle: null,
    endHandle: null,
    toolbarAnchor: null,
    feedback: null,
    onInput: vi.fn(),
    onSelect: vi.fn(),
    onCopy: vi.fn(),
    onSelectAll: vi.fn(),
    onCancel: vi.fn(),
    onSelectionPointerDown: vi.fn(),
    onHandlePointerDown: vi.fn(),
}

describe('MobileTerminalInteractionOverlay', () => {
    it('renders the choice actions at the supplied anchor', () => {
        render(<MobileTerminalInteractionOverlay
            {...baseProps}
            mode="choice"
            choiceAnchor={{ x: 120, y: 80 }}
        />)
        fireEvent.click(screen.getByRole('button', { name: 'Input' }))
        fireEvent.click(screen.getByRole('button', { name: 'Select' }))
        expect(baseProps.onInput).toHaveBeenCalledOnce()
        expect(baseProps.onSelect).toHaveBeenCalledOnce()
    })

    it('renders handles and all selection actions in select mode', () => {
        render(<MobileTerminalInteractionOverlay
            {...baseProps}
            mode="select"
            startHandle={{ x: 40, y: 100 }}
            endHandle={{ x: 180, y: 120 }}
            toolbarAnchor={{ x: 110, y: 70 }}
        />)
        expect(screen.getByRole('button', { name: 'Selection start' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Selection end' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Select all' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()
    })

    it('announces copy failure without removing selection controls', () => {
        render(<MobileTerminalInteractionOverlay
            {...baseProps}
            mode="select"
            feedback="copy-error"
        />)
        expect(screen.getByRole('status')).toHaveTextContent('Could not copy')
        expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
    })
})
```

- [ ] **Step 2: Run the test and confirm the component is missing**

Run:

```bash
bun --cwd web test src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx
```

Expected: FAIL resolving the component.

- [ ] **Step 3: Implement a pointer-transparent overlay with 44px control hit areas**

Core structure:

```tsx
export function MobileTerminalInteractionOverlay(props: MobileTerminalOverlayProps) {
    const { t } = useTranslation()
    if (props.mode === 'idle' || props.mode === 'input') return null

    return (
        <div className="pointer-events-none absolute inset-0 z-20 lg:hidden">
            {props.mode === 'choice' && props.choiceAnchor ? (
                <div
                    role="toolbar"
                    aria-label={t('terminal.interaction.choice')}
                    className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full overflow-hidden rounded-full border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-1 shadow-xl backdrop-blur"
                    style={{ left: props.choiceAnchor.x, top: props.choiceAnchor.y }}
                >
                    <button type="button" className="min-h-11 px-4 text-sm font-medium" onClick={props.onInput}>
                        {t('terminal.interaction.input')}
                    </button>
                    <span aria-hidden="true" className="my-2 w-px bg-[var(--app-border)]" />
                    <button type="button" className="min-h-11 px-4 text-sm font-medium" onClick={props.onSelect}>
                        {t('terminal.interaction.select')}
                    </button>
                </div>
            ) : null}

            {props.mode === 'select' ? (
                <div
                    data-testid="terminal-selection-layer"
                    className="pointer-events-auto absolute inset-0 touch-none"
                    onPointerDown={props.onSelectionPointerDown}
                >
                    <SelectionHandle edge="start" point={props.startHandle} onPointerDown={props.onHandlePointerDown} />
                    <SelectionHandle edge="end" point={props.endHandle} onPointerDown={props.onHandlePointerDown} />
                    <SelectionToolbar anchor={props.toolbarAnchor} {...props} />
                </div>
            ) : null}

            <span role="status" aria-live="polite" className="sr-only">
                {props.feedback === 'copied'
                    ? t('terminal.interaction.copied')
                    : props.feedback === 'copy-error'
                        ? t('terminal.interaction.copyFailed')
                        : ''}
            </span>
        </div>
    )
}
```

`SelectionHandle` must render a visually small violet marker inside an absolutely positioned 44×44px button. `SelectionToolbar` must stop pointer propagation, expose `Copy`, `Select all`, and `Cancel`, and use the same clamped anchor convention as the choice bubble.

- [ ] **Step 4: Run focused test and typecheck**

Run:

```bash
bun --cwd web test src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx
bun --cwd web typecheck
```

Expected: focused tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit the overlay**

```bash
git add web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx \
  web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx
git commit -m "feat(web): add mobile terminal selection overlay"
```

---

### Task 3: Mobile terminal interaction controller

**Files:**
- Create: `web/src/components/Terminal/useMobileTerminalInteraction.ts`
- Create: `web/src/components/Terminal/useMobileTerminalInteraction.test.tsx`

**Interfaces:**
- Consumes:

```ts
type UseMobileTerminalInteractionOptions = {
    terminal: Terminal | null
    root: HTMLElement | null
    enabled: boolean
    mobile: boolean
    dismissRequested: boolean
}
```

- Produces:

```ts
type MobileTerminalInteraction = {
    overlayProps: MobileTerminalOverlayProps
    reset: () => void
}
```

- [ ] **Step 1: Write failing controller tests with fake timers and a public-API xterm fake**

Cover these exact scenarios:

```tsx
it('shows choice after a short tap without making the textarea writable', ...)
it('turns a 40px swipe into scrollback and does not show choice', ...)
it('enters word selection after 450ms and suppresses the tap', ...)
it('makes textarea writable and focuses only when Input is chosen', ...)
it('selects, extends, selects all and safely copies output', ...)
it('keeps selection active when clipboard copy fails', ...)
it('resets and clears timers on dismiss, pointer cancel and unmount', ...)
it('does not install mobile behavior when the media query is desktop', ...)
```

The xterm fake must expose only the public APIs used by production:

```ts
const terminal = {
    cols: 80,
    rows: 10,
    textarea: Object.assign(document.createElement('textarea'), { readOnly: false }),
    element: terminalElement,
    buffer: {
        active: {
            cursorX: 4,
            cursorY: 2,
            baseY: 30,
            viewportY: 30,
            length: 40,
            getLine: (row: number) => ({
                translateToString: () => row === 35 ? 'git status --short' : '',
            }),
        },
    },
    focus: vi.fn(),
    blur: vi.fn(),
    scrollLines: vi.fn(),
    select: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    getSelection: vi.fn(() => 'status'),
    getSelectionPosition: vi.fn(),
    onBlur: vi.fn(() => ({ dispose: vi.fn() })),
    onCursorMove: vi.fn(() => ({ dispose: vi.fn() })),
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
} as unknown as Terminal
```

- [ ] **Step 2: Run the focused test and confirm the hook is missing**

Run:

```bash
bun --cwd web test src/components/Terminal/useMobileTerminalInteraction.test.tsx
```

Expected: FAIL resolving the hook.

- [ ] **Step 3: Implement the deterministic state machine**

Required constants and lifecycle:

```ts
const MOVE_THRESHOLD_PX = 6
const LONG_PRESS_MS = 450
const EDGE_SCROLL_PX = 28

type InteractionMode = 'idle' | 'choice' | 'input' | 'select'

type TouchSession = {
    identifier: number
    start: { x: number; y: number }
    last: { x: number; y: number }
    seedCell: TerminalCell
    scrolling: boolean
    longPressed: boolean
}
```

Implementation rules:

1. On mobile mount, set `terminal.textarea.readOnly = true` without changing `terminal.options.disableStdin`; this blocks the soft keyboard while preserving TUI mouse reports.
2. `touchstart` records the original cell and starts one 450ms timer.
3. `touchmove` beyond 6px cancels the timer, closes choice, prevents default, and reuses the existing line-height conversion for vertical `terminal.scrollLines`.
4. Long press calls `selectWord(seedCell)`, switches to `select`, and marks the session so `touchend` prevents its synthetic tap.
5. A short `touchend` computes a clamped cursor anchor, falls back to the touch point if the cursor is offscreen, and switches to `choice`.
6. `onInput` must synchronously set `textarea.readOnly = false`, switch to `input`, then call `terminal.focus()`.
7. `terminal.onBlur` restores `readOnly = true` and returns `input` to `idle`.
8. `onSelect` reads the seed line with `buffer.active.getLine(row)?.getCell(column)`, preserving each cell's `getChars()` and `getWidth()`, calls `terminal.select`, and switches to `select`.
9. The selection layer uses pointer capture. Starting outside the current range replaces the anchor; starting inside moves the nearest edge. Every move calls `terminal.select` with `rangeToSelection`.
10. Handle drags pin the opposite edge and move only their own edge.
11. Pointer positions within 28px of the top/bottom call `scrollLines(-1/1)` at a throttled animation-frame cadence before recomputing the cell.
12. `onCopy` awaits `safeCopyToClipboard(terminal.getSelection())`; success clears selection and returns to idle, failure keeps selection and exposes `copy-error`.
13. Dismiss, disabled, tab replacement, cancel and unmount clear timers, pointer capture, feedback and selection.

The controller must derive overlay handle positions from `terminal.getSelectionPosition()` (convert xterm's 1-based positions to zero-based cells) and listen to `onCursorMove`/`onSelectionChange` so new output and resize cannot leave stale overlays.

- [ ] **Step 4: Run controller tests and typecheck**

Run:

```bash
bun --cwd web test src/components/Terminal/useMobileTerminalInteraction.test.tsx
bun --cwd web typecheck
```

Expected: all controller tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit the controller**

```bash
git add web/src/components/Terminal/useMobileTerminalInteraction.ts \
  web/src/components/Terminal/useMobileTerminalInteraction.test.tsx
git commit -m "feat(web): control mobile terminal input and selection"
```

---

### Task 4: Integrate the controller into the shared terminal surface

**Files:**
- Modify: `web/src/components/Terminal/TerminalView.tsx`
- Modify: `web/src/components/Terminal/TerminalView.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`

**Interfaces:**
- `TerminalView` adds:

```ts
mobileInteractionEnabled?: boolean
dismissMobileInteraction?: boolean
```

- [ ] **Step 1: Extend TerminalView tests before integration**

Add assertions that:

- Mobile mount renders a writable xterm host plus the overlay layer only when needed.
- The old vertical touch-scroll behavior remains covered by the controller test and is removed from `TerminalView`.
- Desktop matchMedia leaves the xterm textarea writable.
- Changing `dismissMobileInteraction` clears a visible choice/selection.
- Unmount disposes xterm and controller listeners once.

- [ ] **Step 2: Run focused integration tests and confirm the new props/behavior fail**

Run:

```bash
bun --cwd web test \
  src/components/Terminal/TerminalView.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx
```

Expected: FAIL because controller wiring is absent.

- [ ] **Step 3: Split the root and xterm host, then render the overlay**

Target structure:

```tsx
const mobile = useMediaQuery('(max-width: 1023px)')
const [terminal, setTerminal] = useState<Terminal | null>(null)
const [root, setRoot] = useState<HTMLDivElement | null>(null)
const xtermHostRef = useRef<HTMLDivElement | null>(null)

const interaction = useMobileTerminalInteraction({
    terminal,
    root,
    mobile,
    enabled: props.mobileInteractionEnabled ?? true,
    dismissRequested: props.dismissMobileInteraction ?? false,
})

return (
    <div
        ref={setRoot}
        className={`relative h-full w-full overflow-hidden ${props.className ?? ''}`}
    >
        <div ref={xtermHostRef} className="h-full w-full" />
        <MobileTerminalInteractionOverlay {...interaction.overlayProps} />
    </div>
)
```

Create and open xterm against `xtermHostRef.current`, call `setTerminal(terminal)` after `open`, and set it back to `null` during cleanup. Remove the previous inline touch-scroll listener so one controller owns gesture arbitration.

In `SessionTerminalTabs`, pass:

```tsx
mobileInteractionEnabled={!quickInputDisabled}
dismissMobileInteraction={activeDockTool !== null}
```

The existing `key={activeTerminalId}` remains the terminal-tab reset boundary.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun --cwd web test \
  src/components/Terminal/TerminalView.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx
bun --cwd web typecheck
```

Expected: focused tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit shared-surface integration**

```bash
git add web/src/components/Terminal/TerminalView.tsx \
  web/src/components/Terminal/TerminalView.test.tsx \
  web/src/components/Terminal/SessionTerminalTabs.tsx \
  web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "feat(web): integrate mobile terminal interaction UX"
```

---

### Task 5: Correct dock semantics and translations

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Rename internal tool value `'keyboard'` to `'keys'`.
- Replace translation keys:
  - `terminal.controls.keyboard` → `terminal.controls.keys`
  - `terminal.controls.keyboardPanel` → `terminal.controls.keysPanel`
- Add:
  - `terminal.interaction.choice`
  - `terminal.interaction.input`
  - `terminal.interaction.select`
  - `terminal.interaction.selectionStart`
  - `terminal.interaction.selectionEnd`
  - `terminal.interaction.copy`
  - `terminal.interaction.selectAll`
  - `terminal.interaction.cancel`
  - `terminal.interaction.copied`
  - `terminal.interaction.copyFailed`

- [ ] **Step 1: Replace the old focus assertions with explicit no-focus tests**

```tsx
it('opens Keys without focusing xterm', () => {
    const onFocusTerminal = vi.fn()
    renderDock({ onFocusTerminal })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Keys' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
    expect(onFocusTerminal).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Terminal helper keys' })).toBeVisible()
})

it('pastes without focusing xterm or summoning native input', async () => {
    const onFocusTerminal = vi.fn()
    renderDock({ onFocusTerminal })
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    await waitFor(() => expect(defaultProps.onWritePlainInput).toHaveBeenCalled())
    expect(onFocusTerminal).not.toHaveBeenCalled()
})
```

Keep tests proving helper sequences still route through `onQuickInput` and Ctrl/Alt still route through `onModifierToggle`.

- [ ] **Step 2: Run dock tests and confirm they fail under Keyboard/focus behavior**

Run:

```bash
bun --cwd web test src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: FAIL finding `Keys`, or FAIL because focus is called.

- [ ] **Step 3: Rename the tool and remove implicit focus paths**

Required code changes:

```ts
export type TerminalDockTool = 'snippets' | 'search' | 'history' | 'keys' | 'more'
```

- Rename `KeyboardKeyGrid` to `HelperKeyGrid`.
- Rename the dock icon map key from `keyboard` to `keys`.
- Remove `handleTerminalFocusPointerDown`.
- Remove `onPointerDown` from Paste and Keys dock buttons.
- Remove `onReturnFocus` from `ManualPasteDialog`; closing manual paste must not focus xterm.
- Render the helper panel when `activeTool === 'keys'`.
- Keep `onFocusTerminal` temporarily in the public prop only if another caller still needs it; otherwise remove it from `TerminalControlDockProps` and `SessionTerminalTabs`.

Translation values:

| Key | English | Vietnamese | Chinese |
|---|---|---|---|
| `terminal.controls.keys` | Keys | Phím | 按键 |
| `terminal.controls.keysPanel` | Terminal helper keys | Phím hỗ trợ terminal | 终端辅助按键 |
| `terminal.interaction.choice` | Terminal action | Thao tác terminal | 终端操作 |
| `terminal.interaction.input` | Input | Nhập | 输入 |
| `terminal.interaction.select` | Select | Chọn | 选择 |
| `terminal.interaction.selectionStart` | Selection start | Đầu vùng chọn | 选择起点 |
| `terminal.interaction.selectionEnd` | Selection end | Cuối vùng chọn | 选择终点 |
| `terminal.interaction.copy` | Copy | Sao chép | 复制 |
| `terminal.interaction.selectAll` | Select all | Chọn tất cả | 全选 |
| `terminal.interaction.cancel` | Cancel | Hủy | 取消 |
| `terminal.interaction.copied` | Copied | Đã sao chép | 已复制 |
| `terminal.interaction.copyFailed` | Could not copy | Không thể sao chép | 无法复制 |

- [ ] **Step 4: Run dock, session-shell and type tests**

Run:

```bash
bun --cwd web test \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx
bun --cwd web typecheck
```

Expected: focused tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit dock correction**

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx \
  web/src/components/Terminal/TerminalControlDock.test.tsx \
  web/src/components/Terminal/SessionTerminalTabs.test.tsx \
  web/src/lib/locales/en.ts \
  web/src/lib/locales/vi-VN.ts \
  web/src/lib/locales/zh-CN.ts
git commit -m "fix(web): separate terminal helper keys from native input"
```

---

### Task 6: Full regression and real mobile-browser verification

**Files:**
- Modify only files from Tasks 1–5 if verification finds a defect.

- [ ] **Step 1: Run all web tests**

```bash
bun --cwd web test
```

Expected: all test files and tests PASS.

- [ ] **Step 2: Run web typecheck and production build**

```bash
bun --cwd web typecheck
bun --cwd web build
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect actual diff scope**

```bash
git diff --check HEAD~5..HEAD
git diff --stat HEAD~5..HEAD
git status --short
```

Expected: no whitespace errors; no Hub/CLI/shared/protocol changes; unrelated pre-existing files remain unstaged.

- [ ] **Step 4: Verify the three user-visible surfaces in a mobile viewport**

For session modal, session page and editor terminal panel, verify:

1. Short tap on terminal/TUI: no native keyboard; `Nhập · Chọn` appears.
2. `Nhập`: native keyboard opens and terminal receives typed input.
3. `Chọn`: touched word is selected; sweep and both handles adjust the range.
4. Long press: enters the same selection mode without a synthetic TUI click.
5. `Sao chép`: selection reaches clipboard and controls close.
6. `Phím`: helper panel opens and sends Esc/Tab/arrows without native keyboard.
7. Swipe: scrolls output and closes transient bubble.
8. Tab/session change: clears transient selection and timers.
9. Light/dark, portrait/landscape: bubble and toolbar stay clamped and readable.

Record screenshots or browser observations; do not claim this step passed from unit tests alone.

- [ ] **Step 5: Commit verification fixes, if any**

```bash
git add web/src
git commit -m "fix(web): harden mobile terminal selection interactions"
```

Skip this commit when verification required no changes.
