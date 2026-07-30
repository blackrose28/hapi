# Mobile Terminal Control Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall mobile terminal quick-key stack with the approved six-item A-Hybrid dock, then deliver Snippets, Search and current-instance History through separate acceptance gates.

**Architecture:** Keep terminal transport unchanged. A shared controlled `TerminalControlDock` owns presentation while the session and editor terminal surfaces own active-terminal state, terminal focus, search controller and per-terminal command history. Tool panels are anchored overlays above the dock, so opening them never changes xterm layout.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS 4, xterm 6, `@xterm/addon-search` 0.16, Vitest, Testing Library, Bun workspaces.

## Global Constraints

- Mobile/tablet only: retain the existing `lg:hidden` breakpoint; desktop terminal behavior must not change.
- Dock height: 52–56px plus `env(safe-area-inset-bottom)`.
- Only the dock consumes layout height; every tool panel overlays the terminal.
- `Paste` is immediate and never selected.
- Tapping the selected tool or terminal content clears the HAPI tool selection.
- Tapping terminal content must not forcibly blur or dismiss the native keyboard.
- Below the `lg` breakpoint, xterm focus is initiated only by the `Keyboard` action; retain automatic focus at desktop widths.
- Motion is limited to short opacity/translate transitions and must respect reduced-motion preferences.
- Snippet and History selections send plain text without Enter and without shell-specific line clearing.
- History is memory-only, current-terminal-only, capped at 100 commands and never reads shell history.
- No Hub, CLI, protocol, database or desktop redesign changes.
- Stop after every acceptance gate for focused tests, typecheck, production build and user visual approval.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/components/Terminal/TerminalControlDock.tsx` | Shared dock, controlled active tool, paste fallback and all anchored tool panels |
| `web/src/components/Terminal/TerminalControlDock.test.tsx` | Dock interaction, accessibility and no-layout-regression tests |
| `web/src/components/Terminal/terminalControls.ts` | Shared key definitions, modifier transformation and quick-input hook |
| `web/src/components/Terminal/terminalSearch.ts` | Small typed adapter around xterm SearchAddon |
| `web/src/components/Terminal/terminalSearch.test.ts` | Search direction, options, result events and cleanup tests |
| `web/src/components/Terminal/terminalCommandHistory.ts` | Conservative current-instance command recorder |
| `web/src/components/Terminal/terminalCommandHistory.test.ts` | Input reconstruction, invalidation, de-duplication and limit tests |
| `web/src/components/Terminal/TerminalView.tsx` | Own xterm addons and expose the search controller with terminal mount |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | Session-tab focus, dock state, search binding and per-terminal history |
| `web/src/components/editor/EditorTerminal.tsx` | Editor-terminal focus, dock state, search binding and history |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | User-facing dock and panel copy |
| `web/package.json`, `bun.lock` | Official xterm search addon dependency |

---

## Gate 1 — Dock Foundation, Paste, Keyboard and More

### Task 1: Build the shared dock presentation

**Files:**
- Create: `web/src/components/Terminal/terminalControls.ts`
- Create: `web/src/components/Terminal/TerminalControlDock.tsx`
- Create: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/TerminalQuickKeys.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Produces:

```ts
export type TerminalDockTool = 'snippets' | 'search' | 'history' | 'keyboard' | 'more'
export type TerminalDockAction = 'paste' | TerminalDockTool

export type TerminalControlDockProps = {
    disabled: boolean
    activeTool: TerminalDockTool | null
    onActiveToolChange: (tool: TerminalDockTool | null) => void
    onFocusTerminal: () => void
    ctrlActive: boolean
    altActive: boolean
    onQuickInput: (sequence: string) => void
    onModifierToggle: (modifier: 'ctrl' | 'alt') => void
    onWritePlainInput: (text: string) => boolean
}
```

- Produces from `terminalControls.ts`: `QuickInput`, `QUICK_INPUT_ROWS`, `ADVANCED_KEY_GROUPS`, `applyTerminalModifierState` and `useTerminalQuickInput`.
- Gate-1 enabled tools: `Paste`, `Keyboard`, `More`.
- Gate-1 disabled tools: `Snippets`, `Search`, `History`.

- [ ] **Step 1: Extract the shared terminal-control model**

Move these existing definitions without changing behavior:

```ts
export type QuickInput = {
    label: string
    sequence?: string
    description: string
    modifier?: 'ctrl' | 'alt'
    popup?: {
        label: string
        sequence: string
        description: string
    }
}

export type ModifierState = {
    ctrl: boolean
    alt: boolean
}

export type TerminalQuickInput = {
    ctrlActive: boolean
    altActive: boolean
    sendQuickInput: (sequence: string) => void
    toggleModifier: (modifier: 'ctrl' | 'alt') => void
    writePlainInput: (text: string) => boolean
    writeTerminalData: (text: string) => void
}

export const QUICK_INPUT_ROWS: Array<{ label: string; keys: QuickInput[] }>
export const ADVANCED_KEY_GROUPS: Array<{ label: string; keys: QuickInput[] }>
export function applyTerminalModifierState(sequence: string, state: ModifierState): string
export function useTerminalQuickInput(args: {
    disabled: boolean
    write: (text: string) => void
}): TerminalQuickInput
```

`TerminalQuickKeys.tsx` imports and re-exports `applyTerminalModifierState` and `useTerminalQuickInput` from `terminalControls.ts`, and imports the key definitions it still renders. This keeps the old UI buildable without copying its component logic. `TerminalControlDock.tsx` imports the same definitions and implements only the new dock presentation. Task 2 deletes the old UI after both consumers switch.

- [ ] **Step 2: Write failing dock tests**

Add tests with this behavior:

```tsx
it('renders a slim six-item dock and disables unfinished tools', () => {
    renderDock()

    expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toHaveClass('lg:hidden')
    expect(screen.getAllByRole('button')).toEqual(expect.arrayContaining([
        expect.objectContaining({ textContent: 'Paste' }),
        expect.objectContaining({ textContent: 'Snippets' }),
        expect.objectContaining({ textContent: 'Search' }),
        expect.objectContaining({ textContent: 'History' }),
        expect.objectContaining({ textContent: 'Keyboard' }),
        expect.objectContaining({ textContent: 'More' }),
    ]))
    expect(screen.getByRole('button', { name: 'Snippets' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled()
})

it('opens an anchored panel instead of a dialog and toggles it closed', () => {
    const onActiveToolChange = vi.fn()
    const { rerender } = renderDock({ activeTool: null, onActiveToolChange })

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onActiveToolChange).toHaveBeenCalledWith('more')

    rerender(makeDock({ activeTool: 'more', onActiveToolChange }))
    expect(screen.getByRole('region', { name: 'More terminal keys' })).toHaveClass('absolute')
    expect(screen.queryByRole('dialog', { name: 'More terminal keys' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onActiveToolChange).toHaveBeenLastCalledWith(null)
})

it('focuses terminal synchronously from Keyboard pointer-down', () => {
    const onFocusTerminal = vi.fn()
    renderDock({ onFocusTerminal })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Keyboard' }))
    expect(onFocusTerminal).toHaveBeenCalledTimes(1)
})

it('keeps Paste immediate and falls back to manual input', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const onActiveToolChange = vi.fn()
    renderDock({ onActiveToolChange })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(await screen.findByRole('dialog', { name: 'Paste input' })).toBeInTheDocument()
    expect(onActiveToolChange).not.toHaveBeenCalled()
})

it('announces a successful direct paste without selecting a tool', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('pwd') } })
    const onWritePlainInput = vi.fn(() => true)
    const onActiveToolChange = vi.fn()
    renderDock({ onWritePlainInput, onActiveToolChange })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Pasted')
    expect(onWritePlainInput).toHaveBeenCalledWith('pwd')
    expect(onActiveToolChange).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run the new test and confirm failure**

Run:

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: FAIL because `TerminalControlDock` and the six-item dock do not exist.

- [ ] **Step 4: Replace the tall stack with the controlled dock**

Keep the existing modifier hook and manual-paste `AppDialog`. Replace the exported UI with this state model:

```tsx
function toggleTool(
    current: TerminalDockTool | null,
    next: TerminalDockTool,
    onChange: (tool: TerminalDockTool | null) => void,
): void {
    onChange(current === next ? null : next)
}

export function TerminalControlDock(props: TerminalControlDockProps) {
    const { t } = useTranslation()
    const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
    const [manualPasteText, setManualPasteText] = useState('')
    const [pasteFeedback, setPasteFeedback] = useState(false)
    const [functionLayer, setFunctionLayer] = useState(false)

    const handleKeyboardPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
        if (!props.disabled) {
            props.onFocusTerminal()
        }
    }

    return (
        <div className="relative z-30 shrink-0 lg:hidden">
            {props.activeTool === 'keyboard' ? (
                <section
                    role="region"
                    aria-label={t('terminal.controls.keyboardPanel')}
                    className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-2 shadow-xl backdrop-blur"
                >
                    <KeyboardKeyGrid
                        functionLayer={functionLayer}
                        ctrlActive={props.ctrlActive}
                        altActive={props.altActive}
                        disabled={props.disabled}
                        onFunctionLayerChange={setFunctionLayer}
                        onQuickInput={props.onQuickInput}
                        onModifierToggle={props.onModifierToggle}
                    />
                </section>
            ) : null}

            {props.activeTool === 'more' ? (
                <section
                    role="region"
                    aria-label={t('terminal.controls.morePanel')}
                    className="absolute bottom-full left-2 right-2 mb-2 max-h-[48vh] overflow-y-auto rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-3 shadow-xl backdrop-blur"
                >
                    <AdvancedKeyGroups
                        disabled={props.disabled}
                        onQuickInput={props.onQuickInput}
                    />
                </section>
            ) : null}

            <div
                role="toolbar"
                aria-label={t('terminal.controls.toolbar')}
                className="grid min-h-14 grid-cols-6 border-t border-[var(--app-border)] bg-[var(--app-bg)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
            >
                <DockButton tool="paste" label={t('terminal.controls.paste')} onClick={() => void handlePasteAction()} />
                <DockButton tool="snippets" label={t('terminal.controls.snippets')} disabled />
                <DockButton tool="search" label={t('terminal.controls.search')} disabled />
                <DockButton tool="history" label={t('terminal.controls.history')} disabled />
                <DockButton
                    tool="keyboard"
                    label={t('terminal.controls.keyboard')}
                    active={props.activeTool === 'keyboard'}
                    disabled={props.disabled}
                    onPointerDown={handleKeyboardPointerDown}
                    onClick={() => toggleTool(props.activeTool, 'keyboard', props.onActiveToolChange)}
                />
                <DockButton
                    tool="more"
                    label={t('terminal.controls.more')}
                    active={props.activeTool === 'more'}
                    disabled={props.disabled}
                    onClick={() => toggleTool(props.activeTool, 'more', props.onActiveToolChange)}
                />
            </div>

            <ManualPasteDialog
                open={pasteDialogOpen}
                text={manualPasteText}
                onTextChange={setManualPasteText}
                onOpenChange={setPasteDialogOpen}
                onSubmit={handleManualPasteSubmit}
            />
            {pasteFeedback ? (
                <span role="status" className="sr-only">
                    {t('terminal.controls.pasted')}
                </span>
            ) : null}
        </div>
    )
}
```

Implementation details that are part of this step:

- `DockButton` uses an inline 18px SVG icon, a 10–11px label and a minimum 48px touch target.
- Active styling is violet with a tinted background; disabled unfinished tools remain visible at reduced opacity.
- `KeyboardKeyGrid` renders Esc, Tab, Ctrl, Alt, Fn, arrows and Backspace.
- `Fn` swaps the ordinary helper row for F1–F12; it never writes its own byte.
- Helper buttons call `preventDefault()` on pointer-down so xterm focus/native keyboard is retained.
- `AdvancedKeyGroups` contains only Navigation, Function keys and Symbols; control signals move to Snippets in Gate 2.
- A successful direct or manual paste sets `pasteFeedback` for 1.2 seconds, then clears it; no toast, panel or selected dock state is created.
- Overlay transitions use `motion-reduce:transition-none`.

- [ ] **Step 5: Add locale keys in all three locale files**

Add equivalent translations for:

```ts
'terminal.controls.toolbar': 'Terminal controls',
'terminal.controls.paste': 'Paste',
'terminal.controls.snippets': 'Snippets',
'terminal.controls.search': 'Search',
'terminal.controls.history': 'History',
'terminal.controls.keyboard': 'Keyboard',
'terminal.controls.more': 'More',
'terminal.controls.pasted': 'Pasted',
'terminal.controls.keyboardPanel': 'Terminal keyboard helpers',
'terminal.controls.morePanel': 'More terminal keys',
'terminal.controls.navigation': 'Navigation',
'terminal.controls.functionKeys': 'Function keys',
'terminal.controls.symbols': 'Symbols',
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the shared dock**

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/terminalControls.ts \
    web/src/components/Terminal/TerminalQuickKeys.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add mobile terminal control dock"
```

### Task 2: Wire the dock to every terminal surface

**Files:**
- Delete: `web/src/components/Terminal/TerminalQuickKeys.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`

**Interfaces:**
- Consumes: `TerminalControlDock`, `TerminalDockTool`, `useTerminalQuickInput`.
- Produces: identical dock behavior below the existing `lg` breakpoint in session modal/page and both editor terminal paths.

- [ ] **Step 1: Write failing integration tests**

Add or update these cases:

```tsx
it('closes the active dock panel when terminal content is tapped', () => {
    mocks.controller = makeController([state('t1')])
    renderTabs()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('region', { name: 'More terminal keys' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
    expect(screen.queryByRole('region', { name: 'More terminal keys' })).not.toBeInTheDocument()
})

it('focuses xterm only from the mobile or tablet Keyboard action', () => {
    mockViewportBelowLg(true)
    renderMachineTerminal({ mobileMode: false })
    const { focus } = mountLastTerminal()

    expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).toHaveClass('lg:hidden')
    expect(focus).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Keyboard' }))
    expect(focus).toHaveBeenCalledTimes(1)
})

it('clears the selected dock tool when the session terminal tab changes', () => {
    mocks.controller = makeController([state('t1'), state('t2')])
    renderTabs()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 't2' }))

    expect(screen.queryByRole('region', { name: 'More terminal keys' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run integration tests and confirm failure**

```bash
bun run --cwd web test -- \
    src/components/Terminal/SessionTerminalTabs.test.tsx \
    src/components/editor/EditorTerminal.test.tsx
```

Expected: FAIL because the parents still import `TerminalQuickKeys` and do not control tool state/focus.

- [ ] **Step 3: Wire `SessionTerminalTabs`**

Use controlled state and terminal capture:

```diff
- import { TerminalQuickKeys, useTerminalQuickInput } from '@/components/Terminal/TerminalQuickKeys'
+ import { TerminalControlDock } from '@/components/Terminal/TerminalControlDock'
+ import { useTerminalQuickInput } from '@/components/Terminal/terminalControls'
```

```tsx
const [activeDockTool, setActiveDockTool] = useState<TerminalDockTool | null>(null)

useEffect(() => {
    setActiveDockTool(null)
}, [displayTerminal?.terminalId])

const dismissDockTool = useCallback(() => {
    setActiveDockTool(null)
}, [])

<div
    data-testid="terminal-surface"
    onPointerDownCapture={dismissDockTool}
    className="min-h-0 flex-1 overflow-hidden p-2"
>
    <TerminalView
        key={activeTerminalId ?? 'bootstrap'}
        onMount={handleTerminalMount}
        onResize={handleResize}
        compactFontSize={props.compactFontSize}
        className={controller.terminals.length === 0 ? 'opacity-0' : 'h-full w-full'}
    />
</div>

<TerminalControlDock
    disabled={quickInputDisabled}
    activeTool={activeDockTool}
    onActiveToolChange={setActiveDockTool}
    onFocusTerminal={() => terminalRef.current?.focus()}
    ctrlActive={quickInput.ctrlActive}
    altActive={quickInput.altActive}
    onQuickInput={quickInput.sendQuickInput}
    onModifierToggle={quickInput.toggleModifier}
    onWritePlainInput={quickInput.writePlainInput}
/>
```

The pointer handler belongs only to the terminal content wrapper, not the dock/overlay, so panel interactions do not close themselves.

- [ ] **Step 4: Wire `EditorTerminalBody`**

Use the same controlled state and capture handler. Always render the shared dock; its own `lg:hidden` contract shows it only below 1024px, independent of the editor's narrower `mobileMode` layout switch:

```diff
- import { TerminalQuickKeys, useTerminalQuickInput } from '@/components/Terminal/TerminalQuickKeys'
+ import { TerminalControlDock } from '@/components/Terminal/TerminalControlDock'
+ import { useTerminalQuickInput } from '@/components/Terminal/terminalControls'
```

```tsx
const [activeDockTool, setActiveDockTool] = useState<TerminalDockTool | null>(null)

<div
    ref={terminalContainerRef}
    data-testid="terminal-surface"
    onPointerDownCapture={() => setActiveDockTool(null)}
    className="relative min-h-0 flex-1 overflow-hidden p-2"
>
    <TerminalView
        onMount={handleTerminalMount}
        onResize={handleResize}
        className="h-full w-full"
        compactFontSize={props.compactFontSize}
    />
</div>

<TerminalControlDock
    disabled={quickInputDisabled}
    activeTool={activeDockTool}
    onActiveToolChange={setActiveDockTool}
    onFocusTerminal={() => terminalRef.current?.focus()}
    ctrlActive={quickInput.ctrlActive}
    altActive={quickInput.altActive}
    onQuickInput={quickInput.sendQuickInput}
    onModifierToggle={quickInput.toggleModifier}
    onWritePlainInput={quickInput.writePlainInput}
/>
```

Delete assertions tied to the old tall row and replace them with the approved dock behavior. Keep desktop-collapse, tab-close and transport tests unchanged.

Gate initial xterm focus by the same breakpoint:

```ts
const isDockViewport = useMediaQuery('(max-width: 1023px)')

if (!isDockViewport) {
    terminal.focus()
}
```

Keep the media-query result in the mount callback dependencies. Do not clear the focus mock in the tablet test: it must prove there was no mount-time focus before the Keyboard pointer-down.

After both imports compile, delete the obsolete module:

```bash
rm web/src/components/Terminal/TerminalQuickKeys.tsx
```

- [ ] **Step 5: Run Gate-1 verification**

```bash
bun run --cwd web test -- \
    src/components/Terminal/TerminalControlDock.test.tsx \
    src/components/Terminal/SessionTerminalTabs.test.tsx \
    src/components/editor/EditorTerminal.test.tsx \
    src/components/modals/TerminalModal.test.tsx \
    src/routes/sessions/terminal.test.tsx
bun run --cwd web typecheck
bun run --cwd web build
```

Expected: all focused tests PASS, typecheck exits 0, production build exits 0.

- [ ] **Step 6: Commit Gate 1 integration**

```bash
git add web/src/components/Terminal/SessionTerminalTabs.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.tsx \
    web/src/components/editor/EditorTerminal.test.tsx \
    web/src/components/Terminal/TerminalQuickKeys.tsx
git commit -m "feat(web): integrate mobile terminal dock"
```

- [ ] **Step 7: Gate 1 user acceptance**

Show the working session modal, session page and editor terminal at a mobile viewport. Confirm:

1. Dock is slim and visually matches the approved mockup.
2. Paste works, including fallback dialog.
3. Keyboard opens native input and helper keys retain focus.
4. More floats above the dock and does not resize xterm.
5. Terminal tap closes HAPI panels.
6. Both editor terminal paths expose the same `lg:hidden` dock contract at tablet width and hide it from 1024px upward.

Do not begin Gate 2 until the user accepts Gate 1.

---

## Gate 2 — Snippets

### Task 3: Add control and command snippets

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Consumes: `onQuickInput(sequence)` for control bytes.
- Consumes: `onWritePlainInput(text)` for command text.
- Produces: enabled `Snippets` panel; command presets never include `\r` or `\n`.

- [ ] **Step 1: Write failing Snippets tests**

```tsx
it('sends control snippets immediately', () => {
    const onQuickInput = vi.fn()
    renderDock({ activeTool: 'snippets', onQuickInput })

    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }))
    expect(onQuickInput).toHaveBeenCalledWith('\u0003')
})

it('inserts command snippets without Enter', () => {
    const onWritePlainInput = vi.fn(() => true)
    renderDock({ activeTool: 'snippets', onWritePlainInput })

    fireEvent.click(screen.getByRole('button', { name: 'git status' }))
    expect(onWritePlainInput).toHaveBeenCalledWith('git status')
    expect(onWritePlainInput).not.toHaveBeenCalledWith(expect.stringMatching(/[\r\n]/))
})
```

- [ ] **Step 2: Confirm the tests fail**

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: FAIL because Snippets is disabled.

- [ ] **Step 3: Implement the two preset groups**

Use exact presets:

```ts
const CONTROL_SNIPPETS = [
    { label: 'Ctrl+C', sequence: '\u0003' },
    { label: 'Ctrl+D', sequence: '\u0004' },
    { label: 'Ctrl+Z', sequence: '\u001a' },
    { label: 'Ctrl+L', sequence: '\u000c' },
] as const

const COMMAND_SNIPPETS = [
    'clear',
    'pwd',
    'ls -la',
    'git status',
    'git diff',
    'git log --oneline -10',
] as const
```

Enable the Snippets dock button and render an anchored `role="region"` with Control and Commands groups. Close the panel after a command is inserted; keep it open for repeated control shortcuts.

- [ ] **Step 4: Add locale keys**

```ts
'terminal.controls.snippetsPanel': 'Terminal snippets',
'terminal.controls.control': 'Control',
'terminal.controls.commands': 'Commands',
```

Add equivalent Vietnamese and Chinese values.

- [ ] **Step 5: Verify and commit Gate 2**

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
bun run --cwd web typecheck
bun run --cwd web build
git add web/src/components/Terminal/TerminalControlDock.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add terminal snippets panel"
```

- [ ] **Step 6: Gate 2 user acceptance**

Demonstrate all four control shortcuts and all six command presets. Confirm command presets only insert text. Do not begin Gate 3 until accepted.

---

## Gate 3 — Search

### Task 4: Add the xterm search controller

**Files:**
- Modify: `web/package.json`
- Modify: `bun.lock`
- Create: `web/src/components/Terminal/terminalSearch.ts`
- Create: `web/src/components/Terminal/terminalSearch.test.ts`
- Modify: `web/src/components/Terminal/TerminalView.tsx`

**Interfaces:**
- Produces:

```ts
export type TerminalSearchResult = {
    resultIndex: number
    resultCount: number
}

export type TerminalSearchController = {
    findNext: (query: string, incremental?: boolean) => boolean
    findPrevious: (query: string) => boolean
    clear: () => void
    onResults: (listener: (result: TerminalSearchResult) => void) => { dispose: () => void }
}

export type TerminalViewTools = {
    search: TerminalSearchController
}
```

- Changes `TerminalView.onMount` to `(terminal: Terminal, tools: TerminalViewTools) => void`.
- Adds `TerminalView.onDispose?: () => void`.

- [ ] **Step 1: Add the official addon**

```bash
bun add --cwd web @xterm/addon-search@^0.16.0
```

- [ ] **Step 2: Write failing adapter tests**

```ts
it('uses case-insensitive decorated incremental search', () => {
    const addon = makeSearchAddon()
    const controller = createTerminalSearchController(addon)

    controller.findNext('error', true)

    expect(addon.findNext).toHaveBeenCalledWith('error', expect.objectContaining({
        caseSensitive: false,
        incremental: true,
        decorations: expect.objectContaining({
            matchOverviewRuler: expect.any(String),
            activeMatchColorOverviewRuler: expect.any(String),
        }),
    }))
})

it('forwards result events and clears decorations', () => {
    const addon = makeSearchAddon()
    const controller = createTerminalSearchController(addon)
    const listener = vi.fn()

    const disposable = controller.onResults(listener)
    addon.emit({ resultIndex: 1, resultCount: 3 })
    controller.clear()
    disposable.dispose()

    expect(listener).toHaveBeenCalledWith({ resultIndex: 1, resultCount: 3 })
    expect(addon.clearDecorations).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Confirm failure**

```bash
bun run --cwd web test -- src/components/Terminal/terminalSearch.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement the typed adapter**

```ts
import type { SearchAddon } from '@xterm/addon-search'

const SEARCH_DECORATIONS = {
    matchBackground: '#6d28d9',
    matchBorder: '#a78bfa',
    matchOverviewRuler: '#8b5cf6',
    activeMatchBackground: '#7c3aed',
    activeMatchBorder: '#ddd6fe',
    activeMatchColorOverviewRuler: '#c4b5fd',
} as const

export function createTerminalSearchController(
    addon: Pick<SearchAddon, 'findNext' | 'findPrevious' | 'clearDecorations' | 'onDidChangeResults'>,
): TerminalSearchController {
    return {
        findNext: (query, incremental = false) => addon.findNext(query, {
            caseSensitive: false,
            incremental,
            decorations: SEARCH_DECORATIONS,
        }),
        findPrevious: (query) => addon.findPrevious(query, {
            caseSensitive: false,
            decorations: SEARCH_DECORATIONS,
        }),
        clear: () => addon.clearDecorations(),
        onResults: (listener) => addon.onDidChangeResults(listener),
    }
}
```

- [ ] **Step 5: Load and dispose SearchAddon in `TerminalView`**

```tsx
const searchAddon = new SearchAddon()
terminal.loadAddon(searchAddon)
const tools: TerminalViewTools = {
    search: createTerminalSearchController(searchAddon),
}

onMountRef.current?.(terminal, tools)

return () => {
    onDisposeRef.current?.()
    abortController.abort()
}
```

Also dispose `searchAddon` with the existing Fit, WebLinks and Canvas addons. Keep existing one-argument mount callbacks source-compatible.

- [ ] **Step 6: Verify and commit the search bridge**

```bash
bun run --cwd web test -- src/components/Terminal/terminalSearch.test.ts
bun run --cwd web typecheck
git add web/package.json bun.lock \
    web/src/components/Terminal/terminalSearch.ts \
    web/src/components/Terminal/terminalSearch.test.ts \
    web/src/components/Terminal/TerminalView.tsx
git commit -m "feat(web): expose xterm search controller"
```

### Task 5: Add the Search panel and bind active terminals

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Adds `searchController: TerminalSearchController | null` to `TerminalControlDockProps`.
- Search button is enabled only when the terminal is usable and a live controller exists.

- [ ] **Step 1: Write failing Search panel tests**

```tsx
it('searches incrementally and navigates results', () => {
    const searchController = makeSearchController()
    renderDock({ activeTool: 'search', searchController })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search terminal output' }), {
        target: { value: 'error' },
    })
    expect(searchController.findNext).toHaveBeenCalledWith('error', true)

    searchController.emit({ resultIndex: 1, resultCount: 4 })
    expect(screen.getByText('2 / 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(searchController.findPrevious).toHaveBeenCalledWith('error')
})

it('clears search decorations when Search closes', () => {
    const searchController = makeSearchController()
    const { rerender } = renderDock({ activeTool: 'search', searchController })

    rerender(makeDock({ activeTool: null, searchController }))
    expect(searchController.clear).toHaveBeenCalled()
})
```

- [ ] **Step 2: Confirm failure**

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: FAIL because Search is disabled.

- [ ] **Step 3: Implement Search panel state**

Use exact state and cleanup behavior:

```tsx
const [searchQuery, setSearchQuery] = useState('')
const [searchResult, setSearchResult] = useState<TerminalSearchResult>({
    resultIndex: -1,
    resultCount: 0,
})

useEffect(() => {
    const controller = props.searchController
    if (!controller) return
    const disposable = controller.onResults(setSearchResult)
    return () => disposable.dispose()
}, [props.searchController])

useEffect(() => {
    if (props.activeTool === 'search') return
    props.searchController?.clear()
    setSearchQuery('')
    setSearchResult({ resultIndex: -1, resultCount: 0 })
}, [props.activeTool, props.searchController])
```

The panel contains:

- Auto-focused `type="search"` input with incremental `findNext(query, true)`.
- When the query becomes empty, call `searchController.clear()` and reset the displayed count to `0 / 0`.
- Previous and next buttons.
- `0 / 0` for empty/no matches; otherwise one-based current index.
- No-results copy when query is non-empty and `resultCount === 0`.
- No form submit and no server request.

- [ ] **Step 4: Bind controller lifecycle in both terminal surfaces**

```diff
+ const [searchController, setSearchController] = useState<TerminalSearchController | null>(null)

- const handleTerminalMount = useCallback((terminal: Terminal) => {
+ const handleTerminalMount = useCallback((terminal: Terminal, tools: TerminalViewTools) => {
      terminalRef.current = terminal
+     setSearchController(tools.search)
      inputDisposableRef.current?.dispose()
```

Add disposal to both existing `TerminalView` call sites:

```diff
  <TerminalView
      onMount={handleTerminalMount}
+     onDispose={() => setSearchController(null)}
      onResize={handleResize}
      className="h-full w-full"
  />
```

Pass `searchController` to the dock. On session terminal-tab change, clear the active tool before the visible buffer is replaced.

- [ ] **Step 5: Add Search locale keys**

```ts
'terminal.controls.searchPanel': 'Search terminal output',
'terminal.controls.searchPlaceholder': 'Find in terminal…',
'terminal.controls.previousMatch': 'Previous match',
'terminal.controls.nextMatch': 'Next match',
'terminal.controls.noMatches': 'No matches',
```

Add equivalent Vietnamese and Chinese values.

- [ ] **Step 6: Run Gate-3 verification and commit**

```bash
bun run --cwd web test -- \
    src/components/Terminal/terminalSearch.test.ts \
    src/components/Terminal/TerminalControlDock.test.tsx \
    src/components/Terminal/SessionTerminalTabs.test.tsx \
    src/components/editor/EditorTerminal.test.tsx
bun run --cwd web typecheck
bun run --cwd web build
git add web/src/components/Terminal/TerminalControlDock.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/SessionTerminalTabs.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.tsx \
    web/src/components/editor/EditorTerminal.test.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add terminal output search"
```

- [ ] **Step 7: Gate 3 user acceptance**

Demonstrate empty query, no result, multiple matches, previous/next, long scrollback and switching terminal tabs. Confirm closing Search removes decorations. Do not begin Gate 4 until accepted.

---

## Gate 4 — Current-Terminal History

### Task 6: Build the conservative command recorder

**Files:**
- Create: `web/src/components/Terminal/terminalCommandHistory.ts`
- Create: `web/src/components/Terminal/terminalCommandHistory.test.ts`
- Modify: `web/src/components/Terminal/terminalControls.ts`

**Interfaces:**
- Extends `useTerminalQuickInput` arguments with `onWrite?: (data: string) => void`.
- Produces:

```ts
export type TerminalCommandHistoryRecorder = {
    consume: (data: string) => boolean
    getEntries: () => readonly string[]
    clear: () => void
}

export function createTerminalCommandHistoryRecorder(
    limit?: number,
): TerminalCommandHistoryRecorder
```

`consume` returns `true` only when the visible entries changed, avoiding a React render on every typed character.

- [ ] **Step 1: Write failing recorder tests**

```ts
it('records printable input on Enter and ignores empty input', () => {
    const history = createTerminalCommandHistoryRecorder()
    history.consume('git status')
    expect(history.consume('\r')).toBe(true)
    history.consume('\r')
    expect(history.getEntries()).toEqual(['git status'])
})

it('supports paste, backspace and Ctrl+U editing', () => {
    const history = createTerminalCommandHistoryRecorder()
    history.consume('echp')
    history.consume('\u007f')
    history.consume('o ok\r')
    history.consume('wrong')
    history.consume('\u0015')
    history.consume('pwd\r')
    expect(history.getEntries()).toEqual(['echo ok', 'pwd'])
})

it('discards candidates containing unsupported cursor or raw-mode input', () => {
    const history = createTerminalCommandHistoryRecorder()
    history.consume('git st')
    history.consume('\u001b[D')
    history.consume('atus\r')
    expect(history.getEntries()).toEqual([])
})

it('de-duplicates consecutive commands and keeps the newest 100', () => {
    const history = createTerminalCommandHistoryRecorder(100)
    for (let index = 0; index < 102; index += 1) {
        history.consume(`echo ${index}\r`)
    }
    history.consume('echo 101\r')
    expect(history.getEntries()).toHaveLength(100)
    expect(history.getEntries()[0]).toBe('echo 2')
    expect(history.getEntries().at(-1)).toBe('echo 101')
})
```

- [ ] **Step 2: Confirm failure**

```bash
bun run --cwd web test -- src/components/Terminal/terminalCommandHistory.test.ts
```

Expected: FAIL because the recorder does not exist.

- [ ] **Step 3: Implement the recorder**

Use a private candidate string and `reliable` flag:

```ts
export function createTerminalCommandHistoryRecorder(
    limit = 100,
): TerminalCommandHistoryRecorder {
    let candidate = ''
    let reliable = true
    let entries: string[] = []

    const finalize = (): boolean => {
        const command = reliable ? candidate.trim() : ''
        candidate = ''
        reliable = true
        if (!command || entries.at(-1) === command) {
            return false
        }
        entries = [...entries, command].slice(-limit)
        return true
    }

    return {
        consume(data) {
            let changed = false
            for (const character of data) {
                if (character === '\r' || character === '\n') {
                    changed = finalize() || changed
                } else if (character === '\u007f' || character === '\b') {
                    candidate = Array.from(candidate).slice(0, -1).join('')
                } else if (character === '\u0015') {
                    candidate = ''
                    reliable = true
                } else if (character === '\u0003' || character === '\u0004' || character === '\u001a') {
                    candidate = ''
                    reliable = true
                } else if (character >= ' ' && character !== '\u007f' && reliable) {
                    candidate += character
                } else {
                    reliable = false
                }
            }
            return changed
        },
        getEntries: () => entries,
        clear() {
            candidate = ''
            reliable = true
            entries = []
        },
    }
}
```

- [ ] **Step 4: Observe the final bytes written to the terminal**

Update both write paths inside `useTerminalQuickInput`:

```ts
const emitWrite = useCallback((text: string) => {
    args.write(text)
    args.onWrite?.(text)
}, [args])
```

Use `emitWrite` after modifier transformation and for plain input. This records keyboard typing, clipboard paste, snippets and history insertion consistently, without reading server output.

- [ ] **Step 5: Verify and commit the recorder**

```bash
bun run --cwd web test -- \
    src/components/Terminal/terminalCommandHistory.test.ts \
    src/components/Terminal/TerminalControlDock.test.tsx
bun run --cwd web typecheck
git add web/src/components/Terminal/terminalCommandHistory.ts \
    web/src/components/Terminal/terminalCommandHistory.test.ts \
    web/src/components/Terminal/terminalControls.ts
git commit -m "feat(web): capture current terminal command history"
```

### Task 7: Add the History panel and per-terminal lifecycle

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Adds `historyEntries: readonly string[] | null` to `TerminalControlDockProps`.
- `null` means unavailable; `[]` means enabled but empty.
- History is displayed oldest-to-newest with the newest command at the bottom, matching shell `history`.

- [ ] **Step 1: Write failing History panel tests**

```tsx
it('shows shell-style numbered current-terminal history', () => {
    renderDock({
        activeTool: 'history',
        historyEntries: ['pwd', 'git status'],
    })

    expect(screen.getByRole('button', { name: '1 pwd' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 git status' })).toBeInTheDocument()
})

it('inserts a history item without Enter and closes the panel', () => {
    const onWritePlainInput = vi.fn(() => true)
    const onActiveToolChange = vi.fn()
    renderDock({
        activeTool: 'history',
        historyEntries: ['git status'],
        onWritePlainInput,
        onActiveToolChange,
    })

    fireEvent.click(screen.getByRole('button', { name: '1 git status' }))
    expect(onWritePlainInput).toHaveBeenCalledWith('git status')
    expect(onActiveToolChange).toHaveBeenCalledWith(null)
})
```

- [ ] **Step 2: Confirm failure**

```bash
bun run --cwd web test -- src/components/Terminal/TerminalControlDock.test.tsx
```

Expected: FAIL because History is disabled.

- [ ] **Step 3: Implement the History panel**

Enable History when `historyEntries !== null`. Render:

```tsx
<section role="region" aria-label={t('terminal.controls.historyPanel')} className={overlayClass}>
    {props.historyEntries.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-[var(--app-hint)]">
            {t('terminal.controls.historyEmpty')}
        </p>
    ) : (
        <ol className="max-h-[42vh] overflow-y-auto py-1 font-mono text-xs">
            {props.historyEntries.map((command, index) => (
                <li key={`${index}:${command}`}>
                    <button
                        type="button"
                        aria-label={`${index + 1} ${command}`}
                        onClick={() => {
                            if (props.onWritePlainInput(command)) {
                                props.onActiveToolChange(null)
                            }
                        }}
                        className="grid w-full grid-cols-[2rem_1fr] gap-2 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)]"
                    >
                        <span className="text-right text-[var(--app-hint)]">{index + 1}</span>
                        <span className="truncate text-[var(--app-fg)]">{command}</span>
                    </button>
                </li>
            ))}
        </ol>
    )}
</section>
```

Scroll the list to its bottom when History opens, without changing terminal focus until an item is selected.

- [ ] **Step 4: Keep separate session-terminal recorders**

```tsx
const historyByTerminalRef = useRef(new Map<string, TerminalCommandHistoryRecorder>())
const [historyRevision, setHistoryRevision] = useState(0)

const activeHistoryRecorder = useMemo(() => {
    const terminalId = activeLiveTerminal?.terminalId
    if (!terminalId) return null
    let recorder = historyByTerminalRef.current.get(terminalId)
    if (!recorder) {
        recorder = createTerminalCommandHistoryRecorder()
        historyByTerminalRef.current.set(terminalId, recorder)
    }
    return recorder
}, [activeLiveTerminal?.terminalId])

const quickInput = useTerminalQuickInput({
    disabled: quickInputDisabled,
    write: (data) => {
        const terminalId = activeLiveTerminal?.terminalId
        if (terminalId) controller.write(terminalId, data)
    },
    onWrite: (data) => {
        if (activeHistoryRecorder?.consume(data)) {
            setHistoryRevision((value) => value + 1)
        }
    },
})

const historyEntries = useMemo(
    () => activeHistoryRecorder?.getEntries() ?? null,
    [activeHistoryRecorder, historyRevision],
)
```

When a terminal leaves all live statuses, call `clear()` and delete its recorder. Clear the entire map on component unmount. Switching tabs reads the selected terminal's own recorder.

- [ ] **Step 5: Keep one recorder per editor terminal body**

```tsx
const historyRecorderRef = useRef(createTerminalCommandHistoryRecorder())
const [historyRevision, setHistoryRevision] = useState(0)

const quickInput = useTerminalQuickInput({
    disabled: quickInputDisabled,
    write,
    onWrite: (data) => {
        if (historyRecorderRef.current.consume(data)) {
            setHistoryRevision((value) => value + 1)
        }
    },
})

const historyEntries = useMemo(
    () => canUseTerminal ? historyRecorderRef.current.getEntries() : null,
    [canUseTerminal, historyRevision],
)
```

Clear this recorder in the existing unmount/terminal-close cleanup.

- [ ] **Step 6: Add History locale keys**

```ts
'terminal.controls.historyPanel': 'Current terminal history',
'terminal.controls.historyEmpty': 'No commands in this terminal yet.',
```

Add equivalent Vietnamese and Chinese values.

- [ ] **Step 7: Run Gate-4 verification and commit**

```bash
bun run --cwd web test -- \
    src/components/Terminal/terminalCommandHistory.test.ts \
    src/components/Terminal/TerminalControlDock.test.tsx \
    src/components/Terminal/SessionTerminalTabs.test.tsx \
    src/components/editor/EditorTerminal.test.tsx
bun run --cwd web typecheck
bun run --cwd web build
git add web/src/components/Terminal/TerminalControlDock.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/SessionTerminalTabs.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.tsx \
    web/src/components/editor/EditorTerminal.test.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add current terminal history panel"
```

- [ ] **Step 8: Gate 4 user acceptance**

Demonstrate ordinary typing, paste, backspace, Ctrl+U, duplicate commands, tab switching and terminal close. Confirm raw/TUI or cursor-control input is omitted rather than shown incorrectly. Do not begin final regression until accepted.

---

## Gate 5 — Final Mobile Regression

### Task 8: Verify the complete feature without expanding scope

**Files:**
- Modify only files implicated by an observed regression.
- Do not add persistence, backend APIs, shell-history reads or desktop redesign.

**Interfaces:**
- Verifies the final public behavior from the approved spec.

- [ ] **Step 1: Run all automated checks**

```bash
bun run --cwd web test
bun run --cwd web typecheck
bun run --cwd web build
git diff --check
```

Expected: all web tests PASS, typecheck/build exit 0 and `git diff --check` prints nothing.

- [ ] **Step 2: Run focused interaction regression**

At 390×844 portrait and 844×390 landscape, verify:

1. Session terminal modal.
2. Full session terminal page.
3. Editor terminal panel.
4. Light and dark application themes.
5. Paste success and fallback.
6. Every panel toggles and terminal tap clears it.
7. Search decorations clear on close/tab switch.
8. History stays isolated per terminal and clears on close.
9. Dock respects bottom safe area.
10. Opening panels does not trigger terminal resize; native keyboard may resize the viewport.

- [ ] **Step 3: Verify real mobile keyboard behavior**

On available iOS Safari/PWA and Android Chrome/PWA:

- Keyboard action opens native input from the direct user gesture.
- Helper-key taps do not collapse native input.
- Terminal tap closes only the HAPI helper panel.
- Orientation changes keep the dock reachable and panels inside the viewport.

If a physical platform is unavailable, record that exact gap; do not claim it was verified.

- [ ] **Step 4: Run the full repository safety checks**

```bash
bun run test
bun typecheck
bun run build:web
```

Expected: all repository tests PASS, all package typechecks exit 0 and the production web build exits 0.

- [ ] **Step 5: Review the actual diff before final commit**

```bash
git diff --stat
git diff -- web/src/components/Terminal \
    web/src/components/editor/EditorTerminal.tsx \
    web/src/lib/locales \
    web/package.json bun.lock
```

Confirm:

- No Hub, CLI, shared protocol or database changes.
- No preview artifacts or `_bmad-output` files are staged.
- No desktop behavior changes.
- No persistent history or user-snippet management slipped into scope.

- [ ] **Step 6: Commit only regression fixes, if any**

```bash
git add web/src/components/Terminal \
    web/src/components/editor/EditorTerminal.tsx \
    web/src/components/editor/EditorTerminal.test.tsx \
    web/src/lib/locales \
    web/package.json bun.lock
git commit -m "fix(web): polish mobile terminal controls"
```

Skip this commit when Gate 5 finds no code defect.

- [ ] **Step 7: Final user visual acceptance**

Present the three terminal surfaces and concise verification evidence. Merge or release only after the user accepts the final mobile behavior.
