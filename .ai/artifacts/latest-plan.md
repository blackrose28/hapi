# Orchestrator web feature — plan

## Goal

Port the `orchestrator/main.py` proxy agent into the HAPI monorepo as a first-class feature. The orchestrator runs server-side inside the hub process (TypeScript port of the Python loop), is managed via new REST endpoints, streams live status updates over the existing SSE infrastructure, and is surfaced in the web PWA as a dedicated "Proxy Orchestrator" panel — supporting session selection, system prompt and goal editing, start/pause/stop controls, and a live transcript with proxy decision annotations.

## Acceptance Criteria

- Hub exposes `POST /api/orchestrators`, `GET /api/orchestrators/:id`, `DELETE /api/orchestrators/:id`, `PATCH /api/orchestrators/:id` (pause/resume) endpoints behind the existing JWT middleware
- Hub `OrchestratorManager` runs the poll-loop logic (TypeScript port of `MimicProxyAgent`) as a per-orchestrator async task; secrets never leave the server
- OpenAI API key and model are stored per-orchestrator config in memory (not in SQLite); never returned to the client after creation
- SSE emits `orchestrator-updated` events (`{ type: 'orchestrator-updated', orchestratorId, sessionId, data: OrchestratorStatus }`) that web clients receive via the existing `useSSE` hook
- Zod schemas for `OrchestratorConfig`, `OrchestratorStatus`, and `OrchestratorEvent` live in `shared/src/schemas.ts`
- Web PWA adds a route `/orchestrators` (list) and `/orchestrators/new` (create form) accessible from the main nav
- Web PWA shows a live orchestrator detail view at `/orchestrators/:id` with: status badge (running/paused/done/error), editable system prompt and session goal (only while paused/stopped), session picker using the existing sessions list, and a scrollable transcript of proxy messages with role labels
- Pausing the orchestrator suspends the poll loop without discarding state; resuming restores it
- All new hub routes follow existing `createXxxRoutes(getSyncEngine)` pattern; route is registered in `hub/src/web/server.ts`
- `bun typecheck` passes; `bun run test` passes with no new failures

## Constraints

- No new npm/bun dependencies: hub does not currently depend on `openai`; use native `fetch` against the OpenAI Responses API; do not add Python tooling
- OpenAI API key must not be stored in SQLite or returned in any API response after the creation POST
- Stay within the existing auth model — orchestrator endpoints require the same JWT as all other `/api/*` routes; orchestrators are namespace-scoped
- Do not modify the Python `orchestrator/main.py` — it stays as-is for CLI users
- Do not modify existing SSE event types in a breaking way — add only a new union member
- Orchestrator state is in-memory only (no new SQLite tables) — if hub restarts, orchestrators are gone
- Prefer 4-space indentation; TypeScript strict mode

## Target Files

- `shared/src/schemas.ts` — add `OrchestratorConfigSchema`, `OrchestratorStatusSchema`, `OrchestratorEventSchema`; extend `SyncEvent` union
- `shared/src/types.ts` — re-export new types
- `hub/src/sync/orchestratorManager.ts` — new file: `OrchestratorManager` class with start/pause/resume/stop and poll loop
- `hub/src/web/routes/orchestrators.ts` — new file: `createOrchestratorsRoutes` Hono router
- `hub/src/web/server.ts` — register new orchestrator router under `/api`; pass `OrchestratorManager` instance
- `hub/src/sse/sseManager.ts` — emit `orchestrator-updated` events (likely only a 1-2 line addition)
- `hub/src/index.ts` — instantiate `OrchestratorManager`, wire to server
- `web/src/hooks/queries/useOrchestrators.ts` — new file: TanStack Query hook for orchestrator list/detail
- `web/src/hooks/mutations/useOrchestratorActions.ts` — new file: create/pause/resume/stop mutations
- `web/src/components/Orchestrator/OrchestratorForm.tsx` — new file: create form (session picker, key, model, goal, system prompt)
- `web/src/components/Orchestrator/OrchestratorDetail.tsx` — new file: live status + transcript view
- `web/src/components/Orchestrator/OrchestratorList.tsx` — new file: list of active orchestrators
- `web/src/router.tsx` — add `/orchestrators`, `/orchestrators/new`, `/orchestrators/:id` routes
- `web/src/routes/orchestrators/index.tsx` — list page
- `web/src/routes/orchestrators/new.tsx` — create page
- `web/src/routes/orchestrators/$id.tsx` — detail page

## Test Plan

- `bun typecheck`
- `bun run test`
- Manual: create an orchestrator via `POST /api/orchestrators` with `curl`, confirm SSE emits `orchestrator-updated`, confirm GET returns status without leaking the API key, confirm DELETE stops the loop

## Risks

- **OpenAI SDK availability in hub**: hub `package.json` has no `openai`; use `fetch` to the Responses API; validate response shape against live API
- **SSE fan-out for orchestrator events**: the existing `SyncEvent` union and `sseManager.broadcast` may need a namespace filter so orchestrator events only reach the correct namespace's subscribers — inspect `sseManager.ts` broadcast signature before emitting
- **Pause semantics**: pausing by checking a flag in the async poll loop means one inflight OpenAI call may complete after pause — acceptable for MVP; document this
- **Memory leak on abandoned orchestrators**: if the web client disappears without stopping, the loop runs indefinitely; add a TTL or max-iterations guard in `OrchestratorManager`
- **Port of `should_respond` heuristic**: the Python code inspects `raw.content.content.type === 'event' && data.type === 'ready'` which is a hub-specific StoredMessage envelope format — verify this still matches live hub message shapes in TypeScript before trusting the trigger
- **Internal vs MCP**: the Python script talks to the hub via MCP JSON-RPC; the hub-native port should call `SyncEngine` / message APIs in-process — confirm method names and semantics match `get_messages_after` / `send_message` behavior

## Execution Prompt for Codex

Implement the approved plan below.

**Goal:** Port the `orchestrator/main.py` proxy-agent feature into the HAPI monorepo (hub + web). The orchestrator logic runs server-side in the hub (TypeScript), is managed via new REST endpoints, streams live updates over SSE, and is surfaced in the web PWA with a create form, list view, and live detail view.

**Acceptance criteria:**

- Hub exposes `POST /api/orchestrators`, `GET /api/orchestrators/:id`, `DELETE /api/orchestrators/:id`, `PATCH /api/orchestrators/:id` behind existing JWT middleware
- `OrchestratorManager` (hub) runs the poll loop in a per-orchestrator async task; OPENAI_API_KEY stays server-side and is never returned in responses
- SSE emits `orchestrator-updated` events carrying public orchestrator status (no key, no secret)
- Zod schemas in `shared/src/schemas.ts`, re-exported from `shared/src/types.ts`
- Web adds routes `/orchestrators`, `/orchestrators/new`, `/orchestrators/:id` using TanStack Router
- Web `useSSE` integration: `orchestrator-updated` events update TanStack Query cache for the detail view
- Pausing suspends the poll loop; resuming restores it without losing conversation history
- `bun typecheck` passes; `bun run test` passes

**Constraints:**

- Do not add new bun/npm packages; use `fetch` for OpenAI Responses API
- Do not modify `orchestrator/main.py`
- Do not store the OpenAI API key anywhere except in-memory on the server
- Do not add new SQLite tables; orchestrators are in-memory only
- Do not break existing SSE event consumers — only add a new union member to `SyncEvent`
- TypeScript strict; 4-space indentation; follow existing file patterns exactly

**Target files:** As listed in the Target Files section above.

**Step-by-step implementation order:**

1. **Shared types** — Add Zod schemas and extend `SyncEvent` union; re-export from `types.ts`.
2. **OrchestratorManager (hub)** — Port `MimicProxyAgent` loop; inject `getSyncEngine` and status callback; use in-process sync/message APIs (not MCP HTTP); OpenAI via `fetch`; add max-iteration / history guards.
3. **Hub routes** — `createOrchestratorsRoutes` with create/list/get/patch/delete; validate bodies with Zod; namespace-scoped.
4. **Wire hub** — Instantiate manager in `index.ts`, pass to `createWebApp`, register routes in `server.ts`; ensure SSE broadcast is namespace-safe.
5. **Web hooks** — TanStack Query + mutations; invalidate or patch cache on `orchestrator-updated` in app SSE handler.
6. **Web UI** — Form (session picker, password key field, model, prompts), list, detail with transcript; add optional `GET /api/orchestrators/:id/messages` if transcript is not fully represented in status payload.
7. **Routes + nav** — Register TanStack routes and a nav link.

**Required test commands:** `bun typecheck`, `bun run test`

**Rules:** Smallest patch; stay within target files unless necessary; run tests; return summary, files changed, commands run, test results, unresolved concerns.
