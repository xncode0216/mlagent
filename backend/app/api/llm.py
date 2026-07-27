"""Read-only LLM configuration status for the frontend model indicator (P0-1).

Exposes which provider/model the backend is actually configured to use and
whether a usable client can be built, so the top-bar indicator reflects reality
instead of static text. The API key is never returned.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.services.llm import llm_is_configured

router = APIRouter(prefix="/api/llm", tags=["llm"])

# Display catalog shown in the indicator, in priority order. The active provider
# is whichever ``MLAGENT_LLM_PROVIDER`` resolves to; the rest are shown as targets
# the operator could configure.
_PROVIDER_LABELS: list[tuple[str, str]] = [
    ("anthropic", "Claude"),
    ("openai", "OpenAI"),
    ("deepseek", "DeepSeek"),
    ("vllm", "Local vLLM"),
]
_PROVIDER_LABEL_MAP = dict(_PROVIDER_LABELS)


class LLMProviderInfo(BaseModel):
    id: str
    label: str
    active: bool


class LLMStatus(BaseModel):
    configured: bool
    provider: str
    provider_label: str
    model: str
    providers: list[LLMProviderInfo]


def _active_provider_id(raw: str) -> str:
    provider = (raw or "").strip().lower()
    # "openai-compatible" is presented under the OpenAI label in the catalog.
    return "openai" if provider == "openai-compatible" else provider


@router.get("/status", response_model=LLMStatus)
def llm_status(settings: Settings = Depends(get_settings)) -> LLMStatus:
    active = _active_provider_id(settings.llm_provider)
    return LLMStatus(
        configured=llm_is_configured(settings),
        provider=active,
        provider_label=_PROVIDER_LABEL_MAP.get(active, active),
        model=settings.llm_model or "",
        providers=[
            LLMProviderInfo(id=pid, label=label, active=pid == active)
            for pid, label in _PROVIDER_LABELS
        ],
    )
