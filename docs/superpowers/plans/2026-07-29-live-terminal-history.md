# Live Terminal History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bật History trong Terminal Control Dock để đọc lịch sử Bash đang sống, tìm kiếm và chèn lệnh vào prompt mà không tự thực thi.

**Architecture:** Bash tạo snapshot riêng sau mỗi prompt trong thư mục runtime quyền `0700`; CLI đọc và parse snapshot theo terminal. Web gửi request qua Hub bằng correlation id dùng một lần; Hub xác thực quyền, chỉ trả response cho đúng socket Web, không lưu hoặc broadcast command history.

**Tech Stack:** TypeScript strict, Bun PTY, Bash `PROMPT_COMMAND`, Zod, Socket.IO, React 19, Vitest, Testing Library.

---

## File map

| File | Responsibility |
|---|---|
| `shared/src/socket.ts` | Contract và schema history dùng chung CLI/Hub/Web |
| `shared/src/socket.test.ts` | Validation contract, limit và status |
| `cli/src/terminal/bashHistory.ts` | Bash wrapper rc, runtime files, parser, cleanup |
| `cli/src/terminal/bashHistory.test.ts` | Parser, hook, permissions và cleanup |
| `cli/src/terminal/TerminalManager.ts` | Gắn adapter vào vòng đời terminal, trả history result |
| `cli/src/terminal/TerminalManager.test.ts` | Spawn Bash có wrapper; shell khác không bị chặn |
| `cli/src/api/apiSession.ts` / `apiMachine.ts` | Nhận request history và emit result |
| `hub/src/socket/terminalHistoryRequests.ts` | Correlation một lần, timeout và cleanup |
| `hub/src/socket/server.ts` | Tạo một registry dùng chung giữa namespace Web và CLI |
| `hub/src/socket/handlers/terminal.ts` | Xác thực terminal rồi forward request |
| `hub/src/socket/handlers/cli/terminalHandlers.ts` | Xác thực CLI result rồi trả đúng Web socket |
| `web/src/hooks/useTerminalSocket.ts` | API request/listener history cho terminal single và multi-tab |
| `web/src/components/Terminal/useTerminalHistory.ts` | State machine chống response cũ |
| `web/src/components/Terminal/TerminalHistoryPanel.tsx` | Search local, refresh, states, insert-only |
| `web/src/components/Terminal/TerminalControlDock.tsx` | Bật History mobile và render anchored panel |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | Nút History desktop và kết nối state/socket |
| `web/src/components/editor/EditorTerminal.tsx` | Search/Snippets/History desktop cho machine surface |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | Copy History |

### Task 1: Shared terminal history contract

**Files:**
- Modify: `shared/src/socket.ts`
- Modify: `shared/src/socket.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests proving:

```ts
expect(TerminalHistoryRequestSchema.safeParse({
    sessionId: 's1',
    terminalId: 't1',
    requestId: 'r1',
    limit: 100
}).success).toBe(true)

expect(TerminalHistoryRequestSchema.safeParse({
    machineId: 'm1',
    terminalId: 't1',
    requestId: 'r1',
    limit: 101
}).success).toBe(false)

expect(TerminalHistoryResultSchema.safeParse({
    sessionId: 's1',
    terminalId: 't1',
    requestId: 'r1',
    status: 'ok',
    shell: 'bash',
    entries: [{ index: 42, command: 'git status' }]
}).success).toBe(true)
```

- [ ] **Step 2: Verify RED**

Run:

```bash
bun test shared/src/socket.test.ts
```

Expected: FAIL because the history schemas are not exported.

- [ ] **Step 3: Add exact types and schemas**

Add:

```ts
export const TerminalHistoryEntrySchema = z.object({
    index: z.number().int().nonnegative(),
    command: z.string().min(1)
}).strict()

export const TerminalHistoryStatusSchema = z.enum([
    'ok',
    'unsupported_shell',
    'not_ready',
    'read_failed'
])

export const TerminalHistoryRequestSchema = z.union([
    z.object({
        sessionId: z.string().min(1),
        terminalId: z.string().min(1),
        requestId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
    }).strict(),
    z.object({
        machineId: z.string().min(1),
        terminalId: z.string().min(1),
        requestId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
    }).strict()
])

export const TerminalHistoryResultSchema = z.union([
    z.object({
        sessionId: z.string().min(1),
        terminalId: z.string().min(1),
        requestId: z.string().min(1),
        status: TerminalHistoryStatusSchema,
        shell: z.string().min(1).optional(),
        entries: z.array(TerminalHistoryEntrySchema).max(100)
    }).strict(),
    z.object({
        machineId: z.string().min(1),
        terminalId: z.string().min(1),
        requestId: z.string().min(1),
        status: TerminalHistoryStatusSchema,
        shell: z.string().min(1).optional(),
        entries: z.array(TerminalHistoryEntrySchema).max(100)
    }).strict()
])
```

Infer and export `TerminalHistoryEntry`, `TerminalHistoryRequest`, `TerminalHistoryResult`, and add `terminal:history` / `terminal:history-result` to the existing Socket.IO event interfaces in the correct directions.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test shared/src/socket.test.ts
bun run typecheck:shared
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/socket.ts shared/src/socket.test.ts
git commit -m "feat(protocol): add terminal history contract"
```

### Task 2: Bash runtime adapter and snapshot parser

**Files:**
- Create: `cli/src/terminal/bashHistory.ts`
- Create: `cli/src/terminal/bashHistory.test.ts`

- [ ] **Step 1: Write failing parser tests**

Cover:

```ts
expect(parseBashHistorySnapshot(
    '  40  pwd\n  41  printf \"a\\nb\"\n      continuation\n  42  git status\n',
    100
)).toEqual([
    { index: 42, command: 'git status' },
    { index: 41, command: 'printf \"a\\nb\"\\ncontinuation' },
    { index: 40, command: 'pwd' }
])
```

Also prove empty/malformed leading lines are ignored, duplicates remain, and the newest `limit` entries are returned.

- [ ] **Step 2: Verify parser RED**

Run:

```bash
bun test cli/src/terminal/bashHistory.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the parser**

Export:

```ts
export function parseBashHistorySnapshot(
    snapshot: string,
    limit: number
): TerminalHistoryEntry[]
```

Use `/^\s*(\d+)\s+(.*)$/` for a new item, append non-numbered continuation lines to the previous command with `\n`, discard empty commands, reverse once, and slice to `Math.min(100, Math.max(1, limit))`.

- [ ] **Step 4: Verify parser GREEN**

Run:

```bash
bun test cli/src/terminal/bashHistory.test.ts
```

Expected: parser tests PASS.

- [ ] **Step 5: Write failing runtime tests**

Use an injected `rootDir` and assert:

```ts
const runtime = createBashHistoryRuntime({ terminalId: 'term-1', rootDir })
expect(statSync(runtime.directory).mode & 0o777).toBe(0o700)
expect(readFileSync(runtime.rcPath, 'utf8')).toContain('builtin history 100')
expect(readFileSync(runtime.rcPath, 'utf8')).toContain('PROMPT_COMMAND')
cleanupBashHistoryRuntime(runtime)
expect(existsSync(runtime.directory)).toBe(false)
```

Also execute `bash --noprofile --rcfile <wrapper> -i` with a controlled HOME/PROMPT_COMMAND fixture to prove the existing prompt command remains and the snapshot is written without touching the fixture `.bash_history`.

- [ ] **Step 6: Implement runtime creation and cleanup**

Export:

```ts
export type BashHistoryRuntime = {
    shell: 'bash'
    directory: string
    rcPath: string
    snapshotPath: string
    tempPath: string
}

export function createBashHistoryRuntime(input: {
    terminalId: string
    rootDir?: string
}): BashHistoryRuntime

export function cleanupBashHistoryRuntime(runtime: BashHistoryRuntime): void
```

Create via `mkdtempSync`, `chmodSync(directory, 0o700)`, write wrapper `0o600`, and remove recursively with `rmSync(..., { recursive: true, force: true })`.

The wrapper must:

```bash
[[ -f "${HOME:-}/.bashrc" ]] && source "${HOME}/.bashrc"
__hapi_capture_history() {
    { builtin history 100 > "$HAPI_HISTORY_TEMP" \
        && command mv -f -- "$HAPI_HISTORY_TEMP" "$HAPI_HISTORY_SNAPSHOT"; } 2>/dev/null
    return 0
}
```

Append `__hapi_capture_history` to either string or array `PROMPT_COMMAND` without overwriting the user's value.

- [ ] **Step 7: Verify adapter GREEN**

Run:

```bash
bun test cli/src/terminal/bashHistory.test.ts
```

Expected: all adapter tests PASS and no runtime directory remains.

- [ ] **Step 8: Commit**

```bash
git add cli/src/terminal/bashHistory.ts cli/src/terminal/bashHistory.test.ts
git commit -m "feat(cli): capture live bash history"
```

### Task 3: Attach history to TerminalManager and CLI sockets

**Files:**
- Modify: `cli/src/terminal/TerminalManager.ts`
- Modify: `cli/src/terminal/TerminalManager.test.ts`
- Modify: `cli/src/api/apiSession.ts`
- Modify: `cli/src/api/apiSession.test.ts`
- Modify: `cli/src/api/apiMachine.ts`
- Modify: `cli/src/api/apiMachine.test.ts`

- [ ] **Step 1: Write failing manager tests**

Add tests that assert:

```ts
const created = manager.create({ terminalId: 't1', cols: 80, rows: 24 })
expect(spawnArgv).toEqual([bashPath, '--rcfile', expect.any(String)])
expect(spawnEnv.HAPI_HISTORY_SNAPSHOT).toEqual(expect.any(String))

expect(manager.getHistory({
    sessionId: 's1',
    terminalId: 't1',
    requestId: 'r1',
    limit: 20
})).toMatchObject({ status: 'not_ready', entries: [] })
```

Add cases for a populated snapshot (`ok`), non-Bash (`unsupported_shell`), missing terminal (`not_ready`), read failure (`read_failed`), and cleanup on terminal close/process exit.

- [ ] **Step 2: Verify manager RED**

Run:

```bash
bun test cli/src/terminal/TerminalManager.test.ts
```

Expected: FAIL because `getHistory` and adapter-backed spawn do not exist.

- [ ] **Step 3: Implement manager integration**

Extend each runtime with optional Bash history metadata. For Bash:

```ts
const historyRuntime = createBashHistoryRuntime({ terminalId })
argv = [shell, '--rcfile', historyRuntime.rcPath]
env = {
    ...this.filteredEnv,
    HAPI_HISTORY_SNAPSHOT: historyRuntime.snapshotPath,
    HAPI_HISTORY_TEMP: historyRuntime.tempPath
}
```

If setup throws, spawn `[shell]` normally and retain an internal `read_failed` capability state. Implement:

```ts
getHistory(request: TerminalHistoryRequest): TerminalHistoryResult
```

Read only the matching terminal runtime snapshot, return at most 100 entries, never log commands, and clean runtime files in the existing single cleanup path.

- [ ] **Step 4: Verify manager GREEN**

Run:

```bash
bun test cli/src/terminal/TerminalManager.test.ts cli/src/terminal/bashHistory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing API relay tests**

For both session and machine API harnesses:

```ts
socket.trigger('terminal:history', request)
expect(socket.emit).toHaveBeenCalledWith(
    'terminal:history-result',
    expect.objectContaining({
        requestId: request.requestId,
        terminalId: request.terminalId
    })
)
```

Prove invalid scope payloads are ignored.

- [ ] **Step 6: Verify relay RED**

Run:

```bash
bun test cli/src/api/apiSession.test.ts cli/src/api/apiMachine.test.ts
```

Expected: FAIL because no listener is registered.

- [ ] **Step 7: Register the request handlers**

Parse with `TerminalHistoryRequestSchema`, reuse the existing session/machine scope guards, call `terminalManager.getHistory(parsed.data)`, and emit `terminal:history-result`. Do not log the request/result.

- [ ] **Step 8: Verify relay GREEN and commit**

Run:

```bash
bun test cli/src/api/apiSession.test.ts cli/src/api/apiMachine.test.ts
bun run typecheck:cli
git add cli/src/terminal cli/src/api/apiSession.ts cli/src/api/apiSession.test.ts cli/src/api/apiMachine.ts cli/src/api/apiMachine.test.ts
git commit -m "feat(cli): serve terminal history requests"
```

### Task 4: Secure Hub correlation and routing

**Files:**
- Create: `hub/src/socket/terminalHistoryRequests.ts`
- Create: `hub/src/socket/terminalHistoryRequests.test.ts`
- Modify: `hub/src/socket/server.ts`
- Modify: `hub/src/socket/handlers/terminal.ts`
- Modify: `hub/src/socket/handlers/terminal.test.ts`
- Modify: `hub/src/socket/handlers/cli/index.ts`
- Modify: `hub/src/socket/handlers/cli/terminalHandlers.ts`
- Modify: `hub/src/socket/handlers/cli/terminalHandlers.test.ts`

- [ ] **Step 1: Write failing correlation registry tests**

Prove:

```ts
const id = registry.register({
    webSocketId: 'web-1',
    webRequestId: 'request-1',
    cliSocketId: 'cli-1',
    terminalId: 'term-1',
    namespace: 'default',
    scope: { sessionId: 'session-1' }
})

expect(registry.consume(id, {
    cliSocketId: 'cli-1',
    terminalId: 'term-1',
    namespace: 'default',
    scope: { sessionId: 'session-1' }
})?.webRequestId).toBe('request-1')
expect(registry.consume(id, sameIdentity)).toBeNull()
```

Also prove wrong CLI/scope cannot consume, entries expire after 10 seconds, and `removeByWebSocket('web-1')` clears pending entries.

- [ ] **Step 2: Verify registry RED**

Run:

```bash
bun test hub/src/socket/terminalHistoryRequests.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement correlation registry**

Create a focused class with an internal `Map`, generated opaque correlation ids, one-shot `consume`, injected `now` for deterministic tests, `ttlMs = 10_000`, and cleanup methods for Web/CLI disconnect. Store IDs and scope only—never history entries.

- [ ] **Step 4: Verify registry GREEN**

Run:

```bash
bun test hub/src/socket/terminalHistoryRequests.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing Web→CLI routing tests**

In `handlers/terminal.test.ts`, prove:

- owner/authorized attached session socket forwards a clamped request with an opaque request id;
- wrong namespace/unowned machine terminal does not forward;
- malformed request does not forward;
- disconnect clears the pending correlation.

Expected forwarding shape:

```ts
expect(cliSocket.emit).toHaveBeenCalledWith('terminal:history', {
    sessionId: 'session-1',
    terminalId: 'term-1',
    requestId: expect.not.stringMatching(/^web-request-/),
    limit: 100
})
```

- [ ] **Step 6: Implement Web→CLI routing**

Parse the Web payload `{ terminalId, requestId, limit? }`, clamp `limit` to `1..100`, resolve ownership with `resolveEntryForControl`, create correlation mapping, derive the scope from the registry entry, and forward to its CLI socket. Remove correlation if forwarding fails.

- [ ] **Step 7: Write failing CLI→Web routing tests**

In `handlers/cli/terminalHandlers.test.ts`, prove:

- valid matching result reaches only `web-1`, with original Web request id;
- no room broadcast occurs;
- forged terminal/scope/CLI response is ignored;
- duplicate or expired response is ignored.

- [ ] **Step 8: Implement CLI→Web routing**

Parse `TerminalHistoryResultSchema`, authorize scope, consume the correlation only when CLI socket, namespace, scope and terminal all match, then:

```ts
terminalNamespace.sockets.get(pending.webSocketId)?.emit(
    'terminal:history-result',
    { ...parsed.data, requestId: pending.webRequestId }
)
```

Instantiate one `TerminalHistoryRequestRegistry` in `server.ts` and inject it into both handler trees. Remove pending mappings on Web and CLI disconnect.

- [ ] **Step 9: Verify Hub and commit**

Run:

```bash
bun test hub/src/socket/terminalHistoryRequests.test.ts \
    hub/src/socket/handlers/terminal.test.ts \
    hub/src/socket/handlers/cli/terminalHandlers.test.ts
bun run typecheck:hub
git add hub/src/socket
git commit -m "feat(hub): route terminal history privately"
```

### Task 5: Web socket API and stale-response-safe state

**Files:**
- Modify: `web/src/hooks/useTerminalSocket.ts`
- Modify: `web/src/hooks/useTerminalSocket.test.tsx`
- Create: `web/src/components/Terminal/useTerminalHistory.ts`
- Create: `web/src/components/Terminal/useTerminalHistory.test.tsx`

- [ ] **Step 1: Write failing socket tests**

For single and session controllers, assert:

```ts
expect(result.current.requestHistory('request-1', 100)).toBe(true)
expect(socket.emit).toHaveBeenCalledWith('terminal:history', {
    terminalId: 'terminal-1',
    requestId: 'request-1',
    limit: 100
})
```

Register `onHistory`, trigger `terminal:history-result`, and prove only the matching terminal is delivered. Return `false` when the socket is disconnected.

- [ ] **Step 2: Verify socket RED**

Run:

```bash
bun test web/src/hooks/useTerminalSocket.test.tsx
```

Expected: FAIL because request/listener methods are absent.

- [ ] **Step 3: Implement socket methods**

Add:

```ts
requestHistory(requestId: string, limit?: number): boolean
onHistory(handler: (result: TerminalHistoryResult) => void): void
```

For the multi-terminal controller, use:

```ts
requestHistory(terminalId: string, requestId: string, limit?: number): boolean
```

Keep the latest handler in a ref like output/exit handlers and attach exactly one socket listener.

- [ ] **Step 4: Verify socket GREEN**

Run:

```bash
bun test web/src/hooks/useTerminalSocket.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing state-machine tests**

Render a hook harness and prove:

- `open()` immediately becomes loading and requests max 100;
- matching `ok` response becomes ready;
- stale request id and stale terminal key are ignored;
- `refresh()` replaces the active request id;
- terminal key change and `close()` reset state;
- unsupported/read errors map to explicit UI states.

- [ ] **Step 6: Implement `useTerminalHistory`**

Expose:

```ts
type TerminalHistoryState =
    | { status: 'idle'; entries: [] }
    | { status: 'loading'; entries: [] }
    | { status: 'ready'; entries: TerminalHistoryEntry[] }
    | { status: 'unsupported'; entries: []; shell?: string }
    | { status: 'error'; entries: []; message: string }

useTerminalHistory({
    terminalContextKey,
    request,
    subscribe
}): {
    state: TerminalHistoryState
    open: () => void
    refresh: () => void
    close: () => void
}
```

Use `crypto.randomUUID()` when available with a monotonic fallback, store current request id + terminal key in refs, and never persist entries.

- [ ] **Step 7: Verify state and commit**

Run:

```bash
bun test web/src/hooks/useTerminalSocket.test.tsx \
    web/src/components/Terminal/useTerminalHistory.test.tsx
git add web/src/hooks/useTerminalSocket.ts web/src/hooks/useTerminalSocket.test.tsx \
    web/src/components/Terminal/useTerminalHistory.ts web/src/components/Terminal/useTerminalHistory.test.tsx
git commit -m "feat(web): add terminal history state"
```

### Task 6: History panel and mobile dock

**Files:**
- Create: `web/src/components/Terminal/TerminalHistoryPanel.tsx`
- Create: `web/src/components/Terminal/TerminalHistoryPanel.test.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`

- [ ] **Step 1: Write failing panel tests**

Prove:

- loading, empty, unsupported and error copy render;
- filtering is local and case-insensitive;
- Refresh invokes exactly one request;
- selecting `git status` invokes `onInsert('git status')`, never includes `\r` or `\n`;
- successful insert closes panel and announces `Inserted · not executed`;
- failed insert keeps panel open and shows insert error.

- [ ] **Step 2: Verify panel RED**

Run:

```bash
bun test web/src/components/Terminal/TerminalHistoryPanel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the panel**

Match Search/Snippets tokens:

- header with title, count, Refresh and Close;
- search input;
- newest-first independently scrollable list;
- item `min-h-11`, monospace, maximum two visual lines;
- `max-h-[48dvh]` mobile and bounded desktop size;
- no modal, storage, network search or auto-execution.

- [ ] **Step 4: Verify panel GREEN**

Run:

```bash
bun test web/src/components/Terminal/TerminalHistoryPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing dock tests**

Prove the mobile History button is enabled, toggles active state, renders the anchored panel, and terminal-body close clears it through `onActiveToolChange(null)`.

- [ ] **Step 6: Wire the panel into the dock**

Extend dock props with `historyState`, `onHistoryOpen`, `onHistoryRefresh`, `onHistoryClose`; replace the disabled button with:

```tsx
<DockButton
    tool="history"
    label={t('terminal.controls.history')}
    active={activeTool === 'history'}
    disabled={disabled}
    onClick={() => toggleTool(activeTool, 'history', onActiveToolChange)}
/>
```

Call history open when the active tool becomes History and render `TerminalHistoryPanel` in the same anchored layer as Search/Snippets.

- [ ] **Step 7: Verify dock and commit**

Run:

```bash
bun test web/src/components/Terminal/TerminalHistoryPanel.test.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx
git add web/src/components/Terminal/TerminalHistoryPanel* \
    web/src/components/Terminal/TerminalControlDock*
git commit -m "feat(web): add mobile terminal history panel"
```

### Task 7: Desktop access, terminal switching and translations

**Files:**
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.test.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`
- Modify: `web/src/components/editor/EditorTerminal.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: Write failing integration tests**

Prove on both terminal surfaces:

- desktop History appears beside Search and Snippets;
- clicking opens the shared History panel without resizing terminal;
- clicking terminal body closes History;
- switching terminal tab resets entries and ignores the prior response;
- selecting an item writes plain command only and closes on success.

- [ ] **Step 2: Verify integration RED**

Run:

```bash
bun test web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.test.tsx
```

Expected: FAIL because History is not wired.

- [ ] **Step 3: Wire session tabs**

Create one `useTerminalHistory` instance keyed by active terminal id, subscribe via `useSessionTerminalSocket.onHistory`, request with active terminal id, and pass state/actions to `TerminalControlDock`. Add a desktop History icon using `TerminalToolIcon`, the same active violet classes, and `aria-pressed`.

- [ ] **Step 4: Wire editor machine terminal**

For the machine-mode `useTerminalSocket`, connect the same history hook. Where the desktop status row currently has no action group, add a single compact group containing Search, Snippets and History; keep the mobile dock unchanged and do not add a second standalone toolbar.

- [ ] **Step 5: Add translation copy**

Add keys in all three locales for title/count/search placeholder/refresh/loading/empty/no matches/unsupported/error/retry/inserted-not-executed/insert-failed. Vietnamese examples:

```ts
'terminal.history.title': 'Lịch sử',
'terminal.history.searchPlaceholder': 'Tìm trong lịch sử…',
'terminal.history.inserted': 'Đã chèn · chưa thực thi',
'terminal.history.unsupported': 'Shell này chưa hỗ trợ lịch sử trực tiếp.'
```

- [ ] **Step 6: Verify integration GREEN and commit**

Run:

```bash
bun test web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.test.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/TerminalHistoryPanel.test.tsx
bun run typecheck:web
git add web/src/components web/src/lib/locales
git commit -m "feat(web): expose terminal history on all screens"
```

### Task 8: Cross-layer verification and closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-live-terminal-history-design.md`

- [ ] **Step 1: Update spec status**

Change the status line to:

```md
**Trạng thái:** Đã triển khai và kiểm chứng
```

Only do this after all verification commands below pass.

- [ ] **Step 2: Run focused cross-layer tests**

```bash
bun test shared/src/socket.test.ts
bun test cli/src/terminal/bashHistory.test.ts cli/src/terminal/TerminalManager.test.ts \
    cli/src/api/apiSession.test.ts cli/src/api/apiMachine.test.ts
bun test hub/src/socket/terminalHistoryRequests.test.ts \
    hub/src/socket/handlers/terminal.test.ts \
    hub/src/socket/handlers/cli/terminalHandlers.test.ts
bun test web/src/hooks/useTerminalSocket.test.tsx \
    web/src/components/Terminal/useTerminalHistory.test.tsx \
    web/src/components/Terminal/TerminalHistoryPanel.test.tsx \
    web/src/components/Terminal/TerminalControlDock.test.tsx \
    web/src/components/Terminal/SessionTerminalTabs.test.tsx \
    web/src/components/editor/EditorTerminal.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Run full static verification**

```bash
bun run typecheck
bun run build
```

Expected: all packages typecheck; CLI, Hub and Web builds complete.

- [ ] **Step 4: Run full regression suites**

```bash
bun run test:shared
bun run test:cli
bun run test:hub
bun run test:web
```

Expected: all PASS. If an unrelated pre-existing failure occurs, record the exact command/output and do not claim the suite passed.

- [ ] **Step 5: Manual acceptance**

Run HAPI locally and verify:

1. Bash command executed in the active terminal appears after opening/refreshing History.
2. Clicking it inserts text only; it does not run until Enter.
3. Search filters locally; refresh preserves terminal and updates data.
4. Mobile and desktop panels remain anchored without resizing terminal.
5. Switching tabs clears History; a delayed old response does not reappear.
6. Non-Bash terminal remains usable and shows unsupported state.
7. Closing terminal removes its private runtime directory.

- [ ] **Step 6: Review actual diff**

```bash
git diff --check
git status --short
git diff --stat HEAD~7..HEAD
```

Confirm there are no command contents in logs/storage, no `.bash_history` writes, no `\r` appended on insert, and unrelated dirty preview/BMAD artifacts are untouched.

- [ ] **Step 7: Commit closeout**

```bash
git add docs/superpowers/specs/2026-07-29-live-terminal-history-design.md
git commit -m "docs: mark terminal history implemented"
```

## Rollback

- Revert the feature commits; no database migration or persisted browser data exists.
- Existing terminals remain usable if the history hook setup fails because the spawn path falls back to the original shell invocation.
- Runtime snapshot directories are temporary and safe to remove recursively.
- Hub restart clears all pending 10-second correlation mappings.
