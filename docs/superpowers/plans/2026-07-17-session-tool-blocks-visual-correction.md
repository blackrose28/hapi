# Session Tool Blocks Visual Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the approved Agent Mode prototype v4 hierarchy by grouping routine tool activity, keeping singleton neutral tools visibly contained, and making `Apply changes` a useful neutral mutation event rather than a duplicate diff artifact.

**Architecture:** Keep reducers, normalized `ChatBlock` data, storage, APIs, and provider events unchanged. Add a pure display grouping pass at the assistant runtime boundary, render grouped tools through a focused `RoutineActivityGroup`, and reuse `ToolCard`'s existing dialog through an activity-row presentation mode. Parse `CodexPatch` payloads only in the web presentation layer and keep `CodexDiff` as the consolidated review artifact.

**Tech Stack:** React 19, TypeScript strict, assistant-ui external runtime, Tailwind CSS 4, Radix Dialog, Vitest, Testing Library, Bun workspaces.

## Global Constraints

- Design source: `docs/superpowers/specs/2026-07-17-session-tool-blocks-visual-correction-design.md` and `/tmp/hapi-agent-mode-mockup` prototype version 4.
- Presentation-only: no changes to reducers, normalized `ChatBlock`, shared schemas, SQLite, SSE, REST, RPC, CLI events, permission payloads, or mutation sequencing.
- Preserve source tool order, identity, state, dialog content, trace access, nested Task behavior, and provider support.
- `CodexPatch` is neutral routine activity; `CodexDiff` remains the green review artifact.
- A singleton neutral tool must have a visible subtle surface; two or more consecutive eligible neutral tools form an Activity Group.
- Group boundaries: `CodexPermission`, any tool carrying permission metadata, questions, tasks, children, text, `agent-reasoning`, CLI output, system events, team mentions, plan, and diff artifacts break the run. `CodexReasoning` is a neutral routine tool and remains eligible.
- Activity Group opens by default and follows prototype v4's header, vertical rail, compact rows, hover, focus, and status hierarchy.
- Existing light/dark `--app-*` tokens only; no new dependency or generic artifact design system.
- TDD for each contract; 4-space indentation; focused commits; real-session visual gate before completion.

## Change Map

| File/area | Responsibility | Planned change | Risk |
|---|---|---|---|
| `web/src/components/ToolCard/activityGrouping.ts` | Pure display grouping | New display-only grouping and eligibility helpers | Medium: order/identity |
| `web/src/lib/assistant-runtime.ts` | `ChatBlock` → assistant-ui messages | Feed grouped display items and attach group metadata | Medium: shared chat renderer |
| `web/src/components/AssistantChat/messages/AssistantMessage.tsx` | Assistant message shell | Render group metadata through `RoutineActivityGroup` | Medium: message branching |
| `web/src/components/ToolCard/RoutineActivityGroup.tsx` | Prototype v4 routine activity UI | New disclosure, rail, rows | Low/medium: responsive UI |
| `web/src/components/ToolCard/ToolCard.tsx` | Tool dialog and card shell | Activity-row presentation mode; restore singleton neutral surface | Medium: every provider |
| `web/src/components/ToolCard/knownTools.tsx` | Tool presentation tone/copy | Remove `CodexPatch` from diff set; consume patch summary | Low |
| `web/src/components/ToolCard/codexPatch.ts` | Pure patch payload parser | Normalize array/record payloads without renderer import cycles | Low |
| `web/src/components/ToolCard/views/CodexPatchView.tsx` | Patch detail presentation | Parse array/record payloads and list files safely | Low |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | UI copy | Activity count and patch fallback labels | Low |
| Focused tests beside files | Regression contracts | Grouping, row dialog, patch payload, visual classes | Low |

## Preflight Impact Gate

GitNexus was checked while writing this plan on 2026-07-17; `/home/huynq/notebooks/hapi` was not present in `list_repos`, so no repository graph result can honestly be claimed yet.

Before production edits:

1. Re-run `mcp__gitnexus__list_repos`.
2. If HAPI is indexed, run upstream impact for `ToolCardInner`, `getToolPresentation`, `toThreadMessageLike`, and `HappyAssistantMessage`; add any direct consumers to focused regression tests.
3. If it is still unavailable, record that blocker and retain the manual import/call-chain evidence in this plan's Change Map; do not substitute a fabricated GitNexus result.
4. Before every implementation commit, run `mcp__gitnexus__detect_changes(scope: "all")` when the HAPI index is available. Review affected flows before committing.

## Task 1: Add the Pure Routine Activity Grouping Contract

**Files:**
- Create: `web/src/components/ToolCard/activityGrouping.ts`
- Create: `web/src/components/ToolCard/activityGrouping.test.ts`
- Modify: `web/src/components/ToolCard/knownTools.tsx`

**Interfaces:**
- Produces: `RoutineActivityGroup`, `HappyDisplayItem`, `isRoutineActivityBlock()`, and `groupRoutineActivities()`.
- Consumes: exported `getToolSurfaceTone(toolName)` from `knownTools.tsx`.
- Later tasks consume `HappyDisplayItem` in `assistant-runtime.ts` and `RoutineActivityGroup.blocks` in the renderer.

- [ ] **Step 1: Write failing eligibility and grouping tests**

Create fixtures using real `ToolCallBlock` shapes:

```ts
function makeTool(
    id: string,
    name: string,
    overrides: Partial<ToolCallBlock['tool']> = {},
    children: ChatBlock[] = []
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        children,
        tool: {
            id: `tool:${id}`,
            name,
            input: {},
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null,
            ...overrides
        }
    }
}
```

Then assert:

```ts
it('groups two or more consecutive eligible neutral tools without reordering them', () => {
    const read = makeTool('read', 'Read')
    const bash = makeTool('bash', 'CodexBash')
    const result = groupRoutineActivities([read, bash])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
        kind: 'routine-activity-group',
        id: 'activity:read',
        blocks: [read, bash]
    })
})

it('keeps a singleton neutral tool as a normal tool block', () => {
    const read = makeTool('read', 'Read')
    expect(groupRoutineActivities([read])).toEqual([read])
})

it.each(['update_plan', 'TodoWrite', 'ExitPlanMode', 'CodexDiff', 'Edit', 'Write', 'CodexPermission'])(
    'does not group artifact %s',
    (name) => expect(isRoutineActivityBlock(makeTool(name, name))).toBe(false)
)

it('breaks runs around text, pending permission, questions, tasks, and child tools', () => {
    const text: ChatBlock = {
        kind: 'agent-text', id: 'text', localId: null, createdAt: 2, text: 'boundary'
    }
    const pending = makeTool('pending', 'Read', {
        permission: { id: 'permission', status: 'pending' }
    })
    const askQuestion = makeTool('ask-question', 'AskUserQuestion')
    const question = makeTool('question', 'request_user_input')
    const task = makeTool('task', 'Task')
    const childParent = makeTool('parent', 'Read', {}, [makeTool('child', 'Read')])
    const result = groupRoutineActivities([
        makeTool('read', 'Read'), text,
        makeTool('bash', 'CodexBash'), pending,
        makeTool('glob', 'Glob'), askQuestion,
        makeTool('find', 'Glob'), question,
        makeTool('grep', 'Grep'), task,
        makeTool('ls', 'LS'), childParent
    ])

    expect(result.every((item) => item.kind !== 'routine-activity-group')).toBe(true)
})

it.each(['running', 'completed', 'error'] as const)(
    'keeps %s neutral tools eligible',
    (state) => expect(isRoutineActivityBlock(makeTool(state, 'CodexBash', { state }))).toBe(true)
)

it('keeps CodexReasoning as routine tool activity', () => {
    expect(isRoutineActivityBlock(makeTool('reasoning', 'CodexReasoning'))).toBe(true)
})
```

The boundary fixture must cover `AskUserQuestion`, `request_user_input`, `Task`, a neutral block with children, and a neutral block with pending permission.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web
bun run test src/components/ToolCard/activityGrouping.test.ts
```

Expected: FAIL because the grouping module and exported tone helper do not exist.

- [ ] **Step 3: Export the existing tone helper and implement the pure grouping pass**

Use this exact public shape:

```ts
export type RoutineActivityGroup = {
    kind: 'routine-activity-group'
    id: string
    createdAt: number
    blocks: ToolCallBlock[]
}

export type HappyDisplayItem = ChatBlock | RoutineActivityGroup

export function isRoutineActivityBlock(block: ChatBlock): block is ToolCallBlock {
    if (block.kind !== 'tool-call') return false
    if (block.tool.name === 'Task' || block.tool.name === 'CodexPermission' || block.children.length > 0) return false
    if (isAskUserQuestionToolName(block.tool.name)) return false
    if (isRequestUserInputToolName(block.tool.name)) return false
    if (block.tool.permission) return false
    return getToolSurfaceTone(block.tool.name) === 'neutral'
}

export function groupRoutineActivities(blocks: readonly ChatBlock[]): HappyDisplayItem[] {
    const output: HappyDisplayItem[] = []
    let run: ToolCallBlock[] = []

    const flush = () => {
        if (run.length === 1) output.push(run[0])
        if (run.length > 1) {
            output.push({
                kind: 'routine-activity-group',
                id: `activity:${run[0].id}`,
                createdAt: run[0].createdAt,
                blocks: run
            })
        }
        run = []
    }

    for (const block of blocks) {
        if (isRoutineActivityBlock(block)) run.push(block)
        else {
            flush()
            output.push(block)
        }
    }
    flush()
    return output
}
```

Keep `getToolSurfaceTone()` in `knownTools.tsx`; only change it from private to exported. Do not move the registry into a new policy module.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd web
bun run test src/components/ToolCard/activityGrouping.test.ts src/components/ToolCard/ToolCard.test.tsx
bun run typecheck
```

Expected: all selected tests PASS and `tsc --noEmit` exits 0.

- [ ] **Step 5: Commit the grouping contract**

```bash
git add web/src/components/ToolCard/activityGrouping.ts \
        web/src/components/ToolCard/activityGrouping.test.ts \
        web/src/components/ToolCard/knownTools.tsx
git commit -m "fix(web): define routine activity grouping contract"
```

## Task 2: Feed Display Groups Through the Assistant Runtime Without Changing Chat Data

**Files:**
- Modify: `web/src/lib/assistant-runtime.ts`
- Create: `web/src/lib/assistant-runtime.test.ts`

**Interfaces:**
- Consumes: `HappyDisplayItem` and `groupRoutineActivities()` from Task 1.
- Extends: `HappyChatMessageMetadata` with `{ kind: 'activity-group'; activityBlocks: ToolCallBlock[] }`.
- Produces: one stable assistant message per Activity Group for Task 4 to render.

- [ ] **Step 1: Write failing converter tests**

Export `toThreadMessageLike` for direct deterministic testing and add:

```ts
function makeTool(id: string, name: string): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: `tool:${id}`,
            name,
            input: {},
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null
        }
    }
}

it('converts an activity group into one assistant message with intact blocks', () => {
    const first = makeTool('one', 'Read')
    const second = makeTool('two', 'CodexBash')
    const group: RoutineActivityGroup = {
        kind: 'routine-activity-group',
        id: 'activity:one',
        createdAt: first.createdAt,
        blocks: [first, second]
    }

    const message = toThreadMessageLike(group)
    expect(message.id).toBe('activity:one')
    expect(message.role).toBe('assistant')
    expect(message.metadata?.custom).toMatchObject({
        kind: 'activity-group',
        activityBlocks: [first, second]
    })
})

it('does not mutate source ChatBlock objects while grouping display messages', () => {
    const blocks = [makeTool('one', 'Read'), makeTool('two', 'CodexBash')]
    const snapshot = structuredClone(blocks)
    groupRoutineActivities(blocks)
    expect(blocks).toEqual(snapshot)
})
```

- [ ] **Step 2: Run the runtime test and verify RED**

```bash
cd web
bun run test src/lib/assistant-runtime.test.ts
```

Expected: FAIL because the runtime accepts only `ChatBlock` and lacks activity metadata.

- [ ] **Step 3: Add the display-item branch and memoized grouping**

Extend the existing metadata object without changing existing fields:

```ts
export type HappyChatMessageMetadata = {
    kind: 'user' | 'assistant' | 'tool' | 'event' | 'cli-output' | 'team-mention' | 'activity-group'
    status?: HappyMessageStatus
    localId?: string | null
    originalText?: string
    toolCallId?: string
    event?: AgentEvent
    source?: CliOutputBlock['source']
    attachments?: AttachmentMetadata[]
    teamMention?: TeamMentionBlock
    activityBlocks?: ToolCallBlock[]
}
```

The converter test must prove `activityBlocks` is present whenever `kind === 'activity-group'`.

Add the converter branch before `ChatBlock` narrowing:

```ts
if (item.kind === 'routine-activity-group') {
    return {
        role: 'assistant',
        id: item.id,
        createdAt: new Date(item.createdAt),
        content: [{ type: 'text', text: '' }],
        metadata: {
            custom: {
                kind: 'activity-group',
                activityBlocks: item.blocks
            } satisfies HappyChatMessageMetadata
        }
    }
}
```

Inside `useHappyRuntime`, compute display items without mutating `props.blocks`:

```ts
const displayItems = useMemo(
    () => groupRoutineActivities(props.blocks),
    [props.blocks]
)

const convertedMessages = useExternalMessageConverter<HappyDisplayItem>({
    callback: toThreadMessageLike,
    messages: displayItems,
    isRunning: props.session.thinking
})
```

Do not change `chat/reducer*`, `chat/normalize*`, the `ChatBlock` union, or API types.

- [ ] **Step 4: Run runtime/grouping regression tests**

```bash
cd web
bun run test src/lib/assistant-runtime.test.ts \
    src/components/ToolCard/activityGrouping.test.ts \
    src/chat/reducerTimeline.test.ts \
    src/chat/normalize.test.ts
bun run typecheck
```

Expected: PASS; existing reducer and normalization tests remain unchanged.

- [ ] **Step 5: Commit runtime-only display grouping**

```bash
git add web/src/lib/assistant-runtime.ts web/src/lib/assistant-runtime.test.ts
git commit -m "fix(web): group routine tools at display boundary"
```

## Task 3: Restore a Visible Singleton Surface and Add the Reusable Activity Row Mode

**Files:**
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx`

**Interfaces:**
- Extends: `ToolCard` props with `displayMode?: 'card' | 'activity-row'`, defaulting to `card`.
- Preserves: the exact existing dialog input/result/trace rendering and permission footer behavior.
- Produces: a compact row renderer used by `RoutineActivityGroup` in Task 4.

- [ ] **Step 1: Replace the incorrect transparent-surface assertion with failing visual contracts**

Extend the existing test helpers without changing current callers:

```tsx
function makeToolBlock(
    name: string,
    input: unknown = {},
    permission?: ToolPermission,
    overrides: Partial<ToolCallBlock['tool']> = {}
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: `block-${name}`,
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: `tool-${name}`,
            name,
            input,
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null,
            permission,
            ...overrides
        }
    }
}

function renderTool(
    block: ToolCallBlock,
    options: { displayMode?: 'card' | 'activity-row' } = {}
) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            <ToolCard
                api={api}
                sessionId="session-1"
                metadata={null}
                disabled={false}
                onDone={vi.fn()}
                block={block}
                displayMode={options.displayMode}
            />
        </I18nProvider>
    )
}
```

```tsx
it('keeps a singleton neutral tool inside a subtle visible surface', () => {
    const { container } = renderTool(makeToolBlock('Read'))
    expect(container.querySelector('[data-tool-surface="neutral"]')).toHaveClass(
        'border-[var(--app-border)]',
        'bg-[var(--app-secondary-bg)]'
    )
})

it('renders activity-row mode without an individual card frame', () => {
    const { container } = renderTool(makeToolBlock('Read'), { displayMode: 'activity-row' })
    expect(container.querySelector('[data-tool-display="activity-row"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /read/i })).toHaveClass(
        'hover:bg-[var(--app-subtle-bg)]',
        'focus-visible:ring-2'
    )
    expect(screen.getByLabelText('completed')).toBeVisible()
    expect(container.querySelector('time')).toHaveClass('hidden', 'sm:block')
})

it('truncates long activity detail instead of widening the row', () => {
    const command = 'x'.repeat(400)
    renderTool(makeToolBlock('CodexBash', { command }), { displayMode: 'activity-row' })

    expect(screen.getByText(command)).toHaveClass('min-w-0', 'truncate')
})

it('activity-row mode opens the unchanged details dialog', async () => {
    renderTool(makeToolBlock('Read', { file_path: '/tmp/example.ts' }), {
        displayMode: 'activity-row'
    })
    await userEvent.click(screen.getByRole('button', { name: /read/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('/tmp/example.ts')
})
```

- [ ] **Step 2: Run ToolCard tests and verify RED**

```bash
cd web
bun run test src/components/ToolCard/ToolCard.test.tsx
```

Expected: FAIL on the visible singleton surface and missing `displayMode`.

- [ ] **Step 3: Share one dialog implementation between card and row shells**

Refactor only enough to avoid duplicating the existing `DialogContent`. Keep the input/result/trace IIFE behavior byte-for-byte equivalent. The new prop is:

```ts
type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
    displayMode?: 'card' | 'activity-row'
}
```

Change the neutral card style to:

```ts
neutral: 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] shadow-none'
```

Add the local timestamp formatter near the existing elapsed-time helper:

```ts
function formatActivityTime(value: number): string {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
```

Inside `ToolCardInner`, lift the current dialog body into one local `detailsDialog` node used by both shells:

```tsx
const isQuestionToolWithAnswers = Boolean(
    isQuestionTool
    && permission?.answers
    && Object.keys(permission.answers).length > 0
)

const detailsDialog = (
    <DialogContent className="max-w-2xl">
        <DialogHeader>
            <DialogTitle>{toolTitle}</DialogTitle>
        </DialogHeader>
        <div className="mt-3 flex max-h-[75vh] flex-col gap-4 overflow-auto">
            <div>
                <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                    {isQuestionToolWithAnswers ? t('tool.questionsAnswers') : t('tool.input')}
                </div>
                {FullToolView ? (
                    <FullToolView block={props.block} metadata={props.metadata} surface="dialog" />
                ) : (
                    renderToolInput(props.block, 'dialog')
                )}
            </div>
            <TraceSection block={props.block} metadata={props.metadata} />
            {!isQuestionToolWithAnswers ? (
                <div>
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                        {t('tool.result')}
                    </div>
                    <ResultToolView block={props.block} metadata={props.metadata} surface="dialog" />
                </div>
            ) : null}
        </div>
    </DialogContent>
)
```

For `activity-row`, render a semantic dialog trigger with this hierarchy:

```tsx
<div data-tool-display="activity-row" className="min-w-0">
    <Dialog>
        <DialogTrigger asChild>
            <button
                type="button"
                className="grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] sm:grid-cols-[3.5rem_auto_5rem_minmax(0,1fr)_auto_auto]"
            >
                <time className="hidden font-mono text-[10px] text-[var(--app-hint)] sm:block">
                    {formatActivityTime(props.block.createdAt)}
                </time>
                <span className="flex h-4 w-4 items-center justify-center text-[var(--app-hint)]">
                    {presentation.icon}
                </span>
                <span className="truncate text-xs font-medium text-[var(--app-fg)]">
                    {toolTitle}
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-[var(--app-hint)]">
                    {subtitle ?? ''}
                </span>
                <span className={stateColor} aria-label={props.block.tool.state}>
                    <StatusIcon state={props.block.tool.state} />
                </span>
                <span aria-hidden="true" className="text-[var(--app-hint)]">
                    <DetailsIcon />
                </span>
            </button>
        </DialogTrigger>
        {detailsDialog}
    </Dialog>
</div>
```

Use `props.block.createdAt` for local `hour:minute`; hide the time column below `sm`. Keep state icons and `aria-label` sufficient when subtitle is truncated. `activity-row` is only selected by Task 4 for blocks already proven to have no permission metadata and no children.

- [ ] **Step 4: Run ToolCard, permission, trace, and result regressions**

```bash
cd web
bun run test src/components/ToolCard/ToolCard.test.tsx \
    src/components/ToolCard/PermissionFooter.test.tsx \
    src/components/ToolCard/trace.test.tsx \
    src/components/ToolCard/views/_results.test.tsx
bun run typecheck
```

Expected: PASS, including existing permission payload and dialog tests.

- [ ] **Step 5: Commit the contained card/row shells**

```bash
git add web/src/components/ToolCard/ToolCard.tsx \
        web/src/components/ToolCard/ToolCard.test.tsx
git commit -m "fix(web): restore routine tool surfaces"
```

## Task 4: Render the Prototype v4 Activity Group

**Files:**
- Create: `web/src/components/ToolCard/RoutineActivityGroup.tsx`
- Create: `web/src/components/ToolCard/RoutineActivityGroup.test.tsx`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.tsx`
- Create: `web/src/components/AssistantChat/messages/AssistantMessage.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Consumes: `RoutineActivityGroup.blocks` from Tasks 1–2 and `ToolCard displayMode="activity-row"` from Task 3.
- Produces: accessible disclosure matching prototype v4.
- Uses: existing `HappyChatContext`; no API or mutation duplication.

- [ ] **Step 1: Write failing group component tests**

Use fixed block fixtures and the real providers required by the component:

```tsx
function makeToolBlock(
    name: string,
    input: unknown = {},
    overrides: Partial<ToolCallBlock['tool']> = {}
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: `block-${name}`,
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: `tool-${name}`,
            name,
            input,
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null,
            ...overrides
        }
    }
}

const api = {} as ApiClient
const ctx = {
    api,
    sessionId: 'session-1',
    metadata: null,
    disabled: false,
    onRefresh: vi.fn()
}

const readBlock = makeToolBlock('Read', { file_path: '/workspace/a.ts' })
const bashBlock = makeToolBlock('CodexBash', { command: 'bun test' })
const globBlock = makeToolBlock('Glob', { pattern: '**/*.ts' })
const grepBlock = makeToolBlock('Grep', { pattern: 'ActivityGroup' })

function renderGroup(blocks: ToolCallBlock[]) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            <HappyChatProvider value={ctx}>
                <RoutineActivityGroup blocks={blocks} />
            </HappyChatProvider>
        </I18nProvider>
    )
}
```

Cover the user-visible contract rather than only implementation classes:

```tsx
it('starts open with a count, bounded title summary, rail, and rows', () => {
    const { container } = renderGroup([readBlock, bashBlock, globBlock, grepBlock])
    const toggle = screen.getByRole('button', { name: /4 background actions/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Terminal')
    expect(toggle).toHaveTextContent('**/*.ts')
    expect(toggle).not.toHaveTextContent('ActivityGroup')
    expect(screen.getByRole('region', { name: /background actions/i })).toBeVisible()
    expect(container.querySelectorAll('[data-tool-display="activity-row"]')).toHaveLength(4)
})

it('collapses and reopens without losing source rows', async () => {
    renderGroup([readBlock, bashBlock])
    const toggle = screen.getByRole('button', { name: /2 background actions/i })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: /background actions/i })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.getByRole('region', { name: /background actions/i })).toBeVisible()
})

it('keeps row details interactive through the shared ToolCard dialog', async () => {
    renderGroup([readBlock, bashBlock])
    await userEvent.click(screen.getByRole('button', { name: /terminal/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Input')
})

it('keeps running and error status semantics visible', () => {
    const running = makeToolBlock('CodexBash', {}, { state: 'running' })
    const failed = makeToolBlock('Read', {}, { state: 'error' })
    renderGroup([running, failed])

    expect(screen.getByLabelText('running')).toBeVisible()
    expect(screen.getByLabelText('error')).toBeVisible()
})

it('supports keyboard disclosure and prevents narrow-row overflow', async () => {
    const { container } = renderGroup([
        readBlock,
        makeToolBlock('CodexBash', { command: 'x'.repeat(400) })
    ])
    const toggle = screen.getByRole('button', { name: /2 background actions/i })
    toggle.focus()
    await userEvent.keyboard('{Enter}')

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.firstElementChild).toHaveClass('min-w-0', 'max-w-full')
})
```

Use semantic queries in production tests. The only production selector is `data-tool-display`, which is already the explicit ToolCard presentation contract; do not add screenshot snapshots or class-string snapshots.

- [ ] **Step 2: Write a failing AssistantMessage metadata branch test**

Isolate only the metadata branch; keep `RoutineActivityGroup`'s real behavior covered by Step 1:

```tsx
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { HappyAssistantMessage } from './AssistantMessage'

type TestMessage = {
    id: string
    role: 'assistant'
    content: Array<{ type: 'text'; text: string } | { type: 'tool-call' }>
    metadata: { custom: Partial<HappyChatMessageMetadata> }
}

const assistantState = vi.hoisted(() => ({
    message: null as unknown as TestMessage
}))

vi.mock('@assistant-ui/react', () => ({
    useAssistantState: (selector: (state: { message: TestMessage }) => unknown) => (
        selector({ message: assistantState.message })
    ),
    MessagePrimitive: {
        Root: (props: { children: ReactNode; id?: string; className?: string }) => (
            <div id={props.id} className={props.className}>{props.children}</div>
        ),
        Content: () => <div data-testid="normal-message-content" />
    }
}))

vi.mock('@/components/ToolCard/RoutineActivityGroup', () => ({
    RoutineActivityGroup: (props: { blocks: ToolCallBlock[] }) => (
        <div data-testid="routine-activity-group">
            {props.blocks.map((block) => block.id).join(',')}
        </div>
    )
}))

vi.mock('@/components/AssistantChat/messages/assistantCopyText', () => ({
    getAssistantCopyText: () => ''
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({ copied: false, copy: vi.fn() })
}))
```

Set the hoisted state before each render and prove both the new branch and old branches:

```tsx
beforeEach(() => {
    assistantState.message = {
        id: 'assistant:ordinary',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        metadata: { custom: { kind: 'assistant' } }
    }
})

function makeToolBlock(name: string): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: `block-${name}`,
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: `tool-${name}`,
            name,
            input: {},
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: null
        }
    }
}

it('renders activity metadata with the group component instead of empty content', () => {
    const first = makeToolBlock('Read')
    const second = makeToolBlock('CodexBash')
    assistantState.message = {
        id: 'activity:first',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        metadata: {
            custom: { kind: 'activity-group', activityBlocks: [first, second] }
        }
    }

    render(<HappyAssistantMessage />)

    expect(screen.getByTestId('routine-activity-group')).toHaveTextContent(
        `${first.id},${second.id}`
    )
    expect(screen.queryByTestId('normal-message-content')).not.toBeInTheDocument()
})

it.each([
    {
        kind: 'assistant' as const,
        content: [{ type: 'text', text: 'Hello' }] satisfies TestMessage['content']
    },
    {
        kind: 'tool' as const,
        content: [{ type: 'tool-call' }] satisfies TestMessage['content']
    }
])('keeps ordinary $kind content on the existing branch', ({ kind, content }) => {
    assistantState.message = {
        ...assistantState.message,
        content,
        metadata: {
            custom: { kind }
        }
    }

    render(<HappyAssistantMessage />)

    expect(screen.getByTestId('normal-message-content')).toBeInTheDocument()
    expect(screen.queryByTestId('routine-activity-group')).not.toBeInTheDocument()
})
```

Keep this fixture local to `AssistantMessage.test.tsx`; do not introduce a shared test-helper module. The test double intentionally uses a test ID because it verifies branch selection, not production semantics.

- [ ] **Step 3: Run the focused UI tests and verify RED**

```bash
cd web
bun run test src/components/ToolCard/RoutineActivityGroup.test.tsx \
    src/components/AssistantChat/messages/AssistantMessage.test.tsx
```

Expected: FAIL because the component and metadata branch do not exist.

- [ ] **Step 4: Implement the prototype v4 disclosure and rail**

Core structure:

```tsx
export function RoutineActivityGroup(props: { blocks: ToolCallBlock[] }) {
    const [open, setOpen] = useState(true)
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const contentId = useId()
    const titles = props.blocks
        .slice(0, 3)
        .map((block) => getToolPresentation({
            toolName: block.tool.name,
            input: block.tool.input,
            result: block.tool.result,
            childrenCount: block.children.length,
            description: block.tool.description,
            metadata: ctx.metadata
        }).title)
        .join(', ')

    return (
        <section className="my-2 min-w-0 max-w-full" aria-label={t('tool.backgroundActions', { count: props.blocks.length })}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => setOpen((value) => !value)}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <svg
                    aria-hidden="true"
                    className={cn('h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')}
                    viewBox="0 0 16 16"
                    fill="none"
                >
                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-semibold text-[var(--app-fg)]">
                    {t('tool.backgroundActions', { count: props.blocks.length })}
                </span>
                <span className="min-w-0 truncate">{titles}</span>
            </button>
            {open ? (
                <div
                    id={contentId}
                    role="region"
                    aria-label={t('tool.backgroundActions', { count: props.blocks.length })}
                    className="ml-2 border-l border-[var(--app-border)] pl-2"
                >
                    {props.blocks.map((block) => (
                        <ToolCard
                            key={block.id}
                            displayMode="activity-row"
                            api={ctx.api}
                            sessionId={ctx.sessionId}
                            metadata={ctx.metadata}
                            disabled={ctx.disabled}
                            onDone={ctx.onRefresh}
                            block={block}
                        />
                    ))}
                </div>
            ) : null}
        </section>
    )
}
```

Do not duplicate permission/API callbacks: read them from `useHappyChatContext()` exactly as `HappyToolMessage` does.

Add locale keys:

```ts
// en
'tool.backgroundActions': '{count} background actions'
// vi-VN
'tool.backgroundActions': '{count} tác vụ nền'
// zh-CN
'tool.backgroundActions': '{count} 个后台操作'
```

Use the repository's existing single-brace interpolation syntax (`{count}`), as used by `tool.moreFiles`.

- [ ] **Step 5: Render activity metadata explicitly in `HappyAssistantMessage`**

Read and validate `metadata.custom.activityBlocks` alongside the existing CLI selector:

```tsx
const activityBlocks = useAssistantState(({ message }) => {
    const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
    if (custom?.kind !== 'activity-group') return null
    return Array.isArray(custom.activityBlocks) && custom.activityBlocks.length > 0
        ? custom.activityBlocks
        : null
})
```

Before the normal CLI/text/tool content branch, render:

```tsx
if (activityBlocks) {
    return (
        <MessagePrimitive.Root
            id={getConversationMessageAnchorId(messageId)}
            className="scroll-mt-4 min-w-0 max-w-full overflow-x-hidden"
        >
            <RoutineActivityGroup blocks={activityBlocks} />
        </MessagePrimitive.Root>
    )
}
```

Do not call `MessagePrimitive.Content` for this synthetic display message; the source tool blocks are rendered by the group component.

- [ ] **Step 6: Run focused UI and locale regressions**

```bash
cd web
bun run test src/components/ToolCard/RoutineActivityGroup.test.tsx \
    src/components/AssistantChat/messages/AssistantMessage.test.tsx \
    src/components/ToolCard/ToolCard.test.tsx
bun run typecheck
```

Expected: PASS in English, Vietnamese, and Chinese fixtures.

- [ ] **Step 7: Commit Activity Group rendering**

```bash
git add web/src/components/ToolCard/RoutineActivityGroup.tsx \
        web/src/components/ToolCard/RoutineActivityGroup.test.tsx \
        web/src/components/AssistantChat/messages/AssistantMessage.tsx \
        web/src/components/AssistantChat/messages/AssistantMessage.test.tsx \
        web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "fix(web): render grouped routine activity"
```

## Task 5: Correct `Apply changes` Semantics and Real Payload Rendering

**Files:**
- Modify: `web/src/components/ToolCard/knownTools.tsx`
- Modify: `web/src/components/ToolCard/activityGrouping.test.ts`
- Create: `web/src/components/ToolCard/codexPatch.ts`
- Create: `web/src/components/ToolCard/codexPatch.test.ts`
- Modify: `web/src/components/ToolCard/views/CodexPatchView.tsx`
- Create: `web/src/components/ToolCard/views/CodexPatchView.test.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Produces: `extractCodexPatchFiles(input): CodexPatchFile[]`.
- Supports array entries `{ path, kind?, diff? }` and record entries keyed by path.
- Does not feed patch hunks into the green compact/full `CodexDiff` views.

- [ ] **Step 1: Write failing tests using the observed production payload**

In `codexPatch.test.ts`, keep the parser fixtures pure:

```ts
const arrayPayload = {
    changes: [{
        path: '/workspace/docs/plan.md',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-old\n+new'
    }]
}

it('extracts files from the current array payload', () => {
    expect(extractCodexPatchFiles(arrayPayload)).toEqual([
        { path: '/workspace/docs/plan.md' }
    ])
})

it('keeps supporting record-shaped payloads', () => {
    expect(extractCodexPatchFiles({
        changes: { '/workspace/a.ts': {}, '/workspace/b.ts': {} }
    })).toEqual([
        { path: '/workspace/a.ts' },
        { path: '/workspace/b.ts' }
    ])
})

it.each([null, {}, { changes: [] }, { changes: 'invalid' }])(
    'returns a safe empty list for malformed input %#',
    (input) => expect(extractCodexPatchFiles(input)).toEqual([])
)
```

In `CodexPatchView.test.tsx`, duplicate the small `arrayPayload` constant locally and use the real locale provider:

```tsx
function makePatchBlock(input: unknown): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'patch-block',
        localId: null,
        createdAt: 1,
        children: [],
        tool: {
            id: 'patch-tool',
            name: 'CodexPatch',
            input,
            state: 'completed',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: '0',
            result: { success: true }
        }
    }
}

function renderPatch(input: unknown) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            <CodexPatchView
                block={makePatchBlock(input)}
                metadata={null}
                surface="dialog"
            />
        </I18nProvider>
    )
}

it('renders the real array payload as a useful file list with the full path available', () => {
    renderPatch(arrayPayload)
    expect(screen.getByText('plan.md')).toHaveAttribute(
        'title',
        '/workspace/docs/plan.md'
    )
})

it('renders an explicit fallback instead of a blank details dialog', () => {
    renderPatch({ changes: [] })
    expect(screen.getByText('Patch details unavailable')).toBeVisible()
})
```

Add ToolCard assertions:

```tsx
it('treats Apply changes as neutral activity without Review diff or subtitle 0', () => {
    const { container } = renderTool(
        makeToolBlock('CodexPatch', arrayPayload, undefined, { description: '0' })
    )
    expect(container.querySelector('[data-tool-surface="neutral"]')).not.toBeNull()
    expect(screen.queryByText('Review diff')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('plan.md')).toBeInTheDocument()
})

it('opens affected files and the existing result from an Apply changes row', async () => {
    renderTool(
        makeToolBlock('CodexPatch', arrayPayload, undefined, { result: { success: true } }),
        { displayMode: 'activity-row' }
    )

    await userEvent.click(screen.getByRole('button', { name: /apply changes/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('plan.md')
    expect(dialog).toHaveTextContent('Result')
})
```

Extend `activityGrouping.test.ts` after the tone correction so the mutation event joins routine activity rather than the artifact lane:

```ts
it('groups Apply changes with adjacent neutral activity', () => {
    const patch = makeTool('patch', 'CodexPatch', {
        input: { changes: [{ path: '/workspace/docs/plan.md' }] }
    })
    const read = makeTool('read', 'Read')

    expect(groupRoutineActivities([patch, read])).toMatchObject([{
        kind: 'routine-activity-group',
        blocks: [patch, read]
    }])
})
```

In card mode the filename can be the subtitle; in grouped mode it appears as the row detail. Clicking the row must show at least the affected file list and existing mutation result.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd web
bun run test src/components/ToolCard/codexPatch.test.ts \
    src/components/ToolCard/views/CodexPatchView.test.tsx \
    src/components/ToolCard/ToolCard.test.tsx
```

Expected: FAIL because array payloads are ignored and `CodexPatch` is still a diff tone.

- [ ] **Step 3: Implement one safe patch-file extractor**

```ts
export type CodexPatchFile = { path: string }

export function extractCodexPatchFiles(input: unknown): CodexPatchFile[] {
    if (!isObject(input)) return []
    const changes = input.changes

    if (Array.isArray(changes)) {
        return changes.flatMap((entry) => {
            if (!isObject(entry) || typeof entry.path !== 'string' || entry.path.length === 0) {
                return []
            }
            return [{ path: entry.path }]
        })
    }

    if (isObject(changes)) {
        return Object.keys(changes).map((path) => ({ path }))
    }

    return []
}
```

Put the extractor in `web/src/components/ToolCard/codexPatch.ts` so `knownTools.tsx` and `CodexPatchView.tsx` can both import it without a `knownTools → view registry → knownTools` cycle. Do not maintain two payload parsers. Remove `CodexPatch` from `DIFF_TOOLS`.

Use the parser in `knownTools.CodexPatch.subtitle`. Return a real filename/count for non-empty input. Return the deliberate empty-string sentinel `''` for empty/malformed input so the existing `presentation.subtitle ?? description` expression cannot fall back to the provider description `0`.

Use the same parser in `CodexPatchView`. For files, render the basename with `title={fullPath}`. For an empty list, render localized fallback copy rather than `null`:

```ts
// en
'tool.patchDetailsUnavailable': 'Patch details unavailable'
// vi-VN
'tool.patchDetailsUnavailable': 'Không có chi tiết thay đổi'
// zh-CN
'tool.patchDetailsUnavailable': '补丁详情不可用'
```

Add both `tool.backgroundActions` (Task 4) and `tool.patchDetailsUnavailable` to the existing all-dictionaries assertion in `ToolCard.test.tsx`; this proves all three supported dictionaries carry non-empty copy.

The full patch dialog lists basenames with accessible full-path titles. It continues to show the existing result section from `ToolCard`; it must not render the consolidated full diff or use `tool.reviewDiff`.

- [ ] **Step 4: Run patch, grouping, and diff regression tests**

```bash
cd web
bun run test src/components/ToolCard/codexPatch.test.ts \
    src/components/ToolCard/views/CodexPatchView.test.tsx \
    src/components/ToolCard/views/CodexDiffView.test.tsx \
    src/components/ToolCard/ToolCard.test.tsx \
    src/components/ToolCard/activityGrouping.test.ts \
    src/components/ToolCard/RoutineActivityGroup.test.tsx
bun run typecheck
```

Expected: PASS; `CodexDiff` remains diff tone and its existing 3-file bounded preview is unchanged.

- [ ] **Step 5: Commit the patch semantic correction**

```bash
git add web/src/components/ToolCard/knownTools.tsx \
        web/src/components/ToolCard/activityGrouping.test.ts \
        web/src/components/ToolCard/codexPatch.ts \
        web/src/components/ToolCard/codexPatch.test.ts \
        web/src/components/ToolCard/views/CodexPatchView.tsx \
        web/src/components/ToolCard/views/CodexPatchView.test.tsx \
        web/src/components/ToolCard/ToolCard.test.tsx \
        web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "fix(web): distinguish patch activity from diff review"
```

## Task 6: Real-Session Visual Gate and Full Regression Verification

**Files:**
- Modify only if evidence exposes a scoped defect in files already listed above.
- Do not add a permanent fixture route, Storybook, or screenshots to production bundles.

**Interfaces:**
- Consumes all prior tasks.
- Produces verification evidence, not new application behavior.

- [ ] **Step 1: Run the full automated suite from repository root**

```bash
bun run test
bun typecheck
bun run build:web
git diff --check
```

Expected:

- CLI tests pass; configured integration-only skips remain the only skips.
- Hub tests pass.
- Web tests pass, including new Activity Group and real `CodexPatch` payload cases.
- All package typechecks pass.
- Vite production build exits 0; existing non-blocking Browserslist/KaTeX/chunk warnings may remain.
- `git diff --check` produces no output.

- [ ] **Step 2: Start the feature worktree web app against the local hub**

```bash
VITE_HUB_PROXY=http://127.0.0.1:3006 bun run --cwd web dev -- --host 127.0.0.1 --port 4174
```

Use a real session containing consecutive Terminal/Reasoning-like tools, `CodexPatch` array payloads, and `CodexDiff`. Do not inject or mutate database messages.

- [ ] **Step 3: Capture and inspect the required dark/light desktop states**

For each theme, verify against prototype v4:

- Activity Group header is visible and reports the correct count.
- Expanded group has a vertical rail; rows are compact but clearly bounded as one unit.
- Rows show recognizable title/detail/status hierarchy and hover/focus feedback.
- Collapsing hides rows; reopening restores them.
- A row opens its unchanged input/result/trace dialog.
- Singleton neutral tools retain a subtle visible card surface.
- Plan, Diff, `agent-reasoning`, and Permission remain distinct artifacts/attention states; `CodexReasoning` remains a routine activity row.
- `Apply changes` is neutral, has a filename/count, has no `0`, and has no `Review diff` action.
- `Diff` remains the only green review artifact among `Apply changes`/`Diff`.

Save temporary captures under `docs/screenshots/`, inspect them with the image viewer, and remove them before the final commit unless the user explicitly asks to retain visual artifacts.

- [ ] **Step 4: Verify narrow mobile behavior at 390×844**

Assert in the browser:

```js
document.body.scrollWidth === window.innerWidth
```

Also inspect:

- group header count remains readable;
- time may hide, but title/status remain visible;
- long command/path text truncates instead of widening the page;
- row and group toggles remain at least 36px tall;
- permission actions and artifact previews retain their prior mobile behavior.

- [ ] **Step 5: Inspect console and interaction accessibility**

- No new console errors or page errors.
- Keyboard Tab reaches group toggle and row buttons.
- Enter/Space toggles the group and opens a row dialog.
- `aria-expanded` tracks the visual state.
- Focus-visible ring is perceptible in both themes.
- Reduced-motion media query disables disclosure animation if animation is introduced; omitting animation also satisfies this requirement.

- [ ] **Step 6: Run final scope audit**

```bash
BASE=$(git merge-base HEAD main)
git diff --name-only "$BASE"..HEAD
git diff --check "$BASE"..HEAD
git status --short
```

Required result:

- only web presentation/runtime adapter files, focused tests, locales, and approved plan/spec docs changed;
- no `cli/`, `hub/`, `shared/`, reducer, normalizer, schema, route, database, generic `DiffView`, or permission mutation changes;
- worktree clean after commits.

- [ ] **Step 7: Commit any evidence-driven scoped correction**

Only if Steps 2–5 exposed a defect:

```bash
git add web/src/components/ToolCard/activityGrouping.ts \
        web/src/components/ToolCard/activityGrouping.test.ts \
        web/src/components/ToolCard/RoutineActivityGroup.tsx \
        web/src/components/ToolCard/RoutineActivityGroup.test.tsx \
        web/src/components/ToolCard/ToolCard.tsx \
        web/src/components/ToolCard/ToolCard.test.tsx \
        web/src/components/ToolCard/knownTools.tsx \
        web/src/components/ToolCard/codexPatch.ts \
        web/src/components/ToolCard/codexPatch.test.ts \
        web/src/components/ToolCard/views/CodexPatchView.tsx \
        web/src/components/ToolCard/views/CodexPatchView.test.tsx \
        web/src/components/AssistantChat/messages/AssistantMessage.tsx \
        web/src/components/AssistantChat/messages/AssistantMessage.test.tsx \
        web/src/lib/assistant-runtime.ts \
        web/src/lib/assistant-runtime.test.ts \
        web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "fix(web): align activity visuals with approved prototype"
```

Do not create a cleanup commit when no source change is required.

## Review Gates

After every task:

1. Compare the actual diff to that task's file list.
2. Run the task's focused test command.
3. Run GitNexus `detect_changes(scope: "all")` when the HAPI index is available; otherwise record the unavailable-index evidence already identified in the preflight gate.
4. Review behavior against the corrective design, not against the old transparent-row plan.
5. Reject any change to data normalization, API behavior, permission payloads, or nested Task semantics.
6. Do not proceed with Critical or Important review findings unresolved.

Before merge:

- conduct an adversarial code review of `BASE..HEAD`;
- inspect real-session screenshots, not only DOM classes;
- explicitly record whether every manual matrix item was observed or covered by an automated fallback;
- merge only after full test/typecheck/build and clean scope evidence.
