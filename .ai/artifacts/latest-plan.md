## Goal

Add a reviewable audit/action log to the web-based orchestrator so users can inspect every decision the proxy brain makes — especially `done` decisions. Each `done-check` entry must capture the machine-readable answer, the LLM raw response, the triggering message ID/seq, and a snapshot context count. The log is stored in-memory (same lifetime as the run), exposed via a new REST endpoint, and rendered in the detail page as a collapsible "Audit Log" section below the transcript.

Persistence trade-off: in-memory only, no SQLite changes. Log is lost on hub restart but avoids migration complexity. If persistence is later needed, entries map cleanly to a new `orchestrator_audit_log` table.

## Acceptance Criteria

- Every `isTaskDone()` call appends an `OrchestratorAuditEntry` with `type: 'done-check'`, `llmAnswer` (`"YES"` | `"NO"`), `triggeredByMessageId`, `triggeredBySeq`, `historySize`, and `ts` (epoch ms).
- Every `generateReply()` call appends an entry with `type: 'reply-generated'`, `triggeredByMessageId`, `triggeredBySeq`, `ts`.
- System events (`max-iterations`, `transcript-limit`, `engine-unavailable`, user-initiated `stop`) each append an entry with `type: 'system-event'`, `reason` string, and `ts`.
- When `isTaskDone()` returns `true`, the triggering `done-check` entry is the authoritative record; no additional field is required on `OrchestratorPublic`.
- `GET /api/orchestrators/:id/audit-log` returns `{ auditLog: OrchestratorAuditEntry[] }` ordered oldest-first; requires same namespace auth as transcript.
- Web detail page renders an "Audit Log" section below transcript; each entry shows type, ts, llmAnswer (if present), triggeredByMessageId (if present).
- `done-check` entries where `llmAnswer === "YES"` are visually highlighted (e.g., green badge).
- Audit log is capped at 1 000 entries (trimmed from oldest on overflow).
- All new types exported from `shared/src/schemas.ts` and re-exported from `shared/src/types.ts`.

## Constraints

- No new npm/bun dependencies.
- No SQLite schema changes.
- No changes to existing `OrchestratorPublic` shape (no breaking SSE event changes).
- No changes to the transcript endpoint or `OrchestratorTranscriptEntry` type.
- Stay within target files; do not touch unrelated hub routes.
- TypeScript strict; no `any` unless narrowing from `unknown` already present in the file.

## Target Files

- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/sync/orchestratorManager.ts`
- `hub/src/web/routes/orchestrators.ts`
- `web/src/types/api.ts`
- `web/src/api/client.ts`
- `web/src/hooks/queries/useOrchestrators.ts`
- `web/src/routes/orchestrators/$id.tsx`

## Test Plan

- `bun typecheck`
- `bun run test`

## Risks

- The `isTaskDone()` and `generateReply()` methods have no access to a message ID when called today; the caller (`runLoop`) must pass triggering message ID/seq down. This requires refactoring both method signatures and their single call-site — low risk but touches the internal loop logic.
- Audit log is in-memory; if a run is deleted via `stop()`, the log is lost immediately. The stop path should optionally append a final `system-event` before deleting so the last entry is visible until the page navigates away (timing race is acceptable).

## Execution Prompt for Codex

Implement the approved plan below.

Goal:
Add a reviewable in-memory audit log to the hub orchestrator that records every proxy-brain decision (done-check, reply-generated, system-event) and exposes it via a new REST endpoint and web UI section on the orchestrator detail page.

Acceptance criteria:
- Every `isTaskDone()` call appends an `OrchestratorAuditEntry` with `type: 'done-check'`, `llmAnswer` (`"YES"` | `"NO"`), `triggeredByMessageId` (string | null), `triggeredBySeq` (number | null), `historySize` (number), and `ts` (epoch ms).
- Every `generateReply()` call appends an entry with `type: 'reply-generated'`, `triggeredByMessageId`, `triggeredBySeq`, `ts`.
- System termination paths (max-iterations exceeded, transcript-limit reached, engine-unavailable, user stop) each append an entry with `type: 'system-event'`, `reason: string`, `ts`.
- `GET /api/orchestrators/:id/audit-log` returns `{ auditLog: OrchestratorAuditEntry[] }`, oldest-first, namespace-guarded (same pattern as transcript endpoint).
- Audit log is capped at 1 000 entries; trim from front on overflow.
- `OrchestratorAuditEntry` type is defined in `shared/src/schemas.ts` and re-exported from `shared/src/types.ts`.
- `web/src/types/api.ts` exports `OrchestratorAuditEntry` and `OrchestratorAuditLogResponse = { auditLog: OrchestratorAuditEntry[] }`.
- `web/src/api/client.ts` adds `getOrchestratorAuditLog(id: string): Promise<OrchestratorAuditLogResponse>`.
- `web/src/hooks/queries/useOrchestrators.ts` adds `useOrchestratorAuditLog(api, id)` query using key `queryKeys.orchestratorAuditLog(id)`.
- `web/src/routes/orchestrators/$id.tsx` renders an "Audit Log" section below the transcript; each row shows `type`, formatted `ts`, `llmAnswer` (badge, green if YES), and `triggeredByMessageId` (dimmed, truncated). The section is present unconditionally (empty state: `…`).
- `bun typecheck` passes with no new errors.

Constraints:
- No new npm/bun packages.
- No SQLite changes.
- No changes to `OrchestratorPublic` schema or the transcript endpoint.
- TypeScript strict; avoid `any`.
- Minimal diff; stay within target files.

Target files:
- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/sync/orchestratorManager.ts`
- `hub/src/web/routes/orchestrators.ts`
- `web/src/types/api.ts`
- `web/src/api/client.ts`
- `web/src/hooks/queries/useOrchestrators.ts`
- `web/src/routes/orchestrators/$id.tsx`

Required test commands:
- `bun typecheck`
- `bun run test`

Rules:
- Make the smallest patch that satisfies the plan.
- Stay within target files unless absolutely necessary.
- If you must change additional files, explain why.
- Run the required tests after editing when possible.
- Return:
  1. summary of changes
  2. files changed
  3. commands run
  4. test results
  5. unresolved concerns
