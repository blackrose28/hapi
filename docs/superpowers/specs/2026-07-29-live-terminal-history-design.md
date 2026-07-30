# Live Terminal History Design

**Ngày:** 2026-07-29  
**Trạng thái:** Đã triển khai và kiểm chứng tự động; chờ nghiệm thu UI trên bản chạy

## 1. Mục tiêu

Hoàn thiện nút `History` đang bị vô hiệu hóa trong Terminal Control Dock.

Người dùng có thể:

- mở danh sách lịch sử thật của Bash đang chạy trong terminal;
- thấy cả các lệnh vừa thực thi trong terminal hiện tại;
- tìm kiếm và làm mới danh sách;
- nhấn một lệnh để chèn nguyên văn vào prompt;
- tự chỉnh sửa rồi nhấn Enter khi sẵn sàng.

Chọn một lệnh **không tự thực thi**.

## 2. Phạm vi

### Trong phạm vi

- terminal theo session và terminal theo machine đang dùng `TerminalManager`;
- giao diện History trên mobile và desktop;
- snapshot history sống của Bash;
- luồng socket có scope session/machine từ Web qua Hub tới CLI;
- loading, empty, unsupported và error states;
- tìm kiếm cục bộ trong tối đa 100 lệnh;
- cleanup khi terminal đóng hoặc hết vòng đời.

### Ngoài phạm vi

- không hỗ trợ Zsh, Fish hoặc PowerShell trong phiên bản đầu;
- không tự chạy lệnh được chọn;
- không lưu history vào database hoặc local storage của Web;
- không đồng bộ history giữa các machine;
- không đoán command từ raw keyboard input;
- không gửi lệnh `history` vào PTY khi người dùng mở panel;
- không thay đổi lịch sử thật của người dùng trong `.bash_history`.

## 3. Lý do chọn shell hook

Ba phương án đã được xem xét:

1. Bash tự tạo snapshot sau mỗi prompt;
2. chèn `history` trực tiếp vào PTY rồi parse output;
3. Web hoặc CLI đoán command từ raw terminal input.

Chọn phương án 1 vì:

- lấy được command mới nhất của chính shell đang sống;
- không phá nội dung người dùng đang gõ;
- không gửi phím vào `htop`, editor hoặc chương trình full-screen khác;
- không nhầm password prompt thành command;
- không phụ thuộc vào việc Bash đã flush `.bash_history`.

## 4. Kiến trúc

```text
Bash prompt
→ hook cập nhật snapshot riêng của terminal
→ Web mở History và gửi request có requestId
→ Hub xác thực scope rồi chuyển request tới CLI
→ TerminalManager đọc snapshot
→ CLI trả danh sách qua Hub
→ Web render panel
→ user chọn command
→ Web ghi command vào PTY, không gửi Enter
```

History là dữ liệu tạm thời theo terminal. Hub chỉ chuyển tiếp, không cache và không persist.

## 5. Tích hợp Bash

### 5.1. Nhận diện shell

CLI tiếp tục dùng `resolveShell()`.

- basename là `bash`: bật adapter Bash;
- shell khác: terminal vẫn hoạt động bình thường, History trả `unsupported_shell`;
- lỗi cài hook không được làm terminal không khởi động.

Kiến trúc dùng adapter nội bộ để có thể thêm Zsh/Fish sau, nhưng phiên bản này chỉ triển khai Bash.

### 5.2. Wrapper rc riêng

Với Bash, CLI tạo một thư mục runtime riêng cho terminal:

- quyền thư mục `0700`;
- file wrapper rc;
- file snapshot;
- file tạm dùng khi ghi nguyên tử.

Bash được mở với wrapper rc. Wrapper:

1. source `~/.bashrc` nếu tồn tại;
2. giữ nguyên cấu hình và `PROMPT_COMMAND` mà `.bashrc` đã thiết lập;
3. khai báo hook HAPI;
4. nối hook vào cuối `PROMPT_COMMAND`.

Không chỉnh sửa file cấu hình của người dùng.

### 5.3. Snapshot

Sau mỗi prompt, hook chạy tương đương:

```bash
builtin history 100 > "$HAPI_HISTORY_TEMP"
command mv -- "$HAPI_HISTORY_TEMP" "$HAPI_HISTORY_SNAPSHOT"
```

Yêu cầu:

- snapshot phản ánh history trong memory của chính Bash đó;
- lần ghi phải nguyên tử để CLI không đọc file dở;
- hook không in nội dung ra terminal;
- hook không dùng `history -a` hoặc `history -w`, tránh thay đổi `.bash_history`;
- hook luôn trả thành công để không làm thay đổi trạng thái prompt;
- lời gọi hook không trở thành một history item.

Wrapper phải xử lý cả `PROMPT_COMMAND` dạng string và array khi Bash hỗ trợ.

### 5.4. Parse

CLI parse output chuẩn của `history`:

- bỏ số thứ tự hiển thị;
- giữ nguyên nội dung command;
- ghép continuation line vào command trước;
- bỏ item trống;
- giữ thứ tự shell, sau đó trả mới nhất trước;
- giới hạn cứng 100 item.

Không deduplicate thêm vì Bash và `HISTCONTROL` của người dùng mới là nguồn sự thật.

## 6. Socket contract

Thêm hai payload có scope giống terminal hiện tại.

### Request: `terminal:history`

```ts
type TerminalHistoryRequest = {
    requestId: string
    terminalId: string
    limit?: number
} & (
    | { sessionId: string }
    | { machineId: string }
)
```

### Response: `terminal:history-result`

```ts
type TerminalHistoryResult = {
    requestId: string
    terminalId: string
    status: 'ok' | 'unsupported_shell' | 'not_ready' | 'read_failed'
    shell?: string
    entries: Array<{
        index: number
        command: string
    }>
} & (
    | { sessionId: string }
    | { machineId: string }
)
```

Quy tắc:

- `requestId` chống response cũ ghi đè terminal/tab mới;
- Hub áp dụng cùng authorization và ownership checks như write/resize;
- Hub clamp limit về `1..100`;
- Hub không dùng trực tiếp `requestId` của Web để route response:
  - tạo correlation id riêng khi forward sang CLI;
  - lưu mapping tạm tới đúng socket Web đã request;
  - đổi correlation id về requestId gốc khi trả cho Web;
  - xóa mapping sau response đầu tiên, sau 10 giây hoặc khi socket disconnect;
- response chỉ trả cho đúng socket Web đã request, không broadcast theo room/scope;
- không log command hoặc toàn bộ payload history;
- không persist response.

## 7. Web state và panel

### 7.1. State

Một hook riêng quản lý:

```ts
type TerminalHistoryState =
    | { status: 'idle'; entries: [] }
    | { status: 'loading'; entries: [] }
    | { status: 'ready'; entries: TerminalHistoryEntry[] }
    | { status: 'unsupported'; entries: []; shell?: string }
    | { status: 'error'; entries: []; message: string }
```

Khi mở History:

1. panel mở ngay ở trạng thái loading;
2. Web gửi request cho terminal active;
3. chỉ response khớp requestId và terminal identity hiện tại được nhận;
4. terminal switch/close/unmount hủy generation hiện tại và xóa state;
5. nút Refresh tạo requestId mới.

### 7.2. Visual

Panel tái sử dụng ngôn ngữ thiết kế của Search/Snippets:

- mobile: anchored panel nằm trên control dock;
- desktop: panel nổi ở góc trên-phải của terminal;
- header: `History`, số lượng item, Refresh và Close;
- search input đủ rộng;
- list cuộn độc lập, tối đa `48dvh` trên mobile;
- command dùng font monospace, tối đa hai dòng trước khi truncate;
- item mới nhất nằm trên cùng;
- touch target tối thiểu 44px;
- light/dark và reduced-motion theo token hiện có.

Không tạo modal hoặc route mới.

### 7.3. Interaction

- nhấn item gọi `onWritePlainInput(command)`;
- tuyệt đối không nối `\r`, `\n` hoặc Enter;
- insert thành công: đóng panel và phát thông báo screen-reader `Inserted · not executed`;
- insert thất bại: giữ panel và hiện lỗi;
- gõ tìm kiếm chỉ filter 100 item trong memory, không debounce/network request;
- empty search và empty history có copy riêng;
- click terminal body đóng History giống Snippets;
- History được reset khi đổi terminal tab.

## 8. Desktop access

Nút History được bật trong mobile dock.

Ở desktop:

- đặt icon History cạnh Search và Snippets tại terminal header đã có các action này;
- trạng thái active dùng cùng visual violet;
- panel dùng cùng `TerminalControlDock`;
- không làm thay đổi kích thước terminal.

Nếu một terminal surface chưa có desktop action row, chỉ bổ sung action History cùng lúc với Search/Snippets, không tạo một toolbar desktop thứ hai.

## 9. Error handling

| Tình huống | Hành vi |
|---|---|
| Bash chưa tạo prompt/snapshot | `not_ready`, cho phép Refresh |
| Shell không phải Bash | trạng thái unsupported, terminal vẫn dùng bình thường |
| Snapshot mất hoặc đọc lỗi | error + Retry |
| Terminal đổi khi request đang chạy | bỏ response cũ |
| Terminal đóng | cleanup runtime files và Web state |
| Hook setup lỗi | terminal vẫn mở; History báo unavailable |
| Insert thất bại | không đóng panel, không chạy command |

## 10. Bảo mật và riêng tư

Shell history có thể chứa token hoặc command nhạy cảm.

Kiểm soát:

- snapshot chỉ tồn tại trong runtime directory quyền `0700`;
- file chỉ dùng cho terminal sở hữu nó;
- không lưu database, browser storage hoặc analytics;
- không log entries ở CLI, Hub hoặc Web;
- authorization theo scope terminal hiện tại;
- cleanup khi close, process exit, expiry và manager shutdown;
- UI không tự copy hoặc tự execute history item.

Quyền xem History không mở rộng quyền so với quyền xem và điều khiển chính terminal đó.

## 11. Bản đồ thay đổi dự kiến

| Khối | Vai trò | Thay đổi | Rủi ro |
|---|---|---|---|
| `shared/src/socket.ts` | contract chung | schema/type cho request/result | Vàng: scope sai có thể lộ history |
| `cli/src/terminal/` | shell runtime | Bash adapter, hook, snapshot, parse, cleanup | Vàng: không được phá `.bashrc`/prompt |
| `cli/src/api/` | CLI socket | nhận request và trả result | Vàng: routing session/machine |
| `hub/src/socket/handlers/terminal.ts` | gateway | authorize và forward | Đỏ: isolation giữa client |
| `web/src/hooks/useTerminalSocket.ts` | Web transport | request/result listener | Vàng: stale response |
| `web/src/components/Terminal/` | UX | hook state và History panel | Xanh |
| terminal parent surfaces | active terminal | truyền identity, insert và desktop trigger | Xanh |

## 12. Kiểm thử tối thiểu

### CLI

- Bash wrapper source cấu hình cũ rồi nối hook;
- giữ `PROMPT_COMMAND` string/array;
- snapshot parse command đơn và multiline;
- unsupported shell không làm terminal fail;
- cleanup file runtime ở mọi close path;
- không gọi `history -a`/`history -w`.

### Shared và Hub

- schemas reject request không có scope hoặc limit vượt contract;
- client không có quyền không thể request history;
- request session/machine route đúng CLI;
- response không broadcast sang client khác;
- command contents không đi vào persistence/log path.

### Web

- nút History được bật;
- mở panel phát request cho đúng terminal active;
- loading/empty/unsupported/error/ready đúng;
- Refresh thay requestId;
- response stale bị bỏ;
- search filter cục bộ;
- chọn item chèn đúng nguyên văn và không Enter;
- terminal switch/close xóa state;
- mobile và desktop đều mở được panel.

### Project checks

- focused CLI/Hub/Web tests;
- full test suite;
- typecheck;
- production web build;
- `git diff --check`.

## 13. Tiêu chí hoàn tất

- Bash history list hiện được và có command vừa chạy;
- không cần gửi `history` vào PTY khi mở panel;
- chọn command chỉ chèn, không chạy;
- History dùng được ở mobile và desktop;
- không ảnh hưởng Search, Snippets, Paste, helper keys hoặc terminal lifecycle;
- không sửa `.bashrc` hay `.bash_history`;
- không lưu history ngoài runtime terminal;
- shell không hỗ trợ vẫn dùng terminal bình thường;
- test, typecheck và build đạt.
