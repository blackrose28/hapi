# Mobile Terminal Enter Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact `Nhập | Enter | Chọn` mobile terminal bubble whose Enter action sends a terminal carriage return without opening the soft keyboard or closing the bubble.

**Architecture:** Extend the existing mobile interaction hook with one `onEnter` action that calls xterm's public `input('\r', true)` API. Pass that action through the existing overlay props; keep positioning and interaction lifecycle unchanged. Compact only the choice toolbar while preserving 44px touch targets.

**Tech Stack:** React 19, TypeScript, xterm.js 6, Tailwind CSS, Vitest, Testing Library

---

## File map

| File | Responsibility | Planned change |
|---|---|---|
| `web/src/components/Terminal/useMobileTerminalInteraction.ts` | Mobile terminal interaction state and xterm actions | Add stable `onEnter` callback without changing mode |
| `web/src/components/Terminal/useMobileTerminalInteraction.test.tsx` | Hook lifecycle verification | Prove Enter sends `\r`, keeps choice mode, and does not focus input |
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx` | Mobile bubble rendering | Add Enter between Input and Select; compact choice toolbar only |
| `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx` | Bubble rendering/action verification | Prove order, routing, touch targets, and compact classes |
| `web/src/lib/locales/en.ts` | English labels | Add Enter label |
| `web/src/lib/locales/vi-VN.ts` | Vietnamese labels | Add Enter label |
| `web/src/lib/locales/zh-CN.ts` | Simplified Chinese labels | Add Enter label |
| `web/src/components/Terminal/TerminalView.test.tsx` | TerminalView translation mock | Add Enter key to mock dictionary |
| `web/src/components/Terminal/SessionTerminalTabs.test.tsx` | Terminal integration translation key list | Add Enter key to accepted keys |

### Task 1: Add the terminal Enter action

**Files:**
- Modify: `web/src/components/Terminal/useMobileTerminalInteraction.test.tsx`
- Modify: `web/src/components/Terminal/useMobileTerminalInteraction.ts`

- [ ] **Step 1: Extend the terminal test fixture with xterm input**

Add the mock to `TerminalFixture`, the terminal object, and the returned fixture:

```ts
type TerminalFixture = {
    // existing fields
    input: ReturnType<typeof vi.fn>
}

const input = vi.fn()
const terminal = {
    // existing members
    input,
} as unknown as Terminal

return {
    // existing members
    input,
}
```

- [ ] **Step 2: Write the failing hook test**

Add a test beside the existing Input-mode tests:

```ts
it('sends Enter without opening input mode or dismissing the choice', () => {
    const fixture = createTerminalFixture()
    const { result } = renderInteraction(fixture)

    act(() => {
        // Use the existing touch helper sequence that reveals choice mode.
        const point = touch(1, 55, 130)
        dispatchTouch(fixture.terminalElement, 'touchstart', [point])
        dispatchTouch(fixture.terminalElement, 'touchend', [], [point])
        vi.runOnlyPendingTimers()
    })
    expect(result.current.overlayProps.mode).toBe('choice')

    act(() => result.current.overlayProps.onEnter())

    expect(fixture.input).toHaveBeenCalledOnce()
    expect(fixture.input).toHaveBeenCalledWith('\r', true)
    expect(fixture.focus).not.toHaveBeenCalled()
    expect(fixture.textarea.readOnly).toBe(true)
    expect(result.current.overlayProps.mode).toBe('choice')
})
```

- [ ] **Step 3: Run the focused hook test and verify failure**

Run:

```bash
bun run --cwd web test useMobileTerminalInteraction.test.tsx
```

Expected: FAIL because `onEnter` and the fixture `input` field are not implemented yet.

- [ ] **Step 4: Add `onEnter` to the overlay contract and hook**

In `MobileTerminalInteractionOverlay.tsx`, extend the public prop type:

```ts
export type MobileTerminalOverlayProps = {
    // existing props
    onInput: () => void
    onEnter: () => void
    onSelect: () => void
}
```

In `useMobileTerminalInteraction.ts`, add:

```ts
const onEnter = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal || !activeRef.current || overlayRef.current.mode !== 'choice') {
        return
    }
    terminal.input('\r', true)
}, [])
```

Expose it through the memoized props and dependency list:

```ts
const overlayProps = useMemo<MobileTerminalOverlayProps>(() => ({
    ...overlay,
    onInput,
    onEnter,
    onSelect,
    // existing actions
}), [
    onEnter,
    onInput,
    onSelect,
    // existing dependencies
])
```

- [ ] **Step 5: Run the hook test and verify it passes**

Run:

```bash
bun run --cwd web test useMobileTerminalInteraction.test.tsx
```

Expected: all tests in the file PASS.

- [ ] **Step 6: Commit the behavior**

```bash
git add web/src/components/Terminal/useMobileTerminalInteraction.ts \
    web/src/components/Terminal/useMobileTerminalInteraction.test.tsx \
    web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx
git commit -m "feat(web): add mobile terminal enter action"
```

### Task 2: Render and compact the three-action bubble

**Files:**
- Modify: `web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx`
- Modify: `web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`
- Modify: `web/src/components/Terminal/TerminalView.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`

- [ ] **Step 1: Update the overlay test fixture and translation mock**

Add:

```ts
'terminal.interaction.enter': 'Enter',
```

and:

```ts
onEnter: vi.fn(),
```

- [ ] **Step 2: Write failing rendering and routing assertions**

Update the choice test to assert DOM order, actions, touch sizes, and compact presentation:

```ts
const toolbar = screen.getByRole('toolbar', { name: 'Terminal action' })
const actions = screen.getAllByRole('button')
expect(actions.map((action) => action.textContent)).toEqual([
    'Input',
    'Enter',
    'Select',
])
expect(toolbar).toHaveClass('rounded-xl', 'p-0.5')

const enterAction = screen.getByRole('button', { name: 'Enter' })
for (const action of actions) {
    expect(action).toHaveClass(
        'min-h-[44px]',
        'min-w-[44px]',
        'px-3',
        'text-[13px]',
    )
}

fireEvent.click(enterAction)
expect(baseProps.onEnter).toHaveBeenCalledOnce()
```

- [ ] **Step 3: Run the focused overlay test and verify failure**

Run:

```bash
bun run --cwd web test MobileTerminalInteractionOverlay.test.tsx
```

Expected: FAIL because Enter is not rendered and compact classes are absent.

- [ ] **Step 4: Render Enter and apply the compact visual style**

Change only the choice toolbar shell:

```tsx
className="pointer-events-auto absolute flex overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-0.5 shadow-lg backdrop-blur"
```

Change `ChoiceAction` visual classes while retaining the 44px hit target:

```tsx
className="min-h-[44px] min-w-[44px] px-3 text-[13px] font-medium"
```

Insert Enter between Input and Select:

```tsx
<ChoiceAction onActivate={props.onInput}>
    {t('terminal.interaction.input')}
</ChoiceAction>
<span aria-hidden="true" className="my-2.5 w-px bg-[var(--app-border)]" />
<ChoiceAction onActivate={props.onEnter}>
    {t('terminal.interaction.enter')}
</ChoiceAction>
<span aria-hidden="true" className="my-2.5 w-px bg-[var(--app-border)]" />
<ChoiceAction onActivate={props.onSelect}>
    {t('terminal.interaction.select')}
</ChoiceAction>
```

- [ ] **Step 5: Add all locale labels and update translation mocks**

Add beside the existing input/select keys:

```ts
// web/src/lib/locales/en.ts
'terminal.interaction.enter': 'Enter',

// web/src/lib/locales/vi-VN.ts
'terminal.interaction.enter': 'Enter',

// web/src/lib/locales/zh-CN.ts
'terminal.interaction.enter': '回车',
```

Add `terminal.interaction.enter` to the terminal translation mocks/key lists in:

```text
web/src/components/Terminal/TerminalView.test.tsx
web/src/components/Terminal/SessionTerminalTabs.test.tsx
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun run --cwd web test \
    MobileTerminalInteractionOverlay.test.tsx \
    useMobileTerminalInteraction.test.tsx \
    TerminalView.test.tsx \
    SessionTerminalTabs.test.tsx
```

Expected: all selected test files PASS.

- [ ] **Step 7: Commit the compact UI**

```bash
git add web/src/components/Terminal/MobileTerminalInteractionOverlay.tsx \
    web/src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx \
    web/src/components/Terminal/TerminalView.test.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/lib/locales/en.ts \
    web/src/lib/locales/vi-VN.ts \
    web/src/lib/locales/zh-CN.ts
git commit -m "style(web): compact mobile terminal action bubble"
```

### Task 3: Final verification and scope review

**Files:**
- Verify all files changed in Tasks 1–2

- [ ] **Step 1: Run the complete web test suite**

```bash
bun run --cwd web test
```

Expected: all web tests PASS.

- [ ] **Step 2: Run web typecheck**

```bash
bun run --cwd web typecheck
```

Expected: TypeScript exits successfully with no errors.

- [ ] **Step 3: Run the web production build**

```bash
bun run build:web
```

Expected: Vite build completes and `web/dist/404.html` is produced.

- [ ] **Step 4: Review the actual diff for scope**

```bash
git diff HEAD~2 -- \
    web/src/components/Terminal \
    web/src/lib/locales
```

Confirm:

- Enter is emitted only from choice mode.
- The bubble remains in choice mode after Enter.
- Input, Select, copy, selection, and desktop behavior are unchanged.
- Only the choice toolbar receives compact visual classes.

- [ ] **Step 5: Record completion**

If verification required no corrective changes, no extra commit is needed. If a test-driven correction was required, commit only that correction with:

```bash
git add <corrected-files>
git commit -m "fix(web): cover mobile terminal enter edge case"
```
