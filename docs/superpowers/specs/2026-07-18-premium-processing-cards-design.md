# Premium Processing Cards — Quiet Intelligence Design

**Ngày:** 2026-07-18  
**Trạng thái:** Đã duyệt trực quan và duyệt spec viết
**Mockup chuẩn:** `docs/superpowers/artifacts/2026-07-18-premium-processing-cards-mockup.html`

## 1. Mục tiêu

Thiết kế lại toàn bộ processing cards trong session chat theo hướng **Quiet Intelligence**:

- compact nhưng không mang cảm giác log kỹ thuật;
- có signature riêng khi agent đang hoạt động;
- mọi card có cùng hệ phân cấp, chiều rộng và motion;
- danh sách activity dài cuộn bên trong thay vì kéo dài toàn trang;
- tổng thời gian group đang chạy cập nhật live, group hoàn tất đóng băng;
- không làm mất, đổi thứ tự hoặc sửa dữ liệu tool/reasoning hiện có.

## 2. Phạm vi

### 2.1. Trong phạm vi

- activity group và các reasoning/tool row bên trong;
- standalone tool cards, gồm neutral/unknown/MCP;
- Plan/Todo/Exit Plan cards;
- Diff/Edit cards;
- Question/request-user-input cards;
- permission cards và action tray;
- Task/Agent/Skill cards đang đứng riêng;
- dark/light theme, responsive, keyboard và reduced motion;
- presentation-derived duration và scroll behavior.

### 2.2. Ngoài phạm vi

- `ChatBlock`, normalize/reducer, persistence, Hub, CLI, API, database;
- tool execution, permission payload, question answers hoặc RPC;
- allowlist/grouping/boundary rules đã duyệt;
- plan identity hoặc gom nhiều `update_plan` thành một plan;
- nội dung renderer của Terminal, Diff, Apply Changes, Plan và dialog chi tiết;
- user/system/agent text, Team mention, Mermaid và terminal session UI.

## 3. Nguồn chuẩn và nguyên tắc không mất dữ liệu

Mockup chuẩn là bản **Quiet Intelligence + live total + natural-case text** tại đường dẫn trên.

Mockup quyết định:

- visual hierarchy, density, surface, tone, radius và motion;
- activity body có internal scroll;
- running group có live elapsed ở mép phải;
- system/provider text không bị ép uppercase;
- standalone processing cards cùng `max-width: 600px`.

Code hiện tại tiếp tục quyết định:

- block classification và boundary;
- title/subtitle thực từ provider/`knownTools`;
- input/result, permission actions, dialog và output renderer;
- thứ tự stream, block ID và trạng thái tool.

Không hard-code các nội dung minh họa như `GitNexus · Impact analysis`. UI thực dùng title/subtitle hiện có; tool không nhận diện được vẫn dùng fallback hiện có.

## 4. Activity group

### 4.1. Kích thước và scroll

- `width: 100%`, `max-width: 600px`.
- Header nằm ngoài vùng cuộn và luôn nhìn thấy khi group mở.
- Body dùng `max-height: min(420px, 55vh)` và `overflow-y: auto`.
- Scroll chỉ xuất hiện khi nội dung vượt ngưỡng; hỗ trợ wheel, trackpad, keyboard và touch.
- Scrollbar mảnh, tương phản thấp nhưng vẫn nhìn thấy; không ẩn khả năng cuộn hoàn toàn.
- Dùng `overscroll-behavior: contain` để không giật cả trang khi tới cuối danh sách.
- Không virtualize hoặc unmount row: mọi activity vẫn tồn tại đúng một lần trong DOM và đúng thứ tự.
- Terminal/Diff output mở rộng vẫn giữ `max-height: 300px`, cuộn riêng và toàn bộ chiều rộng bên trong group.

### 4.2. Header

Running header:

```text
caret · N activities running · live                       21m 04s
```

Completed header:

```text
caret · N activities completed                            34.1s
```

- Running surface có ambient top edge và spotlight rất nhẹ.
- `live` dùng lowercase, pulse chỉ mang tính trang trí và `aria-hidden`.
- Completed surface không còn animation/glow.
- Không thêm title summary, timestamp phụ hoặc badge khác.
- Header vẫn là semantic button với `aria-expanded`, `aria-controls`, focus-visible và keyboard support.

### 4.3. Activity row

- Chiều cao mục tiêu khoảng `37px`, padding ngang `8px`, radius `11px`.
- Row mặc định không có border riêng.
- Row hiện hành dùng background gradient rất nhẹ và inner highlight; không tạo card lồng card.
- Thứ tự vùng phải giữ nguyên: duration → status → output control nếu có.
- Title/subtitle/command giữ natural case; không dùng `uppercase` hoặc letter-spacing cưỡng ép.
- Monospace chỉ dành cho command, path và duration; reasoning/title dùng font giao diện.
- Completed status yên tĩnh; running state có ring/pulse nhẹ, không gây live-region spam.
- Reasoning disclosure, Terminal/Diff expansion và Apply Changes file summary giữ nguyên hành vi.

## 5. Duration

Phần này thay thế quy tắc “running group ẩn total” trong design activity-group trước.

### 5.1. Group total

Không cộng duration của từng activity.

```text
running total   = now - first.startedAt
completed total = last.completedAt - first.startedAt
```

- `first.startedAt`, `now` và `last.completedAt` phải là số hữu hạn, không âm.
- Running total chỉ hiện khi `now >= first.startedAt`.
- Completed total chỉ hiện khi `last.completedAt >= first.startedAt`.
- Khi activity mới append vào cùng group, count và latest state cập nhật nhưng mốc đầu không reset.
- Running total cập nhật mỗi giây.
- Khi group hoàn tất, total đóng băng tại `last.completedAt` và không tăng tiếp.
- Nếu activity đầu là generic reasoning không có `startedAt` đáng tin cậy, total để trống; không dùng `createdAt` để suy đoán.
- Nếu completed group kết thúc bằng generic reasoning không có `completedAt`, total để trống.

### 5.2. Per-activity duration

- Tool/`CodexReasoning` completed: `completedAt - startedAt`.
- Tool/`CodexReasoning` running: `now - startedAt`, cập nhật mỗi giây.
- Pending thiếu `startedAt` và generic reasoning thiếu timing: không hiện duration.
- Quy tắc exact timestamp hiện tại giữ nguyên.

### 5.3. Định dạng

Visible compact format:

- dưới 60 giây: `<0.1s`, `4.6s`, `59.9s`;
- từ 60 giây đến dưới 1 giờ: `21m 04s`;
- từ 1 giờ trở lên: `1h 05m`.

Accessible text dùng locale hiện tại và đơn vị tự nhiên; activity duration và group total tiếp tục có nhãn khác nhau.

## 6. Standalone processing cards

### 6.1. Shell chung

- Tất cả standalone processing cards dùng `width: 100%`, `max-width: 600px`.
- Target height compact: khoảng `52px` khi không có body/action tray.
- Radius khoảng `15px`; một border tương phản thấp; surface gradient rất nhẹ.
- Hover trên pointer device: lift tối đa `1px`; không thay đổi layout.
- Focus-visible rõ ràng; toàn bộ action vẫn dùng semantic button.
- Không làm card full-width theo viewport.

### 6.2. Context orb và tone

Icon container chuyển thành orb tròn khoảng `31px`:

| Nhóm | Tone |
|---|---|
| Neutral/tool/MCP/Task/Agent/Skill | cool indigo |
| Plan/Todo/Exit Plan | violet |
| Question/request input | blue/cyan |
| Permission | amber |
| Diff/Edit/Apply Changes | tone diff hiện có, làm dịu theo cùng hệ surface |
| Error | red semantic hiện có, không thêm glow trang trí |

Màu chỉ hỗ trợ nhận diện; title và accessible name vẫn truyền đủ ý nghĩa khi không nhìn thấy màu.

### 6.3. Nội dung từng card

- Title/subtitle lấy từ presentation registry hiện tại; không đổi provider title.
- Plan giữ progress và checklist renderer; compact header có progress + `completed/total` khi dữ liệu đủ.
- Question giữ trạng thái waiting/answered và toàn bộ câu hỏi/answer hiện có.
- Permission giữ heading, reason và payload của `Deny`, `Allow once/session`; action tray dùng pill buttons nhưng không đổi logic.
- Diff/Edit/Apply Changes giữ output/full view/dialog hiện tại.
- Unknown tool không được đổi tên thành một category suy đoán.

## 7. Theme và motion

- Production implementation dùng app design tokens; mockup dark không được chuyển thành màu hard-code trong component.
- Light theme giữ cùng hierarchy, giảm shadow/glow và dùng border rõ vừa đủ trên nền sáng.
- Running-only motion gồm ambient edge, subtle sweep hoặc pulse; duration text không animate theo chiều rộng.
- Mở/đóng dùng transition ngắn, không làm nội dung nhảy layout ngoài card.
- `prefers-reduced-motion: reduce` tắt sweep, pulse, lift và transition không cần thiết.
- Không dùng blur/backdrop-filter nặng làm giảm hiệu năng trên mobile.

## 8. Accessibility và i18n

- Không ép uppercase cho system/provider/command text.
- Mọi system label đi qua dictionary `en`, `vi-VN`, `zh-CN`.
- Provider title và command giữ nguyên nội dung/case.
- Scroll region có tên truy cập phù hợp khi cần và vẫn truy cập được bằng keyboard.
- Duration nhìn thấy compact nhưng accessible duration bản địa hóa đầy đủ.
- Live duration không dùng `aria-live` và không tự thông báo mỗi giây; giá trị mới được đọc khi người dùng focus/điều hướng tới disclosure.
- Decorative glow/orb/pulse dùng `aria-hidden`.
- Không tạo nested interactive element.
- Permission/question buttons giữ hit target tối thiểu hiện tại, kể cả khi visual nhỏ hơn.

## 9. Streaming và cập nhật muộn

Phải giữ đúng khi:

1. group chạy và duration tick mỗi giây;
2. activity mới append vào group;
3. group running chuyển completed;
4. boundary làm tách group;
5. late error/permission/children làm activity rời group;
6. pagination prepend hoặc component remount;
7. locale/theme đổi trong lúc session đang mở.

Trong mọi trường hợp:

- block ID, DOM order và nội dung không đổi;
- không duplicate hoặc mất activity;
- scroll chỉ thay viewport hiển thị, không thay dữ liệu;
- elapsed không reset nếu group ID/first activity không đổi;
- completed elapsed đóng băng.

## 10. Kiểm thử chấp nhận

### 10.1. Timing

- Running group có first `startedAt` hợp lệ hiển thị live total và tăng qua ít nhất hai tick 1 giây.
- Append activity mới không reset total.
- Completed group dùng `last.completedAt - first.startedAt` và đóng băng sau clock tick tiếp.
- Không timestamp biên, `NaN`, vô cực, âm hoặc end trước start đều ẩn total.
- Không cộng per-activity duration.
- Format coverage: `<0.1s`, giây thập phân, phút/giây và giờ/phút trong ba locale.

### 10.2. Layout và scroll

- Group/card `max-width: 600px`.
- Group body có responsive max-height và vertical scroll; header không nằm trong scroller.
- 46 activity vẫn render đúng 46 ID, đúng thứ tự, mỗi ID một lần.
- Output Terminal/Diff vẫn `max-height: 300px` và mở toàn chiều rộng nội bộ.
- Standalone neutral/plan/diff/question/permission cards cùng shell compact; action/body đặc biệt vẫn đầy đủ.
- Không có class ép uppercase trên processing content.

### 10.3. Regression

- Permission actions gửi payload không đổi.
- Question answers, plan checklist, diff/apply/terminal renderer và dialog không đổi logic.
- Group boundary, collision fallback, copy behavior và stable IDs tiếp tục pass.
- Dark/light visual QA ở desktop và mobile.
- Focus/keyboard/reduced-motion checks.
- Full web tests, typecheck, production build và `git diff --check`.

## 11. Rủi ro và kiểm soát

| Rủi ro | Kiểm soát |
|---|---|
| Live total sai hoặc reset khi append | Pure timing model + fake timers + stable group ID test |
| Scroll làm người dùng tưởng mất activity | Header count + visible scrollbar + DOM count/order assertions |
| Nested scroll Terminal/Diff khó điều khiển | `overscroll-contain`, output cap 300px, touch/wheel QA |
| Redesign làm hỏng permission/question action | Không đổi renderer/payload; regression tests hiện có |
| Mockup dark làm light theme kém tương phản | Dùng app tokens + light-theme visual QA |
| Motion gây khó chịu hoặc tốn tài nguyên | Running-only, CSS nhẹ, reduced-motion, không backdrop blur nặng |
| Sửa lan sang dữ liệu/backend | Diff scope chỉ `web` presentation/tests và docs artifact/spec/plan |

## 12. Tiêu chí hoàn thành

1. UI bám sát mockup Quiet Intelligence đã duyệt trong cả hierarchy và density.
2. Mọi processing card tối đa 600px và không còn standalone card kéo full viewport.
3. Danh sách activity dài cuộn nội bộ, header cố định, không mất dữ liệu.
4. Running total cập nhật live; completed total đóng băng; không cộng duration từng item.
5. Text giữ natural case; duration dài dễ đọc và accessible/i18n đúng.
6. Tool/Plan/Question/Permission/Diff giữ nguyên logic và nội dung.
7. Streaming, late update, pagination và remount không mất/lặp/reset sai.
8. Focus, keyboard, reduced motion, dark/light và responsive đạt.
9. Focused tests, full web tests, typecheck, build và diff check đều pass.
