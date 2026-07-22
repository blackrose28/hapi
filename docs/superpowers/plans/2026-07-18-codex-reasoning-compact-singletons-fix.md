# Codex Reasoning And Compact Singleton Tools Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị `CodexReasoning` như reasoning disclosure không box và giữ các tool thường đứng riêng ở dạng compact tối đa 600px mà không đổi dữ liệu, thứ tự hoặc ranh giới nhóm.

**Architecture:** Chỉ sửa lớp React presentation. Tách disclosure dùng chung khỏi `ReasoningGroup`, định tuyến riêng `CodexReasoning` tại `HappyToolMessage`, và tái sử dụng `isGroupableToolBlock` để chọn `group-row` cho singleton an toàn. Không thay normalize, reducer, runtime converter, CLI, Hub, API hoặc database.

**Tech Stack:** React 19, TypeScript strict, assistant-ui, Tailwind CSS variables, Vitest + Testing Library, Bun.

## Global Constraints

- Giữ mỗi `ChatBlock` đúng một lần và đúng thứ tự stream.
- `CodexReasoning` đứng ngoài nhóm tool và ngắt run; nội dung result vẫn xem được đầy đủ.
- Tool singleton compact chỉ áp dụng allowlist hiện tại: `Read`, `Grep`, `Glob`, `Bash`, `CodexBash`, `CodexPatch`, `CodexDiff`.
- Permission, question, error, child tool, `update_plan`, Task, Agent, unknown và MCP giữ card riêng hiện tại.
- Singleton và group đều `width: 100%`, `max-width: 600px`; output dài tối đa 300px rồi cuộn.
- Tool không có meaningful output không có nút mở inline; dialog chi tiết vẫn giữ nguyên.
- Không thêm dependency và không đổi i18n hiện có.

---

### Task 1: Shared reasoning disclosure và CodexReasoning route

**Files:**
- Modify: `web/src/components/assistant-ui/reasoning.tsx`
- Modify: `web/src/components/assistant-ui/reasoning.test.tsx`
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx`

**Interfaces:**
- Produces: `ReasoningDisclosure({ children, isStreaming, label, blockId? })`.
- Preserves: `ReasoningGroup` generic assistant-ui lifecycle.
- Routes: `CodexReasoning` directly to the shared disclosure and existing `CodexReasoningResultView`.

- [x] **Step 1: Viết test RED cho production-shaped Codex sequence**

Thêm chuỗi:

```ts
const codexSequence: ChatBlock[] = [
    toolBlock('CodexReasoning', { title: 'Inspecting review details' }, {
        result: { content: 'reasoning-first-marker', status: 'completed' }
    }),
    toolBlock('CodexBash', { command: 'printf first' }, {
        result: { stdout: 'terminal-first-marker', stderr: '', exitCode: 0 }
    }),
    toolBlock('CodexReasoning', { title: 'Appending findings' }, {
        result: { content: 'reasoning-second-marker', status: 'completed' }
    }),
    toolBlock('CodexBash', { command: 'printf second' }, {
        result: { stdout: 'terminal-second-marker', stderr: '', exitCode: 0 }
    })
]
```

Assert mỗi `data-tool-block-id` xuất hiện đúng một lần, đúng thứ tự; có hai `[data-codex-reasoning]`; result marker vẫn xem được; không có reasoning card; mỗi singleton terminal là `group-row`, không tạo tool group. Không đếm text node tuyệt đối vì `RawJsonDevOnly` cố ý lặp raw result trong môi trường test/dev.

- [x] **Step 2: Chạy RED**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
```

Expected: FAIL vì `CodexReasoning` vẫn là card và singleton terminal vẫn là card.

- [x] **Step 3: Tách disclosure dùng chung và route CodexReasoning**

`ReasoningDisclosure` sở hữu state mở/đóng, `useId`, aria, auto-open khi `isStreaming`; `ReasoningGroup` chỉ lấy trạng thái message rồi truyền vào. Trong `HappyToolMessage`, nếu tên là `CodexReasoning`, render:

```tsx
<ReasoningDisclosure
    label={presentation.title}
    isStreaming={block.tool.state === 'pending' || block.tool.state === 'running'}
    blockId={block.id}
>
    <CodexReasoningResultView
        block={block}
        metadata={ctx.metadata}
        surface="group-output"
        t={t}
    />
</ReasoningDisclosure>
```

Lấy `presentation.title` qua registry hiện tại và result view qua `getToolResultViewComponent`, không tự parse hoặc loại bỏ result.

- [x] **Step 4: Chạy GREEN cho reasoning và integration**

```bash
cd web && bun run test src/components/assistant-ui/reasoning.test.tsx src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
```

Expected: PASS.

---

### Task 2: Compact singleton an toàn

**Files:**
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx` only if focused coverage is clearer there.

**Interfaces:**
- Reuses: `isGroupableToolBlock(block)` as the only singleton compact eligibility rule.
- Preserves: grouped context and standalone special cards.

- [x] **Step 1: Viết RED cho singleton và hard boundaries**

Assert:

```ts
expect(singletonRead).toHaveAttribute('data-tool-display', 'group-row')
expect(singletonRead.closest('[data-tool-singleton-compact]')).toHaveClass('max-w-[600px]')
expect(permissionRead).toHaveAttribute('data-tool-surface', 'permission')
expect(errorRead).toHaveAttribute('data-tool-surface', 'neutral')
expect(updatePlan).toHaveAttribute('data-tool-surface', 'plan')
```

Tool không output không có output toggle; terminal có output mở được và region giữ `max-h-[300px]`.

- [x] **Step 2: Chạy RED**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx src/components/ToolCard/ToolCard.test.tsx
```

Expected: FAIL vì singleton allowlisted đang dùng `displayMode="card"`.

- [x] **Step 3: Implement minimal selection**

```tsx
const compact = grouped || isGroupableToolBlock(block)

return (
    <div className={cn(
        'py-1 min-w-0 max-w-full overflow-x-hidden',
        !grouped && compact && 'w-full max-w-[600px]'
    )}>
        <ToolCard displayMode={compact ? 'group-row' : 'card'} ... />
        ...children unchanged...
    </div>
)
```

Không đổi `ToolCard` output classifier, dialog, permission footer hoặc group partitioning.

- [x] **Step 4: Chạy GREEN**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx src/components/ToolCard/ToolCard.test.tsx src/components/ToolCard/ToolRunGroup.test.tsx src/components/ToolCard/toolRunModel.test.ts
```

Expected: PASS.

---

### Task 3: Kiểm chứng phạm vi và build

**Files:**
- No production changes unless a test proves a defect.

- [x] **Step 1: Kiểm tra stream fidelity**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
```

Expected: Codex reasoning/tool markers exactly once and ordered; adjacent eligible tools still group; text/reasoning boundaries split groups.

- [x] **Step 2: Full verification**

```bash
bun run test:web
bun run typecheck:web
bun run build:web
git diff --check
```

Expected: zero failures; build exit 0; diff check empty.

- [x] **Step 3: Blast-radius review**

Run GitNexus `detect_changes` if this repo is indexed. Otherwise record the unavailable index and manually verify `git diff --stat`, `git diff`, and imports/callers. Expected scope: web message presentation only.

- [x] **Step 4: Final code review**

Check against every Global Constraint; inspect desktop/mobile markup or browser preview if a reachable session/fixture is available. Do not merge automatically.
