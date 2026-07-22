# Session Tool Blocks Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the special blocks inside a HAPI session conversation to match the approved Agent Mode prototype while preserving all message, tool, diff, and permission behavior.

**Architecture:** Keep the existing `ToolCallBlock → getToolPresentation → ToolCard → view/footer` pipeline. Store neutral/plan/diff tone metadata in the existing tool registry, let pending permission override that tone directly in `ToolCard`, and reuse `diff.parsePatch()` for diff summaries; do not add a parallel renderer, surface-policy module, artifact design system, or visual-fixture route.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS 4, Radix Dialog, assistant-ui, `diff@8`, Vitest, Testing Library, Bun workspaces.

**Design source:** `docs/superpowers/specs/2026-07-17-session-tool-blocks-visual-refresh-design.md` and approved Agent Mode prototype version 4.

## Global Constraints

- Presentation-only: no shared schema, normalized message, SSE, REST, RPC, database, permission payload, or mutation sequencing changes.
- Touch only session reasoning/tool-block components, focused views/tests, three existing locale dictionaries for new copy, and narrowly-scoped theme tokens.
- Preserve every permission option, callback, loading guard, disabled state, haptic, error message, and `onDone` call.
- Preserve ToolCard dialogs, Task child nesting, trace access, streaming state, elapsed time, and provider-specific tool support.
- Light and dark themes use the same component structure.
- Permission approval stays neutral blue with explicit white foreground and at least 4.5:1 contrast.
- No new dependency, Storybook, demo route, Playwright framework, message grouping, or generic UI primitive refactor.
- TDD for each changed contract; 4-space indentation; TypeScript strict.

## Change map

| File/area | Responsibility | Change | Risk |
|---|---|---|---|
| `web/src/components/ToolCard/knownTools.tsx` | Existing presentation registry | Add tone metadata only | Yellow: all providers use it |
| `web/src/components/ToolCard/ToolCard.tsx` | Shared shell/dialog | Apply hierarchy, action label, permission override/lock icon | Yellow |
| `web/src/components/ToolCard/PermissionFooter.tsx` | Security-sensitive actions | Restyle only; retain all branches/payloads | Red |
| `web/src/components/assistant-ui/reasoning.tsx` | Reasoning disclosure | Bordered surface and reduced motion | Green |
| `web/src/components/ToolCard/checklist.tsx` and `views/UpdatePlanView.tsx` | Plan artifact | Progress and bounded inline preview | Green |
| `web/src/components/ToolCard/views/CodexDiffView.tsx` | Diff artifact | `parsePatch()` summary and bounded rows | Yellow |
| `web/src/index.css` | Theme tokens | Tool surface and permission-primary tokens | Yellow: additions only |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | Existing i18n | New block labels/count strings only | Green |
| Focused tests | Regression evidence | Tone, payloads, contrast, disclosure, plan, diff | Green |

**Explicitly untouched:** `SessionList`, dashboard/pins, `SessionHeader`, `SessionChat`, composer, routes, Mermaid, `DiffView`, generic `Card/Button/Dialog`, hub, CLI, shared packages.

---

### Task 1: Add artifact tones to the existing registry and ToolCard shell

**Files:**
- Modify: `web/src/components/ToolCard/knownTools.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/ToolCard/icons.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`
- Create: `web/src/components/ToolCard/ToolCard.test.tsx`
- Create: `web/src/components/ToolCard/permissionTheme.test.ts`

**Interfaces:**
- Extends `ToolPresentation` with `tone: 'neutral' | 'plan' | 'diff'`.
- `ToolCard` emits `data-tool-surface="neutral|plan|diff|permission"` for semantic inspection; no `data-testid` is added to production.
- Pending approval overrides registry tone inline, but question/answer tools retain their current question treatment.
- Produces localized `tool.details`, `tool.openPlan`, `tool.reviewDiff`, and `tool.permissionRequired` strings.

- [ ] **Step 0: Record the implementation baseline**

```bash
git rev-parse HEAD > /tmp/hapi-session-tool-blocks-visual-refresh.base
test -s /tmp/hapi-session-tool-blocks-visual-refresh.base
```

Expected: the file contains the branch HEAD before production-code edits.

- [ ] **Step 1: Write failing tone/shell tests**

In `ToolCard.test.tsx`, build real `ToolCallBlock` fixtures for `Read`, `update_plan`, `CodexDiff`, pending `Write`, and pending `AskUserQuestion`; mock the three footer bodies (`PermissionFooter`, `AskUserQuestionFooter`, `RequestUserInputFooter`) so the shared shell is isolated.

Define the test scaffolding in that file (imports omitted here only where already present in the test):

```tsx
const oneFileDiff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
const pendingPermission = { id: 'permission-1', status: 'pending' } satisfies ToolPermission
const api = {} as ApiClient

vi.mock('@/components/ToolCard/PermissionFooter', () => ({ PermissionFooter: () => null }))
vi.mock('@/components/ToolCard/AskUserQuestionFooter', () => ({ AskUserQuestionFooter: () => null }))
vi.mock('@/components/ToolCard/RequestUserInputFooter', () => ({ RequestUserInputFooter: () => null }))

function makeToolBlock(
    name: string,
    input: unknown = {},
    permission?: ToolPermission
): ToolCallBlock {
    return {
        kind: 'tool-call', id: `block-${name}`, localId: null, createdAt: 1, children: [],
        tool: {
            id: `tool-${name}`, name, input, state: 'completed', createdAt: 1,
            startedAt: 1, completedAt: 2, description: null, result: null, permission
        }
    }
}

function toolCardElement(block: ToolCallBlock) {
    return (
        <I18nProvider>
            <ToolCard api={api} sessionId="session-1" metadata={null} disabled={false} onDone={vi.fn()} block={block} />
        </I18nProvider>
    )
}

function renderTool(block: ToolCallBlock) {
    localStorage.setItem('hapi-lang', 'en')
    return render(toolCardElement(block))
}
```

Required assertions:

```tsx
it.each([
    ['Read', 'neutral'],
    ['mcp__server__tool', 'neutral'],
    ['update_plan', 'plan'],
    ['TodoWrite', 'plan'],
    ['ExitPlanMode', 'plan'],
    ['exit_plan_mode', 'plan'],
    ['CodexDiff', 'diff'],
    ['CodexPatch', 'diff'],
    ['Edit', 'diff'],
    ['MultiEdit', 'diff'],
    ['Write', 'diff'],
    ['NotebookEdit', 'diff']
] as const)('maps %s to %s', (toolName, expectedTone) => {
    const presentation = getToolPresentation({
        toolName,
        input: {},
        result: null,
        childrenCount: 0,
        description: null,
        metadata: null
    })
    expect(presentation.tone).toBe(expectedTone)
})

it('lets pending permission override the diff tone', () => {
    const { container } = renderTool(makeToolBlock('Write', {}, pendingPermission))
    expect(container.querySelector('[data-tool-surface="permission"]')).not.toBeNull()
})

it('keeps routine tools compact but visibly interactive', () => {
    const { container } = renderTool(makeToolBlock('Read'))
    const card = container.querySelector('[data-tool-surface="neutral"]')
    expect(card).toHaveClass('bg-transparent')
    expect(screen.getByRole('button', { name: /read/i })).toHaveClass('hover:bg-[var(--app-subtle-bg)]')
})

it('shows explicit artifact actions', () => {
    const { rerender } = renderTool(makeToolBlock('update_plan', { plan: [{ step: 'Ship', status: 'pending' }] }))
    expect(screen.getByText('Open plan')).toBeInTheDocument()
    rerender(toolCardElement(makeToolBlock('CodexDiff', { unified_diff: oneFileDiff })))
    expect(screen.getByText('Review diff')).toBeInTheDocument()
})

it('uses permission heading and lock icon for pending permission', () => {
    renderTool(makeToolBlock('Write', {}, pendingPermission))
    const heading = screen.getByText('Permission required')
    expect(heading.parentElement?.querySelector('svg')).not.toBeNull()
})

it.each(['AskUserQuestion', 'request_user_input'])(
    'does not mislabel pending %s as a security permission',
    (name) => {
        const { container } = renderTool(makeToolBlock(name, { questions: [] }, pendingPermission))
        expect(container.querySelector('[data-tool-surface="neutral"]')).not.toBeNull()
        expect(screen.queryByText('Permission required')).not.toBeInTheDocument()
    }
)
```

- [ ] **Step 2: Run and verify RED**

```bash
cd web && bun run test src/components/ToolCard/ToolCard.test.tsx
```

Expected: FAIL because `tone`, explicit actions, permission heading/icon, and surface attributes do not exist.

- [ ] **Step 3: Add tone metadata in `knownTools.tsx` without a new policy module**

```ts
export type ToolSurfaceTone = 'neutral' | 'plan' | 'diff'

export type ToolPresentation = {
    icon: ReactNode
    title: string
    subtitle: string | null
    minimal: boolean
    tone: ToolSurfaceTone
}

const PLAN_TOOLS = new Set(['update_plan', 'TodoWrite', 'ExitPlanMode', 'exit_plan_mode'])
const DIFF_TOOLS = new Set(['CodexDiff', 'CodexPatch', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function getToolSurfaceTone(toolName: string): ToolSurfaceTone {
    if (PLAN_TOOLS.has(toolName)) return 'plan'
    if (DIFF_TOOLS.has(toolName)) return 'diff'
    return 'neutral'
}
```

Add `tone: getToolSurfaceTone(opts.toolName)` to the MCP, known-tool, and unknown-tool return objects in `getToolPresentation`.

- [ ] **Step 4: Add the lock icon and apply the shell hierarchy**

Add `LockIcon` to `icons.tsx` using the existing `createIcon` helper; no icon dependency:

```tsx
export function LockIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>,
        props
    )
}
```

In `ToolCard.tsx`, compute the override after the existing `isQuestionTool` declaration:

```ts
const hasPendingApproval = permission?.status === 'pending' && !isQuestionTool
const surfaceTone = hasPendingApproval ? 'permission' : presentation.tone
const actionLabel = surfaceTone === 'plan'
    ? t('tool.openPlan')
    : surfaceTone === 'diff'
        ? t('tool.reviewDiff')
        : t('tool.details')

const SURFACE_CLASS = {
    neutral: 'border-transparent bg-transparent shadow-none',
    plan: 'border-[var(--app-tool-plan-border)] bg-[var(--app-secondary-bg)]',
    diff: 'border-[var(--app-tool-diff-border)] bg-[var(--app-secondary-bg)]',
    permission: 'border-[var(--app-tool-attention-border)] bg-[var(--app-tool-attention-bg)]'
} as const
```

Apply `data-tool-surface={surfaceTone}` to `Card`. Add `rounded-md px-1.5 py-1 hover:bg-[var(--app-subtle-bg)]` to the existing dialog trigger. For non-neutral tones, render the icon in a 28px rounded badge; for permission, wrap `LockIcon` in `<span aria-hidden="true" className="text-[var(--app-tool-attention-accent)]">` and show `t('tool.permissionRequired')` beside the unchanged tool title. Show `actionLabel` beside the existing chevron for plan/diff, and keep it screen-reader-only for neutral tools. Do not move the dialog, body, Task summary, trace, or footer.

- [ ] **Step 5: Add only the new locale keys**

```ts
// en.ts
'tool.details': 'Details',
'tool.openPlan': 'Open plan',
'tool.reviewDiff': 'Review diff',
'tool.permissionRequired': 'Permission required',

// vi-VN.ts
'tool.details': 'Chi tiết',
'tool.openPlan': 'Mở kế hoạch',
'tool.reviewDiff': 'Xem thay đổi',
'tool.permissionRequired': 'Cần cấp quyền',

// zh-CN.ts
'tool.details': '详情',
'tool.openPlan': '打开计划',
'tool.reviewDiff': '查看差异',
'tool.permissionRequired': '需要授权',
```

In `ToolCard.test.tsx`, import the three locale objects and assert that each of these four keys is a non-empty string in English, Vietnamese, and Chinese. This checks locale completeness without adding a new locale test framework.

- [ ] **Step 6: Add isolated theme tokens and contrast regression**

Add these exact light tokens to `:root`:

```css
--app-tool-plan-accent: #7c3fc5;
--app-tool-plan-border: rgba(124, 63, 197, 0.42);
--app-tool-diff-accent: #168344;
--app-tool-diff-border: rgba(22, 131, 68, 0.38);
--app-tool-attention-bg: rgba(166, 95, 0, 0.07);
--app-tool-attention-border: rgba(166, 95, 0, 0.48);
--app-tool-attention-accent: #a65f00;
--app-primary-action-bg: #2867df;
--app-primary-action-bg-hover: #225fc8;
--app-primary-action-text: #ffffff;
```

Add these exact overrides to `[data-theme="dark"]` (the stable primary action is intentionally repeated):

```css
--app-tool-plan-accent: #bf5af2;
--app-tool-plan-border: rgba(191, 90, 242, 0.42);
--app-tool-diff-accent: #30d158;
--app-tool-diff-border: rgba(48, 209, 88, 0.36);
--app-tool-attention-bg: rgba(255, 214, 10, 0.06);
--app-tool-attention-border: rgba(255, 214, 10, 0.42);
--app-tool-attention-accent: #ffd60a;
--app-primary-action-bg: #2867df;
--app-primary-action-bg-hover: #225fc8;
--app-primary-action-text: #ffffff;
```

In `permissionTheme.test.ts`, read `index.css`, extract only the three hex primary-action tokens from `:root` and `[data-theme="dark"]`, calculate standard sRGB relative luminance, and assert normal and hover contrast against text are each `>= 4.5`. Keep the helpers private to this test; do not build a generic CSS parser or add a dependency.

- [ ] **Step 7: Verify and commit**

```bash
cd web
bun run test src/components/ToolCard/ToolCard.test.tsx src/components/ToolCard/permissionTheme.test.ts src/components/ToolCard/checklist.test.tsx src/components/ToolCard/trace.test.tsx
bun run typecheck
cd ..
git add web/src/index.css web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts web/src/components/ToolCard/knownTools.tsx web/src/components/ToolCard/ToolCard.tsx web/src/components/ToolCard/icons.tsx web/src/components/ToolCard/ToolCard.test.tsx web/src/components/ToolCard/permissionTheme.test.ts
git commit -m "feat(web): refresh session tool artifact hierarchy"
```

Expected: focused tests PASS, typecheck exits 0, and the commit contains no session-layout/backend files.

---

### Task 2: Restyle permission actions and lock every existing payload

**Files:**
- Modify: `web/src/components/ToolCard/PermissionFooter.tsx`
- Create: `web/src/components/ToolCard/PermissionFooter.test.tsx`

**Interfaces:**
- Preserves all current branches: approve, deny, allow all edits, allow for session, Codex approve, Codex approve for session, Codex abort.
- Preserves all `ApiClient` argument shapes.

- [ ] **Step 1: Write failing visual and payload tests**

Use a `makePendingTool(name, input)` fixture, mock `usePlatform` haptics and translations, and use `fireEvent`/`waitFor` already installed. Required payload matrix:

```ts
function makePendingTool(name: string, input: unknown): ChatToolCall {
    return {
        id: `tool-${name}`,
        name,
        state: 'pending',
        input,
        createdAt: 1,
        startedAt: null,
        completedAt: null,
        description: null,
        result: null,
        permission: { id: 'permission-1', status: 'pending' }
    }
}

type PermissionCase = {
    label: string
    tool: ChatToolCall
    expectedMethod: 'approvePermission' | 'denyPermission'
    expectedArgs: unknown[]
}

const cases: PermissionCase[] = [
    {
        label: 'Allow',
        tool: makePendingTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1']
    },
    {
        label: 'Allow all edits',
        tool: makePendingTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', 'acceptEdits']
    },
    {
        label: 'Allow for session',
        tool: makePendingTool('Read', { file_path: '/repo/a.ts' }),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { allowTools: ['Read'] }]
    },
    {
        label: 'Deny',
        tool: makePendingTool('Write', { file_path: '/repo/a.ts' }),
        expectedMethod: 'denyPermission',
        expectedArgs: ['session-1', 'permission-1']
    },
    {
        label: 'Yes',
        tool: makePendingTool('CodexPermission', {}),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'approved' }]
    },
    {
        label: 'Yes for session',
        tool: makePendingTool('CodexPermission', {}),
        expectedMethod: 'approvePermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'approved_for_session' }]
    },
    {
        label: 'Abort',
        tool: makePendingTool('CodexPermission', {}),
        expectedMethod: 'denyPermission',
        expectedArgs: ['session-1', 'permission-1', { decision: 'abort' }]
    }
]
```

Run each case in an isolated render, click by accessible label, wait for the matching mock, and assert exact arguments. Add a separate Bash case proving session approval uses `{ allowTools: ['Bash(bun test)'] }`.

Visual assertions:

```tsx
expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass(
    'bg-[var(--app-primary-action-bg)]',
    'text-[var(--app-primary-action-text)]'
)
expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass(
    'border-[var(--app-border)]',
    'text-[var(--app-badge-error-text)]'
)
```

Retain tests for loading disabling all visible actions, API rejection text, haptic call, and `onDone` after success. Assert rejection and denied-reason text use `text-[var(--app-badge-error-text)]` rather than a fixed red.

- [ ] **Step 2: Run and verify RED**

```bash
cd web && bun run test src/components/ToolCard/PermissionFooter.test.tsx
```

Expected: visual assertions FAIL; payload assertions establish the behavior that must remain green after styling.

- [ ] **Step 3: Change only button classes and action layout**

Keep `approve`, `approveAllEdits`, `approveForSession`, `deny`, `codexApprove`, and `codexAbort` logic unchanged.

```ts
const base = 'inline-flex min-h-9 min-w-[8rem] flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
const tone = props.tone === 'allow'
    ? 'border border-[var(--app-primary-action-bg)] bg-[var(--app-primary-action-bg)] text-[var(--app-primary-action-text)] hover:bg-[var(--app-primary-action-bg-hover)]'
    : props.tone === 'deny'
        ? 'border border-[var(--app-border)] bg-transparent text-[var(--app-badge-error-text)] hover:bg-[var(--app-subtle-bg)]'
        : 'border border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
```

Keep label and spinner children; the retained `inline-flex items-center justify-center gap-2` prevents alignment regression. Change only the action container to `mt-3 flex flex-wrap gap-2` so 360–390px screens wrap without overflow. Replace the two fixed `text-red-600` error/reason classes in this component with `text-[var(--app-badge-error-text)]`; do not change error handling.

- [ ] **Step 4: Verify and commit**

```bash
cd web
bun run test src/components/ToolCard/PermissionFooter.test.tsx src/components/ToolCard/permissionTheme.test.ts src/components/ToolCard/ToolCard.test.tsx
bun run typecheck
cd ..
git add web/src/components/ToolCard/PermissionFooter.tsx web/src/components/ToolCard/PermissionFooter.test.tsx
git commit -m "feat(web): polish session permission actions"
```

Expected: every payload case PASS, all loading/error tests PASS, typecheck exits 0.

---

### Task 3: Restyle Reasoning with an actual reduced-motion contract

**Files:**
- Modify: `web/src/components/assistant-ui/reasoning.tsx`
- Create: `web/src/components/assistant-ui/reasoning.test.tsx`

**Interfaces:**
- Preserves collapsed-by-default and auto-open-while-streaming behavior.
- Adds `aria-expanded` to the existing semantic button.
- Disables disclosure transitions under reduced-motion without global CSS changes.

- [ ] **Step 1: Write failing disclosure tests**

Mock only `useMessage` from assistant-ui:

```ts
const useMessageMock = vi.fn()
vi.mock('@assistant-ui/react', () => ({ useMessage: () => useMessageMock() }))

function mockMessage(value: { status: { type: string }; content: Array<{ type: string; text?: string }> }) {
    useMessageMock.mockReturnValue(value)
}
```

Then test:

```tsx
it('starts collapsed with the approved bordered toggle', () => {
    mockMessage({ status: { type: 'complete' }, content: [] })
    render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    const trigger = screen.getByRole('button', { name: /reasoning/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveClass('border-[var(--app-border)]')
})

it('opens from the button and auto-opens while streaming', async () => {
    mockMessage({ status: { type: 'running' }, content: [{ type: 'reasoning', text: '...' }] })
    render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    expect(await screen.findByRole('button', { name: /reasoning/i })).toHaveAttribute('aria-expanded', 'true')
})

it('disables transition for reduced motion', () => {
    mockMessage({ status: { type: 'complete' }, content: [] })
    const { container } = render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    expect(container.querySelector('.aui-reasoning-group [class*="motion-reduce:transition-none"]')).not.toBeNull()
})
```

- [ ] **Step 2: Run and verify RED**

```bash
cd web && bun run test src/components/assistant-ui/reasoning.test.tsx
```

Expected: bordered, `aria-expanded`, and reduced-motion assertions FAIL.

- [ ] **Step 3: Apply the existing prototype disclosure shape**

Keep the chevron, label, streaming dot, markdown body, and `isStreaming` effect. Add `aria-expanded={isOpen}` and these classes to the existing trigger:

```ts
'flex min-h-10 w-full items-center gap-2 rounded-md border border-[var(--app-border)]',
'bg-[var(--app-bg)] px-2.5 py-2 text-left text-xs font-medium',
'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
'transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
```

Add `motion-reduce:transition-none` to the existing animated content wrapper as well. Do not add another animation or change streaming state logic.

- [ ] **Step 4: Verify and commit**

```bash
cd web
bun run test src/components/assistant-ui/reasoning.test.tsx src/components/AssistantChat/messages/assistantCopyText.test.ts
bun run typecheck
cd ..
git add web/src/components/assistant-ui/reasoning.tsx web/src/components/assistant-ui/reasoning.test.tsx
git commit -m "feat(web): refine session reasoning disclosure"
```

Expected: tests PASS and typecheck exits 0.

---

### Task 4: Add bounded Plan and Diff artifact previews using existing parsers

**Files:**
- Modify: `web/src/components/ToolCard/checklist.tsx`
- Modify: `web/src/components/ToolCard/checklist.test.tsx`
- Modify: `web/src/components/ToolCard/views/UpdatePlanView.tsx`
- Modify: `web/src/components/ToolCard/views/_all.tsx`
- Modify: `web/src/components/ToolCard/views/CodexDiffView.tsx`
- Modify: `web/src/components/ToolCard/knownTools.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`
- Create: `web/src/components/ToolCard/views/CodexDiffView.test.tsx`

**Interfaces:**
- Produces `getChecklistProgress(items): { completed; total; percent }`.
- Inline plan: progress plus at most three rows; dialog: complete checklist.
- Produces `summarizeUnifiedDiff(unifiedDiff)` from `diff.parsePatch()`; inline diff: totals plus at most three files; dialog: existing `DiffView`.
- Adds localized `tool.planProgress`, `tool.stepsProgress`, `tool.moreItems`, and `tool.moreFiles` strings.

- [ ] **Step 1: Write failing plan tests**

Extend `checklist.test.tsx`:

```tsx
const fiveSteps = [
    { step: 'A', status: 'completed' },
    { step: 'B', status: 'completed' },
    { step: 'C', status: 'completed' },
    { step: 'D', status: 'in_progress' },
    { step: 'E', status: 'pending' }
]

expect(getChecklistProgress([
    { text: 'A', status: 'completed' },
    { text: 'B', status: 'completed' },
    { text: 'C', status: 'in_progress' }
])).toEqual({ completed: 2, total: 3, percent: 67 })

render(
    <I18nProvider>
        <UpdatePlanView block={makeUpdatePlanBlock({ plan: fiveSteps })} metadata={null} surface="inline" />
    </I18nProvider>
)
expect(screen.getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute('aria-valuenow', '60')
expect(screen.getByText('3 / 5 steps')).toBeInTheDocument()
expect(screen.getByText('+2 more')).toBeInTheDocument()
expect(screen.getAllByRole('listitem')).toHaveLength(3)
```

Render the dialog surface separately inside `I18nProvider` and assert five list items with no remainder label. Use semantic `role="list"`/`role="listitem"`; do not add production test IDs.

- [ ] **Step 2: Write failing `parsePatch()` summary tests**

In `CodexDiffView.test.tsx`, cover:

1. one file;
2. multiple files;
3. empty and malformed input returning an empty summary and a header-only ToolCard shell;
4. quoted/space-containing path as accepted by `parsePatch()`;
5. hunk content whose actual added/removed text begins with `++`/`--` (raw hunk lines begin `+++`/`---`) and must still count;
6. four files render only three inline list items plus localized remainder;
7. dialog surface still calls `DiffView` with `variant="inline"`.

Core parser expectation:

```ts
expect(summarizeUnifiedDiff(twoFileDiff)).toEqual({
    added: 3,
    removed: 2,
    files: [
        { path: 'src/a.ts', added: 2, removed: 1 },
        { path: 'src/b.ts', added: 1, removed: 1 }
    ]
})
```

- [ ] **Step 3: Run and verify RED**

```bash
cd web
bun run test src/components/ToolCard/checklist.test.tsx src/components/ToolCard/views/CodexDiffView.test.tsx
```

Expected: FAIL because progress/summary views do not exist.

- [ ] **Step 4: Implement Plan preview and reuse it in the dialog**

In `checklist.tsx`, keep extraction/status normalization and add:

```ts
export function getChecklistProgress(items: ChecklistItem[]) {
    const completed = items.filter((item) => item.status === 'completed').length
    const total = items.length
    return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}
```

Render `ChecklistList` as a semantic list. In `UpdatePlanView`, use `useTranslation`; dialog returns the full list, inline slices to three, renders a progress bar labelled by `t('tool.planProgress')`, count from `t('tool.stepsProgress', { completed, total })`, and remainder from `t('tool.moreItems', { count })`. Register `update_plan: UpdatePlanView` in `toolFullViewRegistry`.

- [ ] **Step 5: Implement Diff summary with installed `parsePatch()`**

```ts
import { parsePatch } from 'diff'

export type DiffFileSummary = { path: string; added: number; removed: number }
export type UnifiedDiffSummary = { added: number; removed: number; files: DiffFileSummary[] }

function displayPatchPath(oldFileName: string | undefined, newFileName: string | undefined): string | null {
    const path = newFileName === '/dev/null' ? oldFileName : newFileName
    return path ? path.replace(/^[ab]\//, '') : null
}

export function summarizeUnifiedDiff(unifiedDiff: string): UnifiedDiffSummary {
    try {
        const files = parsePatch(unifiedDiff).flatMap((patch) => {
            const path = displayPatchPath(patch.oldFileName, patch.newFileName)
            if (!path || patch.hunks.length === 0) return []
            let added = 0
            let removed = 0
            for (const hunk of patch.hunks) {
                for (const line of hunk.lines) {
                    if (line.startsWith('+')) added += 1
                    else if (line.startsWith('-')) removed += 1
                }
            }
            return [{ path, added, removed }]
        })
        return {
            added: files.reduce((total, file) => total + file.added, 0),
            removed: files.reduce((total, file) => total + file.removed, 0),
            files
        }
    } catch {
        return { added: 0, removed: 0, files: [] }
    }
}
```

Memoize the summary by `unified_diff`. Render totals and a semantic list of at most three files; use `--app-tool-diff-accent` for additions and `--app-badge-error-text` for removals. Use `t('tool.moreFiles', { count })` for remainder. If no parsed files, return `null`, leaving the existing ToolCard header as the safe generic fallback. Keep the existing `parseUnifiedDiff`, `CodexDiffFullView`, and `DiffView.tsx` unchanged: `parsePatch()` is only replacing the proposed hand-written summary parser, not changing dialog behavior.

Now that large diffs have a bounded summary, change only:

```ts
minimal: (opts) => !getInputStringAny(opts.input, ['unified_diff'])
```

- [ ] **Step 6: Add localized count strings only**

```ts
// en.ts
'tool.planProgress': 'Plan progress',
'tool.stepsProgress': '{completed} / {total} steps',
'tool.moreItems': '+{count} more',
'tool.moreFiles': '+{count} more files',

// vi-VN.ts
'tool.planProgress': 'Tiến độ kế hoạch',
'tool.stepsProgress': '{completed} / {total} bước',
'tool.moreItems': '+{count} mục khác',
'tool.moreFiles': '+{count} tệp khác',

// zh-CN.ts
'tool.planProgress': '计划进度',
'tool.stepsProgress': '{completed} / {total} 步',
'tool.moreItems': '另有 {count} 项',
'tool.moreFiles': '另有 {count} 个文件',
```

- [ ] **Step 7: Verify and commit**

```bash
cd web
bun run test src/components/ToolCard/checklist.test.tsx src/components/ToolCard/views/CodexDiffView.test.tsx src/components/ToolCard/ToolCard.test.tsx src/components/ToolCard/views/_results.test.tsx
bun run typecheck
cd ..
git add web/src/components/ToolCard/checklist.tsx web/src/components/ToolCard/checklist.test.tsx web/src/components/ToolCard/views/UpdatePlanView.tsx web/src/components/ToolCard/views/_all.tsx web/src/components/ToolCard/views/CodexDiffView.tsx web/src/components/ToolCard/views/CodexDiffView.test.tsx web/src/components/ToolCard/knownTools.tsx web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add bounded plan and diff previews"
```

Expected: plan/diff tests PASS, existing result tests PASS, typecheck exits 0.

---

### Task 5: Full regression, browser verification, and scope audit

**Files:**
- Modify only Task 1–4 files if a verified defect is found.
- Do not add Storybook, a demo route, generated fixture infrastructure, or unrelated app changes.

- [ ] **Step 1: Run focused regression tests together**

```bash
cd web
bun run test \
  src/components/ToolCard/ToolCard.test.tsx \
  src/components/ToolCard/permissionTheme.test.ts \
  src/components/ToolCard/PermissionFooter.test.tsx \
  src/components/ToolCard/checklist.test.tsx \
  src/components/ToolCard/trace.test.tsx \
  src/components/ToolCard/views/CodexDiffView.test.tsx \
  src/components/ToolCard/views/_results.test.tsx \
  src/components/assistant-ui/reasoning.test.tsx \
  src/components/AssistantChat/messages/assistantCopyText.test.ts
```

Expected: all selected files PASS, zero failed tests.

- [ ] **Step 2: Run complete web verification**

```bash
cd web
bun run test
bun run typecheck
bun run build
```

Expected: all web tests PASS, typecheck exits 0, Vite build exits 0.

- [ ] **Step 3: Verify the real session UI without adding a fixture system**

Start `bun run dev` from the repository root in a dedicated PTY/background execution session, wait for the hub/web readiness output, inspect with the available browser, then terminate that exact process with `Ctrl-C` after screenshots/checks.

Browser matrix:

1. Light desktop: Read/Bash, Reasoning, pending permission, Plan, Diff.
2. Dark desktop: same blocks and explicit readable foregrounds.
3. Width 360–390px: permission actions wrap; paths truncate; no horizontal overflow.
4. Keyboard: Reasoning, ToolCard details/action, Allow, Deny, dialog close.
5. Running/error/Nested Task: state/elapsed/trace/pending nested permission remain intact.
6. Large diff: bounded inline summary and unchanged full dialog.

Use existing real session states where available. For a state unavailable in the current session, use the focused Testing Library fixture already added for that component; do not create a runtime route or Storybook solely to manufacture it. Capture light desktop, dark desktop, and narrow-viewport screenshots for the states actually available.

- [ ] **Step 4: Audit scope from the recorded baseline**

HAPI is not indexed in GitNexus, so use Git diff evidence:

```bash
BASE_SHA=$(cat /tmp/hapi-session-tool-blocks-visual-refresh.base)
git status --short
git diff --name-only "$BASE_SHA"..HEAD
git diff --check "$BASE_SHA"..HEAD
git diff --stat "$BASE_SHA"..HEAD
```

Expected production paths: `web/src/index.css`, three existing locale files, `web/src/components/ToolCard/**`, and `web/src/components/assistant-ui/reasoning*`. Any hub/CLI/shared/session-layout/Mermaid/generic UI primitive change is scope drift.

- [ ] **Step 5: Final evidence checklist**

- Routine tools have lower emphasis but retain hover/focus affordance.
- Plan/Diff expose localized actions and bounded previews.
- Pending permission has attention surface, lock icon/heading, blue-white approval, theme-aware deny.
- All eight permission action/payload cases (including Bash session scope) pass.
- Reasoning preserves streaming behavior and honors reduced motion.
- Diff summary uses `parsePatch()` and counts `+++`/`---` hunk content correctly.
- Light/dark/mobile/keyboard checks completed in the available states.
- Full tests, typecheck, build, and scope diff pass.

If a corrective edit is required, first add a failing focused test, apply the smallest fix, rerun focused plus full verification, and commit only the corrected Task 1–4 files. Do not create an empty commit.

## Completion Criteria

The change is complete only when every RED test failed for the intended missing contract before implementation, all automated/browser evidence above is fresh, and Git diff proves the implementation remained presentation-only.
