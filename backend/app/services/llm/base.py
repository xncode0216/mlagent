"""Provider-agnostic LLM client abstraction (P0-1).

Gives MLAgent a single interface over multiple chat providers
(OpenAI-compatible incl. self-hosted vLLM and DeepSeek, plus Anthropic) with
function/tool calling, so the orchestrator can reason via an LLM without knowing
the provider. See ``docs/production-readiness-review.md`` P0-1.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any


class LLMError(RuntimeError):
    """Base error for LLM client failures."""


class LLMNotConfiguredError(LLMError):
    """Raised when LLM configuration is missing or incomplete."""


class LLMResponseError(LLMError):
    """Raised when a provider errors or returns an unparseable response."""


@dataclass(frozen=True)
class ToolSpec:
    """A function/tool the model may call."""

    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCall:
    """A tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ChatMessage:
    """A single conversation turn passed to the model."""

    role: str  # system | user | assistant | tool
    content: str = ""
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()

    @classmethod
    def system(cls, content: str) -> ChatMessage:
        return cls(role="system", content=content)

    @classmethod
    def user(cls, content: str) -> ChatMessage:
        return cls(role="user", content=content)

    @classmethod
    def assistant(cls, content: str = "", tool_calls: Sequence[ToolCall] = ()) -> ChatMessage:
        return cls(role="assistant", content=content, tool_calls=tuple(tool_calls))

    @classmethod
    def tool(cls, content: str, tool_call_id: str, name: str | None = None) -> ChatMessage:
        return cls(role="tool", content=content, tool_call_id=tool_call_id, name=name)


@dataclass(frozen=True)
class ChatResult:
    """A normalized chat completion result across providers."""

    content: str | None
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str | None = None
    model: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)


class LLMClient(ABC):
    """Common interface implemented by every provider adapter."""

    provider: str = "unknown"

    @abstractmethod
    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult:
        """Run one chat completion, optionally exposing tools for function calling."""

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        """Yield assistant text chunks.

        Default implementation emits the full ``complete`` content as one chunk;
        providers override this with true token streaming.
        """
        result = await self.complete(
            messages, tools=tools, temperature=temperature, max_tokens=max_tokens
        )
        if result.content:
            yield result.content


def sse_payload(line: str) -> str | None:
    """Return the payload of a Server-Sent-Events ``data:`` line, else None."""

    stripped = line.strip()
    if not stripped or not stripped.startswith("data:"):
        return None
    return stripped[len("data:") :].strip()
