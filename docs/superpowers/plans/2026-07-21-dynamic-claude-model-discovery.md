# Dynamic Claude Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải danh sách model Claude từ Anthropic-compatible gateway đang hoạt động qua Model Catalog dùng chung, với policy gate, bảo vệ credential và fallback preset.

**Architecture:** Shared định nghĩa contract `AgentModelCatalogResult`. CLI có registry và Claude gateway adapter; Hub chỉ chuyển RPC/cache metadata; Web dùng hook generic. Codex/OpenCode giữ endpoint hiện tại trong MVP.

**Tech Stack:** TypeScript strict, Zod, Axios, Bun/Hono, React Query, Vitest/Bun test.

## Global Constraints

- Chỉ discovery khi `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` và không bị policy tắt.
- Chỉ hỗ trợ `ANTHROPIC_BASE_URL` custom gateway với credential tĩnh.
- Credential không được xuất hiện trong RPC, REST, cache hoặc log.
- Lỗi discovery trả preset đã lọc theo policy; nếu policy quản trị không đọc chắc chắn thì chỉ giữ `Default`, không mở lại preset ngoài policy.
- Không đổi hành vi Codex/OpenCode.
- TDD bắt buộc cho mọi logic mới.

---

## File Map

| File | Vai trò |
|---|---|
| `shared/src/agentModels.ts` | Contract/schema catalog dùng chung |
| `shared/src/schemas.ts` | Cache metadata catalog của session |
| `cli/src/modules/common/agentModels/catalog.ts` | Registry và static fallback |
| `cli/src/modules/common/agentModels/claudeGateway.ts` | Policy gate, HTTP request, normalize, safe errors |
| `cli/src/modules/common/agentModels/claudePolicy.ts` | Đọc `availableModels` từ settings truy cập được |
| `cli/src/modules/common/handlers/agentModels.ts` | RPC `listAgentModels` |
| `hub/src/sync/rpcGateway.ts` | RPC machine/session |
| `hub/src/sync/syncEngine.ts` | Catalog façade và cache snapshot |
| `hub/src/web/routes/machines.ts` | `GET /machines/:id/models?agent=...` |
| `hub/src/web/routes/sessions.ts` | `GET /sessions/:id/models?agent=...` |
| `web/src/hooks/queries/useAgentModels.ts` | Query generic và fallback cuối |
| `web/src/components/NewSession/index.tsx` | Model Claude khi tạo phiên |
| `web/src/components/SessionChat.tsx` | Model Claude trong composer |
| `web/src/components/TeamChat/TeamChatRightPanel.tsx` | Model Claude trong Team Chat |

---

### Task 1: Shared Model Catalog Contract

**Files:**
- Create: `shared/src/agentModels.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/schemas.ts`
- Test: `shared/src/agentModels.test.ts`

**Interfaces:**
- Produces: `AgentModelDescriptor`, `AgentModelCatalogStatus`, `AgentModelCatalogResult`, corresponding Zod schemas.
- Produces metadata: `cachedAgentModels: { agent, status, models, source, cachedAt }`.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(AgentModelCatalogResultSchema.parse({
    status: 'dynamic',
    models: [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }],
    source: 'gateway:example.com/v1'
})).toMatchObject({ status: 'dynamic' })

expect(() => AgentModelCatalogResultSchema.parse({
    status: 'unknown', models: [], source: 'x'
})).toThrow()
```

- [ ] **Step 2: Run RED**

Run: `bun run --cwd shared test src/agentModels.test.ts`  
Expected: FAIL because schema/module does not exist.

- [ ] **Step 3: Implement minimal schemas/types and export them**

```ts
export const AgentModelCatalogStatusSchema = z.enum(['dynamic', 'fallback', 'unsupported', 'failed'])
export const AgentModelDescriptorSchema = z.object({ id: z.string().min(1), displayName: z.string().min(1) })
export const AgentModelCatalogResultSchema = z.object({
    status: AgentModelCatalogStatusSchema,
    models: z.array(AgentModelDescriptorSchema),
    source: z.string(),
    error: z.string().optional()
})
```

- [ ] **Step 4: Run GREEN and shared typecheck**

Run: `bun run --cwd shared test src/agentModels.test.ts && bun run typecheck:shared`  
Expected: PASS.

---

### Task 2: CLI Claude Gateway Adapter and Policy

**Files:**
- Create: `cli/src/modules/common/agentModels/claudeGateway.ts`
- Create: `cli/src/modules/common/agentModels/claudePolicy.ts`
- Create: `cli/src/modules/common/agentModels/catalog.ts`
- Create: `cli/src/modules/common/agentModels/claudeGateway.test.ts`
- Create: `cli/src/modules/common/handlers/agentModels.ts`
- Modify: `cli/src/modules/common/registerCommonHandlers.ts`

**Interfaces:**
- Consumes: shared catalog types.
- Produces: `listAgentModels(agent: AgentFlavor, context: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<AgentModelCatalogResult>`.
- Registers RPC `listAgentModels` with `{ agent, cwd? }`.

- [ ] **Step 1: Write failing policy-gate tests**

Cover discovery flag missing, disabled traffic, `CLAUDE_CODE_USE_*`, missing/custom-invalid base URL, missing credential. Assert HTTP client is never called and result contains preset models with `unsupported`.

- [ ] **Step 2: Run RED for policy tests**

Run: `bun run --cwd cli vitest run src/modules/common/agentModels/claudeGateway.test.ts`  
Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement policy gate and static fallback**

```ts
export async function listAgentModels(
    agent: AgentFlavor,
    context: AgentModelCatalogContext
): Promise<AgentModelCatalogResult>
```

Unknown/non-MVP agents return `unsupported`; Claude fallback derives from `CLAUDE_MODEL_PRESETS` and `getClaudeModelLabel`.

- [ ] **Step 4: Run policy tests GREEN**

Run: same targeted Vitest command.  
Expected: policy tests PASS.

- [ ] **Step 5: Write failing HTTP/security/normalization tests**

Cover bearer precedence, API-key header, custom-header blocking/control characters, `/v1` URL joining, timeout/no redirect options, 3xx/4xx/timeout failure, duplicate/malformed/prefix filtering, no secret in returned error.

- [ ] **Step 6: Run RED for HTTP tests**

Expected: FAIL because gateway request is not implemented.

- [ ] **Step 7: Implement minimal Axios adapter**

Inject an HTTP client in tests; production defaults to Axios. Never log raw error/config. Return safe `source = gateway:<hostname><basePath>`.

- [ ] **Step 8: Write failing availableModels tests**

Create temporary user/project/local/file-managed settings. Assert managed allowlist wins; otherwise arrays merge/deduplicate; invalid managed JSON blocks discovery.

- [ ] **Step 9: Implement policy resolver**

Read only documented file sources accessible to HAPI. Do not execute `policyHelper` or `apiKeyHelper`. Apply allowlist before returning dynamic models.

- [ ] **Step 10: Register handler and verify CLI**

Run: `bun run --cwd cli vitest run src/modules/common/agentModels/claudeGateway.test.ts && bun run typecheck:cli`  
Expected: PASS.

---

### Task 3: Hub RPC, REST, and Session Cache

**Files:**
- Modify: `hub/src/sync/rpcGateway.ts`
- Modify: `hub/src/sync/syncEngine.ts`
- Modify: `hub/src/web/routes/machines.ts`
- Modify: `hub/src/web/routes/sessions.ts`
- Modify: `hub/src/web/routes/machines.test.ts`
- Modify: `hub/src/web/routes/sessions.test.ts`

**Interfaces:**
- `listAgentModelsForMachine(machineId, agent, cwd?)`.
- `listAgentModelsForSession(sessionId, agent)`.
- `cacheAgentModelsForSession(sessionId, agent, result)`.
- REST: `/machines/:id/models?agent=claude&cwd=...`, `/sessions/:id/models?agent=claude`.

- [ ] **Step 1: Add failing route tests**

Cover missing/invalid agent, online machine forwarding, active session flavor validation/cache, inactive session cache hit/miss, RPC exception sanitization.

- [ ] **Step 2: Run RED**

Run: `bun test --cwd hub src/web/routes/machines.test.ts src/web/routes/sessions.test.ts`  
Expected: new routes return 404 or methods are missing.

- [ ] **Step 3: Implement RPC façade, cache and routes**

Parse agent with shared `AgentFlavor`; active session may only query its own flavor. Cache only sanitized catalog response. Existing Codex/OpenCode routes stay unchanged.

- [ ] **Step 4: Run GREEN and Hub typecheck**

Run: `bun test --cwd hub src/web/routes/machines.test.ts src/web/routes/sessions.test.ts && bun run typecheck:hub`  
Expected: PASS.

---

### Task 4: Web Generic Hook and Claude UI Integration

**Files:**
- Modify: `web/src/types/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/lib/query-keys.ts`
- Create: `web/src/hooks/queries/useAgentModels.ts`
- Create: `web/src/hooks/queries/useAgentModels.test.tsx`
- Modify: `web/src/components/NewSession/index.tsx`
- Modify: `web/src/components/NewSession/types.ts`
- Modify: `web/src/components/NewSession/types.test.ts`
- Modify: `web/src/components/SessionChat.tsx`
- Modify: `web/src/components/TeamChat/TeamChatRightPanel.tsx`
- Modify: affected mocks in `web/src/**/*.test.tsx`

**Interfaces:**
- `ApiClient.getMachineAgentModels(machineId, agent, cwd?)`.
- `ApiClient.getSessionAgentModels(sessionId, agent)`.
- `useAgentModels({ api, agent, machineId?, sessionId?, cwd?, enabled? })`.

- [ ] **Step 1: Write failing hook tests**

Cover machine/session endpoint choice, returned dynamic catalog, unsupported/fallback without error, failed status with warning, transport error with shared preset fallback.

- [ ] **Step 2: Run RED**

Run: `bun run --cwd web vitest run src/hooks/queries/useAgentModels.test.tsx`  
Expected: FAIL because hook/API methods do not exist.

- [ ] **Step 3: Implement API, query key and hook**

Hook always returns usable `models`; `error` is non-null only for `failed` or transport failure.

- [ ] **Step 4: Run hook tests GREEN**

Run targeted Vitest command.  
Expected: PASS.

- [ ] **Step 5: Write failing model-option tests**

Assert Claude custom catalog replaces preset list, current unknown model is preserved, and no catalog uses shared fallback.

- [ ] **Step 6: Integrate New Session, Session Chat and Team Chat**

Claude uses `useAgentModels`; Codex/OpenCode keep existing hooks. Discovery warning never disables Claude controls. Remove duplicated Claude model literals from `MODEL_OPTIONS` by deriving them from shared presets.

- [ ] **Step 7: Run Web tests and typecheck**

Run: `bun run --cwd web vitest run src/components/AssistantChat/modelOptions.test.ts src/components/NewSession/types.test.ts src/hooks/queries/useAgentModels.test.tsx && bun run typecheck:web`  
Expected: PASS.

---

### Task 5: Cross-Package Verification and Review

**Files:** All changed files.

- [ ] **Step 1: Run focused suites**

Run all commands from Tasks 1–4 again. Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run: `bun typecheck && bun run test`  
Expected: all packages PASS.

- [ ] **Step 3: Inspect diff and security invariants**

Run: `git diff --check`, `rg -n "ANTHROPIC_(API_KEY|AUTH_TOKEN).*logger|logger.*ANTHROPIC_(API_KEY|AUTH_TOKEN)" cli/src` and review the complete diff. Expected: no whitespace errors or secret logging.

- [ ] **Step 4: Run GitNexus change detection if repository becomes indexed**

Current GitNexus inventory does not contain `/home/huynq/notebooks/hapi`; record this limitation if still unavailable.

- [ ] **Step 5: Produce code-change map and evidence**

Report files by system role, tests actually run, remaining risks and rollback path. Do not claim unrun checks passed.
