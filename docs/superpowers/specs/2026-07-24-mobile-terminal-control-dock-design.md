# Mobile Terminal Control Dock — Design

**Date:** 2026-07-24

**Status:** Awaiting user review

**Reference:** `HAPI Mobile Terminal Control Dock — A-Hybrid` mockup

## 1. Goal

Replace the current tall mobile terminal quick-key stack with a compact six-item control dock:

`Paste · Snippets · Search · History · Keyboard · More`

The terminal must remain the primary surface. Tool panels float above the dock and must not resize the terminal. The native mobile keyboard remains the only allowed viewport-resizing exception.

## 2. Scope

Apply the shared control dock to every mobile surface that uses HAPI terminal controls:

- Session terminal modal
- Session terminal page
- Editor terminal panel

Desktop terminal behavior is unchanged.

## 3. Existing capabilities

| Capability | Current state |
|---|---|
| Clipboard paste | Direct clipboard read with manual-paste fallback dialog |
| Terminal key input | Esc, Tab, Ctrl, Alt, arrows and raw sequence sending |
| Advanced keys | Signals, navigation, F1–F12 and common symbols |
| Native keyboard focus | Terminal instance exists, but no dock-driven focus UX |
| Snippets | Control sequences exist; command presets and final panel do not |
| Search | No terminal search integration |
| History | No structured command capture or history panel |
| Dock/overlay | Does not exist |

No Hub, CLI, terminal protocol or database change is expected. Search may require the official xterm search addon.

## 4. Interaction model

### 4.1 Dock

- Fixed to the bottom of the terminal surface on mobile/tablet.
- Target height: 52–56px plus safe-area inset.
- Six equal-width actions with icon and short label.
- At most one stateful item is selected.
- `Paste` is an immediate action and never remains selected.
- Tapping the selected item closes its panel and clears selection.
- Tapping terminal content closes any HAPI panel and clears selection.
- Changing terminal tab or unmounting the terminal clears the selected tool.

### 4.2 Floating panels

- `Snippets`, `Search`, `History`, `Keyboard` helper keys and `More` appear above the dock.
- Panels render in an anchored overlay layer owned by the terminal shell and do not participate in terminal layout.
- Panel width follows the terminal container with an 8px side inset.
- Maximum height is bounded; long content scrolls inside the panel.
- Tap outside or tap terminal closes the panel.
- No bottom sheet and no nested modal for ordinary dock tools.

### 4.3 Native keyboard

- Selecting `Keyboard` focuses the active xterm input during the user gesture so iOS/Android may open the native keyboard.
- HAPI helper rows show Esc, Tab, Ctrl, Alt, Fn, arrows and Backspace.
- Tapping terminal content hides the HAPI helper panel and clears the selected dock item, but does not forcibly dismiss the native keyboard.

## 5. Tool behavior

### Paste

- Read clipboard and write plain text to the active terminal.
- Preserve the existing manual-paste fallback dialog.
- Show brief non-blocking success feedback.
- Do not open a tool panel or retain selected state.

### Snippets

Two preset groups in version one:

1. **Control:** Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L.
2. **Commands:** `clear`, `pwd`, `ls -la`, `git status`, `git diff`, compact `git log`.

Control sequences execute immediately. Command snippets send plain command text at the current cursor but never send Enter. They do not attempt shell-specific line clearing or replacement. User-created or persisted snippets are out of scope.

### Search

- Search xterm scrollback/output, not server logs.
- Case-insensitive by default.
- Display current match and total match count.
- Previous/next navigation.
- Highlight matches in terminal output.
- Clearing or closing Search removes search decorations.

### History

- Record commands entered through the current HAPI terminal instance only.
- Do not invoke the shell's `history` command.
- Do not read Bash/Zsh/Fish persistent history.
- Keep history in memory only and clear it when the terminal instance is closed.
- Ignore empty entries and de-duplicate consecutive identical commands.
- Cap the in-memory list at 100 commands.
- Reconstruct a candidate command only from supported ordinary input such as printable text, paste and backspace, finalized by Enter.
- If unsupported cursor-control or raw/TUI sequences make the candidate unreliable, discard that candidate rather than showing incorrect history.
- Selecting an item sends its plain text at the current cursor without Enter; it does not attempt shell-specific line replacement.

### Keyboard

- Open/focus the native keyboard.
- Show the compact helper-key grid.
- Preserve one-shot Ctrl/Alt modifier behavior.
- `Fn` switches the helper grid to the function-key layer; it is not sent as a terminal modifier byte.

### More

- Reuse existing advanced sequences.
- Group into navigation, function keys and symbols.
- Send selected sequences immediately.

## 6. Visual specification

- Theme: use existing HAPI application tokens; no terminal-specific parallel theme.
- Dock surface: translucent application background, 1px border, 14–16px radius and restrained shadow.
- Active item: violet accent with subtle tinted background; inactive items use hint text.
- Panels: same surface language as shared HAPI dialogs, but lightweight and anchored rather than modal.
- Touch targets: minimum 40px; primary dock actions target 48px or larger.
- Typography: labels 10–11px; panel headings 12–13px semibold; terminal sequences use monospace.
- Animation: short opacity/translate transition only; respect reduced-motion preferences.
- No terminal reflow when opening or closing HAPI panels.

## 7. Incremental delivery and acceptance gates

### Gate 1 — Dock foundation and existing features

- Build final dock and overlay foundation.
- Ship working Paste, Keyboard and More.
- Tapping terminal clears tool selection.
- Snippets, Search and History remain visibly disabled until their gates pass.
- Validate modal, session page and editor terminal.

### Gate 2 — Snippets

- Add both preset groups.
- Control shortcuts execute immediately.
- Command snippets insert plain text at the current cursor but never auto-run.

### Gate 3 — Search

- Add scrollback search, highlighting, match count and navigation.
- Validate empty query, no results, long output and terminal-tab switching.

### Gate 4 — History

- Add current-instance command capture and bounded in-memory list.
- Selecting a command inserts its plain text at the current cursor without executing.
- Validate paste, editing, duplicate commands, terminal switching and teardown.

### Gate 5 — Final mobile regression

- iOS and Android viewport behavior.
- Native keyboard open/close.
- Portrait and landscape.
- Session modal, terminal page and editor terminal.
- Safe-area insets, touch targets, focus and reduced motion.

Each gate requires focused tests, typecheck, production build and user visual acceptance before the next gate begins.

## 8. Out of scope

- Persistent or cross-session command history
- Reading shell history files
- User-created snippet management
- Search across server logs or previous terminal instances
- Desktop redesign
- Hub/CLI protocol changes

## 9. Main risks

1. Mobile browser keyboard focus restrictions: terminal focus must occur synchronously from the tap.
2. Command capture accuracy: raw/TUI input cannot be treated as ordinary shell commands.
3. Overlay layering: panels must stay above xterm canvas but below global dialogs.
4. Shared surfaces: the same dock must behave consistently in session and editor terminal implementations.
