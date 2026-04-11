## Goal
Add hub-wide MCP Streamable HTTP transport so the hub can serve MCP requests across multiple sessions in a single authenticated namespace, with no implicit “current session” behavior. The new endpoint should use explicit identifiers (such as `sessionId` and/or `machineId`) in tool inputs, enforce namespace-scoped authorization, and provide parity with existing streamable HTTP behavior already used in the CLI.

## Acceptance Criteria
- Hub exposes a new authenticated MCP Streamable HTTP endpoint under the existing namespace-authenticated web routing stack, and it supports concurrent requests for multiple sessions.
- MCP tool handlers reachable through this endpoint require explicit scope identifiers (at minimum `sessionId`; `machineId` where tool semantics require machine scope), and requests missing required IDs fail with a protocol-appropriate invalid-params error.
- Authorization and namespace isolation are enforced: caller token/identity must be authorized for the namespace and for the referenced explicit IDs; cross-namespace or unauthorized ID access is denied.
- Existing hub REST/SSE/socket behavior remains unchanged, and no session-scoped implicit context is introduced into MCP tool execution.
- Automated tests cover: successful multi-session usage, missing-ID validation failures, unauthorized namespace/ID access rejection, and at least one regression case proving no implicit current-session fallback.

## Constraints
- Keep the patch minimal and reversible; prefer route/middleware additions over broad refactors.
- Reuse existing MCP Streamable HTTP implementation patterns from `cli/src/claude/utils/startHappyServer.ts` and bridge behavior from `cli/src/codex/happyMcpStdioBridge.ts` without changing CLI behavior.
- Do not add new dependencies or change public APIs outside the new hub MCP endpoint and explicit MCP tool input contracts required for hub-wide scope.

## Target Files
- `hub/src/web/routes/mcpHttp.ts`
- `hub/src/web/routes/index.ts`
- `hub/src/web/routes/authNamespaceRouter.ts`
- `hub/src/mcp/server/createHubMcpHttpServer.ts`
- `hub/src/mcp/tools/index.ts`
- `hub/src/mcp/tools/schemas.ts`
- `hub/src/mcp/tools/contextGuards.ts`
- `hub/src/web/routes/__tests__/mcpHttp.test.ts`
- `hub/src/web/routes/__tests__/mcpHttp.auth.test.ts`

## Test Plan
- `pnpm --filter hub test -- mcpHttp.test.ts`
- `pnpm --filter hub test -- mcpHttp.auth.test.ts`
- `pnpm --filter hub test`
- `pnpm --filter hub typecheck`

## Risks
- If existing MCP tool implementations assume implicit session state, enforcing explicit IDs may surface hidden coupling and require small compatibility shims.
- Namespace authorization checks may exist in multiple layers; incorrect middleware ordering could accidentally allow or block traffic.
- Streamable HTTP lifecycle handling (long-lived streams, cancellation, cleanup) may introduce subtle regressions if route integration differs from existing SSE/socket route conventions.

## Execution Prompt for Codex
Implement the approved plan below.

Goal:
Add hub-wide MCP Streamable HTTP transport so the hub can serve MCP requests across multiple sessions in a single authenticated namespace, with no implicit “current session” behavior. The new endpoint should use explicit identifiers (such as `sessionId` and/or `machineId`) in tool inputs, enforce namespace-scoped authorization, and provide parity with existing streamable HTTP behavior already used in the CLI.

Acceptance criteria:
- Hub exposes a new authenticated MCP Streamable HTTP endpoint under the existing namespace-authenticated web routing stack, and it supports concurrent requests for multiple sessions.
- MCP tool handlers reachable through this endpoint require explicit scope identifiers (at minimum `sessionId`; `machineId` where tool semantics require machine scope), and requests missing required IDs fail with a protocol-appropriate invalid-params error.
- Authorization and namespace isolation are enforced: caller token/identity must be authorized for the namespace and for the referenced explicit IDs; cross-namespace or unauthorized ID access is denied.
- Existing hub REST/SSE/socket behavior remains unchanged, and no session-scoped implicit context is introduced into MCP tool execution.
- Automated tests cover: successful multi-session usage, missing-ID validation failures, unauthorized namespace/ID access rejection, and at least one regression case proving no implicit current-session fallback.

Constraints:
- Keep the patch minimal and reversible; prefer route/middleware additions over broad refactors.
- Reuse existing MCP Streamable HTTP implementation patterns from `cli/src/claude/utils/startHappyServer.ts` and bridge behavior from `cli/src/codex/happyMcpStdioBridge.ts` without changing CLI behavior.
- Do not add new dependencies or change public APIs outside the new hub MCP endpoint and explicit MCP tool input contracts required for hub-wide scope.

Target files:
- `hub/src/web/routes/mcpHttp.ts`
- `hub/src/web/routes/index.ts`
- `hub/src/web/routes/authNamespaceRouter.ts`
- `hub/src/mcp/server/createHubMcpHttpServer.ts`
- `hub/src/mcp/tools/index.ts`
- `hub/src/mcp/tools/schemas.ts`
- `hub/src/mcp/tools/contextGuards.ts`
- `hub/src/web/routes/__tests__/mcpHttp.test.ts`
- `hub/src/web/routes/__tests__/mcpHttp.auth.test.ts`

Required test commands:
- `pnpm --filter hub test -- mcpHttp.test.ts`
- `pnpm --filter hub test -- mcpHttp.auth.test.ts`
- `pnpm --filter hub test`
- `pnpm --filter hub typecheck`

Rules:
- Make the smallest patch that satisfies the plan.
- Stay within target files unless absolutely necessary.
- If you must change additional files, explain why.
- Run the required tests after editing when possible.
- Return:
  1. summary of changes
  2. files changed
  3. commands run
  4. test results
  5. unresolved concerns
