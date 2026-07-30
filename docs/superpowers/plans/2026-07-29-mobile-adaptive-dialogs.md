# Mobile Adaptive Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HAPI dialogs render as alerts, bottom sheets, or full-screen workspaces on mobile while preserving the current centered desktop dialogs.

**Architecture:** Extend the shared `AppDialog` composition with a semantic `presentation` prop and mobile-aware header navigation. Feature dialogs declare intent instead of owning responsive positioning; Radix continues to own focus trap, portal, overlay, Escape, and focus restoration.

**Tech Stack:** React, TypeScript, Radix Dialog, Tailwind CSS, Vitest, Testing Library, Bun.

**Execution note:** The user explicitly requested implementation in the current `main` workflow. Stage only files listed by this plan; leave unrelated preview and BMAD artifacts untouched.

---

## File map

| File/Khối | Vai trò | Thay đổi |
|---|---|---|
| `web/src/components/ui/app-dialog.tsx` | Nền tảng dialog dùng chung | Thêm `alert/sheet/workspace`, sheet handle, mobile Back và touch target |
| `web/src/components/ui/app-dialog.test.tsx` | Contract tests | TDD cho positioning, safe-area, Back/Close và accessibility |
| `web/src/components/modals/*.tsx` | Modal cấp ứng dụng | Khai báo presentation và navigation phù hợp |
| `web/src/components/SessionTaskListControl.tsx` | Checklist session | Chuyển thành sheet mobile |
| `web/src/components/TeamChat/TeamSessionChatModal.tsx` | Direct chat | Chuyển thành workspace mobile |
| Dialog cục bộ dùng `AppDialogContent` | Confirm/form/tool output | Khai báo intent; xoá responsive positioning tự viết khi trùng hệ thống chung |
| Các test feature liên quan | Regression | Khẳng định ba flow đã duyệt và giữ desktop behavior |

---

### Task 1: Add semantic dialog presentations

**Files:**
- Modify: `web/src/components/ui/app-dialog.tsx`
- Test: `web/src/components/ui/app-dialog.test.tsx`

- [ ] **Step 1: Write failing tests for alert, sheet, and workspace classes**

Add tests that render each presentation and assert the shared contract:

```tsx
it.each([
    ['alert', []],
    ['sheet', ['max-sm:bottom-0', 'max-sm:top-auto', 'max-sm:max-h-[82dvh]', 'max-sm:rounded-b-none']],
    ['workspace', ['max-sm:inset-0', 'max-sm:h-[100dvh]', 'max-sm:max-h-none', 'max-sm:rounded-none']]
] as const)('applies the %s mobile presentation', (presentation, classes) => {
    render(
        <AppDialog open>
            <AppDialogContent presentation={presentation} data-testid="content">
                <AppDialogHeader title="Example" />
            </AppDialogContent>
        </AppDialog>
    )

    expect(screen.getByTestId('content')).toHaveClass(...classes)
})

it('renders a mobile-only handle for sheets', () => {
    render(
        <AppDialog open>
            <AppDialogContent presentation="sheet">
                <AppDialogHeader title="Tasks" />
            </AppDialogContent>
        </AppDialog>
    )

    expect(document.querySelector('[data-app-dialog-sheet-handle]')).toHaveClass('sm:hidden')
})
```

- [ ] **Step 2: Run the component test and confirm RED**

Run:

```bash
bun run --cwd web test src/components/ui/app-dialog.test.tsx
```

Expected: FAIL because `presentation` and the sheet handle do not exist.

- [ ] **Step 3: Implement the presentation contract**

Add:

```tsx
export type AppDialogPresentation = 'alert' | 'sheet' | 'workspace'

type AppDialogContentProps = ComponentProps<typeof DialogContent> & {
    dismissible?: boolean
    presentation?: AppDialogPresentation
}

const presentationClasses: Record<AppDialogPresentation, string> = {
    alert: '',
    sheet: 'max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:max-h-[82dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[20px] max-sm:pb-[env(safe-area-inset-bottom)]',
    workspace: 'max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]'
}
```

Render a handle only for `sheet`:

```tsx
{presentation === 'sheet' ? (
    <div
        data-app-dialog-sheet-handle=""
        aria-hidden="true"
        className="grid h-5 shrink-0 place-items-center sm:hidden"
    >
        <span className="h-1 w-9 rounded-full bg-[var(--app-border)]" />
    </div>
) : null}
```

Use `100dvh` in the shared maximum-height fallback.

- [ ] **Step 4: Run the component test and confirm GREEN**

Run:

```bash
bun run --cwd web test src/components/ui/app-dialog.test.tsx
```

Expected: all `AppDialog` component tests pass.

- [ ] **Step 5: Commit the presentation foundation**

```bash
git add web/src/components/ui/app-dialog.tsx web/src/components/ui/app-dialog.test.tsx
git commit -m "feat(web): add adaptive dialog presentations"
```

---

### Task 2: Add mobile Back navigation and accessible touch targets

**Files:**
- Modify: `web/src/components/ui/app-dialog.tsx`
- Test: `web/src/components/ui/app-dialog.test.tsx`

- [ ] **Step 1: Write failing tests for Back and the 44px hit area**

```tsx
it('uses Back on mobile and Close on desktop for workspace navigation', () => {
    const onMobileBack = vi.fn()
    render(
        <AppDialog open>
            <AppDialogContent presentation="workspace">
                <AppDialogHeader
                    title="Terminal"
                    mobileNavigation="back"
                    mobileBackLabel="Back to session"
                    onMobileBack={onMobileBack}
                />
            </AppDialogContent>
        </AppDialog>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to session' }))
    expect(onMobileBack).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Back to session' })).toHaveClass('sm:hidden', 'h-11', 'w-11')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('max-sm:hidden', 'h-11', 'w-11')
})

it('keeps the small outline visual inside a 44px close hit area', () => {
    // Render normal header.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('h-11', 'w-11')
    expect(screen.getByRole('button', { name: 'Close' }).firstElementChild)
        .toHaveClass('h-[28px]', 'w-[28px]')
})
```

- [ ] **Step 2: Run the component test and confirm RED**

Run:

```bash
bun run --cwd web test src/components/ui/app-dialog.test.tsx
```

Expected: FAIL because header navigation props and mobile Back do not exist.

- [ ] **Step 3: Implement the header contract**

Add optional props:

```tsx
mobileNavigation?: 'close' | 'back'
mobileBackLabel?: string
onMobileBack?: () => void
```

For `back`, render a leading `44 × 44px` mobile-only button using an inline chevron-left SVG. Keep `AppDialogClose` at the trailing edge but hide it below `sm`. Extend `AppDialogClose` with an optional `className` and change its transparent hit area from `36 × 36px` to `44 × 44px`; keep the visible outline `28 × 28px`.

- [ ] **Step 4: Run the component test and confirm GREEN**

Run:

```bash
bun run --cwd web test src/components/ui/app-dialog.test.tsx
```

Expected: all component tests pass.

- [ ] **Step 5: Commit header navigation**

```bash
git add web/src/components/ui/app-dialog.tsx web/src/components/ui/app-dialog.test.tsx
git commit -m "feat(web): add mobile dialog back navigation"
```

---

### Task 3: Implement the three approved HAPI flows

**Files:**
- Modify: `web/src/components/modals/TerminalModal.tsx`
- Modify: `web/src/components/SessionTaskListControl.tsx`
- Modify: `web/src/components/SessionTaskListControl.css`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Test: `web/src/components/modals/TerminalModal.test.tsx`
- Test: `web/src/components/SessionTaskListControl.test.tsx`
- Test: `web/src/components/editor/EditorTerminal.test.tsx`
- Test: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`

- [ ] **Step 1: Write failing regression tests for Terminal workspace**

Update `TerminalModal.test.tsx`:

```tsx
it('uses the mobile workspace presentation and returns to the session', () => {
    const onClose = vi.fn()
    renderModal({ onClose })

    expect(screen.getByRole('dialog')).toHaveAttribute('data-app-dialog-presentation', 'workspace')
    fireEvent.click(screen.getByRole('button', { name: 'Back to session' }))
    expect(onClose).toHaveBeenCalledOnce()
})
```

Keep the desktop close assertion, updated to the `44px` transparent hit area.

- [ ] **Step 2: Write failing regression test for Task List sheet**

Add:

```tsx
it('uses the shared mobile sheet presentation', () => {
    render(<SessionTaskListControl todos={todos} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('dialog')).toHaveAttribute('data-app-dialog-presentation', 'sheet')
    expect(document.querySelector('[data-app-dialog-sheet-handle]')).toBeInTheDocument()
})
```

- [ ] **Step 3: Update existing terminal-close tests to require alert**

In both terminal tab surfaces, assert:

```tsx
expect(screen.getByRole('dialog', { name: /Close terminal|Stop terminal process/ }))
    .toHaveAttribute('data-app-dialog-presentation', 'alert')
```

Remove assertions that require the old mobile bottom-sheet positioning for close confirmations.

- [ ] **Step 4: Run the four focused tests and confirm RED**

```bash
bun run --cwd web test \
  src/components/modals/TerminalModal.test.tsx \
  src/components/SessionTaskListControl.test.tsx \
  src/components/editor/EditorTerminal.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx
```

Expected: FAIL on missing presentation and Back contract.

- [ ] **Step 5: Implement the three approved flows**

Terminal:

```tsx
<AppDialogContent
    presentation="workspace"
    className="h-[85vh] max-h-[800px] w-[95vw] max-w-3xl"
>
    <AppDialogHeader
        title="Terminal"
        subtitle={...}
        mobileNavigation="back"
        mobileBackLabel="Back to session"
        onMobileBack={props.onClose}
    />
</AppDialogContent>
```

Task List:

```tsx
<AppDialogContent presentation="sheet" className="session-task-dialog">
```

Terminal close confirmations:

```tsx
<AppDialogContent presentation="alert" className="max-w-md">
```

Delete the feature-owned mobile bottom-sheet positioning classes from close confirmations because `alert` now owns their presentation.

- [ ] **Step 6: Run the focused tests and confirm GREEN**

Use the command from Step 4.

Expected: all focused tests pass.

- [ ] **Step 7: Commit the approved flows**

```bash
git add \
  web/src/components/modals/TerminalModal.tsx \
  web/src/components/modals/TerminalModal.test.tsx \
  web/src/components/SessionTaskListControl.tsx \
  web/src/components/SessionTaskListControl.css \
  web/src/components/SessionTaskListControl.test.tsx \
  web/src/components/editor/EditorTerminal.tsx \
  web/src/components/editor/EditorTerminal.test.tsx \
  web/src/components/Terminal/SessionTerminalTabs.tsx \
  web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "feat(web): adapt core dialogs for mobile"
```

---

### Task 4: Migrate remaining application workspaces and sheets

**Files:**
- Modify: `web/src/components/modals/BrowserModal.tsx`
- Modify: `web/src/components/modals/FilesModal.tsx`
- Modify: `web/src/components/modals/SettingsModal.tsx`
- Modify: `web/src/components/modals/NewSessionModal.tsx`
- Modify: `web/src/components/modals/ReplacePinModal.tsx`
- Modify: `web/src/components/TeamChat/TeamSessionChatModal.tsx`
- Modify: `web/src/components/SessionGoalControl.tsx`
- Modify tests adjacent to the components above where assertions exist

- [ ] **Step 1: Write failing tests for representative workspace and sheet migrations**

Add or extend tests to assert:

```tsx
expect(screen.getByRole('dialog')).toHaveAttribute('data-app-dialog-presentation', 'workspace')
expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
```

for Browser/Files/Settings/Direct Chat, and:

```tsx
expect(screen.getByRole('dialog')).toHaveAttribute('data-app-dialog-presentation', 'sheet')
```

for Replace Pin and Session Goal.

New Session must use `workspace` with Close rather than Back.

- [ ] **Step 2: Run only the affected test files and confirm RED**

Run the adjacent tests discovered with:

```bash
rg -l "BrowserModal|FilesModal|SettingsModal|NewSessionModal|ReplacePinModal|TeamSessionChatModal|SessionGoalControl" web/src --glob '*.test.tsx'
```

Then pass those paths to:

```bash
bun run --cwd web test <affected-test-paths>
```

Expected: new presentation assertions fail.

- [ ] **Step 3: Declare presentation and navigation in each feature**

Use:

```tsx
presentation="workspace"
mobileNavigation="back"
onMobileBack={props.onClose}
```

for Browser, Files, Settings and Direct Chat.

Use `presentation="workspace"` with the default mobile Close for New Session.

Use `presentation="sheet"` for Replace Pin and Session Goal.

Do not change their data loading, submit, selection, or close callbacks.

- [ ] **Step 4: Run the affected tests and confirm GREEN**

Run the exact command assembled in Step 2.

Expected: all affected tests pass.

- [ ] **Step 5: Commit application modal migration**

```bash
git add web/src/components/modals web/src/components/TeamChat/TeamSessionChatModal.tsx web/src/components/SessionGoalControl.tsx
git commit -m "feat(web): migrate app modals to adaptive layouts"
```

---

### Task 5: Classify local dialogs and remove duplicated mobile positioning

**Files:**
- Modify all remaining production files returned by `rg -l "<AppDialogContent" web/src --glob '*.tsx' --glob '!*.test.tsx'`
- Modify adjacent tests whose layout assertions change
- Test: `web/src/components/ui/app-dialog-usage.test.ts`

- [ ] **Step 1: Add a failing source-contract test**

Extend `app-dialog-usage.test.ts`:

```ts
it('requires every feature AppDialogContent to declare a presentation', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (file.endsWith('ui/app-dialog.tsx') || file.endsWith('.test.tsx')) return []
        return /<AppDialogContent(?![^>]*presentation=)/s.test(source) ? [file] : []
    })

    expect(offenders).toEqual([])
})
```

- [ ] **Step 2: Run the usage test and confirm RED**

```bash
bun run --cwd web test src/components/ui/app-dialog-usage.test.ts
```

Expected: FAIL listing unclassified feature dialogs.

- [ ] **Step 3: Classify every remaining dialog**

Rules:

- `alert`: confirm, rename, short forms, destructive decisions;
- `sheet`: short contextual lists or install guidance;
- `workspace`: Diff, CLI output, Tool details and existing full-screen Team Chat forms;
- Terminal Search/Snippets remain anchored panels and are not changed.

Remove feature-owned mobile positioning strings such as:

```tsx
bottom-0 top-auto w-full translate-y-0 rounded-b-none rounded-t-xl
```

when the shared `presentation` now owns the same behavior.

- [ ] **Step 4: Run the usage test and affected feature tests**

```bash
bun run --cwd web test src/components/ui/app-dialog-usage.test.ts
```

Then run every adjacent test changed in this task.

Expected: usage and regression tests pass.

- [ ] **Step 5: Commit local dialog classification**

```bash
git add web/src
git commit -m "refactor(web): centralize mobile dialog layouts"
```

Before committing, verify `git diff --cached --name-only` contains only `web/src` files intended by this plan.

---

### Task 6: Full review and verification

**Files:**
- Modify only if review or verification reveals an issue

- [ ] **Step 1: Review the actual diff against the spec**

Check:

```bash
git diff 923d55c..HEAD -- web/src
rg -n "bottom-0.*rounded-t|h-\\[100dvh\\].*rounded-none" web/src --glob '*.tsx'
git diff --check
```

Confirm:

- desktop sizing classes remain on each feature;
- shared component owns mobile positioning;
- Back callbacks only close/return and do not stop terminal sessions;
- no API, hub, CLI or data changes;
- unrelated preview/BMAD files remain unstaged.

- [ ] **Step 2: Run all web tests**

```bash
bun run --cwd web test
```

Expected: all test files and tests pass with zero failures.

- [ ] **Step 3: Run typecheck**

```bash
bun run --cwd web typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Run production build**

```bash
bun run build:web
```

Expected: Vite/PWA build exits 0; known asset/chunk warnings may remain.

- [ ] **Step 5: Inspect final repository state**

```bash
git status --short
git log -8 --oneline
```

Confirm all planned code is committed and only pre-existing unrelated artifacts remain uncommitted.
