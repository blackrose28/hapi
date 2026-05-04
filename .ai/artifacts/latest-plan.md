## Goal

Improve the orchestrator audit log so users can understand each entry without external lookups. Currently, `done-check` and `reply-generated` entries render a raw UUID (`trigger=<uuid>`) and a bare integer (`seq=132`), neither of which maps visibly to any message in the UI. The fix has two parts: (1) expose `seq` from the transcript API so each transcript line is addressable by sequence number, and (2) rewrite the audit log rendering in the web UI to show the triggering message's role + content preview (resolved from the already-loaded transcript) and use readable labels for seq and history counts.

## Acceptance Criteria

- `OrchestratorTranscriptEntry` schema includes an optional `seq` field (`number | null`).
- `GET /api/orchestrators/:id/transcript` returns `seq` on each entry.
- Audit log entries of type `done-check` and `reply-generated` no longer show a raw UUID; instead they show `[role] content_preview…` resolved from the transcript, falling back to a truncated message ID if no match is found.
- `seq=N` is replaced with `Msg #N` (or "seq unknown" when null).
- `history=N` is replaced with `History: N msgs`.
- System-event entries continue to render the `reason` string, unchanged in shape.
- No new dependencies are added.

## Constraints

- Minimal diff; do not restructure the component or change unrelated UI.
- Stay within the three target files; do not touch other routes or hooks.
- TypeScript strict compliance; no `any` casts.
- The transcript lookup is a pure in-memory array scan on the already-fetched data; no additional API calls.

## Target Files

- `shared/src/schemas.ts`
- `hub/src/sync/orchestratorManager.ts`
- `web/src/routes/orchestrators/$id.tsx`

## Test Plan

- `bun typecheck`
- `bun run test`

## Risks

- `seq` on transcript entries is nullable at the hub (`seq?: number | null`); the UI must handle `null` gracefully, which the fallback label covers.
- If the transcript is paginated / trimmed and the triggering message was evicted, the lookup returns no match; the UUID truncation fallback handles this but provides partial info only.

## Execution Prompt for Codex

Implement the approved plan below.

Goal:
Make the orchestrator audit log human-readable by (a) exposing `seq` on transcript entries and (b) resolving trigger UUIDs to role+content previews in the web UI.

Acceptance criteria:
- `OrchestratorTranscriptEntrySchema` gains `seq: z.number().nullable().optional()`.
- `getTranscript()` in `orchestratorManager.ts` maps `seq` through to the returned objects.
- In `$id.tsx`, the audit log rows for `done-check` and `reply-generated` show:
  - A resolved message line: find the entry in `transcript` where `entry.id === auditEntry.triggeredByMessageId`, render `[role] first-80-chars-of-content…`; if not found, fall back to `msg …${last8charsOfId}`.
  - `Msg #N` in place of `seq=N`; `seq unknown` when null.
  - For `done-check` only: `History: N msgs` in place of `history=N`.

Constraints:
- Minimal diff.
- Stay within target files unless absolutely necessary.
- No new npm/bun dependencies.
- TypeScript strict; no `any`.

Target files:
- `shared/src/schemas.ts`
- `hub/src/sync/orchestratorManager.ts`
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
