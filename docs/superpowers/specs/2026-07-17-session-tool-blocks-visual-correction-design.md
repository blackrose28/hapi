# Session Tool Blocks Visual Correction Design

**Status:** Approved corrective design based on the previously approved Agent Mode prototype version 4 and the production screenshots reviewed on 2026-07-17
**Risk level:** Medium — presentation-only grouping in the shared assistant message renderer

## 1. Problem

The first implementation matched the implementation plan but not the approved prototype:

- neutral `ToolCard` instances were changed to `border-transparent bg-transparent`;
- the prototype's `Activity Group` wrapper, disclosure, vertical rail, and compact rows were not implemented;
- `CodexPatch` (`Apply changes`) was classified as a reviewable diff artifact even though it represents a mutation event;
- the existing `CodexPatchView` expects `changes` to be a record, while current and historical messages can carry an array of `{ path, kind, diff }` entries;
- this mismatch produces the visible subtitle `0`, an empty detail dialog, and a misleading `Review diff` action.

The correction must restore the approved visual hierarchy without changing normalized chat blocks, stored messages, agent events, permission mutations, REST, SSE, RPC, or database behavior.

## 2. Correct visual hierarchy

### Routine activity

- Consecutive eligible neutral top-level tool blocks render as one `Activity Group` display unit.
- The group is open by default, matching prototype version 4.
- Its header shows a localized action count plus a bounded summary of up to three tool titles.
- Its expanded body uses the prototype's vertical rail and compact interactive rows.
- Each row preserves its tool title, subtitle, creation time, running/error/completed state, keyboard operation, and existing detail dialog.
- The group only changes presentation. Source `ChatBlock` objects remain intact, ordered, and independently addressable.
- A single eligible neutral tool remains an individual compact neutral surface with a subtle border/background; it must never become a borderless floating line.

### Group boundaries

An eligible routine tool is a neutral tool block that:

- is not `CodexPermission` and carries no permission metadata in any status;
- is not `AskUserQuestion`, `ask_user_question`, or `request_user_input`;
- is not `Task` and has no nested children;
- is not a plan or diff artifact.

Text, `agent-reasoning` messages, CLI output, user messages, system events, team mentions, permissions, questions, plans, diffs, and tasks break a routine run. `CodexReasoning` remains a neutral tool and may appear as an Activity Group row. Two or more adjacent eligible tools form a group. Running and error tools remain eligible so the group can communicate live and failed activity.

### `Apply changes` versus `Diff`

- `CodexPatch` / `Apply changes` is a neutral routine mutation event.
- `CodexDiff` remains the green review artifact and the only one of these two that shows `Review diff`.
- `Apply changes` shows a useful filename/count summary and its success/error state.
- Its detail dialog lists affected files and the existing result; it does not duplicate the consolidated full diff.
- Both current array payloads and record payloads are accepted in the presentation parser.
- Empty or malformed patch input must not show `0`, a fake review action, or an empty clickable dialog.

## 3. Architecture

```text
Existing ChatBlock[]
→ pure display-only groupRoutineActivities()
→ ChatBlock | RoutineActivityGroup display items
→ existing assistant runtime
→ RoutineActivityGroup for grouped neutral tools
→ ToolCard(activity-row) for each row
→ existing ToolCard dialog/view/result/trace behavior
```

The pure grouping pass belongs at the web runtime adapter boundary because the current runtime converts each top-level `ChatBlock` into a separate assistant message. It must not be added to reducers or normalization, where it would alter application data.

`ToolCard` gains a presentation mode for activity rows. The existing card mode remains responsible for singleton neutral tools, permissions, plans, diffs, tasks, and questions. Dialog content is shared rather than reimplemented.

## 4. Scope

### In scope

- display-only grouping helper and tests;
- assistant runtime mapping for a routine activity display item;
- assistant message branch for rendering the group;
- focused `RoutineActivityGroup` component;
- `ToolCard` row presentation mode while reusing its dialog;
- `CodexPatch` tone correction and payload presentation parser;
- English, Vietnamese, and Chinese activity labels;
- focused unit/component/integration tests and real-session visual verification.

### Out of scope

- changing reducers, normalized `ChatBlock`, shared schemas, stored messages, API payloads, CLI events, or hub behavior;
- merging or deleting source tool calls;
- regrouping nested Task children;
- changing plan, permission, `agent-reasoning`, Mermaid, or full `DiffView` behavior beyond regression fixes required by this correction;
- adding a generic artifact system, new route, Storybook, or dependency.

## 5. Accessibility and responsive behavior

- Group header is a semantic button with `aria-expanded` and `aria-controls`.
- Tool rows remain semantic buttons with the existing dialog semantics and focus ring.
- Status is communicated by icon/text semantics, not color alone.
- Desktop rows show time, tool title, bounded subtitle, status, and chevron.
- Narrow mobile rows may hide time and truncate subtitle, but must not overflow horizontally.
- Light and dark themes use existing `--app-*` tokens.
- Group disclosure motion honors `prefers-reduced-motion`.

## 6. Verification contract

Automated:

- grouping preserves order and source block identity;
- boundaries prevent permissions/artifacts/tasks/questions from entering a routine group;
- singleton neutral tools retain a subtle visible surface;
- group starts open, toggles accessibly, and each row opens the existing tool dialog;
- running, completed, and error rows remain visible;
- `CodexPatch` array/record/malformed payloads produce safe summaries;
- `CodexPatch` is neutral and never shows `Review diff`;
- `CodexDiff` remains a green artifact with bounded preview;
- web tests, typecheck, production build, and root regression suite pass.

Manual browser matrix on real session data:

- dark and light desktop;
- 390px mobile without horizontal overflow;
- at least one routine group with Terminal and Reasoning-like activity;
- collapsed and expanded group;
- a working row dialog;
- `Apply changes` with a real array payload and no `0`;
- `Diff`, Plan, Reasoning, and pending Permission remain visually distinct.

The visual gate is the approved prototype version 4, not merely class-name assertions. Completion evidence must include screenshots or inspected browser captures of the real session states above.

## 7. Rollback

The correction is web-only and data-neutral. Reverting its focused commits restores the current renderer. No database, cache, API, or message repair is required.
