# Terminal Key Chord Composer — Thiết kế

**Ngày:** 2026-07-29  
**Trạng thái:** Đã triển khai; kiểm chứng tự động hoàn tất; chờ nghiệm thu giao diện mobile

## 1. Mục tiêu

Thay phần `Keys` hiện tại bằng bộ ghép tổ hợp phím dành cho terminal:

- ghép nhiều phím dưới dạng badge, ví dụ `Ctrl` + `Shift` + `F10`;
- chỉ gửi khi người dùng nhấn `Gửi`;
- lưu các tổ hợp thường dùng ngay trên trình duyệt đang sử dụng;
- nạp lại tổ hợp đã lưu để chỉnh sửa trước khi gửi;
- không làm terminal co giãn khi mở bảng chọn phím.

## 2. Phạm vi

### Trong phạm vi

- công cụ `Keys` trong Terminal Control Dock hiện tại, tại breakpoint mobile nơi dock đang được hiển thị;
- tổ hợp gồm nhiều phím bổ trợ và đúng một phím chính;
- bảng chọn phím dùng nền tảng dialog/bottom sheet chung của HAPI;
- mã hóa tổ hợp theo bàn phím US chuẩn trong terminal Linux/xterm;
- lưu, nạp, xóa và hoàn tác xóa tổ hợp trên trình duyệt hiện tại;
- dùng chung cho terminal session modal và terminal trong Editor mode, vì hai nơi cùng dùng dock.

### Ngoài phạm vi

- không lưu qua Hub, database, socket hoặc API;
- không đồng bộ giữa trình duyệt hay thiết bị;
- không đặt tên, đổi tên hoặc sắp xếp thủ công tổ hợp đã lưu;
- không ghi macro nhiều bước hoặc chuỗi lệnh;
- không tạo `KeyboardEvent` giả trong trình duyệt;
- không tự gửi Enter sau tổ hợp, trừ khi `Enter` chính là phím chính;
- không mở thêm công cụ `Keys` trên toolbar desktop trong phiên bản này.

`Chỉ trên thiết bị` trong phiên bản này có nghĩa là dữ liệu nằm trong `localStorage` của đúng trình duyệt và origin HAPI đang mở, không phải kho lưu chung cấp hệ điều hành.

## 3. Luồng người dùng

### 3.1. Ghép và gửi

1. Người dùng mở `Keys`.
2. Thanh ghép hiển thị các badge đã chọn trên một dòng.
3. Nhấn `+ Thêm phím` hoặc vùng trống của thanh ghép để mở bảng chọn.
4. Chọn tối đa `Ctrl`, `Alt`, `Shift` và đúng một phím chính.
5. Nhấn `Áp dụng tổ hợp` để đưa lựa chọn về thanh ghép.
6. Nhấn `Gửi` để ghi tổ hợp vào PTY đúng một lần.
7. Gửi thành công thì xóa tổ hợp đang ghép; gửi lỗi thì giữ nguyên để thử lại.

Chọn phím trong bảng hoặc nạp một tổ hợp đã lưu **không gửi dữ liệu vào terminal**.

### 3.2. Sửa tổ hợp

- thứ tự hiển thị luôn chuẩn hóa thành `Ctrl`, `Alt`, `Shift`, rồi phím chính;
- nhấn dấu `×` ở cuối badge để bỏ phím đó;
- `Xóa hết` đưa thanh ghép về trạng thái rỗng;
- thay phím chính sẽ thay badge phím chính cũ, không tạo hai phím chính;
- `Gửi` và `Lưu` bị vô hiệu hóa khi chưa có phím chính.

### 3.3. Tổ hợp đã lưu

- một rail cố định `Đã lưu · N` nằm ngay trên thanh ghép;
- danh sách cuộn ngang, một dòng, mới nhất ở đầu;
- khi chưa có item, rail vẫn giữ chiều cao và hiển thị empty state gọn để tránh layout nhảy;
- nhấn tổ hợp đã lưu chỉ nạp nó vào thanh ghép;
- `Quản lý` mở bottom sheet chứa toàn bộ danh sách;
- mỗi dòng có `Nạp` và `Xóa`;
- xóa cập nhật bộ nhớ cục bộ ngay và hiện hoàn tác ngắn hạn;
- hoàn tác khôi phục đúng tổ hợp cùng vị trí;
- không có nút gửi trực tiếp trong màn quản lý.

Tổ hợp trùng sau khi chuẩn hóa không được lưu lần hai. Giới hạn 50 tổ hợp; khi đạt giới hạn, HAPI báo lỗi và không tự xóa dữ liệu cũ.

## 4. Bố cục và trạng thái hiển thị

### 4.1. Chống thay đổi bố cục

Khi `Keys` đang mở, dock giữ hai vùng có chiều cao ổn định:

1. rail tổ hợp đã lưu;
2. thanh ghép một dòng.

Badge không xuống dòng. Vùng badge cuộn ngang, badge mới tự cuộn vào tầm nhìn và có lớp mờ ở cạnh khi còn nội dung bị khuất. `+ Thêm phím` và `Gửi` luôn được ghim bên phải.

Bảng chọn và màn quản lý phủ lên terminal bằng component dialog chung:

- mobile: `AppDialogContent` với `presentation="sheet"`;
- màn hình lớn hơn: presentation dialog thích hợp của cùng nền tảng;
- không render danh sách phím inline, nên không đẩy terminal hoặc dock xuống.

### 4.2. Bảng chọn phím

Header gồm tiêu đề, preview tổ hợp và nút đóng. Nội dung có bốn tab:

- `Cơ bản`: Esc, Tab, Enter, Backspace, Home, End, PgUp, PgDn và bốn phím mũi tên;
- `Chữ & số`: A–Z và 0–9;
- `F1–F12`;
- `Ký hiệu`: các phím ký hiệu của bàn phím US.

`Ctrl`, `Alt`, `Shift` là lựa chọn độc lập. `Fn` chỉ là cách phân nhóm/phát hiện phím chức năng trong giao diện, không được ghi vào tổ hợp và không tạo byte riêng.

Footer gồm `Hủy` và `Áp dụng tổ hợp`. Đóng hoặc hủy sheet không làm thay đổi bản nháp đang có trong thanh ghép.

### 4.3. Kích thước và khả năng truy cập

- nút thao tác chính có vùng chạm tối thiểu 44×44 px;
- nút `×` của badge luôn nằm cuối badge, không co lại, vùng chạm tối thiểu 36×36 px;
- badge dài được giới hạn chiều rộng và rút gọn bằng dấu ba chấm;
- mọi icon button có nhãn hỗ trợ trình đọc màn hình;
- trạng thái chọn, disabled, lỗi, gửi thành công và hoàn tác không chỉ phân biệt bằng màu;
- light/dark theme và reduced motion dùng token hiện có của HAPI.

## 5. Mô hình dữ liệu

Tổ hợp được giữ dưới dạng ngữ nghĩa, không lưu byte đã mã hóa:

```ts
type TerminalModifier = 'ctrl' | 'alt' | 'shift'

type TerminalKeyKind =
    | 'control'
    | 'character'
    | 'navigation'
    | 'function'

type TerminalMainKey = {
    id: string
    label: string
    kind: TerminalKeyKind
}

type TerminalKeyChord = {
    modifiers: TerminalModifier[]
    key: TerminalMainKey
}
```

Một hàm chuẩn hóa chịu trách nhiệm:

- bỏ modifier trùng;
- sắp modifier theo thứ tự cố định;
- xác nhận phím thuộc catalog được hỗ trợ;
- tạo khóa định danh ổn định để chống lưu trùng.

Dữ liệu lưu cục bộ có phiên bản:

```ts
type StoredTerminalKeyChordsV1 = {
    version: 1
    items: Array<{
        id: string
        chord: TerminalKeyChord
        createdAt: number
    }>
}
```

Khóa lưu: `hapi:terminal-key-chords:v1`.

Dữ liệu đọc từ `localStorage` phải được kiểm tra runtime. Item hỏng bị bỏ qua an toàn; lỗi đọc/ghi không được làm terminal ngừng hoạt động.

## 6. Bộ mã hóa terminal

### 6.1. Nguyên tắc

PTY nhận chuỗi chứa byte điều khiển, không nhận `KeyboardEvent`. Vì vậy HAPI dùng một encoder thuần phù hợp với contract terminal write hiện tại:

```ts
encodeTerminalKeyChord(chord: TerminalKeyChord): string
```

Encoder:

- hiểu tổ hợp theo vị trí/phím trên bàn phím US chuẩn;
- áp dụng quy ước Linux terminal/xterm;
- thêm tiền tố ESC cho `Alt` khi phù hợp;
- ánh xạ `Ctrl` sang control character khi phím chính là ký tự;
- dùng tham số modifier xterm cho navigation và function key;
- từ chối rõ ràng tổ hợp ngoài ma trận hỗ trợ thay vì gửi byte đoán.

Tổ hợp vẫn hiển thị theo lựa chọn của người dùng. Ví dụ `Ctrl` + `Shift` + `6` không bị đổi nhãn thành ký tự điều khiển.

### 6.2. Quy tắc chính

Với navigation/function key có modifier, tham số xterm là:

```text
1 + Shift(1) + Alt(2) + Ctrl(4)
```

Ví dụ bắt buộc:

| Tổ hợp | Byte/sequence kỳ vọng |
|---|---|
| `Ctrl` + `C` | `0x03` |
| `Ctrl` + `Shift` + `6` | `0x1e` |
| `Shift` + `Tab` | `ESC [ Z` |
| `Alt` + `↑` | `ESC [ 1 ; 3 A` |
| `Ctrl` + `Shift` + `F10` | `ESC [ 2 1 ; 6 ~` |

Catalog phím và encoder là hai khối riêng: catalog quyết định phím nào người dùng có thể chọn; encoder quyết định byte tương ứng.

## 7. Vòng đời trạng thái

Có hai loại trạng thái:

### Bản nháp theo terminal đang mở

- giữ nguyên khi đóng/mở lại panel `Keys` hoặc chạm terminal body;
- giữ nguyên khi mở rồi hủy bảng chọn;
- xóa khi gửi thành công hoặc nhấn `Xóa hết`;
- xóa khi chuyển terminal tab/context hoặc terminal bị đóng;
- không ghi vào `localStorage`.

### Tổ hợp đã lưu theo trình duyệt

- đọc lười ở lần đầu mở `Keys`;
- dùng chung giữa các terminal trên cùng origin/trình duyệt;
- chỉ thay đổi khi lưu, xóa hoặc hoàn tác;
- không bị xóa khi đóng modal, đổi tab terminal hay reload trang.

Nếu terminal mất kết nối giữa lúc gửi, HAPI giữ bản nháp và báo không gửi được. Không tự retry để tránh gửi lặp khi trạng thái kết nối không rõ.

## 8. Ranh giới component

| Khối | Trách nhiệm |
|---|---|
| `TerminalControlDock` | điều phối tool đang mở và gắn composer với terminal context |
| Key composer | render rail, badge, nút thêm/lưu/gửi và trạng thái bản nháp |
| Key picker | chọn modifier/phím chính trong dialog/sheet chung |
| Saved-key manager | liệt kê, nạp, xóa và hoàn tác |
| Key catalog | nguồn phím, label, nhóm và metadata mã hóa |
| Terminal key encoder | đổi tổ hợp hợp lệ thành byte/sequence PTY |
| Local key-chord store | validate, chống trùng, giới hạn và lưu `localStorage` |

Các khối encoder và store không phụ thuộc React để có thể kiểm thử độc lập.

## 9. Xử lý lỗi và trường hợp biên

| Tình huống | Hành vi |
|---|---|
| Chưa chọn phím chính | vô hiệu hóa `Gửi` và `Lưu` |
| Chọn phím chính mới | thay phím chính cũ |
| Tổ hợp không được encoder hỗ trợ | không gửi; báo lỗi ngay trong composer |
| Double tap `Gửi` | khóa nút trong lần ghi hiện tại |
| Terminal disconnect/write lỗi | giữ bản nháp; không tự retry |
| Tổ hợp đã tồn tại | không thêm bản sao; đưa item cũ lên tầm nhìn |
| Đạt 50 tổ hợp | không lưu thêm; không tự xóa |
| `localStorage` hỏng hoặc bị chặn | terminal vẫn dùng được; saved rail báo unavailable |
| Badge dài/nhiều badge | một dòng cuộn ngang, không đẩy layout |
| Xóa nhầm item | cho hoàn tác ngắn hạn |
| Đổi terminal khi sheet đang mở | đóng sheet và xóa bản nháp cũ |

## 10. Kiểm chứng tối thiểu

### Encoder

- kiểm tra byte chính xác cho các ví dụ bắt buộc ở mục 6;
- bao phủ character, symbol, control, navigation và F1–F12 có/không modifier;
- xác nhận Alt prefix, Ctrl mapping, Shift mapping và tổ hợp không hỗ trợ;
- xác nhận đầu vào không bị mutation và kết quả ổn định.

### Tương tác

- chọn phím/nạp item không ghi gì vào terminal;
- `Gửi` ghi đúng một lần rồi reset; lỗi ghi giữ bản nháp;
- chỉ tồn tại một phím chính, modifier không trùng và thứ tự badge ổn định;
- đóng panel/body tap không mất bản nháp; đổi terminal thì mất;
- sheet không làm đổi kích thước terminal hoặc dock;
- badge overflow cuộn ngang, nút thêm/gửi/xóa vẫn chạm được.

### Lưu cục bộ

- reload giữ item đã lưu;
- dữ liệu hỏng được bỏ qua an toàn;
- chống trùng, giới hạn 50, thứ tự mới nhất trước;
- nạp không gửi; xóa và hoàn tác cho kết quả đúng;
- xác nhận không có request Hub/API/socket khi thao tác.

### Kiểm chứng tổng

- test Web liên quan;
- `bun typecheck`;
- `bun run build:web`;
- nghiệm thu bằng tay trên mobile cho session modal và Editor terminal, cả light/dark theme.

## 11. Bản đồ thay đổi dự kiến

| File/khối | Sửa gì | Mức rủi ro |
|---|---|---|
| `web/src/components/Terminal/terminalControls.ts` | thay mô hình Ctrl/Alt gửi ngay bằng catalog và logic ghép có kiểm soát | Vàng |
| `web/src/components/Terminal/TerminalControlDock.tsx` | tích hợp composer, picker và saved manager | Vàng |
| Component Terminal mới | tách composer, picker, quản lý tổ hợp | Xanh |
| Encoder thuần + test | mã hóa tổ hợp sang byte terminal | Vàng |
| Local store + test | lưu thiết bị, validate, chống trùng, giới hạn | Xanh |
| Locale Web | nhãn, lỗi và thông báo hỗ trợ truy cập | Xanh |

Dự kiến không thay đổi:

- Hub, CLI, shared schema và database;
- contract terminal write hiện tại;
- Search, Snippets và History;
- route terminal và vòng đời terminal backend;
- hành vi bàn phím vật lý trên desktop.

## 12. Rủi ro chính và cách giảm

1. **Sequence khác nhau giữa terminal:** khóa phiên bản đầu vào ma trận Linux/xterm đã nêu và kiểm tra byte bằng unit test.
2. **Gửi nhầm khi đang chọn:** picker và saved rail chỉ cập nhật bản nháp; chỉ `Gửi` mới gọi terminal write.
3. **Giao diện bị dồn hoặc khó chạm:** rail/composer một dòng cố định, picker dùng sheet phủ, vùng chạm theo chuẩn mobile.
4. **Mất dữ liệu đã lưu:** validate dữ liệu có phiên bản, không tự xóa khi đầy, xóa có hoàn tác.

## 13. Tiêu chí hoàn thành

Tính năng hoàn thành khi:

- ghép và gửi đúng các tổ hợp mẫu, gồm `Ctrl + Shift + F10` và `Ctrl + Shift + 6`;
- không có đường tương tác nào gửi tổ hợp trước khi nhấn `Gửi`;
- lưu/nạp/xóa/hoàn tác hoạt động trên trình duyệt hiện tại mà không gọi backend;
- mở picker hoặc quản lý không gây thay đổi bố cục terminal;
- session modal và Editor terminal có cùng hành vi;
- test, typecheck và Web build liên quan đều đạt.

## 14. Bằng chứng kiểm chứng

Ngày 2026-07-29:

- `bun run --cwd web test`: 145 file test, 1249 test đạt;
- `bun typecheck`: shared, CLI, Web và Hub đều đạt;
- `bun run build:web`: Web production build và PWA service worker build thành công;
- rà diff xác nhận không thay đổi Hub, CLI, shared schema, database hoặc API;
- nghiệm thu trực quan trên thiết bị mobile thật vẫn do người dùng thực hiện sau khi tích hợp.
