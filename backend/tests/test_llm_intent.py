import asyncio
from collections.abc import Sequence

from app.services.agent_orchestrator_service import AgentOrchestrator
from app.services.llm.base import ChatMessage, ChatResult, LLMClient, LLMResponseError, ToolCall, ToolSpec
from app.services.llm_intent import classify_intent_with_llm


class _FakeClient(LLMClient):
    provider = "fake"

    def __init__(self, *, result: ChatResult | None = None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.calls: list[dict] = []

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult:
        self.calls.append({"messages": list(messages), "tools": list(tools or [])})
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _routed(intent: str) -> ChatResult:
    return ChatResult(
        content=None,
        tool_calls=(ToolCall(id="1", name="route_intent", arguments={"intent": intent}),),
    )


def test_classify_uses_tool_call_intent():
    client = _FakeClient(result=_routed("configure_export"))
    intent = asyncio.run(classify_intent_with_llm(client, "ship the bundle", fallback="analysis_overview"))
    assert intent == "configure_export"
    # The routing call exposes the route_intent tool to the model.
    assert client.calls[0]["tools"][0].name == "route_intent"


def test_classify_falls_back_on_unknown_intent():
    client = _FakeClient(result=_routed("not_a_real_intent"))
    intent = asyncio.run(classify_intent_with_llm(client, "???", fallback="configure_training"))
    assert intent == "configure_training"


def test_classify_falls_back_on_llm_error():
    client = _FakeClient(error=LLMResponseError("boom"))
    intent = asyncio.run(classify_intent_with_llm(client, "train it", fallback="configure_training"))
    assert intent == "configure_training"


def test_classify_accepts_bare_content_intent():
    client = _FakeClient(result=ChatResult(content="configure_profile"))
    intent = asyncio.run(classify_intent_with_llm(client, "show stats", fallback="analysis_overview"))
    assert intent == "configure_profile"


def test_orchestrator_without_llm_uses_keyword_classifier():
    orchestrator = AgentOrchestrator(session_id="t", llm_client=None)
    assert asyncio.run(orchestrator._resolve_intent("please train a sklearn model")) == "configure_training"


def test_orchestrator_llm_overrides_keyword_when_configured():
    # Keyword routing would call this "analysis_overview"; the LLM picks export.
    client = _FakeClient(result=_routed("configure_export"))
    orchestrator = AgentOrchestrator(session_id="t", llm_client=client)
    assert asyncio.run(orchestrator._resolve_intent("wrap everything up for handoff")) == "configure_export"


def test_orchestrator_falls_back_to_keyword_on_llm_error():
    client = _FakeClient(error=LLMResponseError("down"))
    orchestrator = AgentOrchestrator(session_id="t", llm_client=client)
    assert asyncio.run(orchestrator._resolve_intent("please train a sklearn model")) == "configure_training"
