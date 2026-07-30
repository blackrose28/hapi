# Mobile Adaptive Dialogs Design

**Ngày:** 2026-07-29  
**Trạng thái:** Đã duyệt visual, chờ duyệt spec  
**Mockup đã duyệt:** `.superpowers/brainstorm/3005493-1785296133/content/mobile-modal-patterns.html`

## 1. Mục tiêu

Mở rộng hệ thống `AppDialog` hiện có để modal tự thích nghi với mobile theo bản chất tác vụ:

- `alert`: quyết định ngắn, hiển thị giữa màn hình;
- `sheet`: tác vụ ngắn, trượt từ cạnh dưới và giữ bối cảnh phía sau;
- `workspace`: tác vụ dài hoặc nhiều tương tác, chiếm toàn màn hình mobile.

Desktop giữ cách hiển thị dialog giữa màn hình hiện tại. Mobile không còn dùng một card desktop thu nhỏ cho mọi trường hợp.

Spec này mở rộng thiết kế `2026-07-23-hapi-app-dialog-design.md`. Các quy tắc chung về Radix Dialog, focus, theme, header, footer và close semantics vẫn được giữ, trừ phần responsive được định nghĩa lại tại đây.

## 2. Ba kiểu trình bày

### 2.1. Alert

Dùng cho:

- xác nhận đóng terminal;
- xác nhận xoá, archive hoặc hành động nguy hiểm;
- rename và form rất ngắn;
- các quyết định chỉ có một bước.

Hành vi:

- card giữa màn hình trên cả mobile và desktop;
- chiều cao theo nội dung, có giới hạn để không tràn viewport;
- không có nút Back;
- dùng `Cancel`, nút đóng hoặc hành động xác nhận theo nghiệp vụ hiện tại;
- hành động nguy hiểm có visual destructive rõ ràng.

### 2.2. Sheet

Dùng cho:

- Session Task List;
- Replace Pin;
- danh sách lựa chọn hoặc thông tin ngắn cần giữ bối cảnh màn hình cha.

Hành vi mobile:

- neo sát đáy, rộng toàn bộ viewport;
- chỉ bo hai góc trên;
- cao theo nội dung, tối đa khoảng `82dvh`;
- có grabber, header cố định và body cuộn độc lập;
- đóng bằng nút X hoặc chạm backdrop nếu modal cho phép dismiss;
- chưa triển khai thao tác kéo/vuốt để đóng trong phiên bản đầu.

Trên desktop, các sheet vẫn hiển thị như dialog giữa màn hình.

### 2.3. Workspace

Dùng cho:

- Terminal;
- Files;
- Browser;
- Settings;
- Direct Chat;
- các modal dài như Diff hoặc tool output khi cần toàn bộ diện tích mobile.

Hành vi mobile:

- chiếm `100dvw × 100dvh`;
- không bo góc, không để khoảng trống ngoài surface;
- header cố định, body nhận toàn bộ diện tích còn lại;
- dùng safe-area cho phần trên và dưới;
- body là scroll owner; không làm cả trang phía sau cuộn;
- tác vụ mở từ màn hình cha dùng nút Back ở đầu header;
- Back trả người dùng về đúng màn hình cha và giữ nguyên bối cảnh cha.

Trên desktop, workspace vẫn là dialog giữa màn hình với width/height hiện có.

## 3. Ngữ nghĩa Close và Back

Không đổi X thành mũi tên chỉ để trang trí.

### Close

- kết thúc hoặc huỷ surface hiện tại;
- dùng cho alert, sheet và bước đầu của flow độc lập;
- ví dụ: đóng Task List, huỷ New Session, đóng confirm.

### Back

- quay về màn hình cha hoặc bước trước;
- dùng cho Terminal, Files, Settings, Direct Chat và Browser khi được mở từ một context khác;
- Browser mở từ New Session phải quay lại form New Session và giữ dữ liệu form;
- điều hướng thư mục bên trong Browser/Files không dùng chung nút Back cấp workspace.

Back trên header và hành vi Back của trình duyệt/Android phải dẫn tới cùng một context. Nếu workspace được mở trực tiếp mà không có context cha hợp lệ, fallback là đóng workspace và trở về route nền an toàn.

## 4. Component contract

`AppDialogContent` nhận kiểu trình bày có ngữ nghĩa:

```tsx
type AppDialogPresentation = 'alert' | 'sheet' | 'workspace'

<AppDialogContent presentation="workspace">
    <AppDialogHeader
        mobileNavigation="back"
        onMobileBack={handleCloseWorkspace}
        title="Terminal"
        subtitle={path}
    />
    <AppDialogBody>{/* feature content */}</AppDialogBody>
</AppDialogContent>
```

Quy ước:

- `presentation` bắt buộc tại các feature dialog sau migration;
- mặc định tạm thời là `alert` để migration không làm hỏng caller cũ;
- `mobileNavigation` có giá trị `close` hoặc `back`, mặc định `close`;
- desktop luôn dùng close button hiện tại, kể cả workspace;
- `onMobileBack` chỉ cần truyền khi navigation là `back`;
- feature vẫn sở hữu nội dung, width desktop, actions và nghiệp vụ;
- component chung sở hữu mobile positioning, radius, viewport, safe-area và animation.

## 5. Header và touch target

- Close/Back có hit-area tối thiểu `44 × 44px` trên mobile.
- Icon và outline bên trong vẫn giữ visual nhỏ, không biến thành nút thô.
- Title/subtitle tiếp tục truncate và không đè lên meta/actions.
- Workspace Back nằm đầu header trên mobile.
- Desktop close button vẫn nằm cuối header.
- Header và footer không cuộn cùng body.

## 6. Viewport, keyboard và safe-area

- Mobile dùng `dvh`, không dùng `vh` làm nguồn chiều cao chính.
- Full-screen workspace dùng `height: 100dvh`.
- Sheet dùng `max-height` theo `dvh`.
- Áp dụng `env(safe-area-inset-top)` và `env(safe-area-inset-bottom)`.
- Khi bàn phím ảo mở, input đang focus và action liên quan phải còn nhìn thấy.
- Terminal tiếp tục sở hữu logic resize/focus riêng; `AppDialog` không tự focus terminal.

## 7. Mapping migration

| Nhóm | Presentation mobile | Navigation chính |
|---|---|---|
| Confirm, Rename, terminal/tab close | `alert` | Close/Cancel |
| Session Task List, Replace Pin | `sheet` | Close |
| Terminal, Files, Settings, Direct Chat | `workspace` | Back |
| Browser | `workspace` | Back về caller |
| New Session | `workspace` | Close/Cancel ở bước đầu |
| Diff, CLI output, Tool details dài | `workspace` | Back/Close theo caller |
| Form/dialog cục bộ ngắn còn lại | `alert` | Giữ semantics hiện tại |

Không ép các panel nổi như Terminal Search/Snippets thành dialog; chúng tiếp tục là anchored panels.

## 8. Luồng chính

### Terminal

```text
Session → mở Terminal → workspace toàn màn hình
→ Back → Session còn nguyên trạng thái
```

### Task List

```text
Session → mở badge task → sheet xuất hiện
→ X hoặc backdrop → sheet đóng → Session không đổi
```

### Close Terminal

```text
Terminal → yêu cầu đóng tab → alert
→ Cancel: quay lại terminal
→ Close terminal: dừng process và xoá tab
```

### New Session và Browser

```text
New Session → chọn Browser → Browser workspace
→ Back → New Session giữ dữ liệu đã nhập
→ chọn thư mục → quay lại New Session với thư mục mới
```

## 9. Accessibility

- Giữ Radix focus trap, overlay inert và scroll lock.
- Dialog luôn có accessible title.
- Khi đóng, focus trở về trigger hoặc phần tử hợp lý tiếp theo.
- Close/Back luôn có accessible label đúng hành vi.
- `Escape` trên desktop giữ contract hiện tại.
- Không thêm gesture là cách duy nhất để đóng sheet.
- Reduced motion phải giảm hoặc bỏ animation trượt/zoom.

## 10. Rủi ro và kiểm soát

### Back không đúng context

**Rủi ro:** Browser hoặc workspace mở từ nhiều nơi có thể trả về sai màn hình.

**Kiểm soát:** dùng một contract return-context chung; có fallback khi deep-link; test từng caller chính.

### Keyboard che nội dung

**Rủi ro:** `100vh` và body scroll sai khiến form hoặc terminal bị che.

**Kiểm soát:** dùng `dvh`, một scroll owner, safe-area và test với viewport có bàn phím.

### Migration làm đổi desktop

**Rủi ro:** class responsive mới ghi đè width/height desktop.

**Kiểm soát:** presentation chỉ đổi positioning dưới breakpoint mobile; regression test class và screenshot/smoke test desktop.

### Nested modal

**Rủi ro:** alert xuất hiện trên workspace có thể gây focus hoặc z-index lỗi.

**Kiểm soát:** chỉ cho phép confirmation alert chồng workspace; không cho sheet chồng sheet hoặc workspace chồng workspace.

## 11. Phạm vi không thay đổi

- Không đổi API, hub, CLI, database hoặc session protocol.
- Không khôi phục route Terminal cũ.
- Không đổi lifecycle terminal, task, file hoặc message.
- Không thêm swipe-to-dismiss trong phiên bản đầu.
- Không thay Search/Snippets anchored panels.
- Không đổi visual desktop ngoài việc tăng vùng bấm vô hình khi cần cho accessibility.

## 12. Kiểm chứng tối thiểu

### Component tests

- Ba presentation tạo đúng mobile class và giữ desktop class.
- Workspace dùng Back trên mobile, Close trên desktop.
- Sheet có grabber, bottom positioning và giới hạn `dvh`.
- Touch target, accessible label, focus trap và dismissible contract đúng.

### Regression flows

- Terminal Back về Session và không dừng terminal.
- Task List đóng/mở mà không mất session state.
- Close Terminal chỉ dừng process sau xác nhận.
- New Session → Browser → Back giữ form.
- Light/dark, portrait/landscape và viewport nhỏ không tràn.

### Project checks

- Focused web tests.
- Full web tests.
- Web typecheck.
- Production build.
- `git diff --check`.

## 13. Tiêu chí hoàn tất

- Mobile modal dùng đúng `alert`, `sheet` hoặc `workspace`.
- Terminal khớp mockup full-screen và Back về Session.
- Task List khớp mockup bottom sheet.
- Close Terminal khớp mockup alert.
- Desktop giữ layout hiện tại.
- Không còn feature tự viết positioning mobile cho các dialog đã migrate.
- Test, typecheck và build đạt.
