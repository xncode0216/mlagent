import asyncio
import json
from collections.abc import AsyncIterator, Sequence

import httpx

from app.services.agent_orchestrator_service import AgentOrchestrator
from app.services.llm.base import (
    ChatMessage,
    ChatResult,
    LLMClient,
    LLMResponseError,
    ToolSpec,
    sse_payload,
)
from app.services.llm.anthropic import AnthropicClient
from app.services.llm.openai_compat import OpenAICompatibleClient


async def _acollect(agen):
    return [item async for item in agen]


def collect(agen):
    return asyncio.run(_acollect(agen))


def _sse(*payloads: str) -> bytes:
    return "".join(f"data: {payload}\n\n" for payload in payloads).encode()


def _stream_transport(body: bytes, status: int = 200) -> httpx.MockTransport:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=body)

    return httpx.MockTransport(handler)


# --- SSE helper --------------------------------------------------------------

def test_sse_payload_extracts_data_lines():
    assert sse_payload("data: hello") == "hello"
    assert sse_payload("data: [DONE]") == "[DONE]"
    assert sse_payload("event: ping") is None
    assert sse_payload("") is None


# --- Provider streaming ------------------------------------------------------

def test_openai_stream_yields_content_deltas():
    body = _sse(
        json.dumps({"choices": [{"delta": {"content": "Hello"}}]}),
        json.dumps({"choices": [{"delta": {"content": " world"}}]}),
        "[DONE]",
    )
    client = OpenAICompatibleClient(
        model="m", api_key="k", base_url="https://t/v1", transport=_stream_transport(body)
    )
    assert collect(client.stream([ChatMessage.user("hi")])) == ["Hello", " world"]


def test_anthropic_stream_yields_text_deltas():
    body = _sse(
        json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}}),
        json.dumps({"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
        json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": " there"}}),
    )
    client = AnthropicClient(
        model="m", api_key="k", base_url="https://a", transport=_stream_transport(body)
    )
    assert collect(client.stream([ChatMessage.user("hi")])) == ["Hi", " there"]


def test_default_stream_emits_full_completion_once():
    class _CompleteOnly(LLMClient):
        provider = "x"

        async def complete(
            self,
            messages: Sequence[ChatMessage],
            *,
            tools: Sequence[ToolSpec] | None = None,
            temperature: float | None = None,
            max_tokens: int | None = None,
        ) -> ChatResult:
            return ChatResult(content="full reply")

    assert collect(_CompleteOnly().stream([ChatMessage.user("hi")])) == ["full reply"]


# --- Orchestrator streamed reply --------------------------------------------

class _StreamFake(LLMClient):
    provider = "fake"

    def __init__(self, *, chunks: Sequence[str] = (), error: Exception | None = None):
        self._chunks = chunks
        self._error = error

    async def complete(self, messages, *, tools=None, temperature=None, max_tokens=None):
        raise NotImplementedError

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        if self._error is not None:
            raise self._error
        for chunk in self._chunks:
            yield chunk


def _deltas(events):
    return "".join(e["delta"] for e in events if e["type"] == "message_delta")


def test_emit_llm_message_streams_real_reply():
    orchestrator = AgentOrchestrator(session_id="t", llm_client=_StreamFake(chunks=["Hel", "lo"]))
    events = collect(
        orchestrator._emit_llm_message(messages=[ChatMessage.user("hi")], fallback_text="fb")
    )
    assert _deltas(events) == "Hello"


def test_emit_llm_message_falls_back_without_client():
    orchestrator = AgentOrchestrator(session_id="t")
    orchestrator._llm_client = None
    events = collect(
        orchestrator._emit_llm_message(messages=[ChatMessage.user("hi")], fallback_text="hello")
    )
    assert _deltas(events) == "hello"


def test_emit_llm_message_falls_back_on_error():
    orchestrator = AgentOrchestrator(
        session_id="t", llm_client=_StreamFake(error=LLMResponseError("down"))
    )
    events = collect(
        orchestrator._emit_llm_message(messages=[ChatMessage.user("hi")], fallback_text="hello")
    )
    assert _deltas(events) == "hello"
