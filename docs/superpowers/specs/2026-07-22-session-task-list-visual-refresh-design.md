# Session Task List Visual Refresh Design

**Ngày:** 2026-07-22
**Trạng thái:** Đã duyệt hướng thiết kế
**Hướng chọn:** Minimal Timeline

## 1. Mục tiêu

Làm task control trong session header mỏng, rõ vai trò trạng thái và dễ nhận biết hơn. Modal task chuyển từ các card đen nặng sang timeline nhẹ, có màu trạng thái và khoảng thở rõ giữa progress với danh sách.

Không thay đổi dữ liệu `session.todos`, vòng đời task hoặc adapter provider.

## 2. Vấn đề hiện tại

- Counter `6/6` nằm trong nhóm action nên bị hiểu như một nút công cụ rời.
- Icon checkbox và kích thước nút tạo cảm giác thô.
- Modal gần như đen tuyền, thiếu phân lớp thị giác.
- Progress bar nằm sát danh sách task.
- Mỗi task là một card viền lớn nên modal nặng và dày.

## 3. Header badge

### 3.1 Vị trí

- Header compact/pinned: badge task nằm ngay sau badge provider và trước membership/action.
- Header thường: badge task nằm cùng cụm metadata, ngay sau provider; bỏ task control khỏi nhóm action bên phải.
- Không có task hoặc snapshot rỗng: không render badge.
- Snapshot hoàn thành toàn bộ vẫn render.

```text
● Session title   [codex] [● 6/6]          [actions]
```

### 3.2 Hình thức

- Cao `20px`.
- Padding ngang `7px`, gap `5px`.
- Radius `6px`, border `1px`.
- Font `10px`, weight `700`.
- Nền `#20252d`, viền mặc định `#3c4655`, chữ `#c6d0df`.
- Không dùng checkbox glyph; dùng dot trạng thái `5px` và counter `completed/total`.

### 3.3 Màu trạng thái động

Thứ tự ưu tiên:

1. Có `in_progress`: tím `#8c7dff`, glow nhẹ.
2. Không có `in_progress` nhưng còn `pending`: vàng `#d7a34a`.
3. Tất cả `completed`: xanh `#46d39a`.

Task đang chạy dùng pulse opacity/glow nhẹ khoảng `1.8s`. Khi `prefers-reduced-motion: reduce`, animation bị tắt.

Hover chỉ đổi border/nền trong `150ms`; không scale hoặc di chuyển layout.

## 4. Modal Minimal Timeline

### 4.1 Surface và bố cục

- Width: `calc(100vw - 24px)`, tối đa khoảng `440px`.
- Nền `#181c21`, border `#2b3038`, radius `14px`.
- Shadow mềm; không dùng nền đen tuyệt đối.
- Padding `16–18px`.
- Giữ title, description, close button và Dialog accessibility hiện có.

### 4.2 Progress

- Progress nằm trong vùng riêng dưới header.
- Margin trên khoảng `14px`; khoảng cách từ progress tới timeline `16–18px`.
- Có dòng `Tiến độ phiên` và phần trăm ở hai đầu.
- Bar cao `4px`, nền `#2c313b`.
- Fill dùng màu trạng thái hiện tại; width transition khoảng `240ms` và tắt khi reduced motion.

### 4.3 Timeline task

- Bỏ card viền bao quanh từng task.
- Dùng đường timeline dọc `1px` và dot `14px`.
- Mỗi row cao tối thiểu khoảng `48px`, có divider mảnh hoặc spacing nhẹ.
- Completed: dot xanh và dấu check.
- In progress: dot tím, ring/glow nhẹ.
- Pending: dot xám/vàng dịu, không glow.
- Status text giữ bản dịch hiện có và dùng màu tương ứng.
- Hover row dùng nền xám rất nhẹ, không thay đổi kích thước.
- Giữ nguyên thứ tự snapshot.

## 5. Mobile

- Kiểm chứng ở viewport rộng `320px` và `375px`.
- Badge provider + task là một cụm không tách rời; badge task `shrink-0`.
- Tên session được truncate trước khi badge/action bị đẩy khỏi viewport.
- Header metadata được phép wrap có kiểm soát; không chồng action.
- Modal cách mép màn hình `12px`.
- Danh sách có `max-height` theo viewport, `overflow-y: auto`, `overscroll-behavior: contain`.
- Nội dung task dài dùng `min-width: 0` và `overflow-wrap`/`break-words`.
- Close button và vùng bấm badge vẫn đủ kích thước thao tác dù hình thức badge chỉ cao `20px`.

## 6. Hành vi và accessibility

- Click badge mở modal hiện có.
- Trigger giữ `aria-label` đầy đủ, ví dụ `Công việc trong phiên: 6 trên 6 đã hoàn thành`.
- Modal giữ accessible title/description, focus trap, Escape close và trả focus.
- Progress giữ `role="progressbar"` và các giá trị min/max/now.
- Timeline icon trang trí dùng `aria-hidden`; status text vẫn đọc được.
- Mọi copy tiếp tục qua i18n English, Vietnamese và Simplified Chinese.

## 7. Không thuộc phạm vi

- Không sửa `session.todos`, Hub, CLI hoặc provider adapter.
- Không thêm edit, clear, refresh, stale detection hoặc task history.
- Không đổi modal thành route/page riêng.
- Không thêm dependency UI hoặc animation mới.
- Không refactor các action khác trong `SessionHeader`.

## 8. Kiểm chứng

### Automated

- Badge nằm sau provider ở normal và compact header.
- Badge không còn trong action group.
- Empty snapshot ẩn; full-completed vẫn hiện.
- Active/pending/completed chọn đúng state class.
- Modal giữ order, đủ status, progress ARIA, i18n và focus behavior.
- CSS regression khóa badge dimensions, modal surface, progress spacing, timeline và reduced motion.

### Visual

- Render compact header và modal ở desktop gần viewport ảnh gốc.
- Render mobile ở `320px` và `375px`.
- Chụp ảnh sau implement; so sánh layout, density, spacing, màu, overflow và vùng bấm.
- Chỉ báo hoàn thành sau khi visual match đạt mức chấp nhận và typecheck/tests pass.

## 9. Tiêu chí hoàn thành

1. Task badge đứng cạnh provider ở cả normal và compact header.
2. Badge slim, không lẫn với action và không chồng layout.
3. Badge đổi màu theo trạng thái task, animation tôn trọng reduced motion.
4. Progress và timeline có khoảng cách rõ ràng.
5. Modal không dùng nền đen tuyền và không còn card box nặng.
6. Desktop, `320px` và `375px` không tràn hoặc che action.
7. Accessibility, i18n, typecheck và test liên quan đều đạt.
