# Mobile Terminal Input and Selection — Design

**Date:** 2026-07-24

**Status:** Awaiting user review

**Supersedes:** Native-keyboard behavior in §4.3 and `Keyboard` behavior in §5 of `2026-07-24-mobile-terminal-control-dock-design.md`

## 1. Goal

Make the mobile terminal readable and operable without opening the phone keyboard on every touch.

Users explicitly choose between:

- `Nhập`: focus xterm and open the native phone keyboard.
- `Chọn`: select and copy terminal output.

Selection combines a quick finger sweep with two native-style handles for precise correction.

## 2. Scope

Apply one shared interaction model to every HAPI web surface that renders `TerminalView` below the existing `lg` breakpoint:

- Session terminal modal
- Session terminal page
- Editor terminal panel

This change is web-only. Hub, CLI, PTY protocol, terminal persistence and desktop interaction remain unchanged.

## 3. Interaction states

The terminal surface has four mutually exclusive states:

| State | Meaning |
|---|---|
| `idle` | Read, scroll and use terminal/TUI controls |
| `choice` | Floating `Nhập · Chọn` bubble is visible |
| `input` | xterm may own focus and the native keyboard may be visible |
| `select` | Touch gestures select output; xterm input and TUI mouse actions are suppressed |

Only explicit `Nhập` may transition into `input`. Opening the dock's helper-key panel must not focus xterm or open the native keyboard.

## 4. Gesture arbitration

### Idle and choice

- A single touch starts as a possible tap.
- Movement beyond 6px locks the gesture to its dominant axis and becomes terminal scrolling. It closes the choice bubble and never opens the keyboard.
- A released short tap remains available to xterm/TUI, then opens the `Nhập · Chọn` bubble.
- A press held for 450ms without crossing the movement threshold enters `select` directly and suppresses the synthesized tap.
- Multi-touch cancels the pending tap or long press.

### Bubble placement and lifecycle

- The bubble is anchored above the visible xterm cursor and clamped inside the terminal surface.
- If the cursor is outside the visible viewport, the bubble falls back to the original touch point; it must not scroll the terminal to reveal the cursor.
- The original touch cell is retained separately as the seed for `Chọn`.
- The bubble closes on scrolling, terminal-tab change, session/modal change, dock-tool opening, terminal disconnect or unmount.
- A new short tap moves/reopens the bubble for the latest interaction.

### Input

- `Nhập` closes the bubble and synchronously focuses the active xterm helper textarea during the trusted user gesture.
- Closing the phone keyboard returns the terminal to `idle`.
- HAPI does not infer whether a terminal cell is editable. Input is always an explicit user decision.

## 5. Selection

### Entering selection

- Tapping `Chọn` selects the contiguous non-whitespace word under the original touch cell.
- Long press performs the same word selection without first showing the bubble.
- If the touched cell is blank, selection starts as a one-cell anchor and waits for a sweep.
- Entering `select` closes any dock panel and prevents the native keyboard from opening.

### Sweep and handles

- Sweeping across unselected text replaces the range from the sweep start to the current cell.
- Sweeping from inside the selected range extends the nearest selection edge.
- Two visible handles mark the start and end. Dragging a handle adjusts only that edge.
- Coordinates snap to xterm cells and may cross wrapped lines.
- Approaching an available scroll edge auto-scrolls the terminal while continuing the selection.
- Releasing the finger preserves the range and exposes the selection toolbar.

### Selection toolbar

The compact floating toolbar contains:

- `Sao chép`: copy `terminal.getSelection()` using the existing safe clipboard helper, show brief success feedback, then return to `idle`.
- `Chọn tất cả`: call xterm's full-buffer selection and keep `select` active.
- `Hủy`: clear xterm selection and return to `idle`.

The toolbar is clamped to the terminal surface and prefers the space above the selected range.

### Leaving selection

Selection is cleared when:

- The user chooses `Hủy`.
- Copy succeeds.
- The active terminal tab/session changes.
- The terminal disconnects or unmounts.

If clipboard copy fails, keep the range selected, keep the toolbar visible and show a non-blocking error so the user can retry.

## 6. Dock correction

- Rename the mobile dock item from `Keyboard` / `Bàn phím` to `Keys` / `Phím`.
- `Phím` only opens HAPI's Esc, Tab, Ctrl, Alt, arrow, Backspace and Fn helper grid.
- Opening `Phím`, pressing a helper key or opening `More` must not focus xterm and must not summon the native keyboard.
- Helper keys continue sending their existing terminal sequences.

## 7. Component boundaries

| Unit | Responsibility |
|---|---|
| `TerminalView` | Own xterm, expose cursor/cell geometry and selection commands |
| Mobile interaction controller | Resolve tap, long press, scroll, input and selection state deterministically |
| Choice bubble | Render `Nhập · Chọn` at a clamped anchor |
| Selection overlay | Render handles, toolbar, drag behavior and copy feedback |
| `TerminalControlDock` | Render helper keys without native-keyboard focus |
| `SessionTerminalTabs` | Clear transient interaction state when terminal context changes |

The mobile interaction controller must not inspect shell prompts, screen text or TUI type to guess whether typing is appropriate.

## 8. Accessibility and visuals

- Bubble, handles and toolbar use HAPI theme tokens in both light and dark themes.
- `Nhập`, `Chọn`, `Sao chép`, `Chọn tất cả` and `Hủy` are real buttons with translated accessible names.
- Primary touch targets are at least 44×44px; visual handles may be smaller but their hit areas remain 44px.
- Selection feedback must remain visible over xterm canvas rendering.
- Reduced-motion users receive no animated movement.
- Status feedback uses a polite live region and does not resize the terminal.

## 9. Error and lifecycle safety

- Pointer cancel, orientation change and component teardown release pointer capture and cancel timers.
- A destroyed or replaced xterm instance cannot receive a delayed focus, selection or copy action.
- Selection coordinates are clamped to current buffer bounds after resize or new output.
- No interaction state is persisted across terminal tabs or sessions.

## 10. Acceptance checks

1. Tapping htop/vim/tmux controls does not automatically open the phone keyboard; choosing `Nhập` does.
2. `Chọn` or long press selects a word, finger sweep extends/replaces the range, and both handles refine it.
3. Copy success exits selection; copy failure preserves it for retry.
4. A scroll gesture never becomes a tap, long press or text selection accidentally.
5. `Phím` sends helper sequences without opening the native phone keyboard.
6. Modal, session page and editor panel behave the same in portrait and landscape, light and dark themes.
7. Existing desktop terminal focus, mouse selection and keyboard behavior are unchanged.

## 11. Out of scope

- Detecting whether arbitrary TUI content is an editable field
- Persistent selections across terminal tabs or sessions
- Sharing selected text directly to native applications
- Custom selection menus beyond copy/select-all/cancel
- Redesigning Snippets, Search or History
- The separate PTY-width and horizontal-overflow correction for wide applications such as htop

