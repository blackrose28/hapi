# Terminal Search and Snippets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện hai công cụ `Search` và `Snippets` trong thanh điều khiển terminal trên mobile, dùng chung cho terminal modal của session và terminal trong Editor.

**Architecture:** Search nằm hoàn toàn ở web và được bọc sau một adapter hẹp quanh `@xterm/addon-search`; mỗi `TerminalView` chỉ tạo một addon khi người dùng mở Search lần đầu. Snippets có catalog built-in ở web và CRUD custom snippet theo namespace qua Shared schema → Hub SQLite/REST/SSE → TanStack Query; việc chèn lệnh tiếp tục dùng `onWritePlainInput` hiện có và không tự chạy lệnh.

**Tech Stack:** TypeScript strict, React 19, xterm 6, `@xterm/addon-search`, TanStack Query 5, Hono, Bun SQLite, Zod 4, Vitest, Bun test.

---

## Phạm vi đã chốt

- Chỉ hiện dưới breakpoint `lg`, giống `TerminalControlDock` hiện tại.
- Search chỉ tìm trong buffer hiện có của xterm; không tăng scrollback 1.000 dòng.
- Snippet chỉ chèn đúng chuỗi lệnh; không thêm Enter, `\n` hoặc `\r`.
- Custom snippets lưu plaintext theo namespace, tối đa 200 mục.
- `History`, desktop controls, auto-run, biến mẫu, mã hóa, secret scanning, regex và whole-word nằm ngoài phạm vi.
- Không sửa CLI terminal transport, tmux, socket protocol terminal hoặc giới hạn buffer CLI.

## Bản đồ file dự kiến

| File/khối | Vai trò | Thay đổi |
|---|---|---|
| `shared/src/terminalSnippets.ts` | Contract dùng chung | Giới hạn, Zod schema, request/response type |
| `shared/src/schemas.ts` | Contract SSE | Thêm `terminal-snippets-updated` |
| `shared/src/index.ts` | Public exports | Xuất contract snippet |
| `hub/src/store/types.ts` | Kiểu dữ liệu SQLite | Thêm `StoredTerminalSnippet` |
| `hub/src/store/terminalSnippetStore.ts` | Persistence | CRUD theo namespace, thứ tự và quota |
| `hub/src/store/terminalSnippetStore.test.ts` | Store verification | Namespace, quota, update order, delete |
| `hub/src/store/index.ts` | Schema lifecycle | Schema v11, table/index, migration 10→11 |
| `hub/src/store/migration-v11.test.ts` | Migration verification | Fresh DB và v10 upgrade |
| `hub/src/web/routes/terminalSnippets.ts` | REST API | List/create/update/delete, validation, SSE |
| `hub/src/web/routes/terminalSnippets.test.ts` | Route verification | Auth namespace, limits, status, event |
| `hub/src/web/server.ts` | Route registration | Gắn routes dưới `/api` |
| `web/package.json`, `bun.lock` | Dependency | Thêm `@xterm/addon-search` tương thích xterm 6 |
| `web/src/api/client.ts` | HTTP client | CRUD methods và response parsing |
| `web/src/lib/query-keys.ts` | Cache identity | Thêm query key snippets |
| `web/src/hooks/queries/useTerminalSnippets.ts` | Query/mutations | Lazy fetch, cache update, pending/error |
| `web/src/hooks/queries/useTerminalSnippets.test.tsx` | Cache verification | Lazy load và mutation cache |
| `web/src/hooks/useSSE.ts`, `.test.ts` | Cross-client sync | Invalidate snippets khi nhận SSE |
| `web/src/components/Terminal/terminalSnippetCatalog.ts` | Built-in data | Catalog read-only theo nhóm |
| `web/src/components/Terminal/TerminalSnippetPanel.tsx` | Snippet UX | Filter, tabs, editor, delete, insert |
| `web/src/components/Terminal/TerminalSnippetPanel.test.tsx` | Snippet UI verification | Built-in/custom/error/form/insert |
| `web/src/components/Terminal/terminalSearch.ts` | Search contract | Adapter/status/result types và constants |
| `web/src/components/Terminal/useTerminalSearchAddon.ts` | Addon lifecycle | Lazy import, load, adapter, retry, cleanup |
| `web/src/components/Terminal/useTerminalSearchAddon.test.tsx` | Lifecycle verification | Load once, clear, dispose, retry |
| `web/src/components/Terminal/TerminalSearchPanel.tsx` | Search UX | Debounce, IME, count, case, previous/next |
| `web/src/components/Terminal/TerminalSearchPanel.test.tsx` | Search UI verification | Timers, IME, navigation, threshold |
| `web/src/components/Terminal/TerminalView.tsx`, `.test.tsx` | xterm owner | Kết nối search lifecycle với parent |
| `web/src/components/Terminal/TerminalControlDock.tsx`, `.test.tsx` | Shared mobile dock | Bật Search/Snippets và render floating panels |
| `web/src/components/Terminal/SessionTerminalTabs.tsx`, `.test.tsx` | Session terminal | Truyền API/search state, reset theo terminal |
| `web/src/components/editor/EditorTerminal.tsx`, `.test.tsx` | Editor terminal | Dùng cùng dock/panels/search lifecycle |
| `web/src/lib/locales/en.ts` | English copy | Search/snippet labels and messages |
| `web/src/lib/locales/vi-VN.ts` | Vietnamese copy | Search/snippet labels and messages |
| `web/src/lib/locales/zh-CN.ts` | Chinese copy | Search/snippet labels and messages |

## Task 1: Shared snippet contract và SSE event

**Files:**
- Create: `shared/src/terminalSnippets.ts`
- Create: `shared/src/terminalSnippets.test.ts`
- Modify: `shared/src/schemas.ts:350-445`
- Modify: `shared/src/index.ts:1-45`

- [ ] **Step 1: Viết test contract thất bại**

```ts
// shared/src/terminalSnippets.test.ts
import { describe, expect, it } from 'bun:test'
import {
    CreateTerminalSnippetInputSchema,
    TerminalSnippetSchema,
    UpdateTerminalSnippetInputSchema
} from './terminalSnippets'

describe('terminal snippet contract', () => {
    it('trims names and accepts multiline commands', () => {
        expect(CreateTerminalSnippetInputSchema.parse({
            name: '  Git status  ',
            command: 'git status --short\npwd',
            description: '  Inspect repository  '
        })).toEqual({
            name: 'Git status',
            command: 'git status --short\npwd',
            description: 'Inspect repository'
        })
    })

    it('rejects empty names, empty commands and values over their limits', () => {
        expect(() => CreateTerminalSnippetInputSchema.parse({ name: '', command: 'pwd' })).toThrow()
        expect(() => CreateTerminalSnippetInputSchema.parse({ name: 'pwd', command: '' })).toThrow()
        expect(() => UpdateTerminalSnippetInputSchema.parse({
            name: 'n'.repeat(81),
            command: 'x'
        })).toThrow()
        expect(() => CreateTerminalSnippetInputSchema.parse({
            name: 'name',
            command: 'x'.repeat(8_193)
        })).toThrow()
    })

    it('validates server-owned identity and timestamps', () => {
        expect(TerminalSnippetSchema.parse({
            id: 'snippet-1',
            name: 'Status',
            command: 'git status',
            description: null,
            createdAt: 10,
            updatedAt: 20
        }).id).toBe('snippet-1')
    })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `bun test shared/src/terminalSnippets.test.ts`

Expected: FAIL vì module `./terminalSnippets` chưa tồn tại.

- [ ] **Step 3: Thêm contract và event tối thiểu**

```ts
// shared/src/terminalSnippets.ts
import { z } from 'zod'

export const TERMINAL_SNIPPET_NAME_MAX = 80
export const TERMINAL_SNIPPET_COMMAND_MAX = 8_192
export const TERMINAL_SNIPPET_DESCRIPTION_MAX = 240
export const TERMINAL_SNIPPET_NAMESPACE_MAX_ITEMS = 200

const descriptionSchema = z.string()
    .trim()
    .max(TERMINAL_SNIPPET_DESCRIPTION_MAX)
    .optional()
    .nullable()
    .transform((value) => value || null)

export const TerminalSnippetSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(TERMINAL_SNIPPET_NAME_MAX),
    command: z.string().min(1).max(TERMINAL_SNIPPET_COMMAND_MAX),
    description: z.string().max(TERMINAL_SNIPPET_DESCRIPTION_MAX).nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
})

export const CreateTerminalSnippetInputSchema = z.object({
    name: z.string().trim().min(1).max(TERMINAL_SNIPPET_NAME_MAX),
    command: z.string().min(1).max(TERMINAL_SNIPPET_COMMAND_MAX),
    description: descriptionSchema
})

export const UpdateTerminalSnippetInputSchema = CreateTerminalSnippetInputSchema

export const TerminalSnippetsResponseSchema = z.object({
    snippets: z.array(TerminalSnippetSchema)
})

export const TerminalSnippetResponseSchema = z.object({
    snippet: TerminalSnippetSchema
})

export type TerminalSnippet = z.infer<typeof TerminalSnippetSchema>
export type CreateTerminalSnippetInput = z.infer<typeof CreateTerminalSnippetInputSchema>
export type UpdateTerminalSnippetInput = z.infer<typeof UpdateTerminalSnippetInputSchema>
export type TerminalSnippetsResponse = z.infer<typeof TerminalSnippetsResponseSchema>
export type TerminalSnippetResponse = z.infer<typeof TerminalSnippetResponseSchema>
```

Add to `SyncEventSchema` in `shared/src/schemas.ts`:

```ts
SessionEventBaseSchema.extend({
    type: z.literal('terminal-snippets-updated')
}),
```

Add to `shared/src/index.ts`:

```ts
export * from './terminalSnippets'
```

- [ ] **Step 4: Chạy contract tests và typecheck**

Run: `bun test shared/src/terminalSnippets.test.ts && bun run --cwd shared typecheck`

Expected: PASS; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add shared/src/terminalSnippets.ts shared/src/terminalSnippets.test.ts shared/src/schemas.ts shared/src/index.ts
git commit -m "feat(shared): define terminal snippet contract"
```

## Task 2: SQLite schema v11 và namespace-scoped store

**Files:**
- Create: `hub/src/store/terminalSnippetStore.ts`
- Create: `hub/src/store/terminalSnippetStore.test.ts`
- Create: `hub/src/store/migration-v11.test.ts`
- Modify: `hub/src/store/types.ts`
- Modify: `hub/src/store/index.ts:1-180,440-490`

- [ ] **Step 1: Viết store tests thất bại**

```ts
// hub/src/store/terminalSnippetStore.test.ts
import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('TerminalSnippetStore', () => {
    it('isolates list, update and delete by namespace', () => {
        const store = new Store(':memory:')
        const a = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'Status',
            command: 'git status',
            description: null
        })
        store.terminalSnippets.create({
            namespace: 'ns-b',
            name: 'Working tree',
            command: 'pwd',
            description: null
        })

        expect(store.terminalSnippets.list('ns-a').map((item) => item.id)).toEqual([a.id])
        expect(() => store.terminalSnippets.update({
            namespace: 'ns-b',
            id: a.id,
            name: 'Changed',
            command: 'pwd',
            description: null
        })).toThrow('TERMINAL_SNIPPET_NOT_FOUND')
        expect(store.terminalSnippets.delete('ns-b', a.id)).toBe(false)
    })

    it('keeps newest-created ordering when an older snippet is edited', () => {
        const store = new Store(':memory:')
        const older = store.terminalSnippets.create({
            namespace: 'default',
            name: 'Older',
            command: 'pwd',
            description: null,
            now: 10
        })
        const newer = store.terminalSnippets.create({
            namespace: 'default',
            name: 'Newer',
            command: 'ls',
            description: null,
            now: 20
        })
        store.terminalSnippets.update({
            namespace: 'default',
            id: older.id,
            name: 'Older edited',
            command: 'pwd',
            description: null,
            now: 30
        })

        expect(store.terminalSnippets.list('default').map((item) => item.id)).toEqual([
            newer.id,
            older.id
        ])
    })

    it('rejects the 201st snippet in one namespace', () => {
        const store = new Store(':memory:')
        for (let index = 0; index < 200; index += 1) {
            store.terminalSnippets.create({
                namespace: 'default',
                name: `Snippet ${index}`,
                command: 'pwd',
                description: null
            })
        }
        expect(() => store.terminalSnippets.create({
            namespace: 'default',
            name: 'Overflow',
            command: 'pwd',
            description: null
        })).toThrow('TERMINAL_SNIPPET_LIMIT_REACHED')
    })
})
```

Create `hub/src/store/migration-v11.test.ts` with two assertions:

```ts
import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

describe('Store v10 to v11 terminal snippets migration', () => {
    it('creates terminal_snippets in a fresh database', () => {
        const store = new Store(':memory:')
        expect(store.terminalSnippets.list('default')).toEqual([])
    })

    it('adds terminal_snippets while upgrading user_version 10', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-v11-'))
        const path = join(dir, 'hub.db')
        try {
            const db = new Database(path)
            db.exec('PRAGMA user_version = 10')
            db.close()
            const store = new Store(path)
            expect(store.terminalSnippets.list('default')).toEqual([])
            const check = new Database(path)
            expect((check.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11)
            check.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
```

- [ ] **Step 2: Chạy tests để xác nhận thất bại**

Run: `bun test hub/src/store/terminalSnippetStore.test.ts hub/src/store/migration-v11.test.ts`

Expected: FAIL vì `Store.terminalSnippets` chưa tồn tại.

- [ ] **Step 3: Thêm type, store, schema và migration**

Add to `hub/src/store/types.ts`:

```ts
export type StoredTerminalSnippet = {
    id: string
    namespace: string
    name: string
    command: string
    description: string | null
    createdAt: number
    updatedAt: number
}
```

Create `hub/src/store/terminalSnippetStore.ts`:

```ts
import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { TERMINAL_SNIPPET_NAMESPACE_MAX_ITEMS } from '@hapi/protocol'
import type { StoredTerminalSnippet } from './types'

type Row = {
    id: string
    namespace: string
    name: string
    command: string
    description: string | null
    created_at: number
    updated_at: number
}

function toStored(row: Row): StoredTerminalSnippet {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        command: row.command,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

export class TerminalSnippetStore {
    constructor(private readonly db: Database) {}

    list(namespace: string): StoredTerminalSnippet[] {
        const rows = this.db.query(`
            SELECT * FROM terminal_snippets
            WHERE namespace = ?
            ORDER BY created_at DESC, id DESC
        `).all(namespace) as Row[]
        return rows.map(toStored)
    }

    create(input: {
        namespace: string
        name: string
        command: string
        description: string | null
        now?: number
    }): StoredTerminalSnippet {
        const count = this.db.query(
            'SELECT COUNT(*) AS count FROM terminal_snippets WHERE namespace = ?'
        ).get(input.namespace) as { count: number }
        if (count.count >= TERMINAL_SNIPPET_NAMESPACE_MAX_ITEMS) {
            throw new Error('TERMINAL_SNIPPET_LIMIT_REACHED')
        }
        const id = randomUUID()
        const now = input.now ?? Date.now()
        this.db.query(`
            INSERT INTO terminal_snippets (
                id, namespace, name, command, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.namespace, input.name, input.command, input.description, now, now)
        return toStored(this.require(input.namespace, id))
    }

    update(input: {
        namespace: string
        id: string
        name: string
        command: string
        description: string | null
        now?: number
    }): StoredTerminalSnippet {
        const result = this.db.query(`
            UPDATE terminal_snippets
            SET name = ?, command = ?, description = ?, updated_at = ?
            WHERE namespace = ? AND id = ?
        `).run(
            input.name,
            input.command,
            input.description,
            input.now ?? Date.now(),
            input.namespace,
            input.id
        )
        if (result.changes === 0) throw new Error('TERMINAL_SNIPPET_NOT_FOUND')
        return toStored(this.require(input.namespace, input.id))
    }

    delete(namespace: string, id: string): boolean {
        return this.db.query(
            'DELETE FROM terminal_snippets WHERE namespace = ? AND id = ?'
        ).run(namespace, id).changes > 0
    }

    private require(namespace: string, id: string): Row {
        const row = this.db.query(
            'SELECT * FROM terminal_snippets WHERE namespace = ? AND id = ?'
        ).get(namespace, id) as Row | null
        if (!row) throw new Error('TERMINAL_SNIPPET_NOT_FOUND')
        return row
    }
}
```

Update `hub/src/store/index.ts`:

```ts
const SCHEMA_VERSION: number = 11
```

Append `terminal_snippets` to `REQUIRED_TABLES`, add `10: () => this.migrateFromV10ToV11()` to the migration map, instantiate/export `TerminalSnippetStore`, and create:

```ts
private createTerminalSnippetSchema(): void {
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS terminal_snippets (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL,
            name TEXT NOT NULL,
            command TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_terminal_snippets_namespace_created
            ON terminal_snippets(namespace, created_at DESC, id DESC);
    `)
}

private migrateFromV10ToV11(): void {
    this.createTerminalSnippetSchema()
}
```

Call `this.createTerminalSnippetSchema()` from `createSchema()`.

- [ ] **Step 4: Chạy store tests và Hub typecheck**

Run: `bun test hub/src/store/terminalSnippetStore.test.ts hub/src/store/migration-v11.test.ts && bun run --cwd hub typecheck`

Expected: PASS; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add hub/src/store/types.ts hub/src/store/terminalSnippetStore.ts hub/src/store/terminalSnippetStore.test.ts hub/src/store/migration-v11.test.ts hub/src/store/index.ts
git commit -m "feat(hub): persist terminal snippets by namespace"
```

## Task 3: Hub CRUD routes và SSE invalidation

**Files:**
- Create: `hub/src/web/routes/terminalSnippets.ts`
- Create: `hub/src/web/routes/terminalSnippets.test.ts`
- Modify: `hub/src/web/server.ts:1-110`

- [ ] **Step 1: Viết route tests thất bại**

```ts
// hub/src/web/routes/terminalSnippets.test.ts
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SSEManager } from '../../sse/sseManager'
import type { WebAppEnv } from '../middleware/auth'
import { createTerminalSnippetsRoutes } from './terminalSnippets'

function createApp(namespace = 'ns-a') {
    const store = new Store(':memory:')
    const events: unknown[] = []
    const sse = { broadcast: (event: unknown) => events.push(event) } as SSEManager
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createTerminalSnippetsRoutes(store, () => sse))
    return { app, store, events }
}

describe('terminal snippet routes', () => {
    it('creates, lists, updates and deletes only inside request namespace', async () => {
        const { app, store, events } = createApp()
        const created = await app.request('/api/terminal-snippets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: ' Status ', command: 'git status', description: '' })
        })
        expect(created.status).toBe(201)
        const body = await created.json() as { snippet: { id: string; name: string } }
        expect(body.snippet.name).toBe('Status')
        expect(store.terminalSnippets.list('ns-b')).toEqual([])

        const updated = await app.request(`/api/terminal-snippets/${body.snippet.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Short status', command: 'git status --short' })
        })
        expect(updated.status).toBe(200)

        const deleted = await app.request(`/api/terminal-snippets/${body.snippet.id}`, {
            method: 'DELETE'
        })
        expect(deleted.status).toBe(200)
        expect(events).toEqual([
            { type: 'terminal-snippets-updated', namespace: 'ns-a' },
            { type: 'terminal-snippets-updated', namespace: 'ns-a' },
            { type: 'terminal-snippets-updated', namespace: 'ns-a' }
        ])
    })

    it('returns 404 for a snippet owned by another namespace', async () => {
        const { app, store } = createApp('ns-b')
        const foreign = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'Foreign',
            command: 'pwd',
            description: null
        })
        const response = await app.request(`/api/terminal-snippets/${foreign.id}`, {
            method: 'DELETE'
        })
        expect(response.status).toBe(404)
    })

    it('returns 400 for invalid body and 409 at namespace quota', async () => {
        const { app, store } = createApp()
        const invalid = await app.request('/api/terminal-snippets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '', command: 'pwd' })
        })
        expect(invalid.status).toBe(400)
        for (let index = 0; index < 200; index += 1) {
            store.terminalSnippets.create({
                namespace: 'ns-a',
                name: `Snippet ${index}`,
                command: 'pwd',
                description: null
            })
        }
        const overflow = await app.request('/api/terminal-snippets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Overflow', command: 'pwd' })
        })
        expect(overflow.status).toBe(409)
    })
})
```

- [ ] **Step 2: Chạy route tests để xác nhận thất bại**

Run: `bun test hub/src/web/routes/terminalSnippets.test.ts`

Expected: FAIL vì route factory chưa tồn tại.

- [ ] **Step 3: Thêm routes và đăng ký server**

```ts
// hub/src/web/routes/terminalSnippets.ts
import { Hono } from 'hono'
import {
    CreateTerminalSnippetInputSchema,
    TerminalSnippetSchema,
    UpdateTerminalSnippetInputSchema
} from '@hapi/protocol'
import type { SSEManager } from '../../sse/sseManager'
import type { Store } from '../../store'
import type { StoredTerminalSnippet } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

function toResponse(item: StoredTerminalSnippet) {
    return TerminalSnippetSchema.parse({
        id: item.id,
        name: item.name,
        command: item.command,
        description: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    })
}

export function createTerminalSnippetsRoutes(
    store: Store,
    getSseManager: () => SSEManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const publish = (namespace: string) => {
        getSseManager()?.broadcast({ type: 'terminal-snippets-updated', namespace })
    }

    app.get('/terminal-snippets', (c) => c.json({
        snippets: store.terminalSnippets.list(c.get('namespace')).map(toResponse)
    }))

    app.post('/terminal-snippets', async (c) => {
        const parsed = CreateTerminalSnippetInputSchema.safeParse(
            await c.req.json().catch(() => null)
        )
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        try {
            const snippet = store.terminalSnippets.create({
                namespace: c.get('namespace'),
                ...parsed.data
            })
            publish(c.get('namespace'))
            return c.json({ snippet: toResponse(snippet) }, 201)
        } catch (error) {
            if (error instanceof Error && error.message === 'TERMINAL_SNIPPET_LIMIT_REACHED') {
                return c.json({ error: error.message }, 409)
            }
            throw error
        }
    })

    app.patch('/terminal-snippets/:id', async (c) => {
        const parsed = UpdateTerminalSnippetInputSchema.safeParse(
            await c.req.json().catch(() => null)
        )
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        try {
            const snippet = store.terminalSnippets.update({
                namespace: c.get('namespace'),
                id: c.req.param('id'),
                ...parsed.data
            })
            publish(c.get('namespace'))
            return c.json({ snippet: toResponse(snippet) })
        } catch (error) {
            if (error instanceof Error && error.message === 'TERMINAL_SNIPPET_NOT_FOUND') {
                return c.json({ error: error.message }, 404)
            }
            throw error
        }
    })

    app.delete('/terminal-snippets/:id', (c) => {
        if (!store.terminalSnippets.delete(c.get('namespace'), c.req.param('id'))) {
            return c.json({ error: 'TERMINAL_SNIPPET_NOT_FOUND' }, 404)
        }
        publish(c.get('namespace'))
        return c.json({ ok: true })
    })

    return app
}
```

Register in `hub/src/web/server.ts`:

```ts
import { createTerminalSnippetsRoutes } from './routes/terminalSnippets'
// after authentication middleware:
app.route('/api', createTerminalSnippetsRoutes(options.store, options.getSseManager))
```

- [ ] **Step 4: Chạy route/store regression**

Run: `bun test hub/src/web/routes/terminalSnippets.test.ts hub/src/store/terminalSnippetStore.test.ts && bun run --cwd hub typecheck`

Expected: PASS; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add hub/src/web/routes/terminalSnippets.ts hub/src/web/routes/terminalSnippets.test.ts hub/src/web/server.ts
git commit -m "feat(hub): expose terminal snippet CRUD"
```

## Task 4: Web API, lazy query, mutation cache và SSE sync

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/lib/query-keys.ts`
- Create: `web/src/hooks/queries/useTerminalSnippets.ts`
- Create: `web/src/hooks/queries/useTerminalSnippets.test.tsx`
- Modify: `web/src/hooks/useSSE.ts`
- Modify: `web/src/hooks/useSSE.test.ts`

- [ ] **Step 1: Viết query/cache/SSE tests thất bại**

Create a QueryClient wrapper in `useTerminalSnippets.test.tsx`, then assert this exact behavior:

```ts
it('does not fetch until My snippets is opened and updates cache from mutations', async () => {
    const api = {
        getTerminalSnippets: vi.fn().mockResolvedValue({ snippets: [] }),
        createTerminalSnippet: vi.fn().mockResolvedValue({
            snippet: {
                id: 's1',
                name: 'Status',
                command: 'git status',
                description: null,
                createdAt: 2,
                updatedAt: 2
            }
        })
    } as unknown as ApiClient
    const { result, rerender } = renderHook(
        ({ enabled }) => useTerminalSnippets(api, enabled),
        { initialProps: { enabled: false }, wrapper }
    )
    expect(api.getTerminalSnippets).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(api.getTerminalSnippets).toHaveBeenCalledOnce())
    await act(async () => {
        await result.current.create({
            name: 'Status',
            command: 'git status',
            description: null
        })
    })
    expect(result.current.snippets.map((item) => item.id)).toEqual(['s1'])
})
```

Add to `useSSE.test.ts`:

```ts
it('invalidates terminal snippets for a namespace-scoped SSE update', async () => {
    renderSse()
    emit({ type: 'terminal-snippets-updated', namespace: 'default' })
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.terminalSnippets
    }))
})
```

- [ ] **Step 2: Chạy focused tests để xác nhận thất bại**

Run: `bun run --cwd web test -- src/hooks/queries/useTerminalSnippets.test.tsx src/hooks/useSSE.test.ts`

Expected: FAIL vì hook/query key chưa tồn tại và SSE chưa invalidates.

- [ ] **Step 3: Thêm API methods, hook và SSE branch**

Add to `web/src/api/client.ts`:

```ts
import {
    TerminalSnippetResponseSchema,
    TerminalSnippetsResponseSchema,
    type CreateTerminalSnippetInput,
    type TerminalSnippetResponse,
    type TerminalSnippetsResponse,
    type UpdateTerminalSnippetInput
} from '@hapi/protocol'

async getTerminalSnippets(): Promise<TerminalSnippetsResponse> {
    return TerminalSnippetsResponseSchema.parse(
        await this.request<unknown>('/api/terminal-snippets')
    )
}

async createTerminalSnippet(
    input: CreateTerminalSnippetInput
): Promise<TerminalSnippetResponse> {
    return TerminalSnippetResponseSchema.parse(await this.request<unknown>(
        '/api/terminal-snippets',
        { method: 'POST', body: JSON.stringify(input) }
    ))
}

async updateTerminalSnippet(
    id: string,
    input: UpdateTerminalSnippetInput
): Promise<TerminalSnippetResponse> {
    return TerminalSnippetResponseSchema.parse(await this.request<unknown>(
        `/api/terminal-snippets/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(input) }
    ))
}

async deleteTerminalSnippet(id: string): Promise<void> {
    await this.request(`/api/terminal-snippets/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    })
}
```

Add query key:

```ts
terminalSnippets: ['terminal-snippets'] as const,
```

Create `useTerminalSnippets.ts` with:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
    CreateTerminalSnippetInput,
    TerminalSnippet,
    TerminalSnippetsResponse,
    UpdateTerminalSnippetInput
} from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useTerminalSnippets(api: ApiClient | null, enabled: boolean) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.terminalSnippets,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return api.getTerminalSnippets()
        },
        enabled: Boolean(api) && enabled
    })
    const set = (update: (items: TerminalSnippet[]) => TerminalSnippet[]) => {
        queryClient.setQueryData<TerminalSnippetsResponse>(
            queryKeys.terminalSnippets,
            (previous) => ({ snippets: update(previous?.snippets ?? []) })
        )
    }
    const createMutation = useMutation({
        mutationFn: async (input: CreateTerminalSnippetInput) => {
            if (!api) throw new Error('API unavailable')
            return api.createTerminalSnippet(input)
        },
        onSuccess: ({ snippet }) => set((items) => [snippet, ...items])
    })
    const updateMutation = useMutation({
        mutationFn: async (input: UpdateTerminalSnippetInput & { id: string }) => {
            if (!api) throw new Error('API unavailable')
            const { id, ...body } = input
            return api.updateTerminalSnippet(id, body)
        },
        onSuccess: ({ snippet }) => set((items) => items.map(
            (item) => item.id === snippet.id ? snippet : item
        ))
    })
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!api) throw new Error('API unavailable')
            await api.deleteTerminalSnippet(id)
            return id
        },
        onSuccess: (id) => set((items) => items.filter((item) => item.id !== id))
    })

    return {
        snippets: query.data?.snippets ?? [],
        isLoading: query.isLoading,
        loadError: query.error instanceof Error ? query.error.message : null,
        refetch: query.refetch,
        create: createMutation.mutateAsync,
        update: updateMutation.mutateAsync,
        remove: deleteMutation.mutateAsync,
        mutationError: [
            createMutation.error,
            updateMutation.error,
            deleteMutation.error
        ].find((error) => error instanceof Error) as Error | undefined,
        isPending: createMutation.isPending
            || updateMutation.isPending
            || deleteMutation.isPending
    }
}
```

In `useSSE.ts`, handle before `onEventRef.current(event)`:

```ts
if (event.type === 'terminal-snippets-updated') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.terminalSnippets })
}
```

- [ ] **Step 4: Chạy hook/SSE tests và web typecheck**

Run: `bun run --cwd web test -- src/hooks/queries/useTerminalSnippets.test.tsx src/hooks/useSSE.test.ts && bun run --cwd web typecheck`

Expected: PASS; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/lib/query-keys.ts web/src/hooks/queries/useTerminalSnippets.ts web/src/hooks/queries/useTerminalSnippets.test.tsx web/src/hooks/useSSE.ts web/src/hooks/useSSE.test.ts
git commit -m "feat(web): sync custom terminal snippets"
```

## Task 5: Built-in catalog và Snippet panel

**Files:**
- Create: `web/src/components/Terminal/terminalSnippetCatalog.ts`
- Create: `web/src/components/Terminal/TerminalSnippetPanel.tsx`
- Create: `web/src/components/Terminal/TerminalSnippetPanel.test.tsx`

- [ ] **Step 1: Viết component tests thất bại**

Tests must cover:

```ts
it('renders built-ins without loading custom snippets', () => {
    renderPanel({ customEnabled: false })
    expect(screen.getByText('git status --short')).toBeVisible()
    expect(api.getTerminalSnippets).not.toHaveBeenCalled()
})

it('inserts exact command, closes, and announces that it was not executed', () => {
    const onInsert = vi.fn(() => true)
    const onClose = vi.fn()
    renderPanel({ onInsert, onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Insert Git status' }))
    expect(onInsert).toHaveBeenCalledWith('git status --short')
    expect(onInsert.mock.calls[0]?.[0]).not.toMatch(/[\r\n]$/)
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Inserted · not executed')
})

it('keeps editor values visible after a failed save', async () => {
    api.createTerminalSnippet.mockRejectedValue(new Error('offline'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Status' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'git status' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }))
    expect(await screen.findByText('offline')).toBeVisible()
    expect(screen.getByLabelText('Command')).toHaveValue('git status')
})
```

Also test filter across name/command/description, lazy `My snippets`, edit without row reorder, shared `ConfirmDialog`, disabled repeated save, built-ins remaining visible after custom load error, and insert failure keeping the panel open.

- [ ] **Step 2: Chạy component test để xác nhận thất bại**

Run: `bun run --cwd web test -- src/components/Terminal/TerminalSnippetPanel.test.tsx`

Expected: FAIL vì panel/catalog chưa tồn tại.

- [ ] **Step 3: Thêm catalog và panel tối thiểu**

Create the literal catalog:

```ts
// terminalSnippetCatalog.ts
export type BuiltInTerminalSnippet = {
    id: string
    group: 'navigation' | 'git' | 'system'
    nameKey: string
    descriptionKey: string
    command: string
}

export const BUILT_IN_TERMINAL_SNIPPETS: BuiltInTerminalSnippet[] = [
    { id: 'nav-pwd', group: 'navigation', nameKey: 'terminal.snippets.builtin.pwd.name', descriptionKey: 'terminal.snippets.builtin.pwd.description', command: 'pwd' },
    { id: 'nav-list', group: 'navigation', nameKey: 'terminal.snippets.builtin.list.name', descriptionKey: 'terminal.snippets.builtin.list.description', command: 'ls -la' },
    { id: 'nav-clear', group: 'navigation', nameKey: 'terminal.snippets.builtin.clear.name', descriptionKey: 'terminal.snippets.builtin.clear.description', command: 'clear' },
    { id: 'git-status', group: 'git', nameKey: 'terminal.snippets.builtin.status.name', descriptionKey: 'terminal.snippets.builtin.status.description', command: 'git status --short' },
    { id: 'git-diff', group: 'git', nameKey: 'terminal.snippets.builtin.diff.name', descriptionKey: 'terminal.snippets.builtin.diff.description', command: 'git diff' },
    { id: 'git-log', group: 'git', nameKey: 'terminal.snippets.builtin.log.name', descriptionKey: 'terminal.snippets.builtin.log.description', command: 'git log --oneline -10' },
    { id: 'system-processes', group: 'system', nameKey: 'terminal.snippets.builtin.processes.name', descriptionKey: 'terminal.snippets.builtin.processes.description', command: 'ps aux' },
    { id: 'system-disk', group: 'system', nameKey: 'terminal.snippets.builtin.disk.name', descriptionKey: 'terminal.snippets.builtin.disk.description', command: 'df -h' }
]
```

`TerminalSnippetPanel` public contract:

```ts
export type TerminalSnippetPanelProps = {
    api: ApiClient | null
    disabled: boolean
    onInsert: (command: string) => boolean
    onClose: () => void
}
```

Implement these state transitions in the component:

```ts
type Tab = 'built-in' | 'custom'
type EditorState =
    | { mode: 'create'; id: null; name: string; command: string; description: string }
    | { mode: 'edit'; id: string; name: string; command: string; description: string }

const [tab, setTab] = useState<Tab>('built-in')
const [query, setQuery] = useState('')
const [customEnabled, setCustomEnabled] = useState(false)
const [editor, setEditor] = useState<EditorState | null>(null)
const [deleteTarget, setDeleteTarget] = useState<TerminalSnippet | null>(null)
```

When the custom tab is selected, call `setCustomEnabled(true)` once. Filter with:

```ts
const needle = query.trim().toLocaleLowerCase()
const matches = (name: string, command: string, description?: string | null) =>
    !needle || `${name}\n${command}\n${description ?? ''}`
        .toLocaleLowerCase()
        .includes(needle)
```

Insert without terminal focus:

```ts
const insert = (command: string) => {
    if (!props.onInsert(command)) {
        setActionError(t('terminal.snippets.insertFailed'))
        return
    }
    setInsertedFeedback(true)
    props.onClose()
}
```

Use `ConfirmDialog` with `destructive` for delete. Use local inline editor with `maxLength` 80/8192/240, `autoCapitalize="none"` and `autoCorrect="off"`. Show the plaintext warning under the command field.

- [ ] **Step 4: Chạy Snippet panel tests**

Run: `bun run --cwd web test -- src/components/Terminal/TerminalSnippetPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/terminalSnippetCatalog.ts web/src/components/Terminal/TerminalSnippetPanel.tsx web/src/components/Terminal/TerminalSnippetPanel.test.tsx
git commit -m "feat(web): add terminal snippet palette"
```

## Task 6: Gắn Snippets vào shared dock và hai terminal host

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Sửa tests hiện có thành acceptance tests thất bại**

Replace the assertion that Snippets is disabled:

```ts
expect(screen.getByRole('button', { name: 'Snippets' })).toBeEnabled()
expect(screen.getByRole('button', { name: 'History' })).toBeDisabled()
```

Add shared-host assertions:

```ts
it('inserts a snippet through writePlainInput without focusing xterm', async () => {
    renderSessionTerminal()
    fireEvent.click(screen.getByRole('button', { name: 'Snippets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Insert Git status' }))
    expect(socket.write).toHaveBeenCalledWith(activeTerminalId, 'git status --short')
    expect(terminal.focus).not.toHaveBeenCalled()
})
```

Add the same assertion in `EditorTerminal.test.tsx` using its existing `write` mock. Add tests that terminal-body tap, terminal-tab switch and unmount close the snippet panel.

- [ ] **Step 2: Chạy dock/host tests để xác nhận thất bại**

Run:

```bash
bun run --cwd web test -- \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx
```

Expected: FAIL because Snippets remains disabled and no panel is rendered.

- [ ] **Step 3: Wire Snippets without changing terminal transport**

Extend `TerminalControlDockProps`:

```ts
api: ApiClient | null
```

Render the floating panel before Keys/More:

```tsx
{props.activeTool === 'snippets' ? (
    <section
        role="region"
        aria-label={t('terminal.snippets.panel')}
        className="absolute bottom-full left-2 right-2 mb-2 max-h-[min(70vh,36rem)] overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 shadow-xl backdrop-blur"
    >
        <TerminalSnippetPanel
            api={props.api}
            disabled={props.disabled}
            onInsert={props.onWritePlainInput}
            onClose={() => props.onActiveToolChange(null)}
        />
    </section>
) : null}
```

Enable the button:

```tsx
<DockButton
    tool="snippets"
    label={t('terminal.controls.snippets')}
    active={props.activeTool === 'snippets'}
    disabled={props.disabled}
    onClick={() => toggleTool(
        props.activeTool,
        'snippets',
        props.onActiveToolChange
    )}
/>
```

In `SessionTerminalTabs`, destructure `api` from `useAppContext()` and pass it to the dock. In `EditorTerminalBody`, pass `props.api`.

Keep existing `onPointerDownCapture` close behavior and `dismissMobileInteraction={activeDockTool !== null}`. Do not call `terminal.focus()` from Snippets.

- [ ] **Step 4: Run snippet integration and mobile interaction regressions**

Run:

```bash
bun run --cwd web test -- \
  src/components/Terminal/TerminalSnippetPanel.test.tsx \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx \
  src/components/Terminal/TerminalView.test.tsx \
  src/components/Terminal/useMobileTerminalInteraction.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx web/src/components/Terminal/TerminalControlDock.test.tsx web/src/components/Terminal/SessionTerminalTabs.tsx web/src/components/Terminal/SessionTerminalTabs.test.tsx web/src/components/editor/EditorTerminal.tsx web/src/components/editor/EditorTerminal.test.tsx
git commit -m "feat(web): connect snippets to mobile terminals"
```

## Task 7: SearchAddon dependency, adapter và lifecycle

**Files:**
- Modify: `web/package.json`
- Modify: `bun.lock`
- Create: `web/src/components/Terminal/terminalSearch.ts`
- Create: `web/src/components/Terminal/useTerminalSearchAddon.ts`
- Create: `web/src/components/Terminal/useTerminalSearchAddon.test.tsx`
- Modify: `web/src/components/Terminal/TerminalView.tsx`
- Modify: `web/src/components/Terminal/TerminalView.test.tsx`

- [ ] **Step 1: Cài dependency chính thức**

Run: `bun add --cwd web @xterm/addon-search@^0.16.0`

Expected: `web/package.json` and `bun.lock` change; dependency resolves beside xterm 6.

- [ ] **Step 2: Viết lifecycle tests thất bại**

Test contract:

```ts
it('lazy-loads once, clears on close, and disposes on terminal replacement', async () => {
    const onStateChange = vi.fn()
    const rendered = render(
        <TerminalView searchActive={false} onSearchStateChange={onStateChange} />
    )
    expect(loadSearchAddon).not.toHaveBeenCalled()
    rendered.rerender(
        <TerminalView searchActive onSearchStateChange={onStateChange} />
    )
    await waitFor(() => expect(loadSearchAddon).toHaveBeenCalledOnce())
    expect(terminal.loadAddon).toHaveBeenCalledWith(searchAddon)
    rendered.rerender(
        <TerminalView searchActive={false} onSearchStateChange={onStateChange} />
    )
    expect(searchAddon.clearDecorations).toHaveBeenCalledOnce()
    rendered.unmount()
    expect(searchAddon.dispose).toHaveBeenCalledOnce()
    expect(resultsDisposable.dispose).toHaveBeenCalledOnce()
})
```

Also test:

- load failure exposes `error` and a working `retry`;
- retry does not create two live addons;
- delayed import after unmount disposes the returned addon without publishing a ready controller;
- controller forwards incremental/case/decorations options;
- empty query calls `clearDecorations`;
- result event normalizes the 1.000-highlight overflow.

- [ ] **Step 3: Chạy lifecycle tests để xác nhận thất bại**

Run: `bun run --cwd web test -- src/components/Terminal/useTerminalSearchAddon.test.tsx src/components/Terminal/TerminalView.test.tsx`

Expected: FAIL because search contract/hook/props do not exist.

- [ ] **Step 4: Thêm narrow adapter và lifecycle hook**

Create `terminalSearch.ts`:

```ts
export const TERMINAL_SEARCH_QUERY_MAX = 256
export const TERMINAL_SEARCH_DEBOUNCE_MS = 150
export const TERMINAL_SEARCH_HIGHLIGHT_LIMIT = 1_000

export type TerminalSearchResults = {
    resultIndex: number
    resultCount: number
    limitExceeded: boolean
}

export type TerminalSearchOptions = {
    caseSensitive: boolean
    incremental: boolean
}

export type TerminalSearchController = {
    findNext: (query: string, options: TerminalSearchOptions) => boolean
    findPrevious: (query: string, options: TerminalSearchOptions) => boolean
    clear: () => void
    subscribe: (listener: (results: TerminalSearchResults) => void) => () => void
}

export type TerminalSearchState = {
    status: 'idle' | 'loading' | 'ready' | 'error'
    controller: TerminalSearchController | null
    error: string | null
    retry: () => void
}

export const EMPTY_TERMINAL_SEARCH_STATE: TerminalSearchState = {
    status: 'idle',
    controller: null,
    error: null,
    retry: () => undefined
}
```

Create `useTerminalSearchAddon.ts` with an exported loader for tests:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import {
    TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
    type TerminalSearchController,
    type TerminalSearchResults,
    type TerminalSearchState
} from './terminalSearch'

export const loadTerminalSearchAddon = () => import('@xterm/addon-search')

export function useTerminalSearchAddon(
    terminal: Terminal | null,
    active: boolean
): TerminalSearchState {
    const addonRef = useRef<SearchAddon | null>(null)
    const disposeResultsRef = useRef<(() => void) | null>(null)
    const listenersRef = useRef(new Set<(result: TerminalSearchResults) => void>())
    const [attempt, setAttempt] = useState(0)
    const [state, setState] = useState<Omit<TerminalSearchState, 'retry'>>({
        status: 'idle',
        controller: null,
        error: null
    })
    const retry = useCallback(() => setAttempt((value) => value + 1), [])

    useEffect(() => {
        if (!active || !terminal || addonRef.current) return
        let cancelled = false
        setState({ status: 'loading', controller: null, error: null })
        void loadTerminalSearchAddon().then(({ SearchAddon }) => {
            const addon = new SearchAddon()
            if (cancelled) {
                addon.dispose()
                return
            }
            terminal.loadAddon(addon)
            addonRef.current = addon
            const resultDisposable = addon.onDidChangeResults((value) => {
                const result = {
                    resultIndex: value.resultIndex,
                    resultCount: value.resultCount,
                    limitExceeded: value.resultIndex < 0
                        && value.resultCount >= TERMINAL_SEARCH_HIGHLIGHT_LIMIT
                }
                listenersRef.current.forEach((listener) => listener(result))
            })
            disposeResultsRef.current = () => resultDisposable.dispose()
            const options = (value: {
                caseSensitive: boolean
                incremental: boolean
            }): ISearchOptions => ({
                caseSensitive: value.caseSensitive,
                incremental: value.incremental,
                decorations: {
                    matchBackground: '#7c3aed55',
                    activeMatchBackground: '#8b5cf6',
                    matchOverviewRuler: '#7c3aed',
                    activeMatchColorOverviewRuler: '#a78bfa'
                }
            })
            const controller: TerminalSearchController = {
                findNext: (query, value) => query
                    ? addon.findNext(query, options(value))
                    : (addon.clearDecorations(), false),
                findPrevious: (query, value) => query
                    ? addon.findPrevious(query, options(value))
                    : (addon.clearDecorations(), false),
                clear: () => addon.clearDecorations(),
                subscribe: (listener) => {
                    listenersRef.current.add(listener)
                    return () => listenersRef.current.delete(listener)
                }
            }
            setState({ status: 'ready', controller, error: null })
        }).catch((error: unknown) => {
            if (!cancelled) {
                setState({
                    status: 'error',
                    controller: null,
                    error: error instanceof Error ? error.message : 'Search unavailable'
                })
            }
        })
        return () => {
            cancelled = true
        }
    }, [active, attempt, terminal])

    useEffect(() => {
        if (!active) addonRef.current?.clearDecorations()
    }, [active])

    useEffect(() => () => {
        disposeResultsRef.current?.()
        disposeResultsRef.current = null
        addonRef.current?.dispose()
        addonRef.current = null
        listenersRef.current.clear()
    }, [terminal])

    return { ...state, retry }
}
```

In `TerminalView`, add props:

```ts
searchActive?: boolean
onSearchStateChange?: (state: TerminalSearchState) => void
```

Call the hook with the owned terminal, publish state through an effect, and publish `EMPTY_TERMINAL_SEARCH_STATE` during cleanup. Do not add any output listener or second debounce.

- [ ] **Step 5: Chạy lifecycle tests, typecheck và commit**

Run:

```bash
bun run --cwd web test -- \
  src/components/Terminal/useTerminalSearchAddon.test.tsx \
  src/components/Terminal/TerminalView.test.tsx
bun run --cwd web typecheck
```

Expected: PASS; TypeScript exits 0.

```bash
git add web/package.json bun.lock web/src/components/Terminal/terminalSearch.ts web/src/components/Terminal/useTerminalSearchAddon.ts web/src/components/Terminal/useTerminalSearchAddon.test.tsx web/src/components/Terminal/TerminalView.tsx web/src/components/Terminal/TerminalView.test.tsx
git commit -m "feat(web): add lazy xterm search adapter"
```

## Task 8: Search panel UX, debounce và IME

**Files:**
- Create: `web/src/components/Terminal/TerminalSearchPanel.tsx`
- Create: `web/src/components/Terminal/TerminalSearchPanel.test.tsx`

- [ ] **Step 1: Viết panel tests với fake timers**

```ts
it('does not focus or search on open, then searches after 150ms', () => {
    vi.useFakeTimers()
    renderPanel()
    expect(screen.getByRole('searchbox')).not.toHaveFocus()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'error' } })
    expect(controller.findNext).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(149))
    expect(controller.findNext).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(controller.findNext).toHaveBeenCalledWith('error', {
        caseSensitive: false,
        incremental: true
    })
})

it('waits for composition end and searches once', () => {
    vi.useFakeTimers()
    renderPanel()
    const field = screen.getByRole('searchbox')
    fireEvent.compositionStart(field)
    fireEvent.change(field, { target: { value: 'đang' } })
    act(() => vi.advanceTimersByTime(300))
    expect(controller.findNext).not.toHaveBeenCalled()
    fireEvent.compositionEnd(field)
    act(() => vi.advanceTimersByTime(150))
    expect(controller.findNext).toHaveBeenCalledOnce()
})

it('navigates immediately and renders 1000+ for highlight overflow', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Previous result' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next result' }))
    expect(controller.findPrevious).toHaveBeenCalledOnce()
    expect(controller.findNext).toHaveBeenCalledOnce()
    emitResults({ resultIndex: -1, resultCount: 1_000, limitExceeded: true })
    expect(screen.getByText('1000+')).toBeVisible()
})
```

Also test query truncation to 256, `Aa` toggling case and immediately rerunning a non-empty query, empty query clearing decorations/count, subscription disposal, pending timer cancellation on close, loading, retryable error and reduced-motion classes.

- [ ] **Step 2: Chạy panel tests để xác nhận thất bại**

Run: `bun run --cwd web test -- src/components/Terminal/TerminalSearchPanel.test.tsx`

Expected: FAIL vì Search panel chưa tồn tại.

- [ ] **Step 3: Implement Search panel**

Public props:

```ts
export type TerminalSearchPanelProps = {
    state: TerminalSearchState
    onClose: () => void
}
```

Core timer and composition logic:

```ts
const [query, setQuery] = useState('')
const [caseSensitive, setCaseSensitive] = useState(false)
const [composing, setComposing] = useState(false)
const [results, setResults] = useState<TerminalSearchResults>({
    resultIndex: -1,
    resultCount: 0,
    limitExceeded: false
})

useEffect(() => {
    if (!props.state.controller) return
    return props.state.controller.subscribe(setResults)
}, [props.state.controller])

useEffect(() => {
    if (!props.state.controller || composing) return
    if (!query) {
        props.state.controller.clear()
        setResults({ resultIndex: -1, resultCount: 0, limitExceeded: false })
        return
    }
    const timer = setTimeout(() => {
        props.state.controller?.findNext(query, {
            caseSensitive,
            incremental: true
        })
    }, TERMINAL_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
}, [caseSensitive, composing, props.state.controller, query])
```

Input:

```tsx
<input
    type="search"
    role="searchbox"
    value={query}
    maxLength={TERMINAL_SEARCH_QUERY_MAX}
    autoCapitalize="none"
    autoCorrect="off"
    spellCheck={false}
    onChange={(event) => setQuery(
        event.target.value.slice(0, TERMINAL_SEARCH_QUERY_MAX)
    )}
    onCompositionStart={() => setComposing(true)}
    onCompositionEnd={(event) => {
        setComposing(false)
        setQuery(event.currentTarget.value.slice(0, TERMINAL_SEARCH_QUERY_MAX))
    }}
/>
```

Count display:

```ts
const resultLabel = results.limitExceeded
    ? '1000+'
    : results.resultCount === 0
        ? '0/0'
        : `${results.resultIndex + 1}/${results.resultCount}`
```

Render a 44px `Aa` toggle, previous/next buttons, loading copy and retry button. Do not use `autoFocus`.

- [ ] **Step 4: Chạy Search panel tests**

Run: `bun run --cwd web test -- src/components/Terminal/TerminalSearchPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/TerminalSearchPanel.tsx web/src/components/Terminal/TerminalSearchPanel.test.tsx
git commit -m "feat(web): add mobile terminal search bar"
```

## Task 9: Gắn Search vào dock, session tabs và Editor terminal

**Files:**
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`

- [ ] **Step 1: Viết integration tests thất bại**

Update dock expectation:

```ts
expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
expect(screen.getByRole('button', { name: 'History' })).toBeDisabled()
```

Add:

```ts
it('opens Search without focusing terminal or search input', async () => {
    renderSessionTerminal()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('region', { name: 'Search terminal output' })).toBeVisible()
    expect(screen.getByRole('searchbox')).not.toHaveFocus()
    expect(terminal.focus).not.toHaveBeenCalled()
})

it('clears search when switching terminal tabs', async () => {
    renderSessionTerminalWithTwoTabs()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(screen.getByRole('button', { name: secondTerminalLabel }))
    expect(searchController.clear).toHaveBeenCalled()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})
```

Mirror the open/close/cleanup acceptance in `EditorTerminal.test.tsx`. Verify tapping the terminal body closes Search and dismisses `Nhập · Chọn`.

- [ ] **Step 2: Chạy integration tests để xác nhận thất bại**

Run:

```bash
bun run --cwd web test -- \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx
```

Expected: FAIL because Search is disabled and hosts do not hold search state.

- [ ] **Step 3: Wire one search state per active TerminalView**

Extend dock props:

```ts
searchState: TerminalSearchState
```

Render:

```tsx
{props.activeTool === 'search' ? (
    <section
        role="region"
        aria-label={t('terminal.search.label')}
        className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)]/95 p-2 shadow-xl backdrop-blur"
    >
        <TerminalSearchPanel
            state={props.searchState}
            onClose={() => props.onActiveToolChange(null)}
        />
    </section>
) : null}
```

Enable Search `DockButton` with the same `toggleTool` helper.

In each terminal host:

```ts
const [searchState, setSearchState] = useState<TerminalSearchState>(
    EMPTY_TERMINAL_SEARCH_STATE
)
```

Pass to `TerminalView`:

```tsx
searchActive={activeDockTool === 'search'}
onSearchStateChange={setSearchState}
```

Pass `searchState` to `TerminalControlDock`. On terminal identity change, call `searchState.controller?.clear()`, close active tool and restore `EMPTY_TERMINAL_SEARCH_STATE`. Preserve the existing `key={activeTerminalId ?? 'bootstrap'}` in session tabs so an old addon cannot leak into a new terminal.

- [ ] **Step 4: Chạy full terminal regression**

Run:

```bash
bun run --cwd web test -- \
  src/components/Terminal/TerminalSearchPanel.test.tsx \
  src/components/Terminal/useTerminalSearchAddon.test.tsx \
  src/components/Terminal/TerminalView.test.tsx \
  src/components/Terminal/TerminalControlDock.test.tsx \
  src/components/Terminal/SessionTerminalTabs.test.tsx \
  src/components/editor/EditorTerminal.test.tsx \
  src/components/Terminal/MobileTerminalInteractionOverlay.test.tsx \
  src/components/Terminal/useMobileTerminalInteraction.test.tsx \
  src/hooks/useTerminalSocket.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Terminal/TerminalControlDock.tsx web/src/components/Terminal/TerminalControlDock.test.tsx web/src/components/Terminal/SessionTerminalTabs.tsx web/src/components/Terminal/SessionTerminalTabs.test.tsx web/src/components/editor/EditorTerminal.tsx web/src/components/editor/EditorTerminal.test.tsx
git commit -m "feat(web): connect search to mobile terminals"
```

## Task 10: Translations, accessibility, performance và final verification

**Files:**
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`
- Modify: `docs/superpowers/specs/2026-07-28-terminal-search-snippets-design.md`

- [ ] **Step 1: Thêm đủ copy ở ba locale**

Add matching keys for:

```ts
'terminal.snippets.panel'
'terminal.snippets.insertOnly'
'terminal.snippets.new'
'terminal.snippets.search'
'terminal.snippets.builtIn'
'terminal.snippets.custom'
'terminal.snippets.insert'
'terminal.snippets.edit'
'terminal.snippets.delete'
'terminal.snippets.save'
'terminal.snippets.name'
'terminal.snippets.command'
'terminal.snippets.description'
'terminal.snippets.plaintextWarning'
'terminal.snippets.inserted'
'terminal.snippets.insertFailed'
'terminal.snippets.loadFailed'
'terminal.snippets.retry'
'terminal.snippets.deleteTitle'
'terminal.snippets.deleteDescription'
'terminal.snippets.empty'
'terminal.snippets.group.navigation'
'terminal.snippets.group.git'
'terminal.snippets.group.system'
'terminal.search.label'
'terminal.search.placeholder'
'terminal.search.caseSensitive'
'terminal.search.previous'
'terminal.search.next'
'terminal.search.loading'
'terminal.search.retry'
'terminal.search.unavailable'
```

Add name and description keys for all eight built-ins. English source remains the type authority; Vietnamese and Chinese must contain the same keys.

- [ ] **Step 2: Run locale/type tests**

Run: `bun run --cwd web typecheck`

Expected: PASS with no missing translation-key error.

- [ ] **Step 3: Browser acceptance ở mobile viewport**

Run: `bun run dev`

Check at widths 390px and 768px in both light and dark themes:

1. Open terminal modal → Snippets → built-in insert: panel floats, terminal height unchanged, exact command appears, keyboard stays closed.
2. Open `My snippets` → create/edit/delete: buttons remain one row, search does not overflow, delete uses shared dialog.
3. Open Search: field is not focused; tapping field opens keyboard; `Aa`, previous/next and count work.
4. Tap terminal body or active dock button: panel closes and terminal returns to idle `Nhập · Chọn` behavior.
5. Switch terminal tab and close/reopen modal: no stale query, count, editor, addon or panel.
6. Repeat in mobile Editor terminal.

Expected: no horizontal page overflow; all touch targets at least 44×44px; light modal stays light and dark modal stays dark.

- [ ] **Step 4: Performance and cleanup acceptance**

In browser Performance panel:

1. Write or replay 1.000 terminal lines.
2. Open Search and search a common term, a missing term and a case-sensitive term.
3. Confirm no HAPI-owned search timer runs per socket output chunk.
4. Confirm representative search interaction creates no main-thread task longer than 50ms.
5. Open/close Search 20 times and switch terminal tabs 10 times; confirm only one live SearchAddon per mounted `TerminalView` and no increasing listener/timer count.
6. Reopen cached Snippets panel; confirm content appears within 100ms before any optional background refetch completes.

Expected: thresholds from the approved design are met. If the 50ms threshold is missed, capture the trace before changing the 150ms debounce or 1.000-decoration limit.

- [ ] **Step 5: Run complete automated verification**

```bash
bun test shared/src/terminalSnippets.test.ts
bun test hub/src/store/terminalSnippetStore.test.ts hub/src/store/migration-v11.test.ts hub/src/web/routes/terminalSnippets.test.ts
bun run --cwd web test
bun typecheck
bun run --cwd web build
```

Expected: all tests PASS, all typechecks exit 0, Vite production build exits 0.

- [ ] **Step 6: Review actual diff and mark design implemented**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Verify the diff contains no changes to CLI terminal transport, History, desktop controls, scrollback or unrelated preview/BMAD artifacts. Change the design status to:

```md
**Status:** Implemented and verified
```

- [ ] **Step 7: Final commit**

```bash
git add web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts docs/superpowers/specs/2026-07-28-terminal-search-snippets-design.md
git commit -m "docs: finalize terminal search and snippets"
```

## Final review gates

### Gate A — Contract và dữ liệu

- Shared request/response schemas enforce 80/8.192/240 limits.
- Hub derives namespace from auth context; request body cannot override it.
- SQLite quota 200 and stable newest-created order are tested.
- Cross-namespace update/delete returns 404.
- SSE invalidation carries only type + namespace.

### Gate B — Terminal safety

- Snippet insertion uses only `onWritePlainInput`.
- No Enter/newline appended and no automatic xterm focus.
- Search does not write to shell.
- SearchAddon instance/listener/timer cleanup is covered on close, switch and unmount.
- No second output debounce and no scrollback/buffer changes.

### Gate C — UX regression

- Snippets/Search float above dock without resizing terminal.
- Active tool toggles closed; terminal tap closes it.
- Opening a tool dismisses the mobile interaction bubble.
- Paste, Keys, More, selection/copy, vertical/horizontal terminal scrolling remain intact.
- History remains visibly disabled.

## Self-review result

- Spec coverage: every included requirement maps to Tasks 1–10 and Gates A–C.
- Scope check: Search and Snippets are separate implementation tracks until shared dock integration; each becomes independently testable before Task 9.
- Type consistency: `TerminalSnippet`, `TerminalSearchController`, `TerminalSearchState`, query key and SSE event names are identical across tasks.
- Placeholder scan: all code-changing steps contain exact files, signatures, commands and expected outcomes.
- Rollback: each task ends in a focused commit; reverting Search commits does not remove Snippet persistence, and reverting Snippet commits does not affect terminal transport.
