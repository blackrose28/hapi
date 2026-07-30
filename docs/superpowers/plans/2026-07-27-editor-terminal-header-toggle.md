# Editor Terminal Header Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép vùng nền header terminal trong desktop Editor Mode mở/thu gọn panel mà không làm các tab và nút con toggle nhầm.

**Architecture:** Giữ callback và state collapse hiện có tại `EditorLayout`. `EditorTerminal` chỉ mở rộng vùng phát sinh callback: header container nhận click nền, còn button, tab strip và mobile được loại trừ bằng kiểm tra nguồn sự kiện.

**Tech Stack:** React 19, TypeScript, Testing Library, Vitest, Tailwind CSS.

---

## File map

| File | Trách nhiệm |
|---|---|
| `web/src/components/editor/EditorTerminal.tsx` | Phân loại click header thành toggle hoặc thao tác điều khiển riêng |
| `web/src/components/editor/EditorTerminal.test.tsx` | Khóa hành vi toggle nền, chống double-toggle và giữ mobile không đổi |

### Task 1: Toggle từ vùng nền desktop

**Files:**
- Modify: `web/src/components/editor/EditorTerminal.tsx:385-430`
- Test: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Viết test thất bại cho click chữ Terminal**

Thêm test:

```tsx
it('toggles the desktop panel from the terminal header background', () => {
    const onToggleCollapsed = vi.fn()
    renderMachineTerminal({ onToggleCollapsed })

    fireEvent.click(screen.getByText('Terminal'))
    fireEvent.click(screen.getByText('Terminal'))

    expect(onToggleCollapsed).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run:

```bash
bun --cwd web test src/components/editor/EditorTerminal.test.tsx -t "toggles the desktop panel from the terminal header background"
```

Expected: FAIL; callback nhận `0` lần vì header chưa có click handler.

- [ ] **Step 3: Thêm toggle tối thiểu trên header**

Tạm thêm callback nền tối thiểu để chỉ làm xanh test đầu tiên:

```tsx
<div
    className="flex h-8 shrink-0 cursor-pointer items-center border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)]"
    onClick={() => props.onToggleCollapsed()}
>
```

Ngoại lệ mobile và điều khiển con được thêm sau khi các test tương ứng đã đỏ ở Task 2.

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run:

```bash
bun --cwd web test src/components/editor/EditorTerminal.test.tsx -t "toggles the desktop panel from the terminal header background"
```

Expected: PASS.

### Task 2: Cô lập tab và nút con

**Files:**
- Modify: `web/src/components/editor/EditorTerminal.tsx:385-445`
- Test: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Viết test thất bại cho double-toggle và control isolation**

Thêm hai test:

```tsx
it('does not toggle the panel from terminal header controls', () => {
    const onToggleCollapsed = vi.fn()
    const onSelectTab = vi.fn()
    const onCloseTab = vi.fn()
    const onOpenTerminal = vi.fn()
    renderMachineTerminal({
        onToggleCollapsed,
        onSelectTab,
        onCloseTab,
        onOpenTerminal,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal' }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)

    const selectTab = screen.getByRole('button', { name: 'Select terminal Terminal: bash' })
    fireEvent.click(selectTab)
    fireEvent.click(selectTab.parentElement!)
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal Terminal: bash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))

    expect(onSelectTab).toHaveBeenCalledWith('term-machine')
    expect(onCloseTab).toHaveBeenCalledWith('term-machine')
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
})

it('does not add terminal header collapse behavior on mobile', () => {
    const onToggleCollapsed = vi.fn()
    renderMachineTerminal({ mobileMode: true, onToggleCollapsed })

    fireEvent.click(screen.getByText('Terminal'))

    expect(onToggleCollapsed).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run:

```bash
bun --cwd web test src/components/editor/EditorTerminal.test.tsx -t "terminal header controls|collapse behavior on mobile"
```

Expected: FAIL; click button nổi bọt lên header gây double-toggle và mobile nhận hành vi mới.

- [ ] **Step 3: Lọc nguồn click**

Đánh dấu tab strip:

```tsx
<div
    data-terminal-header-control
    className="flex min-w-0 flex-1 items-center overflow-x-auto"
>
```

Thay handler header bằng:

```tsx
className={`flex h-8 shrink-0 items-center border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] ${
    props.mobileMode ? '' : 'cursor-pointer'
}`}
onClick={(event) => {
    const target = event.target
    if (
        props.mobileMode
        || (
            target instanceof Element
            && target.closest('button, [data-terminal-header-control]')
        )
    ) {
        return
    }
    props.onToggleCollapsed()
}}
```

Kết quả: button không nổi bọt thành toggle, toàn vùng tab strip kể cả padding không toggle, vùng nền desktop vẫn toggle.

- [ ] **Step 4: Chạy test component**

Run:

```bash
bun --cwd web test src/components/editor/EditorTerminal.test.tsx
```

Expected: toàn bộ test trong file PASS.

### Task 3: Kiểm chứng và commit

**Files:**
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Test: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Chạy test web đầy đủ**

```bash
bun --cwd web test
```

Expected: 0 test fail.

- [ ] **Step 2: Chạy typecheck và build**

```bash
bun typecheck
bun --cwd web build
git diff --check
```

Expected: tất cả exit code `0`; chỉ chấp nhận các cảnh báo build đã có về Browserslist, KaTeX và chunk size.

- [ ] **Step 3: Kiểm tra phạm vi diff**

```bash
git diff -- web/src/components/editor/EditorTerminal.tsx web/src/components/editor/EditorTerminal.test.tsx
git status --short
```

Expected: chỉ hai file web thuộc tính năng được stage; các artifact preview/BMAD ngoài phạm vi không được stage.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/editor/EditorTerminal.tsx web/src/components/editor/EditorTerminal.test.tsx
git commit -m "fix(web): toggle editor terminal from header"
```
