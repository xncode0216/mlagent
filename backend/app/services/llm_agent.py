"""Provider-agnostic tool-calling (ReAct) loop engine (P0-1, Option B).

The orchestrator historically routed every request through hand-written keyword
intents. This engine lets a configured LLM *autonomously* decide which tools to
call: it drives the model's tool-use phase against a caller-supplied executor,
appending each assistant tool-call turn and its tool result back into the
conversation, until the model stops asking for tools (its next turn is the final
answer) or an iteration budget is exhausted.

It is deliberately decoupled from MLAgent specifics — it knows only ``LLMClient``,
``ToolSpec`` and ``ChatMessage``. The caller supplies the tools, the executor, and
emits whatever UI events it wants from the yielded :class:`ToolCallStarted` /
:class:`ToolCallFinished` events, then streams the final answer over the mutated
``conversation``. This keeps the engine fully unit-testable with a fake client.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from uuid import uuid4

from app.services.llm.base import ChatMessage, LLMClient, ToolCall, ToolSpec

ToolExecutor = Callable[[ToolCall], Awaitable[str]]


@dataclass(frozen=True)
class ToolCallStarted:
    """The model requested a tool; execution is about to begin."""

    call: ToolCall
    call_id: str


@dataclass(frozen=True)
class ToolCallFinished:
    """A requested tool finished (or failed); ``output`` was fed back to the model."""

    call: ToolCall
    call_id: str
    output: str
    error: bool = False


LoopEvent = ToolCallStarted | ToolCallFinished


async def run_tool_phase(
    client: LLMClient,
    *,
    conversation: list[ChatMessage],
    tools: Sequence[ToolSpec],
    execute: ToolExecutor,
    max_iterations: int = 4,
) -> AsyncIterator[LoopEvent]:
    """Drive the model's tool-calling phase, mutating ``conversation`` in place.

    For each round the model is asked to ``complete`` with ``tools`` exposed. If it
    requests no tools, the phase ends and ``conversation`` is left ready for the
    caller to stream a final answer. Otherwise every requested call is executed via
    ``execute`` (whose string result is appended as a ``tool`` message) and surfaced
    as a started/finished event pair. A failing executor is caught and its error is
    handed back to the model as the tool result so it can recover or apologise,
    rather than crashing the turn.

    The loop is bounded by ``max_iterations`` to guarantee termination even if the
    model keeps requesting tools.
    """

    for _ in range(max_iterations):
        result = await client.complete(conversation, tools=tools)
        if not result.has_tool_calls:
            return
        conversation.append(
            ChatMessage.assistant(result.content or "", tool_calls=result.tool_calls)
        )
        for call in result.tool_calls:
            call_id = call.id or uuid4().hex
            yield ToolCallStarted(call=call, call_id=call_id)
            try:
                output = await execute(call)
                error = False
            except Exception as exc:  # surfaced back to the model, never crashes the turn
                output, error = f"ERROR: {exc}", True
            yield ToolCallFinished(call=call, call_id=call_id, output=output, error=error)
            conversation.append(
                ChatMessage.tool(output, tool_call_id=call.id, name=call.name)
            )
