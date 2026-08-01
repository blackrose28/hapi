# Upstream sync round 2026-07-30 — resume checklist

Paused here because the org hit its weekly API spend limit. Nothing has been committed — every change described below is still sitting uncommitted in the working tree of `feat/shared-hub-shipping` (the original pre-session dirty files and the `wip before merging upstream/main` stash are both still untouched, verified). Read `docs/upstream-sync/2026-07-30-round.md` for full per-cart detail; this file is just the "what to do next" index.

## Status at a glance

| # | Cart | State |
|---|---|---|
| 1 | `docs-gemini-cleanup` | ✅ done, verified |
| 2 | `peer-messaging-self-targeting-env` (split from `agent-peer-messaging-self-targeting`) | ✅ done, verified |
| 2b | `peer-messaging-ping-peer` | ✅ decided skip (legacy auth wall) |
| 3 | `acp-shared-fixes` | ✅ done, verified |
| 4 | `kimi-support` | ✅ done, verified |
| 5 | `pi-coding-agent-support` | ✅ done, verified |
| 6 | `grok-support` | 🟡 **code appears complete, NOT yet verified** — see below |
| 7 | `scratchlist-feature` | ⬜ not started |

Also still open from the divergence-zone triage: `R2b-terminal-exit-auto-navigation` is deliberately deferred (design doc at `docs/superpowers/specs/2026-07-30-terminal-exit-auto-navigation-design.md`, not scheduled).

## Step 1 — verify `grok-support` before touching anything else

Three parallel sub-agents (CLI backend, web UI + rename, web UI) were spawned for this cart and all three died mid-flight to the same spend-limit error, but only *after* writing their files — `git status` shows the full expected file set present:
- New `cli/src/grok/` (15 files: launchers, session, loop, runGrok, types, utils/{grokBackend,permissionHandler,systemPrompt,windowsShellArgs} + tests) — looks complete by file count (1579 lines total).
- New `cli/src/commands/grok.ts`, `cli/src/ui/ink/GrokDisplay.tsx`, `cli/src/modules/common/grokModels.ts`+handler.
- Web: new `GrokPermissionModeSelector.tsx`(+test), `grokModels.ts`(+test), `useGrokModels.ts`/`useGrokModelsForCwd.ts`/`useGrokReasoningEffortOptions.ts`.
- **The `ClaudeEffortSelector.tsx` → `LaunchEffortSelector.tsx` rename was carried out** — `ClaudeEffortSelector.tsx` is deleted, `LaunchEffortSelector.tsx`(+test) exists. This needs the most scrutiny below.
- Hub: `hub/src/sync/{rpcGateway,sessionCache,syncEngine}.ts`, `hub/src/web/routes/{machines,sessions}.ts` all touched.
- Shared: `flavors.ts`/`modes.ts`/`schemas.ts`/`sessionSummary.ts`/`types.ts`/`index.ts` touched (schema additions folded into `schemas.ts`, NOT a new `apiTypes.ts` — correct per the recurring gap below).
- Docs: `docs/guide/grok.md` (new), `docs/.vitepress/config.ts` nav entry, `cli/README.md`/`README.md`/`cli/src/runner/README.md` mentions.

**None of this has been independently verified yet** (unlike carts 1–5, where I ran typecheck + full test suites + `gitnexus_detect_changes` myself after each subagent, and caught/fixed real issues each time — e.g. two broken terminal-focus test mocks after cart 2/3, a stale `kimiSessionId` schema gap caught during cart 5). Do the same here before trusting cart 6:

1. **Typecheck all 4 packages** (each has its own `bun run typecheck` — `tsc --noEmit`, should be clean or fixable):
   ```
   cd cli && bun run typecheck
   cd ../hub && bun run typecheck
   cd ../shared && bun run typecheck
   cd ../web && bun run typecheck
   ```
2. **Run full test suites — use the RIGHT runner per package** (this tripped me up twice this session):
   - `cli/` and `web/`: `bunx vitest run` (NOT `bun test` — bun's runner lacks `vi.hoisted` etc.)
   - `shared/` and `hub/`: `bun test` (NOT vitest — their tests import from `bun:test`, vitest can't resolve it)
   - If exactly one Mermaid-rendering test fails in the web suite, that's a known flake under parallel load — rerun once before treating it as real.
3. **Check the `LaunchEffortSelector` rename specifically**: grep for any remaining references to `ClaudeEffortSelector` (import paths, snapshot names, etc.) that the rename might have missed:
   ```
   grep -rn "ClaudeEffortSelector" web/src
   ```
   If anything still references the old name, fix it. Also sanity-check that `LaunchEffortSelector.tsx` actually generalizes correctly for both Claude and Grok (not just Grok with a renamed label) — read the component.
4. **Run `mcp__gitnexus__detect_changes`** (scope `unstaged`, repo `hapi`) and confirm the changed-symbol list is exactly: this cart's new/touched files plus the already-known carryover from carts 1–5 (kimi/pi files, acp-shared-fixes, terminal auto-focus, HAPI_SESSION_ID export, Gemini deletions). Nothing else should show up. Expect CRITICAL/HIGH risk on shared plumbing (`bootstrapSession`, `AcpSdkBackend`, `SyncEngine`, `hub/src/web/routes/machines.ts`) — that's expected fan-out from adding one more agent flavor, not a red flag by itself; only escalate if an *existing* flavor's behavior looks modified rather than a new branch/case being added.
5. **Update `docs/upstream-sync/2026-07-30-round.md`**: find the `grok-support` row (currently still `needs-review`/`pending`, was never updated because the sub-agents died before that step) — set decision to **adopt**, status to `merged`, and write the prose paragraph (files ported, how the `apiTypes.ts`/`resume.ts` gaps were routed around — see below, how the `LaunchEffortSelector` rename was verified, test/typecheck results).

If step 1–4 turn up real bugs (not just missing verification), fix them the same way earlier carts were fixed: read the actual code, understand the intent, patch directly — don't just re-run a subagent on the same prompt.

## Step 2 — once grok-support is verified, do `scratchlist-feature`

Last cart in this round. 6 commits (`18bcb522`, `393cd7bf`, `311e0cef`, `24a2656a`, `2235b924`, `4c203f17`), decision already made: **adopt, with an authorization retrofit**. Per the earlier triage in `docs/upstream-sync/2026-07-30-round.md` and `docs/shared-hub-shipping-plan.md`:
- This is a per-session scratchlist (workbench) panel, v1 → v2.2, ending in hub-synced storage via a typed table (`hub/src/store/scratchlist.ts`) piggybacked onto the existing `hub/src/web/routes/sessions.ts` route (not a new auth surface, unlike the divergence-zone carts) — but it predates our Shared Hub authorization rewrite, so it needs `authorize → mutate → audit` checks retrofitted onto its hub-side mutations before landing, per `docs/shared-hub-shipping-plan.md`'s shipping invariants. Don't adopt it as a plain merge.
- It's the last cart to touch the same shared hub-sync files (`sessionCache.ts`, `syncEngine.ts`, `hub/src/web/routes/sessions.ts`) that kimi/pi/grok have all been additively layering onto — read their current state first so this doesn't regress any of them.
- Follow the same execution pattern used for carts 3–6 in this session: spawn one subagent with a comprehensive, self-contained brief (full commit list + file list + the specific authorization-retrofit requirement + the recurring `apiTypes.ts`/`resume.ts` gaps + correct-test-runner reminder + "leave all prior carts' changes alone" instruction), then independently verify (typecheck × 4, tests × 4 with correct runners, `gitnexus_detect_changes`, update the round file) rather than trusting the subagent's self-report at face value.

## Recurring gotchas worth remembering (came up 3+ times this session)

- **`shared/src/apiTypes.ts` does not exist in our tree.** We deliberately skipped `R1-hub-legacy-auth` (the cart that would have created it, entangled with deleted legacy auth files). Every subsequent upstream commit that "modifies" `apiTypes.ts` needs its schema additions folded into `shared/src/schemas.ts` instead.
- **`cli/src/commands/resume.ts` does not exist anywhere in our tree**, nor does any `dispatchLocalResume`/`handoffSessionToLocal`-style resume-dispatch mechanism. Every new-agent-backend cart (kimi, pi, grok) has had to skip its upstream commit's resume-command wiring. This all piles up as prerequisite work for the still-untouched `resume-command-picker` cart (10 commits) — worth tackling that one soon since three backends are now silently missing resume support because of it.
- **Test runner differs by package**: `cli`/`web` → `bunx vitest run`; `shared`/`hub` → `bun test`. Using the wrong one gives false failures (either "no tests" collection errors or `vi.hoisted is not a function`).
- **GitNexus impact CRITICAL/HIGH on shared plumbing is usually expected, not disqualifying**, for this kind of work — `bootstrapSession`, `AcpMessageHandler`, `AcpSdkBackend`, `SyncEngine` fan out to every agent flavor by design. The bar is: does the change modify an *existing* branch/behavior (real risk) or only add a new branch/case (expected, safe)? State the reasoning either way rather than treating the risk label as a stop sign or ignoring it.
- **Subagents finish their file edits before dying on the spend-limit error, but skip the final verification+documentation steps.** Every cart in this session needed independent typecheck/test/gitnexus verification and a manual round-file update after the fact — don't trust a subagent's self-reported "done" without checking.
