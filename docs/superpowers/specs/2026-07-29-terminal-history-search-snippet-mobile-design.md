# Terminal History Search and Mobile Snippet Form

## Goal

Reduce unnecessary History filtering while typing and make the Snippet editor compact on mobile without changing terminal, snippet persistence, or desktop behavior.

## History Search

- Keep separate draft and applied search values.
- Typing only updates the draft value.
- Filter local History entries only after:
  - submitting the search form,
  - pressing the visible Search button, or
  - pressing Search/Enter on the software keyboard.
- Clearing the search input clears both values and restores the complete History list.
- Do not add debounce, timers, Hub requests, or CLI requests.
- Refreshing the History snapshot keeps the currently applied search.

## Mobile Snippet Editor

Applies to both create and edit modes below the `sm` breakpoint.

- Keep the existing editor header and back action.
- Place Name and optional Description on one row:
  - Name: approximately 40%.
  - Description: approximately 60%.
  - Both inputs remain one line and use `min-width: 0` to prevent overflow.
- Show Command below them at full width with three visible rows.
- Keep command input protections: no autocapitalization, autocorrection, or spellcheck.
- Render the secret warning as a compact row that may wrap naturally.
- Render Save as a full-width mobile button.
- Preserve the current spacious vertical layout, five-row Command editor, resizable fields, and right-aligned Save button on larger screens.
- Preserve existing limits, validation, pending protection, values after errors, and API behavior.

## Scope

### Changed

- `TerminalHistoryPanel`: explicit search submission and clear behavior.
- `TerminalSnippetEditor`: responsive mobile layout.
- Component tests for both behaviors.

### Not changed

- History retrieval, capability negotiation, Hub, or CLI.
- Snippet API, persistence, validation limits, list/search behavior, or delete flow.
- Terminal Search addon behavior.
- Desktop Snippet layout.

## Important Cases

1. Typing in History does not change the list until submit.
2. Search button and mobile keyboard Search/Enter apply the same query.
3. Clearing restores all History entries.
4. Empty or whitespace-only submission restores all entries.
5. Mobile create and edit forms stay within the panel width.
6. Save failure retains all editor values and allows retry.

## Verification

- Add failing component tests before production changes.
- Run focused History and Snippet tests.
- Run the full Web test suite and Web typecheck.
- Build Web production assets.
- Inspect the mobile form at narrow and standard mobile widths.
