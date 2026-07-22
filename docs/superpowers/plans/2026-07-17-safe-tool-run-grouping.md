# Safe Tool Run Grouping Implementation Plan

> [!IMPORTANT]
> **Final implementation erratum — baseline `ffa4ca7`, independent-review fix wave.**
> The task snippets below are historical execution notes, not the final contract where they conflict with this status:
> 1. `HapiCliOutput` uses the CLI renderer only for a complete, structurally valid **assistant-source** `CliOutputBlock` (`kind`, `id`, `localId`, `createdAt`, `text`, `source`). Partial artifacts, user-source artifacts, and provider tools with the same name delegate exactly once to `HappyToolMessage`, preserving provider arguments, result, error, and status.
> 2. Group-row disclosure follows the actual renderer: structured `Read.file.content`, renderer-supported shell stdout/stderr (including nested Bash output and literal `Done`/`(no output)`), and meaningful Diff input/result are expandable. Only Apply/mutation completion sentinels suppress an empty chevron; Diff result is the fallback when malformed/missing input cannot provide a structured view.
> 3. The output region keeps stable disclosure semantics, but heavyweight result/full views mount **only while open** and unmount when closed. Do not reproduce the eager hidden-child mount shown in the old Task 4 snippet.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gom các tool được duyệt thành nhóm UI gọn mà vẫn giữ nguyên toàn bộ stream reasoning, text, CLI output, event, team mention và tool theo đúng thứ tự.

**Architecture:** Giữ nguyên `ChatBlock[]` và `useExternalMessageConverter`; CLI output được encode thành dedicated content part thay vì short-circuit cả assistant message. Dùng `MessagePrimitive.Content.components.ToolGroup` để chia tool-call part liền kề theo allowlist; `ToolCard` chỉ dùng hàng gọn khi nằm trong group context. Không tạo synthetic message hay thay đổi hub/CLI/API.

**Tech Stack:** React 19, TypeScript strict, assistant-ui `0.11.53`, Tailwind CSS variables, Radix Dialog, Vitest + Testing Library, Playwright, Bun workspaces.

## Global Constraints

- Visual source of truth: `docs/superpowers/artifacts/2026-07-17-safe-tool-grouping-mockup.html`.
- Functional source of truth: `docs/superpowers/specs/2026-07-17-safe-tool-run-grouping-design.md`.
- Không sửa, lọc, đảo thứ tự hoặc thay thế `ChatBlock[]`; không tạo `activity-group`/blank assistant message.
- Flatten content parts sau grouping phải giữ nguyên mọi index, đúng thứ tự, không thiếu và không trùng.
- Allowlist: `Read`, `Grep`, `Glob`, `Bash`, `CodexBash`, `CodexPatch`, `CodexDiff`; run tối thiểu hai tool.
- Unknown/MCP/Agent/SendMessage/Team/Task/Plan/permission/question/children/error đứng riêng.
- Agent text không box; Reasoning giữ lifecycle hiện tại nhưng dùng disclosure nhỏ không box.
- Tool group: `width: 100%`, `max-width: 600px`; expanded output: full group width, `max-height: 300px`, cuộn dọc/ngang.
- Tool không có meaningful output không có inline accordion nhưng vẫn mở được dialog input/raw details.
- Mọi label/control mới có en, vi-VN, zh-CN; keyboard, focus-visible và aria đầy đủ.
- Không thêm dependency, không thay API/database/hub/CLI.

## Visual Acceptance Matrix

| Thành phần | Chuẩn từ mockup |
|---|---|
| Agent text | Trực tiếp trên nền chat, không card/box |
| Reasoning | Label + chevron; completed đóng; streaming tự mở; không border/background/full-width |
| Completed group | Header tối đa 600px, mặc định đóng, có count + duration + summary + status |
| Open group | Hàng tool gọn, đúng thứ tự, không card lớn lồng nhau |
| Apply Changes | File summary/list; không accordion nếu chỉ “Done/no output”; dialog vẫn mở |
| Diff | Nhãn xem thay đổi; mở diff nếu `unified_diff` hợp lệ |
| Terminal/result | Full group width; cao tối đa 300px; log dài cuộn, không wrap phá format |
| Mobile | Nhóm co theo viewport; trang không horizontal scroll |

## File Map

| File/khối | Vai trò | Sửa gì | Rủi ro |
|---|---|---|---|
| `web/src/lib/assistant-runtime.ts` | Block → content part | CLI assistant thành pseudo-tool part | **Đỏ: stream** |
| `web/src/lib/cliOutputPart.ts` | CLI contract | Tool name + type guard | Vàng |
| `web/src/components/AssistantChat/messages/CliOutputMessagePart.tsx` | CLI renderer | Render `CliOutputBlock` từ artifact | Vàng |
| `web/src/components/AssistantChat/messages/AssistantMessage.tsx` | Assistant renderer | Bỏ CLI early return; đăng ký CLI part + ToolGroup | **Đỏ: siblings** |
| `web/src/components/ToolCard/toolRunModel.ts` | Pure rules | Allowlist, partition, duration, expansion | **Đỏ: fidelity** |
| `web/src/components/ToolCard/ToolRunGroup.tsx` | Group container | Header, disclosure, max-width 600px | Vàng |
| `web/src/components/ToolCard/toolRunContext.tsx` | Presentation context | Bật group-row cho child tool | Xanh |
| `web/src/components/ToolCard/ToolCard.tsx` | Tool UI | Group-row, dialog/output controls, 300px cap | **Đỏ: dialog/permission** |
| `web/src/components/assistant-ui/reasoning.tsx` | Reasoning | Disclosure không box, lifecycle cũ | Vàng |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | i18n | Group/reasoning/output labels | Xanh |

## Execution Preflight

- [ ] Tạo worktree bằng `superpowers:using-git-worktrees`, branch `feat/safe-tool-run-grouping`, từ commit chứa spec `60de1aa` hoặc mới hơn.
- [ ] Chạy GitNexus impact cho `useHappyRuntime`, `HappyAssistantMessage`, `HappyToolMessage`, `ToolCardInner`, `ReasoningGroup`; ghi direct callers và affected processes vào execution notes.
- [ ] Chạy baseline:

```bash
bun run test:web
bun run typecheck:web
```

Expected: test web và typecheck pass trước khi sửa code.

---

### Task 1: Render CLI output như một content part an toàn

**Files:**
- Create: `web/src/lib/cliOutputPart.ts`
- Create: `web/src/components/AssistantChat/messages/CliOutputMessagePart.tsx`
- Create: `web/src/lib/assistant-runtime.test.ts`
- Create: `web/src/components/AssistantChat/messages/CliOutputMessagePart.test.tsx`
- Modify: `web/src/lib/assistant-runtime.ts:6-125`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.tsx:1-66`

**Interfaces:**
- Produces: `CLI_OUTPUT_TOOL_NAME: 'HapiCliOutput'`.
- Produces: `isCliOutputBlock(value: unknown): value is CliOutputBlock`.
- Produces: named export `toThreadMessageLike(block: ChatBlock): ThreadMessageLike`.
- Preserves: user-source CLI remains a user message.

- [ ] **Step 1: Write failing converter tests**

```ts
import { describe, expect, it } from 'vitest'
import type { CliOutputBlock } from '@/chat/types'
import { CLI_OUTPUT_TOOL_NAME } from '@/lib/cliOutputPart'
import { toThreadMessageLike } from '@/lib/assistant-runtime'

function cli(source: CliOutputBlock['source']): CliOutputBlock {
    return {
        kind: 'cli-output', id: `cli-${source}`, localId: null,
        createdAt: 1000, text: 'Exit code: 0\nOutput:\nready', source, meta: null
    }
}

describe('toThreadMessageLike CLI output', () => {
    it('encodes assistant CLI as a dedicated tool-call part', () => {
        const message = toThreadMessageLike(cli('assistant'))
        expect(message.role).toBe('assistant')
        expect(message.content).toEqual([expect.objectContaining({
            type: 'tool-call', toolName: CLI_OUTPUT_TOOL_NAME,
            result: 'Exit code: 0\nOutput:\nready', artifact: cli('assistant')
        })])
    })

    it('keeps user CLI as a user text message', () => {
        const message = toThreadMessageLike(cli('user'))
        expect(message.role).toBe('user')
        expect(message.content).toEqual([{ type: 'text', text: 'Exit code: 0\nOutput:\nready' }])
    })
})
```

- [ ] **Step 2: Run RED**

```bash
cd web && bun run test src/lib/assistant-runtime.test.ts
```

Expected: FAIL because the contract/export does not exist.

- [ ] **Step 3: Implement CLI contract and converter branch**

```ts
import { isObject } from '@hapi/protocol'
import type { CliOutputBlock } from '@/chat/types'

export const CLI_OUTPUT_TOOL_NAME = 'HapiCliOutput' as const

export function isCliOutputBlock(value: unknown): value is CliOutputBlock {
    return isObject(value)
        && value.kind === 'cli-output'
        && typeof value.id === 'string'
        && typeof value.text === 'string'
        && (value.source === 'user' || value.source === 'assistant')
}
```

For assistant-source CLI, return:

```ts
content: [{
    type: 'tool-call',
    toolCallId: `cli-output:${block.id}`,
    toolName: CLI_OUTPUT_TOOL_NAME,
    argsText: '',
    result: block.text,
    artifact: block
}],
metadata: { custom: { kind: 'assistant' } satisfies HappyChatMessageMetadata }
```

- [ ] **Step 4: Implement and test the part renderer**

```tsx
export function CliOutputMessagePart(props: ToolCallMessagePartProps) {
    if (!isCliOutputBlock(props.artifact)) return null
    return (
        <div data-cli-output-part className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <CliOutputBlock text={props.artifact.text} />
        </div>
    )
}
```

```tsx
it('renders only a valid CLI artifact', () => {
    const artifact = cli('assistant')
    const props = { artifact } as unknown as ToolCallMessagePartProps
    const { container, rerender } = render(
        <I18nProvider><CliOutputMessagePart {...props} /></I18nProvider>
    )
    expect(container.querySelector('[data-cli-output-part]')).toHaveTextContent('ready')

    rerender(
        <I18nProvider>
            <CliOutputMessagePart {...({ artifact: { kind: 'tool-call' } } as unknown as ToolCallMessagePartProps)} />
        </I18nProvider>
    )
    expect(container.querySelector('[data-cli-output-part]')).toBeNull()
})
```

Register it at `tools.by_name[CLI_OUTPUT_TOOL_NAME]`:

```tsx
const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage,
    by_name: { [CLI_OUTPUT_TOOL_NAME]: CliOutputMessagePart }
} as const
```

Remove `isCliOutput`, `cliText`, the `CliOutputBlock` import and the whole-message early return from `HappyAssistantMessage`; every assistant message must reach `MessagePrimitive.Content`.

- [ ] **Step 5: Verify and commit**

```bash
cd web && bun run test src/lib/assistant-runtime.test.ts src/components/AssistantChat/messages/CliOutputMessagePart.test.tsx
cd web && bun run typecheck
git add web/src/lib/cliOutputPart.ts web/src/lib/assistant-runtime.ts web/src/lib/assistant-runtime.test.ts web/src/components/AssistantChat/messages/AssistantMessage.tsx web/src/components/AssistantChat/messages/CliOutputMessagePart.tsx web/src/components/AssistantChat/messages/CliOutputMessagePart.test.tsx
git commit -m "fix(web): render cli output without hiding message parts"
```

---

### Task 2: Định nghĩa pure model cho run, output và duration

**Files:**
- Create: `web/src/components/ToolCard/toolRunModel.ts`
- Create: `web/src/components/ToolCard/toolRunModel.test.ts`
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx:1-35`

**Interfaces:**
- Produces: `ToolRunSegment`, `isToolCallBlock`, `isGroupableToolBlock`, `partitionToolRunParts`.
- Produces: `getToolExpansionKind(block): 'input' | 'result' | null`.
- Produces: `getToolRunDurationMs(blocks, now): number | null`.

- [ ] **Step 1: Write failing grouping tests**

```ts
type BlockOptions = {
    input?: unknown
    result?: unknown
    state?: ToolCallBlock['tool']['state']
    startedAt?: number | null
    completedAt?: number | null
    permission?: ToolPermission
    children?: ChatBlock[]
}

function block(name: string, options: BlockOptions = {}): ToolCallBlock {
    return {
        kind: 'tool-call', id: `block-${name}`, localId: null, createdAt: 1000,
        children: options.children ?? [],
        tool: {
            id: `tool-${name}`, name, input: options.input ?? {},
            state: options.state ?? 'completed', createdAt: 1000,
            startedAt: options.startedAt ?? 1000,
            completedAt: options.completedAt === undefined ? 2000 : options.completedAt,
            description: null, result: options.result, permission: options.permission
        }
    }
}

function part(artifact: unknown): ToolRunPart {
    return { type: 'tool-call', artifact }
}

it('groups allowlisted runs and preserves every offset', () => {
    const parts = [part(block('Read')), part(block('Bash')), part(block('Agent')), part(block('Grep')), part(block('Glob'))]
    const segments = partitionToolRunParts(parts)
    expect(segments.map((item) => [item.kind, item.startOffset, item.endOffset])).toEqual([
        ['group', 0, 1], ['single', 2, 2], ['group', 3, 4]
    ])
    expect(segments.flatMap((item) =>
        Array.from({ length: item.endOffset - item.startOffset + 1 }, (_, index) => item.startOffset + index)
    )).toEqual([0, 1, 2, 3, 4])
})

it.each(['Agent', 'Task', 'update_plan', 'SendMessage', 'mcp__server__tool'])(
    'keeps %s outside groups',
    (name) => expect(isGroupableToolBlock(block(name))).toBe(false)
)
```

```ts
const permission = (status: ToolPermission['status']): ToolPermission => ({
    id: `permission-${status}`, status
})

it('treats permission, children and error as hard boundaries', () => {
    expect(isGroupableToolBlock(block('Read', { permission: permission('pending') }))).toBe(false)
    expect(isGroupableToolBlock(block('Read', { permission: permission('approved') }))).toBe(false)
    expect(isGroupableToolBlock(block('Read', { children: [block('Grep')] }))).toBe(false)
    expect(isGroupableToolBlock(block('Read', { state: 'error' }))).toBe(false)
})

it('keeps non-tool and CLI offsets lossless', () => {
    const parts = [part(block('Read')), part({ kind: 'cli-output' }), part(block('Bash'))]
    const segments = partitionToolRunParts(parts)
    expect(segments.map((item) => [item.kind, item.startOffset, item.endOffset])).toEqual([
        ['single', 0, 0], ['single', 1, 1], ['single', 2, 2]
    ])
})
```

- [ ] **Step 2: Run RED**

```bash
cd web && bun run test src/components/ToolCard/toolRunModel.test.ts
```

Expected: FAIL because `toolRunModel.ts` does not exist.

- [ ] **Step 3: Implement allowlist and lossless partitioning**

```ts
const GROUPABLE_TOOL_NAMES = new Set([
    'Read', 'Grep', 'Glob', 'Bash', 'CodexBash', 'CodexPatch', 'CodexDiff'
])

export type ToolRunPart = { type?: string; artifact?: unknown }
export type ToolRunSegment =
    | { kind: 'group'; id: string; startOffset: number; endOffset: number; blocks: ToolCallBlock[] }
    | { kind: 'single'; startOffset: number; endOffset: number; block: ToolCallBlock | null }

export function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value) || value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number' || !Array.isArray(value.children)) return false
    if (!isObject(value.tool) || typeof value.tool.name !== 'string' || !('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    return value.tool.state === 'pending'
        || value.tool.state === 'running'
        || value.tool.state === 'completed'
        || value.tool.state === 'error'
}

export function isGroupableToolBlock(block: ToolCallBlock): boolean {
    return GROUPABLE_TOOL_NAMES.has(block.tool.name)
        && block.tool.state !== 'error'
        && block.tool.permission === undefined
        && block.children.length === 0
}

function stableGroupId(blocks: readonly ToolCallBlock[]): string {
    return `tool-run:${blocks[0]?.id ?? 'empty'}`
}

export function partitionToolRunParts(parts: readonly ToolRunPart[]): ToolRunSegment[] {
    const segments: ToolRunSegment[] = []
    let runStart = -1
    let runBlocks: ToolCallBlock[] = []

    const flushRun = () => {
        if (runBlocks.length === 0) return
        const endOffset = runStart + runBlocks.length - 1
        segments.push(runBlocks.length >= 2
            ? { kind: 'group', id: stableGroupId(runBlocks), startOffset: runStart, endOffset, blocks: runBlocks }
            : { kind: 'single', startOffset: runStart, endOffset, block: runBlocks[0] })
        runStart = -1
        runBlocks = []
    }

    parts.forEach((part, offset) => {
        const block = isToolCallBlock(part.artifact) ? part.artifact : null
        if (block && isGroupableToolBlock(block)) {
            if (runBlocks.length === 0) runStart = offset
            runBlocks.push(block)
            return
        }

        flushRun()
        segments.push({ kind: 'single', startOffset: offset, endOffset: offset, block })
    })
    flushRun()
    return segments
}
```

Move the strict `isToolCallBlock` guard from `ToolMessage.tsx` into this file and reuse it.

- [ ] **Step 4: Test and implement expansion/timing**

```ts
expect(getToolExpansionKind(block('CodexPatch', { result: null }))).toBeNull()
expect(getToolExpansionKind(block('CodexPatch', { result: 'patched' }))).toBe('result')
expect(getToolExpansionKind(block('CodexDiff', { input: {
    unified_diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b'
} }))).toBe('input')
expect(getToolExpansionKind(block('CodexDiff', { input: {} }))).toBeNull()
expect(getToolExpansionKind(block('CodexDiff', { input: { unified_diff: 'not a diff' } }))).toBeNull()
expect(getToolExpansionKind(block('Bash', { result: { stdout: 'ready\n', stderr: '' } }))).toBe('result')
expect(getToolExpansionKind(block('Bash', { result: { stdout: ' ', stderr: '' } }))).toBeNull()
expect(getToolRunDurationMs([
    block('Read', { startedAt: 1000, completedAt: 2000 }),
    block('Bash', { state: 'running', startedAt: 1500, completedAt: null })
], 4000)).toBe(3000)
expect(getToolRunDurationMs([block('Read', { startedAt: null })], 4000)).toBeNull()
expect(getToolRunDurationMs([block('Read', { startedAt: 4000, completedAt: 3000 })], 4000)).toBeNull()
```

Use exported `extractTextFromResult`/`extractCodexBashDisplay`; trim whitespace. Duration uses injected `now` while running and returns `null` for missing/negative/non-finite time.

```ts
import { parsePatch } from 'diff'

const EMPTY_RESULT = /^(done|\(no output\)|done\s*\(no output\))$/i

function hasMeaningfulText(value: string | null | undefined): boolean {
    const text = value?.trim() ?? ''
    return text.length > 0 && !EMPTY_RESULT.test(text)
}

function hasRenderableUnifiedDiff(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) return false
    try {
        return parsePatch(value).some((patch) => patch.hunks.length > 0)
    } catch {
        return false
    }
}

export function getToolExpansionKind(block: ToolCallBlock): 'input' | 'result' | null {
    if (block.tool.name === 'CodexDiff') {
        const input = block.tool.input
        return isObject(input)
            && hasRenderableUnifiedDiff(input.unified_diff)
            ? 'input'
            : null
    }

    if (block.tool.name === 'Bash' || block.tool.name === 'CodexBash') {
        const display = extractCodexBashDisplay(block.tool.result)
        if (display && (hasMeaningfulText(display.stdout) || hasMeaningfulText(display.stderr))) {
            return 'result'
        }
    }

    return hasMeaningfulText(extractTextFromResult(block.tool.result)) ? 'result' : null
}

export function getToolRunDurationMs(
    blocks: readonly ToolCallBlock[],
    now: number
): number | null {
    const starts = blocks.map((block) => block.tool.startedAt)
    if (starts.some((value) => value === null || !Number.isFinite(value) || value < 0)) return null
    const start = Math.min(...(starts as number[]))
    const running = blocks.some((block) => block.tool.state === 'running' || block.tool.state === 'pending')
    const completions = blocks.map((block) => block.tool.completedAt)
    if (!running && completions.some((value) => value === null || !Number.isFinite(value) || value < 0)) return null
    const end = running ? now : Math.max(...(completions as number[]))
    const duration = end - start
    return Number.isFinite(duration) && duration >= 0 ? duration : null
}
```

- [ ] **Step 5: Verify and commit**

```bash
cd web && bun run test src/components/ToolCard/toolRunModel.test.ts
cd web && bun run typecheck
git add web/src/components/ToolCard/toolRunModel.ts web/src/components/ToolCard/toolRunModel.test.ts web/src/components/AssistantChat/messages/ToolMessage.tsx
git commit -m "feat(web): define lossless tool run grouping contract"
```

---

### Task 3: Render ToolGroup container không đổi message content

**Files:**
- Create: `web/src/components/ToolCard/toolRunContext.tsx`
- Create: `web/src/components/ToolCard/ToolRunGroup.tsx`
- Create: `web/src/components/ToolCard/ToolRunGroup.test.tsx`
- Modify: `web/src/components/AssistantChat/messages/AssistantMessage.tsx:12-21`
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx:130-220`

**Interfaces:**
- Produces: `ToolRunLayoutProvider`, `useToolRunLayout(): boolean`.
- Produces: assistant-ui-compatible `ToolRunGroup({ startIndex, endIndex, children })`.
- Guarantees: every original child rendered exactly once; group state local, mount-only.

- [ ] **Step 1: Write failing component tests**

Use a hoisted assistant state fixture so `ToolRunGroup` reads the same inclusive range contract as assistant-ui. Keep `content` and `parts` identical in the mocked message state:

```tsx
const assistantState = vi.hoisted(() => ({ parts: [] as ToolRunPart[] }))

vi.mock('@assistant-ui/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@assistant-ui/react')>()
    return {
        ...actual,
        useAssistantState: (selector: (state: {
            message: { content: ToolRunPart[]; parts: ToolRunPart[] }
        }) => unknown) => selector({
            message: { content: assistantState.parts, parts: assistantState.parts }
        })
    }
})

function setMessageParts(parts: ToolRunPart[]) {
    assistantState.parts = parts
}
```

```tsx
it('wraps two allowlisted children and preserves a boundary child exactly once', () => {
    setMessageParts([part(block('Read')), part(block('Bash')), part(block('Agent'))])
    render(<ToolRunGroup startIndex={0} endIndex={2}>
        <span>read-child</span><span>bash-child</span><span>agent-child</span>
    </ToolRunGroup>)
    expect(screen.getAllByText('read-child')).toHaveLength(1)
    expect(screen.getAllByText('bash-child')).toHaveLength(1)
    expect(screen.getAllByText('agent-child')).toHaveLength(1)
    expect(screen.getAllByTestId('tool-run-group')).toHaveLength(1)
})
```

```tsx
it('uses a mount-only default and keeps children mounted while closed', () => {
    setMessageParts([part(block('Read')), part(block('Bash'))])
    const view = render(<ToolRunGroup startIndex={0} endIndex={1}>
        <span>read-child</span><span>bash-child</span>
    </ToolRunGroup>)
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('read-child')).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    setMessageParts([
        part(block('Read', { state: 'running', completedAt: null })),
        part(block('Bash', { state: 'running', completedAt: null }))
    ])
    view.rerender(<ToolRunGroup startIndex={0} endIndex={1}>
        <span>read-child</span><span>bash-child</span>
    </ToolRunGroup>)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
})

it('does not auto-close when a mounted running group completes', () => {
    setMessageParts([
        part(block('Read', { state: 'running', completedAt: null })),
        part(block('Bash', { state: 'running', completedAt: null }))
    ])
    const view = render(<ToolRunGroup startIndex={0} endIndex={1}><span>body</span><span>tail</span></ToolRunGroup>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')

    setMessageParts([part(block('Read')), part(block('Bash'))])
    view.rerender(<ToolRunGroup startIndex={0} endIndex={1}><span>body</span><span>tail</span></ToolRunGroup>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
})

it('renders a singleton without a group wrapper', () => {
    setMessageParts([part(block('Read'))])
    const { container } = render(<ToolRunGroup startIndex={0} endIndex={0}><span>only</span></ToolRunGroup>)
    expect(screen.getByText('only')).toBeInTheDocument()
    expect(container.querySelector('[data-tool-run-group]')).toBeNull()
})
```

- [ ] **Step 2: Run RED**

```bash
cd web && bun run test src/components/ToolCard/ToolRunGroup.test.tsx
```

Expected: FAIL because group/context files do not exist.

- [ ] **Step 3: Implement context**

```tsx
const ToolRunLayoutContext = createContext(false)
export function ToolRunLayoutProvider(props: { children: ReactNode }) {
    return <ToolRunLayoutContext.Provider value>{props.children}</ToolRunLayoutContext.Provider>
}
export function useToolRunLayout(): boolean {
    return useContext(ToolRunLayoutContext)
}
```

- [ ] **Step 4: Implement group partition/render**

```tsx
function ChevronIcon(props: { open: boolean }) {
    return <span aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', props.open && 'rotate-90')}>›</span>
}

function useRunClock(active: boolean): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!active) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [active])
    return now
}

function RoutineToolRun(props: PropsWithChildren<{ id: string; blocks: ToolCallBlock[] }>) {
    const { t } = useTranslation()
    const { metadata } = useHappyChatContext()
    const running = props.blocks.some((block) => block.tool.state === 'running' || block.tool.state === 'pending')
    const [open, setOpen] = useState(() => running)
    const regionId = useId()
    const now = useRunClock(running)
    const durationMs = getToolRunDurationMs(props.blocks, now)
    const duration = durationMs === null ? null : durationMs < 1000 ? '<1s' : `${Math.round(durationMs / 1000)}s`
    const titles = props.blocks.map((block) => getToolPresentation({
        toolName: block.tool.name, input: block.tool.input, result: block.tool.result,
        childrenCount: block.children.length, description: block.tool.description, metadata, t
    }).title)
    const statusLabel = t(running ? 'tool.group.actionsRunning' : 'tool.group.actionsCompleted', {
        count: props.blocks.length
    })

    return (
        <div
            data-testid="tool-run-group"
            data-tool-run-group
            data-tool-run-id={props.id}
            className="my-2 w-full max-w-[600px] min-w-0 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)]"
        >
            <button
                type="button"
                aria-expanded={open}
                aria-controls={regionId}
                aria-label={t('tool.group.toggle', { status: statusLabel })}
                onClick={() => setOpen((value) => !value)}
                className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <ChevronIcon open={open} />
                <span className="shrink-0 text-xs font-semibold">{statusLabel}</span>
                {duration ? (
                    <span aria-label={t('tool.group.duration', { duration })} className="shrink-0 rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--app-hint)]">
                        {duration}
                    </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--app-hint)]">
                    {titles.join(' · ')}
                </span>
                <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', running ? 'bg-amber-500' : 'bg-emerald-500')} />
            </button>
            <div id={regionId} hidden={!open} className="min-w-0 border-t border-[var(--app-border)] p-2">
                <ToolRunLayoutProvider>{props.children}</ToolRunLayoutProvider>
            </div>
        </div>
    )
}

export function ToolRunGroup({ startIndex, endIndex, children }: PropsWithChildren<{
    startIndex: number
    endIndex: number
}>) {
    const parts = useAssistantState(({ message }) => message.content
        .slice(startIndex, endIndex + 1)
        .map((part) => ({ artifact: part.type === 'tool-call' ? part.artifact : undefined })))
    const childArray = Children.toArray(children)
    const segments = partitionToolRunParts(parts)

    return segments.map((segment) => {
        if (segment.kind === 'single') {
            return <Fragment key={`single:${startIndex + segment.startOffset}`}>{childArray[segment.startOffset]}</Fragment>
        }
        return (
            <RoutineToolRun key={segment.id} id={segment.id} blocks={segment.blocks}>
                {childArray.slice(segment.startOffset, segment.endOffset + 1)}
            </RoutineToolRun>
        )
    })
}
```

Do not add an effect that closes `open` when `running` becomes false. The lazy initializer is the only automatic disclosure decision per mount.

- [ ] **Step 5: Register group and row context**

Add `ToolGroup: ToolRunGroup` to `MESSAGE_PART_COMPONENTS`:

```tsx
const MESSAGE_PART_COMPONENTS = {
    Text: MarkdownText,
    Reasoning,
    ReasoningGroup,
    ToolGroup: ToolRunGroup,
    tools: TOOL_COMPONENTS
} as const
```

In `HappyToolMessage`, call `useToolRunLayout()` once and pass the compact mode only inside the provider:

```tsx
const grouped = useToolRunLayout()
<ToolCard
    api={ctx.api}
    sessionId={ctx.sessionId}
    metadata={ctx.metadata}
    disabled={ctx.disabled}
    onDone={ctx.onRefresh}
    block={block}
    displayMode={grouped ? 'group-row' : 'card'}
/>
```

Do not apply this mode to the fallback renderer for artifacts that fail `isToolCallBlock`; CLI pseudo-tool parts already have their dedicated renderer. Standalone Task/permission/children behavior stays unchanged.

- [ ] **Step 6: Verify and commit**

```bash
cd web && bun run test src/components/ToolCard/toolRunModel.test.ts src/components/ToolCard/ToolRunGroup.test.tsx
cd web && bun run typecheck
git add web/src/components/ToolCard/toolRunContext.tsx web/src/components/ToolCard/ToolRunGroup.tsx web/src/components/ToolCard/ToolRunGroup.test.tsx web/src/components/AssistantChat/messages/AssistantMessage.tsx web/src/components/AssistantChat/messages/ToolMessage.tsx
git commit -m "feat(web): group consecutive tool parts at render time"
```

---

### Task 4: Group-row, Apply/Diff và output accordion

**Files:**
- Modify: `web/src/components/ToolCard/ToolCard.tsx:269-513`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx`
- Modify: `web/src/components/ToolCard/views/CodexPatchView.tsx`

**Interfaces:**
- Adds: `displayMode?: 'card' | 'group-row'`; default card unchanged.
- Consumes: `getToolExpansionKind(block)`.
- Preserves: existing Radix details dialog and standalone permission/question footers.

- [ ] **Step 1: Write failing interaction tests**

First extend the existing test helper without changing its default path:

```tsx
function toolCardElement(block: ToolCallBlock, displayMode: 'card' | 'group-row' = 'card') {
    return (
        <I18nProvider>
            <ToolCard
                api={api} sessionId="session-1" metadata={null}
                disabled={false} onDone={vi.fn()}
                block={block} displayMode={displayMode}
            />
        </I18nProvider>
    )
}

function renderTool(
    block: ToolCallBlock,
    options: { locale?: 'en' | 'vi-VN' | 'zh-CN'; displayMode?: 'card' | 'group-row' } = {}
) {
    localStorage.setItem('hapi-lang', options.locale ?? 'en')
    return render(toolCardElement(block, options.displayMode))
}
```

```tsx
it('keeps no-output rows compact but preserves details dialog', () => {
    renderTool(makeToolBlock('Read', { file_path: '/tmp/example.ts' }), { displayMode: 'group-row' })
    expect(screen.queryByRole('button', { name: /show output/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /example\.ts/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('/tmp/example.ts')
})

it('opens terminal output at full width with a 300px cap', () => {
    const { container } = renderTool(makeToolBlock('Bash', { command: 'printf ready' }, undefined, {
        result: { stdout: 'ready\n', stderr: '', exitCode: 0 }
    }), { displayMode: 'group-row' })
    fireEvent.click(screen.getByRole('button', { name: /show output/i }))
    expect(container.querySelector('[data-tool-inline-output]')).toHaveClass('w-full', 'max-h-[300px]', 'overflow-auto')
})
```

```tsx
it('shows Apply Changes files without an empty accordion', () => {
    renderTool(makeToolBlock('CodexPatch', arrayPatchPayload), { displayMode: 'group-row' })
    expect(screen.getByText('plan.md')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show output/i })).toBeNull()
})

it('expands valid Diff input and keeps malformed Diff dialog-only', () => {
    const valid = renderTool(
        makeToolBlock('CodexDiff', { unified_diff: oneFileDiff }),
        { displayMode: 'group-row' }
    )
    const outputButton = screen.getByRole('button', { name: /show output/i })
    expect(outputButton).toHaveAttribute('aria-expanded', 'false')
    expect(outputButton).toHaveAttribute('aria-controls')
    fireEvent.click(outputButton)
    expect(screen.getByRole('region', { name: /diff output/i })).toHaveTextContent('old')
    valid.unmount()

    const malformed = renderTool(
        makeToolBlock('CodexDiff', { unified_diff: 'not a diff' }),
        { displayMode: 'group-row' }
    )
    expect(screen.queryByRole('button', { name: /show output/i })).toBeNull()
    expect(malformed.container.querySelector('button button')).toBeNull()
})
```

- [ ] **Step 2: Run RED**

```bash
cd web && bun run test src/components/ToolCard/ToolCard.test.tsx
```

Expected: FAIL because `group-row` does not exist.

- [ ] **Step 3: Add group-row branch after building existing `detailsDialog`**

Extend the prop type and create local disclosure state before either render branch. Hooks stay unconditional:

```tsx
type ToolCardDisplayMode = 'card' | 'group-row'

type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
    displayMode?: ToolCardDisplayMode
}

const displayMode = props.displayMode ?? 'card'
const expansionKind = getToolExpansionKind(props.block)
const [outputOpen, setOutputOpen] = useState(false)
const outputId = useId()
```

After constructing the existing `detailsDialog`, return this branch when `displayMode === 'group-row'`. Controls are siblings, never nested buttons; Diff input uses `FullToolView` so it renders the actual diff rather than only its summary:

```tsx
if (displayMode === 'group-row') return (
<div data-tool-display="group-row" data-tool-block-id={props.block.id} className="w-full min-w-0">
    <div className="flex min-h-10 w-full min-w-0 items-center gap-1 rounded-md hover:bg-[var(--app-subtle-bg)]">
        <Dialog>
            <DialogTrigger asChild>
                <button type="button" className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                    {presentation.icon}
                    <span className="shrink-0 text-xs font-medium">{toolTitle}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--app-hint)]">{subtitle}</span>
                    <span className={statusColorClass(props.block.tool.state)}><StatusIcon state={props.block.tool.state} /></span>
                </button>
            </DialogTrigger>
            {detailsDialog}
        </Dialog>
        {expansionKind ? (
            <button
                type="button"
                aria-expanded={outputOpen}
                aria-controls={outputId}
                aria-label={t(outputOpen ? 'tool.group.hideOutput' : 'tool.group.showOutput')}
                onClick={() => setOutputOpen((value) => !value)}
                className="grid min-h-10 min-w-10 shrink-0 place-items-center rounded-md text-[var(--app-hint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <DetailsIcon />
            </button>
        ) : null}
    </div>
    {toolName === 'CodexPatch' && FullToolView ? (
        <div data-tool-patch-files className="px-7 pb-1 text-xs text-[var(--app-hint)]">
            <FullToolView block={props.block} metadata={props.metadata} surface="inline" t={t} />
        </div>
    ) : null}
    {expansionKind ? (
        <div
            id={outputId}
            hidden={!outputOpen}
            role="region"
            aria-label={t('tool.group.outputRegion', { tool: toolTitle })}
            data-tool-inline-output
            className="w-full min-w-0 max-h-[300px] overflow-auto overscroll-contain"
        >
            {expansionKind === 'input' && FullToolView
                ? <FullToolView block={props.block} metadata={props.metadata} surface="dialog" t={t} />
                : <ResultToolView block={props.block} metadata={props.metadata} surface="dialog" t={t} />}
        </div>
    ) : null}
</div>
)
```

The output region deliberately passes `surface="dialog"` to existing view components so long logs/diffs are not internally truncated; the surrounding inline region owns the 300px scrolling behavior.

Make `CodexPatchView` surface-aware so Apply Changes shows at most three basenames inline while its dialog keeps every file:

```tsx
const visible = props.surface === 'inline' ? files.slice(0, 3) : files
const remaining = files.length - visible.length

return (
    <div className="flex flex-col gap-1">
        {visible.map((file) => {
            const display = resolveDisplayPath(file.path, props.metadata)
            return <div key={file.path} title={file.path} className="truncate font-mono text-xs text-[var(--app-hint)]">{basename(display)}</div>
        })}
        {remaining > 0 ? <div className="text-xs text-[var(--app-hint)]">{t('tool.moreFiles', { count: remaining })}</div> : null}
    </div>
)
```

Standalone card path remains behaviorally unchanged when `displayMode` is absent.

Add the same `data-tool-block-id={props.block.id}` attribute to the existing standalone `<Card>` root. This is a non-visual test/debug hook used to prove that regrouping never duplicates or removes a tool.

- [ ] **Step 4: Verify and commit**

```bash
cd web && bun run test src/components/ToolCard/ToolCard.test.tsx src/components/ToolCard/views/CodexPatchView.test.tsx src/components/ToolCard/views/CodexDiffView.test.tsx
cd web && bun run typecheck
git add web/src/components/ToolCard/ToolCard.tsx web/src/components/ToolCard/ToolCard.test.tsx web/src/components/ToolCard/views/CodexPatchView.tsx
git commit -m "feat(web): render compact grouped tool rows"
```

---

### Task 5: Reasoning disclosure và i18n/a11y

**Files:**
- Modify: `web/src/components/assistant-ui/reasoning.tsx:1-105`
- Modify: `web/src/components/assistant-ui/reasoning.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`
- Modify: `web/src/components/ToolCard/ToolCard.test.tsx:321-355`

**Interfaces:**
- Preserves: current `ReasoningGroup` state lifecycle.
- Adds keys: `tool.group.actionsCompleted`, `tool.group.actionsRunning`, `tool.group.toggle`, `tool.group.duration`, `tool.group.showOutput`, `tool.group.hideOutput`, `tool.group.outputRegion`, `reasoning.toggle`, `reasoning.streaming`.
- Reuses: `tool.title.reasoning` for visible label.

- [ ] **Step 1: Update tests first**

```tsx
it('renders a compact unboxed disclosure', () => {
    mockMessage({ status: { type: 'complete' }, content: [] })
    const { container } = render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    const trigger = screen.getByRole('button', { name: /reasoning/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveClass('w-full', 'border', 'bg-[var(--app-bg)]')
    expect(container.querySelector('[data-reasoning-body]')).not.toHaveClass('border-l-2')
})
```

Keep the existing semantic click and reduced-motion tests, then add lifecycle and linkage coverage:

```tsx
it('auto-opens while streaming and does not close on completion', () => {
    mockMessage({ status: { type: 'running' }, content: [{ type: 'reasoning', text: 'Working' }] })
    const view = render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    const trigger = screen.getByRole('button', { name: /reasoning/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    mockMessage({ status: { type: 'complete' }, content: [{ type: 'reasoning', text: 'Done' }] })
    view.rerender(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
})

it('links the disclosure to its body', () => {
    mockMessage({ status: { type: 'complete' }, content: [] })
    const { container } = render(<ReasoningGroup><span>Body</span></ReasoningGroup>)
    const trigger = screen.getByRole('button', { name: /reasoning/i })
    const body = container.querySelector('[data-reasoning-body]')
    expect(trigger).toHaveAttribute('aria-controls', body?.id)
})
```

- [ ] **Step 2: Run RED**

```bash
cd web && bun run test src/components/assistant-ui/reasoning.test.tsx
```

Expected: FAIL on current full-width border/background.

- [ ] **Step 3: Implement approved style**

```tsx
import { useEffect, useId, useState, type FC, type PropsWithChildren } from 'react'
import { useTranslation } from '@/lib/use-translation'

export const ReasoningGroup: FC<PropsWithChildren> = ({ children }) => {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const contentId = useId()
    const message = useMessage()
    const isStreaming = message.status?.type === 'running'
        && message.content.length > 0
        && message.content[message.content.length - 1]?.type === 'reasoning'

    useEffect(() => {
        if (isStreaming) setIsOpen(true)
    }, [isStreaming])

    return <div className="aui-reasoning-group my-1">
<button
    type="button"
    aria-expanded={isOpen}
    aria-controls={contentId}
    aria-label={isStreaming ? t('reasoning.streaming') : t('reasoning.toggle')}
    onClick={() => setIsOpen((value) => !value)}
    className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
>
    <ChevronIcon open={isOpen} />
    <span>{t('tool.title.reasoning')}</span>
    {isStreaming ? <ShimmerDot /> : null}
</button>
<div id={contentId} hidden={!isOpen} data-reasoning-body className={cn(
    'overflow-hidden transition-all duration-200 motion-reduce:transition-none',
    isOpen ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
)}>
    <div className="pl-4 pt-1">{children}</div>
</div>
    </div>
}
```

- [ ] **Step 4: Add all locale values and coverage**

Add these exact values alongside the existing tool labels:

```ts
// en.ts
'tool.group.actionsCompleted': '{count} actions completed',
'tool.group.actionsRunning': '{count} actions running',
'tool.group.toggle': 'Toggle tool group: {status}',
'tool.group.duration': 'Duration: {duration}',
'tool.group.showOutput': 'Show output',
'tool.group.hideOutput': 'Hide output',
'tool.group.outputRegion': '{tool} output',
'reasoning.toggle': 'Toggle reasoning',
'reasoning.streaming': 'Reasoning in progress',

// vi-VN.ts
'tool.group.actionsCompleted': '{count} thao tác đã hoàn tất',
'tool.group.actionsRunning': '{count} thao tác đang chạy',
'tool.group.toggle': 'Mở hoặc đóng nhóm công cụ: {status}',
'tool.group.duration': 'Thời lượng: {duration}',
'tool.group.showOutput': 'Hiện kết quả',
'tool.group.hideOutput': 'Ẩn kết quả',
'tool.group.outputRegion': 'Kết quả của {tool}',
'reasoning.toggle': 'Mở hoặc đóng phần lập luận',
'reasoning.streaming': 'Đang lập luận',

// zh-CN.ts
'tool.group.actionsCompleted': '已完成 {count} 个操作',
'tool.group.actionsRunning': '正在运行 {count} 个操作',
'tool.group.toggle': '展开或收起工具组：{status}',
'tool.group.duration': '用时：{duration}',
'tool.group.showOutput': '显示输出',
'tool.group.hideOutput': '隐藏输出',
'tool.group.outputRegion': '{tool} 输出',
'reasoning.toggle': '展开或收起推理',
'reasoning.streaming': '正在推理',
```

Extend the existing locale coverage array with:

```ts
keys.push(
    'tool.group.actionsCompleted',
    'tool.group.actionsRunning',
    'tool.group.toggle',
    'tool.group.duration',
    'tool.group.showOutput',
    'tool.group.hideOutput',
    'tool.group.outputRegion',
    'reasoning.toggle',
    'reasoning.streaming'
)

for (const dictionary of [en, viVN, zhCN]) {
    for (const key of keys) {
        expect(dictionary[key]).toEqual(expect.any(String))
        expect(dictionary[key].trim().length).toBeGreaterThan(0)
    }
}
```

Preserve all entries already in `keys`. No component may hard-code group/reasoning/status/output labels.

- [ ] **Step 5: Verify and commit**

```bash
cd web && bun run test src/components/assistant-ui/reasoning.test.tsx src/components/ToolCard/ToolCard.test.tsx src/components/ToolCard/ToolRunGroup.test.tsx
cd web && bun run typecheck
git add web/src/components/assistant-ui/reasoning.tsx web/src/components/assistant-ui/reasoning.test.tsx web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts web/src/components/ToolCard/ToolCard.test.tsx web/src/components/ToolCard/ToolRunGroup.test.tsx
git commit -m "feat(web): polish reasoning and tool group accessibility"
```

---

### Task 6: Runtime integration, visual verification và final gate

**Files:**
- Create: `web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx`
- Modify only files proven defective by integration; do not broaden scope.

**Interfaces:**
- Uses actual `AssistantRuntimeProvider`, `ThreadPrimitive.Messages`, message components and `HappyChatProvider`.
- Proves real content order, ToolGroup boundaries, CLI safety, lifecycle and responsive dimensions.

- [ ] **Step 1: Add actual-runtime integration harness**

Use `useHappyRuntime` itself so the test exercises `ChatBlock[] → useExternalMessageConverter → merged assistant content → MessagePrimitive.Content` rather than hand-building a runtime message:

```tsx
const api = {
    updateTeamMentionStatus: vi.fn().mockResolvedValue(undefined)
} as unknown as ApiClient

function toolBlock(
    name: string,
    input: unknown = {},
    overrides: Partial<ToolCallBlock['tool']> = {}
): ToolCallBlock {
    return {
        kind: 'tool-call', id: `block-${name}`, localId: null, createdAt: 1000,
        children: [],
        tool: {
            id: `tool-${name}`, name, input, state: 'completed', createdAt: 1000,
            startedAt: 1000, completedAt: 2000, description: null, result: null,
            ...overrides
        }
    }
}

const threadComponents = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

function RuntimeHarness(props: { blocks: readonly ChatBlock[] }) {
    const runtime = useHappyRuntime({
        session: { active: true, thinking: false } as Session,
        blocks: props.blocks,
        isSending: false,
        onSendMessage: vi.fn(),
        onAbort: async () => undefined
    })
    return (
        <I18nProvider>
            <AssistantRuntimeProvider runtime={runtime}>
                <HappyChatProvider value={{
                    api, sessionId: 'session-1', metadata: null,
                    disabled: false, onRefresh: vi.fn()
                }}>
                    <ThreadPrimitive.Root>
                        <ThreadPrimitive.Messages components={threadComponents} />
                    </ThreadPrimitive.Root>
                </HappyChatProvider>
            </AssistantRuntimeProvider>
        </I18nProvider>
    )
}

const blocks: ChatBlock[] = [
    { kind: 'agent-reasoning', id: 'reason', localId: null, createdAt: 1, text: 'reason-before-tools' },
    toolBlock('Read', { file_path: '/workspace/a.ts' }),
    toolBlock('Bash', { command: 'printf ready' }, { result: { stdout: 'ready', stderr: '', exitCode: 0 } }),
    { kind: 'agent-text', id: 'middle', localId: null, createdAt: 4, text: 'text-between-runs' },
    toolBlock('Grep', { pattern: 'needle' }, { result: 'needle:1' }),
    toolBlock('Glob', { pattern: '**/*.ts' }, { result: 'a.ts' }),
    { kind: 'cli-output', id: 'assistant-cli', localId: null, createdAt: 7, source: 'assistant', text: 'Exit code: 0\nOutput:\nassistant-cli-marker' },
    toolBlock('CodexPatch', { changes: [{ path: '/workspace/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b' }] }),
    toolBlock('CodexDiff', { unified_diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b' }),
    { kind: 'agent-text', id: 'after', localId: null, createdAt: 10, text: 'text-after-tools' },
    { kind: 'agent-event', id: 'event', createdAt: 11, event: { type: 'message', message: 'event-marker' } },
    {
        kind: 'team-mention', id: 'mention', localId: null, createdAt: 12,
        requestId: 'request-1', teamChatId: 'team-1', sourceMessageId: 'source-1',
        text: 'team-mention-marker', status: 'delivered'
    },
    { kind: 'cli-output', id: 'user-cli', localId: null, createdAt: 13, source: 'user', text: 'user-cli-marker' }
]

it('preserves every mixed stream marker and creates only eligible groups', () => {
    const { container } = render(<RuntimeHarness blocks={blocks} />)
    for (const marker of [
        'reason-before-tools', 'text-between-runs', 'assistant-cli-marker',
        'text-after-tools', 'event-marker', 'team-mention-marker', 'user-cli-marker'
    ]) {
        expect((container.textContent ?? '').split(marker)).toHaveLength(2)
    }
    expect(container.querySelectorAll('[data-cli-output-part]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-tool-run-group]')).toHaveLength(3)

    const text = container.textContent ?? ''
    expect(text.indexOf('reason-before-tools')).toBeLessThan(text.indexOf('text-between-runs'))
    expect(text.indexOf('text-between-runs')).toBeLessThan(text.indexOf('assistant-cli-marker'))
    expect(text.indexOf('assistant-cli-marker')).toBeLessThan(text.indexOf('text-after-tools'))
    expect(text.indexOf('text-after-tools')).toBeLessThan(text.indexOf('event-marker'))
})
```

```tsx
function toolIds(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-tool-block-id]'))
        .map((node) => node.dataset.toolBlockId ?? '')
}

it('keeps tool IDs ordered through append and late state boundaries', () => {
    const readRunning = toolBlock('Read', {}, { state: 'running', completedAt: null })
    const view = render(<RuntimeHarness blocks={[readRunning]} />)
    expect(toolIds(view.container)).toEqual(['block-Read'])

    const bashRunning = toolBlock('Bash', {}, { state: 'running', completedAt: null })
    view.rerender(<RuntimeHarness blocks={[readRunning, bashRunning]} />)
    expect(toolIds(view.container)).toEqual(['block-Read', 'block-Bash'])
    const groupTrigger = view.container.querySelector('[data-tool-run-group] > button')
    expect(groupTrigger).toHaveAttribute('aria-expanded', 'true')

    view.rerender(<RuntimeHarness blocks={[toolBlock('Read'), toolBlock('Bash')]} />)
    expect(toolIds(view.container)).toEqual(['block-Read', 'block-Bash'])
    expect(groupTrigger).toHaveAttribute('aria-expanded', 'true')

    view.rerender(<RuntimeHarness blocks={[
        toolBlock('Read', {}, { state: 'error', result: 'failed' }),
        toolBlock('Bash')
    ]} />)
    expect(toolIds(view.container)).toEqual(['block-Read', 'block-Bash'])
    expect(view.container.querySelector('[data-tool-run-group]')).toBeNull()

    view.rerender(<RuntimeHarness blocks={[
        toolBlock('Read'),
        toolBlock('Bash', {}, { permission: { id: 'permission-1', status: 'pending' } })
    ]} />)
    expect(toolIds(view.container)).toEqual(['block-Read', 'block-Bash'])
})

it('allows pagination remount to reset disclosure but not ordered content', () => {
    const first = render(<RuntimeHarness blocks={blocks} />)
    const before = toolIds(first.container)
    const beforeText = ['reason-before-tools', 'text-between-runs', 'assistant-cli-marker', 'text-after-tools']
        .map((marker) => (first.container.textContent ?? '').indexOf(marker))
    first.unmount()

    const second = render(<RuntimeHarness blocks={blocks} />)
    expect(toolIds(second.container)).toEqual(before)
    expect(['reason-before-tools', 'text-between-runs', 'assistant-cli-marker', 'text-after-tools']
        .map((marker) => (second.container.textContent ?? '').indexOf(marker))).toEqual(beforeText)
})
```

```tsx
it('splits a late child without dropping the child or neighboring tool', () => {
    const read = toolBlock('Read')
    const withChild: ToolCallBlock = {
        ...read,
        children: [{
            kind: 'agent-text', id: 'child-text', localId: null,
            createdAt: 1001, text: 'late-child-marker'
        }]
    }
    const { container } = render(<RuntimeHarness blocks={[withChild, toolBlock('Bash')]} />)
    expect(toolIds(container)).toEqual(['block-Read', 'block-Bash'])
    expect(container.querySelector('[data-tool-run-group]')).toBeNull()
    expect((container.textContent ?? '').split('late-child-marker')).toHaveLength(2)
})
```

- [ ] **Step 2: Run integration test**

```bash
cd web && bun run test src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
```

Expected: PASS with every content item exactly once and in DOM order. Fix only the responsible Task 1-5 file if RED, then rerun its focused tests.

- [ ] **Step 3: GitNexus detect changes**

Invoke `mcp__gitnexus__detect_changes` with `scope: "all"`. Expected impact: web presentation/message rendering only; no hub/CLI/API/database flow. Investigate unexpected processes before commit.

- [ ] **Step 4: Commit integration regression**

```bash
git add web/src/components/AssistantChat/messages/AssistantMessage.integration.test.tsx
git commit -m "test(web): protect grouped tool stream fidelity"
```

- [ ] **Step 5: Full automated verification**

```bash
bun run test
bun typecheck
bun run build:web
git diff --check
```

Expected: zero test failures; all package typechecks pass; Vite/PWA build exits 0; diff check emits no output.

- [ ] **Step 6: Verify real UI against approved mockup**

Run branch web against local hub. Use Playwright on a real session containing reasoning, text, consecutive tools, Apply Changes, Diff and long Terminal output. Compare desktop/mobile screenshots with `docs/superpowers/artifacts/2026-07-17-safe-tool-grouping-mockup.html`.

Required assertions:

```js
const groups = page.locator('[data-tool-run-group]')
if (await groups.count() < 1) throw new Error('No tool run group rendered')
for (const group of await groups.all()) {
    const box = await group.boundingBox()
    if (box && box.width > 600.5) throw new Error(`Tool group too wide: ${box.width}`)
}
const output = page.locator('[data-tool-inline-output]').first()
if (await output.count()) {
    const box = await output.boundingBox()
    if (box && box.height > 300.5) throw new Error(`Inline output too tall: ${box.height}`)
}
if (await page.locator('[data-tool-display="activity-row"]').count()) {
    throw new Error('Legacy activity-row returned')
}
```

Also verify:
- text before/after groups visible and unboxed;
- completed group closed, running group open and stays open after completion;
- Apply Changes without result has no output chevron but dialog opens;
- Diff/Terminal expand full group width and scroll internally;
- Reasoning compact; keyboard Tab/Enter/Space works; no nested buttons;
- no page-level horizontal scroll at 375px; no console/page errors.

- [ ] **Step 7: Final review checkpoint**

Report actual changed-file map, focused/full test evidence, GitNexus affected processes, desktop/mobile screenshots and every deviation from the approved mockup. Do not merge until this checkpoint is reviewed.
