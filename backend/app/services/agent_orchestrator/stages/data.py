"""数据线的 stage runner：概览分析、摄取、画像、清洗。

`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变，
仍通过 `self` 访问 dispatcher/messaging 辅助方法。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import _relative_path, _utc_now
from app.services.artifact_service import ArtifactService
from app.tools.data_analysis import (
    correlation_matrix,
    detect_missing,
    plot_distribution,
    profile_dataset,
)


class DataStagesMixin:
    async def _run_analysis_overview(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        call_id = uuid4().hex
        started_at = perf_counter()
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "profile_dataset",
            "args": context,
            "started_at": _utc_now(),
        }
        yield started_event

        agent_context, resolution = self._resolve_context(context)
        if agent_context is None:
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        self._append_user_message(agent_context, content)
        self._record(started_event)
        yield self._record(self._rules_event(agent_context))

        artifact_service = ArtifactService(agent_context.project_root)
        profile_data = profile_dataset(agent_context.csv_path)
        missing_data = detect_missing(agent_context.csv_path)
        artifacts = [
            ("dataframe", "profile.json", profile_data),
            ("dataframe", "missing.json", missing_data),
            ("chart", "correlation.json", correlation_matrix(agent_context.csv_path)),
            ("chart", "distribution.json", plot_distribution(agent_context.csv_path)),
        ]
        for artifact_type, name, data in artifacts:
            artifact = artifact_service.write_json(
                project_id=agent_context.project_id,
                session_id=self.session_id,
                artifact_type=artifact_type,
                name=name,
                payload=data,
            )
            yield self._record(
                {
                    "type": "artifact_created",
                    "trace_id": self.trace_id,
                    "artifact": {
                        "id": artifact.id,
                        "project_id": agent_context.project_id,
                        "session_id": self.session_id,
                        "type": artifact_type,
                        "name": name,
                        "path": _relative_path(agent_context.project_root, artifact.path),
                        "metadata": artifact.metadata,
                        "created_at": artifact.created_at,
                    },
                }
            )

        for event in self._lesson_events(agent_context):
            yield self._record(event)

        finished_event = self._tool_finished(call_id=call_id, started_at=started_at)
        yield self._record(finished_event)

        fallback_text = (
            "I inspected the dataset structure, missing values, column types, "
            "distributions, and correlations. The generated artifacts are ready "
            "in the inspector."
        )
        # When an LLM is configured, let it autonomously call the read-only tools
        # and stream a grounded answer; otherwise emit the deterministic fallback.
        # The profile/missing artifacts above remain the inspector's source of truth.
        async for event in self._run_agentic_answer(
            agent_context=agent_context,
            content=content,
            fallback_text=fallback_text,
        ):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 1,
                "label": "Complete",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_ingest(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = perf_counter()
        call_id = uuid4().hex
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "agent_orchestrator",
            "args": {"intent": "configure_ingest", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        agent_context, resolution = self._resolve_context(context)
        if agent_context is None:
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        self._append_user_message(agent_context, content)
        self._record(started_event)
        yield self._record(self._stage_event("stage_started", "ingest", "Registering dataset"))

        registry_bundle = self._build_dataset_registry_artifact(agent_context)
        yield self._record(registry_bundle["started"])
        yield self._record(registry_bundle["artifact_event"])
        yield self._record(registry_bundle["finished"])
        yield self._record(self._stage_event("stage_completed", "ingest", "Dataset registered"))

        registry_artifact = registry_bundle["artifact_event"]["artifact"]
        props = self._dataset_registry_props(registry_artifact)
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "ingest",
                "component": "dataset_summary",
                "title": "Registered active dataset",
                "artifact_path": registry_artifact["path"],
                "props": props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=registry_artifact["path"],
            )
        )

        text = (
            f"I registered dataset `{agent_context.active_file}` as "
            f"`{props['dataset_version_id']}`. Review the dataset summary, then generate "
            "a profile before cleaning, transforming, or training from it."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.2,
                "label": "Dataset ingest context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_profile(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = perf_counter()
        call_id = uuid4().hex
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "agent_orchestrator",
            "args": {"intent": "configure_profile", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        agent_context, resolution = self._resolve_context(context)
        if agent_context is None:
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        self._append_user_message(agent_context, content)
        self._record(started_event)
        yield self._record(self._rules_event(agent_context))
        yield self._record(self._stage_event("stage_started", "profile", "Profiling dataset"))

        profile_bundle = self._build_profile_artifact(agent_context)
        yield self._record(profile_bundle["started"])
        yield self._record(profile_bundle["artifact_event"])
        yield self._record(profile_bundle["finished"])
        yield self._record(self._stage_event("stage_completed", "profile", "Profile generated"))

        profile_artifact = profile_bundle["artifact_event"]["artifact"]
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "profile",
                "component": "data_quality",
                "title": "Review data quality profile",
                "artifact_path": profile_artifact["path"],
                "props": self._profile_props(agent_context, profile_artifact),
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=profile_artifact["path"],
            )
        )

        text = (
            f"I prepared a data quality profile for `{agent_context.active_file}`. "
            "Review the profile card before deciding whether to clean, transform, or train from this dataset."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.3,
                "label": "Profile context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_cleaning(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = perf_counter()
        call_id = uuid4().hex
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "agent_orchestrator",
            "args": {"intent": "configure_cleaning", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        agent_context, resolution = self._resolve_context(context)
        if agent_context is None:
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        self._append_user_message(agent_context, content)
        self._record(started_event)
        yield self._record(self._rules_event(agent_context))
        yield self._record(self._stage_event("stage_started", "clean", "Reviewing quality issues"))

        profile_bundle = self._build_profile_artifact(agent_context)
        yield self._record(profile_bundle["started"])
        yield self._record(profile_bundle["artifact_event"])
        yield self._record(profile_bundle["finished"])

        profile_artifact = profile_bundle["artifact_event"]["artifact"]
        profile_props = self._profile_props(agent_context, profile_artifact)
        clean_props = {
            **profile_props,
            "required_confirmation": True,
            "planned_actions": [
                "Review missing values, duplicate rows, and suspicious identifiers.",
                "Generate a preprocessing plan before modifying any dataset.",
                "Approve the transform only after inspecting the proposed drops, imputers, encoders, and output path.",
            ],
        }
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "clean",
                "component": "data_quality",
                "title": "Review quality issues",
                "artifact_path": profile_artifact["path"],
                "props": profile_props,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "clean",
                "component": "preprocessing_plan",
                "title": "Prepare cleaning plan",
                "artifact_path": None,
                "props": clean_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=profile_artifact["path"],
            )
        )

        text = (
            f"I prepared a quality review for `{agent_context.active_file}`. "
            "Use Generate Plan to create a reviewable cleaning and preprocessing plan before any dataset is changed."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.38,
                "label": "Cleaning review ready",
                "timestamp": _utc_now(),
            }
        )

