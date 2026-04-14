## Goal
Update `/home/chuonglv/Work/hapi/orchestrator/main.py` so the orchestrator automatically authenticates against the hub by exchanging `MCP_ACCESS_TOKEN` at `/api/auth`, then uses and proactively refreshes the returned JWT for MCP calls without requiring manual JWT minting.

## Acceptance Criteria
- `MCPClient` reads `MCP_ACCESS_TOKEN` from env, derives auth URL from `MCP_BASE_URL` (same origin, `/api/auth`), and exchanges `{ "accessToken": "<MCP_ACCESS_TOKEN>" }` before MCP tool calls.
- MCP requests to `MCP_BASE_URL` include `Authorization: Bearer <jwt>` using an in-memory cached JWT.
- JWT refresh happens proactively before expiry (using JWT `exp` with a safety window) instead of waiting for `401`; if no valid cached token exists, client re-authenticates.
- Existing orchestrator behavior (tool payloads, polling loop, message flow) remains unchanged aside from auth lifecycle.
- Failure paths are explicit: missing `MCP_ACCESS_TOKEN`, auth exchange failure, or invalid auth response raise clear runtime errors.

## Constraints
- Keep the patch minimal and reversible, ideally only `/home/chuonglv/Work/hapi/orchestrator/main.py`.
- Do not add new dependencies or broad auth abstractions; use standard library + existing `httpx`.
- Do not change MCP JSON-RPC method/payload contracts or agent loop semantics.

## Target Files
- /home/chuonglv/Work/hapi/orchestrator/main.py

## Test Plan
- `python3 -m py_compile /home/chuonglv/Work/hapi/orchestrator/main.py`
- `MCP_BASE_URL='https://example.com/api/mcp' MCP_ACCESS_TOKEN='dummy' OPENAI_API_KEY='dummy' SESSION_ID='dummy' python3 /home/chuonglv/Work/hapi/orchestrator/main.py` (expect auth/network failure path to execute cleanly with explicit error, validating startup/auth wiring)
- `python3 - <<'PY'
from urllib.parse import urlparse
u='https://hub.example.com/api/mcp'
p=urlparse(u)
print(f'{p.scheme}://{p.netloc}/api/auth')
PY` (sanity-check expected auth endpoint shape used by implementation)

## Risks
- If `MCP_BASE_URL` does not follow expected `/api/mcp` shape, naive URL derivation could target wrong auth endpoint.
- JWT `exp` parsing and local clock skew may cause early/late refresh behavior; include a conservative refresh buffer.

## Execution Prompt for Codex
Implement the approved plan below.

Goal:
Update `/home/chuonglv/Work/hapi/orchestrator/main.py` so the orchestrator automatically authenticates against the hub by exchanging `MCP_ACCESS_TOKEN` at `/api/auth`, then uses and proactively refreshes the returned JWT for MCP calls without requiring manual JWT minting.

Acceptance criteria:
- `MCPClient` reads `MCP_ACCESS_TOKEN` from env, derives auth URL from `MCP_BASE_URL` (same origin, `/api/auth`), and exchanges `{ "accessToken": "<MCP_ACCESS_TOKEN>" }` before MCP tool calls.
- MCP requests to `MCP_BASE_URL` include `Authorization: Bearer <jwt>` using an in-memory cached JWT.
- JWT refresh happens proactively before expiry (using JWT `exp` with a safety window) instead of waiting for `401`; if no valid cached token exists, client re-authenticates.
- Existing orchestrator behavior (tool payloads, polling loop, message flow) remains unchanged aside from auth lifecycle.
- Failure paths are explicit: missing `MCP_ACCESS_TOKEN`, auth exchange failure, or invalid auth response raise clear runtime errors.

Constraints:
- Keep the patch minimal and reversible, ideally only `/home/chuonglv/Work/hapi/orchestrator/main.py`.
- Do not add new dependencies or broad auth abstractions; use standard library + existing `httpx`.
- Do not change MCP JSON-RPC method/payload contracts or agent loop semantics.

Target files:
- /home/chuonglv/Work/hapi/orchestrator/main.py

Required test commands:
- `python3 -m py_compile /home/chuonglv/Work/hapi/orchestrator/main.py`
- `MCP_BASE_URL='https://example.com/api/mcp' MCP_ACCESS_TOKEN='dummy' OPENAI_API_KEY='dummy' SESSION_ID='dummy' python3 /home/chuonglv/Work/hapi/orchestrator/main.py` (expect auth/network failure path to execute cleanly with explicit error, validating startup/auth wiring)
- `python3 - <<'PY'
from urllib.parse import urlparse
u='https://hub.example.com/api/mcp'
p=urlparse(u)
print(f'{p.scheme}://{p.netloc}/api/auth')
PY` (sanity-check expected auth endpoint shape used by implementation)

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

Notes:
- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.
- In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing (e.g., a bug you found, a function signature the caller asked for) — do not recap code you merely read.
- For clear communication with the user the assistant MUST avoid using emojis.
- Do not use a colon before tool calls. Text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.
