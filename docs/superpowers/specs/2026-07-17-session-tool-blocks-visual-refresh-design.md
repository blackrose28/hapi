# Session Tool Blocks Visual Refresh Design

**Date:** 2026-07-17  
**Status:** Approved from the interactive Agent Mode prototype (version 4)  
**Risk level:** Medium — presentation-only change over a shared renderer used by every agent provider

## 1. Goal

Refresh the special blocks inside a session conversation so routine activity stays quiet while reasoning, permissions, plans, and diffs are easy to scan and reopen. Match the approved Agent Mode prototype in both light and dark themes without changing application behavior.

## 2. Chosen approach

Keep the existing message normalization, tool registry, permission mutations, dialog behavior, and nested task flow. Add a thin presentation layer inside the existing session-message components:

- generic tools use a compact neutral surface;
- reasoning uses a compact bordered disclosure;
- pending permissions use an amber attention surface with a neutral-blue primary approval action;
- planning tools use a violet artifact surface with progress summary;
- diff/edit tools use a green artifact surface with change summary;
- the existing detail dialog remains the full-content destination.

Visual tones stay in the existing tool presentation registry. Pending permission overrides the registry tone directly in `ToolCard`; no parallel surface-policy module or generic artifact design system is introduced.

This is preferred over:

1. **A new parallel renderer:** closer isolation, but duplicates tool routing and risks behavior drift.
2. **A whole-session redesign:** visually broad, but violates the approved constraint to change only related components.

## 3. Scope

### In scope

- `web/src/components/assistant-ui/reasoning.tsx`
- `web/src/components/ToolCard/ToolCard.tsx`
- `web/src/components/ToolCard/knownTools.tsx`
- `web/src/components/ToolCard/PermissionFooter.tsx`
- planning checklist/view files under `web/src/components/ToolCard/`
- Codex diff compact/full views under `web/src/components/ToolCard/views/`
- narrowly-scoped theme tokens in `web/src/index.css`
- only the new user-facing strings in the existing English, Vietnamese, and Chinese locale files
- focused component and pure presentation tests

### Out of scope

- session list, dashboard pins, header, composer, context panel, and routing;
- message schemas, normalization, storage, SSE, API, RPC, and permission contracts;
- approval/deny semantics, available permission options, haptics, loading guards, and error handling;
- Mermaid parsing, rendering, pan/zoom/fullscreen, and markdown behavior;
- generic `Card`, `Button`, or `Dialog` primitives used outside tool messages;
- Storybook, a new demo route, or a new visual-regression framework;
- backend, CLI, hub, shared types, and database code.

## 4. Component behavior

### Reasoning

- Preserve collapsed-by-default and auto-open-while-streaming behavior.
- Replace the bare text toggle with the prototype's compact bordered surface.
- Preserve markdown rendering, reduced-motion behavior, keyboard activation, and current streaming indicator.

### Routine tool activity

- Keep one `ToolCard` per existing tool block; do not regroup or reorder timeline data.
- Render neutral tools with lower visual weight than review artifacts.
- Preserve title, subtitle, state, elapsed time, dialog trigger, child-task summary, and trace access.
- Keep a clear hover/focus surface so the compact row still reads as interactive.

### Permission attention state

- A pending approval permission overrides the tool's normal visual tone. `AskUserQuestion` and `request_user_input` answer forms keep their existing question treatment; their shared permission-shaped transport is not presented as a security approval.
- Use amber border/background/icon treatment to signal attention, not success.
- Show the approved permission-required heading and lock icon without changing the underlying tool identity or permission payload.
- The immediate approve action uses a dedicated blue background and explicit white foreground in both themes.
- Deny remains a neutral outlined action with destructive text treatment; additional session/edit approval options remain present.
- On narrow screens, actions wrap/stack without horizontal overflow and keep at least 36px control height.

### Plan artifact

- `update_plan`, `TodoWrite`, `ExitPlanMode`, and `exit_plan_mode` use the planning tone.
- Inline `update_plan` shows completed/total count, percentage, progress bar, and a short step preview.
- Artifact headers expose a localized, explicit open/review action rather than a chevron alone.
- Dialog view shows the complete checklist.
- Existing parsing and status normalization remain unchanged.

### Diff artifact

- `CodexDiff`, `CodexPatch`, `Edit`, `MultiEdit`, `Write`, and `NotebookEdit` use the diff tone.
- Inline `CodexDiff` shows additions, removals, and a bounded file summary rather than a large code body.
- Dialog view retains the full existing diff rendering.
- Empty or malformed diff input falls back safely to the existing generic display path.
- Reuse `parsePatch()` from the already-installed `diff` package for the new summary; do not add another hand-written summary parser. Keep the existing full-view conversion path unchanged so this visual task does not alter dialog behavior.

## 5. Data flow

```text
Existing normalized ToolCallBlock
→ existing getToolPresentation registry
→ visual tone metadata
→ ToolCard directly lets pending permission override neutral / plan / diff appearance
→ existing view registry renders compact or dialog content
→ existing PermissionFooter invokes the same API callbacks
```

No data is added to or removed from messages, tool calls, permissions, or API requests.

## 6. Theme and accessibility rules

- Use existing `--app-*` tokens for surfaces, foregrounds, hints, and borders.
- Add only narrowly-scoped tool-tone and permission-primary tokens; do not introduce a general color system.
- Explicit approval foreground must meet WCAG AA contrast (at least 4.5:1) against its background in light and dark themes.
- Preserve visible focus rings, semantic buttons, dialog semantics, `aria-busy`, disabled states, and keyboard operation.
- Do not encode state by color alone: retain icons, labels, counts, and status text.
- Disable the Reasoning disclosure transition under `prefers-reduced-motion: reduce`.
- Route only newly introduced labels/count copy through the existing locale dictionaries; localizing unrelated legacy strings is out of scope.

## 7. Verification

Automated checks:

- visual-tone mapping for neutral, planning, diff, and permission states;
- ToolCard shell rendering and dialog trigger preservation;
- permission action visibility, loading/disabled states, and unchanged API payloads;
- approve, deny, allow-all-edits, allow-for-session, Codex approve-for-session, and Codex abort payloads;
- explicit primary-action theme tokens and contrast;
- plan progress math and inline/full checklist behavior;
- `parsePatch()`-based diff summary for one file, multiple files, empty/malformed input, quoted paths, and content beginning with `+++`/`---`;
- reasoning collapse, streaming auto-open, and keyboard-accessible toggle;
- web typecheck and production build.

Manual browser checks:

- light/dark themes;
- desktop and narrow mobile widths;
- generic tool, reasoning, permission, plan, diff, nested Task, error, and running states;
- long paths, long subtitles, large diffs, and extra permission options.

## 8. Main risks and controls

1. **Shared ToolCard blast radius:** every provider uses it. Control with tone defaults, focused fixtures across Claude/Codex-style tools, and no registry contract removal.
2. **Permission regression:** visually changing a security-sensitive control can hide or miswire choices. Control with callback/payload tests and unchanged mutation functions.
3. **Diff performance/accuracy:** large or multi-file diffs can be expensive or miscount headers. Control by reusing the installed `diff.parsePatch()` parser, memoizing the derived summary, and bounding inline rows.
4. **Theme contrast:** Telegram/browser theme inheritance can produce unreadable text. Control with explicit foreground tokens and contrast tests.

## 9. Rollback

The change is frontend-only and data-neutral. Reverting the focused visual commits restores the current renderer; no migration, cache invalidation, or data repair is required.
