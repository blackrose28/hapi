---
name: upstream-sync
description: "Use when the user wants to sync/merge new commits from the upstream tiann/hapi project (git remote 'github') into this branch, triage upstream commits into feature carts, or check what's changed upstream since the last sync round. Examples: 'sync upstream', 'check for new upstream commits', 'triage the latest github/main commits'"
---

# Upstream sync

Operationalizes `docs/upstream-sync/README.md`. Read that file first for the full rationale (why this exists, the divergence registry, ledger schema). This skill is the runnable version of the same process.

## 1. Find what's new since the last round

```bash
git fetch github
git tag -l 'sync/github-main/*' | sort | tail -1   # last checkpoint tag, if any
```

- If a tag exists (`sync/github-main/<date>`): the new range is `sync/github-main/<date>..github/main`.
- If no tag exists: this is round 1 — the range is `HEAD..github/main` (or the previous round's range if one is still open/in-progress — check for an existing `docs/upstream-sync/*-round.md` with `pending`/`in-progress` rows before starting a new one).

```bash
git log --reverse --name-only --pretty=format:'@@COMMIT|%H|%ad|%s' --date=short <range> > /tmp/upstream_commits_with_files.txt
git rev-list --count <range>   # sanity total, cross-check against carts later
```

Also re-run the conflict simulation so per-cart conflict counts stay accurate (does **not** touch the working tree or index):

```bash
git merge-tree --write-tree HEAD github/main > /tmp/mergetree_result.txt   # exit code 1 means conflicts exist, expected
grep -oP "(?<=Merge conflict in ).*|(?<=CONFLICT \(modify/delete\): ).*?(?= deleted)" /tmp/mergetree_result.txt | sort -u > /tmp/conflicted_files.txt
```

## 2. Cluster new commits into carts

Don't just bucket by conventional-commit `type(scope)` prefix — cluster thematically within each scope by reading subjects and overlapping changed files, so commits about the same underlying feature become one cart. Rules of thumb, established in the first round (`docs/upstream-sync/2026-07-30-round.md`):

- A cart is a cohesive feature or fix area, not a single scope bucket. `fix(web)` alone was 81 commits in round 1 and split into a dozen carts (scroll stability, session-list stability, file browser, theming, ...).
- Pure version-bump / lockfile-only commits (`Release version X.Y.Z`, lockfile fixes) go into one `skip` cart — we run independent versioning.
- Genuinely unrelated one-off commits get their own single-commit cart rather than being forced into a bucket that doesn't fit. Don't be afraid of ending up with 30+ small carts; that's normal for a 3-month window.
- **Every commit in the range must land in exactly one cart.** Verify this programmatically before writing the round file — sum of all cart commit counts must equal the range's total commit count, with no duplicate SHAs across carts.
- Cross-reference each cart's changed files against `/tmp/conflicted_files.txt` for its conflict count, and against the known-divergence registry in the README for its risk flag. If a cart touches a divergence-zone file, mark it `HIGH` risk and `skip`/`adapt` by default, not `adopt` — force a human decision.
- If a cart's files hint at a *new* architectural divergence not yet in the registry (our branch has deleted/replaced something upstream still maintains), add it to the registry in `docs/upstream-sync/README.md` before finishing the round, so future rounds inherit the flag automatically.

## 3. Write the round file

Create `docs/upstream-sync/<YYYY-MM-DD>-round.md` (today's date) following the schema and section layout in `docs/upstream-sync/2026-07-30-round.md` (the first round — use it as the template): intro with source range + total conflict count + cart count breakdown, then sections in this order: (1) known-divergence-zone carts, (2) other needs-review carts, (3) remaining feature carts largest-first, (4) skip carts, (5) an appendix listing every commit SHA + subject grouped by cart for traceability.

All rows start at `status: pending`. Do not merge, cherry-pick, tag, or create a worktree in this step — present the cart table for human review first.

## 4. Execute carts (after human sign-off on the cart list)

Follow "Per-cart execution loop" in `docs/upstream-sync/README.md`: isolated worktree on a new branch cut from the target branch, cherry-pick per cart, resolve conflicts against the divergence registry, test, fast-forward back into the target branch, update the ledger row, repeat.

## 5. Close the round

Once every cart in the round file has a terminal status (`merged` / `skipped` / `deferred`):

```bash
git tag sync/github-main/<round-date> github/main
```

Push the tag if checkpoint tags are meant to be shared across the team (`git push origin sync/github-main/<round-date>`) — confirm with the user before pushing tags, per this repo's general policy on remote-visible actions.
