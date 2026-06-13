"""Default LLM client + read-only analysis tool registry for the agent loop (P1-6)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.services.llm import (
    LLMClient,
    LLMError,
    ToolCall,
    ToolSpec,
    get_llm_client,
    llm_is_configured,
)
from app.services.llm_agent import ToolExecutor
from app.tools.data_analysis import correlation_matrix, detect_missing, profile_dataset


def _default_llm_client() -> LLMClient | None:
    """Build the configured LLM client, or None when no LLM is configured."""
    try:
        return get_llm_client() if llm_is_configured() else None
    except LLMError:
        return None


_ANALYSIS_AGENT_PROMPT = (
    "You are MLAgent's senior data analyst. Use the provided tools to inspect the "
    "active dataset, then give the user a concrete, grounded summary that references "
    "real numbers (rows, columns, notable missing rates and correlations) and 1-3 "
    "next steps. Call tools when you need facts; never invent values."
)

# Read-only tools the analysis agent may call. Each operates on the session's
# active dataset, so they advertise an empty argument schema.
_AGENT_TOOL_FUNCS: dict[str, Callable[[Path], Any]] = {
    "profile_dataset": profile_dataset,
    "detect_missing": detect_missing,
    "correlation_matrix": correlation_matrix,
}
_AGENT_TOOL_SPECS: list[ToolSpec] = [
    ToolSpec(
        name="profile_dataset",
        description=(
            "Profile the active dataset: row/column counts, dtypes, target "
            "candidates, and data-quality flags."
        ),
        parameters={"type": "object", "properties": {}},
    ),
    ToolSpec(
        name="detect_missing",
        description="Per-column missing-value counts and rates for the active dataset.",
        parameters={"type": "object", "properties": {}},
    ),
    ToolSpec(
        name="correlation_matrix",
        description="Pairwise correlation matrix of the active dataset's numeric columns.",
        parameters={"type": "object", "properties": {}},
    ),
]


def _build_analysis_tools(csv_path: Path) -> tuple[list[ToolSpec], ToolExecutor]:
    """Bind the read-only analysis tools to one dataset for the agent loop.

    Returns the specs advertised to the model plus an executor that runs the
    matching deterministic function and returns a truncated JSON string (capped so a
    large profile can't blow the model's context window).
    """

    async def execute(call: ToolCall) -> str:
        func = _AGENT_TOOL_FUNCS.get(call.name)
        if func is None:
            return f"ERROR: unknown tool '{call.name}'"
        return json.dumps(func(csv_path), default=str)[:1500]

    return _AGENT_TOOL_SPECS, execute
