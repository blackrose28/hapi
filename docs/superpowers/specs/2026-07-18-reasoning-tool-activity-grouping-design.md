# Reasoning And Tool Activity Grouping Design

**Ngày:** 2026-07-18
**Trạng thái:** Đã duyệt
**Phạm vi:** Chỉ web presentation

**Visual source of truth:** `docs/superpowers/artifacts/2026-07-18-reasoning-tool-activity-grouping-mockup.html`

## 1. Mục tiêu

Hiển thị reasoning và các tool thao tác thông thường liền kề như một chuỗi hoạt động thống nhất của agent. Người dùng có thể thu gọn cả chuỗi, mở lại để xem đúng toàn bộ diễn biến, trong khi text trả lời và các card đặc biệt vẫn là ranh giới rõ ràng.

Ví dụ:

```text
Reasoning → Terminal → Diff → Reasoning → Apply Changes
                         ↓
                Một nhóm “5 hoạt động”
```

Thay đổi chỉ tác động cách biểu diễn tại frontend. Không thay đổi dữ liệu gốc, thứ tự stream hoặc logic nghiệp vụ.

## 2. Nguyên tắc bắt buộc

1. Mỗi `ChatBlock` phải xuất hiện đúng một lần và đúng thứ tự.
2. Không tạo, xoá, lọc hoặc sửa `ChatBlock` trong reducer.
3. Không đổi CLI, Hub, API, database, schema hoặc giao thức đồng bộ.
4. Text trả lời của agent không nằm trong box và luôn ngắt nhóm hoạt động.
5. Card đặc biệt đứng riêng và luôn ngắt nhóm.
6. Nhóm chỉ tồn tại khi có ít nhất hai hoạt động hợp lệ liền kề.
7. Singleton reasoning và singleton tool giữ cách hiển thị compact hiện tại.
8. Không thêm dependency.

## 3. Phân loại block

### 3.1. Thành viên được gom nhóm

| Loại | Tên/nguồn | Cách hiển thị bên trong nhóm |
|---|---|---|
| Reasoning thường | `agent-reasoning` từ Codex không tiêu đề, Claude, Gemini và provider khác | Disclosure reasoning nhỏ, không card |
| Reasoning có tiêu đề | `CodexReasoning` | Disclosure reasoning dùng title hiện có |
| Đọc/tìm kiếm | `Read`, `Grep`, `Glob` | Hàng compact hiện có |
| Terminal | `Bash`, `CodexBash` | Hàng compact; output mở rộng tối đa 300px |
| Thay đổi file | `CodexPatch` | Hàng Apply Changes hiện có; file summary giữ nguyên |
| Diff | `CodexDiff` | Hàng Diff hiện có; diff mở rộng tối đa 300px |

Một thành viên tool chỉ được gom khi đồng thời:

- không ở trạng thái `error`;
- không có permission object;
- không có children;
- thuộc allowlist trên.

`CodexReasoning` lỗi, có permission hoặc có children không dùng disclosure trong nhóm; nó trở lại standalone card để giữ tín hiệu lỗi/đặc biệt.

### 3.2. Ranh giới ngắt nhóm

- `agent-text`;
- `update_plan`, `TodoWrite`, `ExitPlanMode`, `exit_plan_mode`;
- permission và question/request-user-input;
- mọi tool lỗi;
- `Task`, `Agent`, `Skill`;
- MCP, tool không biết, SendMessage/Team và các tool ngoài allowlist;
- tool có children;
- `HapiCliOutput` và mọi `cli-output` thô;
- agent event, Team mention, user message và system message.

`HapiCliOutput` là tên presentation nội bộ cho output CLI thô, không phải `Bash/CodexBash`; nó luôn đứng riêng theo quyết định đã duyệt.

## 4. Hành vi giao diện

### 4.1. Nhóm hoạt động

- `width: 100%`, `max-width: 600px`.
- Header dùng nhãn theo nghĩa “hoạt động”, không còn nhãn chỉ nói “tool/thao tác”.
- Header chỉ có hai vùng: bên trái là count + trạng thái (`5 hoạt động đã hoàn tất`), bên phải là total duration của group khi tính chính xác được (`12.4s`).
- Không hiển thị danh sách title, timestamp phụ, badge khác hoặc status dot trong group header.
- Nếu total duration không đủ dữ liệu để tính chính xác, vùng bên phải để trống.
- Group hoàn tất khi được mount: mặc định đóng.
- Group đang chạy khi được mount: mặc định mở.
- Group đang mở không tự đóng khi chuyển từ running sang completed.
- Mở/đóng bằng chuột, Enter hoặc Space; có `aria-expanded`, `aria-controls`, focus-visible.

### 4.2. Thành viên bên trong

- Giữ nguyên thứ tự stream.
- Reasoning vẫn có disclosure riêng để người dùng chọn đọc chi tiết; không bọc card và không dùng border riêng.
- Tool dùng `group-row` hiện có.
- Thứ tự vùng bên phải của một hàng là: duration chính xác nếu có → status → nút mở output nếu có. Không dành chỗ trống cho activity không có duration.
- Output dài dùng toàn bộ chiều rộng bên trong nhóm, `max-height: 300px`, cuộn dọc/ngang.
- Tool không có meaningful output không có nút mở output inline; dialog chi tiết vẫn hoạt động.
- `CodexPatch` không có output vẫn hiển thị danh sách file hiện có.

### 4.3. Singleton

- Một reasoning đứng riêng: disclosure không box như hiện tại.
- Một tool allowlisted đứng riêng: hàng compact tối đa 600px như hiện tại.
- Không tạo vỏ group chỉ cho một phần tử.

### 4.4. Duration và trạng thái

- Count bao gồm cả reasoning và tool.
- Timestamp đáng tin cậy phải là số hữu hạn, không âm; `completedAt` phải lớn hơn hoặc bằng `startedAt`. Không dùng `createdAt` thay cho `startedAt` để tạo duration "chính xác".
- Activity completed chỉ hiển thị duration khi có đủ `startedAt/completedAt` đáng tin cậy. Activity running chỉ hiển thị elapsed live khi có `startedAt` đáng tin cậy; activity pending chưa có `startedAt` không hiện duration.
- Tool và `CodexReasoning` có đủ timestamp hiển thị duration ở mép phải của hàng, ví dụ `1.8s`.
- Generic reasoning thiếu start/end chuẩn hóa không hiển thị duration; không hiện `0s`, `—` hoặc giá trị ước tính.
- Duration tổng của nhóm là wall-clock elapsed từ activity đầu tiên bắt đầu đến activity cuối cùng hoàn tất.
- Duration tổng chỉ dùng `first.startedAt` và `last.completedAt`; không thay bằng giá trị nhỏ nhất/lớn nhất của các activity ở giữa.
- Duration tổng chỉ hiển thị khi activity đầu và cuối đều có timestamp đáng tin cậy, `last.completedAt >= first.startedAt`. Việc một generic reasoning nằm giữa không làm mất total vì nó vẫn nằm trong khoảng wall-clock đã biết.
- Nếu activity đầu hoặc cuối là generic reasoning thiếu timestamp, ẩn duration tổng thay vì suy đoán.
- Activity đang chạy có `startedAt` hợp lệ cập nhật duration theo clock hiện tại; khi hoàn tất thì đóng băng tại `completedAt`.
- Group đang chạy vẫn để trống total duration cho tới khi activity cuối có `completedAt` đáng tin cậy; chỉ per-activity duration đang chạy được cập nhật live.
- Nhóm được coi là running khi có tool/`CodexReasoning` pending hoặc running. Generic reasoning chỉ làm group running khi part đó là content part cuối cùng của assistant message đang có `status.type === 'running'`; generic reasoning nằm trước một part khác không được giữ group ở trạng thái running.
- Hiển thị duration theo giây với một chữ số thập phân như mockup (`0.7s`, `12.4s`); duration dương dưới `0.1s` hiển thị `<0.1s` để không bị làm tròn thành `0.0s`. Đây chỉ là định dạng presentation từ timestamp chính xác, không phải ước tính nguồn dữ liệu.

## 5. Kiến trúc presentation-only

### 5.1. Adapter reasoning

`agent-reasoning` hiện được convert thành native reasoning part, trong khi assistant-ui chỉ đưa các tool-call part liền kề qua `ToolGroup`. Vì vậy generic reasoning không thể tham gia cùng group bằng cơ chế hiện tại.

Thiết kế mới encode `agent-reasoning` thành một pseudo tool-call **chỉ trong `ThreadMessageLike`**:

```text
ChatBlock(kind=agent-reasoning)
    → ThreadMessageLike tool-call(name=HapiReasoning, artifact=ChatBlock)
    → HapiReasoning renderer
    → ReasoningDisclosure
```

Ràng buộc:

- `ChatBlock` gốc được giữ nguyên trong `artifact`;
- message ID giữ `assistant:${block.id}`; pseudo `toolCallId` dùng `reasoning:${block.id}` để ổn định qua streaming, pagination và remount;
- pseudo part dùng hằng số presentation nội bộ cho `HapiReasoning`, `argsText` rỗng và `result` là reasoning text hiện có; renderer vẫn lấy nguồn chuẩn từ artifact;
- không tạo synthetic `ChatBlock`;
- renderer chỉ nhận artifact khi type guard xác nhận đầy đủ `agent-reasoning`, đồng thời `toolCallId === reasoning:${artifact.id}`;
- nếu provider thật gọi tool trùng tên `HapiReasoning`, renderer phải fallback sang `HappyToolMessage` đúng một lần, giống cơ chế collision-safe của `HapiCliOutput`;
- artifact thiếu/malformed cũng fallback đúng một lần, không biến thành reasoning và không bị gom nhóm;
- assistant copy vẫn chỉ lấy `text` response, không tự đưa reasoning vào clipboard.

Native `ReasoningGroup` được giữ lại cho content native/ngoài adapter và dùng chung `ReasoningDisclosure`, tránh hai UI reasoning khác nhau.

### 5.2. Activity model

Mở rộng pure grouping model từ “tool block” sang “activity entry”:

```ts
type ActivityEntry =
    | { kind: 'reasoning'; block: AgentReasoningBlock }
    | { kind: 'tool'; block: ToolCallBlock }
```

Model chịu trách nhiệm:

- nhận diện strict artifact;
- xác định thành viên hợp lệ hoặc boundary;
- partition các part thành group/single mà không bỏ hoặc lặp offset;
- tạo group ID ổn định từ ID activity đầu tiên để append hoặc running → completed không remount group hiện hữu;
- cung cấp label/running/timing hợp lệ cho từng entry và total timing hợp lệ cho group header.

UI group chỉ render children mà assistant-ui đã tạo; model không tự tạo lại nội dung. Mọi segment phải dùng đúng offset tương ứng trong `ToolGroup` range, kể cả khi một boundary nội bộ tạo hình `group → single → group`. Đây là điểm bảo đảm mỗi content part chỉ render một lần.

### 5.3. Luồng dữ liệu

```text
CLI/provider events
    → ChatBlock[] (không đổi)
    → external message converter
    → presentation parts
    → ToolGroup callback
    → activity partition
    → group hoặc singleton renderer
```

Text, special cards và raw CLI output tạo boundary tại presentation partition; chúng không bị di chuyển khỏi vị trí gốc.

## 6. Streaming và cập nhật muộn

Hệ thống phải giữ đúng nội dung khi:

1. reasoning đang stream rồi Terminal xuất hiện;
2. singleton trở thành group khi activity thứ hai append;
3. group running chuyển completed;
4. tool đổi sang error hoặc nhận permission muộn, làm group tách ra;
5. tool nhận children muộn;
6. trang message cũ được prepend khi pagination;
7. component unmount/remount.

Trong mọi trường hợp:

- ID block không đổi;
- DOM order theo `ChatBlock[]` không đổi;
- không xuất hiện blank assistant message;
- disclosure state có thể reset khi remount nhưng dữ liệu không được mất hoặc lặp.
- generic reasoning cũ không được chuyển lại thành "đang chạy" chỉ vì toàn assistant message vẫn running và đã có part mới đứng sau nó.

## 7. I18n và accessibility

Bổ sung/đổi label trong cả `en`, `vi-VN`, `zh-CN`:

- activities completed;
- activities running;
- toggle activity group;
- activity group duration nếu label hiện tại không còn đúng nghĩa.

Duration hiển thị dạng compact nhưng phải có accessible label đã dịch, ví dụ visible `4.6s` và tên truy cập tương đương “Thời gian xử lý: 4,6 giây”. Group total phải được phân biệt rõ là tổng thời gian, không dùng chung nhãn gây hiểu nhầm với duration của một activity.

Không dịch title do provider tạo. Các label hệ thống phải dùng dictionary, không hard-code trong component.

Mọi disclosure phải:

- dùng semantic `button`;
- liên kết trigger/body bằng `aria-controls`;
- cập nhật `aria-expanded`;
- hỗ trợ keyboard và focus-visible;
- tôn trọng reduced motion;
- không tạo nested interactive element.

## 8. Kiểm thử chấp nhận

### 8.1. Luồng chính

Cho chuỗi:

```text
generic reasoning → CodexReasoning → CodexBash → CodexDiff → CodexPatch
```

Kết quả:

- một group năm hoạt động;
- đúng năm block ID, mỗi ID đúng một lần;
- đúng thứ tự;
- reasoning đọc được đầy đủ;
- Terminal/Diff mở output được;
- Apply Changes giữ file summary.

### 8.2. Boundary matrix

Mỗi boundary sau đặt giữa hai activity phải tạo hai segment độc lập và boundary đứng đúng giữa:

- agent text;
- update_plan;
- permission;
- question;
- error;
- Task/Agent/Skill;
- MCP/unknown;
- tool có children;
- HapiCliOutput;
- event/team mention/user message.

### 8.3. Provider coverage

- Codex titled reasoning (`CodexReasoning`);
- Codex untitled reasoning (`agent-reasoning`);
- Claude thinking normalized thành `agent-reasoning`;
- Gemini/ACP reasoning normalized thành `agent-reasoning`.

### 8.4. Regression

- actual-runtime integration qua `useHappyRuntime`, không chỉ fixture `ChatBlock` trực tiếp vào component;
- append, late error, late permission, late children, pagination prepend và remount;
- singleton reasoning/tool;
- no-output tool;
- per-activity exact duration cho tool/`CodexReasoning`, không duration cho generic reasoning;
- exact group total khi hai activity biên có timestamp, ẩn total khi thiếu timestamp biên;
- total dùng đúng `last.completedAt - first.startedAt`, không dùng min/max của activity ở giữa;
- timestamp `null`, `NaN`, vô cực, âm hoặc completion trước start đều không tạo duration;
- running duration cập nhật rồi đóng băng khi completed;
- generic reasoning chỉ running khi là part cuối của assistant message đang chạy; reasoning cũ trước tool mới không giữ group running;
- provider tool trùng `HapiReasoning` và pseudo artifact malformed đều fallback đúng một lần, đúng thứ tự;
- pseudo reasoning giữ stable message/tool-call ID qua append, pagination và remount;
- header không còn title summary, badge phụ hoặc status dot; per-item duration nằm trước status/output control;
- assistant copy không chứa reasoning và pseudo part không làm xuất hiện blank assistant message;
- output tối đa 300px;
- group tối đa 600px;
- locale coverage;
- full web tests, typecheck, production build và `git diff --check`.

## 9. Phạm vi không thay đổi

- Nội dung và contract của `ChatBlock`;
- normalize/reducer và persistence;
- Hub/CLI/API/database;
- permission/question handling;
- logic thực thi tool;
- `update_plan` checklist UI;
- Diff/Apply Changes/Terminal result renderer;
- Mermaid và các message type khác.

## 10. Rủi ro và kiểm soát

| Rủi ro | Kiểm soát |
|---|---|
| Pseudo tool làm mất reasoning hoặc va chạm provider tool | Strict artifact guard, collision fallback, actual-runtime test |
| Grouping làm đảo/lặp content | Offset-preserving pure partition, block-ID/order assertions |
| Streaming làm group đóng/mở sai | Mount-only default, không auto-close, transition tests |
| Special card bị gom nhầm | Boundary matrix cho từng loại |
| Duration sai khi generic reasoning không có timing | Chỉ hiện duration exact; ẩn duration item hoặc total nếu thiếu timestamp bắt buộc |
| Generic reasoning cũ bị coi là đang stream | Chỉ lấy message running khi reasoning là content part cuối cùng; có transition test |
| Stable ID sai làm remount/mất disclosure state khi append | ID pseudo và group dựa trên block ID ổn định; pagination/remount test |
| Thay đổi lan sang dữ liệu/backend | Diff review chỉ cho web presentation/test; không sửa shared/hub/cli |

## 11. Tiêu chí hoàn thành

Tính năng hoàn thành khi:

1. reasoning mọi provider gom được với các tool allowlisted liền kề;
2. Diff và Apply Changes nằm trong nhóm;
3. HapiCliOutput và mọi special card ngắt nhóm;
4. text vẫn ngoài box;
5. dữ liệu, ID và thứ tự được giữ nguyên;
6. streaming và cập nhật muộn không làm mất/lặp block;
7. UI đúng giới hạn 600px/300px và accessibility/i18n;
8. per-item và total duration chỉ xuất hiện khi tính chính xác được, không có số ước tính;
9. focused tests, full web tests, typecheck và production build đạt.
