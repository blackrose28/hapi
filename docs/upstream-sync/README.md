# Upstream sync process

`feat/shared-hub-shipping` (and its eventual home on `main`) is a heavy fork of the real upstream project, [`tiann/hapi`](https://github.com/tiann/hapi), added as git remote `github`. The two have diverged hard: as of 2026-07-30 our branch had 871 files changed since the shared ancestor, upstream had 1,044, and a naive `git merge` of `github/main` produced 174 conflicting files — some of them architectural, not textual (see **Known-divergence registry** below).

A single all-at-once merge is too risky to do safely or repeatably. Instead, upstream commits are triaged into **feature carts** — small, named, reviewable groups of commits — decided on individually, and merged one at a time. This directory is the durable record of that process so each ~3-month sync round doesn't require re-deriving the approach from scratch.

## Checkpoint tags

A git tag `sync/github-main/<YYYY-MM-DD>` is placed on the `github/main` tip once a round's commits have **all** been triaged into carts. The tag means "considered", not "merged" — carts can still be sitting at `status: pending` or `in-progress` when the tag goes on. It exists so the *next* round only has to look at commits added since the tag:

```bash
git fetch github
git log sync/github-main/<last-date>..github/main --oneline | wc -l   # new commits this round
```

If no tag exists yet (first-ever round), the range is `HEAD..github/main` against whatever local branch is being synced.

## Round ledger

One file per round: `docs/upstream-sync/<YYYY-MM-DD>-round.md`. Schema:

| Column | Meaning |
|---|---|
| Cart ID | Stable slug, referenced in commit messages and worktree branch names when executing the cart |
| Name | Human-readable feature name |
| # commits / Date range | Size and age of the cart |
| Dirs | Top-level directories touched (`web`, `cli`, `hub`, `shared`, ...) |
| Conflict files | How many of the cart's files also appear in that round's `git merge-tree` conflict list |
| Risk | `HIGH` if the cart touches a known-divergence zone, `MEDIUM (needs-review)` if flagged for another reason, else `low` |
| Suggested lean | `adopt` / `adapt` / `skip` / `needs-review` — a starting recommendation, not a final decision |
| Status | `pending` -> `in-progress` -> `merged` / `skipped` / `deferred` |

A round is closed (tag placed) once every cart's status is one of `merged`, `skipped`, or `deferred` — not necessarily all `merged`. `deferred` carts carry forward as open items to revisit; note them explicitly when writing the next round's intro so they aren't silently lost.

## Known-divergence registry

Append to this list whenever a deliberate architectural break from upstream is introduced — it's what lets triage flag "don't blindly merge this" automatically instead of rediscovering the conflict from scratch each round.

### 1. Hub legacy auth / protocol removal

Our branch permanently removed `hub/src/web/routes/auth.ts`, `hub/src/web/routes/bind.ts`, `hub/src/config/cliApiToken.ts`, and related `CLI_API_TOKEN` / namespace-JWT / `legacy-session` machinery in `a4a93b7a feat: complete Shared Hub shipping lifecycle`, replacing them with `hub/src/auth/*` (Runner-credential + organization authorization). This is Workstream 1 of `docs/shared-hub-shipping-plan.md`. Upstream still actively maintains the old files. **Any commit touching them is presumptively incompatible** — do not adopt as-is; re-derive the fix against `hub/src/auth/*` if it's independently valuable.

### 2. Web terminal modal-only refactor

Our branch removed the standalone `web/src/routes/sessions/terminal.tsx` route in `8a7a43e9 refactor(web): make session terminal modal-only` (design doc: `docs/superpowers/specs/2026-07-27-terminal-modal-only-design.md`). Upstream kept extending the standalone route. Commits touching it need their underlying UX idea reimplemented against the modal terminal component, not a restore of the old route.

### 3. Codex thread-crash recovery (hub-driven auto-resume, not in-process retry)

Our branch added its own Codex thread-crash recovery in `fc1b5b42 feat: emit thread-crashed event + stopKeepAlive on Codex thread crash` (plus `753e1dea`, `5abc2c14`, `75d12d4d`, `97eb3bba`): on `isThreadStatusFailure` in `codexRemoteLauncher.ts`, we null out `currentThreadId`, call `session.stopKeepAlive()`, and emit a `thread-crashed` session event so the **hub** detects the dead session and auto-resumes it as a fresh launcher/process. None of these commits exist upstream. Upstream instead handles the same `isThreadStatusFailure` trigger with an **in-process** same-thread retry + context-compact retry loop inside a single long-running `codexRemoteLauncher` invocation (introduced in `6df84df7 fix(hapi): consolidate approved web and Codex recovery fixes (#578)`, part of the `acp-shared-fixes` cart). The two mechanisms compete for control of the exact same failure branch — grafting upstream's retry loop on top of ours would either be dead code (our code already nulls the thread and returns before upstream's retry logic would run) or require ripping out the hub-driven crash-recovery feature entirely. **Do not adopt** Codex thread-failure retry/recovery commits as-is; if the underlying idea (e.g. compacting context before giving up) is worth having, redesign it against the `thread-crashed`/auto-resume flow, not as an in-process loop.

<!-- Append future divergence zones below, same two-line format: what we did + which commit, why upstream differs, what "adopt" actually requires. -->

## Per-cart execution loop

Once a round's cart table is reviewed and carts are ready to execute:

1. **Isolated worktree**, so the main working directory (often mid-task with uncommitted changes) stays untouched:
   ```bash
   git worktree add ../hapi-upstream-sync -b sync/upstream/<round-date> feat/shared-hub-shipping
   cd ../hapi-upstream-sync
   ```
2. **Per cart**, in the worktree:
   - Cherry-pick the cart's commits in chronological order (see the round file's SHA list): `git cherry-pick <sha1> <sha2> ...`
   - Resolve any conflicts. For carts flagged as touching a known-divergence zone, consult the registry entry and the linked design doc — reconcile semantically, don't blindly take "ours" or "theirs".
   - Run the test suite for the touched package(s).
   - For touched core symbols, follow this repo's `CLAUDE.md` rule: run `gitnexus_impact`/`gitnexus_detect_changes` before finalizing, and re-run `npx gitnexus analyze` after landing (a PostToolUse hook does this automatically after commit/merge).
3. **Land the cart**: back in the main worktree (`feat/shared-hub-shipping` checked out), fast-forward the result in:
   ```bash
   git merge --ff-only sync/upstream/<round-date>
   ```
   This is safe as long as the main worktree's branch tip hasn't moved since the worktree was created — it won't have, since all commits happened in the worktree.
4. **Update the ledger**: set that cart's row in the round file to `status: merged` (or `skipped` / `deferred` with a one-line reason).
5. **Close the round**: once every cart's status is resolved, tag `sync/github-main/<date>` on the `github/main` tip that was fetched at the start of the round.

See `.claude/skills/upstream-sync/SKILL.md` for the operational version of this process a future session can run standalone.
