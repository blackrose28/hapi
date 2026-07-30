# Hapi AppDialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo `AppDialog` dùng chung và chuyển toàn bộ modal Hapi sang cùng nền tảng, surface, header, close button và footer visual mà không đổi kích thước hoặc hành vi nghiệp vụ.

**Architecture:** Giữ `web/src/components/ui/dialog.tsx` làm Radix primitive cấp thấp. Tạo `web/src/components/ui/app-dialog.tsx` làm lớp composition cấp sản phẩm với header slots và close button chuẩn; từng feature vẫn truyền class kích thước, body, actions và footer riêng. Migration theo hai nhóm: modal cấp ứng dụng trước, dialog cục bộ/mobile sheet sau.

**Tech Stack:** React 19, TypeScript strict, Radix Dialog, Tailwind CSS 4, Vitest, Testing Library.

## Global Constraints

- Không chuẩn hóa width, height, max-width hoặc max-height.
- Không thêm route, full-screen action, Search, Session Context hay Project Workspace.
- Không đổi API, database, protocol, session state hoặc hành vi nghiệp vụ.
- Close visual `28 × 28px`, icon `13px`, hit-area `36 × 36px`.
- Tất cả modal hiện tại phải dùng `AppDialog`.
- TDD bắt buộc: test đỏ trước production code.

---

## File Structure

| File/nhóm | Trách nhiệm |
|---|---|
| `web/src/components/ui/dialog.tsx` | Radix primitives; export `DialogClose`, hỗ trợ tắt close mặc định |
| `web/src/components/ui/app-dialog.tsx` | Product-level dialog shell, header, body, footer, close button |
| `web/src/components/ui/app-dialog.test.tsx` | Contract và visual regression ở cấp component |
| `web/src/components/modals/*.tsx` | Modal cấp ứng dụng dùng AppDialog |
| `web/src/components/TeamChat/TeamSessionChatModal.tsx` | Bỏ custom overlay, dùng AppDialog |
| Các dialog cục bộ được liệt kê ở Task 4 | Dùng cùng shell/header/footer |

---

### Task 1: AppDialog Foundation

**Files:**
- Create: `web/src/components/ui/app-dialog.tsx`
- Create: `web/src/components/ui/app-dialog.test.tsx`
- Modify: `web/src/components/ui/dialog.tsx`

**Interfaces:**
- Consumes: `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription` từ `ui/dialog.tsx`.
- Produces:
  - `AppDialog`
  - `AppDialogTrigger`
  - `AppDialogContent`
  - `AppDialogHeader`
  - `AppDialogBody`
  - `AppDialogFooter`
  - `AppDialogClose`

- [ ] **Step 1: Viết test đỏ cho contract AppDialog**

```tsx
it('renders the shared header slots and one accessible close control', () => {
    render(
        <AppDialog open>
            <AppDialogContent data-testid="content" className="h-[85vh] max-w-3xl">
                <AppDialogHeader
                    icon={<span data-testid="icon">T</span>}
                    title="Terminal"
                    subtitle="/repo"
                    meta={<span>connected</span>}
                    actions={<button type="button">Refresh</button>}
                />
                <AppDialogBody>Body</AppDialogBody>
                <AppDialogFooter>Footer</AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )

    expect(screen.getByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.getByText('/repo')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    expect(screen.getByTestId('content')).toHaveClass('h-[85vh]', 'max-w-3xl')
})
```

- [ ] **Step 2: Viết test đỏ cho close visual và optional footer**

```tsx
it('uses a slim outline visual inside a larger close hit area', () => {
    render(
        <AppDialog open>
            <AppDialogContent>
                <AppDialogHeader title="Settings" />
                <AppDialogBody>Body</AppDialogBody>
            </AppDialogContent>
        </AppDialog>
    )

    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveClass('h-9', 'w-9')
    expect(close.firstElementChild).toHaveClass('h-7', 'w-7', 'border')
    expect(document.querySelector('[data-app-dialog-footer]')).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Chạy test và xác nhận đỏ**

Run:

```bash
bun run --cwd web test -- src/components/ui/app-dialog.test.tsx
```

Expected: FAIL vì module `./app-dialog` chưa tồn tại.

- [ ] **Step 4: Mở rộng primitive để header sở hữu close**

Trong `web/src/components/ui/dialog.tsx`:

```tsx
export const DialogClose = DialogPrimitive.Close

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeLabel?: string
    closeClassName?: string
    showClose?: boolean
}
```

`DialogContent` chỉ render close mặc định khi `showClose` là `true`; mặc định giữ `true` để không phá code chưa migrate.

- [ ] **Step 5: Implement AppDialog tối thiểu**

`web/src/components/ui/app-dialog.tsx`:

```tsx
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { CloseIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from './dialog'

export const AppDialog = Dialog
export const AppDialogTrigger = DialogTrigger

export function AppDialogContent(props: ComponentProps<typeof DialogContent>) {
    const { className, showClose: _showClose, ...rest } = props
    return (
        <DialogContent
            showClose={false}
            data-app-dialog-content=""
            className={cn(
                'flex max-h-[calc(100vh-24px)] flex-col gap-0 overflow-hidden border-[var(--app-border)] bg-[var(--app-bg)] p-0',
                className
            )}
            {...rest}
        />
    )
}

export function AppDialogHeader(props: {
    icon?: ReactNode
    title: ReactNode
    subtitle?: ReactNode
    meta?: ReactNode
    actions?: ReactNode
    closeLabel?: string
    className?: string
}) {
    return (
        <header className={cn(
            'flex min-h-[50px] shrink-0 items-center gap-3 border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] pl-3 pr-1.5',
            props.className
        )}>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {props.icon ? <div className="shrink-0">{props.icon}</div> : null}
                <div className="min-w-0">
                    <DialogTitle className="truncate text-sm font-semibold text-[var(--app-fg)]">
                        {props.title}
                    </DialogTitle>
                    {props.subtitle ? (
                        <DialogDescription className="mt-0.5 truncate text-[11px] text-[var(--app-hint)]">
                            {props.subtitle}
                        </DialogDescription>
                    ) : null}
                </div>
            </div>
            {props.meta ? <div className="flex shrink-0 items-center gap-2">{props.meta}</div> : null}
            {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
            <AppDialogClose label={props.closeLabel} />
        </header>
    )
}

export function AppDialogClose({ label = 'Close' }: { label?: string }) {
    return (
        <DialogClose asChild>
            <button type="button" aria-label={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)]">
                <span className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--app-border)] bg-transparent text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]">
                    <CloseIcon className="h-[13px] w-[13px]" />
                </span>
            </button>
        </DialogClose>
    )
}

export function AppDialogBody(props: HTMLAttributes<HTMLDivElement>) {
    return <div {...props} className={cn('min-h-0 flex-1', props.className)} />
}

export function AppDialogFooter(props: HTMLAttributes<HTMLDivElement>) {
    return (
        <footer
            data-app-dialog-footer=""
            {...props}
            className={cn(
                'flex shrink-0 items-center justify-end gap-2 border-t border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2.5',
                props.className
            )}
        />
    )
}
```

- [ ] **Step 6: Chạy test và xác nhận xanh**

Run:

```bash
bun run --cwd web test -- src/components/ui/app-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit foundation**

```bash
git add web/src/components/ui/dialog.tsx web/src/components/ui/app-dialog.tsx web/src/components/ui/app-dialog.test.tsx
git commit -m "feat(web): add shared AppDialog shell"
```

---

### Task 2: Migrate Global Application Modals

**Files:**
- Modify: `web/src/components/GlobalModalManager.tsx`
- Modify: `web/src/components/modals/BrowserModal.tsx`
- Modify: `web/src/components/modals/NewSessionModal.tsx`
- Modify: `web/src/components/modals/FilesModal.tsx`
- Modify: `web/src/components/modals/ReplacePinModal.tsx`
- Modify: `web/src/components/modals/SettingsModal.tsx`
- Modify: `web/src/components/modals/TerminalModal.tsx`
- Modify: `web/src/components/modals/TerminalModal.test.tsx`
- Create: `web/src/components/modals/AppModals.test.tsx`

**Interfaces:**
- Consumes: AppDialog exports từ Task 1.
- Produces: toàn bộ route-driven modals dùng chung surface/header.

- [ ] **Step 1: Viết test đỏ cho các modal cấp ứng dụng**

Mock feature-heavy children và render từng modal trong `AppDialog open`. Với mỗi modal:

```tsx
expect(screen.getByRole('heading', { name: expectedTitle })).toBeInTheDocument()
expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
expect(document.querySelector('[data-app-dialog-content]')).toBeInTheDocument()
```

Các title bắt buộc:

```ts
[
    'Browse workspaces',
    'New session',
    'Files',
    'Maximum Pins Reached',
    'Settings',
    'Terminal',
]
```

- [ ] **Step 2: Chạy test và xác nhận đỏ**

```bash
bun run --cwd web test -- src/components/modals/AppModals.test.tsx src/components/modals/TerminalModal.test.tsx
```

Expected: FAIL vì các modal vẫn render `DialogContent`/custom terminal header.

- [ ] **Step 3: Migrate Browser, New Session, Replace PIN và Settings**

Pattern bắt buộc:

```tsx
<AppDialogContent className="...kích thước hiện tại...">
    <AppDialogHeader title={existingTitle} subtitle={existingSubtitleOrUndefined} />
    <AppDialogBody className="...overflow/padding hiện tại...">
        {existingBody}
    </AppDialogBody>
    {existingFooter ? <AppDialogFooter>{existingFooter}</AppDialogFooter> : null}
</AppDialogContent>
```

Không đổi callback, form state, query hoặc navigation.

- [ ] **Step 4: Migrate Files**

Đưa nút refresh hiện có vào `actions`:

```tsx
<AppDialogHeader
    title="Files"
    subtitle={subtitle}
    actions={(
        <button type="button" onClick={handleRefresh} aria-label="Refresh files" className="...existing action styles...">
            <RefreshIcon />
        </button>
    )}
/>
```

Giữ search bar, tabs và file body nguyên vị trí dưới header.

- [ ] **Step 5: Migrate Terminal**

`TerminalModal` render `AppDialogHeader` làm header modal duy nhất. `SessionTerminalTabs` tiếp tục sở hữu status strip và terminal tabs ở phần body:

```tsx
<AppDialogContent className="h-[85vh] max-h-[800px] w-[95vw] max-w-3xl">
    <AppDialogHeader
        title="Terminal"
        subtitle={session.metadata?.name ?? session.metadata?.path}
    />
    <AppDialogBody className="overflow-hidden p-0">
        <SessionTerminalTabs ... />
    </AppDialogBody>
</AppDialogContent>
```

Xóa prop `header` tạm thời đang được TerminalModal truyền vào `SessionTerminalTabs`; không tạo hook/controller thứ hai chỉ để đưa status lên header.

- [ ] **Step 6: Chạy focused tests**

```bash
bun run --cwd web test -- src/components/modals/AppModals.test.tsx src/components/modals/TerminalModal.test.tsx src/components/Terminal/SessionTerminalTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit global modals**

```bash
git add web/src/components/GlobalModalManager.tsx web/src/components/modals web/src/components/Terminal/SessionTerminalTabs.tsx web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "refactor(web): migrate application modals to AppDialog"
```

---

### Task 3: Migrate Focus Session Modal

**Files:**
- Modify: `web/src/components/TeamChat/TeamSessionChatModal.tsx`
- Modify: `web/src/components/TeamChat/TeamSessionChatModal.test.tsx`

**Interfaces:**
- Consumes: `AppDialog`, `AppDialogContent`, `AppDialogHeader`, `AppDialogBody`.
- Produces: Focus Session dùng Radix focus/escape/overlay và header chung.

- [ ] **Step 1: Viết test đỏ cho shared shell và hành vi hiện tại**

```tsx
expect(screen.getByRole('heading', { name: 'Direct chat with @alice' })).toBeInTheDocument()
expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
fireEvent.keyDown(document, { key: 'Escape' })
expect(onClose).toHaveBeenCalledTimes(1)
```

Test thêm action hiện có:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Open full session' }))
expect(onOpenFullSession).toHaveBeenCalledWith('session-1')
```

- [ ] **Step 2: Chạy test và xác nhận đỏ**

```bash
bun run --cwd web test -- src/components/TeamChat/TeamSessionChatModal.test.tsx
```

Expected: FAIL vì modal còn dùng custom `div role="dialog"` và close button riêng.

- [ ] **Step 3: Thay custom overlay bằng AppDialog**

```tsx
<AppDialog open onOpenChange={(open) => !open && props.onClose()}>
    <AppDialogContent className="h-[min(92vh,900px)] w-[min(1120px,calc(100vw-1rem))] max-w-none sm:w-[min(1120px,calc(100vw-2rem))]">
        <AppDialogHeader
            title={`Direct chat with @${props.alias}`}
            subtitle={title}
            meta={statusBadge}
            actions={<button onClick={() => props.onOpenFullSession(activeSessionId)}>Open full session</button>}
            closeLabel="Close direct chat"
        />
        <AppDialogBody>
            {existingLoadingErrorOrSessionChat}
        </AppDialogBody>
    </AppDialogContent>
</AppDialog>
```

Bỏ manual `window.keydown` Escape listener; Radix sở hữu hành vi này.

- [ ] **Step 4: Chạy test và xác nhận xanh**

```bash
bun run --cwd web test -- src/components/TeamChat/TeamSessionChatModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Focus Session migration**

```bash
git add web/src/components/TeamChat/TeamSessionChatModal.tsx web/src/components/TeamChat/TeamSessionChatModal.test.tsx
git commit -m "refactor(web): migrate focus session modal to AppDialog"
```

---

### Task 4: Migrate Local Dialogs and Mobile Sheets

**Files:**
- Modify: `web/src/components/ui/ConfirmDialog.tsx`
- Modify: `web/src/components/RenameSessionDialog.tsx`
- Modify: `web/src/components/SessionGoalControl.tsx`
- Modify: `web/src/components/SessionTaskListControl.tsx`
- Modify: `web/src/components/DiffView.tsx`
- Modify: `web/src/components/CliOutputBlock.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/LoginPrompt.tsx`
- Modify: `web/src/components/Terminal/TerminalQuickKeys.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTabs.tsx`
- Modify tests adjacent to the components above.

**Interfaces:**
- Consumes: AppDialog exports từ Task 1.
- Produces: không còn feature component import `DialogContent` trực tiếp.

- [ ] **Step 1: Viết audit test đỏ**

Create `web/src/components/ui/app-dialog-usage.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

function collectTsxFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return collectTsxFiles(path)
        return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
    })
}

it('keeps raw DialogContent imports inside the ui layer only', () => {
    const files = collectTsxFiles('src')
    const offenders = files.filter((file) => {
        if (file.endsWith('ui/dialog.tsx') || file.endsWith('ui/app-dialog.tsx')) return false
        const source = readFileSync(file, 'utf8')
        return source.includes("from '@/components/ui/dialog'") && source.includes('DialogContent')
    })
    expect(offenders).toEqual([])
})
```

- [ ] **Step 2: Chạy audit test và xác nhận đỏ**

```bash
bun run --cwd web test -- src/components/ui/app-dialog-usage.test.ts
```

Expected: FAIL và liệt kê toàn bộ dialog chưa migrate.

- [ ] **Step 3: Migrate confirm/form dialogs**

Áp dụng `AppDialogContent + AppDialogHeader + AppDialogBody + AppDialogFooter` cho:

- ConfirmDialog
- RenameSessionDialog
- SessionGoalControl
- SessionTaskListControl
- LoginPrompt

Di chuyển button row hiện tại vào `AppDialogFooter`; giữ nguyên label, disabled, pending và error logic.

- [ ] **Step 4: Migrate content viewers**

Áp dụng AppDialog cho:

- DiffView
- CliOutputBlock
- ToolCard

Giữ nguyên max-width, code overflow, diff scroll và trigger behavior.

- [ ] **Step 5: Migrate terminal/editor confirmations và mobile sheets**

Áp dụng AppDialog cho:

- TerminalQuickKeys “More” sheet và paste fallback.
- SessionTerminalTabs close confirmation.
- EditorTerminal mobile close confirmation.
- EditorTabs unsaved close confirmation.

Giữ nguyên bottom-sheet class names trên `AppDialogContent`; chỉ thay surface/header/footer primitives.

- [ ] **Step 6: Chạy component tests theo nhóm**

```bash
bun run --cwd web test -- \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx \
  src/components/editor/EditorTabs.test.tsx \
  src/components/SessionTaskListControl.test.tsx \
  src/components/TeamChat/TeamSessionChatModal.test.tsx \
  src/components/ui/app-dialog-usage.test.ts
```

Expected: PASS. Nếu file test không tồn tại, không tạo test rỗng; chạy test adjacent hiện có và giữ audit test làm coverage migration.

- [ ] **Step 7: Commit local dialog migration**

```bash
git add web/src/components web/src/components/ui/app-dialog-usage.test.ts
git commit -m "refactor(web): migrate local dialogs to AppDialog"
```

---

### Task 5: Final Verification and Scope Audit

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Consumes: toàn bộ migration từ Tasks 1–4.
- Produces: evidence để hoàn tất.

- [ ] **Step 1: Rà raw usages**

```bash
rg -n "DialogContent|role=\"dialog\"|aria-modal=\"true\"" web/src --glob '*.tsx'
```

Expected: `DialogContent` production usage chỉ còn trong `ui/dialog.tsx` và `ui/app-dialog.tsx`; custom `role="dialog"` chỉ còn khi không phải modal Radix và có lý do rõ trong code.

- [ ] **Step 2: Chạy focused dialog/terminal/editor tests**

```bash
bun run --cwd web test -- \
  src/components/ui/app-dialog.test.tsx \
  src/components/ui/app-dialog-usage.test.ts \
  src/components/modals/TerminalModal.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/TeamChat/TeamSessionChatModal.test.tsx \
  src/components/editor/EditorTerminal.test.tsx \
  src/components/editor/EditorLayout.test.tsx \
  src/components/editor/MobileEditorLayout.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Chạy toàn bộ web tests**

```bash
bun run --cwd web test
```

Expected: PASS.

- [ ] **Step 4: Chạy typecheck, build và diff check**

```bash
bun run --cwd web typecheck
bun run --cwd web build
git diff --check
```

Expected: tất cả exit code `0`. Build warnings hiện hữu về Browserslist, KaTeX font và chunk size được ghi nhận nhưng không coi là regression nếu không tăng do AppDialog.

- [ ] **Step 5: Rà phạm vi thực tế**

```bash
git diff --stat
git diff -- web/src/components/ui web/src/components/modals web/src/components/TeamChat web/src/components/Terminal web/src/components/editor
```

Xác nhận:

- không có API/database/protocol changes;
- không có route/full-screen action mới;
- không có size enum;
- không có feature nghiệp vụ mới;
- mọi modal dùng AppDialog.

- [ ] **Step 6: Commit verification fixes nếu có**

Chỉ khi Step 1–5 buộc sửa regression, stage đúng các file vừa sửa rồi chạy:

```bash
git commit -m "fix(web): complete AppDialog migration verification"
```

Không tạo commit nếu verification không phát sinh diff mới.
