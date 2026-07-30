# Agent Mode Session UI — Implementation Plan

**Goal:** Apply the approved compact session header and composer design to Agent Mode while preserving existing session behavior and provider-specific controls.

**Scope:** Web only. No API, persistence, protocol, or session-state changes.

## Task 1: Lock compact header behavior with tests

- [x] Update `web/src/components/SessionHeader.test.tsx`
  - Path opens the current session's Files modal.
  - Provider and task badges remain outside action controls.
  - Normal compact panels expose Unpin inside More and no standalone X.
  - Focused panels retain an X whose only action is closing focus.
  - Mobile-specific actions are marked for responsive hiding.
- [x] Update `web/src/components/SessionActionMenu.test.tsx`
  - Optional Files and Unpin actions close the menu and invoke their callbacks.
- [x] Run targeted tests and confirm they fail for the intended missing behavior.

## Task 2: Implement compact header and responsive actions

- [x] Update `web/src/components/SessionActionMenu.tsx`
  - Add optional Files and Unpin actions.
  - Keep Rename/Archive/Delete behavior unchanged.
- [x] Update `web/src/components/SessionHeader.tsx`
  - Replace the two-row compact header with a single-row layout.
  - Make the path a Files trigger.
  - Keep provider, task badge, Editor, Terminal, goal, and More.
  - Hide Focus and Team Chat on mobile through dedicated classes.
  - Move mobile Files and normal-panel Unpin into More.
  - Render standalone X only for focused-panel close semantics.
- [x] Update `web/src/components/Dashboard/dashboard.css`
  - Add compact header tokens, responsive action visibility, overflow protection, and light/dark-safe styling.
- [x] Run targeted header/menu tests.

## Task 3: Lock compact composer behavior with tests

- [x] Add `web/src/components/AssistantChat/CompactComposerControls.test.tsx`
  - Empty composer: disabled neutral send button.
  - Ready composer: purple send button and send callback.
  - Running thread: red stop button and abort callback.
  - Runtime selectors preserve nullable values and dispatch provider callbacks.
- [x] Extend `web/src/components/Dashboard/dashboard-mobile-css.test.ts`
  - Composer uses 520px two-row runtime breakpoint.
  - Focus/Team Chat/path are hidden on mobile.
  - Mobile runtime selectors form equal-width columns.
- [x] Run targeted tests and confirm they fail for the intended missing components/styles.

## Task 4: Implement compact composer and runtime controls

- [x] Add `web/src/components/AssistantChat/CompactComposerControls.tsx`
  - Attachment-only leading control.
  - Unified send/stop button with idle, ready, running states.
  - Generic Model, Reasoning/Effort, and Permission selectors from supplied options.
- [x] Update `web/src/components/AssistantChat/StatusBar.tsx`
  - Preserve existing status bar.
  - Add compact layout slot for interactive runtime controls.
- [x] Update `web/src/components/AssistantChat/HappyComposer.tsx`
  - Add the dedicated `compactComposerMode` scope.
  - Render approved pill composer only in Agent Mode.
  - Keep the Editor composer untouched.
  - Move compact runtime status below the input.
  - Preserve max five rows, attachments, autocomplete, IME, send, and abort behavior.
- [x] Update `web/src/components/SessionChat.tsx`
  - Pass compact mode into the composer.
- [x] Add shared compact composer CSS in `web/src/index.css`
  - Adaptive radius, theme tokens, thin scrollbar, responsive runtime rows, safe-area spacing.
- [x] Run targeted component/CSS tests.

## Task 5: Verify and review

- [x] Run web targeted tests.
- [x] Run `bun run --cwd web typecheck`.
- [x] Run `bun run --cwd web build`.
- [x] Run full web test suite.
- [x] Inspect desktop/mobile and light/dark with browser automation when runtime fixtures permit.
- [x] Review `git diff --check` and scoped diff; confirm no API/backend changes.
- [x] Commit only the implementation files and this plan.

### Review Findings

- [x] [Review][Patch] Đồng nhất desktop/mobile: khi agent đang chạy chỉ hiện Stop; vẫn cho soạn nháp nhưng chặn mọi cách gửi cho tới khi agent hoàn thành [web/src/components/AssistantChat/HappyComposer.tsx:382]
- [x] [Review][Patch] Tách giao diện composer Agent Mode khỏi `compactMode` dùng chung để không đổi ngoài phạm vi và làm mất nút Terminal trong Editor Chat [web/src/components/SessionChat.tsx:676]
- [x] [Review][Patch] Khôi phục lối chuyển session local về remote trong Agent Mode compact [web/src/components/AssistantChat/HappyComposer.tsx:724]
- [x] [Review][Patch] Chuẩn hóa chuyển Plan/Permission: luôn hiển thị đúng trạng thái, tuần tự hóa RPC, khóa khi đang cập nhật và hỗ trợ provider chỉ có một loại callback [web/src/components/AssistantChat/CompactComposerControls.tsx:144]
- [x] [Review][Patch] Giữ Files truy cập được trên desktop khi thiếu path, bỏ separator mồ côi và địa phương hóa nhãn hỗ trợ đọc màn hình [web/src/components/SessionActionMenu.tsx:298]
- [x] [Review][Patch] Dùng độ rộng panel thay vì viewport để xếp runtime selectors trong bố cục nhiều card [web/src/index.css:972]
- [x] [Review][Patch] Không làm mất các team membership sau mục đầu; thêm chỉ báo `+N`/overflow gọn [web/src/components/SessionHeader.tsx:373]
- [x] [Review][Patch] Sửa nhận diện composer nhiều dòng khi text tự wrap hoặc panel đổi kích thước [web/src/components/AssistantChat/HappyComposer.tsx:231]
- [x] [Review][Patch] Bổ sung test tích hợp compact composer cho switch remote, Terminal/Editor scope, IME, autocomplete, attachment, gửi/dừng và text tự wrap [web/src/components/AssistantChat/CompactComposerControls.test.tsx:1]
- [x] [Browser][Patch] Suy ra trạng thái chạy bảo thủ từ tool call chưa có kết quả khi cờ `session.thinking` của provider đến chậm; khóa cả lệnh Goal trong thời gian chạy [web/src/chat/running.ts:1]
- [x] [Browser][Patch] Dùng khóa dịch hiện có cho Files/Terminal thay vì hiển thị literal `button.files`/`button.terminal` [web/src/components/SessionActionMenu.tsx:308]

### Verification Evidence

- Full web suite: 131 files, 1056 tests passed.
- Web typecheck: passed.
- Web production build: passed; only pre-existing Browserslist, KaTeX asset, and chunk-size warnings.
- Browser: desktop light, mobile 390 light, mobile 320 dark, and focused panel checked against the worktree Vite server.
- Browser assertions: Stop-only while running, editable draft, responsive runtime selectors, correct Files fallback, no orphan focused separator, no horizontal overflow.
