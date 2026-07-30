# Mobile Terminal Enter Bubble

## Mục tiêu

Làm bubble thao tác terminal trên mobile gọn hơn và thêm cách gửi phím Enter mà không mở bàn phím ảo.

## Hành vi

- Bubble lựa chọn hiển thị theo thứ tự: `Nhập | Enter | Chọn`.
- `Nhập` và `Chọn` giữ nguyên hành vi hiện tại.
- `Enter` gửi ký tự carriage return (`\r`) qua luồng nhập hiện có của xterm.
- Nhấn `Enter` không mở bàn phím, không đổi chế độ tương tác và không đóng bubble.
- Bubble tiếp tục bám theo vị trí con trỏ theo cơ chế hiện tại.

## Giao diện

- Chỉ thu gọn bubble lựa chọn; không thay đổi thanh công cụ vùng chọn.
- Giảm padding ngoài và padding ngang của từng mục.
- Giảm cỡ chữ nhẹ.
- Đổi hình viên thuốc `rounded-full` sang bo góc vừa.
- Giữ vùng chạm tối thiểu 44px để thao tác mobile không bị khó bấm.

## Phạm vi

Sửa component bubble, hook tương tác mobile, bản dịch và các test trực tiếp liên quan. Không thay đổi API Hub/CLI, desktop terminal, tìm kiếm terminal hoặc logic chọn/copy.

## Kiểm chứng

- Bubble có đủ ba thao tác theo đúng thứ tự.
- Nhấn Enter phát đúng `\r`, không focus textarea và bubble vẫn mở.
- Nhập/Chọn vẫn hoạt động.
- Test web và typecheck liên quan vượt qua.
