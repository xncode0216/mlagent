"""Anthropic (Claude) Messages API client.

Anthropic differs from the OpenAI shape: the system prompt is a top-level field,
tool schemas use ``input_schema``, tool calls arrive as ``tool_use`` content
blocks, and tool results are sent back as ``tool_result`` blocks in a user turn.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
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
    sse_payload,
)

_EMPTY_SCHEMA = {"type": "object", "properties": {}}


class AnthropicClient(LLMClient):
    def __init__(
        self,
        *,
        model: str,
        api_key: str = "",
        base_url: str = "https://api.anthropic.com",
        temperature: float = 0.2,
        max_tokens: int = 1024,
        timeout: float = 60.0,
        anthropic_version: str = "2023-06-01",
        transport: httpx.BaseTransport | None = None,
        require_api_key: bool = True,
    ) -> None:
        if not model:
            raise LLMNotConfiguredError("LLM model is not set")
        if require_api_key and not api_key:
            raise LLMNotConfiguredError("API key missing for provider 'anthropic'")
        self.provider = "anthropic"
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._timeout = timeout
        self._anthropic_version = anthropic_version
        self._transport = transport

    @staticmethod
    def _encode_message(message: ChatMessage) -> dict[str, Any]:
        if message.role == "tool":
            return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.tool_call_id or "",
                        "content": message.content,
                    }
                ],
            }
        if message.tool_calls:
            blocks: list[dict[str, Any]] = []
            if message.content:
                blocks.append({"type": "text", "text": message.content})
            for call in message.tool_calls:
                blocks.append(
                    {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                )
            return {"role": "assistant", "content": blocks}
        return {"role": message.role, "content": message.content}

    def _build_payload(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec] | None,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any]:
        system_parts = [m.content for m in messages if m.role == "system" and m.content]
        conversation = [self._encode_message(m) for m in messages if m.role != "system"]
        payload: dict[str, Any] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        if tools:
            payload["tools"] = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.parameters or _EMPTY_SCHEMA,
                }
                for tool in tools
            ]
        return payload

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> ChatResult:
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in data.get("content") or []:
            block_type = block.get("type")
            if block_type == "text":
                text_parts.append(block.get("text", ""))
            elif block_type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.get("id", ""),
                        name=block.get("name", ""),
                        arguments=block.get("input") or {},
                    )
                )
        return ChatResult(
            content="".join(text_parts) or None,
            tool_calls=tuple(tool_calls),
            finish_reason=data.get("stop_reason"),
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
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": self._anthropic_version,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
            try:
                response = await client.post(
                    f"{self._base_url}/v1/messages", json=payload, headers=headers
                )
            except httpx.HTTPError as exc:
                raise LLMResponseError(f"LLM request failed: {exc}") from exc

        if response.status_code >= 400:
            raise LLMResponseError(
                f"Provider 'anthropic' returned {response.status_code}: {response.text[:500]}"
            )
        return self._parse_response(response.json())

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        payload = self._build_payload(
            messages,
            tools,
            self._temperature if temperature is None else temperature,
            self._max_tokens if max_tokens is None else max_tokens,
        )
        payload["stream"] = True
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": self._anthropic_version,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
            async with client.stream(
                "POST", f"{self._base_url}/v1/messages", json=payload, headers=headers
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise LLMResponseError(
                        f"Provider 'anthropic' returned {response.status_code}: {body[:500]}"
                    )
                async for line in response.aiter_lines():
                    data = sse_payload(line)
                    if data is None or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "content_block_delta":
                        text = (event.get("delta") or {}).get("text")
                        if text:
                            yield text
