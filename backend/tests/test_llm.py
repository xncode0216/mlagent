import asyncio
import json

import httpx
import pytest

from app.core.config import Settings
from app.services.llm import (
    ChatMessage,
    LLMNotConfiguredError,
    ToolCall,
    ToolSpec,
    get_llm_client,
    llm_is_configured,
)
from app.services.llm.anthropic import AnthropicClient
from app.services.llm.base import LLMResponseError
from app.services.llm.openai_compat import OpenAICompatibleClient


def _transport(captured: dict, *, status: int = 200, json_body: dict | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["json"] = json.loads(request.content)
        return httpx.Response(status, json=json_body or {})

    return httpx.MockTransport(handler)


# --- OpenAI-compatible -------------------------------------------------------

def test_openai_payload_includes_tools_and_encodes_messages():
    client = OpenAICompatibleClient(model="gpt-x", api_key="k", base_url="https://api.test/v1")
    payload = client._build_payload(
        [ChatMessage.system("be terse"), ChatMessage.user("hi")],
        [ToolSpec(name="profile", description="profile a dataset", parameters={"type": "object"})],
        0.2,
        256,
    )
    assert payload["model"] == "gpt-x"
    assert payload["messages"][0] == {"role": "system", "content": "be terse"}
    assert payload["tool_choice"] == "auto"
    assert payload["tools"][0]["function"]["name"] == "profile"


def test_openai_parses_tool_calls_with_json_arguments():
    data = {
        "model": "gpt-x",
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {"name": "profile", "arguments": '{"path": "a.csv"}'},
                        }
                    ],
                },
            }
        ],
    }
    result = OpenAICompatibleClient._parse_response(data)
    assert result.has_tool_calls
    assert result.tool_calls[0] == ToolCall(id="call_1", name="profile", arguments={"path": "a.csv"})
    assert result.finish_reason == "tool_calls"


def test_openai_complete_posts_to_chat_completions_with_auth():
    captured: dict = {}
    transport = _transport(
        captured,
        json_body={"model": "gpt-x", "choices": [{"message": {"content": "hello"}}]},
    )
    client = OpenAICompatibleClient(
        model="gpt-x", api_key="secret", base_url="https://api.test/v1", transport=transport
    )
    result = asyncio.run(client.complete([ChatMessage.user("hi")]))
    assert result.content == "hello"
    assert captured["url"] == "https://api.test/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer secret"


def test_openai_http_error_raises_llm_response_error():
    transport = _transport({}, status=500, json_body={"error": "boom"})
    client = OpenAICompatibleClient(model="gpt-x", api_key="k", transport=transport)
    with pytest.raises(LLMResponseError):
        asyncio.run(client.complete([ChatMessage.user("hi")]))


def test_openai_requires_api_key_unless_disabled():
    with pytest.raises(LLMNotConfiguredError):
        OpenAICompatibleClient(model="gpt-x", api_key="")
    # vLLM-style: allowed without a key.
    OpenAICompatibleClient(model="local", api_key="", require_api_key=False)


# --- Anthropic ---------------------------------------------------------------

def test_anthropic_payload_extracts_system_and_tool_schema():
    client = AnthropicClient(model="claude-x", api_key="k")
    payload = client._build_payload(
        [ChatMessage.system("be terse"), ChatMessage.user("hi")],
        [ToolSpec(name="profile", description="profile", parameters={"type": "object"})],
        0.2,
        256,
    )
    assert payload["system"] == "be terse"
    assert all(m["role"] != "system" for m in payload["messages"])
    assert payload["tools"][0]["input_schema"] == {"type": "object"}


def test_anthropic_parses_tool_use_blocks():
    data = {
        "model": "claude-x",
        "stop_reason": "tool_use",
        "content": [
            {"type": "text", "text": "let me check"},
            {"type": "tool_use", "id": "tu_1", "name": "profile", "input": {"path": "a.csv"}},
        ],
    }
    result = AnthropicClient._parse_response(data)
    assert result.content == "let me check"
    assert result.tool_calls[0] == ToolCall(id="tu_1", name="profile", arguments={"path": "a.csv"})


def test_anthropic_complete_posts_to_messages_with_api_key():
    captured: dict = {}
    transport = _transport(
        captured, json_body={"model": "claude-x", "content": [{"type": "text", "text": "hi back"}]}
    )
    client = AnthropicClient(
        model="claude-x", api_key="secret", base_url="https://anthropic.test", transport=transport
    )
    result = asyncio.run(client.complete([ChatMessage.user("hi")]))
    assert result.content == "hi back"
    assert captured["url"] == "https://anthropic.test/v1/messages"
    assert captured["headers"]["x-api-key"] == "secret"


# --- Factory -----------------------------------------------------------------

def test_factory_builds_openai_compatible_clients():
    openai_client = get_llm_client(
        Settings(llm_provider="openai", llm_model="gpt-4o", llm_api_key="k")
    )
    assert isinstance(openai_client, OpenAICompatibleClient)
    assert openai_client.provider == "openai"

    deepseek_client = get_llm_client(
        Settings(llm_provider="deepseek", llm_model="deepseek-chat", llm_api_key="k")
    )
    assert deepseek_client._base_url == "https://api.deepseek.com/v1"


def test_factory_allows_vllm_without_api_key():
    client = get_llm_client(
        Settings(llm_provider="vllm", llm_model="local", llm_base_url="http://localhost:8001/v1")
    )
    assert isinstance(client, OpenAICompatibleClient)


def test_factory_builds_anthropic_client():
    client = get_llm_client(
        Settings(llm_provider="anthropic", llm_model="claude-3-5", llm_api_key="k")
    )
    assert isinstance(client, AnthropicClient)


def test_factory_raises_when_unconfigured_or_unknown():
    with pytest.raises(LLMNotConfiguredError):
        get_llm_client(Settings(llm_provider=""))
    with pytest.raises(LLMNotConfiguredError):
        get_llm_client(Settings(llm_provider="mystery", llm_model="x", llm_api_key="k"))


def test_llm_is_configured_false_by_default():
    assert llm_is_configured(Settings(llm_provider="")) is False
    assert llm_is_configured(Settings(llm_provider="openai", llm_model="gpt-4o", llm_api_key="k"))
