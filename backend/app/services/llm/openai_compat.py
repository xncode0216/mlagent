"""OpenAI-compatible chat client.

Covers OpenAI, DeepSeek, and self-hosted vLLM (all expose
``POST {base_url}/chat/completions`` with the same request/response shape and
``tools`` function-calling format).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import httpx

from app.services.llm.base import (
    ChatMessage,
    ChatResult,
    LLMClient,
    LLMNotConfiguredError,
    LLMResponseError,
    ToolCall,
    ToolSpec,
)

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "vllm": "http://localhost:8001/v1",
}

_EMPTY_SCHEMA = {"type": "object", "properties": {}}


class OpenAICompatibleClient(LLMClient):
    def __init__(
        self,
        *,
        model: str,
        api_key: str = "",
        base_url: str = "https://api.openai.com/v1",
        provider: str = "openai",
        temperature: float = 0.2,
        max_tokens: int = 1024,
        timeout: float = 60.0,
        transport: httpx.BaseTransport | None = None,
        require_api_key: bool = True,
    ) -> None:
        if not model:
            raise LLMNotConfiguredError("LLM model is not set")
        if require_api_key and not api_key:
            raise LLMNotConfiguredError(f"API key missing for provider '{provider}'")
        self.provider = provider
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._timeout = timeout
        self._transport = transport

    @staticmethod
    def _encode_message(message: ChatMessage) -> dict[str, Any]:
        if message.role == "tool":
            return {
                "role": "tool",
                "content": message.content,
                "tool_call_id": message.tool_call_id or "",
            }
        if message.tool_calls:
            return {
                "role": message.role,
                "content": message.content or None,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                    }
                    for call in message.tool_calls
                ],
            }
        encoded: dict[str, Any] = {"role": message.role, "content": message.content}
        if message.name:
            encoded["name"] = message.name
        return encoded

    def _build_payload(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec] | None,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [self._encode_message(message) for message in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters or _EMPTY_SCHEMA,
                    },
                }
                for tool in tools
            ]
            payload["tool_choice"] = "auto"
        return payload

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> ChatResult:
        try:
            choice = data["choices"][0]
            message = choice.get("message", {})
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"Unexpected response shape: {data!r}") from exc

        tool_calls: list[ToolCall] = []
        for raw_call in message.get("tool_calls") or []:
            function = raw_call.get("function", {})
            raw_args = function.get("arguments")
            try:
                parsed = json.loads(raw_args) if isinstance(raw_args, str) and raw_args else (raw_args or {})
            except json.JSONDecodeError:
                parsed = {"_raw": raw_args}
            tool_calls.append(
                ToolCall(
                    id=raw_call.get("id", ""),
                    name=function.get("name", ""),
                    arguments=parsed if isinstance(parsed, dict) else {"_value": parsed},
                )
            )

        return ChatResult(
            content=message.get("content"),
            tool_calls=tuple(tool_calls),
            finish_reason=choice.get("finish_reason"),
            model=data.get("model"),
            usage=data.get("usage") or {},
            raw=data,
        )

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult:
        payload = self._build_payload(
            messages,
            tools,
            self._temperature if temperature is None else temperature,
            self._max_tokens if max_tokens is None else max_tokens,
        )
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
            try:
                response = await client.post(
                    f"{self._base_url}/chat/completions", json=payload, headers=headers
                )
            except httpx.HTTPError as exc:
                raise LLMResponseError(f"LLM request failed: {exc}") from exc

        if response.status_code >= 400:
            raise LLMResponseError(
                f"Provider '{self.provider}' returned {response.status_code}: {response.text[:500]}"
            )
        return self._parse_response(response.json())
