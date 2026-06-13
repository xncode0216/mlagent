"""Contract tests for the read-only LLM status endpoint (P0-1).

The endpoint must reflect the *real* configured provider/model, report whether a
usable client can be built, and never leak the API key. Settings are injected via
FastAPI's dependency override so the tests do not depend on the host's ``.env``.
"""

from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app


def _client_with(settings: Settings) -> TestClient:
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(get_settings, None)


def test_status_reports_not_configured_by_default():
    body = _client_with(Settings(llm_provider="", llm_model="")).get("/api/llm/status").json()

    assert body["configured"] is False
    assert body["provider"] == ""
    assert body["model"] == ""
    # The catalog is always present so the UI can show selectable targets.
    ids = {p["id"] for p in body["providers"]}
    assert {"anthropic", "openai", "deepseek", "vllm"} <= ids
    assert all(p["active"] is False for p in body["providers"])


def test_status_reports_configured_vllm_without_key():
    body = (
        _client_with(Settings(llm_provider="vllm", llm_model="qwen2.5"))
        .get("/api/llm/status")
        .json()
    )

    assert body["configured"] is True
    assert body["provider"] == "vllm"
    assert body["provider_label"] == "Local vLLM"
    assert body["model"] == "qwen2.5"
    active = [p["id"] for p in body["providers"] if p["active"]]
    assert active == ["vllm"]


def test_status_marks_provider_set_but_uncredentialed_as_unconfigured():
    # anthropic requires a key: the provider is shown active, but configured stays False.
    body = (
        _client_with(Settings(llm_provider="anthropic", llm_model="claude-x", llm_api_key=""))
        .get("/api/llm/status")
        .json()
    )

    assert body["configured"] is False
    assert body["provider"] == "anthropic"
    assert body["provider_label"] == "Claude"
    assert any(p["id"] == "anthropic" and p["active"] for p in body["providers"])


def test_status_maps_openai_compatible_under_openai_label():
    body = (
        _client_with(
            Settings(llm_provider="openai-compatible", llm_model="gpt-4o", llm_api_key="k")
        )
        .get("/api/llm/status")
        .json()
    )

    assert body["provider"] == "openai"
    active = [p["id"] for p in body["providers"] if p["active"]]
    assert active == ["openai"]


def test_status_never_leaks_api_key():
    response = _client_with(
        Settings(llm_provider="openai", llm_model="gpt-4o", llm_api_key="sk-supersecret")
    ).get("/api/llm/status")

    assert response.status_code == 200
    assert "sk-supersecret" not in response.text
