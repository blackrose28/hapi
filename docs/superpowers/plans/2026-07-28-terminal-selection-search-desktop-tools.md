# Terminal Selection, Search, and Desktop Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify terminal selection visuals, make selected text clear, fix mobile Search submit, and expose Search/Snippets on desktop.

**Architecture:** Keep one `activeDockTool` state and one Search/Snippets component tree for all breakpoints. Reposition the existing panels responsively, add desktop header triggers and scoped keyboard shortcuts, and continue using the existing xterm Search addon/controller.

**Tech Stack:** React 19, TypeScript, xterm.js 6, Tailwind CSS, Vitest, Testing Library

---

## File map

| File | Change |
|---|---|
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx` | Share compact visual classes between choice and selection toolbars |
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx` | Verify selection bubble visual parity |
| `web/src/index.css` | Add light/dark terminal selection color token |
| `web/src/components/Terminal/TerminalView.tsx` | Read the dedicated selection color token |
| `web/src/components/Terminal/TerminalView.test.tsx` | Verify xterm receives the stronger selection color |
| `web/src/components/Terminal/TerminalSearchPanel.tsx` | Responsive two-row mobile layout and native form submit |
| `web/src/components/Terminal/TerminalSearchPanel.test.tsx` | Verify Search/Enter, debounce cancellation, and responsive layout |
| `web/src/components/Terminal/TerminalControlDock.tsx` | Render one responsive Search/Snippets panel tree on mobile and desktop |
| `web/src/components/Terminal/TerminalControlDock.test.tsx` | Verify responsive panel placement and no duplicate regions |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | Add desktop header triggers and scoped Ctrl/Cmd+F/Escape behavior |
| `web/src/components/Terminal/SessionTerminalTabs.test.tsx` | Verify desktop buttons, shortcuts, and cleanup |

### Task 1: Compact selection bubble and strengthen selected text

**Files:**
- Modify: `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx`
- Modify: `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx`
- Modify: `web/src/components/Terminal/TerminalView.test.tsx`
- Modify: `web/src/components/Terminal/TerminalView.tsx`
- Modify: `web/src/index.css`

- [ ] Add failing assertions that the selection toolbar uses `rounded-xl`, `p-0.5`, `shadow-lg`, 13px actions, and 44px hit targets.
- [ ] Run:

```bash
bun run --cwd web test MobileTerminalInteractionOverlay.test.tsx
```

Expected: FAIL on the old `rounded-full`, `p-1`, and 14px classes.

- [ ] Extract shared constants and apply them to both toolbars:

```ts
const COMPACT_TOOLBAR_CLASS =
    'absolute flex overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-0.5 shadow-lg backdrop-blur'
const COMPACT_ACTION_CLASS =
    'min-h-[44px] min-w-[44px] px-3 text-[13px] font-medium'
```

- [ ] Add theme tokens:

```css
:root {
    --app-terminal-selection-bg: rgba(79, 70, 229, 0.36);
}

[data-theme="dark"] {
    --app-terminal-selection-bg: rgba(129, 140, 248, 0.40);
}
```

- [ ] Update `resolveThemeColors`:

```ts
const selectionBackground = styles
    .getPropertyValue('--app-terminal-selection-bg')
    .trim() || 'rgba(99, 102, 241, 0.38)'
```

- [ ] Add a TerminalView test proving the constructor theme receives the dedicated token, then run:

```bash
bun run --cwd web test MobileTerminalInteractionOverlay.test.tsx TerminalView.test.tsx
```

Expected: PASS.

- [ ] Commit:

```bash
git add web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx \
    web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx \
    web/src/components/Terminal/TerminalView.tsx \
    web/src/components/Terminal/TerminalView.test.tsx \
    web/src/index.css
git commit -m "style(web): clarify terminal selection controls"
```

### Task 2: Fix Search/Enter and responsive Search layout

**Files:**
- Modify: `web/src/components/Terminal/TerminalSearchPanel.test.tsx`
- Modify: `web/src/components/Terminal/TerminalSearchPanel.tsx`

- [ ] Add a failing test: type `needle`, leave the 150ms debounce pending, submit the form, and assert exactly one immediate call:

```ts
fireEvent.change(searchbox(), { target: { value: 'needle' } })
fireEvent.submit(searchbox().closest('form')!)

expect(fixture.findNext).toHaveBeenCalledOnce()
expect(fixture.findNext).toHaveBeenCalledWith('needle', {
    caseSensitive: false,
    incremental: false,
})
advance(150)
expect(fixture.findNext).toHaveBeenCalledOnce()
```

- [ ] Add failing layout assertions for a two-column mobile grid, a full-width second control row, desktop single-row flex, and `enterkeyhint="search"`.
- [ ] Run:

```bash
bun run --cwd web test TerminalSearchPanel.test.tsx
```

Expected: FAIL because no form submit handler or responsive grid exists.

- [ ] Convert the panel root to a form and implement immediate submit:

```ts
const inputRef = useRef<HTMLInputElement>(null)

const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    cancelPendingSearch()
    const nextQuery = (inputRef.current?.value ?? query)
        .slice(0, TERMINAL_SEARCH_QUERY_MAX)
    setQuery(nextQuery)
    if (!controller || !nextQuery) {
        controller?.clear()
        setResults(EMPTY_TERMINAL_SEARCH_RESULTS)
        return
    }
    controller.findNext(nextQuery, {
        caseSensitive,
        incremental: false,
    })
}
```

- [ ] Use one responsive DOM:

```tsx
<form
    onSubmit={submitSearch}
    className="grid w-full grid-cols-[minmax(0,1fr)_44px] gap-1.5 lg:flex lg:items-center"
>
    <label className="col-start-1 row-start-1 min-w-0 flex-1">...</label>
    <div className="col-span-2 row-start-2 flex items-center lg:contents">...</div>
    <SearchButton ...>×</SearchButton>
</form>
```

Add `ref={inputRef}` and `enterKeyHint="search"` to the input.

- [ ] Run:

```bash
bun run --cwd web test TerminalSearchPanel.test.tsx
```

Expected: PASS.

- [ ] Commit:

```bash
git add web/src/components/Terminal/TerminalSearchPanel.tsx \
    web/src/components/Terminal/TerminalSearchPanel.test.tsx
git commit -m "fix(web): submit terminal search from mobile keyboard"
```

### Task 3: Expose Search and Snippets on desktop

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`

- [ ] Add failing tests proving:
  - desktop header contains enabled Search and Snippets buttons;
  - only one Search or Snippets region is mounted;
  - panel classes place mobile panels above the dock and desktop panels at the top-right;
  - Ctrl/Cmd+F opens Search and prevents browser Find;
  - Escape closes the active panel;
  - shortcuts do nothing while terminal interaction is inactive.

- [ ] Run:

```bash
bun run --cwd web test TerminalControlDock.test.tsx SessionTerminalTabs.test.tsx
```

Expected: FAIL because desktop triggers and shortcuts do not exist and the dock root is `lg:hidden`.

- [ ] Keep the mobile toolbar `lg:hidden`, but make the panel host responsive:

```tsx
<div className="relative z-30 shrink-0 lg:pointer-events-none lg:absolute lg:inset-0">
```

Use one mounted panel with breakpoint-aware placement:

```ts
const floatingPanelClass = activeTool === 'search'
    ? 'absolute bottom-full left-2 right-2 mb-2 pointer-events-auto lg:bottom-auto lg:left-auto lg:right-2 lg:top-10 lg:mb-0 lg:w-[520px] lg:max-w-[calc(100%-1rem)]'
    : 'absolute bottom-full left-2 right-2 mb-2 pointer-events-auto lg:bottom-auto lg:left-auto lg:right-2 lg:top-10 lg:mb-0 lg:w-[480px] lg:max-w-[calc(100%-1rem)]'
```

- [ ] Add `relative` to the SessionTerminalTabs root and desktop header buttons beside the `+` button:

```tsx
<div className="hidden items-stretch lg:flex">
    <button aria-label={t('terminal.controls.search')} ... />
    <button aria-label={t('terminal.controls.snippets')} ... />
</div>
```

The buttons toggle the existing `activeDockTool`; do not introduce desktop-only tool state.

- [ ] Add a scoped keydown effect:

```ts
useEffect(() => {
    if (!canUseTerminal || !interactionActive) return
    const onKeyDown = (event: KeyboardEvent) => {
        const editable = event.target instanceof HTMLElement
            && (event.target.isContentEditable
                || event.target.matches('input, textarea, select'))
        if (!editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault()
            handleActiveDockToolChange('search')
            return
        }
        if (event.key === 'Escape' && activeDockTool !== null) {
            event.preventDefault()
            clearSearch()
        }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
}, [
    activeDockTool,
    canUseTerminal,
    clearSearch,
    handleActiveDockToolChange,
    interactionActive,
])
```

- [ ] Run:

```bash
bun run --cwd web test TerminalControlDock.test.tsx SessionTerminalTabs.test.tsx
```

Expected: PASS.

- [ ] Commit:

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/SessionTerminalTabs.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "feat(web): expose terminal tools on desktop"
```

### Task 4: Final verification

- [ ] Run focused regression:

```bash
bun run --cwd web test \
    MobileTerminalInteractionOverlay.test.tsx \
    TerminalView.test.tsx \
    TerminalSearchPanel.test.tsx \
    TerminalControlDock.test.tsx \
    SessionTerminalTabs.test.tsx
```

- [ ] Run full Web verification:

```bash
bun run --cwd web test
bun run --cwd web typecheck
bun run build:web
```

- [ ] Review scope:

```bash
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
```

Confirm no Hub/CLI/API files changed and no duplicated Search/Snippets controller was introduced.
