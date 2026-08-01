# Upstream sync round 2026-07-30 — resume checklist

Last updated: 2026-08-01 15:16 ICT. Batch 1 (foundation) complete, typecheck clean.
82 pending carts triaged: **72 adopt**, **5 defer**, **5 skip**.
Read `docs/upstream-sync/2026-07-30-round.md` for full per-cart detail.

## Completed (committed on `feat/shared-hub-shipping`)

| Commit | Cart(s) | Files |
|--------|---------|-------|
| `c163fc05` | R2a, R3, carts 1–6 (docs-gemini-cleanup, peer-messaging, acp-shared-fixes, kimi, pi, grok) | 207 |
| `16086801` | Cart 7: scratchlist-feature v1→v2.2 | 38 |

Skipped/deferred (from initial triage):
- `R1-hub-legacy-auth` — skipped (files don't exist in our tree)
- `R2b-terminal-exit-auto-navigation` — deferred (design doc at `docs/superpowers/specs/`)
- `peer-messaging-ping-peer` — skipped (legacy auth wall)
- `hub-push-notifications` — deferred (no native mobile app; FCM push has no consumer)

## Batch 1: Foundation — ✅ DONE (uncommitted)

All 3 carts ported, typecheck clean across all 4 packages.
**Changes are in working tree, NOT yet committed.** Next session should commit.

| Cart | Commits | Status | Notes |
|------|---------|--------|-------|
| `shared-schema-refactors` | 12 | ✅ done | Created `rpcMethods.ts`, `slashCommands.ts`, `sessionConfigRpc.ts`, `agentCommandOptions.ts`; folded `apiTypes.ts` into `schemas.ts`; consolidated types across cli/hub/shared/web |
| `cross-package-build-coupling` | 1 | ✅ done | Moved `APP_VERSION` to `shared/src/buildInfo.ts`; extracted `hub/src/startHub.ts`; relocated tunwg binary path |
| `chore-cleanup` | 2 | ✅ done | Removed 6 dead files; cleaned locale keys; fixed duplicate `isKnownFlavor` export |

**Post-porter fixups applied:**
- `web/src/types/api.ts` — removed duplicate re-exports (AuthResponse, MachinesResponse, etc. have web-specific shapes); restored local definitions; added `RunnerState` import
- `shared/src/schemas.ts` — added `scratchlistUpdatedAt` to `SessionPatchSchema` (gap from cart 7)
- `shared/src/index.ts` — added `rpcMethods` re-export
- `hub/src/sync/rpcGateway.ts` — removed duplicate `RpcOpencodeModel`/`RpcListOpencodeModelsResponse` local defs
- `hub/src/sync/sessionCache.ts` — fixed import split (`types` vs `schemas`)
- `hub/src/sync/machineCache.ts` — parse `runnerState` through `RunnerStateSchema`
- `web/src/hooks/useSSE.ts` — cast `event.data as Machine` for type compatibility

## Triage results (2026-08-01)

### Skip (5 carts, 27 commits)

| Cart ID | Commits | Rationale |
|---------|---------|-----------|
| `remove-unused-docs` | 1 | `refactor.md` doesn't exist; upstream-only docs |
| `contributing-policy-doc` | 1 | `CONTRIBUTING.md` doesn't exist; upstream policy |
| `ci-fork-pr-checkout` | 1 | `.github/workflows/` deleted; upstream CI |
| `upstream-release-version-bumps` | 23 | Independent versioning; upstream release train |
| `hub-push-notifications` | 1 | No native mobile app; FCM has no consumer |

### Defer (4 carts, 4 commits) — unblock after prerequisite lands

| Cart ID | Commits | Prerequisite |
|---------|---------|--------------|
| `windows-schedule-picker` | 1 | `hub-messaging-scheduling` (creates `ScheduleTimePicker.tsx`) |
| `filepath-autolink-ergonomics` | 1 | `session-file-browser-preview` (creates `remark-file-path-links.ts`) |
| `message-actions-metadata-refine` | 1 | `message-tool-metadata-timing` (creates `MessageMetadata.tsx`) |
| `codex-import-workdir-filter` | 1 | `codex-session-import-resume` (creates Codex import UI) |

### Adopt (72 carts) — execution plan below

## Execution plan: 12 batches

Port order respects dependency chains (see triage artifact for Mermaid DAG).

### Batch 1: Foundation — ✅ DONE
- [x] `shared-schema-refactors` (12 commits) — **`apiTypes→schemas.ts` fold**; high conflict surface
- [x] `cross-package-build-coupling` (1 commit)
- [x] `chore-cleanup` (2 commits)

### Batch 2: Hub core
- [ ] `hub-session-lifecycle` (7 commits) — `apiTypes→schemas.ts` fold
- [ ] `hub-sqlite-storage` (4 commits) — `apiTypes→schemas.ts` fold; V14→V15 migration
- [ ] `hub-messaging-scheduling` (4 commits) — creates `ScheduleTimePicker.tsx`
- [ ] `telegram-notifications` (1 commit)

### Batch 3: CLI core
- [ ] `cli-misc` (7 commits)
- [ ] `cli-runner-session-lifecycle` (4 commits)
- [ ] `resume-command-picker` (10 commits) — creates `cli/src/commands/resume.ts`; add kimi/pi/grok branches
- [ ] `runner-resilience` (2 commits)
- [ ] `stale-runner-pid-detection` (1 commit)
- [ ] `stop-hub-cleanly` (1 commit)
- [ ] `cli-mcp-transport` (3 commits)
- [ ] `integration-test-isolation` (1 commit)
- [ ] `title-update-prompts` (1 commit)

### Batch 4: Agent backends
- [ ] `claude-backend-fixes` (7 commits)
- [ ] `cursor-acp-stability` (11 commits)
- [ ] `cursor-acp-migration` (4 commits) — `apiTypes→schemas.ts` fold
- [ ] `cursor-new-capabilities` (3 commits) — `apiTypes→schemas.ts` fold
- [ ] `cursor-remote-resume-wiring` (1 commit)
- [ ] `opencode-acp-fixes` (7 commits) — `apiTypes→schemas.ts` fold
- [ ] `opencode-features` (3 commits)
- [ ] `pi-agent-integration` (5 commits)

### Batch 5: Codex
- [ ] `codex-subagent-goal` (8 commits)
- [ ] `codex-session-import-resume` (8 commits) — `apiTypes→schemas.ts` fold
- [ ] `codex-transcript-sync` (6 commits) — `apiTypes→schemas.ts` fold
- [ ] `codex-fast-tier-ui` (6 commits) — `apiTypes→schemas.ts` fold
- [ ] `codex-mcp-safety-approval` (6 commits)
- [ ] `codex-new-capabilities` (5 commits)
- [ ] `codex-reasoning-effort-modeswitch` (5 commits)
- [ ] `codex-review-messages-render` (1 commit)
- [ ] `codex-title-mcp-autoapprove` (1 commit)
- [ ] `multiagent-timeline-codex` (1 commit)

### Batch 6: Web features (large)
- [ ] `chat-history-scroll-stability` (16 commits) — `patches/` dir new
- [ ] `session-list-core-stability` (16 commits)
- [ ] `session-ui-polish-misc` (16 commits) — skip `.github/`
- [ ] `chat-composer-misc-polish` (13 commits)

### Batch 7: Web features (medium)
- [ ] `tool-card-grouping` (5 commits)
- [ ] `message-tool-metadata-timing` (6 commits) — creates `MessageMetadata.tsx`
- [ ] `chat-image-preview` (4 commits) — skip `.github/`
- [ ] `session-file-browser-preview` (9 commits) — `apiTypes→schemas.ts` fold
- [ ] `session-model-agent-prefs` (4 commits)
- [ ] `session-active-filter-pagination` (1 commit)
- [ ] `session-path-directory-actions` (2 commits)
- [ ] `outline-search` (3 commits)
- [ ] `cross-session-reference` (2 commits)
- [ ] `share-turn-images` (2 commits)
- [ ] `terminal-tool-card-display` (2 commits) — skip `.github/`
- [ ] `composer-customization` (3 commits)
- [ ] `theming-appearance` (4 commits)
- [ ] `pwa-mobile-share` (2 commits)

### Batch 8: Voice/rendering
- [ ] `voice-mode` (6 commits) — creates `qwenProxyHandler.ts`
- [ ] `markdown-mermaid-rendering` (6 commits)
- [ ] `generated-image-display-fix` (2 commits)

### Batch 9: Misc/docs
- [ ] `web-build-test-perf-tooling` (7 commits)
- [ ] `claude-effort-ui` (1 commit)
- [ ] `claude-permission-mode-auto` (1 commit) — skip `AGENTS.md`
- [ ] `claude-away-recap-localmode` (1 commit)
- [ ] `fable-model-presets` (1 commit)
- [ ] `legacy-model-merge-fix` (1 commit)
- [ ] `mobile-status-bar-fix` (1 commit)
- [ ] `multi-workspace-roots` (1 commit)
- [ ] `skill-lookup-mcp-support` (2 commits)
- [ ] `shared-heartbeat-filter` (1 commit)
- [ ] `tool-title-preservation` (1 commit)
- [ ] `runner-systemd-killmode-doc` (1 commit)
- [ ] `update-runner-start-sync-cmd` (1 commit)
- [ ] `queued-message-sse-fixes` (2 commits)
- [ ] `queued-messages-reconcile` (3 commits) — `apiTypes→schemas.ts` fold
- [ ] `cli-web-cross-cutting-fixes` (2 commits)
- [ ] `machine-naming-health` (7 commits) — `apiTypes→schemas.ts` fold

### Batch 10: Windows
- [ ] `cli-windows-compat` (4 commits)
- [ ] `windows-drive-roots` (1 commit)
- [ ] `windows-remote-terminal` (1 commit) — skip `.github/workflows/`
- [ ] `windows-remote-terminal-ci-tests` (1 commit)

### Batch 11: Sync last
- [ ] `sync-incremental-tail` (1 commit) — `apiTypes→schemas.ts` fold; after all hub carts

### Batch 12: Deferred deps (unlocked by earlier batches)
- [ ] `windows-schedule-picker` (1 commit) — after batch 2
- [ ] `filepath-autolink-ergonomics` (1 commit) — after batch 7
- [ ] `message-actions-metadata-refine` (1 commit) — after batch 7
- [ ] `codex-import-workdir-filter` (1 commit) — after batch 5
- [ ] `codex-misc` Qwen commit `a2465c78` — after batch 8 (`voice-mode`)

## Next session: what to do first

1. **Commit batch 1** — all changes are in working tree, typecheck clean:
   ```bash
   cd /data/Work/AI/hapi
   git add -A
   git commit -m "upstream-sync: batch 1 — foundation (shared-schema-refactors, cross-package-build-coupling, chore-cleanup)"
   ```
2. **Run full test suite** to confirm no regressions:
   ```bash
   cd shared && bun test
   cd ../hub && bun test
   cd ../cli && bunx vitest run
   cd ../web && bunx vitest run
   ```
3. **Start batch 2** (hub core) — 4 carts, 16 commits total

## Recurring gotchas (from this round)

- **`shared/src/apiTypes.ts` does not exist** — fold schemas into `shared/src/schemas.ts` (done in batch 1)
- **`cli/src/commands/resume.ts` does not exist** — created by `resume-command-picker` (batch 3)
- **Test runner differs by package**: cli/web → `bunx vitest run`; shared/hub → `bun test`
- **DB schema is now at V14** — any new migration must use V14→V15
- **`composer-attachment-drafts` is a stub** — returns null (re-upload always)
- **Mermaid-rendering test** occasionally flakes with 5s timeout
- **`.github/workflows/` deleted** — skip any CI workflow changes
- **`AGENTS.md` diverges** — skip upstream AGENTS.md changes
- **`qwenProxyHandler.ts` doesn't exist** — created by `voice-mode` (batch 8)
- **Web `api.ts` types diverge from shared** — AuthResponse, MachinesResponse, MessagesResponse, SessionResponse, SpawnResponse have web-specific shapes; keep local definitions, don't re-export from shared
- **Porter subagents need post-review** — always run `bun typecheck` after a porter finishes and fix syntax/import artifacts

## Test counts (baseline for regression detection)

| Package | Tests | Files |
|---------|-------|-------|
| shared | 89 | 9 |
| hub | 512 | 66 |
| cli | 882 | 106 |
| web | 1327 | 164 |
