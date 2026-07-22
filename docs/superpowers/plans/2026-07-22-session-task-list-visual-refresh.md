# Session Task List Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển task control thành badge Minimal Timeline cạnh provider và làm modal nhẹ, có màu trạng thái, khoảng cách progress rõ ràng, hiển thị tốt trên desktop và mobile.

**Architecture:** Giữ nguyên `session.todos` và Dialog hiện có. `SessionTaskListControl` tự suy ra visual state từ snapshot, render badge + timeline; `SessionHeader` chỉ quyết định vị trí cạnh provider ở normal/compact.

**Tech Stack:** React, TypeScript strict, Tailwind utilities, CSS thuần cho state/animation, Radix Dialog, Vitest, Testing Library, Bun.

## Global Constraints

- Làm trực tiếp trên `main` theo yêu cầu user; không chạm `_bmad-output/party-mode/memories/installed/.memlog.md`.
- Không sửa Hub, CLI, `session.todos`, provider adapter, database hoặc public API.
- Không thêm dependency; không edit/clear/refresh/history/stale detection.
- Badge nằm ngay sau provider ở normal và compact header; không còn trong action group.
- Badge active tím, pending vàng, completed xanh; animation tôn trọng `prefers-reduced-motion`.
- Modal dùng Minimal Timeline, không card box nặng và không nền đen tuyệt đối.
- Kiểm chứng mobile ở `320px` và `375px`; không claim visual match nếu chưa có screenshot thực tế.

---

## File Map

| File | Thao tác | Trách nhiệm |
|---|---|---|
| `web/src/components/SessionTaskListControl.tsx` | Sửa | Suy ra state, render slim badge, progress zone và timeline |
| `web/src/components/SessionTaskListControl.css` | Tạo | Badge/modal/timeline colors, sizing, hover, motion và mobile safety |
| `web/src/components/SessionTaskListControl.test.tsx` | Sửa | Test state, structure, accessibility và mobile classes |
| `web/src/components/SessionHeader.tsx` | Sửa | Đưa badge cạnh provider ở normal/compact |
| `web/src/components/SessionHeader.test.tsx` | Sửa | Test DOM order và badge ngoài action group |
| `web/src/components/Dashboard/dashboard.css` | Sửa | Xóa modifier task action cũ không còn dùng |
| `web/src/components/Dashboard/dashboard-mobile-css.test.ts` | Sửa | Xóa assertion CSS cũ; không để dead contract |

---

### Task 1: Slim dynamic badge và Minimal Timeline modal

**Files:**
- Modify: `web/src/components/SessionTaskListControl.tsx`
- Create: `web/src/components/SessionTaskListControl.css`
- Modify: `web/src/components/SessionTaskListControl.test.tsx`

**Interfaces:**
- Consumes: `todos: TodoItem[] | null | undefined`, `compact?: boolean` chỉ để chặn double-click bubbling trong pinned header.
- Produces: `.session-task-badge--active|pending|completed`, `.session-task-progress`, `.session-task-timeline`.

- [ ] **Step 1: Viết failing tests cho badge state và timeline structure**

Thêm assertions:

```tsx
it.each([
    ['in_progress', 'session-task-badge--active'],
    ['pending', 'session-task-badge--pending'],
    ['completed', 'session-task-badge--completed']
] as const)('uses the %s visual state', (status, className) => {
    render(<SessionTaskListControl todos={[
        { id: status, content: status, status, priority: 'medium' }
    ]} />)
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveClass('session-task-badge', className)
    expect(trigger).toHaveTextContent(status === 'completed' ? '1/1' : '0/1')
    expect(trigger).not.toHaveTextContent('Tasks')
})

it('separates progress from a borderless timeline', () => {
    render(<SessionTaskListControl todos={todos} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('progressbar').parentElement).toHaveClass('session-task-progress')
    expect(screen.getByRole('list')).toHaveClass('session-task-timeline')
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('session-task-row')
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `cd web && bunx vitest run src/components/SessionTaskListControl.test.tsx`

Expected: FAIL vì state/timeline classes chưa tồn tại.

- [ ] **Step 3: Cài state selection và JSX Minimal Timeline**

State priority:

```ts
const visualState = todos.some((todo) => todo.status === 'in_progress')
    ? 'active'
    : todos.some((todo) => todo.status === 'pending')
        ? 'pending'
        : 'completed'
```

Trigger bắt buộc:

```tsx
<button
    type="button"
    aria-label={label}
    title={label}
    className={`session-task-badge session-task-badge--${visualState}`}
    onDoubleClick={compact ? (event) => event.stopPropagation() : undefined}
>
    <span className="session-task-badge__dot" aria-hidden="true" />
    <span>{completed}/{total}</span>
</button>
```

Modal dùng `className="session-task-dialog"`; progress bọc trong `.session-task-progress`; danh sách dùng `.session-task-timeline`; mỗi row `.session-task-row session-task-row--${todo.status}` với dot timeline riêng. Giữ nguyên Dialog title/description, ARIA progress, translated status, key an toàn và focus behavior.

- [ ] **Step 4: Tạo CSS đúng visual spec**

Các contract chính phải xuất hiện nguyên vẹn:

```css
.session-task-badge {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    height: 20px;
    gap: 5px;
    padding: 0 7px;
    border: 1px solid #3c4655;
    border-radius: 6px;
    background: #20252d;
    color: #c6d0df;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition: color 150ms, border-color 150ms, background 150ms;
}

.session-task-badge__dot { width: 5px; height: 5px; border-radius: 999px; }
.session-task-badge--active .session-task-badge__dot { background: #8c7dff; }
.session-task-badge--pending .session-task-badge__dot { background: #d7a34a; }
.session-task-badge--completed .session-task-badge__dot { background: #46d39a; }

.session-task-dialog { width: calc(100vw - 24px); max-width: 440px; border-color: #2b3038; background: #181c21; }
.session-task-progress { margin-top: 14px; margin-bottom: 18px; }
.session-task-progress__track { height: 4px; background: #2c313b; }
.session-task-timeline { max-height: 60vh; overflow-y: auto; overscroll-behavior: contain; }
.session-task-row { min-height: 48px; border-bottom: 1px solid #252a31; }
```

Thêm timeline line/dot, state colors, row hover, progress transition và `@media (prefers-reduced-motion: reduce)` tắt pulse/transition. Không dùng `!important`.

- [ ] **Step 5: Chạy component test và commit**

Run:

```bash
cd web && bunx vitest run src/components/SessionTaskListControl.test.tsx
cd web && bun run typecheck
```

Expected: component tests và typecheck PASS.

```bash
git add web/src/components/SessionTaskListControl.tsx web/src/components/SessionTaskListControl.css web/src/components/SessionTaskListControl.test.tsx
git commit -m "feat(web): refine session task badge and timeline"
```

---

### Task 2: Đưa badge cạnh provider ở cả hai header

**Files:**
- Modify: `web/src/components/SessionHeader.tsx`
- Modify: `web/src/components/SessionHeader.test.tsx`
- Modify: `web/src/components/Dashboard/dashboard.css`
- Modify: `web/src/components/Dashboard/dashboard-mobile-css.test.ts`

**Interfaces:**
- Consumes: `SessionTaskListControl` từ Task 1.
- Produces: provider → task badge DOM order; task badge không nằm trong compact actions hoặc normal right actions.

- [ ] **Step 1: Viết failing integration tests cho vị trí**

Gắn test IDs ổn định vào wrapper provider/task nếu cần. Assertions chính:

```tsx
const provider = screen.getByText('codex')
const taskTrigger = screen.getByRole('button', { name: 'Session tasks: 1 of 2 completed' })
expect(provider.compareDocumentPosition(taskTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
expect(taskTrigger.closest('.db-pinned__compact-actions')).toBeNull()
```

Chạy cho normal và compact; compact double-click vẫn không gọi `onFocusSession`.

- [ ] **Step 2: Chạy header tests để xác nhận đỏ**

Run: `cd web && bunx vitest run src/components/SessionHeader.test.tsx`

Expected: FAIL vì compact trigger còn trong action group và normal trigger ở bên phải metadata.

- [ ] **Step 3: Di chuyển component, không nhân đôi**

Compact:

```tsx
<span className={`db-card__agent db-card__agent--${agentFlavor}`}>{agentFlavor}</span>
<SessionTaskListControl todos={session.todos} compact />
```

Xóa instance cũ khỏi `.db-pinned__compact-actions`.

Normal: đặt trigger ngay sau provider trong metadata row, dùng wrapper `inline-flex min-w-0 items-center gap-1`; xóa instance cũ trước machine selector. Provider và badge được giữ cùng cụm; title/path vẫn có `min-w-0` và truncate.

- [ ] **Step 4: Xóa CSS contract action cũ**

Xóa `.db-pinned__compact-action--tasks` khỏi `dashboard.css` và assertion tương ứng khỏi `dashboard-mobile-css.test.ts`. Không sửa style action khác.

- [ ] **Step 5: Chạy integration tests và commit**

Run:

```bash
cd web && bunx vitest run src/components/SessionTaskListControl.test.tsx src/components/SessionHeader.test.tsx src/components/Dashboard/dashboard-mobile-css.test.ts
cd web && bun run typecheck
```

Expected: PASS.

```bash
git add web/src/components/SessionHeader.tsx web/src/components/SessionHeader.test.tsx web/src/components/Dashboard/dashboard.css web/src/components/Dashboard/dashboard-mobile-css.test.ts
git commit -m "fix(web): place task badge beside provider"
```

---

### Task 3: Visual verification và regression

**Files:**
- Review: toàn bộ diff Task 1–2
- Modify: chỉ các file trên nếu visual/test phát hiện sai lệch

- [ ] **Step 1: Chạy full Web verification**

Run:

```bash
cd web && bun run test
cd .. && bun typecheck
git diff --check
```

Expected: exit code `0`; warning Browserslist/Mermaid hiện hữu được phân loại, không có warning mới.

- [ ] **Step 2: Capture desktop và mobile**

Render actual `SessionHeader` + `SessionTaskListControl` với fixture có completed/in-progress/pending ở:

```text
Desktop: viewport gần ảnh gốc, compact header + modal mở
Mobile: 320px × 640px
Mobile: 375px × 812px
```

Chụp implementation screenshot; kiểm tra badge sát provider, action không chồng, modal cách mép `12px`, progress cách timeline `16–18px`, text dài wrap và timeline scroll.

- [ ] **Step 3: Sửa visual mismatch nếu có và rerun targeted tests**

Triage theo thứ tự: layout → spacing → typography → color → motion. Mọi sửa phải chạy lại component/header/CSS tests.

- [ ] **Step 4: Final review và commit fix nếu cần**

Run:

```bash
git diff --check
git status --short
git log --oneline -3
```

Expected: chỉ `.memlog.md` ngoài phạm vi còn modified; feature files đã commit; screenshot comparison được ghi trong báo cáo hoàn thành.
