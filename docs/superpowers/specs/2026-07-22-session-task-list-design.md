# Session Task List Design

**Ngày:** 2026-07-22  
**Trạng thái:** Đã duyệt thiết kế  
**Phạm vi:** Snapshot checklist mới nhất của một coding session

## 1. Mục tiêu

HAPI hiển thị checklist thực thi hiện tại của một session theo cùng một cách cho Claude Code, Codex, OpenCode và các agent ACP tương lai.

Người dùng nhìn thấy `Tasks 2/5` trong session header. Nhấn vào nút mở một modal riêng để xem toàn bộ task và trạng thái `pending`, `in_progress`, `completed`.

HAPI tiếp tục dùng `session.todos` làm nguồn dữ liệu chuẩn. Không tạo mô hình task, bảng database hoặc lịch sử snapshot mới.

## 2. Không thuộc phạm vi

- Không phát hiện checklist lỗi thời hoặc suy luận tiến độ từ thời gian/nội dung chat.
- Không tự động nhắc agent và không thêm system prompt về việc cập nhật checklist.
- Không clear checklist thủ công.
- Không cho người dùng sửa trạng thái task.
- Không lưu lịch sử checklist riêng; lịch sử raw message vẫn giữ nguyên.
- Không trộn session checklist với `TeamState` hoặc sửa task orchestration của Team.
- Không đưa task từ Claude sidechain/subagent vào checklist của agent chính.
- Không thay đổi semantics của plan proposal như Claude `ExitPlanMode` hoặc Codex plan-mode document.

## 3. Hiện trạng

HAPI đã có:

- `TodoItemSchema`, `TodosSchema` và `Session.todos` trong shared protocol.
- Cột SQLite `sessions.todos` và `todos_updated_at`.
- Hub extractor cho Claude `TodoWrite` cũ và ACP `plan`.
- Session summary tính `completed/total` từ `session.todos`.
- Codex đã chuyển `turn/plan/updated` thành message `plan_update`, nhưng Hub chưa ghi message đó vào `session.todos`.

Khoảng trống:

- Claude Code hiện tại dùng `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`; HAPI chưa project các tool này vào `session.todos`.
- Parser `TaskCreate/TaskUpdate` trong `TeamState` chờ shape khác và không phải session checklist projector.
- ACP handler bỏ qua plan rỗng, nên provider chưa thể clear snapshot bằng `[]`.
- Session header chưa có control xem checklist chi tiết.

Tài liệu provider tham chiếu:

- [Claude Code todo tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)
- [Claude Agent SDK tool schemas](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Codex app-server plan events](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [ACP v1 Agent Plan](https://agentclientprotocol.com/protocol/v1/agent-plan)
- [OpenCode tools](https://opencode.ai/docs/tools/)

## 4. Kiến trúc

```text
Provider message
    → provider adapter
    → SessionTodoUpdate
    → session todo reducer
    → TodosSchema validation
    → sessions.todos replacement
    → session-updated event
    → SessionTaskListControl
```

### 4.1 Ranh giới trách nhiệm

**Provider adapter** chỉ hiểu wire format riêng của provider và trả về update chuẩn.

**Session todo reducer** không biết provider. Reducer nhận snapshot hiện tại và một hoặc nhiều update rồi trả về `TodoItem[]` hoàn chỉnh.

**Persistence** chỉ lưu snapshot hoàn chỉnh đã validate. Web không dựng checklist từ message history hoặc tool card.

**Web control** chỉ đọc `session.todos`, tính tiến độ và render modal.

### 4.2 Update chuẩn nội bộ

```ts
type SessionTodoUpdate =
    | { type: 'replace'; todos: TodoItem[] }
    | { type: 'create'; todo: TodoItem }
    | { type: 'patch'; id: string; changes: Partial<Omit<TodoItem, 'id'>> }
    | { type: 'delete'; id: string }
```

Reducer áp dụng các update trong thứ tự xuất hiện của message:

- `replace`: thay toàn bộ snapshot, giữ thứ tự provider gửi.
- `create`: nối item mới vào cuối; duplicate ID giống hệt là no-op, duplicate ID có dữ liệu khác bị từ chối.
- `patch`: chỉ cập nhật item đã tồn tại và giữ vị trí cũ; unknown ID là no-op.
- `delete`: loại item cùng ID; ID không tồn tại là no-op.

Mỗi message chỉ ghi database một lần sau khi toàn bộ update trong message đã được áp dụng. Snapshot hoặc kết quả reducer giống hệt state hiện tại là no-op: không tăng session `seq` và không phát SSE.

## 5. Mapping provider

| Nguồn | Update chuẩn | Quy tắc |
|---|---|---|
| Claude `TodoWrite` | `replace` | Dùng parser hiện có |
| Claude `TaskCreate` | `create` | Ghép tool call với kết quả thành công; dùng ID native từ result |
| Claude `TaskUpdate` | `patch` hoặc `delete` | Chỉ áp dụng sau tool result không lỗi |
| Claude `TaskList` | `replace` | Parse snapshot từ tool result; `[]` hợp lệ |
| Codex `plan_update` | `replace` | `step → content`, status chuẩn hóa, priority `medium` |
| ACP `plan` | `replace` | Giữ content, priority, status; `[]` hợp lệ |

### 5.1 Claude Task tools

Claude `TaskCreate` input không có task ID. ID xuất hiện trong matching `tool_result` dạng `{ task: { id, subject } }`. Hub dùng `tool_use_id` để tìm tool call tương ứng trong tối đa 200 message liền trước của cùng session. Không ghép được an toàn trong cửa sổ này thì bỏ qua update.

`TaskUpdate` dùng `taskId`; adapter chỉ áp dụng khi result có `success: true` và tool result không mang `is_error`. `status: deleted` chuyển thành `delete`. Các trường hiển thị còn lại chuyển thành `patch`. Update chỉ chứa dependency, owner hoặc metadata là no-op vì UI không dùng các trường đó. Unknown task ID bị bỏ qua để tránh tạo task rỗng.

`TaskList` result là nguồn snapshot mạnh nhất. Output chuẩn là `{ tasks: Array<{ id, subject, status, owner?, blockedBy }> }`. Adapter chấp nhận structured object hoặc chuỗi JSON giải mã thành shape này; text block chỉ được unwrap khi toàn bộ nội dung tạo thành một JSON value. Dạng khác bị từ chối. Snapshot hợp lệ thay toàn bộ state đã tích lũy từ delta.

Mọi item Claude mặc định priority `medium`. `subject` map sang `content`; `activeForm` được giữ nếu có.

Claude message có `isSidechain: true` bị bỏ qua ở cả tool call và tool result. `TaskGet` là thao tác chỉ đọc và không cập nhật checklist.

### 5.2 Codex và ACP

Codex `turn/plan/updated` được CLI lưu vào HAPI dưới synthetic Codex tool call có `name: update_plan` và `input.plan`; Hub adapter đọc đúng stored wire shape này. ACP `session/update: plan` là full snapshot. ACP v1 yêu cầu client thay toàn bộ plan trên mỗi update.

Codex và ACP v1 không đảm bảo task ID. HAPI tạo ID deterministic theo vị trí trong snapshot. Không dùng ID này để merge giữa các snapshot vì `replace` luôn là authoritative.

ACP handler phải forward cả `entries: []`; không được coi empty plan là malformed.

Cam kết generic chỉ áp dụng cho agent tuân theo ACP v1 full-plan snapshot. ACP draft/v2 hoặc operation-based plan cần adapter riêng khi trở thành contract chính thức.

## 6. Persistence và thứ tự cập nhật

- `session.todos` luôn chứa snapshot mới nhất đã validate.
- Snapshot rỗng được lưu là `[]`, không phải dữ liệu lỗi.
- Full snapshot được validate nguyên khối và phải có ID duy nhất. Một entry sai hoặc ID trùng làm toàn update bị từ chối; không lọc từng entry vì có thể làm mất task hoặc biến payload lỗi thành snapshot rỗng.
- `todos_updated_at` tiếp tục ngăn update cũ ghi đè update mới.
- Khi nhiều message được tạo cùng millisecond, Hub tạo timestamp ghi todo tăng đơn điệu so với `todos_updated_at` hiện tại để không làm mất update hợp lệ.
- Session reload đọc trực tiếp snapshot đã lưu.
- Khi `session.todos` chưa tồn tại, backfill replay tối đa 200 message gần nhất theo thứ tự để phục hồi full snapshot và Claude Task delta có đủ call/result trong cửa sổ. Unknown delta bị bỏ qua; full snapshot tiếp theo sẽ tự đồng bộ lại.
- HAPI không đoán thời điểm chuyển từ `TodoWrite` sang `Task*`. Chỉ `replace` từ `TodoWrite`, `TaskList`, Codex hoặc ACP được quyền reset snapshot.

Persistence phân biệt bốn kết quả: `applied`, `unchanged`, `stale`, `error`. Chỉ `applied` phát `session-updated`; `error` được log, còn `unchanged` và `stale` là kết quả bình thường.

Malformed payload, failed/interrupted tool result hoặc unknown task update không thay đổi snapshot hiện tại. Hub ghi log kỹ thuật; Web không hiện cảnh báo vì không có hành động an toàn cho người dùng.

## 7. Giao diện

Tạo component riêng `SessionTaskListControl` và gắn vào cả session header thường lẫn compact header.

### 7.1 Header

- Không có task hoặc snapshot rỗng: không render control.
- Header thường: icon checklist và `Tasks {completed}/{total}`.
- Compact header: icon checklist và `{completed}/{total}`.
- Mobile viewport của header thường: giữ cùng button nhưng ẩn chữ `Tasks` bằng breakpoint, chỉ còn icon và `{completed}/{total}`.
- Snapshot toàn completed vẫn hiển thị, ví dụ `Tasks 5/5`, nếu provider còn giữ snapshot.

### 7.2 Modal

Nhấn control mở modal riêng bằng Dialog pattern hiện có của HAPI.

Modal gồm:

- Tiêu đề `Session tasks`.
- Dòng `{completed} of {total} completed`.
- Thanh tiến độ.
- Danh sách theo thứ tự snapshot.
- Biểu tượng/trạng thái riêng cho pending, in progress và completed.
- Vùng danh sách có chiều cao tối đa, cuộn dọc, wrap nội dung dài và không tràn viewport mobile.

Modal chỉ đọc. Không có refresh, edit, clear hoặc provider badge.

Mọi text đi qua hệ thống dịch hiện có. Trigger có `aria-label`; modal có title/description liên kết đúng, giữ focus trap, đóng bằng Escape và trả focus về trigger theo Dialog primitive hiện có.

## 8. Kiểm chứng

### 8.1 Unit tests

- Claude `TodoWrite` full và empty snapshot.
- Claude TaskCreate success/failure và result không ghép được.
- Claude TaskUpdate đổi status, đổi subject, delete và unknown ID.
- Claude TaskList full/empty/malformed result.
- Claude main-thread được nhận; sidechain call/result bị bỏ qua.
- Codex plan status mapping và full replacement.
- ACP full/empty plan replacement.
- Full snapshot có một entry lỗi bị reject nguyên khối.
- Reducer ordering, patch stability, duplicate/no-op suppression, delete no-op và schema rejection.

### 8.2 Hub integration tests

- Message được lưu trước khi todo projection chạy.
- Update hợp lệ ghi `session.todos` và phát `session-updated`.
- Update lỗi không sửa snapshot và không phát todo update.
- Persistence phân biệt applied/unchanged/stale/error.
- Hai update cùng millisecond vẫn được áp dụng đúng thứ tự.
- Update cũ không ghi đè snapshot mới.
- Backfill ghép được Claude call/result trong cửa sổ và bỏ qua unknown delta ngoài cửa sổ.
- OpenCode integration seam dùng fixture `session/update: plan` lấy từ wire shape thực tế.

### 8.3 Web component tests

- Snapshot undefined/empty không render control.
- Snapshot dở dang render `Tasks 2/5` và mở đúng modal.
- Snapshot completed render `Tasks 5/5`.
- Modal render đúng thứ tự và trạng thái.
- Compact control render `2/5`.
- Mobile label, keyboard close, focus return và nội dung dài không tràn modal.

### 8.4 Commands

Từ repo root:

```bash
bun typecheck
bun run test
```

## 9. Rủi ro còn lại

| Rủi ro | Giảm thiểu |
|---|---|
| Claude tool output thay đổi shape | Parse bảo thủ, validate schema, bỏ qua thay vì ghi sai |
| Tool call/result không ghép được | Dùng `tool_use_id` và recent persisted messages; giữ snapshot cũ nếu không chắc |
| Provider không gửi task event | Không suy đoán; control phản ánh đúng dữ liệu HAPI thực nhận |
| Snapshot provider thay đổi thứ tự | `replace` toàn bộ; không merge bằng synthetic ID |
| Task list dài trên mobile | Modal có vùng cuộn và compact trigger |
| Session cũ có delta nằm ngoài cửa sổ backfill | Bỏ qua unknown delta; chờ full snapshot tiếp theo, không tự dựng task thiếu dữ liệu |
| Chuyển giữa TodoWrite và Task tools không có epoch | Không đoán/reset; full snapshot tiếp theo là điểm đồng bộ authoritative |

## 10. Tiêu chí hoàn thành

1. Claude Code 2.1.217 Task tools cập nhật `session.todos` đúng theo create/update/delete/list.
2. Codex `update_plan`, OpenCode ACP plan và agent tuân theo ACP v1 plan snapshot cập nhật cùng schema.
3. Header hiển thị tiến độ `completed/total`; nhấn mở modal chi tiết.
4. Reload session giữ nguyên checklist mới nhất.
5. Payload lỗi không làm mất hoặc làm hỏng snapshot đang lưu.
6. Claude sidechain/subagent không thay đổi checklist của agent chính.
7. Snapshot trùng không gây database/SSE update thừa.
8. Typecheck và test suite liên quan pass.
