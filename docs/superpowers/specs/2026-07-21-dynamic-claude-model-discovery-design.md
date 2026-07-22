# Dynamic Claude Model Discovery Design

**Ngày:** 2026-07-21
**Trạng thái:** Đã được user duyệt để triển khai
**Mục tiêu:** HAPI hiển thị model Claude do Anthropic-compatible gateway đang hoạt động cung cấp, qua một Model Catalog có thể tái sử dụng cho agent khác và luôn fallback an toàn.

## 1. Phạm vi đã chốt

- MVP chỉ hỗ trợ gateway dùng `ANTHROPIC_BASE_URL` và Anthropic Messages API.
- Chỉ khám phá model khi `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`.
- Không khám phá khi `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` hoặc có `CLAUDE_CODE_USE_*` provider cloud đang bật.
- Hỗ trợ credential tĩnh từ `ANTHROPIC_AUTH_TOKEN` hoặc `ANTHROPIC_API_KEY`.
- OAuth/claude.ai, `apiKeyHelper`, Bedrock, Vertex, Foundry và Claude Platform on AWS nằm ngoài MVP; dùng fallback.
- Credential chỉ tồn tại trong CLI trên máy người dùng; Hub/Web không nhận URL, header hoặc token.
- User chấp nhận rủi ro còn lại: gateway/API có thể thay đổi, danh sách có thể khác quyền thực thi thực tế, và provider ngoài MVP không được tải động.

## 2. Kiến trúc generic vừa đủ

Không tạo chuỗi `listClaudeModels` riêng xuyên suốt mọi tầng. Tạo contract chung:

```ts
type AgentModelDescriptor = {
    id: string
    displayName: string
}

type AgentModelCatalogResult = {
    status: 'dynamic' | 'fallback' | 'unsupported' | 'failed'
    models: AgentModelDescriptor[]
    source: string
    error?: string
}

type AgentModelCatalogRequest = {
    agent: AgentFlavor
}
```

CLI dùng adapter registry:

```text
Agent Model Catalog
├── Claude gateway adapter      ← triển khai trong MVP
├── Static preset adapter       ← fallback
├── Codex adapter               ← chưa migrate trong MVP
└── OpenCode adapter            ← chưa migrate trong MVP
```

Codex/OpenCode giữ API hiện tại để tránh refactor lan rộng. Contract và registry mới phải cho phép migrate sau mà không đổi UI contract thêm lần nữa.

Model Catalog ưu tiên trả preset đã lọc theo policy khi adapter động `unsupported` hoặc `failed`, đồng thời giữ nguyên status để Web quyết định có hiện cảnh báo hay không. Nếu policy quản trị không thể đọc chắc chắn hoặc allowlist rỗng, catalog không trả model đặt tên; lựa chọn `Default` ở UI vẫn dùng được và không vượt policy.

## 3. Luồng hệ thống

```text
Web yêu cầu model theo agent + machine/session
→ Hub chuyển RPC listAgentModels
→ CLI chọn adapter theo agent và runtime context
→ Claude adapter kiểm tra policy/provider/credential
→ GET {ANTHROPIC_BASE_URL}/v1/models?limit=1000
→ Chuẩn hóa thành AgentModelCatalogResult
→ Hub/Web chỉ nhận metadata model đã làm sạch
→ Nếu unsupported/failed: registry trả preset Claude cùng status tương ứng
```

- Phiên đang hoạt động dùng môi trường của session.
- Màn tạo phiên dùng môi trường của machine runner và gửi thư mục dự án đang chọn để đọc đúng project/local settings.
- Phiên đã dừng dùng snapshot metadata đã cache; không phát sinh network request.

## 4. Điều kiện chạy Claude gateway adapter

Adapter chỉ gọi network khi tất cả điều kiện đúng:

1. `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` bằng chuỗi `1`.
2. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` không bằng `1`.
3. Không có biến bắt đầu bằng `CLAUDE_CODE_USE_` mang giá trị `1` hoặc `true` không phân biệt hoa thường.
4. `ANTHROPIC_BASE_URL` là URL `http:` hoặc `https:` hợp lệ, không trỏ tới `api.anthropic.com`.
5. Có `ANTHROPIC_AUTH_TOKEN` hoặc `ANTHROPIC_API_KEY`.

Nếu thiếu điều kiện, trả `unsupported`, không hiện lỗi và dùng fallback.

MVP chỉ đọc môi trường thực tế của tiến trình HAPI/session. Provider chỉ khai báo bên trong Claude settings nhưng không có trong môi trường HAPI được coi là `unsupported`; không đoán cấu hình ngầm của Claude.

## 5. Request, bảo mật và chuẩn hóa

- Ghép endpoint bằng URL API; base URL kết thúc bằng `/v1` không được tạo `/v1/v1/models`.
- Query `limit=1000`; timeout 3 giây; cấm redirect.
- `ANTHROPIC_AUTH_TOKEN` dùng `Authorization: Bearer`; nếu không có thì dùng `ANTHROPIC_API_KEY` qua `x-api-key`.
- Gửi `anthropic-version: 2023-06-01`.
- Parse `ANTHROPIC_CUSTOM_HEADERS` theo từng dòng `Name: Value`; từ chối tên/value chứa control character.
- Custom header không được ghi đè `authorization`, `x-api-key`, `anthropic-version`, `host` hoặc `content-length`, so sánh không phân biệt hoa thường.
- Không log HTTP client error object/config. Log chỉ gồm status code, error category và hostname đã bỏ userinfo/query.
- Response chỉ giữ `id`, `display_name`/`displayName`; bỏ record sai, loại ID trùng và giữ thứ tự.
- Chỉ nhận ID bắt đầu bằng `claude` hoặc `anthropic`, khớp hành vi discovery chính thức của Claude Code.

## 6. Chính sách model và cache

- Một policy resolver riêng đọc các nguồn settings Claude mà HAPI truy cập được theo đúng thứ tự ưu tiên user/project/local/managed; nếu kết quả hiệu lực có `availableModels`, catalog động phải giao với allowlist đó.
- Nếu phát hiện managed settings có `availableModels` nhưng không đọc/parse chắc chắn được, trả `unsupported` thay vì bỏ qua chính sách.
- Cache session chỉ gồm model list đã làm sạch, source và `cachedAt`; kết quả tạm thời `failed`/`unsupported` không ghi đè snapshot tốt gần nhất.
- `Default` luôn đứng đầu; model hiện tại được giữ lại nếu không nằm trong catalog để tránh mất trạng thái.

## 7. Hành vi Web

- `dynamic`: hiển thị danh sách gateway từ catalog.
- `fallback` hoặc `unsupported`: hiển thị danh sách policy-safe do catalog trả về, không cảnh báo.
- `failed`: hiển thị danh sách policy-safe do catalog trả về, cảnh báo nhẹ; chỉ khóa đổi model trong lúc request còn đang tải.
- Nếu REST/RPC hỏng trước khi nhận được catalog, Web mới dùng `CLAUDE_MODEL_PRESETS` trong shared làm fallback cuối cùng.
- Không polling; cache ngắn và refetch khi query được mount lại sau thời gian stale.
- Dùng hook chung `useAgentModels`; không thêm `useClaudeModels` làm contract lâu dài.

## 8. Ranh giới thay đổi

| Khối | Thay đổi |
|---|---|
| `cli/src/modules/common/agentModels/` | Contract, registry, fallback và Claude gateway adapter |
| `cli/src/modules/common/handlers/` | RPC generic `listAgentModels` |
| `hub/src/sync/` | Chuyển RPC và cache snapshot session |
| `hub/src/web/routes/` | REST machine/session nhận query `agent` |
| `shared/src/` | Kiểu/schema Model Catalog và cache |
| `web/src/hooks/queries/` | Hook generic `useAgentModels` |
| `web/src/components/` | New Session, Session Chat và Team Chat dùng catalog chung |

Không thay đổi endpoint hoặc logic discovery hiện tại của Codex/OpenCode trong MVP.

## 9. Kiểm thử tối thiểu

1. Chỉ gọi gateway khi discovery bật và mọi policy gate hợp lệ.
2. Disable traffic, cloud provider, OAuth-only và apiKeyHelper-only → `unsupported`, không gọi network.
3. Bearer/API key/custom header đúng; response/log/RPC không chứa secret.
4. Timeout, redirect, HTTP lỗi và payload sai → `failed`; UI fallback nhưng không bị khóa.
5. URL `/v1`, header control character, duplicate model và prefix sai được xử lý đúng.
6. `availableModels` giới hạn catalog; managed policy không đọc chắc chắn → không discovery.
7. Machine dùng đúng thư mục đang chọn; active/inactive session dùng đúng nguồn dữ liệu.
8. Kết quả lỗi tạm thời không ghi đè snapshot session tốt gần nhất.
9. Codex/OpenCode không đổi hành vi.

Mọi logic mới đi theo TDD: test phải thất bại đúng nguyên nhân trước khi có production code.

## 10. Rủi ro còn lại đã chấp nhận

- Gateway có thể quảng cáo model nhưng từ chối lúc chạy.
- Gateway/Anthropic có thể đổi contract hoặc trả payload không chuẩn.
- Cấu hình chỉ tồn tại trong Claude settings có thể không được HAPI nhận diện.
- OAuth và cloud provider tiếp tục dùng preset tĩnh.
- Model list có thể cũ trong thời gian cache ngắn.

Các trường hợp trên kết thúc bằng preset policy-safe hoặc `Default`; không làm mất dữ liệu, thay đổi auth hoặc chặn phiên Claude.

## 11. Khôi phục

Thay đổi chỉ đọc metadata, không migration database và không đổi luồng gửi prompt. Có thể rollback contract/adapter/endpoint mới; cache metadata tùy chọn sẽ bị bản cũ bỏ qua. Preset Claude hiện tại luôn là đường dự phòng.

## 12. Nguồn tham chiếu

- Claude Code gateway model discovery: <https://code.claude.com/docs/en/llm-gateway-protocol#model-discovery>
- Anthropic Models API: <https://platform.claude.com/docs/en/api/models/list>
