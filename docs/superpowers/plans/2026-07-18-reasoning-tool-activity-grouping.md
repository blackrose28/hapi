# Reasoning And Tool Activity Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gom reasoning và các tool thường liền kề thành activity group đúng mockup đã duyệt, không mất dữ liệu và không thay đổi thứ tự stream.

**Architecture:** Giữ `ChatBlock[]` làm nguồn chuẩn. Adapter web encode `agent-reasoning` thành pseudo tool-call `HapiReasoning` có artifact gốc để assistant-ui đưa reasoning vào cùng `ToolGroup`; pure activity model partition child theo offset và UI chỉ bọc những child assistant-ui đã render. Timing chỉ đọc timestamp hiện có, không bổ sung hoặc suy đoán dữ liệu.

**Tech Stack:** React 19, TypeScript strict, assistant-ui, Vitest, Testing Library, Bun.

## Global Constraints

- Chỉ sửa web presentation và web tests; không sửa `shared`, `cli`, `hub`, API, database, schema, reducer hoặc persistence.
- Mỗi `ChatBlock` phải render đúng một lần, đúng thứ tự; không tạo synthetic `ChatBlock`.
- Group chỉ có khi tối thiểu hai activity hợp lệ liền kề; text và special card luôn là boundary.
- Group `width: 100%`, `max-width: 600px`; output mở rộng `max-height: 300px` và scroll hai chiều.
- Header trái chỉ có count + trạng thái; bên phải chỉ có exact total duration khi tính được; không title summary, badge phụ hoặc status dot.
- Generic reasoning không có duration; tool và `CodexReasoning` chỉ dùng exact timestamps hiện có.
- Không thêm dependency; mọi system label dùng `en`, `vi-VN`, `zh-CN` dictionaries.
- TDD bắt buộc: test phải fail đúng lý do trước khi sửa production code.

---

### Task 1: Collision-safe HapiReasoning presentation adapter

**Files:**
- Create: `web/src/lib/reasoningPart.ts`
- Create: `web/src/components/AssistantChat/messages/ReasoningMessagePart.tsx`
- Create: `web/src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx`
- Modify: `web/src/lib/assistant-runtime.ts`
- Modify: `web/src/lib/assistant-runtime.test.ts`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.tsx`
- Modify: `web/src/components/AssistantChat/messages/assistantCopyText.test.ts`

**Interfaces:**
- Produces: `REASONING_TOOL_NAME = 'HapiReasoning'`.
- Produces: `reasoningToolCallId(blockId: string): string` returning `reasoning:${blockId}`.
- Produces: `isAgentReasoningBlock(value: unknown): value is AgentReasoningBlock`.
- Produces: `ReasoningMessagePart(props: ToolCallMessagePartProps)`; valid pseudo artifact renders `ReasoningDisclosure`, invalid/collision artifact delegates once to `HappyToolMessage`.

- [ ] **Step 1: Write failing adapter tests**

Add assertions that `toThreadMessageLike(agentReasoning)` returns an assistant message with stable message ID `assistant:reason-1` and one tool-call part:

```ts
expect(message).toEqual(expect.objectContaining({
    role: 'assistant',
    id: 'assistant:reason-1',
    content: [expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'reasoning:reason-1',
        toolName: REASONING_TOOL_NAME,
        argsText: '',
        result: 'reasoning body',
        artifact: reasoning
    })]
}))
```

Extend copy regression with a `HapiReasoning` tool-call and assert only `text` parts are copied.

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```bash
cd web && bun run test src/lib/assistant-runtime.test.ts src/components/AssistantChat/messages/assistantCopyText.test.ts
```

Expected: FAIL because `agent-reasoning` is still a native reasoning part and `REASONING_TOOL_NAME` does not exist.

- [ ] **Step 3: Implement the strict adapter helper and conversion**

Create the helper with strict structural checks:

```ts
export const REASONING_TOOL_NAME = 'HapiReasoning' as const

export function reasoningToolCallId(blockId: string): string {
    return `reasoning:${blockId}`
}

export function isAgentReasoningBlock(value: unknown): value is AgentReasoningBlock {
    return isObject(value)
        && value.kind === 'agent-reasoning'
        && typeof value.id === 'string'
        && (value.localId === null || typeof value.localId === 'string')
        && typeof value.createdAt === 'number'
        && Number.isFinite(value.createdAt)
        && typeof value.text === 'string'
}
```

Change only the `agent-reasoning` branch of `toThreadMessageLike` to emit the stable pseudo tool-call while preserving the original block in `artifact`.

- [ ] **Step 4: Write failing renderer collision tests**

Test three cases:

1. Valid artifact + matching `toolCallId` renders its full reasoning text through `ReasoningDisclosure`.
2. Provider tool genuinely named `HapiReasoning` with `ToolCallBlock` artifact renders `HappyToolMessage` exactly once.
3. `agent-reasoning` artifact with mismatched `toolCallId` falls back exactly once and does not get `data-hapi-reasoning`.

- [ ] **Step 5: Run renderer tests and verify RED**

Run:

```bash
cd web && bun run test src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx
```

Expected: FAIL because the renderer is not registered.

- [ ] **Step 6: Implement and register renderer**

Renderer acceptance guard:

```ts
const valid = isAgentReasoningBlock(props.artifact)
    && props.toolCallId === reasoningToolCallId(props.artifact.id)

if (!valid) return <HappyToolMessage {...props} />
```

Register `[REASONING_TOOL_NAME]: ReasoningMessagePart` beside `HapiCliOutput` in `AssistantMessage.tsx`. Determine streaming only when this tool-call is the final content part of a running assistant message; earlier reasoning must remain completed.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
cd web && bun run test src/lib/assistant-runtime.test.ts src/components/AssistantChat/messages/assistantCopyText.test.ts src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx
```

Expected: all focused tests PASS.

Commit:

```bash
git add web/src/lib/reasoningPart.ts web/src/lib/assistant-runtime.ts web/src/lib/assistant-runtime.test.ts web/src/components/AssistantChat/messages/ReasoningMessagePart.tsx web/src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx web/src/components/AssistantChat/messages/AssistantMessage.tsx web/src/components/AssistantChat/messages/assistantCopyText.test.ts
git commit -m "feat(web): adapt reasoning into activity parts"
```

---

### Task 2: Pure activity partition and exact timing model

**Files:**
- Modify: `web/src/components/ToolCard/toolRunModel.ts`
- Modify: `web/src/components/ToolCard/toolRunModel.test.ts`

**Interfaces:**
- Consumes: `isAgentReasoningBlock` from Task 1.
- Produces: `ActivityEntry = { kind: 'reasoning'; block; isStreaming } | { kind: 'tool'; block }`.
- Produces: `partitionActivityParts(parts)` returning offset-preserving `group`/`single` segments.
- Produces: `isActivityRunning(entry)`, `getActivityDurationMs(entry, now)`, `getActivityGroupDurationMs(entries)`, `formatActivityDuration(ms)`.

- [ ] **Step 1: Replace tool-only model tests with failing activity tests**

Add exact allowlist coverage for generic reasoning, `CodexReasoning`, `Read`, `Grep`, `Glob`, `Bash`, `CodexBash`, `CodexPatch`, `CodexDiff`.

Add boundary cases for text-like/null artifact, plan/Todo/ExitPlanMode, permission, error, children, Task/Agent/Skill, MCP/unknown, `HapiCliOutput`, malformed `HapiReasoning` and provider collision.

Add an offset case that must produce:

```text
group(reasoning, Read) → single(update_plan) → group(CodexBash, CodexDiff)
```

and assert every input offset occurs exactly once.

- [ ] **Step 2: Run model tests and verify RED**

Run:

```bash
cd web && bun run test src/components/ToolCard/toolRunModel.test.ts
```

Expected: FAIL because the current model accepts only tool artifacts and excludes `CodexReasoning`.

- [ ] **Step 3: Implement minimal activity model**

The part input includes presentation-only state:

```ts
export type ActivityPart = {
    type?: string
    toolCallId?: string
    artifact?: unknown
    isFinalRunningPart?: boolean
}
```

Only a strict valid pseudo reasoning with matching stable tool-call ID becomes a reasoning entry. Group IDs use `activity-group:${first.block.id}`. Non-members flush the current run and become a single segment at their original offset.

- [ ] **Step 4: Write failing exact timing tests**

Cover:

- completed tool: `2000 - 1000 = 1000`;
- running tool: `now - startedAt`, then completed freezes at `completedAt`;
- generic reasoning: no item duration;
- group total: exactly `last.completedAt - first.startedAt`, even when a middle activity starts earlier or completes later;
- generic reasoning in the middle preserves total; generic reasoning at either edge hides total;
- group running hides total;
- `null`, `NaN`, infinity, negative, or completion-before-start hides duration;
- format: `0 => 0.0s`, positive `<100ms => <0.1s`, `700 => 0.7s`, `12400 => 12.4s`.

- [ ] **Step 5: Run timing tests and verify RED**

Run the same model test command. Expected: FAIL because current timing uses min/max across all tool blocks and integer formatting lives in UI.

- [ ] **Step 6: Implement timing helpers and run GREEN**

Use exact timestamps only. Do not fall back to `createdAt`. `getActivityGroupDurationMs` returns `null` when any entry is running or when the first/last entry lacks trustworthy boundary timestamps.

Run:

```bash
cd web && bun run test src/components/ToolCard/toolRunModel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ToolCard/toolRunModel.ts web/src/components/ToolCard/toolRunModel.test.ts
git commit -m "feat(web): model reasoning tool activity runs"
```

---

### Task 3: Approved activity-group UI, row timing, i18n and accessibility

**Files:**
- Modify: `web/src/components/ToolCard/ToolRunGroup.tsx`
- Modify: `web/src/components/ToolCard/ToolRunGroup.test.tsx`
- Modify: `web/src/components/ToolCard/toolRunContext.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx`
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx`
- Modify: `web/src/components/AssistantChat/messages/ReasoningMessagePart.tsx`
- Modify: `web/src/components/assistant-ui/reasoning.tsx`
- Modify: `web/src/components/assistant-ui/reasoning.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Consumes: Task 2 activity segments/timing formatters.
- Produces: `ToolRunLayoutProvider` context containing `grouped: true` and one shared `now` clock for running row durations.
- Extends: `ReasoningDisclosure` with group-row presentation and optional exact duration while preserving standalone behavior.

- [ ] **Step 1: Write failing group header and boundary UI tests**

Assert:

- reasoning + terminal + diff + reasoning + patch creates one group of five in original child order;
- completed group mounts closed; running group mounts open; running → completed does not auto-close;
- header contains only translated count/status at left and exact total at right;
- header has no joined title summary, duration badge class, status dot or timestamp;
- a boundary inside the assistant-ui range renders once between two valid segments;
- group has `w-full max-w-[600px]` and body children retain one render each.

- [ ] **Step 2: Run group tests and verify RED**

Run:

```bash
cd web && bun run test src/components/ToolCard/ToolRunGroup.test.tsx
```

Expected: FAIL because the current header is tool-only and still renders title summary, badge and status dot.

- [ ] **Step 3: Implement activity group wrapper**

Use `partitionActivityParts`. Derive `isFinalRunningPart` only when the absolute content offset is the final message part and message status is running. Pass a single live `now` value through layout context. Keep `hidden={!open}`, `aria-expanded`, `aria-controls`, keyboard-native button semantics and focus-visible ring.

- [ ] **Step 4: Write failing per-row duration and reasoning disclosure tests**

Assert group-row order:

```text
title/subtitle → optional duration → status → optional output control
```

Verify completed and running tool durations, no placeholder for missing duration, no output chevron for no-output tools, full-width expanded Terminal/Diff with `max-h-[300px] overflow-auto`, and `CodexPatch` file summary retained.

For grouped reasoning, assert full-width borderless disclosure, generic reasoning has no duration, `CodexReasoning` shows exact duration, and completed/running status is accessible without nested buttons.

- [ ] **Step 5: Run row/disclosure tests and verify RED**

Run:

```bash
cd web && bun run test src/components/ToolCard/ToolCard.test.tsx src/components/assistant-ui/reasoning.test.tsx src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx
```

Expected: FAIL because row duration and grouped reasoning layout do not exist.

- [ ] **Step 6: Implement row timing, reasoning layout and dictionaries**

Replace tool-only group labels with these semantic keys in all three locales:

```text
tool.group.activitiesCompleted
tool.group.activitiesRunning
tool.group.toggleActivities
tool.group.activityDuration
tool.group.totalDuration
```

Visible duration remains compact (`4.6s`); `aria-label` distinguishes activity duration from group total. Provider titles remain untranslated. Keep output controls as sibling buttons, never nested inside another button.

- [ ] **Step 7: Run focused UI tests and commit**

Run:

```bash
cd web && bun run test src/components/ToolCard/ToolRunGroup.test.tsx src/components/ToolCard/ToolCard.test.tsx src/components/assistant-ui/reasoning.test.tsx src/components/AssistantChat/messages/ReasoningMessagePart.test.tsx
```

Expected: all focused tests PASS.

Commit:

```bash
git add web/src/components/ToolCard/ToolRunGroup.tsx web/src/components/ToolCard/ToolRunGroup.test.tsx web/src/components/ToolCard/toolRunContext.tsx web/src/components/ToolCard/ToolCard.tsx web/src/components/ToolCard/ToolCard.test.tsx web/src/components/AssistantChat/messages/ToolMessage.tsx web/src/components/AssistantChat/messages/ReasoningMessagePart.tsx web/src/components/assistant-ui/reasoning.tsx web/src/components/assistant-ui/reasoning.test.tsx web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): render approved activity groups"
```

---

### Task 4: Actual-runtime stream fidelity and release gates

**Files:**
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx`

**Interfaces:**
- Consumes: final adapter, model and UI from Tasks 1–3 through `useHappyRuntime`.
- Produces: end-to-end regression evidence for ordering, grouping, boundaries, streaming and collision safety.

- [ ] **Step 1: Write actual-runtime acceptance tests**

Using real `RuntimeHarness`, cover:

1. `generic reasoning → CodexReasoning → CodexBash → CodexDiff → CodexPatch` becomes one five-activity group.
2. Every original block marker/ID appears once and in input order; text remains outside the group.
3. Each boundary type splits groups without moving or dropping itself.
4. Singleton → group append, running → completed, late error, late permission, late children, pagination prepend and remount preserve content.
5. Generic reasoning before a newer tool is not still marked streaming.
6. Provider `HapiReasoning` collision and malformed pseudo artifact fall back once.
7. Copy text excludes reasoning; no blank assistant message appears.

- [ ] **Step 2: Run actual-runtime tests**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
```

Expected: PASS. If a case fails, stop and correct the responsible task code under a new failing focused test before rerunning this suite.

- [ ] **Step 3: Run full web verification**

```bash
bun run test:web
bun run typecheck:web
bun run build:web
git diff --check main...HEAD
```

Expected: 0 test failures, typecheck exit 0, production build exit 0, diff check exit 0.

- [ ] **Step 4: Review scope and commit integration evidence**

Confirm `git diff --name-only main...HEAD` contains only `web/` presentation/tests and approved `docs/superpowers/` artifacts. No `shared/`, `cli/`, `hub/`, lockfile or dependency changes.

```bash
git add web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
git commit -m "test(web): verify activity grouping stream fidelity"
```

## Review Findings

- [x] [Review][Patch] Accessible duration still exposes compact English text instead of locale-aware spoken duration [web/src/components/ToolCard/ToolRunGroup.tsx:92]
- [x] [Review][Patch] Allowlisted singleton tools and standalone CodexReasoning omit exact per-activity duration [web/src/components/AssistantChat/messages/ToolMessage.tsx:219]
- [x] [Review][Patch] Group total incorrectly requires last.startedAt instead of using only first.startedAt and last.completedAt [web/src/components/ToolCard/toolRunModel.ts:234]
- [x] [Review][Patch] Expanded reasoning longer than 5000px is clipped, violating lossless display [web/src/components/assistant-ui/reasoning.tsx:131]
- [x] [Review][Patch] Actual-runtime coverage still needs the pseudo-reasoning stream/append/completion lifecycle and multi-tick duration freeze cases [web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx:496]
