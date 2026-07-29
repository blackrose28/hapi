# Pinned sessions memory/CPU checklist

Companion plan: [`pinned-sessions-memory-plan.md`](./pinned-sessions-memory-plan.md)
Valid states: `pending`, `in-progress`, `completed`, `blocked`
Current verdict: `not-ready`

**Strategy**: Phase 1 (virtualization) as standalone measurable unit. Workstreams 2–5 are post-Phase-1 conditional optimizations, decided after Phase 1 measurement results.

Evidence must identify the commit and the exact measurement, test, or manual observation. Marking implementation complete without measurement evidence does not complete an item.

## PHASE 1 — Message Thread Virtualization (Standalone Unit)

### Step 1: Baseline Reproduction & Measurement

- [ ] `pending` Reproduce the reported symptom: pin 4 sessions with substantial history (~400 messages each, including code blocks, Mermaid diagrams, and at least one large tool output); leave open for extended period (30+ min active streaming); confirm Chrome task manager / DevTools shows elevated memory (target: ~1GB) and sustained CPU
- [ ] `pending` Capture "before" Chrome DevTools heap snapshot: at pin time, after pins settle, after extended use
- [ ] `pending` Capture "before" Performance trace: covering a burst where multiple pinned sessions are actively streaming simultaneously
- [ ] `pending` Record baseline: JS heap size (MB), DOM node count (total), scripting/rendering CPU breakdown from Performance trace
- [ ] `pending` Document: baseline commit hash, timestamp, methodology notes for reproducibility

**Baseline commit**: unset  
**Baseline JS heap size (MB)**: unset  
**Baseline DOM node count**: unset  
**Baseline CPU breakdown**: unset

### Step 2: Virtualization Spike & Decision

- [ ] `pending` Run GitNexus `impact({ target: "HappyThread", direction: "upstream" })` before any code changes; record risk level and affected callers/flows
- [ ] `pending` Spike: evaluate `react-virtuoso` (or alternative) compatibility with `@assistant-ui/react`'s `ThreadPrimitive.Messages`; confirm approach (replace vs. extend)
- [ ] `pending` Document decision: which library, which integration pattern, any constraints or workarounds needed

**Virtualization library chosen**: unset  
**Integration approach**: unset

### Step 3: Implementation

- [ ] `pending` Implement virtualization in `HappyThread.tsx` for both full-page and pinned/compact views (same code path, `compactMode` uses same virtualized path)
- [ ] `pending` Confirm variable/dynamic message height (tool cards, code blocks, Mermaid diagrams) renders correctly — no clipped/overlapping content
- [ ] `pending` Confirm auto-scroll-to-bottom still works
- [ ] `pending` Confirm "new messages" indicator still works
- [ ] `pending` Confirm manual "scroll to bottom" button still works
- [ ] `pending` Confirm `loadMore`/`hasMore` older-message pagination still works (no double-fetch, scroll position preserved)
- [ ] `pending` Manual: DOM node count for message list stays roughly constant (≤50–100 nodes) while scrolling a 400-message session, instead of scaling with total
- [ ] `pending` Existing and new component tests for `HappyThread`/`SessionChat` pass

**Implementation commit**: unset

### Step 4: Phase 1 Measurement & Decision Gate

- [ ] `pending` Re-run the 4-pinned-session scenario (same as baseline)
- [ ] `pending` Capture "after" heap snapshots and Performance trace using identical methodology
- [ ] `pending` Record "after": JS heap size (MB), DOM node count, CPU breakdown
- [ ] `pending` Verify success criterion: DOM node count stays bounded (≤100 nodes) regardless of scroll position; JS heap no longer accumulates unbounded; no regression in scroll/pagination/drafts
- [ ] `pending` GitNexus `detect_changes()` confirms only message-list rendering touched

**Phase 1 commit**: unset  
**Phase 1 JS heap size (MB)**: unset  
**Phase 1 DOM node count**: unset  
**Phase 1 CPU breakdown**: unset  
**Success criterion met?**: unset

### Step 5: Decision

- [ ] `pending` **If Phase 1 solves it** (heap/DOM bounded, no regression): ✅ Close issue, skip Workstreams 2–5, mark verdict `completed`
- [ ] `pending` **If Phase 1 doesn't solve it** (memory still elevated): 📋 Choose ONE of the post-Phase-1 workstreams below; document which and why

---

## POST-PHASE-1 CONDITIONAL WORKSTREAMS (Only if Phase 1 measurement shows continued issues)

### Workstream 2 — Non-focused pinned panels (Mobile only; Desktop optional)

**Trigger**: Phase 1 DOM/memory still unbounded, AND mobile panels are identified as significant culprit.  
**Scope**: Unmount/suspend inactive mobile panels; desktop full rendering unchanged.

- [ ] `pending` Run GitNexus `impact` on `PinnedPanel` before editing
- [ ] `pending` Mobile: inactive pinned panels unmounted/suspended (not CSS-hidden) or `content-visibility: auto`
- [ ] `pending` Confirm `clearMessageWindow` cleanup fires correctly
- [ ] `pending` Confirm in-flight compose drafts and pending messages survive suspend/resume
- [ ] `pending` React DevTools Profiler: interacting with one panel doesn't re-render the others

### Workstream 3 — Memoization & Dashboard state isolation

**Trigger**: Phase 1 complete, heap bounded, but CPU still high OR desktop panels still re-render too often.

- [ ] `pending` Run GitNexus `impact` on `SessionChat` and `PinnedPanel` before adding `React.memo`
- [ ] `pending` `PinnedPanel` wrapped in `React.memo` with correct prop-equality
- [ ] `pending` `SessionChat` memoized or confirmed effectively pure
- [ ] `pending` Dashboard-local state (context menu, hover, pin reorder) moved out of shared render path
- [ ] `pending` React DevTools Profiler: unrelated interactions re-render only target component, not all 4 panels

### Workstream 4 — Tool-call output bounding

**Trigger**: Phase 1 complete, but large tool outputs identified as remaining memory contributor.

- [ ] `pending` Run GitNexus `impact` on `ToolCard` before editing
- [ ] `pending` Tool result body truncates by default with "show more" control (160-char pattern)
- [ ] `pending` Expand/collapse state doesn't trigger full message-list re-render
- [ ] `pending` Consistent in pinned and full-page views
- [ ] `pending` Manual: large tool output renders bounded preview

### Workstream 5 — Regression guard

**Trigger**: Phase 1 + any post-Phase-1 workstreams complete.

- [ ] `pending` Add/update component tests covering virtualization (and memoization if done) so future changes can't silently reintroduce unvirtualized rendering
- [ ] `pending` GitNexus `detect_changes()` after each workstream; scope matches expectations

## Final Verdict Record

**Phase 1 verdict**: `not-ready` (baseline reproduction not yet run)

- Baseline reproducible? unset
- Phase 1 solves the problem? unset (decide after Phase 1 measurement)
- Post-Phase-1 workstream chosen (if needed): unset
- Final verdict: unset (`completed` if Phase 1 solves it; `in-progress` if proceeding to Phase 2+)
- Reviewer: unset
- Remaining risks: baseline reproduction is the gate; cannot proceed until symptom is confirmed reproducible
