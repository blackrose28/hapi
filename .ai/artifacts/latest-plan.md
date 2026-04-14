## Goal
Harden MCP result parsing in `/home/chuonglv/Work/hapi/orchestrator/main.py` so `parse_messages` accepts both JSON payload shapes returned inside `result.content[0].text`: an object with `messages` and a bare array of messages, while preserving existing safe-failure behavior for `isError`, missing content, and malformed JSON.

## Acceptance Criteria
- `parse_messages` correctly parses message lists from both payload shapes:
  - `{"messages": [...]}`
  - `[...]`
- Existing defensive behavior remains intact: returns `[]` (without crashing) for `result.isError`, missing/invalid `content`, non-JSON text, or unsupported decoded JSON types.
- No changes are made to MCP server behavior or tool call contracts (`send_message`, `get_messages_after` arguments and usage remain unchanged).

## Constraints
- Keep the patch minimal and localized, ideally only `/home/chuonglv/Work/hapi/orchestrator/main.py`.
- Do not change server-side code or hub MCP API contract assumptions outside parsing tolerance.
- Preserve current message field mapping/fallback behavior (`message_id/id`, `role/sender`, `content/message`) unless strictly needed for the parsing fix.

## Target Files
- /home/chuonglv/Work/hapi/orchestrator/main.py

## Test Plan
- `python3 -m py_compile /home/chuonglv/Work/hapi/orchestrator/main.py`
- `OPENAI_API_KEY=dummy SESSION_ID=dummy MCP_BASE_URL=http://localhost python3 - <<'PY'
import os, json, importlib.util
path = "/home/chuonglv/Work/hapi/orchestrator/main.py"
spec = importlib.util.spec_from_file_location("orch_main", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def wrap(payload):
    return {"content":[{"type":"text","text":json.dumps(payload)}], "isError": False}

msgs_obj = mod.parse_messages(wrap({"messages":[{"id":"1","role":"coding_agent","content":"hi"}]}))
assert len(msgs_obj) == 1 and msgs_obj[0].message_id == "1"

msgs_arr = mod.parse_messages(wrap([{"id":"2","sender":"coding_agent","message":"hello"}]))
assert len(msgs_arr) == 1 and msgs_arr[0].message_id == "2"

assert mod.parse_messages({"isError": True, "content":[{"text":"[]"}]}) == []
assert mod.parse_messages({"content":[]}) == []
assert mod.parse_messages({"content":[{"type":"text","text":"not-json"}]}) == []
assert mod.parse_messages(wrap({"unexpected":"shape"})) == []
print("parse_messages payload-shape hardening checks passed")
PY`

## Risks
- If other undocumented payload shapes are returned (e.g., nested wrappers), this minimal fix may still ignore them by returning `[]`.
- Small parsing changes could inadvertently alter behavior for edge-case payloads if type checks are too permissive or too strict.

## Execution Prompt for Codex
Implement the approved plan below.

Goal:
Harden MCP result parsing in `/home/chuonglv/Work/hapi/orchestrator/main.py` so `parse_messages` accepts both JSON payload shapes returned inside `result.content[0].text`: an object with `messages` and a bare array of messages, while preserving existing safe-failure behavior for `isError`, missing content, and malformed JSON.

Acceptance criteria:
- `parse_messages` correctly parses message lists from both payload shapes:
  - `{"messages": [...]}`
  - `[...]`
- Existing defensive behavior remains intact: returns `[]` (without crashing) for `result.isError`, missing/invalid `content`, non-JSON text, or unsupported decoded JSON types.
- No changes are made to MCP server behavior or tool call contracts (`send_message`, `get_messages_after` arguments and usage remain unchanged).

Constraints:
- Keep the patch minimal and localized, ideally only `/home/chuonglv/Work/hapi/orchestrator/main.py`.
- Do not change server-side code or hub MCP API contract assumptions outside parsing tolerance.
- Preserve current message field mapping/fallback behavior (`message_id/id`, `role/sender`, `content/message`) unless strictly needed for the parsing fix.

Target files:
- /home/chuonglv/Work/hapi/orchestrator/main.py

Required test commands:
- `python3 -m py_compile /home/chuonglv/Work/hapi/orchestrator/main.py`
- `OPENAI_API_KEY=dummy SESSION_ID=dummy MCP_BASE_URL=http://localhost python3 - <<'PY'
import os, json, importlib.util
path = "/home/chuonglv/Work/hapi/orchestrator/main.py"
spec = importlib.util.spec_from_file_location("orch_main", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def wrap(payload):
    return {"content":[{"type":"text","text":json.dumps(payload)}], "isError": False}

msgs_obj = mod.parse_messages(wrap({"messages":[{"id":"1","role":"coding_agent","content":"hi"}]}))
assert len(msgs_obj) == 1 and msgs_obj[0].message_id == "1"

msgs_arr = mod.parse_messages(wrap([{"id":"2","sender":"coding_agent","message":"hello"}]))
assert len(msgs_arr) == 1 and msgs_arr[0].message_id == "2"

assert mod.parse_messages({"isError": True, "content":[{"text":"[]"}]}) == []
assert mod.parse_messages({"content":[]}) == []
assert mod.parse_messages({"content":[{"type":"text","text":"not-json"}]}) == []
assert mod.parse_messages(wrap({"unexpected":"shape"})) == []
print("parse_messages payload-shape hardening checks passed")
PY`

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
