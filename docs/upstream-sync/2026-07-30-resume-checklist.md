# Upstream sync round 2026-07-30 — resume checklist

Last updated: 2026-08-01. All divergence-zone carts and needs-review carts are resolved.
Read `docs/upstream-sync/2026-07-30-round.md` for full per-cart detail.

## Completed (committed on `feat/shared-hub-shipping`)

| Commit | Cart(s) | Files |
|--------|---------|-------|
| `c163fc05` | R2a, R3, carts 1–6 (docs-gemini-cleanup, peer-messaging, acp-shared-fixes, kimi, pi, grok) | 207 |
| `16086801` | Cart 7: scratchlist-feature v1→v2.2 | 38 |

Skipped/deferred:
- `R1-hub-legacy-auth` — skipped (files don't exist in our tree)
- `R2b-terminal-exit-auto-navigation` — deferred (design doc at `docs/superpowers/specs/`)
- `peer-messaging-ping-peer` — skipped (legacy auth wall)
- `hub-push-notifications` — deferred (no native mobile app; FCM push has no consumer)

## What remains: 82 pending feature carts

These are all in the `pending` status in the round file. They haven't been triaged for adopt/skip/defer yet. The next session should:

1. **Read the SKILL.md** at `.agents/skills/upstream-sync/SKILL.md` for the full operational guide.
2. **Read the round file** `docs/upstream-sync/2026-07-30-round.md` — scroll to the 82 `pending` rows.
3. **Triage each cart** (adopt / skip / defer) based on relevance to our branch.
4. **Port adopted carts** following the same pattern used for carts 1–7:
   - Spawn a subagent with a comprehensive brief (commit list, file list, gaps to route around)
   - Independently verify: typecheck × 4, tests × 4, round file update
5. **Commit in batches** as carts are verified.

## Recurring gotchas (from this round)

- **`shared/src/apiTypes.ts` does not exist** — fold schemas into `shared/src/schemas.ts`
- **`cli/src/commands/resume.ts` does not exist** — skip resume-command wiring
- **Test runner differs by package**: cli/web → `bunx vitest run`; shared/hub → `bun test`
- **DB schema is now at V14** — any new migration must use V14→V15
- **`composer-attachment-drafts` is a stub** — returns null (re-upload always); replace when that upstream module is ported
- **Mermaid-rendering test** occasionally flakes with 5s timeout — rerun once before treating as real

## Test counts (baseline for regression detection)

| Package | Tests | Files |
|---------|-------|-------|
| shared | 89 | 9 |
| hub | 512 | 66 |
| cli | 871 | 105 |
| web | 1327 | 164 |
