from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

import asyncio
import base64
import json
import logging
import os
import sys
import time
import uuid
from urllib.parse import urlparse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx
from openai import AsyncOpenAI


# -----------------------------
# Logging setup
# -----------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

class _Formatter(logging.Formatter):
    """Compact colored formatter for console output."""
    COLORS = {
        logging.DEBUG: "\033[90m",     # grey
        logging.INFO: "\033[36m",      # cyan
        logging.WARNING: "\033[33m",   # yellow
        logging.ERROR: "\033[31m",     # red
        logging.CRITICAL: "\033[1;31m", # bold red
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno, self.RESET)
        ts = self.formatTime(record, "%H:%M:%S")
        msg = f"{color}{ts} [{record.levelname[0]}] {record.getMessage()}{self.RESET}"
        if record.exc_info and record.exc_info[1] is not None:
            msg += f"\n{self.formatException(record.exc_info)}"
        return msg

_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(_Formatter())

log = logging.getLogger("orchestrator")
log.addHandler(_handler)
log.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))


# -----------------------------
# Config
# -----------------------------

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.getenv("MODEL", "gpt-5.4")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")  # Optional: target LiteLLM or other OpenAI-compatible providers (Responses API compat varies)

SESSION_ID = os.environ["SESSION_ID"]
MCP_BASE_URL = os.environ["MCP_BASE_URL"]  # e.g. https://your-mcp-server.example.com/mcp
MCP_ACCESS_TOKEN = os.environ.get("MCP_ACCESS_TOKEN")
JWT_REFRESH_WINDOW_SECONDS = float(os.getenv("JWT_REFRESH_WINDOW_SECONDS", "60"))
POLL_INTERVAL_SECONDS = float(os.getenv("POLL_INTERVAL_SECONDS", "2.0"))
POLL_LIMIT = int(os.getenv("POLL_LIMIT", "20"))
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))


# SESSION_ID validation (after all imports loaded)
if not SESSION_ID:
    raise SystemExit("SESSION_ID env var is required and must not be empty")

log.info("📋 Config loaded: model=%s session=%s poll=%.1fs", MODEL, SESSION_ID, POLL_INTERVAL_SECONDS)
log.debug("   MCP_BASE_URL=%s  OPENAI_BASE_URL=%s", MCP_BASE_URL, OPENAI_BASE_URL or "(default)")

# -----------------------------
# Persona / policy
# -----------------------------

SYSTEM_PROMPT = """
You are Chuong's proxy when talking to an AI Coding Agent.

Behavior:
- Prioritize finishing the requested task.
- Prefer the smallest safe change first.
- Strongly avoid breaking existing features.
- Avoid broad refactors unless clearly necessary.
- Prefer local, rollback-friendly changes.
- Ask the coding agent to call out regression risk when proposing risky edits.
- Prefer tests or validation steps around changed behavior.
- Be concise, practical, direct, and decisive.
- Do not ask unnecessary questions.
- If multiple approaches exist, prefer the one with lower regression risk.
"""

DEFAULT_SESSION_GOAL = """
Current goal:
Work with the AI Coding Agent to solve the current coding problem.

Constraints:
- Do not break unrelated features.
- Preserve existing behavior where possible.
- Prefer minimal edits over broad rewrites.
- Ask for impacted components and regression risks if the change is non-trivial.
"""


# -----------------------------
# Data models
# -----------------------------

@dataclass
class Message:
    message_id: str
    role: str               # e.g. "coding_agent", "proxy", "system"
    content: str
    created_at: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ConversationState:
    conversation_id: str
    after_seq: int = 0
    done: bool = False
    history: List[Message] = field(default_factory=list)


# -----------------------------
# Minimal MCP JSON-RPC client
# -----------------------------
#
# Adapt this to your real MCP server.
# Some servers expose a single JSON-RPC endpoint.
# Some wrap calls differently.
#
# This version assumes:
# POST MCP_BASE_URL
# {
#   "jsonrpc": "2.0",
#   "id": "...",
#   "method": "tools/call",
#   "params": {
#       "name": "<tool_name>",
#       "arguments": {...}
#   }
# }
#

def _parse_jwt_exp(token: str) -> float:
    """Decode JWT payload and return numeric exp claim. Raises on any issue."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError(f"JWT must have 3 dot-separated segments, got {len(parts)}")
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception as e:
        raise ValueError(f"Cannot decode JWT payload: {e}") from e
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        raise ValueError(f"JWT payload missing or non-numeric 'exp' claim, got {type(exp).__name__}: {exp!r}")
    return float(exp)


class MCPClient:
    def __init__(self, base_url: str, timeout_seconds: float = 30):
        self.base_url = base_url
        self.http = httpx.AsyncClient(timeout=timeout_seconds)
        self._jwt: Optional[str] = None
        self._jwt_exp: Optional[float] = None
        parsed = urlparse(base_url)
        self._auth_url = f"{parsed.scheme}://{parsed.netloc}/api/auth"

    async def close(self) -> None:
        await self.http.aclose()

    def _is_jwt_valid(self) -> bool:
        if not self._jwt or self._jwt_exp is None:
            return False
        return time.time() < (self._jwt_exp - JWT_REFRESH_WINDOW_SECONDS)

    async def _authenticate(self) -> None:
        if not MCP_ACCESS_TOKEN:
            raise RuntimeError(
                "MCP_ACCESS_TOKEN env var is required for hub authentication"
            )
        log.info("🔑 Authenticating with hub at %s", self._auth_url)
        resp = await self.http.post(
            self._auth_url,
            json={"accessToken": MCP_ACCESS_TOKEN},
        )
        if resp.status_code == 401:
            raise RuntimeError(
                f"Hub auth rejected: invalid MCP_ACCESS_TOKEN (HTTP {resp.status_code})"
            )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("token")
        if not token or not isinstance(token, str):
            raise RuntimeError(
                f"Hub auth response missing 'token' field: {list(data.keys())}"
            )
        try:
            self._jwt_exp = _parse_jwt_exp(token)
        except ValueError as e:
            raise RuntimeError(f"Hub auth returned invalid JWT: {e}") from e
        self._jwt = token
        ttl = int(self._jwt_exp - time.time())
        log.info("🔑 Authenticated — JWT expires in %ds", ttl)

    async def _ensure_token(self) -> None:
        if not self._is_jwt_valid():
            log.debug("🔑 JWT expired or missing, re-authenticating...")
            await self._authenticate()

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        await self._ensure_token()
        request_id = str(uuid.uuid4())
        payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        log.debug("📡 MCP call: %s(%s)", tool_name, json.dumps(arguments, ensure_ascii=False)[:200])
        headers = {"Authorization": f"Bearer {self._jwt}"}
        resp = await self.http.post(self.base_url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            log.error("❌ MCP error on %s: %s", tool_name, data['error'])
            raise RuntimeError(f"MCP error calling {tool_name}: {data['error']}")
        log.debug("📡 MCP %s -> ok", tool_name)
        return data.get("result", {})

    async def send_message(
        self,
        session_id: str,
        text: str,
    ) -> Dict[str, Any]:
        return await self.call_tool(
            "send_message",
            {
                "sessionId": session_id,
                "text": text,
            },
        )

    async def get_messages_after(
        self,
        session_id: str,
        after_seq: int,
        limit: int,
    ) -> Dict[str, Any]:
        return await self.call_tool(
            "get_messages_after",
            {
                "sessionId": session_id,
                "afterSeq": after_seq,
                "limit": limit,
            },
        )


# -----------------------------
# LLM policy engine
# -----------------------------

class ProxyBrain:
    def __init__(self, model: str):
        self.client = AsyncOpenAI(
            api_key=OPENAI_API_KEY,
            **({"base_url": OPENAI_BASE_URL} if OPENAI_BASE_URL else {}),
        )
        self.model = model

    async def generate_reply(
        self,
        session_goal: str,
        conversation_history: List[Message],
        new_message: Message,
    ) -> str:
        # Keep context compact for MVP.
        history_text = "\n".join(
            f"[{m.role}] {m.content}" for m in conversation_history[-20:]
        )

        user_prompt = f"""
Session instructions:
{session_goal}

Conversation so far:
{history_text}

Latest incoming message from AI Coding Agent:
[{new_message.role}] {new_message.content}

Write Chuong's reply to the AI Coding Agent.

Rules:
- Be concise and practical.
- Prefer the smallest safe fix.
- Protect existing features.
- Push back on risky refactors unless necessary.
- If useful, ask for regression risks, affected modules, and validation steps.
- Output only the reply text.
"""

        response = await self.client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )

        return response.output_text.strip()

    async def should_respond(
        self,
        conversation_history: List[Message],
        new_message: Message,
    ) -> bool:
        # Only respond when the agent signals it finished its turn.
        # StoredMessage.content shape: { role: "agent", content: { type: "event", data: { type: "ready" } } }
        if new_message.role not in ("assistant", "agent"):
            return False

        raw_content = new_message.raw.get("content", {})
        if not isinstance(raw_content, dict):
            return False

        # The event payload may be at top level or nested under "content"
        inner = raw_content.get("content", raw_content)
        if not isinstance(inner, dict):
            return False

        if inner.get("type") == "event":
            data = inner.get("data", {})
            if isinstance(data, dict) and data.get("type") == "ready":
                return True

        return False

    async def is_task_done(
        self,
        session_goal: str,
        conversation_history: List[Message],
    ) -> bool:
        """Ask the LLM whether the session goal has been achieved."""
        history_text = "\n".join(
            f"[{m.role}] {m.content}" for m in conversation_history[-30:]
        )

        prompt = f"""
You are evaluating whether a coding task is complete.

Session goal:
{session_goal}

Recent conversation:
{history_text}

Based on the conversation, has the coding agent fully completed the task described in the session goal?

Consider:
- Did the agent make all requested changes?
- Did the agent confirm the changes work (tests pass, build succeeds, etc.)?
- Are there remaining action items, open questions, or unresolved issues?
- Did the agent explicitly signal completion?

Respond with exactly one word: YES or NO
"""

        try:
            response = await self.client.responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": "You evaluate task completion. Respond with exactly YES or NO."},
                    {"role": "user", "content": prompt},
                ],
            )
            answer = response.output_text.strip().upper()
            log.debug("   🏁 is_task_done LLM answer: %s", answer)
            return answer.startswith("YES")
        except Exception:
            log.exception("⚠️ is_task_done LLM call failed, assuming not done")
            return False


# -----------------------------
# Parsing helpers
# -----------------------------
#
# Hub StoredMessage shape:
#   { id, sessionId, content: <agent_event>, createdAt, seq, localId }
#
# The `content` field is the raw agent event, which may be:
#   - Role-wrapped record:  { role: "assistant", content: [...] }
#   - Envelope:             { message: { role, content } }
#   - Double envelope:      { data: { message: { role, content } } }
#

def _unwrap_role_content(event: Any) -> tuple[str, str]:
    """Extract (role, text_content) from a hub agent event."""
    if not isinstance(event, dict):
        return ("unknown", str(event) if event else "")

    # Direct: { role, content }
    if "role" in event and "content" in event:
        role = event["role"]
        content = event["content"]
    # Envelope: { message: { role, content } }
    elif isinstance(event.get("message"), dict) and "role" in event["message"]:
        role = event["message"]["role"]
        content = event["message"].get("content", "")
    # Double envelope: { data: { message: { role, content } } }
    elif (isinstance(event.get("data"), dict)
          and isinstance(event["data"].get("message"), dict)
          and "role" in event["data"]["message"]):
        role = event["data"]["message"]["role"]
        content = event["data"]["message"].get("content", "")
    else:
        # Fallback: treat whole event as content
        role = event.get("type", "unknown")
        content = event

    # Flatten content to string
    if isinstance(content, list):
        # Claude format: content is array of { type: "text", text: "..." }
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        text = "\n".join(parts) if parts else json.dumps(content, ensure_ascii=False)
    elif isinstance(content, str):
        text = content
    else:
        text = json.dumps(content, ensure_ascii=False) if content else ""

    return (str(role), text)


def parse_messages(result: Dict[str, Any]) -> List[Message]:
    # MCP result: {"content": [{"type": "text", "text": "<json_string>"}], "isError": bool}
    if result.get("isError"):
        log.error("❌ MCP returned error: %s", result)
        return []

    content_list = result.get("content", [])
    if not content_list or not isinstance(content_list, list):
        return []

    try:
        payload = json.loads(content_list[0].get("text", ""))
    except (json.JSONDecodeError, AttributeError, TypeError):
        log.error("❌ MCP parse error: could not decode content text")
        return []

    if isinstance(payload, list):
        raw_messages = payload
    elif isinstance(payload, dict):
        raw_messages = payload.get("messages", [])
    else:
        return []

    if not isinstance(raw_messages, list):
        return []

    parsed: List[Message] = []
    for item in raw_messages:
        # item is a StoredMessage: { id, sessionId, content, createdAt, seq, localId }
        event = item.get("content", {})
        role, text = _unwrap_role_content(event)

        parsed.append(
            Message(
                message_id=str(item.get("id") or ""),
                role=role,
                content=text,
                created_at=str(item.get("createdAt", "")),
                raw=item,
            )
        )
        log.debug("   parsed msg seq=%s role=%s content_len=%d",
                  item.get("seq"), role, len(text))

    return parsed


# infer_done removed — done detection is now LLM-based via ProxyBrain.is_task_done


# -----------------------------
# JSONL message logger
# -----------------------------

class MessageLogger:
    """Appends every raw message to a JSONL file for offline debugging."""

    def __init__(self, session_id: str, log_dir: str = "logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.log_dir / f"{session_id}.jsonl"
        self._file = open(self.path, "a", encoding="utf-8")
        log.info("📝 Message log: %s", self.path)

    def log(self, msg: Message) -> None:
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "message_id": msg.message_id,
            "role": msg.role,
            "content": msg.content,
            "created_at": msg.created_at,
            "raw": msg.raw,
        }
        self._file.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._file.flush()

    def close(self) -> None:
        self._file.close()


# -----------------------------
# Main agent loop
# -----------------------------

class MimicProxyAgent:
    def __init__(
        self,
        mcp_client: MCPClient,
        brain: ProxyBrain,
        poll_interval_seconds: float = 2.0,
        poll_limit: int = 20,
    ):
        self.mcp = mcp_client
        self.brain = brain
        self.poll_interval_seconds = poll_interval_seconds
        self.poll_limit = poll_limit

    async def start_conversation(
        self,
        session_id: str,
        initial_message: str,
        session_goal: str = DEFAULT_SESSION_GOAL,
    ) -> ConversationState:
        state = ConversationState(conversation_id=session_id)
        self._msg_log = MessageLogger(session_id)
        poll_count = 0

        # Initial instruction to coding agent
        log.info("🚀 Starting conversation session=%s", session_id)
        log.info("📤 Sending initial message (%d chars)", len(initial_message))
        await self.mcp.send_message(
            session_id=session_id,
            text=initial_message,
        )

        state.history.append(
            Message(
                message_id=f"local-{int(time.time())}",
                role="proxy",
                content=initial_message,
            )
        )

        log.info("⏳ Entering poll loop (interval=%.1fs, limit=%d)",
                 self.poll_interval_seconds, self.poll_limit)

        # Run loop
        while not state.done:
            poll_count += 1
            log.debug("🔄 Poll #%d (after_seq=%d, history=%d msgs)",
                      poll_count, state.after_seq, len(state.history))

            result = await self.mcp.get_messages_after(
                session_id=session_id,
                after_seq=state.after_seq,
                limit=self.poll_limit,
            )

            messages = parse_messages(result)

            if not messages:
                if poll_count % 15 == 0:  # log every ~30s at 2s interval
                    log.info("⏳ Still waiting... (poll #%d, seq=%d)",
                             poll_count, state.after_seq)
                await asyncio.sleep(self.poll_interval_seconds)
                continue

            log.info("📨 Received %d new message(s)", len(messages))

            # --- Process entire batch first, then decide ---
            ready_seen = False
            last_content_msg: Optional[Message] = None

            for msg in messages:
                msg_seq = msg.raw.get("seq")
                if isinstance(msg_seq, int):
                    state.after_seq = max(state.after_seq, msg_seq)
                state.history.append(msg)
                self._msg_log.log(msg)

                preview = msg.content[:120].replace("\n", " ")
                log.info("   [%s] seq=%s: %s%s",
                         msg.role, msg_seq, preview,
                         "..." if len(msg.content) > 120 else "")

                if msg.role == "proxy":
                    log.debug("   ↩ Skipping mirrored proxy message")
                    continue

                # Track ready signal
                is_ready = await self.brain.should_respond(state.history, msg)
                if is_ready:
                    ready_seen = True
                    log.debug("   🔔 Ready signal at seq=%s", msg_seq)

                # Track latest substantive content message from agent
                if msg.role in ("assistant", "agent") and msg.content.strip():
                    last_content_msg = msg

            # --- After full batch: act on ready signal ---
            if ready_seen:
                # Check if the task is done (LLM-based)
                done = await self.brain.is_task_done(
                    session_goal=session_goal,
                    conversation_history=state.history,
                )
                if done:
                    log.info("✅ Task done (LLM confirmed)")
                    state.done = True
                else:
                    # Generate reply using the latest content message
                    reply_target = last_content_msg or messages[-1]
                    log.info("🧠 Generating reply via LLM (%s)...", self.brain.model)
                    reply = await self.brain.generate_reply(
                        session_goal=session_goal,
                        conversation_history=state.history,
                        new_message=reply_target,
                    )

                    if reply:
                        reply_preview = reply[:200].replace("\n", " ")
                        log.info("📤 Proxy reply (%d chars): %s%s",
                                 len(reply), reply_preview,
                                 "..." if len(reply) > 200 else "")

                        await self.mcp.send_message(
                            session_id=session_id,
                            text=reply,
                        )

                        state.history.append(
                            Message(
                                message_id=f"local-{uuid.uuid4()}",
                                role="proxy",
                                content=reply,
                            )
                        )
                    else:
                        log.warning("⚠️ LLM returned empty reply, skipping")

            await asyncio.sleep(self.poll_interval_seconds)

        self._msg_log.close()
        log.info("🏁 Conversation ended. Total messages: %d", len(state.history))
        return state


# -----------------------------
# Example usage
# -----------------------------

async def main() -> None:
    conversation_id = SESSION_ID

    initial_message = """
Review the current changes, and fix the issues if any.
""".strip()

    mcp = MCPClient(MCP_BASE_URL, timeout_seconds=HTTP_TIMEOUT_SECONDS)
    brain = ProxyBrain(model=MODEL)
    agent = MimicProxyAgent(
        mcp_client=mcp,
        brain=brain,
        poll_interval_seconds=POLL_INTERVAL_SECONDS,
        poll_limit=POLL_LIMIT,
    )

    try:
        final_state = await agent.start_conversation(
            session_id=conversation_id,
            initial_message=initial_message,
            session_goal=DEFAULT_SESSION_GOAL,
        )
        log.info("🏁 Conversation finished. Total messages: %d", len(final_state.history))
    except (KeyboardInterrupt, asyncio.CancelledError):
        log.info("⛔ Interrupted by user (Ctrl+C)")
    except Exception:
        log.exception("💥 Unhandled error")
    finally:
        log.info("🧹 Closing MCP client...")
        await mcp.close()
        log.info("👋 Bye.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass  # already handled inside main()