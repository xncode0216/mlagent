"""LLM-backed intent routing that fronts the keyword classifier (P0-1, option A).

When an LLM is configured, the orchestrator asks it to map a free-form user
message to exactly one of the orchestrator's known intents, via a single
function-call tool. Any failure, unknown answer, or missing LLM falls back to
the deterministic keyword classifier, so the app behaves identically when no LLM
is configured. See ``docs/production-readiness-review.md`` P0-1.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.services.llm.base import ChatMessage, ChatResult, LLMClient, LLMError, ToolSpec

# Canonical intents (must match AgentOrchestrator._classify_intent) + the
# one-line descriptions shown to the model in the routing tool.
INTENT_DESCRIPTIONS: dict[str, str] = {
    "configure_ingest": "register/load/import a dataset or show a source summary",
    "configure_profile": "profile data quality; show column stats and warnings",
    "configure_cleaning": "clean data: fix missing values, dedupe, safe fixes",
    "configure_transform": "build or revise a preprocessing / feature-transform plan",
    "prepare_for_modeling": "preprocess / feature-engineer to get ready for modeling",
    "configure_training": "train a model (baseline/sklearn); fit a classifier or regressor",
    "configure_evaluation": "evaluate or compare models; (re)generate an evaluation report",
    "configure_diagnosis": "diagnose errors: error slices, confusion matrix, misclassified rows",
    "configure_iteration": "iterate: propose a follow-up experiment or retrain with changes",
    "configure_export": "export a reproducible bundle / handoff / deliverable",
    "configure_learning": "extract lessons, propose learned rules, or save project memory",
    "continue_from_failure": "continue, resume, or retry the last failed step",
    "abandon_last_failure": "abandon or clear the last saved failure / retry state",
    "analysis_overview": "general data-analysis question, or anything that fits nothing above",
}
INTENTS: tuple[str, ...] = tuple(INTENT_DESCRIPTIONS)

_SYSTEM_PROMPT = (
    "You are the intent router for MLAgent, a data-analysis and ML agent IDE. "
    "Map the user's message to exactly one intent by calling the route_intent "
    "function. If nothing fits, choose analysis_overview."
)


def _route_tool() -> ToolSpec:
    catalogue = "\n".join(f"- {name}: {desc}" for name, desc in INTENT_DESCRIPTIONS.items())
    return ToolSpec(
        name="route_intent",
        description="Select the single best intent for the user's message.\n" + catalogue,
        parameters={
            "type": "object",
            "properties": {"intent": {"type": "string", "enum": list(INTENTS)}},
            "required": ["intent"],
        },
    )


def extract_intent(result: ChatResult) -> str | None:
    """Pull a known intent from a routing result, or None if absent/invalid."""

    for call in result.tool_calls:
        if call.name == "route_intent":
            value = call.arguments.get("intent")
            if isinstance(value, str) and value in INTENT_DESCRIPTIONS:
                return value
    content = (result.content or "").strip()
    return content if content in INTENT_DESCRIPTIONS else None


def build_routing_messages(content: str) -> list[ChatMessage]:
    return [ChatMessage.system(_SYSTEM_PROMPT), ChatMessage.user(content)]


async def classify_intent_with_llm(client: LLMClient, content: str, *, fallback: str) -> str:
    """Return the LLM-chosen intent, or ``fallback`` on any failure/unknown answer."""

    messages: Sequence[ChatMessage] = build_routing_messages(content)
    try:
        result = await client.complete(messages, tools=[_route_tool()], max_tokens=64)
    except LLMError:
        return fallback
    return extract_intent(result) or fallback
