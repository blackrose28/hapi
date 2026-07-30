# Terminal History Search and Mobile Snippet Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make History filter only on explicit search submission and compact the shared Snippet editor on mobile while preserving existing data flows and desktop presentation.

**Architecture:** Keep History filtering entirely inside `TerminalHistoryPanel` with separate draft and applied query state; no Hub or CLI request changes. Keep the shared Snippet editor and implement its mobile/desktop difference through responsive layout classes, so create and edit modes retain one validation and submission path.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS utility classes, Vitest, Testing Library, Vite.

---

## File Map

| File | Responsibility | Planned change |
|---|---|---|
| `web/src/components/Terminal/TerminalHistoryPanel.tsx` | History list and local filtering | Split draft/applied query, add submit and clear controls |
| `web/src/components/Terminal/TerminalHistoryPanel.test.tsx` | History interaction coverage | Prove typing does not filter; submit and clear do |
| `web/src/components/Terminal/TerminalSnippetEditor.tsx` | Shared create/edit form | Add compact responsive mobile grid and controls |
| `web/src/components/Terminal/TerminalSnippetPanel.test.tsx` | Snippet editor behavior and attributes | Lock responsive structure and preserve safety constraints |
| `web/src/lib/locales/en.ts` | English UI copy | Add Search and Clear search labels |
| `web/src/lib/locales/vi-VN.ts` | Vietnamese UI copy | Add Search and Clear search labels |
| `web/src/lib/locales/zh-CN.ts` | Chinese UI copy | Add Search and Clear search labels |

### Task 1: Explicit History Search Submission

**Files:**
- Modify: `web/src/components/Terminal/TerminalHistoryPanel.test.tsx`
- Modify: `web/src/components/Terminal/TerminalHistoryPanel.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: Replace the immediate-filter test with a failing submit-only test**

Update the translation mock:

```tsx
'terminal.history.searchAction': 'Search',
'terminal.history.clearSearch': 'Clear search',
```

Replace the current local filtering test with:

```tsx
it('keeps the current results while typing and filters only after search submit', () => {
    const props = renderPanel()
    const search = screen.getByRole('searchbox', { name: 'Search history' })

    fireEvent.change(search, { target: { value: 'git' } })

    expect(screen.getByRole('button', { name: 'Insert pwd' })).toBeVisible()

    fireEvent.submit(search.closest('form')!)

    expect(screen.getByRole('button', { name: 'Insert git status' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Insert git log --oneline' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Insert pwd' })).not.toBeInTheDocument()
    expect(props.onRefresh).not.toHaveBeenCalled()
})
```

Add clear coverage:

```tsx
it('applies search from the visible button and clearing restores every command', () => {
    renderPanel()
    const search = screen.getByRole('searchbox', { name: 'Search history' })

    fireEvent.change(search, { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByRole('button', { name: 'Insert pwd' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Insert git status' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(search).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Insert git status' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Insert pwd' })).toBeVisible()
})
```

Add snapshot refresh and whitespace coverage:

```tsx
it('keeps the applied query across a refreshed snapshot and whitespace submit restores all entries', () => {
    const props: React.ComponentProps<typeof TerminalHistoryPanel> = {
        state: readyState,
        disabled: false,
        onRefresh: vi.fn(),
        onClose: vi.fn(),
        onInsert: vi.fn(() => true),
    }
    const { rerender } = render(<TerminalHistoryPanel {...props} />)
    const search = screen.getByRole('searchbox', { name: 'Search history' })

    fireEvent.change(search, { target: { value: 'git' } })
    fireEvent.submit(search.closest('form')!)
    rerender(
        <TerminalHistoryPanel
            {...props}
            state={{
                status: 'ready',
                entries: [
                    { index: 4, command: 'git diff' },
                    { index: 3, command: 'git status' },
                    { index: 2, command: 'pwd' },
                ],
            }}
        />,
    )

    expect(screen.getByRole('button', { name: 'Insert git diff' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Insert pwd' })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '   ' } })
    fireEvent.submit(search.closest('form')!)

    expect(screen.getByRole('button', { name: 'Insert pwd' })).toBeVisible()
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web
bunx vitest run src/components/Terminal/TerminalHistoryPanel.test.tsx
```

Expected: FAIL because typing still filters immediately and Search/Clear search buttons do not exist.

- [ ] **Step 3: Implement draft/applied query state**

Replace the single query state and normalized query:

```tsx
const [draftQuery, setDraftQuery] = useState('')
const [appliedQuery, setAppliedQuery] = useState('')
const normalizedQuery = appliedQuery.trim().toLocaleLowerCase(locale)
```

Add explicit actions:

```tsx
const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAppliedQuery(draftQuery)
    setInsertStatus(null)
}

const clearSearch = () => {
    setDraftQuery('')
    setAppliedQuery('')
    setInsertStatus(null)
}
```

Replace the search label with a form containing an input wrapper, custom clear control, and submit button:

```tsx
<form
    role="search"
    onSubmit={applySearch}
    className="flex shrink-0 gap-2 border-b border-[var(--app-border)] p-2.5"
>
    <label className="relative min-w-0 flex-1">
        <span className="sr-only">
            {t('terminal.history.searchPlaceholder')}
        </span>
        <input
            type="search"
            value={draftQuery}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t('terminal.history.searchPlaceholder')}
            placeholder={t('terminal.history.searchPlaceholder')}
            onChange={(event) => {
                setDraftQuery(event.currentTarget.value)
                setInsertStatus(null)
            }}
            className="min-h-11 w-full appearance-none rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 pr-11 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)] focus-visible:ring-2 focus-visible:ring-violet-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {draftQuery ? (
            <button
                type="button"
                aria-label={t('terminal.history.clearSearch')}
                onClick={clearSearch}
                className="absolute right-1 top-1/2 grid min-h-9 min-w-9 -translate-y-1/2 place-items-center rounded-lg text-base text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
                <span aria-hidden="true">×</span>
            </button>
        ) : null}
    </label>
    <button
        type="submit"
        className="min-h-11 shrink-0 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white transition-opacity motion-reduce:transition-none hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]"
    >
        {t('terminal.history.searchAction')}
    </button>
</form>
```

- [ ] **Step 4: Add localized control labels**

Add next to `terminal.history.searchPlaceholder`:

```ts
// en.ts
'terminal.history.searchAction': 'Search',
'terminal.history.clearSearch': 'Clear search',

// vi-VN.ts
'terminal.history.searchAction': 'Tìm',
'terminal.history.clearSearch': 'Xoá tìm kiếm',

// zh-CN.ts
'terminal.history.searchAction': '搜索',
'terminal.history.clearSearch': '清除搜索',
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
cd web
bunx vitest run src/components/Terminal/TerminalHistoryPanel.test.tsx
```

Expected: all History panel tests PASS.

- [ ] **Step 6: Commit the History change**

```bash
git add \
  web/src/components/Terminal/TerminalHistoryPanel.tsx \
  web/src/components/Terminal/TerminalHistoryPanel.test.tsx \
  web/src/lib/locales/en.ts \
  web/src/lib/locales/vi-VN.ts \
  web/src/lib/locales/zh-CN.ts
git commit -m "fix(web): search terminal history on submit"
```

### Task 2: Compact Mobile Snippet Editor

**Files:**
- Modify: `web/src/components/Terminal/TerminalSnippetPanel.test.tsx`
- Modify: `web/src/components/Terminal/TerminalSnippetEditor.tsx`

- [ ] **Step 1: Add a failing responsive-layout test**

Inside `describe('TerminalSnippetPanel editor', ...)`, add:

```tsx
it('uses a compact mobile grid while preserving the spacious desktop layout', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    const nameField = screen.getByLabelText('Name').closest('[data-editor-field]')
    const command = screen.getByLabelText('Command')
    const commandField = command.closest('[data-editor-field]')
    const description = screen.getByLabelText('Description (optional)')
    const descriptionField = description.closest('[data-editor-field]')
    const save = screen.getByRole('button', { name: 'Save' })

    expect(nameField).toHaveClass('col-span-2', 'sm:col-span-1', 'order-1')
    expect(descriptionField).toHaveClass('col-span-3', 'sm:col-span-1', 'order-2', 'sm:order-3')
    expect(commandField).toHaveClass('col-span-5', 'sm:col-span-1', 'order-3', 'sm:order-2')
    expect(command).toHaveAttribute('rows', '3')
    expect(command).toHaveClass('resize-none', 'sm:resize-y')
    expect(description).toHaveAttribute('rows', '1')
    expect(description).toHaveClass('resize-none', 'sm:resize-y')
    expect(save).toHaveClass('w-full', 'sm:w-auto')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web
bunx vitest run src/components/Terminal/TerminalSnippetPanel.test.tsx
```

Expected: FAIL because editor fields have no responsive grid markers, Command still has five rows, Description has two rows, and Save is not full width.

- [ ] **Step 3: Extend `EditorField` for responsive placement**

Change the helper:

```tsx
function EditorField(props: {
    label: string
    className: string
    children: ReactNode
}) {
    return (
        <label
            data-editor-field=""
            className={`min-w-0 space-y-1.5 text-xs font-medium text-[var(--app-hint)] ${props.className}`}
        >
            <span className="block truncate">{props.label}</span>
            {props.children}
        </label>
    )
}
```

- [ ] **Step 4: Implement the responsive field grid**

Keep the editor header, then wrap all fields in:

```tsx
<div className="grid grid-cols-5 gap-2 sm:grid-cols-1 sm:gap-3">
    <EditorField
        label={t('terminal.snippets.editor.name')}
        className="order-1 col-span-2 sm:col-span-1"
    >
        {/* existing Name input */}
    </EditorField>
    <EditorField
        label={t('terminal.snippets.editor.command')}
        className="order-3 col-span-5 sm:order-2 sm:col-span-1"
    >
        {/* Command textarea from Step 5 */}
    </EditorField>
    <EditorField
        label={t('terminal.snippets.editor.description')}
        className="order-2 col-span-3 sm:order-3 sm:col-span-1"
    >
        {/* Description textarea from Step 5 */}
    </EditorField>
</div>
```

Change the form container from `space-y-3` to:

```tsx
className="flex flex-col gap-2.5 sm:gap-3"
```

- [ ] **Step 5: Compact the mobile text areas without changing desktop comfort**

Use three logical rows for Command and restore the existing five-row visual height from `sm` upward:

```tsx
<textarea
    required
    rows={3}
    maxLength={TERMINAL_SNIPPET_COMMAND_MAX_LENGTH}
    autoCapitalize="none"
    autoCorrect="off"
    spellCheck={false}
    value={props.editor.command}
    onChange={(event) => props.onChange('command', event.target.value)}
    className="min-h-[5rem] w-full resize-none rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-[7.75rem] sm:resize-y"
/>
```

Use one logical row for Description and restore the current two-row visual height on desktop:

```tsx
<textarea
    rows={1}
    maxLength={TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH}
    value={props.editor.description}
    onChange={(event) => props.onChange('description', event.target.value)}
    className="min-h-11 w-full resize-none rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-16 sm:resize-y"
/>
```

- [ ] **Step 6: Compact the warning and make Save mobile-wide**

Replace the warning with:

```tsx
<p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
    <span aria-hidden="true" className="shrink-0">◇</span>
    <span>{t('terminal.snippets.editor.secretWarning')}</span>
</p>
```

Use a responsive action wrapper and button:

```tsx
<div className="flex">
    <button
        type="submit"
        disabled={props.isPending || !props.apiAvailable}
        className="min-h-11 w-full rounded-xl bg-[var(--app-button)] px-4 text-sm font-semibold text-[var(--app-button-text)] transition-opacity motion-reduce:transition-none hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto sm:w-auto sm:min-w-11"
    >
        {props.isPending
            ? t('terminal.snippets.editor.saving')
            : t('terminal.snippets.editor.save')}
    </button>
</div>
```

- [ ] **Step 7: Run Snippet tests and verify GREEN**

Run:

```bash
cd web
bunx vitest run src/components/Terminal/TerminalSnippetPanel.test.tsx
```

Expected: all Snippet panel tests PASS, including existing value preservation, limits, validation, and pending protection.

- [ ] **Step 8: Commit the responsive editor**

```bash
git add \
  web/src/components/Terminal/TerminalSnippetEditor.tsx \
  web/src/components/Terminal/TerminalSnippetPanel.test.tsx
git commit -m "fix(web): compact snippet editor on mobile"
```

### Task 3: Regression and Production Verification

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: Run both focused suites together**

```bash
cd web
bunx vitest run \
  src/components/Terminal/TerminalHistoryPanel.test.tsx \
  src/components/Terminal/TerminalSnippetPanel.test.tsx
```

Expected: both files PASS.

- [ ] **Step 2: Run Web typecheck**

```bash
cd web
bun run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run the full Web suite**

```bash
cd web
bun run test
```

Expected: all Web tests PASS.

- [ ] **Step 4: Build production Web assets**

```bash
bun run build:web
```

Expected: Vite and PWA builds finish with exit code 0.

- [ ] **Step 5: Inspect responsive behavior**

At widths 320px, 375px, and 430px:

```text
History:
- typing leaves the current list unchanged;
- button and software-keyboard Search/Enter apply the query;
- Clear search restores all entries without refreshing History.

Snippet create/edit:
- Name and Description remain on one row without horizontal overflow;
- Command remains usable at three visible rows;
- warning wraps without overflow;
- Save spans the available width and remains reachable above the software keyboard.
```

At 768px or wider:

```text
- Name, Command, and Description remain vertically ordered;
- Command and Description retain their spacious visual height;
- Save is right-aligned and content-width.
```

- [ ] **Step 6: Review the final diff**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Expected: no whitespace errors, only the planned Web/test/locale files are changed, and the worktree is clean after commits.
