# Terminal Search and Snippets — Design

**Date:** 2026-07-28  
**Status:** Implemented; automated verification complete; mobile browser and runtime performance acceptance pending

## 1. Goal

Complete the `Search` and `Snippets` tools in HAPI's mobile terminal control dock.

- `Search` finds text in the active xterm buffer without sending anything to the shell.
- `Snippets` inserts reusable commands into the active terminal without executing them.
- The same components and behavior apply to the session terminal modal and mobile Editor terminal.

## 2. Scope

This delivery applies below the existing `lg` breakpoint where `TerminalControlDock` is visible.

Included:

- Built-in, read-only snippets.
- Namespace-scoped custom snippets synchronized through Hub.
- Search powered by the official `@xterm/addon-search`.
- Shared behavior for session terminals and Editor terminals.

Not included:

- `History`.
- Desktop terminal controls.
- Increasing xterm scrollback.
- Server-side or archived-output search.

## 3. Shared dock behavior

- Only one dock tool may be active at a time.
- Panels float above the dock and do not resize the terminal.
- Tapping the active tool again or tapping the terminal body closes the panel.
- Opening a dock tool dismisses the mobile `Nhập · Chọn` interaction bubble.
- Switching terminal tab, disconnecting, closing the containing surface or unmounting clears transient panel state.
- Panels use HAPI theme tokens in light and dark themes and respect safe-area insets.

## 4. Snippets UX

### 4.1 Panel

The floating command-palette panel contains:

- Header: `Snippets`, the note `Insert only · does not run`, and `New`.
- Search field that filters the active tab by name, command and description.
- Tabs: `Built-in` and `My snippets`.
- Rows: icon, name, truncated command and a trailing action.

Built-in rows show `Insert`. Custom rows show `Edit` and `Delete` on the same row.

### 4.2 Insert behavior

- Tapping a snippet sends its command through the existing `onWritePlainInput` path.
- HAPI must not append Enter, newline or carriage return.
- A successful insertion closes the panel and announces `Inserted · not executed`.
- Inserting a snippet must not focus xterm or summon the native mobile keyboard.
- If the terminal is unavailable, keep the panel open and show a non-blocking error.

### 4.3 Built-in catalog

Built-ins are versioned with the web application, remain read-only and do not create database rows.

The initial catalog is non-destructive and grouped:

- Navigation: `pwd`, `ls -la`, `clear`.
- Git: `git status --short`, `git diff`, `git log --oneline -10`.
- System: `ps aux`, `df -h`.

Built-in names and descriptions are translated. Commands are literal.

### 4.4 Custom snippet management

- `New` opens the editor inside the floating panel.
- The editor contains name, command and optional description.
- Saving returns to `My snippets`.
- Editing uses the same editor with existing values.
- Delete uses the shared HAPI confirmation dialog.
- Save failure keeps the editor and user input open.
- Duplicate names are allowed; identity is the snippet ID.
- Newest-created snippets appear first. Editing does not reorder them.

## 5. Custom snippet persistence

### 5.1 Data model

Hub stores custom snippets in SQLite:

| Field | Rule |
|---|---|
| `id` | generated opaque ID, primary key |
| `namespace` | derived from authenticated request context |
| `name` | required, trimmed, maximum 80 characters |
| `command` | required, maximum 8,192 characters |
| `description` | optional, maximum 240 characters |
| `created_at` | server timestamp |
| `updated_at` | server timestamp |

The table has an index supporting namespace-scoped listing by creation time. A namespace may store at most 200 custom snippets.

### 5.2 API and synchronization

Hub provides namespace-scoped list, create, update and delete routes. The client never supplies or overrides the namespace.

Shared Zod schemas validate requests and responses. Limits are enforced by Hub even when the web client is bypassed.

Web behavior:

- Fetch `My snippets` only after the panel is first opened.
- Cache the list with TanStack Query.
- Update the current client's cache from mutation responses.
- Publish a lightweight SSE invalidation event after mutation so connected clients invalidate the cached list; the mutation response still gives the initiating client an immediate update.
- Do not paginate because the server-enforced maximum is 200 rows.

### 5.3 Security boundary

Custom snippets are stored as plaintext in the local Hub SQLite database.

- Data is isolated by namespace.
- Snippets are not sent to coding-agent providers merely by being stored or listed.
- The editor warns users not to store passwords, tokens or other secrets.
- Encryption at rest and secret detection are explicitly outside this delivery.

## 6. Search UX

Search uses a slim floating Find bar:

- Label: `Search terminal output`.
- Text field.
- `Aa` case-sensitive toggle.
- Current/total result count.
- Previous and next result buttons.

All reported matches use a muted highlight. The active match uses a stronger highlight and xterm scrolls it into view.

The native mobile keyboard opens only after the user explicitly taps the search field. Merely opening Search does not focus the field. Closing the panel returns terminal interaction to the normal idle state.

## 7. Search architecture and performance

### 7.1 Addon ownership

- Add the official `@xterm/addon-search` version compatible with the installed xterm major version.
- Lazy-import the addon when Search is opened for the first time in a `TerminalView`.
- Show a compact loading state during the first import and enable the search field when the adapter is ready without focusing it automatically.
- Keep one addon instance for that `TerminalView`.
- Closing Search clears decorations but keeps the loaded instance for fast reopening.
- Unmounting or replacing `TerminalView` disposes the addon and listeners.

`TerminalView` exposes a narrow search adapter to its parent. `TerminalControlDock` consumes the adapter and does not access xterm internals.

### 7.2 Query rules

- Search only the active xterm buffer.
- HAPI currently retains xterm's default 1,000 scrollback rows; this delivery does not change it.
- Maximum query length: 256 characters.
- Input debounce: 150 ms.
- Do not search during IME composition; run once on composition end.
- Previous and next actions execute immediately.
- Use incremental search and case-sensitive options supplied by SearchAddon.
- Enable addon decorations with its 1,000-highlight safety limit.
- If the addon reports that the highlight threshold was exceeded, show `1000+` rather than a misleading current index.

Regex and whole-word controls are omitted from the first version.

### 7.3 Output updates

HAPI does not add a second output debounce. SearchAddon already batches refresh work after xterm writes and resizes.

This avoids:

- Searching once per socket chunk.
- Two competing refresh timers.
- Delayed or stale counts caused by redundant HAPI scheduling.

## 8. Component boundaries

| Unit | Responsibility |
|---|---|
| `TerminalControlDock` | Active-tool orchestration and shared mobile toolbar |
| `TerminalSnippetPanel` | Built-in/custom browsing, filtering, editing and insertion |
| `TerminalSearchPanel` | Query input, result count, case toggle and navigation |
| `TerminalView` | Own xterm and the lifecycle of the lazily loaded SearchAddon |
| Search adapter | Narrow `search`, `next`, `previous`, `clear` and result-change contract |
| Web query/mutations | Cache and mutate custom snippets |
| Hub routes/service/store | Namespace authorization, validation, persistence and invalidation |

Search remains web-only. Snippet persistence touches shared schemas and Hub, but inserting a command reuses the existing terminal write path.

## 9. Error and lifecycle handling

### Search

- Addon-load failure leaves the terminal usable and shows a retryable Search error.
- Empty query clears decorations and reports no result.
- A delayed debounced query cannot execute against a disposed or replaced terminal.
- Closing or switching terminal context clears selection, decorations, count and pending timers.

### Snippets

- Built-ins remain available if custom-snippet loading fails.
- A cached custom list may remain visible with a retry state.
- Create/update/delete errors do not silently remove local user input.
- Hub rejects cross-namespace reads and mutations.
- Repeated submissions are disabled while a mutation is pending.

## 10. Accessibility

- Dock tools expose pressed state.
- Search count changes and successful snippet insertion use polite live regions.
- Search, tab, row and editor controls are keyboard reachable.
- Edit/Delete controls remain in the row and do not use nested buttons.
- Touch targets are at least 44×44px even when visual icons are smaller.
- Reduced-motion settings disable panel and feedback transitions.

## 11. Verification

### Verification status — 2026-07-28

Completed:

- [x] Locale coverage: all 59 Search/Snippets keys referenced by the components and built-in catalog exist in English, Vietnamese and Simplified Chinese. English exports the authoritative locale-key type; Vietnamese and Simplified Chinese must contain exactly those keys at typecheck time. This authority enforces locale parity only; call-site `t(...)` key typing remains out of scope.
- [x] Exact typed parity also closed 8 pre-existing Vietnamese and 3 pre-existing Simplified Chinese `newSession.*` gaps. These additions only complete translations; they do not introduce separate feature behavior.
- [x] Focused shared tests: 15 passed.
- [x] Focused Hub store, migration and route tests: 16 passed.
- [x] Full web suite: 1,156 tests in 136 files passed.
- [x] Root typecheck completed for shared, CLI, web and Hub.
- [x] Web production build completed.
- [x] Static scope review found no CLI files, History implementation, desktop-only controls or scrollback changes in the feature diff. SearchAddon adds no HAPI output listener.

Pending:

- [ ] Mobile browser acceptance at 390px and 768px in light and dark themes, covering the session modal and Editor. The full local stack could not be started because port 3006 was already owned by an existing HAPI Hub, which was left untouched. A web-only server started on port 5174, but a fresh automated browser encountered Vite dependency-optimization reloads (`ERR_NETWORK_CHANGED`) and exposed no interactive UI before the acceptance timebox ended. No browser behavior is claimed as verified.
- [ ] Representative runtime performance acceptance. No authenticated terminal with representative output and snippet data was available, so the search and snippet interaction thresholds were not measured. Static review is not a substitute for the required runtime measurements.

### Hub and shared

1. CRUD accepts valid snippets and enforces every length/count limit.
2. Namespace A cannot list, edit or delete namespace B's snippets.
3. Mutations publish the expected invalidation event.
4. Database listing order remains stable after editing.

### Web snippets

1. Built-ins render without an API request.
2. `My snippets` loads lazily, filters correctly and handles empty/error states.
3. Insert writes the exact command without Enter and closes the panel.
4. Create/edit/delete update the cache and preserve form data on failure.
5. Session modal and mobile Editor use the same panel behavior.

### Web search

1. SearchAddon loads only on first Search use and is disposed with its terminal.
2. Typing uses a 150 ms composition-safe debounce; navigation is immediate.
3. Counts, case-sensitive matching, active decoration and threshold display are correct.
4. New terminal output updates through SearchAddon's lifecycle without an extra HAPI timer.
5. Closing, switching tabs and unmounting clear pending work and decorations.
6. A 1,000-line buffer does not create a browser task longer than 50 ms during representative searches.

### Regression

- Paste, Keys, More, mobile input/selection and terminal scrolling remain functional.
- Web tests, Hub tests, typecheck and production build complete successfully.

## 12. Out of scope

- `History` implementation.
- Automatically executing snippets.
- Snippet variables, placeholders or cursor placement.
- Favorites, manual ordering, import/export or sharing.
- Encryption at rest or secret scanning.
- Regex and whole-word search controls.
- Persisting search state across terminal tabs.
- Searching output no longer retained by xterm.
- Changing terminal scrollback or CLI output-buffer limits.
