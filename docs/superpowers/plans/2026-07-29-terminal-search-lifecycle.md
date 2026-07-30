# Terminal Search Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giữ nguyên phiên Search trên mobile và desktop khi panel chỉ bị thu gọn, nhưng xoá đúng lúc khi người dùng nhấn `×` hoặc terminal đổi ngữ cảnh.

**Architecture:** `SessionTerminalTabs` quản lý riêng công cụ đang hiển thị và việc một phiên Search còn tồn tại. `TerminalControlDock` giữ `TerminalSearchPanel` được mount khi phiên còn tồn tại, dùng thuộc tính `hidden` để thu gọn, và có callback riêng cho thao tác `×`.

**Tech Stack:** React 19, TypeScript, xterm.js SearchAddon, Vitest, Testing Library.

---

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `web/src/components/Terminal/TerminalControlDock.tsx` | Mount/ẩn Search panel; tách thao tác thu gọn và xoá |
| `web/src/components/Terminal/TerminalControlDock.test.tsx` | Chứng minh panel giữ state khi ẩn và `×` gọi callback xoá |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | Điều phối vòng đời Search theo desktop/mobile và terminal identity |
| `web/src/components/Terminal/SessionTerminalTabs.test.tsx` | Chứng minh body/icon/Snippets không xoá desktop; `×`/tab/disconnect xoá; không bắt `Esc` |
| `web/src/components/editor/EditorTerminal.tsx` | Nối API Dock mới nhưng giữ nguyên lifecycle Search hiện tại của editor |

### Task 1: Giữ Search panel được mount khi thu gọn

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Test: `web/src/components/Terminal/TerminalControlDock.test.tsx`

- [ ] **Step 1: Viết test thất bại**

Thêm props mặc định:

```tsx
searchMounted: false,
onSearchClose: vi.fn(),
```

Thêm test dựng Search ở trạng thái `searchMounted: true`, nhập `needle`, chuyển
`activeTool` từ `search` sang `snippets`, rồi trở lại `search`. Kỳ vọng:

```tsx
expect(screen.getByRole('searchbox')).toHaveValue('needle')
expect(screen.getByRole('region', { name: 'Search terminal output' }).parentElement)
    .toHaveAttribute('hidden')
```

Thêm test nhấn `Close search` và kỳ vọng:

```tsx
expect(onSearchClose).toHaveBeenCalledOnce()
expect(onActiveToolChange).not.toHaveBeenCalledWith(null)
```

- [ ] **Step 2: Chạy test để xác nhận RED**

```bash
bun run --cwd web test src/components/Terminal/TerminalControlDock.test.tsx
```

Kỳ vọng: FAIL vì `searchMounted`/`onSearchClose` chưa tồn tại và panel bị
unmount khi `activeTool !== 'search'`.

- [ ] **Step 3: Sửa API và mount lifecycle tối thiểu**

Mở rộng props:

```tsx
searchMounted: boolean
onSearchClose: () => void
```

Render Search theo `searchMounted`, nhưng ẩn theo `activeTool`:

```tsx
{props.searchMounted ? (
    <section
        hidden={props.activeTool !== 'search'}
        role="region"
        aria-label={t('terminal.controls.search')}
        className="pointer-events-auto absolute ..."
    >
        <TerminalSearchPanel
            state={props.searchState}
            onClose={props.onSearchClose}
        />
    </section>
) : null}
```

- [ ] **Step 4: Chạy test để xác nhận GREEN**

```bash
bun run --cwd web test src/components/Terminal/TerminalControlDock.test.tsx
```

Kỳ vọng: toàn bộ test file PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx \
        web/src/components/Terminal/TerminalControlDock.test.tsx
git commit -m "refactor(web): preserve hidden terminal search panel"
```

### Task 2: Chuẩn hoá vòng đời Search desktop

**Files:**
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Test: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`

- [ ] **Step 1: Viết test thất bại cho desktop**

Stub desktop bằng `matchMedia('(min-width: 1024px)').matches === true`, mở
Search, publish controller ready và nhập `needle`. Kiểm tra:

```tsx
fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
expect(controller.clear).not.toHaveBeenCalled()
expect(screen.getByRole('searchbox')).toHaveValue('needle')

fireEvent.click(desktopSearchButton)
expect(controller.clear).not.toHaveBeenCalled()
expect(screen.queryByRole('searchbox')).not.toBeVisible()

fireEvent.click(desktopSearchButton)
expect(screen.getByRole('searchbox')).toHaveValue('needle')
```

Chuyển sang Snippets rồi quay lại Search, kỳ vọng từ khoá và controller còn
nguyên. Dispatch `Escape`, kỳ vọng không `preventDefault` và Search vẫn mở.

- [ ] **Step 2: Viết test thất bại cho các điểm xoá**

Nhấn `Close search`, đổi terminal tab và disconnect. Với từng trường hợp:

```tsx
expect(controller.clear).toHaveBeenCalled()
expect(mocks.terminalMounts.at(-1)?.searchActive).toBe(false)
```

Giữ test mobile hiện có: body tap vẫn đóng và xoá công cụ Search.

- [ ] **Step 3: Chạy test để xác nhận RED**

```bash
bun run --cwd web test src/components/Terminal/SessionTerminalTabs.test.tsx
```

Kỳ vọng: FAIL vì `activeDockTool` hiện vừa điều khiển visibility vừa điều khiển
SearchAddon; body desktop và `Esc` đang gọi `clearSearch`.

- [ ] **Step 4: Tách visibility khỏi Search session**

Thêm state:

```tsx
const [searchMounted, setSearchMounted] = useState(false)
```

Đổi hàm xoá để reset cả controller, state và mount:

```tsx
const clearSearch = useCallback((closeTool = true) => {
    searchGenerationRef.current += 1
    searchStateRef.current.controller?.clear()
    searchStateRef.current = EMPTY_TERMINAL_SEARCH_STATE
    setSearchState(EMPTY_TERMINAL_SEARCH_STATE)
    setSearchMounted(false)
    if (closeTool) setActiveDockTool(null)
}, [])
```

Khi desktop mở/thu gọn Search, chỉ đổi `activeDockTool`; lần mở đầu đặt
`searchMounted = true`. Mobile tiếp tục dùng `clearSearch` khi đóng tool.

```tsx
const searchEnabled = searchMounted && searchIdentity !== null
```

Truyền xuống Dock:

```tsx
searchMounted={searchMounted}
onSearchClose={clearSearch}
```

Ở `EditorTerminal`, nối API mới bằng lifecycle cũ để không đổi hành vi:

```tsx
searchMounted={activeDockTool === 'search'}
onSearchClose={() => clearSearch()}
```

- [ ] **Step 5: Sửa body và keyboard lifecycle**

Desktop body:

```tsx
if (desktop && activeDockTool === 'search') return
```

Desktop body có Snippets chỉ thu gọn Snippets, không xoá Search đã giữ. Mobile
giữ hành vi clear hiện tại.

Trong listener bàn phím, giữ `Ctrl/Cmd+F` và xoá toàn bộ nhánh xử lý `Escape`.

- [ ] **Step 6: Chạy test để xác nhận GREEN**

```bash
bun run --cwd web test \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/TerminalSearchPanel.test.tsx \
  src/components/Terminal/useTerminalSearchAddon.test.tsx
```

Kỳ vọng: toàn bộ test được chọn PASS.

- [ ] **Step 7: Kiểm chứng toàn bộ web**

```bash
bun run --cwd web test
bun run --cwd web typecheck
bun run build:web
git diff --check
```

Kỳ vọng: test/typecheck/build PASS; `git diff --check` không có lỗi whitespace.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Terminal/SessionTerminalTabs.tsx \
        web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "fix(web): retain desktop terminal searches"
```

### Task 3: Thống nhất lifecycle Search trên mobile

**Files:**
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Test: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Test: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Viết test thất bại cho session terminal mobile**

Ở viewport mobile, mở Search, publish controller ready và nhập `needle`. Kiểm
tra body tap và icon toggle:

```tsx
fireEvent.pointerDown(screen.getByTestId('terminal-surface'))
expect(controller.clear).not.toHaveBeenCalled()
expect(screen.getByRole('region', { name: 'Search terminal output' }))
    .toBeVisible()

fireEvent.click(screen.getByRole('button', { name: 'Search' }))
expect(controller.clear).not.toHaveBeenCalled()
expect(screen.getByRole('region', {
    name: 'Search terminal output',
    hidden: true,
})).toBeInTheDocument()

fireEvent.click(screen.getByRole('button', { name: 'Search' }))
expect(screen.getByRole('textbox', {
    name: 'Search terminal output',
})).toHaveValue('needle')
```

Giữ kỳ vọng đổi tab, disconnect và unmount vẫn gọi `controller.clear()`.

- [ ] **Step 2: Viết test thất bại cho editor terminal mobile**

Đổi mock `TerminalSearchPanel` thành component có state input. Mở Search của
machine terminal, nhập `needle`, body tap rồi toggle Search. Kỳ vọng giống
session terminal:

```tsx
expect(controller.clear).not.toHaveBeenCalled()
expect(searchInput).toHaveValue('needle')
```

Giữ test đổi editor tab, collapse, disconnect và unmount phải clear.

- [ ] **Step 3: Chạy test để xác nhận RED**

```bash
bun run --cwd web test \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx
```

Kỳ vọng: FAIL vì mobile body/toggle hiện còn gọi `clearSearch`.

- [ ] **Step 4: Bỏ khác biệt lifecycle theo breakpoint**

Trong `SessionTerminalTabs`, đổi handler visibility thành:

```tsx
const dismissDockTool = useCallback(() => {
    if (activeDockTool !== 'search') {
        setActiveDockTool(null)
    }
}, [activeDockTool])

const handleActiveDockToolChange = useCallback((tool: TerminalDockTool | null) => {
    if (tool === 'search') {
        setSearchMounted(true)
    }
    setActiveDockTool(tool)
}, [])
```

`isDesktopTerminalViewport()` chỉ còn dùng để giới hạn `Ctrl/Cmd+F`.

- [ ] **Step 5: Áp dụng cùng state model cho EditorTerminal**

Thêm `searchMounted`, reset trong `clearSearch`, dùng nó cho `searchEnabled`,
và để body chỉ thu gọn công cụ khác:

```tsx
const [searchMounted, setSearchMounted] = useState(false)
const searchEnabled = searchMounted && searchIdentity !== null

const dismissDockTool = useCallback(() => {
    if (activeDockTool !== 'search') {
        setActiveDockTool(null)
    }
}, [activeDockTool])
```

Truyền:

```tsx
searchMounted={searchMounted}
onSearchClose={() => clearSearch()}
```

- [ ] **Step 6: Chạy test để xác nhận GREEN**

```bash
bun run --cwd web test \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/editor/EditorTerminal.test.tsx
```

Kỳ vọng: toàn bộ test được chọn PASS.

- [ ] **Step 7: Kiểm chứng toàn bộ web**

```bash
bun run --cwd web test
bun run --cwd web typecheck
bun run build:web
git diff --check
```

Kỳ vọng: test/typecheck/build PASS; không có lỗi whitespace.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-07-29-terminal-search-lifecycle.md \
        web/src/components/Terminal/SessionTerminalTabs.tsx \
        web/src/components/Terminal/SessionTerminalTabs.test.tsx \
        web/src/components/editor/EditorTerminal.tsx \
        web/src/components/editor/EditorTerminal.test.tsx
git commit -m "fix(web): retain mobile terminal searches"
```
