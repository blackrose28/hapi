import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx
from openai import AsyncOpenAI


# -----------------------------
# Config
# -----------------------------

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.getenv("MODEL", "gpt-5.4")

MCP_BASE_URL = os.environ["MCP_BASE_URL"]  # e.g. https://your-mcp-server.example.com/mcp
POLL_INTERVAL_SECONDS = float(os.getenv("POLL_INTERVAL_SECONDS", "2.0"))
POLL_LIMIT = int(os.getenv("POLL_LIMIT", "20"))
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))


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
    offset: int = 0
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

class MCPClient:
    def __init__(self, base_url: str, timeout_seconds: float = 30):
        self.base_url = base_url
        self.http = httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        await self.http.aclose()

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
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

        resp = await self.http.post(self.base_url, json=payload)
        resp.raise_for_status()
        data = resp.json()

        if "error" in data:
            raise RuntimeError(f"MCP error calling {tool_name}: {data['error']}")

        return data.get("result", {})

    async def send_message(
        self,
        conversation_id: str,
        message: str,
        sender: str = "proxy",
    ) -> Dict[str, Any]:
        return await self.call_tool(
            "send_message",
            {
                "id": conversation_id,
                "message": message,
                "sender": sender,
            },
        )

    async def get_messages(
        self,
        conversation_id: str,
        offset: int,
        limit: int,
    ) -> Dict[str, Any]:
        return await self.call_tool(
            "get_messages",
            {
                "id": conversation_id,
                "offset": offset,
                "limit": limit,
            },
        )


# -----------------------------
# LLM policy engine
# -----------------------------

class ProxyBrain:
    def __init__(self, model: str):
        self.client = AsyncOpenAI(api_key=OPENAI_API_KEY)
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
        # Simple heuristic first.
        # You can replace this with another model call if needed.
        content = new_message.content.lower()

        ignore_patterns = [
            "ack",
            "received",
            "done",
            "completed",
        ]
        if any(p == content.strip() for p in ignore_patterns):
            return False

        # Usually reply to coding_agent messages.
        return new_message.role == "coding_agent"


# -----------------------------
# Parsing helpers
# -----------------------------
#
# Adapt these to your real message schema.

def parse_messages(result: Dict[str, Any]) -> List[Message]:
    raw_messages = result.get("messages", [])
    parsed: List[Message] = []

    for item in raw_messages:
        parsed.append(
            Message(
                message_id=str(item.get("message_id") or item.get("id") or ""),
                role=item.get("role") or item.get("sender") or "unknown",
                content=item.get("content") or item.get("message") or "",
                created_at=item.get("created_at"),
                raw=item,
            )
        )

    return parsed


def infer_done(messages: List[Message]) -> bool:
    for m in messages:
        text = m.content.lower()
        if "task completed" in text or "fix applied" in text or "done" == text.strip():
            return True
    return False


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
        conversation_id: str,
        initial_message: str,
        session_goal: str = DEFAULT_SESSION_GOAL,
    ) -> ConversationState:
        state = ConversationState(conversation_id=conversation_id)

        # Initial instruction to coding agent
        await self.mcp.send_message(
            conversation_id=conversation_id,
            message=initial_message,
            sender="proxy",
        )

        state.history.append(
            Message(
                message_id=f"local-{int(time.time())}",
                role="proxy",
                content=initial_message,
            )
        )

        # Run loop
        while not state.done:
            result = await self.mcp.get_messages(
                conversation_id=conversation_id,
                offset=state.offset,
                limit=self.poll_limit,
            )

            messages = parse_messages(result)

            if not messages:
                await asyncio.sleep(self.poll_interval_seconds)
                continue

            for msg in messages:
                state.offset += 1
                state.history.append(msg)

                if msg.role == "proxy":
                    # Skip our own messages coming back from server if mirrored.
                    continue

                if infer_done([msg]):
                    print(f"[DONE SIGNAL] {msg.content}")
                    state.done = True
                    break

                if await self.brain.should_respond(state.history, msg):
                    reply = await self.brain.generate_reply(
                        session_goal=session_goal,
                        conversation_history=state.history,
                        new_message=msg,
                    )

                    if reply:
                        print(f"[CODING AGENT] {msg.content}")
                        print(f"[PROXY REPLY ] {reply}\n")

                        await self.mcp.send_message(
                            conversation_id=conversation_id,
                            message=reply,
                            sender="proxy",
                        )

                        state.history.append(
                            Message(
                                message_id=f"local-{uuid.uuid4()}",
                                role="proxy",
                                content=reply,
                            )
                        )

            await asyncio.sleep(self.poll_interval_seconds)

        return state


# -----------------------------
# Example usage
# -----------------------------

async def main() -> None:
    conversation_id = f"conv-{uuid.uuid4()}"

    initial_message = """
Please solve the current problem with the smallest safe change first.
Do not break unrelated features.
Avoid broad refactors unless they are clearly necessary.
Before risky edits, call out regression risks and impacted components.
Prefer local fixes and validation steps or tests around changed behavior.
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
            conversation_id=conversation_id,
            initial_message=initial_message,
            session_goal=DEFAULT_SESSION_GOAL,
        )
        print(f"Conversation finished. Total messages: {len(final_state.history)}")
    finally:
        await mcp.close()


if __name__ == "__main__":
    asyncio.run(main())