# Terminal exit auto-navigation — open design question

Status: deferred (open question, not yet designed)
Origin: upstream sync round `docs/upstream-sync/2026-07-30-round.md`, cart `R2-web-terminal-standalone`, commit `3473a88d` (`feat(web): auto-return to chat when remote terminal exits (#857)`)
Related: `docs/superpowers/specs/2026-07-27-terminal-modal-only-design.md`

## Problem

Upstream's now-removed standalone terminal page auto-navigated back to the session chat ~700ms after the shell process exited, so the user wasn't left staring at a dead terminal with no obvious next step (native-terminal muscle memory: typing `exit` closes the tab).

Our terminal is a modal (`web/src/components/modals/TerminalModal.tsx`) hosting a tabbed multi-terminal view (`web/src/components/Terminal/SessionTerminalTabs.tsx`). The old page's "go back to chat" navigation doesn't map 1:1 — there's no page to navigate away from, and a modal can hold several terminal tabs at once. `handleTerminalMount`/`onExit` in `SessionTerminalTabs.tsx:290-298` today only appends the exit message to that tab's buffer; nothing auto-closes anything.

## Open questions to resolve before implementing

- If the *active* tab's process exits, should the modal auto-close, or just visually mark that tab as exited (dim/badge) and leave the modal open?
- If it auto-closes, what happens when other tabs still have running/live processes — does the modal only auto-close when it's the *last* live tab?
- Should the delay match upstream's 700ms, or should it be skipped/shortened for a deliberate user action like typing `exit` vs. an unexpected crash (non-zero exit code)?
- Does this interact with the mobile bubble/interaction-overlay lifecycle described in the modal-only design doc?

## Not in scope here

This file intentionally stops at the open questions — resolving them and writing the actual behavior spec is follow-up work, to be picked up as its own `docs/superpowers/specs/` design + `docs/superpowers/plans/` pair when prioritized.
