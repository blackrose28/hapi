# Terminal Modal-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở terminal session duy nhất bằng modal, gộp tab và trạng thái trên một hàng, đồng thời cho bubble mobile bật/tắt theo lần chạm body.

**Architecture:** Giữ `SessionTerminalTabs` là nội dung terminal dùng chung cho modal và editor, nhưng loại bỏ page route chỉ phục vụ session chat. Session chat đổi sang trạng thái modal trong search hiện tại. Tương tác mobile tiếp tục dùng state machine hiện có và bổ sung cờ cho gesture bắt đầu khi bubble đang mở, để lần chạm thứ hai đóng bubble mà vẫn cho phép kéo cuộn.

**Tech Stack:** React 19, TypeScript strict, TanStack Router, Vitest, Testing Library, Tailwind CSS, xterm.js.

## Global Constraints

- Chỉ sửa web; không thay đổi CLI, hub, shared hoặc terminal protocol.
- Xóa hoàn toàn `/sessions/:sessionId/terminal`; không redirect và không giữ lớp tương thích.
- Terminal panel trong editor mode giữ nguyên.
- Không thay đổi ngôn ngữ bàn phím, tự sửa, tự viết hoa hoặc kiểm tra chính tả.
- Mỗi thay đổi hành vi phải đi qua vòng RED → GREEN trước khi commit.

---

### Task 1: Chuyển session chat sang terminal modal và xóa route riêng

**Files:**
- Create: `web/src/routes/sessions/terminal-removal.test.ts`
- Modify: `web/src/components/SessionChat.tsx:423-434`
- Modify: `web/src/router.tsx:30-36,425-433,562-574`
- Delete: `web/src/routes/sessions/terminal.tsx`
- Delete: `web/src/routes/sessions/terminal.test.tsx`

**Interfaces:**
- Consumes: root search fields `modal: 'terminal'` và `modalSessionId: string`.
- Produces: nút Terminal trong composer cập nhật search hiện tại để `GlobalModalManager` mở `TerminalModal`.

- [ ] **Step 1: Viết test thất bại cho route và navigation cũ**

```ts
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '@/router'

const sessionChatSources = import.meta.glob('/src/components/SessionChat.tsx', {
    eager: true,
    import: 'default',
    query: '?raw',
}) as Record<string, string>

describe('terminal modal-only navigation', () => {
    it('does not register the legacy session terminal route', () => {
        const router = createAppRouter() as unknown as {
            routesByPath: Record<string, unknown>
        }

        expect(router.routesByPath['/sessions/$sessionId/terminal']).toBeUndefined()
    })

    it('opens terminal from session chat through modal search state', () => {
        const source = sessionChatSources['/src/components/SessionChat.tsx']

        expect(source).not.toContain("to: '/sessions/$sessionId/terminal'")
        expect(source).toContain("modal: 'terminal'")
        expect(source).toContain('modalSessionId: props.session.id')
    })
})
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
bun --cwd web test src/routes/sessions/terminal-removal.test.ts
```

Expected: FAIL vì router vẫn đăng ký `/sessions/$sessionId/terminal` và `SessionChat` vẫn điều hướng tới route đó.

- [ ] **Step 3: Đổi composer sang modal và xóa route**

Trong `SessionChat.tsx`, thay callback bằng:

```ts
const handleViewTerminal = useCallback(() => {
    navigate({
        search: (previous: any) => ({
            ...previous,
            modal: 'terminal',
            modalSessionId: props.session.id,
        }),
    } as any)
}, [navigate, props.session.id])
```

Trong `router.tsx`:

- Xóa import `TerminalPage`.
- Xóa `sessionTerminalRoute`.
- Xóa `sessionTerminalRoute` khỏi `sessionDetailRoute.addChildren`.

Xóa hai file page/test cũ:

```bash
rm web/src/routes/sessions/terminal.tsx \
   web/src/routes/sessions/terminal.test.tsx
```

- [ ] **Step 4: Chạy test và xác nhận GREEN**

Run:

```bash
bun --cwd web test src/routes/sessions/terminal-removal.test.ts src/components/modals/TerminalModal.test.tsx
```

Expected: PASS; modal dùng `SessionTerminalTabs`, route cũ không còn.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SessionChat.tsx \
        web/src/router.tsx \
        web/src/routes/sessions/terminal-removal.test.ts \
        web/src/routes/sessions/terminal.tsx \
        web/src/routes/sessions/terminal.test.tsx
git commit -m "refactor(web): make session terminal modal-only"
```

---

### Task 2: Gộp tab và trạng thái terminal trên một hàng

**Files:**
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx:341-405`
- Test: `web/src/components/Terminal/SessionTerminalTabs.test.tsx:240-275`

**Interfaces:**
- Consumes: `visibleTerminals`, `controller.state.status`, `liveCount` và các lỗi hiện có.
- Produces: một hàng có tab cuộn bên trái, trạng thái cố định bên phải; cảnh báo dài chỉ xuất hiện khi có lỗi.

- [ ] **Step 1: Viết test thất bại cho bố cục một hàng**

Thêm vào `SessionTerminalTabs.test.tsx`:

```tsx
it('keeps scrollable tabs left and connection status fixed right on one row', () => {
    mocks.controller = makeController([state('t1'), state('t2')])

    renderTabs()

    const row = screen.getByTestId('terminal-tabs-status-row')
    const tabs = screen.getByRole('group', { name: 'Terminal tabs' })
    const status = screen.getByTestId('terminal-connection-status')

    expect(tabs.parentElement).toBe(row)
    expect(status.parentElement).toBe(row)
    expect(tabs).toHaveClass('min-w-0', 'flex-1', 'overflow-x-auto')
    expect(status).toHaveClass('shrink-0')
    expect(status).toHaveTextContent('connected')
    expect(status).toHaveTextContent('2/3')
})
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
bun --cwd web test src/components/Terminal/SessionTerminalTabs.test.tsx -t "keeps scrollable tabs left"
```

Expected: FAIL vì chưa có `terminal-tabs-status-row` và trạng thái còn nằm ở hàng riêng.

- [ ] **Step 3: Tách trạng thái ngắn và cảnh báo dài**

Đổi `statusContent` thành trạng thái ngắn:

```tsx
const statusColor = controller.state.status === 'connected'
    ? 'bg-emerald-500'
    : controller.state.status === 'connecting'
        ? 'bg-amber-500'
        : controller.state.status === 'error'
            ? 'bg-red-500'
            : 'bg-[var(--app-hint)]'

const statusSummary = (
    <div
        data-testid="terminal-connection-status"
        className="flex shrink-0 items-center gap-2 border-l border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1"
    >
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
        <span className="text-[10px] text-[var(--app-hint)]">
            {controller.state.status}
        </span>
        <span className="rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">
            {liveCount}/3
        </span>
    </div>
)
```

Đặt các thông báo dài vào khối chỉ xuất hiện khi cần:

```tsx
const hasStatusMessage = Boolean(
    createError
    || controller.lastError
    || (controller.terminals.length === 0 && controller.recoveryReason === 'cli_lost')
    || !props.terminalSupported
    || !props.active
)
```

Sau hàng tab/trạng thái, render:

```tsx
{hasStatusMessage ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1">
        {createError ? <span className="truncate text-[10px] text-red-500">{createError}</span> : null}
        {controller.lastError ? <span className="truncate text-[10px] text-red-500">{controller.lastError}</span> : null}
        {controller.terminals.length === 0 && controller.recoveryReason === 'cli_lost' ? (
            <span className="truncate text-[10px] text-amber-500">{t('terminal.recovery.cliLost')}</span>
        ) : null}
        {!props.terminalSupported ? <span className="text-[10px] text-red-500">{t('terminal.unsupported')}</span> : null}
        {!props.active ? <span className="text-[10px] text-[var(--app-hint)]">{t('terminal.inactive')}</span> : null}
    </div>
) : null}
```

Gộp hai wrapper hiện có bằng thay đổi cấu trúc sau; toàn bộ map tab và nút `+` ở giữa hai thẻ giữ nguyên:

```diff
@@
- <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1">
-     {statusContent}
- </div>
-
- <div
-     role="group"
-     aria-label="Terminal tabs"
-     className="flex shrink-0 items-center overflow-x-auto border-b border-[var(--app-border)]"
- >
+ <div
+     data-testid="terminal-tabs-status-row"
+     className="flex shrink-0 items-stretch overflow-hidden border-b border-[var(--app-border)]"
+ >
+   <div
        role="group"
        aria-label="Terminal tabs"
        className="flex min-w-0 flex-1 items-center overflow-x-auto"
    >
@@
- </div>
+   </div>
+   {statusSummary}
+ </div>
```

- [ ] **Step 4: Chạy test liên quan và xác nhận GREEN**

Run:

```bash
bun --cwd web test src/components/Terminal/SessionTerminalTabs.test.tsx
```

Expected: toàn bộ test của `SessionTerminalTabs` PASS, bao gồm trạng thái lỗi vẫn hiển thị.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/SessionTerminalTabs.tsx \
        web/src/components/Terminal/SessionTerminalTabs.test.tsx
git commit -m "refactor(web): align terminal tabs with status"
```

---

### Task 3: Cho bubble mobile bật/tắt bằng lần chạm body

**Files:**
- Modify: `web/src/components/Terminal/useMobileTerminalInteraction.ts:44-51,650-760`
- Test: `web/src/components/Terminal/useMobileTerminalInteraction.test.tsx:340-430`

**Interfaces:**
- Consumes: state machine `idle | choice | input | select` và touch gesture hiện tại.
- Produces: tap `idle → choice`; tap `choice → idle`; drag khi `choice` vẫn đóng bubble và cuộn terminal.

- [ ] **Step 1: Viết test thất bại cho lần chạm thứ hai**

Thêm test:

```ts
it('toggles the choice bubble off on the second terminal body tap', () => {
    const fixture = createTerminalFixture()
    const { result } = renderInteraction(fixture)
    const first = touch(1, 55, 130)
    const second = touch(2, 55, 130)

    act(() => {
        dispatchTouch(fixture.terminalElement, 'touchstart', [first])
        dispatchTouch(fixture.terminalElement, 'touchend', [], [first])
        vi.runOnlyPendingTimers()
    })
    expect(result.current.overlayProps.mode).toBe('choice')

    act(() => {
        dispatchTouch(fixture.terminalElement, 'touchstart', [second])
        dispatchTouch(fixture.terminalElement, 'touchend', [], [second])
        vi.runOnlyPendingTimers()
    })

    expect(result.current.overlayProps.mode).toBe('idle')
})
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```bash
bun --cwd web test src/components/Terminal/useMobileTerminalInteraction.test.tsx -t "toggles the choice bubble off"
```

Expected: FAIL; kết quả hiện tại vẫn là `choice`.

- [ ] **Step 3: Gắn nguồn gesture vào touch session**

Mở rộng `TouchSession`:

```ts
type TouchSession = {
    identifier: number
    start: { x: number; y: number }
    last: { x: number; y: number }
    seedCell: TerminalCell
    scrolling: boolean
    longPressed: boolean
    dismissingChoice: boolean
}
```

Trong `handleTouchStart`, ghi nhận trạng thái trước gesture:

```ts
const dismissingChoice = overlayRef.current.mode === 'choice'
const session: TouchSession = {
    identifier: touch.identifier,
    start: { x: touch.clientX, y: touch.clientY },
    last: { x: touch.clientX, y: touch.clientY },
    seedCell,
    scrolling: false,
    longPressed: false,
    dismissingChoice,
}
touchRef.current = session

if (dismissingChoice) {
    updateOverlay(IDLE_OVERLAY)
    settleChoiceFocus(terminal)
} else {
    longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        if (
            touchRef.current !== session
            || session.scrolling
            || overlayRef.current.mode === 'input'
        ) return
        session.longPressed = true
        selectWord(session.seedCell)
    }, LONG_PRESS_MS)
}
```

Trong `handleTouchEnd`, không mở lại bubble vừa đóng:

```ts
if (session.scrolling || session.longPressed) {
    event.preventDefault()
} else if (!session.dismissingChoice) {
    scheduleChoiceReveal(terminal)
}
```

Cờ nằm trong touch session để gesture thứ hai vẫn có thể chuyển thành scroll, thay vì bị bỏ hoàn toàn từ `touchstart`.

- [ ] **Step 4: Chạy toàn bộ test tương tác mobile và xác nhận GREEN**

Run:

```bash
bun --cwd web test \
  src/components/Terminal/useMobileTerminalInteraction.test.tsx \
  src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx \
  src/components/Terminal/TerminalView.test.tsx
```

Expected: PASS; bubble toggle, scroll, input, selection và ghost-click đều giữ đúng hành vi.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/useMobileTerminalInteraction.ts \
        web/src/components/Terminal/useMobileTerminalInteraction.test.tsx
git commit -m "fix(web): toggle mobile terminal choice bubble"
```

---

### Task 4: Kiểm chứng tích hợp web

**Files:**
- Verify only.

**Interfaces:**
- Consumes: ba thay đổi đã commit.
- Produces: bằng chứng test, typecheck, build và diff sạch cho phạm vi triển khai.

- [ ] **Step 1: Chạy toàn bộ test web**

```bash
bun --cwd web test
```

Expected: 0 test failures.

- [ ] **Step 2: Chạy typecheck toàn repo**

```bash
bun typecheck
```

Expected: tất cả workspace typecheck thành công.

- [ ] **Step 3: Build web/PWA**

```bash
bun --cwd web build
```

Expected: Vite build và service worker build thành công; chỉ chấp nhận các cảnh báo chunk/font đã tồn tại.

- [ ] **Step 4: Kiểm tra diff và phạm vi**

```bash
git diff --check
git status --short --branch
```

Expected: không có whitespace error; không stage hoặc sửa các artifact ngoài phạm vi.
