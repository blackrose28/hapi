# Hapi AppDialog Design

**Ngày:** 2026-07-23  
**Trạng thái:** Đã duyệt và triển khai

## 1. Mục tiêu

Tạo một hệ thống dialog dùng chung ở lớp code để mọi modal trong Hapi có cùng nền tảng và visual, nhưng vẫn giữ nguyên kích thước, nội dung và luồng nghiệp vụ riêng.

Kết quả mong muốn:

- Một component dialog dùng chung thay cho việc mỗi modal tự lắp overlay, surface và header.
- Header, nút đóng, nền, viền, bo góc, shadow, animation và footer có cùng visual.
- Mỗi tính năng vẫn tự quyết định kích thước, body, actions, status và cách cuộn.
- Không thêm route, màn hình đầy đủ, sidebar hay tính năng mới.

## 2. Nguyên tắc đã chốt

### Chuẩn hóa

- Radix Dialog root, portal, overlay, focus trap, scroll lock và phím `Escape`.
- Dialog surface: theme, border, radius, shadow và animation.
- Header anatomy:
  - icon tùy chọn;
  - title;
  - subtitle tùy chọn;
  - status/actions tùy chọn;
  - close button cố định ở cuối.
- Body container và footer visual.
- Light/dark theme.
- Close button:
  - visual outline `28 × 28px`;
  - icon `13px`;
  - hit-area trong suốt `36 × 36px`;
  - có hover, focus-visible và disabled states.

### Không chuẩn hóa

- Không có enum kích thước `sm/md/lg`.
- Không ép width, height, max-width hoặc max-height.
- Không có status, tab, sidebar hay action nghiệp vụ cố định.
- Không tự thêm nút mở trang đầy đủ.
- Không thay đổi nội dung hoặc hành vi nghiệp vụ hiện tại của modal.

## 3. Component contract

Component mới dự kiến đặt tại:

`web/src/components/ui/app-dialog.tsx`

API composition:

```tsx
<AppDialog open={open} onOpenChange={setOpen}>
    <AppDialogContent className="h-[85vh] max-w-3xl">
        <AppDialogHeader
            icon={<TerminalIcon />}
            title="Terminal"
            subtitle={path}
            meta={<TerminalStatus />}
            actions={<FeatureSpecificActions />}
        />

        <AppDialogBody className="p-0">
            <TerminalContent />
        </AppDialogBody>

        <AppDialogFooter>
            <FeatureSpecificButtons />
        </AppDialogFooter>
    </AppDialogContent>
</AppDialog>
```

Quy ước:

- `AppDialogHeader` tự render close button; caller không tự đặt nút đóng khác.
- `closeDisabled` khóa nút đóng khi feature đang thực hiện thao tác không được gián đoạn.
- `dismissible={false}` giữ nguyên các luồng cũ vốn không cho đóng bằng `Escape` hoặc click overlay.
- `icon`, `subtitle`, `meta`, `actions` và footer đều tùy chọn.
- `className` của content/body/footer cho phép modal giữ layout hiện tại.
- Header chịu trách nhiệm truncate title/subtitle và bảo vệ vùng close button.
- Footer không render khi modal không truyền nội dung.

## 4. Visual specification

### Surface

- Dùng các CSS variables hiện có của Hapi.
- Border `1px solid var(--app-border)`.
- Nền `var(--app-bg)`; header dùng `var(--app-subtle-bg)`.
- Radius và shadow thống nhất tại component, không lặp lại trong từng modal.
- Overlay và backdrop thống nhất.

### Header

- Chiều cao cơ sở khoảng `50px`, có thể tăng tự nhiên nếu nội dung cần wrap.
- Title một dòng; subtitle một dòng và truncate.
- Meta/actions nằm trước close button.
- Feature có thể bỏ icon, subtitle, meta hoặc actions nhưng alignment không đổi.

### Close button

- Outline nhẹ, không nổi thành primary action.
- Visual `28 × 28px`; hit-area `36 × 36px`.
- Luôn có accessible label.
- Focus ring nằm trên hit-area, không làm layout nhảy.

### Body và footer

- Body mặc định `min-height: 0` để nested scroll hoạt động.
- Modal tự chọn body padding và scroll owner.
- Footer có divider, nền và spacing chung; buttons vẫn thuộc feature.

## 5. Phạm vi migration

### Modal cấp ứng dụng

- `BrowserModal`
- `NewSessionModal`
- `FilesModal`
- `ReplacePinModal`
- `SettingsModal`
- `TerminalModal`
- `TeamSessionChatModal`

### Dialog cục bộ

- `ConfirmDialog`
- `RenameSessionDialog`
- `SessionGoalControl`
- `SessionTaskListControl`
- `DiffView`
- `CliOutputBlock`
- `ToolCard`
- `LoginPrompt`
- Terminal quick-key/paste dialogs
- Terminal close confirmation
- Editor terminal/tab close confirmations

Migration có thể chia theo nhóm để review dễ hơn, nhưng trạng thái hoàn tất yêu cầu mọi dialog hiện tại dùng chung `AppDialog`.

## 6. Hành vi phải được giữ nguyên

- Open/close trigger và callback.
- Đóng bằng `Escape` hoặc overlay theo contract hiện tại của từng modal.
- Confirm/cancel semantics.
- Form state và submit.
- Terminal lifecycle.
- Focus Session chat behavior.
- Mobile bottom-sheet behavior đang có.
- Kích thước và scroll behavior riêng của từng modal, trừ khi đang là bug được xác nhận riêng.

## 7. Rủi ro và cách kiểm soát

### Rủi ro 1: thay đổi close semantics

Một số modal đóng khi click overlay, số khác có form hoặc destructive action.

**Kiểm soát:** expose Radix event props và giữ cấu hình hiện tại khi migrate; không áp một policy close mới.

### Rủi ro 2: hỏng nested scroll hoặc terminal resize

Modal cao đang có nhiều scroll owner khác nhau.

**Kiểm soát:** `AppDialogBody` chỉ cung cấp `min-height: 0`; caller giữ quyền chọn `overflow`.

### Rủi ro 3: header slot quá rộng đè title hoặc close

Status/actions của Terminal và Focus Session có thể dài.

**Kiểm soát:** title area `min-width: 0`, metadata truncate, actions shrink-safe, close button không co.

### Rủi ro 4: migration thay đổi hành vi ngoài ý muốn

`TeamSessionChatModal` hiện tự triển khai overlay/dialog thay vì Radix.

**Kiểm soát:** migrate layout trước, giữ nguyên data flow và callbacks; thêm regression tests cho từng entry point.

## 8. Kiểm chứng

### Component tests

- Header render đúng với các tổ hợp slot.
- Close button có accessible label, visual size và hit-area đã chốt.
- Footer chỉ render khi có nội dung.
- Caller class names vẫn điều khiển được kích thước/body overflow.
- Light/dark variables không bị hardcode.

### Regression tests

- Mỗi modal render đúng title và một close button.
- Escape/overlay/confirm giữ hành vi hiện tại.
- Terminal mount/resize không bị ảnh hưởng.
- Focus Session gửi tin và đóng modal như trước.
- Mobile bottom sheets giữ vị trí và safe-area.

### Project checks

- Focused web tests.
- Full web typecheck.
- Web/PWA production build.
- `git diff --check`.

## 9. Phạm vi không thay đổi

- Không đổi API, database, protocol hoặc session state.
- Không thêm chức năng Search, Session Context hay Project Workspace.
- Không thêm route full-screen cho Terminal/Files/Session.
- Không đổi nội dung nghiệp vụ, quyền hoặc dữ liệu.
- Không chuẩn hóa kích thước modal.

## 10. Tiêu chí hoàn tất

- Tất cả modal hiện tại dùng chung `AppDialog`.
- Không còn modal tự dựng overlay/surface/header cơ sở.
- Header và close button có visual nhất quán.
- Kích thước và body của từng modal vẫn do feature sở hữu.
- Regression tests, typecheck và build đạt.
