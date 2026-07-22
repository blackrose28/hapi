# Gom nhóm tool an toàn, không mất nội dung chat

## Mục tiêu

Làm luồng thao tác agent gọn hơn bằng cách gom các tool được cho phép và liền kề thành nhóm trình bày. Không làm mất, thay thế, trùng lặp hoặc đảo thứ tự reasoning, text, CLI output, event, team mention hay tool.

## Quy tắc bất biến về dữ liệu

1. `ChatBlock[]` là nguồn dữ liệu duy nhất và phải được truyền nguyên vẹn, đúng thứ tự, vào `useExternalMessageConverter`.
2. Converter hiện có có thể nối nhiều block assistant liên tiếp thành một assistant-ui message gồm nhiều content part. Thiết kế không giả định mapping một `ChatBlock` thành một message.
3. Nhóm chỉ là lớp trình bày quanh các tool-call part đã render. Không tạo synthetic/blank assistant message, không sửa message list hoặc metadata để thay thế nhóm.
4. Sau khi resolver chia nhóm, flatten toàn bộ content-part indices phải đúng tập chỉ mục ban đầu, cùng thứ tự, không thiếu và không trùng.
5. Reasoning, text, CLI output, event và team mention luôn render đúng một lần, đúng vị trí tương đối trong stream. Chúng không bị thu gọn bởi nhóm tool.
6. Không renderer nào được short-circuit toàn bộ assistant message dựa trên merged message metadata. Đường render `cli-output` hiện tại phải chuyển sang cách render an toàn theo part để không che sibling content.
7. Đóng nhóm chỉ ẩn tạm các hàng tool thuộc nhóm đó. Dữ liệu vẫn giữ trong runtime và mở lại được ngay.

## Điểm tích hợp

- Giữ nguyên `useHappyRuntime`, `ChatBlock[]` đầu vào và message conversion contract.
- Thêm `ToolGroup` vào `MESSAGE_PART_COMPONENTS` của `MessagePrimitive.Content`.
- assistant-ui chỉ đưa các tool-call part liền kề vào `ToolGroup`; component dùng `artifact: ToolCallBlock` để chia tiếp thành run đủ điều kiện.
- ToolGroup chỉ bọc/render `children` hiện có. Không dùng lại `activity-group`, không tạo content part rỗng và không chuyển sang `Unstable_PartsGrouped` làm thay đổi `ReasoningGroup` hiện tại.

## Điều kiện được gom

Một nhóm có tối thiểu hai tool. Tool chỉ được gom nếu tên nằm trong allowlist ban đầu:

- `Read`, `Grep`, `Glob`;
- `Bash`, `CodexBash`;
- `CodexPatch` — hiển thị là Apply Changes;
- `CodexDiff` — thành viên đặc biệt, giữ affordance xem diff.

Unknown tool, MCP, Agent, SendMessage, Team tools và mọi tool không nằm trong allowlist mặc định đứng riêng.

Các ranh giới bắt buộc:

- text, reasoning, CLI output, event, team mention hoặc user message;
- khác assistant-ui message/lượt agent;
- `Task`, Plan, permission, câu hỏi/nhập liệu, tool có children;
- tool lỗi hoặc tool bị loại khỏi allowlist.

Nếu một tool không đủ điều kiện nằm giữa các tool-call part, resolver kết thúc run trước đó và bắt đầu xét run mới. Run chỉ có một tool dùng renderer độc lập hiện tại.

## Trạng thái và streaming

- Group ID ổn định dựa trên tool ID đầu tiên của run; không dựa trên index hiển thị.
- Nhóm có tool đang chạy mặc định mở khi mount. Nhóm hoàn tất mặc định đóng khi mount/tải lại phiên.
- Khi trạng thái chuyển từ running sang completed, nhóm không tự đóng và không ghi đè lựa chọn hiện tại của người dùng.
- Khi append tool mới làm singleton thành group, group mới nhận trạng thái mặc định đúng một lần.
- Nếu permission, children hoặc error xuất hiện muộn, tool đó tách thành surface độc lập; mọi content part khác vẫn giữ nguyên và đúng thứ tự.
- Không mở rộng phạm vi để lưu disclosure state qua pagination/prepend. Pagination có thể remount và đưa completed group về mặc định đóng, nhưng tuyệt đối không được làm mất hoặc đảo content part.

## Trình bày đã duyệt

### Nội dung agent và reasoning

- Agent text/markdown nằm trực tiếp trên nền chat, không bọc box.
- Reasoning giữ logic hiện tại: completed mặc định đóng; đang stream tự mở; khi stream kết thúc không tự đóng; người dùng bấm để mở/đóng.
- Nút reasoning đổi thành disclosure nhỏ có nhãn và chevron; bỏ border, background và full-width card. Nội dung reasoning không có box/đường viền dọc, chỉ thụt nhẹ để dễ đọc.

### Nhóm tool

- `width: 100%; max-width: 600px`; màn hẹp co theo chiều rộng khả dụng và giữ `min-width: 0`.
- Header nêu số thao tác, trạng thái, thời lượng và tóm tắt ngắn.
- Mở nhóm hiển thị từng tool thành một hàng gọn, đúng thứ tự gốc.
- Header và các control dùng i18n cho en, vi-VN và zh-CN.

### Mở chi tiết và output

- Tool không có meaningful inline output không có chevron/accordion inline, nhưng vẫn giữ khả năng bấm mở dialog input/raw details hiện tại. Đây là đường truy cập dữ liệu, không phải mở rộng hàng.
- Meaningful inline output gồm: text/log khác rỗng, lỗi, Terminal output, `CodexDiff.unified_diff`, hoặc result có renderer chuyên biệt thực sự hiển thị nội dung.
- `null`, `undefined`, chuỗi chỉ có whitespace, stdout/stderr rỗng hoặc object chỉ dẫn tới “Done/(no output)” không tạo inline accordion.
- Hàng không có accordion nhưng mở dialog vẫn phải dùng semantic button và focus-visible; hàng hoàn toàn không tương tác phải render bằng phần tử không phải button.
- Terminal/Diff/result bung ngay dưới hàng tương ứng, dùng toàn bộ chiều ngang nhóm, `max-height: 300px; overflow: auto`. Code/log giữ format, dòng dài cuộn ngang thay vì ép wrap.

### Apply Changes và Diff

- `CodexPatch` hiển thị số file và danh sách file tác động lấy từ input. Danh sách inline có thể rút gọn, nhưng dialog phải giữ đầy đủ input/raw details.
- Apply Changes thành công mà không có meaningful output không có accordion. Nếu có lỗi hoặc text result thật thì có accordion output.
- `CodexDiff` nằm trong group khi liền kề và luôn có affordance xem diff nếu `unified_diff` hợp lệ.
- Nếu `unified_diff` thiếu/malformed, Diff không có accordion rỗng; dialog input/raw details vẫn truy cập được.

## Accessibility, i18n và responsive

- Group/reasoning/output disclosure có `aria-expanded`, `aria-controls`, keyboard activation và focus-visible.
- Scroll region có accessible label; không tạo nested interactive controls.
- Nhãn nhóm, trạng thái, duration, action, output và aria-label có đủ en, vi-VN, zh-CN.
- Nhãn Reasoning, trạng thái đang stream và aria-label của reasoning disclosure cũng phải có đủ en, vi-VN, zh-CN.
- Trên mobile, group không vượt viewport; hit target tối thiểu phù hợp cảm ứng; code/log cuộn trong vùng riêng, không làm trang cuộn ngang.
- Duration bắt đầu từ `startedAt` sớm nhất. Khi còn tool running, mốc kết thúc là `Date.now()`; khi cả nhóm hoàn tất, dùng `completedAt` muộn nhất. Timestamp thiếu, âm hoặc không hữu hạn thì không hiển thị duration.

## Rủi ro và cách chặn

| Rủi ro | Chặn |
|---|---|
| Mất reasoning/text do đổi message stream | Không đổi converter input/list; ToolGroup chỉ bọc content part; test sequence xen kẽ. |
| CLI output che sibling content | Cấm whole-message early return; thêm integration test CLI xen giữa tool/text. |
| Gom nhầm tool quan trọng | Allowlist bảo thủ; unknown/MCP/special tools mặc định đứng riêng. |
| Tool không output mất đường xem input | Không có accordion nhưng giữ dialog input/raw details. |
| Streaming làm remount/mất trạng thái | Stable group ID, mount-only default, test append và state transitions. |
| Log/diff làm vỡ layout | Group tối đa 600px, output cao tối đa 300px, cuộn dọc/ngang. |

## Kiểm chứng tối thiểu

1. Runtime thật với sequence `reasoning → tools → text → tools → event → cli-output → team-mention`: mọi non-tool content xuất hiện đúng một lần và đúng DOM order; chỉ run đủ điều kiện được nhóm.
2. Flatten content part sau resolver giữ nguyên toàn bộ indices theo đúng thứ tự, gồm cả singleton và nhiều run trong cùng ToolGroup callback.
3. Unknown/MCP/Agent/Task/Plan/permission/question/children/error đứng riêng; allowlist tool được nhóm khi có ít nhất hai phần tử.
4. Append tool, singleton thành group và running → completed/error/permission không làm mất nội dung hoặc tự đóng nhóm người dùng đang xem. Pagination có thể reset disclosure về mặc định nhưng không được làm mất/đảo part.
5. Tool không output không có accordion nhưng dialog input/raw details vẫn mở được; Apply Changes giữ file list; empty/object result không tạo panel rỗng.
6. Diff hợp lệ mở preview; Diff malformed giữ dialog; Terminal output dài mở full chiều ngang group và cuộn sau 300px.
7. Reasoning completed/streaming giữ đúng lifecycle với disclosure không box.
8. Browser check trên phiên thật: text trước/sau nhóm đầy đủ, không blank message, không lỗi console; kiểm tra en/vi/zh, keyboard và mobile.

## Ngoài phạm vi

- Không thay đổi logic agent, hub, persistence, API hay schema dữ liệu.
- Không thay đổi raw content do provider gửi.
- Không gom reasoning/text thành nhóm hoặc card.
- Không mở rộng allowlist ngoài danh sách đã duyệt trong lần triển khai này.
