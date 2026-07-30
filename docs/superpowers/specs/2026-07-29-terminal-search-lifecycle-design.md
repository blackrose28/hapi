# Terminal Search Lifecycle

## Mục tiêu

Trên cả mobile và desktop, việc tạm ẩn thanh Search không được làm mất từ
khoá, kết quả hoặc vùng tô sáng. Chỉ thao tác đóng rõ ràng hoặc đổi ngữ cảnh
terminal mới xoá phiên tìm kiếm.

## Hành vi

| Tương tác | Kết quả |
|---|---|
| Nhấn Search hoặc `Ctrl/Cmd+F` trên desktop | Mở Search; nếu đã có phiên tìm kiếm thì khôi phục nguyên trạng |
| Nhấn lại Search | Thu gọn giao diện; giữ từ khoá, kết quả và vùng tô sáng |
| Nhấn vào terminal body trên mobile hoặc desktop | Không đóng, không thu gọn và không xoá Search |
| Mở Snippets | Ẩn Search; giữ phiên tìm kiếm |
| Nhấn `×` trong Search | Đóng và xoá phiên tìm kiếm |
| Đổi terminal tab | Xoá phiên tìm kiếm |
| Nhấn lại terminal tab đang active | Không xoá phiên tìm kiếm |
| Đóng terminal | Xoá phiên tìm kiếm |
| Terminal mất kết nối | Xoá phiên tìm kiếm vì buffer/controller không còn hợp lệ |
| Nhấn `Esc` | HAPI không can thiệp |

## Thiết kế trạng thái

- Tách **công cụ đang hiển thị** khỏi **phiên Search đang tồn tại**.
- Khi Search chỉ bị thu gọn, component Search vẫn được giữ để bảo toàn trạng
  thái cục bộ; SearchAddon vẫn gắn với terminal hiện tại.
- Khi xảy ra thao tác xoá, SearchAddon xoá decorations và component Search
  được unmount để reset từ khoá/kết quả.
- Khi đổi terminal identity, phiên Search cũ phải bị huỷ trước khi terminal mới
  nhận controller tìm kiếm.

## Phạm vi

Sửa trong lớp web terminal:

- Điều phối vòng đời Search trong `SessionTerminalTabs`.
- Cách mount/ẩn panel trong `TerminalControlDock`.
- Test cho icon, body click, `Ctrl/Cmd+F`, dấu `×`, đổi tab và đóng terminal.

Không thay đổi Hub, CLI, API snippets hoặc giao thức terminal.

## Rủi ro và kiểm chứng

1. Search ẩn nhưng bắt sự kiện chuột hoặc chiếm layout.
   - Panel ẩn phải không hiển thị, không nhận pointer và không chiếm diện tích.
2. Phiên Search cũ rò sang terminal khác.
   - Đổi tab/terminal phải clear controller, decorations và state.
3. Lifecycle khác nhau giữa mobile và desktop.
   - Test cả hai breakpoint; terminal body phải không tác động Search ở cả hai.
