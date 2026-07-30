# Terminal Selection and Search UX

## Mục tiêu

Đồng bộ giao diện chọn text với bubble nhập liệu, làm vùng chọn dễ nhìn và sửa Search trên bàn phím mobile.

## Bubble vùng chọn

- Bubble `Sao chép | Chọn tất cả | Hủy` dùng cùng nền, bo góc, bóng, padding, font và đường phân cách với bubble `Nhập | Enter | Chọn`.
- Vùng chạm của mỗi thao tác vẫn tối thiểu 44px.
- Không thay đổi vị trí bám vùng chọn hoặc vòng đời chọn/copy hiện tại.

## Màu vùng chọn

- Thêm màu selection riêng cho terminal thay vì dùng `--app-subtle-bg` 5%.
- Light và dark đều dùng nền tím/xanh có độ tương phản khoảng 35–40%.
- Text trong vùng chọn vẫn đọc được; không thay đổi màu nền tổng thể của terminal.

## Search

- Trên mobile, panel Search chuyển thành hai hàng:
  - Hàng 1: ô nhập chiếm phần lớn chiều rộng và nút đóng.
  - Hàng 2: số kết quả, `Aa`, kết quả trước và kết quả sau.
- Trên desktop, cùng component hiển thị một hàng trong panel rộng khoảng 520px.
- Ô nhập dùng `enterKeyHint="search"`.
- Gõ từ khóa vẫn tự tìm sau 150ms.
- Nhấn Search/Enter trên bàn phím ảo tìm ngay và chuyển tới kết quả tiếp theo.
- Submit hủy lượt debounce đang chờ để không nhảy hai kết quả.
- Từ khóa đang composition/IME được lấy từ giá trị thực tế của input tại thời điểm submit.
- Truy vấn rỗng không tìm và xóa highlight hiện tại.

## Search và Snippets trên desktop

- Header terminal có hai nút icon `Search` và `Snippets` cạnh nút tạo terminal.
- Mỗi thời điểm chỉ mở tối đa một công cụ.
- Công cụ mở thành panel nổi phía trên terminal, không chiếm cố định chiều cao terminal.
- Search rộng khoảng 520px; Snippets rộng khoảng 440–480px và cuộn khi nội dung dài.
- Dùng chung component, dữ liệu và hành vi với mobile; chỉ khác vị trí và bố cục responsive.
- `Ctrl+F` hoặc `Cmd+F` mở Search khi terminal đang hoạt động và chặn hộp tìm kiếm của trình duyệt trong ngữ cảnh đó.
- `Escape`, chuyển tab terminal, đóng/collapse terminal hoặc chạm/click body terminal sẽ đóng panel và dọn trạng thái Search.
- Snippets giữ nguyên nguyên tắc chỉ chèn nội dung, không tự chạy lệnh.

## Phạm vi

Chỉ sửa Web: overlay mobile terminal, theme xterm, panel Search, điểm mở công cụ desktop và test trực tiếp liên quan. Không đổi Hub, CLI, terminal transport, scroll, selection handles, Search addon hoặc API.

## Kiểm chứng

- Hai bubble có cùng visual nhưng giữ vùng chạm 44px.
- Selection dễ thấy trên light và dark.
- Search input rộng, không tràn màn hình mobile.
- Search/Enter gọi đúng một lượt `findNext` ngay lập tức.
- Debounce, nút trước/sau, `Aa`, đóng panel và copy/select cũ không hồi quy.
- Desktop mở được Search/Snippets từ header; phím tắt và Escape hoạt động trong đúng ngữ cảnh.
- Desktop và mobile dùng chung logic, không tạo hai bản dữ liệu hoặc controller riêng.
