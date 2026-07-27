"""Select and build an :class:`LLMClient` from settings.

The provider is chosen by ``MLAGENT_LLM_PROVIDER``; credentials and model come
from the matching ``MLAGENT_LLM_*`` settings. Self-hosted vLLM is allowed to run
without an API key.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings
from app.services.llm.anthropic import AnthropicClient
from app.services.llm.base import LLMClient, LLMNotConfiguredError
from app.services.llm.openai_compat import DEFAULT_BASE_URLS, OpenAICompatibleClient

OPENAI_COMPATIBLE_PROVIDERS = {"openai", "deepseek", "vllm", "openai-compatible"}
SUPPORTED_PROVIDERS = OPENAI_COMPATIBLE_PROVIDERS | {"anthropic"}


def get_llm_client(settings: Settings | None = None) -> LLMClient:
    """Build the configured LLM client, or raise ``LLMNotConfiguredError``."""

    settings = settings or get_settings()
    provider = (settings.llm_provider or "").strip().lower()
    if not provider:
        raise LLMNotConfiguredError(
            "MLAGENT_LLM_PROVIDER is not set; configure an LLM provider to enable agent reasoning."
        )

    common = {
        "model": settings.llm_model,
        "api_key": settings.llm_api_key,
        "temperature": settings.llm_temperature,
        "max_tokens": settings.llm_max_tokens,
        "timeout": settings.llm_timeout_seconds,
    }

    if provider in OPENAI_COMPATIBLE_PROVIDERS:
        lookup = "openai" if provider == "openai-compatible" else provider
        base_url = settings.llm_base_url or DEFAULT_BASE_URLS.get(lookup, DEFAULT_BASE_URLS["openai"])
        return OpenAICompatibleClient(
            provider=provider,
            base_url=base_url,
            require_api_key=provider != "vllm",
            **common,
        )

    if provider == "anthropic":
        return AnthropicClient(
            base_url=settings.llm_base_url or "https://api.anthropic.com",
            require_api_key=True,
            **common,
        )

    raise LLMNotConfiguredError(
        f"Unknown LLM provider '{provider}'. Supported: {', '.join(sorted(SUPPORTED_PROVIDERS))}."
    )


def llm_is_configured(settings: Settings | None = None) -> bool:
    """Return True if a usable LLM client can be built from settings."""

    try:
        get_llm_client(settings)
    except LLMNotConfiguredError:
        return False
    return True
