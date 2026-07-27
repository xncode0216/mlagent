"""Tests for the provider-agnostic tool-calling (ReAct) loop and its wiring.

The engine (``run_tool_phase``) and the orchestrator's ``_run_agentic_answer`` are
exercised with a scripted fake client so no network or real provider is involved.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Sequence

from app.services.agent_orchestrator_service import (
    AgentContext,
    AgentOrchestrator,
    _build_analysis_tools,
)
from app.services.llm.base import ChatMessage, ChatResult, LLMClient, ToolCall, ToolSpec
from app.services.llm_agent import ToolCallFinished, ToolCallStarted, run_tool_phase


async def _acollect(agen):
    return [item async for item in agen]


def collect(agen):
    return asyncio.run(_acollect(agen))


def _deltas(events):
    return "".join(e["delta"] for e in events if e["type"] == "message_delta")


class _ScriptedClient(LLMClient):
    """Returns pre-scripted completions in order; streams fixed final chunks."""

    provider = "fake"

    def __init__(
        self,
        *,
        completions: Sequence[ChatResult],
        stream_chunks: Sequence[str] = (),
    ) -> None:
        self._completions = list(completions)
        self._stream_chunks = list(stream_chunks)
        self.complete_calls: list[dict] = []

    async def complete(self, messages, *, tools=None, temperature=None, max_tokens=None):
        self.complete_calls.append({"messages": list(messages), "tools": tools})
        return self._completions.pop(0)

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        for chunk in self._stream_chunks:
            yield chunk


# --- Engine: run_tool_phase --------------------------------------------------

def test_run_tool_phase_executes_then_stops():
    call = ToolCall(id="c1", name="profile_dataset", arguments={})
    client = _ScriptedClient(
        completions=[
            ChatResult(content="", tool_calls=(call,)),
            ChatResult(content="done"),  # no tool calls -> phase ends
        ]
    )
    conversation = [ChatMessage.user("analyze")]
    executed: list[str] = []

    async def execute(c: ToolCall) -> str:
        executed.append(c.name)
        return '{"rows": 3}'

    events = collect(
        run_tool_phase(client, conversation=conversation, tools=[], execute=execute)
    )

    assert [type(e).__name__ for e in events] == ["ToolCallStarted", "ToolCallFinished"]
    assert isinstance(events[0], ToolCallStarted) and events[0].call_id == "c1"
    assert isinstance(events[1], ToolCallFinished)
    assert events[1].error is False and events[1].output == '{"rows": 3}'
    assert executed == ["profile_dataset"]
    # conversation now carries: user, assistant(tool_calls), tool result
    assert conversation[-2].role == "assistant"
    assert conversation[-2].tool_calls[0].name == "profile_dataset"
    assert conversation[-1].role == "tool" and conversation[-1].content == '{"rows": 3}'


def test_run_tool_phase_returns_immediately_without_tool_calls():
    client = _ScriptedClient(completions=[ChatResult(content="hi")])
    conversation = [ChatMessage.user("hi")]

    async def execute(c: ToolCall) -> str:
        raise AssertionError("executor must not run when no tool is requested")

    events = collect(
        run_tool_phase(client, conversation=conversation, tools=[], execute=execute)
    )

    assert events == []
    assert len(conversation) == 1  # untouched


def test_run_tool_phase_surfaces_executor_error_to_model():
    call = ToolCall(id="c1", name="boom", arguments={})
    client = _ScriptedClient(
        completions=[
            ChatResult(content="", tool_calls=(call,)),
            ChatResult(content="recovered"),
        ]
    )
    conversation = [ChatMessage.user("go")]

    async def execute(c: ToolCall) -> str:
        raise RuntimeError("kaboom")

    events = collect(
        run_tool_phase(client, conversation=conversation, tools=[], execute=execute)
    )

    finished = events[1]
    assert isinstance(finished, ToolCallFinished) and finished.error is True
    assert finished.output.startswith("ERROR: kaboom")
    # the error is fed back as the tool result so the model can recover
    assert conversation[-1].role == "tool" and "kaboom" in conversation[-1].content


def test_run_tool_phase_respects_max_iterations():
    call = ToolCall(id="c", name="t", arguments={})
    # The model never stops requesting tools; the bound must stop the loop.
    client = _ScriptedClient(completions=[ChatResult(content="", tool_calls=(call,))] * 10)
    conversation = [ChatMessage.user("go")]
    runs: list[int] = []

    async def execute(c: ToolCall) -> str:
        runs.append(1)
        return "ok"

    events = collect(
        run_tool_phase(
            client, conversation=conversation, tools=[], execute=execute, max_iterations=3
        )
    )

    assert sum(isinstance(e, ToolCallStarted) for e in events) == 3
    assert len(runs) == 3
    assert len(client.complete_calls) == 3


# --- Tool registry: _build_analysis_tools ------------------------------------

def test_build_analysis_tools_executes_known_and_reports_unknown(tmp_path):
    csv = tmp_path / "d.csv"
    csv.write_text("a,b\n1,2\n3,4\n5,6\n")
    specs, execute = _build_analysis_tools(csv)

    assert {s.name for s in specs} >= {
        "profile_dataset",
        "detect_missing",
        "correlation_matrix",
    }

    out = asyncio.run(execute(ToolCall(id="x", name="detect_missing", arguments={})))
    assert isinstance(out, str) and len(out) <= 1500
    json.loads(out)  # truncated payload is still valid JSON for this tiny dataset

    unknown = asyncio.run(execute(ToolCall(id="y", name="nope", arguments={})))
    assert unknown.startswith("ERROR: unknown tool")


# --- Orchestrator wiring: _run_agentic_answer --------------------------------

def test_run_agentic_answer_emits_tool_events_then_streams_reply(tmp_path):
    csv = tmp_path / "d.csv"
    csv.write_text("a,b\n1,2\n3,4\n5,6\n")
    ctx = AgentContext(
        project_id="p",
        project_root=tmp_path,
        active_file="d.csv",
        csv_path=csv,
        mode="analysis",
        session_service=None,
    )
    call = ToolCall(id="c1", name="profile_dataset", arguments={})
    client = _ScriptedClient(
        completions=[
            ChatResult(content="", tool_calls=(call,)),  # request a tool
            ChatResult(content="ignored"),  # then stop -> stream the answer
        ],
        stream_chunks=["Your data ", "looks clean."],
    )
    orch = AgentOrchestrator(session_id="t", llm_client=client)

    events = collect(
        orch._run_agentic_answer(
            agent_context=ctx, content="analyze this", fallback_text="fb"
        )
    )

    started = next(e for e in events if e["type"] == "tool_call_started")
    assert started["tool"] == "profile_dataset" and started["call_id"] == "c1"
    finished = next(e for e in events if e["type"] == "tool_call_finished")
    assert finished["status"] == "success" and finished["call_id"] == "c1"
    assert _deltas(events) == "Your data looks clean."


def test_run_agentic_answer_without_llm_emits_fallback(tmp_path):
    csv = tmp_path / "d.csv"
    csv.write_text("a,b\n1,2\n")
    ctx = AgentContext(
        project_id="p",
        project_root=tmp_path,
        active_file="d.csv",
        csv_path=csv,
        mode="analysis",
        session_service=None,
    )
    orch = AgentOrchestrator(session_id="t")
    orch._llm_client = None

    events = collect(
        orch._run_agentic_answer(
            agent_context=ctx, content="hi", fallback_text="fallback reply"
        )
    )

    assert _deltas(events) == "fallback reply"
    assert not any(e["type"] == "tool_call_started" for e in events)
