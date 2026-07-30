# Pinned sessions memory/CPU plan

Status: active
Target: pinning up to 4 sessions in the web UI no longer drives a Chrome tab past ~1GB memory or pegs CPU during normal long-running use
Companion checklist: [`pinned-sessions-memory-checklist.md`](./pinned-sessions-memory-checklist.md)

**Strategy**: Phase 1 (virtualization only) as standalone, measurable unit. Workstreams 2–5 are post-Phase-1 conditional optimizations decided based on real measurements.

## Problem statement

Reported symptom: after extended use of the web UI with 4 sessions pinned, the Chrome tab accumulates 1GB+ of memory and shows sustained high CPU.

Diagnosis (see `web/src/components/Dashboard/index.tsx`, `web/src/components/AssistantChat/HappyThread.tsx`, `web/src/lib/message-window-store.ts`, `web/src/lib/shiki.ts`, `web/src/components/ToolCard/ToolCard.tsx`, `web/src/hooks/useSSE.ts`):

1. **Every pinned slot mounts the full `SessionChat` tree**, not a lightweight preview — the same component used for the full-page session view (`PinnedPanel` in `Dashboard/index.tsx:242-349`).
2. **All 4 pinned panels stay mounted simultaneously**, including ones not currently focused/visible. On mobile the 3 inactive panels are only CSS-hidden (`db__pinned-panel--mobile-hidden`), not unmounted (`Dashboard/index.tsx:1601-1656`).
3. **No message-list virtualization.** Each session's window is capped at 400 messages (`VISIBLE_WINDOW_SIZE`, `message-window-store.ts:21`), but `ThreadPrimitive.Messages` (`assistant-ui`) renders every one as real DOM (`HappyThread.tsx:459`). Worst case: 4 × 400 = 1600 fully mounted message subtrees (markdown, Shiki code blocks, Mermaid diagrams, tool cards) held alive concurrently.
4. **Tool-call output bodies are not truncated**, only titles/subtitles are (`ToolCard.tsx`, 160-char truncation). Large Bash stdout / file-read / diff outputs render in full, once per message, per pinned session.
5. **No memoization boundary.** `SessionChat` and `PinnedPanel` are plain function components (no `React.memo`). `Dashboard` is one large stateful component (hover state, context-menu position, active pin index, etc.), so any local UI state change — or any SSE-driven React Query cache update for *any* session (`useSSE.ts`) — re-renders all 4 mounted chat trees, not just the one that changed.

This is not a classic unbounded-array leak (the message window trims to 400, the tool-progress store TTL-prunes, React Query GCs unused queries after `gcTime`). It is a large, roughly-fixed working set (4 full chat UIs, unvirtualized, unmemoized) that fills toward its ceiling as each pinned conversation grows, while constant full-tree re-renders keep CPU elevated for the entire pinned session's lifetime.

## Scope

Included:

- Web UI (`web/src`) pinned-session rendering path: `Dashboard`, `PinnedPanel`, `SessionChat`, `HappyThread`, `ToolCard`.
- Message-list virtualization for both pinned/compact and full-page chat views.
- Re-render isolation between Dashboard-local UI state and mounted chat panels.
- Tool-output size bounding in the UI layer only (no backend/storage changes).
- Instrumentation/verification: reproducible before/after memory and CPU measurement with 4 pinned sessions.

Excluded:

- Backend/API changes to how messages or tool results are stored or paginated (`PAGE_SIZE`, `VISIBLE_WINDOW_SIZE` server-side behavior stays as-is unless a workstream below says otherwise).
- SSE/EventSource reconnect logic in `useSSE.ts` (already single global subscription, batched invalidation — not implicated in this leak).
- Non-web clients (CLI, hub) and non-pinned single-session view unless a fix naturally also improves it.

## Guiding invariants

1. A pinned panel that is not the focused/active one must not keep re-rendering its full message history on every unrelated Dashboard state change or every other session's SSE event.
2. Message DOM nodes for off-screen messages (outside the visible scroll viewport) must not stay mounted indefinitely inside a 400-message window.
3. No pinned/compact behavior change may alter message ordering, pending-message handling, or the existing 400-message trim semantics in `message-window-store.ts`.
4. Any change to `SessionChat`, `HappyThread`, `PinnedPanel`, or `ToolCard` is a central, high-fan-in surface — run GitNexus `impact({ target, direction: "upstream" })` before editing and report blast radius before proceeding, per project instructions.
5. Fixes must be verified with before/after measurements (Chrome DevTools heap snapshot + performance trace with 4 long-running pinned sessions), not just unit tests — this is a perf/memory bug, and unit tests alone won't catch a regression here.

## Workstream 1 — Virtualize the message thread

Goal: only messages actually in or near the visible viewport exist as mounted DOM/React fiber nodes, in both full-page and compact/pinned `SessionChat`.

1. Evaluate virtualization options compatible with `@assistant-ui/react`'s `ThreadPrimitive.Messages` (custom `components.Messages` renderer, or replace with a virtualized list — e.g. `react-virtuoso` — driven directly from `messages`/`useMessages`).
2. Preserve existing behavior: auto-scroll-to-bottom, "new messages" indicator, "scroll to bottom" button, `loadMore`/`hasMore` older-message pagination, and `onAtBottomChange`/`setAtBottom` semantics in `HappyThread.tsx`.
3. Confirm compact/pinned mode (`compactMode` prop passed into `SessionChat`) uses the same virtualized path — no separate unvirtualized code path for pinned panels.
4. Handle dynamic message height (tool cards, code blocks, Mermaid diagrams) correctly with the chosen virtualization approach (measured/variable-size rows, not fixed-height estimation that breaks layout).

Verification:

- Manual: open a session with 400 messages including large tool outputs and code blocks; confirm DOM node count for the message list stays roughly constant while scrolling (via DevTools Elements/Performance panel), instead of scaling with total message count.
- Regression tests for scroll-to-bottom, new-message indicator, and `loadMore` behavior (existing test files: check for `HappyThread`/`SessionChat` test coverage before and after).

## Workstream 2 — Stop fully rendering non-focused pinned panels

Goal: a pinned panel that is not the currently focused/active one does minimal work.

1. On mobile, where only one pinned panel is visible at a time (`activePinIndex`), unmount or suspend the other panels' `SessionChat` subtree instead of only CSS-hiding them (`db__pinned-panel--mobile-hidden`), or apply `content-visibility: auto` plus a mount gate so React skips reconciling hidden panels.
2. On desktop, where multiple pinned panels may be visible in a grid simultaneously, evaluate whether all visible panels genuinely need full live rendering, or whether a background/non-interacted panel can render a cheaper "status + last message" view until focused, hydrating to the full `SessionChat` on focus (`onFocusSession`/`isActive` already exist as signals in `PinnedPanel`).
3. Ensure unmounting/suspending a panel still correctly triggers `clearMessageWindow` cleanup (already present in `useMessages`'s effect) and does not lose in-flight compose drafts (`useComposerDraft`) or pending sent messages.

Verification:

- Confirm via React DevTools Profiler that a state change scoped to one pinned panel (e.g. typing in its composer) does not cause the other 3 panels to re-render.
- Confirm background/hidden panels stop consuming CPU (no ongoing Shiki highlight timers, no scroll/measurement effects) while inactive, and correctly resume when refocused.

## Workstream 3 — Add a memoization boundary and isolate Dashboard UI state

Goal: unrelated Dashboard interactions (context menu, hover, pin reordering) do not cascade re-renders into mounted chat panels.

1. Wrap `PinnedPanel` (and `SessionChat` if it is not already effectively pure per pinned session) in `React.memo` with a correct prop-equality check.
2. Audit `Dashboard`'s local state (e.g. `pinnedAction`, context-menu position/target, hover highlighting) and move state that is unrelated to a specific pinned panel's data into a scope that does not force `Dashboard`'s full render tree — e.g. a sibling component, a portal, or `useSyncExternalStore`/context scoped to just the menu.
3. Confirm `useSSE.ts`'s React Query cache patches for one session do not force re-renders of components subscribed to unrelated sessions (React Query's per-query subscription should already isolate this — verify with Profiler rather than assume).

Verification:

- React DevTools Profiler: open the session context menu, hover cards, and reorder pins with 4 sessions pinned; confirm only the intended component re-renders, not all 4 `PinnedPanel`/`SessionChat` trees.

## Workstream 4 — Bound tool-call output size in the UI

Goal: a single large tool result (big Bash stdout, full file read, large diff) does not blow up per-message DOM/memory cost.

1. Extend the existing truncation pattern in `ToolCard.tsx` (currently only titles/subtitles truncate at 160 chars) to the rendered result body: truncate by default with an explicit "show more" / "show full output" affordance.
2. Confirm this does not regress cases where users rely on seeing full output inline (e.g. add a persistent user preference or session-scoped "expanded" state, not a one-way lossy truncation).
3. Apply consistently whether the tool card is rendered in a pinned/compact panel or the full-page view.

Verification:

- Manual: a tool call with several hundred KB of output renders a bounded preview and expands on demand without a full re-render of the surrounding message list.

## Workstream 5 — Measurement and regression guard

Goal: prove the fix quantitatively, and prevent silent regression.

1. Build a repeatable manual test scenario: 4 pinned sessions, each with a long history (400 messages) including code blocks, Mermaid diagrams, and large tool outputs, left open and actively streaming for an extended period (e.g. 30+ minutes or simulated token bursts).
2. Capture Chrome DevTools heap snapshots (before pin, after pins settle, after extended use) and a Performance trace covering an active "thinking" burst across multiple pinned sessions simultaneously, both before and after the fix.
3. Record baseline vs. fixed numbers: JS heap size, DOM node count, and CPU time in the Performance trace's scripting/rendering breakdown.
4. Add or update component tests covering the new virtualization and memoization behavior so future changes to `SessionChat`/`HappyThread`/`PinnedPanel` don't silently reintroduce full unvirtualized rendering.

Verification:

- Documented before/after numbers (heap size, DOM node count) attached to the release evidence in the companion checklist.
- Component-level regression tests pass in CI.

## Execution: Phase 1 (Virtualization)

**Standalone, measurable unit**. Do not commit to Workstreams 2–5 upfront; decide them after Phase 1 measurement.

1. **Baseline reproduction and measurement** (1 day)
   - Pin 4 sessions with substantial history (~400 messages each, including code blocks, Mermaid diagrams, large tool outputs)
   - Capture Chrome DevTools heap snapshot at pin time, after pins settle, and after extended use (30+ min active streaming)
   - Record: JS heap size, DOM node count, CPU breakdown from Performance trace
   - Document commit hash and baseline numbers in the checklist

2. **Virtualization spike** (2–3 days)
   - Evaluate `react-virtuoso` compatibility with `@assistant-ui/react`'s `ThreadPrimitive.Messages`
   - Confirm the approach: replace/extend `ThreadPrimitive.Messages` with virtualized list, or custom `components.Messages` renderer
   - Document decision and any constraints

3. **Implement virtualization** (1 week)
   - Run `impact({ target: "HappyThread", direction: "upstream" })` before editing; confirm risk level
   - Virtualize message list in `HappyThread.tsx` for both full-page and pinned/compact views (same code path)
   - Preserve: auto-scroll-to-bottom, "new messages" indicator, `loadMore` pagination, variable-height messages (code blocks, tool cards)
   - Existing and new component tests pass

4. **Measure Phase 1 results** (1 day)
   - Run the same 4-pinned-session scenario
   - Capture heap snapshot and Performance trace using identical methodology as baseline
   - Record "after" numbers: JS heap size, DOM node count, CPU breakdown
   - Success criterion: DOM node count for message list stays roughly constant (≤50–100 nodes) while scrolling, instead of scaling with total message count; heap no longer accumulates unbounded
   - Document numbers and commit hash in checklist

5. **Decide Phase 2+** based on Phase 1 results
   - **If Phase 1 solves it** (memory/DOM bounded, no regression): ship Phase 1, close the issue
   - **If memory still elevated**: choose one post-Phase-1 workstream (see below)

---

## Post-Phase-1 Conditional Workstreams (2–5)

Only proceed with any of these if Phase 1 measurement shows memory/DOM still unbounded or CPU still elevated. Each is a lower-priority optimization that can be done independently or skipped entirely.

### Workstream 2 — Stop fully rendering non-focused pinned panels

On mobile, where only one pinned panel is visible at a time, unmount or suspend the other panels' `SessionChat` subtree instead of only CSS-hiding them. On desktop (full rendering), lower priority—only pursue if WS1+WS3 don't suffice.

- Run `impact({ target: "PinnedPanel", direction: "upstream" })` before editing
- Mobile: unmount/suspend inactive panels or apply `content-visibility: auto`
- Confirm `clearMessageWindow` cleanup and in-flight compose drafts survive suspend/resume

### Workstream 3 — Memoization boundary and Dashboard state isolation

Wrap `PinnedPanel` and `SessionChat` in `React.memo`; move Dashboard-local UI state (context menu, hover, pin reorder) out of the shared render path.

- Run `impact({ target: "SessionChat", direction: "upstream" })` before editing
- Confirm unrelated Dashboard interactions don't cascade re-renders to all 4 panels (React DevTools Profiler)

### Workstream 4 — Bound tool-call output size

Extend truncation pattern to tool result bodies: truncate by default with "show more" affordance. Low-risk, can be done anytime.

- Run `impact({ target: "ToolCard", direction: "upstream" })` before editing
- Manual: large tool output renders bounded preview and expands on demand

### Workstream 5 — Regression guard

Add component-level tests covering virtualization and memoization behavior so future changes don't silently reintroduce unvirtualized rendering.

---

## Go/no-go rule: Phase 1

Ship Phase 1 when:
- Baseline and Phase 1 measurement items in checklist are `completed` with documented numbers
- DOM node count for 4-pinned-session scenario stays bounded (≤100 nodes) regardless of scroll position
- JS heap no longer accumulates unbounded
- Existing chat behavior (scroll, pagination, drafts) has no regression
- `detect_changes()` confirms only message-list rendering touched, no unrelated symbols affected

**If Phase 1 solves the problem** (heap/DOM bounded, no regression): close the issue and declare complete. Do not proceed to Workstreams 2–5 unless future measurement shows regression or new concerns.

---

## Implementation Notes

`SessionChat`, `HappyThread`, and `PinnedPanel` are high-fan-in UI surfaces used by both pinned and full-page views. Before editing any of these:
- Run GitNexus `impact` analysis and report blast radius to the team
- Run `detect_changes()` before committing to verify scope
- Manual verification with 4 pinned sessions and extended streaming time
