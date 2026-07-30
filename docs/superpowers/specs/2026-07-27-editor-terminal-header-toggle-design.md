# Editor Terminal Header Toggle Design

**Ngày:** 2026-07-27  
**Trạng thái:** Đã duyệt thiết kế

## Mục tiêu

Cho phép người dùng mở rộng hoặc thu gọn terminal panel trong desktop Editor Mode bằng cách bấm vào vùng nền của toàn bộ header, thay vì bắt buộc bấm đúng dấu `>` hoặc `⌄`.

## Hành vi

- Bấm vùng nền header khi panel đang thu gọn sẽ mở rộng panel.
- Bấm vùng nền header khi panel đang mở sẽ thu gọn panel.
- Dấu `>`/`⌄` tiếp tục toggle như hiện tại.
- Các điều khiển có chức năng riêng không được làm panel toggle:
  - toàn bộ vùng tab terminal, kể cả khoảng đệm và thao tác cuộn ngang;
  - chọn tab terminal;
  - đóng tab terminal;
  - tạo terminal mới.
- Vùng header có con trỏ `pointer` để thể hiện khả năng tương tác.
- Mobile Editor Mode giữ nguyên hành vi hiện tại và không có toggle collapse qua header.

## Cách xử lý

Header desktop nhận click tại lớp container. Trước khi toggle, handler kiểm tra nguồn click:

- Nếu click bắt nguồn từ vùng tab hoặc điều khiển tương tác bên trong header, để vùng đó tự xử lý và không toggle panel.
- Nếu click bắt nguồn từ chữ `Terminal` hoặc vùng nền không tương tác, gọi callback toggle hiện có.

Dấu `>`/`⌄` vẫn là button riêng để người dùng bàn phím giữ được điểm focus và accessible name hiện tại. Không biến toàn header thành button vì header đang chứa các button con.

## Không thay đổi

- Chiều cao khi mở, chiều cao khi thu gọn và logic resize panel.
- Vòng đời terminal, socket, process và dữ liệu tab.
- Chọn tab, đóng tab và tạo terminal.
- Terminal modal hoặc session terminal.
- Cách collapse hoạt động trên mobile.

## Kiểm chứng

1. Bấm chữ `Terminal` hoặc vùng nền hai lần lần lượt mở và thu gọn panel.
2. Bấm dấu `>`/`⌄` chỉ toggle đúng một lần.
3. Bấm tab, nút đóng hoặc nút tạo terminal chỉ chạy chức năng riêng, không toggle panel.
4. Test web liên quan, typecheck và production build hoàn tất.
