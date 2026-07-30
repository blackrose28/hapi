# Terminal Key Chord Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile Terminal `Keys` grid with the approved one-line chord composer, xterm-compatible encoder, overlay key picker, and browser-local saved chord management.

**Architecture:** Keep terminal key semantics, encoding, and persistence in focused non-React modules. A mounted-but-hidden `TerminalKeyComposer` owns the per-terminal draft so closing the dock does not lose it; shared `AppDialog` sheets own key selection and saved-item management. Existing terminal write wiring remains the only PTY output path.

**Tech Stack:** React 19, TypeScript strict, Vitest, Testing Library, Tailwind CSS, Radix/AppDialog, browser `localStorage`.

---

## File structure

| File | Responsibility |
|---|---|
| `web/src/components/Terminal/terminalKeyChord.ts` | types, US-key catalog, normalization and stable identity |
| `web/src/components/Terminal/terminalKeyChord.test.ts` | catalog and normalization tests |
| `web/src/components/Terminal/terminalKeyEncoder.ts` | pure xterm/Linux sequence encoder |
| `web/src/components/Terminal/terminalKeyEncoder.test.ts` | exact byte/sequence matrix |
| `web/src/components/Terminal/terminalKeyChordStore.ts` | versioned localStorage repository and same-tab change signal |
| `web/src/components/Terminal/terminalKeyChordStore.test.ts` | corrupt data, duplicate, order, limit, delete/restore |
| `web/src/components/Terminal/TerminalKeyPickerDialog.tsx` | shared sheet for modifiers and one main key |
| `web/src/components/Terminal/TerminalSavedKeyDialog.tsx` | shared sheet for load, delete, undo |
| `web/src/components/Terminal/TerminalKeyComposer.tsx` | fixed rail/composer UI and lifecycle |
| `web/src/components/Terminal/TerminalKeyComposer.test.tsx` | interaction, lifecycle and accessibility coverage |
| `web/src/components/Terminal/TerminalControlDock.tsx` | replace the legacy Keys grid with the composer |
| `web/src/components/Terminal/TerminalControlDock.test.tsx` | dock integration and no-immediate-send checks |
| `web/src/components/Terminal/terminalControls.ts` | return write acceptance from `sendQuickInput` |
| `web/src/components/Terminal/SessionTerminalTabs.tsx` | remove obsolete modifier props |
| `web/src/components/editor/EditorTerminal.tsx` | remove obsolete modifier props |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | new Keys copy |

### Task 1: Define the semantic key catalog

**Files:**
- Create: `web/src/components/Terminal/terminalKeyChord.ts`
- Create: `web/src/components/Terminal/terminalKeyChord.test.ts`

- [ ] **Step 1: Write failing normalization and catalog tests**

```ts
import { describe, expect, it } from 'vitest'
import {
    getTerminalKey,
    normalizeTerminalKeyChord,
    terminalKeyChordIdentity,
    TERMINAL_KEY_GROUPS,
} from './terminalKeyChord'

describe('terminalKeyChord', () => {
    it('normalizes modifiers and preserves one canonical main key', () => {
        const chord = normalizeTerminalKeyChord({
            modifiers: ['shift', 'ctrl', 'shift'],
            key: { id: 'digit-6', label: 'wrong', kind: 'character' },
        })

        expect(chord).toEqual({
            modifiers: ['ctrl', 'shift'],
            key: getTerminalKey('digit-6'),
        })
        expect(terminalKeyChordIdentity(chord!)).toBe('ctrl+shift:digit-6')
    })

    it('rejects unknown keys', () => {
        expect(normalizeTerminalKeyChord({
            modifiers: [],
            key: { id: 'unknown', label: '?', kind: 'character' },
        })).toBeNull()
    })

    it('contains every approved picker group', () => {
        expect(Object.keys(TERMINAL_KEY_GROUPS)).toEqual([
            'basic',
            'alphanumeric',
            'function',
            'symbol',
        ])
        expect(TERMINAL_KEY_GROUPS.function).toHaveLength(12)
        expect(TERMINAL_KEY_GROUPS.alphanumeric).toHaveLength(36)
    })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run --cwd web test -- terminalKeyChord.test.ts
```

Expected: FAIL because `terminalKeyChord.ts` does not exist.

- [ ] **Step 3: Implement canonical types, catalog generators, and normalization**

Create types:

```ts
export type TerminalModifier = 'ctrl' | 'alt' | 'shift'
export type TerminalKeyKind = 'control' | 'character' | 'navigation' | 'function'
export type TerminalKeyGroup = 'basic' | 'alphanumeric' | 'function' | 'symbol'

export type TerminalMainKey = {
    id: string
    label: string
    pickerLabel: string
    kind: TerminalKeyKind
    group: TerminalKeyGroup
    base?: string
    shifted?: string
}

export type TerminalKeyChord = {
    modifiers: TerminalModifier[]
    key: TerminalMainKey
}

export type TerminalKeyChordDraft = {
    modifiers: TerminalModifier[]
    key: TerminalMainKey | null
}
```

Build the catalog from:

```ts
const SHIFTED_DIGITS = [')', '!', '@', '#', '$', '%', '^', '&', '*', '(']
const SYMBOL_PAIRS = [
    ['backquote', '`', '~'],
    ['minus', '-', '_'],
    ['equal', '=', '+'],
    ['bracket-left', '[', '{'],
    ['bracket-right', ']', '}'],
    ['backslash', '\\', '|'],
    ['semicolon', ';', ':'],
    ['quote', "'", '"'],
    ['comma', ',', '<'],
    ['period', '.', '>'],
    ['slash', '/', '?'],
] as const
```

Add basic definitions for `escape`, `tab`, `enter`, `backspace`, `home`, `end`, `page-up`, `page-down`, and four arrows. Generate `letter-a..letter-z`, `digit-0..digit-9`, and `f1..f12`. Export immutable group arrays, `getTerminalKey(id)`, `normalizeTerminalKeyChord(input)`, `terminalKeyChordIdentity(chord)`, and `formatTerminalKeyChord(chord)`.

Normalization must rebuild the main key from the catalog and order unique modifiers as `ctrl`, `alt`, `shift`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
bun run --cwd web test -- terminalKeyChord.test.ts
```

Expected: all `terminalKeyChord` tests pass.

- [ ] **Step 5: Commit the semantic model**

```bash
git add web/src/components/Terminal/terminalKeyChord.ts \
        web/src/components/Terminal/terminalKeyChord.test.ts
git commit -m "feat(web): define terminal key chord catalog"
```

### Task 2: Encode chords into xterm-compatible sequences

**Files:**
- Create: `web/src/components/Terminal/terminalKeyEncoder.ts`
- Create: `web/src/components/Terminal/terminalKeyEncoder.test.ts`

- [ ] **Step 1: Write the exact-sequence tests**

```ts
import { describe, expect, it } from 'vitest'
import { getTerminalKey } from './terminalKeyChord'
import { encodeTerminalKeyChord } from './terminalKeyEncoder'

function chord(modifiers: Array<'ctrl' | 'alt' | 'shift'>, keyId: string) {
    return { modifiers, key: getTerminalKey(keyId)! }
}

describe('encodeTerminalKeyChord', () => {
    it.each([
        [chord(['ctrl'], 'letter-c'), '\x03'],
        [chord(['ctrl', 'shift'], 'digit-6'), '\x1e'],
        [chord(['shift'], 'tab'), '\x1b[Z'],
        [chord(['alt'], 'arrow-up'), '\x1b[1;3A'],
        [chord(['ctrl', 'shift'], 'f10'), '\x1b[21;6~'],
        [chord([], 'f1'), '\x1bOP'],
        [chord(['ctrl'], 'f1'), '\x1b[1;5P'],
        [chord([], 'page-down'), '\x1b[6~'],
        [chord(['alt'], 'letter-x'), '\x1bx'],
    ])('encodes %o', (input, expected) => {
        expect(encodeTerminalKeyChord(input)).toEqual({
            ok: true,
            sequence: expected,
        })
    })

    it('rejects modifiers that cannot be represented', () => {
        expect(encodeTerminalKeyChord(chord(['ctrl'], 'enter'))).toEqual({
            ok: false,
            reason: 'unsupported',
        })
    })
})
```

- [ ] **Step 2: Run the encoder test and verify RED**

```bash
bun run --cwd web test -- terminalKeyEncoder.test.ts
```

Expected: FAIL because the encoder is missing.

- [ ] **Step 3: Implement the pure encoder**

Use this result contract:

```ts
export type TerminalKeyEncodingResult =
    | { ok: true; sequence: string }
    | { ok: false; reason: 'invalid' | 'unsupported' }
```

Implementation rules:

```ts
const modifierParameter = (modifiers: TerminalModifier[]) =>
    1
    + (modifiers.includes('shift') ? 1 : 0)
    + (modifiers.includes('alt') ? 2 : 0)
    + (modifiers.includes('ctrl') ? 4 : 0)

const CONTROL_CHARACTERS: Record<string, string> = {
    '@': '\x00',
    '[': '\x1b',
    '\\': '\x1c',
    ']': '\x1d',
    '^': '\x1e',
    '_': '\x1f',
    '?': '\x7f',
}
```

- letters map case-insensitively to `0x01..0x1a`;
- Shift transforms a character through catalog `shifted` metadata before Ctrl mapping;
- Alt prefixes `\x1b` after character/control mapping;
- unmodified arrows use `ESC [ A/B/C/D`; modified arrows use `ESC [ 1 ; m A/B/C/D`;
- Home/End use `H/F`, Page Up/Down use codes `5/6`;
- F1–F4 use `OP/OQ/OR/OS` unmodified and `ESC [ 1 ; m P/Q/R/S` modified;
- F5–F12 use codes `15,17,18,19,20,21,23,24`;
- Shift+Tab is `ESC [ Z`; Alt may prefix it;
- Esc, Enter, Backspace, and plain Tab accept no modifier except Alt; unsupported modifier combinations return `unsupported`;
- normalize first; never mutate the caller's chord.

- [ ] **Step 4: Run encoder and catalog tests**

```bash
bun run --cwd web test -- terminalKeyEncoder.test.ts terminalKeyChord.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit the encoder**

```bash
git add web/src/components/Terminal/terminalKeyEncoder.ts \
        web/src/components/Terminal/terminalKeyEncoder.test.ts
git commit -m "feat(web): encode terminal key chords"
```

### Task 3: Add versioned browser-local persistence

**Files:**
- Create: `web/src/components/Terminal/terminalKeyChordStore.ts`
- Create: `web/src/components/Terminal/terminalKeyChordStore.test.ts`

- [ ] **Step 1: Write repository tests**

Cover:

```ts
it('stores newest first and rejects a normalized duplicate')
it('drops corrupt and unknown-key records while loading')
it('returns limit without deleting an existing item at 50 entries')
it('deletes and restores an item at its original index')
it('returns unavailable when storage access throws')
```

Use a small in-memory `Storage` implementation in the test and deterministic `idFactory`/`now` dependencies.

- [ ] **Step 2: Run the store test and verify RED**

```bash
bun run --cwd web test -- terminalKeyChordStore.test.ts
```

Expected: FAIL because the store module is missing.

- [ ] **Step 3: Implement the repository**

Export:

```ts
export const TERMINAL_KEY_CHORD_STORAGE_KEY = 'hapi:terminal-key-chords:v1'
export const TERMINAL_KEY_CHORD_LIMIT = 50

export type SavedTerminalKeyChord = {
    id: string
    chord: TerminalKeyChord
    createdAt: number
}

export type SaveTerminalKeyChordResult =
    | { status: 'saved'; item: SavedTerminalKeyChord }
    | { status: 'duplicate'; item: SavedTerminalKeyChord }
    | { status: 'limit' }
    | { status: 'unavailable' }
```

Create `createTerminalKeyChordStore({ storage, now, idFactory })` with `load`, `save`, `remove`, and `restore`. Every read must:

1. catch storage/JSON errors;
2. require `{ version: 1, items: [] }`;
3. normalize each chord through the canonical catalog;
4. remove invalid/duplicate records;
5. cap the loaded view at 50 without writing during read.

The browser singleton must dispatch `hapi:terminal-key-chords-changed` after successful writes. Export `subscribeTerminalKeyChords(listener)` to listen to both that same-tab event and the native cross-tab `storage` event.

- [ ] **Step 4: Run store tests**

```bash
bun run --cwd web test -- terminalKeyChordStore.test.ts
```

Expected: all store tests pass.

- [ ] **Step 5: Commit persistence**

```bash
git add web/src/components/Terminal/terminalKeyChordStore.ts \
        web/src/components/Terminal/terminalKeyChordStore.test.ts
git commit -m "feat(web): persist terminal key chords locally"
```

### Task 4: Build picker and saved-management sheets

**Files:**
- Create: `web/src/components/Terminal/TerminalKeyPickerDialog.tsx`
- Create: `web/src/components/Terminal/TerminalSavedKeyDialog.tsx`
- Create: `web/src/components/Terminal/TerminalKeyDialogs.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: Add failing dialog interaction tests**

Tests must assert:

```ts
it('uses the shared sheet presentation')
it('keeps the original chord when picker is cancelled')
it('selects Ctrl, Shift and F10 then applies one normalized chord')
it('replaces the selected main key instead of appending another')
it('loads a saved chord without calling the terminal sender')
it('deletes a saved chord and restores it through Undo')
```

Query `data-app-dialog-presentation="sheet"` to prove the common HAPI foundation is used.

- [ ] **Step 2: Run dialog tests and verify RED**

```bash
bun run --cwd web test -- TerminalKeyDialogs.test.tsx
```

Expected: FAIL because dialog components do not exist.

- [ ] **Step 3: Implement `TerminalKeyPickerDialog`**

Props:

```ts
type TerminalKeyPickerDialogProps = {
    open: boolean
    chord: TerminalKeyChord | null
    onOpenChange: (open: boolean) => void
    onApply: (chord: TerminalKeyChord) => void
}
```

Render `AppDialogContent presentation="sheet"` with:

- shared header `Chọn phím`;
- live preview badges;
- independent Ctrl/Alt/Shift toggles;
- tabs `Cơ bản`, `Chữ & số`, `F1–F12`, `Ký hiệu`;
- a scrollable grid from `TERMINAL_KEY_GROUPS`;
- `Hủy` and `Áp dụng tổ hợp`.

Maintain a sheet-local `TerminalKeyChordDraft`. Only `onApply` changes the parent chord. Disable Apply until the local draft has a main key and the encoder returns `ok`.

- [ ] **Step 4: Implement `TerminalSavedKeyDialog`**

Props:

```ts
type TerminalSavedKeyDialogProps = {
    open: boolean
    items: SavedTerminalKeyChord[]
    onOpenChange: (open: boolean) => void
    onLoad: (chord: TerminalKeyChord) => void
    onDelete: (id: string) => DeletedSavedTerminalKeyChord | null
    onRestore: (deleted: DeletedSavedTerminalKeyChord) => void
}
```

Render the approved v9 layout:

- title/subtitle with local count;
- rows with horizontally scrollable mini badges;
- fixed `Nạp` and destructive icon buttons;
- no direct Send action;
- footer green dot + `Chỉ lưu trên thiết bị`;
- `Xong`;
- one 5-second Undo notice after deletion, replacing the previous notice if another item is deleted.

- [ ] **Step 5: Add locale keys in all three locale files**

Add the same key set to English, Vietnamese, and Chinese:

```text
terminal.keys.title
terminal.keys.saved
terminal.keys.manage
terminal.keys.emptySaved
terminal.keys.combination
terminal.keys.add
terminal.keys.save
terminal.keys.clear
terminal.keys.send
terminal.keys.pickTitle
terminal.keys.pickSubtitle
terminal.keys.apply
terminal.keys.basic
terminal.keys.alphanumeric
terminal.keys.function
terminal.keys.symbol
terminal.keys.savedTitle
terminal.keys.savedSubtitle
terminal.keys.load
terminal.keys.delete
terminal.keys.undo
terminal.keys.localOnly
terminal.keys.duplicate
terminal.keys.limit
terminal.keys.unavailable
terminal.keys.unsupported
terminal.keys.sendFailed
```

- [ ] **Step 6: Run dialog tests**

```bash
bun run --cwd web test -- TerminalKeyDialogs.test.tsx
```

Expected: all dialog tests pass.

- [ ] **Step 7: Commit dialog UI**

```bash
git add web/src/components/Terminal/TerminalKeyPickerDialog.tsx \
        web/src/components/Terminal/TerminalSavedKeyDialog.tsx \
        web/src/components/Terminal/TerminalKeyDialogs.test.tsx \
        web/src/lib/locales/en.ts \
        web/src/lib/locales/vi-VN.ts \
        web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add terminal key chord sheets"
```

### Task 5: Build the approved one-line composer

**Files:**
- Create: `web/src/components/Terminal/TerminalKeyComposer.tsx`
- Create: `web/src/components/Terminal/TerminalKeyComposer.test.tsx`

- [ ] **Step 1: Write failing composer tests**

Cover:

```ts
it('renders a fixed saved rail and one-line composer')
it('loads a saved item into badges without sending')
it('sends exactly once and clears only after an accepted write')
it('preserves the draft after hide/show and clears it on terminal context change')
it('keeps the draft and shows an error when write is rejected')
it('saves a valid chord, rejects duplicate, and exposes Manage')
it('removes a badge using a labelled non-shrinking trailing button')
```

The lifecycle test must rerender with the same `terminalContextKey`, then with a different key.

- [ ] **Step 2: Run composer tests and verify RED**

```bash
bun run --cwd web test -- TerminalKeyComposer.test.tsx
```

Expected: FAIL because the composer does not exist.

- [ ] **Step 3: Implement composer behavior**

Props:

```ts
type TerminalKeyComposerProps = {
    terminalContextKey: string | null
    disabled: boolean
    visible: boolean
    onSend: (sequence: string) => boolean
}
```

State:

```ts
const [draft, setDraft] = useState<TerminalKeyChord | null>(null)
const [pickerOpen, setPickerOpen] = useState(false)
const [managerOpen, setManagerOpen] = useState(false)
const [items, setItems] = useState<SavedTerminalKeyChord[]>([])
const sendingRef = useRef(false)
```

Load saved items only when `visible` first becomes true. Subscribe to the store while mounted. Reset draft/dialogs/error when `terminalContextKey` changes, but do not reset when `visible` becomes false.

Sending:

```ts
const encoded = draft ? encodeTerminalKeyChord(draft) : { ok: false as const, reason: 'invalid' as const }
if (!encoded.ok || sendingRef.current) return
sendingRef.current = true
const accepted = onSend(encoded.sequence)
if (accepted) setDraft(null)
else setError('sendFailed')
queueMicrotask(() => { sendingRef.current = false })
```

Saving delegates to the store and maps `duplicate`, `limit`, and `unavailable` to inline feedback.

- [ ] **Step 4: Match the approved v8 visual**

The outer panel uses HAPI tokens and:

```text
rounded-2xl border shadow-xl backdrop-blur
10px panel padding
42px fixed saved rail
one-line no-wrap horizontal scrollers
36px saved pills with radius around 10px
34px violet modifier badges
cyan main-key badge
36px trailing remove target
48px Add and Send controls
no inline picker expansion
```

The heading row contains `Đã lưu · N` + `Quản lý`. The composer heading contains `Tổ hợp phím`, `Lưu`, and `Xóa hết`. The empty rail reserves height. Use edge fades to signal horizontal overflow and scroll the newly added badge into view.

- [ ] **Step 5: Run composer tests**

```bash
bun run --cwd web test -- TerminalKeyComposer.test.tsx
```

Expected: all composer tests pass.

- [ ] **Step 6: Commit composer UI**

```bash
git add web/src/components/Terminal/TerminalKeyComposer.tsx \
        web/src/components/Terminal/TerminalKeyComposer.test.tsx
git commit -m "feat(web): add terminal key chord composer"
```

### Task 6: Integrate composer into both terminal surfaces

**Files:**
- Modify: `web/src/components/Terminal/terminalControls.ts`
- Modify: `web/src/components/Terminal/TerminalControlDock.tsx`
- Modify: `web/src/components/Terminal/TerminalControlDock.test.tsx`
- Modify: `web/src/components/Terminal/SessionTerminalTabs.tsx`
- Modify: `web/src/components/editor/EditorTerminal.tsx`

- [ ] **Step 1: Replace legacy dock tests with composer integration tests**

Remove assertions that Escape sends immediately and Ctrl/Alt call `onModifierToggle`. Add:

```ts
it('opens the chord composer without writing')
it('loads Ctrl + Shift + F10 and writes only after Send')
it('keeps the mounted composer draft when Keys is toggled closed and open')
```

Update the test translation map with all `terminal.keys.*` labels used by role queries.

- [ ] **Step 2: Run dock tests and verify RED**

```bash
bun run --cwd web test -- TerminalControlDock.test.tsx
```

Expected: new composer expectations fail against the legacy helper grid.

- [ ] **Step 3: Return write acceptance from quick input**

Change:

```ts
sendQuickInput: (sequence: string) => boolean
```

and:

```ts
const sendQuickInput = useCallback((sequence: string): boolean => {
    if (!sequence || args.disabled) return false
    return writeWithModifiers(sequence, { ctrl: ctrlActive, alt: altActive })
}, [args.disabled, ctrlActive, altActive, writeWithModifiers])
```

Keep legacy `More` sequences and native-input behavior unchanged.

- [ ] **Step 4: Replace the Keys grid**

In `TerminalControlDock`:

- remove `QUICK_INPUT_ROWS`, `FUNCTION_KEYS`, `BACKSPACE`, `HelperKeyButton`, `HelperKeyGrid`, and `functionLayer`;
- remove `ctrlActive`, `altActive`, and `onModifierToggle` props;
- keep `AdvancedKeyGroups` for the separate `More` tool;
- mount `TerminalKeyComposer` after Keys first opens;
- hide its section rather than unmounting when another tool becomes active;
- pass `terminalContextKey`, `disabled`, and `onQuickInput` as `onSend`;
- preserve the approved absolute `bottom-full left-2 right-2 mb-2 lg:hidden` overlay placement.

In Session and Editor terminal call sites, remove only the obsolete modifier props. Both continue using their existing `useTerminalQuickInput` write path.

- [ ] **Step 5: Run focused integration tests**

```bash
bun run --cwd web test -- \
    TerminalControlDock.test.tsx \
    SessionTerminalTabs.test.tsx \
    EditorTerminal.test.tsx
```

Expected: all three files pass.

- [ ] **Step 6: Commit terminal integration**

```bash
git add web/src/components/Terminal/terminalControls.ts \
        web/src/components/Terminal/TerminalControlDock.tsx \
        web/src/components/Terminal/TerminalControlDock.test.tsx \
        web/src/components/Terminal/SessionTerminalTabs.tsx \
        web/src/components/editor/EditorTerminal.tsx
git commit -m "feat(web): integrate terminal key composer"
```

### Task 7: Full verification and scope review

**Files:**
- Modify only files already listed if verification finds a feature regression.
- Modify: `docs/superpowers/specs/2026-07-29-terminal-key-chord-composer-design.md`

- [ ] **Step 1: Run all terminal-focused tests**

```bash
bun run --cwd web test -- \
    terminalKeyChord.test.ts \
    terminalKeyEncoder.test.ts \
    terminalKeyChordStore.test.ts \
    TerminalKeyDialogs.test.tsx \
    TerminalKeyComposer.test.tsx \
    TerminalControlDock.test.tsx \
    SessionTerminalTabs.test.tsx \
    EditorTerminal.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run complete Web tests**

```bash
bun run --cwd web test
```

Expected: complete Web Vitest suite passes.

- [ ] **Step 3: Run typecheck and production build**

```bash
bun typecheck
bun run build:web
```

Expected: TypeScript exits 0 and Vite Web build succeeds.

- [ ] **Step 4: Inspect actual scope**

```bash
git diff aa718a7..HEAD --stat
git diff aa718a7..HEAD -- web/src/components/Terminal web/src/lib/locales
git diff --check aa718a7..HEAD
```

Confirm:

- no Hub, CLI, shared schema, DB, or API changes;
- no synthetic browser keyboard event;
- saved-item operations never call terminal write;
- inside the new Keys composer, only Send calls terminal write;
- picker/manager both use shared `AppDialog`;
- no unrelated preview/BMAD files are staged.

- [ ] **Step 5: Update the design status with real evidence**

Change the spec status only after commands succeed:

```text
Đã triển khai; kiểm chứng tự động hoàn tất; chờ nghiệm thu giao diện mobile
```

Record actual test counts and build commands in a short verification section.

- [ ] **Step 6: Commit verification metadata**

```bash
git add docs/superpowers/specs/2026-07-29-terminal-key-chord-composer-design.md
git commit -m "docs: mark terminal key composer implemented"
```
