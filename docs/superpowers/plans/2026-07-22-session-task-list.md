# Session Task List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuẩn hóa checklist mới nhất của Claude Code, Codex và ACP vào `session.todos`, rồi hiển thị tiến độ và modal chi tiết trong session header.

**Architecture:** Hub là projector duy nhất: adapter provider tạo `SessionTodoUpdate`, reducer tạo snapshot hoàn chỉnh, persistence chỉ lưu snapshot hợp lệ và Web chỉ đọc `session.todos`. Không thêm bảng dữ liệu, lịch sử, suy luận stale, prompt nhắc agent hoặc thao tác sửa/clear.

**Tech Stack:** TypeScript strict, Bun, SQLite, Zod, React, Radix Dialog, TanStack Query, Vitest/Bun test.

## Global Constraints

- Claude tham chiếu: `2.1.217` với `TaskCreate`, `TaskUpdate`, `TaskList`; bỏ qua `TaskGet` và mọi message `isSidechain: true`.
- Codex đọc stored wire `name: "update_plan"`; ACP chỉ cam kết contract v1 `sessionUpdate: "plan"` và phải nhận `entries: []`.
- `session.todos` là snapshot duy nhất; không migration database, không lịch sử task, không `TeamState`, không clear/edit thủ công.
- Full snapshot phải validate nguyên khối, ID duy nhất; payload lỗi giữ nguyên state cũ.
- Chỉ persistence result `applied` phát `session-updated`; `unchanged` và `stale` là no-op, `error` phải log.
- Header thường hiển thị `Tasks 2/5`; compact hiển thị `2/5`; nhấn mở modal chỉ đọc.
- Dùng Bun từ repo root; TypeScript strict; chỉ thêm test cần thiết; không thêm dependency.

---

## File Map

| File | Thao tác | Trách nhiệm |
|---|---|---|
| `hub/src/sync/todos.ts` | Sửa | Adapter Claude/Codex/ACP, update chuẩn, reducer và replay backfill |
| `hub/src/sync/todos.test.ts` | Tạo | Unit test toàn bộ mapping, validation và reducer |
| `hub/src/store/sessions.ts` | Sửa | Trả kết quả persistence phân loại, chặn stale, bỏ duplicate write |
| `hub/src/store/sessionStore.ts` | Sửa | Public type/signature của `setSessionTodos` |
| `hub/src/store/sessions.todos.test.ts` | Tạo | Test `applied/unchanged/stale/error` và session `seq` |
| `hub/src/socket/handlers/cli/sessionHandlers.ts` | Sửa | Project message sau khi lưu, timestamp tăng đơn điệu, SSE đúng điều kiện |
| `hub/src/sync/sessionCache.ts` | Sửa | Replay tối đa 200 message khi chưa có snapshot; giữ todo khi merge session |
| `hub/src/sync/sessionModel.test.ts` | Sửa | Integration live ingest, same-millisecond, SSE và backfill |
| `cli/src/agent/backends/acp/AcpMessageHandler.ts` | Sửa | Forward plan rỗng, reject toàn payload plan lỗi |
| `cli/src/agent/backends/acp/AcpMessageHandler.test.ts` | Sửa | ACP/OpenCode seam test cho full, empty và malformed plan |
| `web/src/components/SessionTaskListControl.tsx` | Tạo | Trigger tiến độ và modal task chỉ đọc |
| `web/src/components/SessionTaskListControl.test.tsx` | Tạo | Test render, modal, trạng thái, accessibility và nội dung dài |
| `web/src/components/SessionHeader.tsx` | Sửa | Gắn control vào header thường và compact |
| `web/src/components/SessionHeader.test.tsx` | Sửa | Test tích hợp header thường/compact/empty |
| `web/src/lib/locales/en.ts` | Sửa | Chuỗi tiếng Anh |
| `web/src/lib/locales/vi-VN.ts` | Sửa | Chuỗi tiếng Việt |
| `web/src/lib/locales/zh-CN.ts` | Sửa | Chuỗi tiếng Trung |

## Canonical Interfaces

```ts
export type SessionTodoUpdate =
    | { type: 'replace'; todos: TodoItem[] }
    | { type: 'create'; todo: TodoItem }
    | { type: 'patch'; id: string; changes: Partial<Omit<TodoItem, 'id'>> }
    | { type: 'delete'; id: string }

export type SessionTodoExtraction = {
    updates: SessionTodoUpdate[]
    issues: Array<{ source: 'claude' | 'codex' | 'acp'; reason: string }>
}

export type SessionTodoReduction =
    | { kind: 'changed'; todos: TodoItem[] }
    | { kind: 'unchanged' }
    | { kind: 'rejected'; reason: string }

export function extractSessionTodoUpdates(
    messageContent: unknown,
    recentMessageContents?: readonly unknown[]
): SessionTodoExtraction

export function reduceSessionTodos(
    current: readonly TodoItem[] | null,
    updates: readonly SessionTodoUpdate[]
): SessionTodoReduction

export function replaySessionTodos(
    messages: readonly { content: unknown; createdAt: number }[]
): { todos: TodoItem[]; updatedAt: number; issues: SessionTodoExtraction['issues'] } | null

export type SetSessionTodosResult = 'applied' | 'unchanged' | 'stale' | 'error'
```

---

### Task 1: Hub provider adapters và reducer chuẩn

**Files:**
- Modify: `hub/src/sync/todos.ts:1-99`
- Create: `hub/src/sync/todos.test.ts`

**Interfaces:**
- Consumes: `TodoItem`, `TodosSchema`, HAPI role-wrapped message envelope.
- Produces: toàn bộ interface trong `Canonical Interfaces`; Task 3 chỉ gọi các hàm này.

- [ ] **Step 1: Index và kiểm tra blast radius trước khi sửa**

Run:

```bash
gitnexus analyze .
gitnexus impact extractTodoWriteTodosFromMessageContent --include-tests
```

Expected: repository được index; impact chỉ ra `sessionHandlers.ts` và `sessionCache.ts` là caller trực tiếp.

- [ ] **Step 2: Viết test thất bại cho reducer và full snapshot**

Tạo test table với các assertion cốt lõi sau; dùng fixture role-wrapped đúng wire hiện tại:

```ts
import { describe, expect, it } from 'bun:test'
import {
    extractSessionTodoUpdates,
    reduceSessionTodos,
    replaySessionTodos
} from './todos'

const pending = { id: '1', content: 'Build API', status: 'pending' as const, priority: 'medium' as const }

describe('session todo projection', () => {
    it('applies create, patch and delete without changing unaffected order', () => {
        const result = reduceSessionTodos(
            [pending, { ...pending, id: '2', content: 'Build UI' }],
            [
                { type: 'patch', id: '2', changes: { status: 'in_progress' } },
                { type: 'delete', id: '1' }
            ]
        )
        expect(result).toEqual({
            kind: 'changed',
            todos: [{ ...pending, id: '2', content: 'Build UI', status: 'in_progress' }]
        })
    })

    it('distinguishes no snapshot from an authoritative empty snapshot', () => {
        expect(reduceSessionTodos(null, [{ type: 'replace', todos: [] }]))
            .toEqual({ kind: 'changed', todos: [] })
    })

    it('rejects one malformed ACP entry instead of partially replacing', () => {
        const result = extractSessionTodoUpdates({
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'plan',
                    entries: [
                        { content: 'Valid', priority: 'medium', status: 'pending' },
                        { content: '', priority: 'medium', status: 'pending' }
                    ]
                }
            }
        })
        expect(result.updates).toEqual([])
        expect(result.issues).toHaveLength(1)
    })
})
```

Bổ sung cùng file các case bắt buộc: Claude `TodoWrite` full/empty; Codex `update_plan`; ACP full/empty; ID snapshot trùng; create duplicate giống hệt/no-op và khác dữ liệu/reject; patch/delete unknown; schema rejection.

- [ ] **Step 3: Chạy test để xác nhận đỏ**

Run: `cd hub && bun test src/sync/todos.test.ts`

Expected: FAIL vì các export chuẩn chưa tồn tại.

- [ ] **Step 4: Cài reducer tối thiểu, atomic validation và equality no-op**

Dùng reducer sau; `hasUniqueIds` phải kiểm tra `id.length > 0` và không lặp:

```ts
function hasUniqueIds(todos: readonly TodoItem[]): boolean {
    const ids = new Set<string>()
    for (const todo of todos) {
        if (!todo.id || ids.has(todo.id)) return false
        ids.add(todo.id)
    }
    return true
}

export function reduceSessionTodos(
    current: readonly TodoItem[] | null,
    updates: readonly SessionTodoUpdate[]
): SessionTodoReduction {
    if (updates.length === 0) return { kind: 'unchanged' }
    let next = current ? current.map((todo) => ({ ...todo })) : []
    let touched = false

    for (const update of updates) {
        if (update.type === 'replace') {
            next = update.todos.map((todo) => ({ ...todo }))
            touched = true
            continue
        }
        const index = next.findIndex((todo) => todo.id === update.id)
        if (update.type === 'create') {
            const existing = next.find((todo) => todo.id === update.todo.id)
            if (existing && JSON.stringify(existing) !== JSON.stringify(update.todo)) {
                return { kind: 'rejected', reason: `conflicting duplicate id: ${update.todo.id}` }
            }
            if (!existing) {
                next.push({ ...update.todo })
                touched = true
            }
            continue
        }
        if (index < 0) continue
        if (update.type === 'delete') {
            next.splice(index, 1)
            touched = true
            continue
        }
        const patched = { ...next[index], ...update.changes, id: update.id }
        if (JSON.stringify(patched) !== JSON.stringify(next[index])) {
            next[index] = patched
            touched = true
        }
    }

    const parsed = TodosSchema.safeParse(next)
    if (!parsed.success || !hasUniqueIds(parsed.data)) {
        return { kind: 'rejected', reason: 'invalid todo snapshot' }
    }
    if (!touched || (current !== null && JSON.stringify(current) === JSON.stringify(parsed.data))) {
        return { kind: 'unchanged' }
    }
    return { kind: 'changed', todos: parsed.data }
}
```

- [ ] **Step 5: Cài ba adapter và replay theo contract đã chốt**

Trong `extractSessionTodoUpdates`, unwrap envelope một lần rồi áp dụng mapping chính xác:

```ts
const STATUS_MAP: Record<string, TodoItem['status'] | undefined> = {
    pending: 'pending',
    inProgress: 'in_progress',
    in_progress: 'in_progress',
    completed: 'completed'
}

function makeSnapshotId(source: 'claude-todo' | 'codex-plan' | 'acp-plan', index: number): string {
    return `${source}-${index + 1}`
}

function validateSnapshot(candidate: unknown): TodoItem[] | null {
    const parsed = TodosSchema.safeParse(candidate)
    return parsed.success && hasUniqueIds(parsed.data) ? parsed.data : null
}
```

- Claude `TodoWrite`: map missing/empty ID thành `claude-todo-${index + 1}`, rồi `replace`.
- Claude tool result: chỉ đọc `data.type === "user"`, `isSidechain !== true`, block `tool_result` không lỗi; tìm `tool_use.id === tool_use_id` bằng cách quét ngược tối đa 200 `recentMessageContents` và bỏ assistant sidechain.
- `TaskCreateOutput`: `{task:{id,subject}}` → `create`, status `pending`, priority `medium`, lấy `activeForm` từ input nếu là string.
- `TaskUpdateOutput`: `success === true` → `delete` khi input status `deleted`; còn lại map `subject → content`, `activeForm`, và ba status hiển thị sang `patch`.
- `TaskListOutput`: `{tasks:[{id,subject,status,owner?,blockedBy}]}` → atomic `replace`, priority `medium`; JSON string hoặc toàn bộ text blocks ghép thành đúng một JSON value mới được parse.
- Codex: `content.type === "codex"`, `data.type === "tool-call"`, `data.name === "update_plan"`, đọc `data.input.plan`; map `step → content`, ID `codex-plan-${index + 1}`.
- ACP: `content.type === "codex"`, `data.type === "plan"`, đọc `entries`; map ID có sẵn hoặc `acp-plan-${index + 1}`.
- Mọi full snapshot phải gọi `validateSnapshot`; không dùng `filter` để cứu payload lỗi.
- `replaySessionTodos` duyệt message tăng dần, truyền `messages.slice(Math.max(0, index - 200), index).map(item => item.content)`, chỉ cập nhật `updatedAt` khi reducer trả `changed`, gom issue để Hub log.

Bổ sung test Claude chính xác cho TaskCreate success/failure/unmatched, TaskUpdate status/subject/delete/unknown, TaskList full/empty/malformed, result sidechain và call sidechain.

- [ ] **Step 6: Chạy test và commit**

Run: `cd hub && bun test src/sync/todos.test.ts`

Expected: PASS toàn bộ test projector.

```bash
git add hub/src/sync/todos.ts hub/src/sync/todos.test.ts
git commit -m "feat(hub): normalize session task updates"
```

---

### Task 2: Persistence phân loại kết quả

**Files:**
- Modify: `hub/src/store/sessions.ts:182-214`
- Modify: `hub/src/store/sessionStore.ts:1-65`
- Create: `hub/src/store/sessions.todos.test.ts`

**Interfaces:**
- Consumes: validated `TodoItem[]`, monotonic `todosUpdatedAt` từ Task 3.
- Produces: `SetSessionTodosResult`; Task 3 chỉ phát SSE khi nhận `applied`.

- [ ] **Step 1: Viết test thất bại cho bốn kết quả và seq**

```ts
import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('session todo persistence', () => {
    it('classifies applied, unchanged and stale without extra seq increments', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('todos', {}, null, 'default')
        const first = [{ id: '1', content: 'One', status: 'pending', priority: 'medium' }]

        expect(store.sessions.setSessionTodos(session.id, first, 100, 'default')).toBe('applied')
        const seqAfterApply = store.sessions.getSession(session.id)?.seq
        expect(store.sessions.setSessionTodos(session.id, first, 101, 'default')).toBe('unchanged')
        expect(store.sessions.setSessionTodos(session.id, [], 99, 'default')).toBe('stale')
        expect(store.sessions.getSession(session.id)?.seq).toBe(seqAfterApply)
        expect(store.sessions.setSessionTodos('missing', [], 102, 'default')).toBe('error')
    })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `cd hub && bun test src/store/sessions.todos.test.ts`

Expected: FAIL vì hàm hiện trả boolean.

- [ ] **Step 3: Thay boolean bằng kết quả phân loại**

```ts
export type SetSessionTodosResult = 'applied' | 'unchanged' | 'stale' | 'error'

export function setSessionTodos(
    db: Database,
    id: string,
    todos: unknown,
    todosUpdatedAt: number,
    namespace: string
): SetSessionTodosResult {
    try {
        const json = todos === null || todos === undefined ? null : JSON.stringify(todos)
        const current = db.prepare(`
            SELECT todos, todos_updated_at AS todosUpdatedAt
            FROM sessions WHERE id = ? AND namespace = ?
        `).get(id, namespace) as { todos: string | null; todosUpdatedAt: number | null } | undefined
        if (!current) return 'error'
        if (current.todosUpdatedAt !== null && current.todosUpdatedAt > todosUpdatedAt) return 'stale'
        if (current.todos === json) return 'unchanged'

        const result = db.prepare(`
            UPDATE sessions
            SET todos = @todos,
                todos_updated_at = @todos_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id AND namespace = @namespace
              AND (todos_updated_at IS NULL OR todos_updated_at <= @todos_updated_at)
        `).run({ id, namespace, todos: json, todos_updated_at: todosUpdatedAt, updated_at: todosUpdatedAt })
        return result.changes === 1 ? 'applied' : 'stale'
    } catch {
        return 'error'
    }
}
```

Import/export `SetSessionTodosResult` qua `sessionStore.ts` và đổi method signature tương ứng.

- [ ] **Step 4: Chạy test và commit**

Run: `cd hub && bun test src/store/sessions.todos.test.ts`

Expected: PASS; duplicate và stale không tăng `seq`.

```bash
git add hub/src/store/sessions.ts hub/src/store/sessionStore.ts hub/src/store/sessions.todos.test.ts
git commit -m "fix(hub): classify session todo persistence"
```

---

### Task 3: Live ingest, SSE và backfill

**Files:**
- Modify: `hub/src/socket/handlers/cli/sessionHandlers.ts:145-157`
- Modify: `hub/src/sync/sessionCache.ts:83-105,637-647`
- Modify: `hub/src/sync/sessionModel.test.ts`

**Interfaces:**
- Consumes: `extractSessionTodoUpdates`, `reduceSessionTodos`, `replaySessionTodos`, `SetSessionTodosResult`.
- Produces: persisted `session.todos` và duy nhất một `session-updated` cho mỗi snapshot thực sự đổi.

- [ ] **Step 1: Viết integration tests thất bại**

Trong harness `session model` hiện có, thêm các test:

```ts
function registerTestSessionHandlers(
    store: Store,
    onWebappEvent: (event: SyncEvent) => void
): Map<string, (payload: unknown) => void> {
    const handlers = new Map<string, (payload: unknown) => void>()
    registerSessionHandlers({
        on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
        to: () => ({ emit() {} })
    } as never, {
        store,
        resolveSessionAccess: (sessionId) => {
            const stored = store.sessions.getSessionByNamespace(sessionId, 'default')
            return stored ? { ok: true as const, value: stored } : { ok: false as const, reason: 'not-found' }
        },
        emitAccessError: () => {},
        onWebappEvent
    })
    return handlers
}

it('stores a projected plan after the source message and emits once', () => {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const cache = new SessionCache(store, createPublisher(events))
    const session = cache.getOrCreateSession('task-live', {}, null, 'default')
    const handlers = registerTestSessionHandlers(store, (event) => events.push(event))

    handlers.get('message')?.({
        sid: session.id,
        message: {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'tool-call', name: 'update_plan', input: { plan: [{ step: 'Ship', status: 'inProgress' }] } }
            }
        }
    })

    expect(store.messages.getMessages(session.id)).toHaveLength(1)
    expect(store.sessions.getSession(session.id)?.todos).toEqual([
        { id: 'codex-plan-1', content: 'Ship', status: 'in_progress', priority: 'medium' }
    ])
    expect(events.filter((event) => event.type === 'session-updated')).toHaveLength(1)
})
```

Thêm case duplicate no SSE, malformed no write, hai message cùng millisecond, Claude call/result correlation, và reload backfill từ 200 message.

- [ ] **Step 2: Chạy integration test để xác nhận đỏ**

Run: `cd hub && bun test src/sync/sessionModel.test.ts`

Expected: FAIL ở Codex/Claude projection và duplicate SSE.

- [ ] **Step 3: Tích hợp projector vào message handler**

Thay block TodoWrite bằng luồng sau ngay sau `addMessage`:

```ts
const recentMessageContents = store.messages
    .getMessages(sid, 200, msg.seq)
    .map((message) => message.content)
const extraction = extractSessionTodoUpdates(content, recentMessageContents)
for (const issue of extraction.issues) {
    console.warn(`Ignored ${issue.source} session todo update: ${issue.reason}`)
}

if (extraction.updates.length > 0) {
    const latest = store.sessions.getSession(sid)
    const currentTodos = latest?.todos === null
        ? null
        : (() => {
            const parsedTodos = TodosSchema.safeParse(latest?.todos)
            return parsedTodos.success ? parsedTodos.data : null
        })()
    const reduction = reduceSessionTodos(currentTodos, extraction.updates)
    if (reduction.kind === 'rejected') {
        console.warn(`Ignored invalid session todo reduction: ${reduction.reason}`)
    } else if (reduction.kind === 'changed') {
        const updatedAt = Math.max(msg.createdAt, (latest?.todosUpdatedAt ?? msg.createdAt - 1) + 1)
        const result = store.sessions.setSessionTodos(sid, reduction.todos, updatedAt, session.namespace)
        if (result === 'applied') {
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid } })
        } else if (result === 'error') {
            console.warn(`Failed to persist session todos for ${sid}`)
        }
    }
}
```

- [ ] **Step 4: Đổi backfill sang replay và cập nhật merge call-site**

```ts
if (stored.todos === null && !this.todoBackfillAttemptedSessionIds.has(sessionId)) {
    this.todoBackfillAttemptedSessionIds.add(sessionId)
    const replay = replaySessionTodos(this.store.messages.getMessages(sessionId, 200))
    if (replay) {
        for (const issue of replay.issues) {
            console.warn(`Ignored backfill todo update: ${issue.reason}`)
        }
        const result = this.store.sessions.setSessionTodos(
            sessionId,
            replay.todos,
            replay.updatedAt,
            stored.namespace
        )
        if (result === 'applied') stored = this.store.sessions.getSession(sessionId) ?? stored
        if (result === 'error') console.warn(`Failed to backfill session todos for ${sessionId}`)
    }
}
```

Ở merge session, chấp nhận `applied`, `unchanged`, `stale`; chỉ log `error`, không đổi merge nghiệp vụ khác.

- [ ] **Step 5: Chạy test và commit**

Run: `cd hub && bun test src/sync/todos.test.ts src/store/sessions.todos.test.ts src/sync/sessionModel.test.ts`

Expected: PASS; same-millisecond giữ đúng thứ tự, duplicate không tăng seq/SSE, reload phục hồi snapshot.

```bash
git add hub/src/socket/handlers/cli/sessionHandlers.ts hub/src/sync/sessionCache.ts hub/src/sync/sessionModel.test.ts
git commit -m "feat(hub): persist live session task snapshots"
```

---

### Task 4: ACP/OpenCode full-plan contract

**Files:**
- Modify: `cli/src/agent/backends/acp/AcpMessageHandler.ts:144-162,325-332`
- Modify: `cli/src/agent/backends/acp/AcpMessageHandler.test.ts`

**Interfaces:**
- Consumes: ACP v1 `sessionUpdate: "plan"`.
- Produces: `AgentMessage { type: 'plan', items: PlanItem[] }`, kể cả `items: []`; malformed tạo không message.

- [ ] **Step 1: Viết test thất bại cho empty và atomic malformed**

```ts
it('forwards an empty ACP plan and rejects a partially malformed plan', () => {
    const messages: AgentMessage[] = []
    const handler = new AcpMessageHandler((message) => messages.push(message))

    handler.handleUpdate({ sessionUpdate: ACP_SESSION_UPDATE_TYPES.plan, entries: [] })
    handler.handleUpdate({
        sessionUpdate: ACP_SESSION_UPDATE_TYPES.plan,
        entries: [
            { content: 'Valid', priority: 'medium', status: 'pending' },
            { content: '', priority: 'medium', status: 'pending' }
        ]
    })

    expect(messages).toEqual([{ type: 'plan', items: [] }])
})
```

Dùng payload đầu tiên làm OpenCode seam fixture vì đây chính là ACP v1 `session/update: plan` mà OpenCode backend chuyển vào handler; thêm một fixture full plan để khẳng định thứ tự và status được giữ nguyên.

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `cd cli && bunx vitest run src/agent/backends/acp/AcpMessageHandler.test.ts`

Expected: FAIL vì empty plan đang bị drop và malformed đang bị lọc từng entry.

- [ ] **Step 3: Parse atomic và emit empty plan**

```ts
function normalizePlanEntries(entries: unknown): PlanItem[] | null {
    if (!Array.isArray(entries)) return null
    const items: PlanItem[] = []
    for (const entry of entries) {
        if (!isObject(entry)) return null
        const content = asString(entry.content)
        const priority = asString(entry.priority)
        const status = asString(entry.status)
        if (!content) return null
        if (priority !== 'high' && priority !== 'medium' && priority !== 'low') return null
        if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return null
        items.push({ content, priority, status })
    }
    return items
}
```

Và đổi nhánh plan thành:

```ts
const items = normalizePlanEntries(update.entries)
if (items !== null) {
    this.onMessage({ type: 'plan', items })
}
```

- [ ] **Step 4: Chạy test và commit**

Run: `cd cli && bunx vitest run src/agent/backends/acp/AcpMessageHandler.test.ts`

Expected: PASS cho full, empty và malformed plan.

```bash
git add cli/src/agent/backends/acp/AcpMessageHandler.ts cli/src/agent/backends/acp/AcpMessageHandler.test.ts
git commit -m "fix(cli): preserve ACP plan snapshots"
```

---

### Task 5: Header task control và modal riêng

**Files:**
- Create: `web/src/components/SessionTaskListControl.tsx`
- Create: `web/src/components/SessionTaskListControl.test.tsx`
- Modify: `web/src/components/SessionHeader.tsx:1-15,318-390,500-565`
- Modify: `web/src/components/SessionHeader.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Consumes: `todos: TodoItem[] | null | undefined`, `compact?: boolean`.
- Produces: `SessionTaskListControl`; không mutation và không provider-specific logic.

- [ ] **Step 1: Viết component tests thất bại**

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionTaskListControl } from './SessionTaskListControl'

afterEach(cleanup)

const todos = [
    { id: '1', content: 'First task', status: 'completed' as const, priority: 'medium' as const },
    { id: '2', content: 'A very long second task that must wrap inside the mobile dialog', status: 'in_progress' as const, priority: 'high' as const }
]

describe('SessionTaskListControl', () => {
    it('hides empty snapshots and opens a read-only ordered dialog', () => {
        const { rerender } = render(<SessionTaskListControl todos={[]} />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        rerender(<SessionTaskListControl todos={todos} />)
        const trigger = screen.getByRole('button', { name: 'Session tasks: 1 of 2 completed' })
        expect(trigger).toHaveTextContent('Tasks')
        expect(trigger).toHaveTextContent('1/2')
        fireEvent.click(trigger)
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            expect.stringContaining('First task'),
            expect.stringContaining('A very long second task')
        ])
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
    })

    it('uses the compact counter without the Tasks label', () => {
        render(<SessionTaskListControl todos={todos} compact />)
        expect(screen.getByRole('button')).toHaveTextContent('1/2')
        expect(screen.getByRole('button')).not.toHaveTextContent('Tasks')
    })

    it('keeps a fully completed snapshot visible', () => {
        render(<SessionTaskListControl todos={todos.map((todo) => ({ ...todo, status: 'completed' as const }))} />)
        expect(screen.getByRole('button')).toHaveTextContent('Tasks')
        expect(screen.getByRole('button')).toHaveTextContent('2/2')
    })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `cd web && bunx vitest run src/components/SessionTaskListControl.test.tsx`

Expected: FAIL vì component chưa tồn tại.

- [ ] **Step 3: Tạo control bằng Dialog primitive hiện có**

Component phải dùng cấu trúc và class bắt buộc sau:

```tsx
export function SessionTaskListControl({ todos, compact = false }: {
    todos: TodoItem[] | null | undefined
    compact?: boolean
}) {
    const { t } = useTranslation()
    if (!todos || todos.length === 0) return null
    const completed = todos.filter((todo) => todo.status === 'completed').length
    const total = todos.length
    const label = t('session.tasks.trigger', { completed, total })

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button type="button" aria-label={label} title={label}
                    className={compact ? 'db-pinned__compact-action gap-1' : 'inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)]'}>
                    <span aria-hidden="true">☑</span>
                    {!compact ? <span className="hidden sm:inline">{t('session.tasks.label')}</span> : null}
                    <span>{completed}/{total}</span>
                </button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('session.tasks.title')}</DialogTitle>
                    <DialogDescription>{t('session.tasks.progress', { completed, total })}</DialogDescription>
                </DialogHeader>
                <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}
                    className="h-2 overflow-hidden rounded-full bg-[var(--app-secondary-bg)]">
                    <div className="h-full bg-[var(--app-link)]" style={{ width: `${Math.round((completed / total) * 100)}%` }} />
                </div>
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {todos.map((todo) => (
                        <li key={todo.id} className="flex min-w-0 gap-2 rounded-lg border border-[var(--app-border)] p-3">
                            <span aria-hidden="true">{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span>
                            <div className="min-w-0 flex-1">
                                <p className="break-words text-sm">{todo.content}</p>
                                <p className="text-xs text-[var(--app-hint)]">{t(`session.tasks.status.${todo.status}`)}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </DialogContent>
        </Dialog>
    )
}
```

Import `TodoItem` từ `@/types/api`, translation hook và Dialog primitives từ các path đang dùng bởi `SessionGoalControl`.

- [ ] **Step 4: Thêm i18n và gắn vào cả hai header**

Thêm cùng bộ key cho ba locale:

```ts
'session.tasks.label': 'Tasks',
'session.tasks.trigger': 'Session tasks: {completed} of {total} completed',
'session.tasks.title': 'Session tasks',
'session.tasks.progress': '{completed} of {total} completed',
'session.tasks.status.pending': 'Pending',
'session.tasks.status.in_progress': 'In progress',
'session.tasks.status.completed': 'Completed',
```

Bản Việt dùng `Công việc`, `Công việc trong phiên`, `Đang chờ`, `Đang làm`, `Hoàn thành`; bản Trung dùng `任务`, `会话任务`, `待处理`, `进行中`, `已完成`.

Trong `SessionHeader.tsx`:

```tsx
<SessionTaskListControl todos={session.todos} compact />
```

đặt trong `db-pinned__compact-actions` trước goal control; và:

```tsx
<SessionTaskListControl todos={session.todos} />
```

đặt ở header thường trước machine selector. Bổ sung test header: empty không có trigger; normal có `Tasks 1/2`; compact có `1/2` và mở cùng modal.

- [ ] **Step 5: Chạy web tests và commit**

Run:

```bash
cd web && bunx vitest run src/components/SessionTaskListControl.test.tsx src/components/SessionHeader.test.tsx
```

Expected: PASS; Dialog đóng bằng Escape và trả focus; long content có `break-words`, list có `max-h` và `overflow-y-auto`.

```bash
git add web/src/components/SessionTaskListControl.tsx web/src/components/SessionTaskListControl.test.tsx web/src/components/SessionHeader.tsx web/src/components/SessionHeader.test.tsx web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): show session task list modal"
```

---

### Task 6: Kiểm chứng toàn hệ thống và review phạm vi

**Files:**
- Review: toàn bộ diff từ Task 1-5
- Modify: chỉ file đã liệt kê nếu test hoặc review phát hiện lỗi thuộc feature

**Interfaces:**
- Consumes: mọi deliverable Task 1-5.
- Produces: bằng chứng typecheck/test và diff không vượt phạm vi.

- [ ] **Step 1: Cập nhật GitNexus và kiểm tra blast radius sau thay đổi**

Run:

```bash
gitnexus analyze .
gitnexus impact extractSessionTodoUpdates --include-tests
gitnexus impact setSessionTodos --include-tests
```

Expected: caller mới chỉ nằm trong Hub session ingestion/backfill; không có coupling với `TeamState` hoặc route/API mới.

- [ ] **Step 2: Chạy typecheck toàn workspace**

Run: `bun typecheck`

Expected: exit code 0, không có TypeScript error.

- [ ] **Step 3: Chạy toàn bộ test suite**

Run: `bun run test`

Expected: exit code 0 cho CLI và Hub; sau đó chạy riêng Web vì root test hiện không bao phủ Web:

```bash
cd web && bunx vitest run
```

Expected: exit code 0.

- [ ] **Step 4: Review diff và bảo vệ phạm vi**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
git log --oneline -5
```

Expected:
- Không whitespace error.
- Không sửa `_bmad-output/party-mode/memories/installed/.memlog.md`.
- Không migration/schema/API/TeamState/prompt/stale detection/manual clear/task history.
- Chỉ có năm commit feature từ Tasks 1-5; nếu có fix sau review, commit riêng bằng message mô tả lỗi thực tế.

- [ ] **Step 5: Ghi bằng chứng kiểm chứng trong báo cáo hoàn thành**

Báo cáo ngắn phải chứa:

```text
Luồng đạt được: Provider event → session.todos → SSE → header/modal
Test đã chạy: bun typecheck; bun run test; web vitest
Phạm vi không đổi: database schema, TeamState, prompt, task history, manual clear
Rủi ro còn lại: provider không phát event hoặc Claude output đổi shape thì HAPI giữ snapshot cũ
```
