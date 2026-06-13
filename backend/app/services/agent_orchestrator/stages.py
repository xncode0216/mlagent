"""Workflow stage runners extracted from the orchestrator (P1-6 slice 4).

A mixin composed into ``AgentOrchestrator``; every method keeps full ``self``
access to the dispatcher/messaging helpers, so the bodies are unchanged.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import json
from collections.abc import AsyncIterator
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.api.projects import get_registered_project
from app.services.artifact_service import ArtifactService
from app.services.evolution_service import EvolutionService
from app.services.experiment_service import ExperimentService
from app.services.lesson_extractor import LessonExtractor
from app.services.rule_injection_service import RuleInjectionService
from app.services.session_service import SessionService
from app.services.task_state_service import (
    delete_task_state,
    list_task_states,
    load_task_state,
    recovery_policy,
    write_task_state,
)
from app.services.llm import (
    ChatMessage,
    LLMClient,
    LLMError,
)
from app.services.llm_agent import (
    ToolCallFinished,
    ToolCallStarted,
    run_tool_phase,
)
from app.services.llm_intent import classify_intent_with_llm
from app.tools.data_analysis import (
    correlation_matrix,
    data_quality_profile,
    detect_missing,
    execute_preprocessing_plan,
    plot_distribution,
    preprocessing_plan,
    profile_dataset,
)

from app.services.agent_orchestrator.contexts import (
    ActiveFileResolution,
    AgentContext,
    AmbiguousRunContext,
    EvaluationContext,
    MissingDatasetContext,
    ProjectSessionContext,
    TrainingConfigurationContext,
)
from app.services.agent_orchestrator.support import (
    RECOVERABLE_STAGES,
    _dataset_version_id_from_path,
    _relative_path,
    _resolve_active_file,
    _utc_now,
)
from app.services.agent_orchestrator.artifacts import (
    _artifact_payload,
    _delete_pending_approval,
    _load_pending_approval,
    _render_transformation_report,
    _write_json_artifact,
    _write_pending_approval,
    _write_text_artifact,
)
from app.services.agent_orchestrator.tools import (
    _ANALYSIS_AGENT_PROMPT,
    _build_analysis_tools,
    _default_llm_client,
)
from app.services.agent_orchestrator.intent import classify_intent
from app.services.agent_orchestrator.commands import (
    dataset_registry_props,
    diagnosis_command_event,
    evaluation_command_event,
    export_command_event,
    learning_command_event,
    missing_dataset_command_event,
    missing_run_command_event,
    profile_props,
    training_command_event,
)
from app.services.agent_orchestrator.runs import (
    artifact_path_from_run,
    candidate_dataset_summaries,
    diagnosis_summary,
    infer_target_column,
    match_run_by_active_file,
    requests_latest_run,
    run_candidate_summary,
    target_candidates_for_columns,
)


class StageRunnersMixin:
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

    async def _run_continue_from_failure(
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
            "args": {"intent": "continue_from_failure", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project context is required",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        session_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={"active_file": active_file, "intent": "continue_from_failure"},
        )
        self._record(started_event)

        failed_states = [
            state
            for state in list_task_states(project_root=session_context.project_root, session_id=self.session_id)
            if state.get("status") == "failed" and state.get("stage") in RECOVERABLE_STAGES
        ]
        state = failed_states[0] if failed_states else None
        if state is None:
            yield self._record(
                self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    result_ref="no_failed_task_state",
                )
            )
            text = (
                "I checked this session and did not find a saved failed task state. "
                "You can ask me to analyze a dataset, prepare it for modeling, train, "
                "evaluate, export, or extract lessons."
            )
            async for event in self._emit_assistant_message(text):
                yield event
            yield self._record(
                {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 1,
                    "label": "No saved failed task state",
                    "timestamp": _utc_now(),
                }
            )
            return

        stage = str(state["stage"])
        label = f"Continue from saved {stage} failure"
        error = str(state.get("last_error") or "Saved task state is failed")
        retry_count = int(state.get("retry_count") or 0)
        resume_action = str(
            state.get("resume_action")
            or (state.get("recovery_policy") if isinstance(state.get("recovery_policy"), dict) else {}).get("resume_action")
            or f"Retry the saved {stage} step."
        )

        yield self._record(
            {
                "type": "step_failed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "label": label,
                "error": error,
                "retryable": True,
                "resume_stage": stage,
                "retry_count": retry_count,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "component": "task_state_inspector",
                "title": f"Continue from saved {stage} failure",
                "props": {
                    "stage": stage,
                    "retry_count": retry_count,
                    "last_error": error,
                    "resume_action": resume_action,
                },
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=f"task_state/{stage}",
            )
        )

        text = (
            f"I found a saved {stage} failure for this session. "
            f"The safest next action is: {resume_action} "
            "Review the recovery inspector before retrying, regenerating upstream work, or abandoning the saved state."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.6,
                "label": f"Ready to continue from saved {stage} failure",
                "timestamp": _utc_now(),
            }
        )

    async def _run_abandon_last_failure(
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
            "args": {"intent": "abandon_last_failure", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project context is required",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        session_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={"active_file": active_file, "intent": "abandon_last_failure"},
        )
        self._record(started_event)

        failed_states = [
            state
            for state in list_task_states(project_root=session_context.project_root, session_id=self.session_id)
            if state.get("status") == "failed" and state.get("stage") in RECOVERABLE_STAGES
        ]
        state = failed_states[0] if failed_states else None
        if state is None:
            yield self._record(
                self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    result_ref="no_failed_task_state",
                )
            )
            text = (
                "I checked this session and did not find a saved failed task state to abandon. "
                "Nothing was changed."
            )
            async for event in self._emit_assistant_message(text):
                yield event
            yield self._record(
                {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 1,
                    "label": "No saved failed task state",
                    "timestamp": _utc_now(),
                }
            )
            return

        stage = str(state["stage"])
        delete_task_state(project_root=session_context.project_root, session_id=self.session_id, stage=stage)
        yield self._record(
            {
                "type": "step_completed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "label": f"Abandoned saved {stage} failure state",
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=f"task_state/{stage}",
            )
        )

        text = (
            f"I cleared the saved {stage} failure for this session. "
            "Historical messages, logs, and artifacts are still available, but the retry state will no longer be offered."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 1,
                "label": f"Abandoned saved {stage} failure state",
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

    async def _run_configure_transform(
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
            "args": {"intent": "configure_transform", **context},
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
        yield self._record(self._stage_event("stage_started", "transform", "Planning transform"))

        plan_bundle = self._build_preprocessing_plan_artifacts(agent_context)
        yield self._record(plan_bundle["started"])
        yield self._record(plan_bundle["plan_event"])
        yield self._record(plan_bundle["script_event"])
        yield self._record(plan_bundle["finished"])

        plan_artifact = plan_bundle["plan_event"]["artifact"]
        approval_id = f"{self.session_id}-preprocessing-plan"
        yield self._record(
            {
                "type": "approval_required",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "approval_id": approval_id,
                "stage": "transform",
                "title": "Approve preprocessing transform",
                "description": "Review the generated plan before transforming the dataset.",
                "artifact_path": plan_artifact["path"],
                "options": ["execute", "revise"],
            }
        )
        _write_pending_approval(
            project_root=agent_context.project_root,
            session_id=self.session_id,
            approval_id=approval_id,
            payload={
                "approval_id": approval_id,
                "project_id": agent_context.project_id,
                "active_file": agent_context.active_file,
                "mode": agent_context.mode,
                "stage": "transform",
                "plan_path": plan_artifact["path"],
                "created_at": _utc_now(),
            },
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "transform",
                "component": "preprocessing_plan",
                "title": "Review preprocessing plan",
                "artifact_path": plan_artifact["path"],
                "props": {
                    "dataset_path": agent_context.active_file,
                    "preprocessing_plan_path": plan_artifact["path"],
                    "target_column": plan_artifact["metadata"].get("target_column"),
                    "output_dataset_path": plan_artifact["metadata"].get("output_dataset_path"),
                    "required_confirmation": True,
                    "source": "intent_router",
                },
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=plan_artifact["path"],
            )
        )

        text = (
            f"I generated a preprocessing plan for `{agent_context.active_file}` and paused before executing it. "
            "Review the plan card, then approve or revise the transform checkpoint."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.48,
                "label": "Transform approval ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_iteration(
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
            "args": {"intent": "configure_iteration", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        iteration_context, _, error_event = self._resolve_evaluation_context(
            context,
            content=content,
            allow_implicit_latest=True,
        )
        if iteration_context is None:
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Iteration context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_iteration_context",
                "message": "Iteration context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        run = iteration_context.run
        metrics_artifact = run.get("metrics_artifact") if isinstance(run.get("metrics_artifact"), dict) else {}
        report_artifact = (
            run.get("evaluation_report_artifact")
            if isinstance(run.get("evaluation_report_artifact"), dict)
            else {}
        )
        prediction_artifact = (
            run.get("prediction_samples_artifact")
            if isinstance(run.get("prediction_samples_artifact"), dict)
            else {}
        )
        preprocessing_artifact = (
            run.get("preprocessing_plan_artifact")
            if isinstance(run.get("preprocessing_plan_artifact"), dict)
            else {}
        )
        metrics_path = metrics_artifact.get("path") if isinstance(metrics_artifact.get("path"), str) else None
        report_path = report_artifact.get("path") if isinstance(report_artifact.get("path"), str) else None
        prediction_samples_path = (
            prediction_artifact.get("path") if isinstance(prediction_artifact.get("path"), str) else None
        )
        preprocessing_plan_path = (
            preprocessing_artifact.get("path") if isinstance(preprocessing_artifact.get("path"), str) else None
        )
        dataset_path = str(run.get("dataset_path") or "")
        target_column = str(run.get("target_column") or "")
        diagnosis = self._diagnosis_summary(run)

        iteration_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_iteration",
                "experiment_id": iteration_context.experiment_id,
                "dataset_path": dataset_path,
                "metrics_path": metrics_path,
            },
        )
        self._record(started_event)

        next_actions = [
            "Inspect prediction samples for the highest-error class.",
            "Revise preprocessing or feature selection before rerunning training.",
            "Start a follow-up sklearn run only after reviewing the proposed changes.",
        ]
        iteration_props = {
            "experiment_id": iteration_context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": metrics_path,
            "evaluation_report_path": report_path,
            "prediction_samples_path": prediction_samples_path,
            "preprocessing_plan_path": preprocessing_plan_path,
            "worst_class": diagnosis["worst_class"],
            "main_confusion": diagnosis["main_confusion"],
            "error_count": diagnosis["error_count"],
            "recommendation": diagnosis["recommendation"],
            "error_slices": diagnosis["error_slices"],
            "next_actions": next_actions,
            "required_confirmation": True,
            "source": "intent_router",
        }
        yield self._record(self._stage_event("stage_started", "iterate", "Configuring follow-up experiment"))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "iterate",
                "component": "iteration_proposal",
                "title": "Review follow-up experiment proposal",
                "artifact_path": metrics_path,
                "props": iteration_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=metrics_path or iteration_context.experiment_id,
            )
        )

        text = (
            f"I prepared an iteration proposal for experiment `{iteration_context.experiment_id}`. "
            f"{diagnosis['recommendation']} Review the proposed next actions before changing preprocessing or retraining."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.62,
                "label": "Iteration proposal ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_training(
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
            "args": {"intent": "configure_training", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        training_context, missing_dataset_context, error_event = self._resolve_training_configuration_context(context)
        if training_context is None:
            if missing_dataset_context is not None:
                self._record(started_event)
                yield self._record(self._stage_event("stage_started", "train", "Selecting training dataset"))
                yield self._record(self._missing_dataset_command_event(missing_dataset_context))
                yield self._record(
                    self._tool_finished(
                        call_id=call_id,
                        started_at=started_at,
                        result_ref="missing_context/dataset_path",
                    )
                )
                candidates = ", ".join(
                    f"`{candidate['dataset_path']}`" for candidate in missing_dataset_context.candidate_datasets[:3]
                )
                text = (
                    "I found multiple candidate datasets for training. "
                    f"Choose one before I open the training configuration: {candidates}."
                )
                async for event in self._emit_assistant_message(text):
                    yield event
                yield self._record(
                    {
                        "type": "task_progress",
                        "trace_id": self.trace_id,
                        "task_id": self.session_id,
                        "progress": 0.2,
                        "label": "Waiting for dataset selection",
                        "timestamp": _utc_now(),
                    }
                )
                return
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Training context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_training_context",
                "message": "Training context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        training_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_training",
                "dataset_path": training_context.dataset_path,
                "dataset_version_id": training_context.dataset_version_id,
                "target_column": training_context.target_column,
                "preprocessing_plan_path": training_context.preprocessing_plan_path,
            },
        )
        self._record(started_event)

        yield self._record(self._stage_event("stage_started", "train", "Configuring sklearn training"))
        yield self._record(self._training_command_event(training_context))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "train",
                "component": "training_config",
                "title": "Configure sklearn training",
                "artifact_path": training_context.dataset_path,
                "props": {
                    "dataset_path": training_context.dataset_path,
                    "dataset_version_id": training_context.dataset_version_id,
                    "target_column": training_context.target_column,
                    "preprocessing_plan_path": training_context.preprocessing_plan_path,
                    "engine": "sklearn",
                    "source": "intent_router",
                },
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=training_context.dataset_path,
            )
        )

        plan_text = (
            f" using preprocessing plan `{training_context.preprocessing_plan_path}`"
            if training_context.preprocessing_plan_path
            else ""
        )
        text = (
            f"I prepared a sklearn training configuration for `{training_context.dataset_path}` "
            f"with target column `{training_context.target_column}`{plan_text}. "
            "Review the training card, then start the run when the dataset, target, and plan look right."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.35,
                "label": "Training configuration ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_evaluation(
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
            "args": {"intent": "configure_evaluation", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        evaluation_context, ambiguous_context, error_event = self._resolve_evaluation_context(context, content=content)
        if evaluation_context is None:
            if ambiguous_context is not None:
                self._record(started_event)
                yield self._record(self._stage_event("stage_started", "evaluate", "Selecting experiment run"))
                yield self._record(self._missing_run_command_event(intent="evaluate", context=ambiguous_context))
                yield self._record(
                    self._tool_finished(
                        call_id=call_id,
                        started_at=started_at,
                        result_ref="missing_context/experiment_id",
                    )
                )
                text = (
                    "I found multiple completed experiment runs. "
                    "Select an experiment run before I open model comparison or evaluation report cards."
                )
                async for event in self._emit_assistant_message(text):
                    yield event
                yield self._record(
                    {
                        "type": "task_progress",
                        "trace_id": self.trace_id,
                        "task_id": self.session_id,
                        "progress": 0.2,
                        "label": "Waiting for experiment run selection",
                        "timestamp": _utc_now(),
                    }
                )
                return
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Evaluation context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_evaluation_context",
                "message": "Evaluation context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        run = evaluation_context.run
        metrics_artifact = run.get("metrics_artifact") if isinstance(run.get("metrics_artifact"), dict) else {}
        model_artifact = run.get("model_artifact") if isinstance(run.get("model_artifact"), dict) else {}
        report_artifact = (
            run.get("evaluation_report_artifact")
            if isinstance(run.get("evaluation_report_artifact"), dict)
            else {}
        )
        prediction_artifact = (
            run.get("prediction_samples_artifact")
            if isinstance(run.get("prediction_samples_artifact"), dict)
            else {}
        )
        preprocessing_artifact = (
            run.get("preprocessing_plan_artifact")
            if isinstance(run.get("preprocessing_plan_artifact"), dict)
            else {}
        )
        metrics_path = metrics_artifact.get("path") if isinstance(metrics_artifact.get("path"), str) else None
        model_path = model_artifact.get("path") if isinstance(model_artifact.get("path"), str) else None
        report_path = report_artifact.get("path") if isinstance(report_artifact.get("path"), str) else None
        prediction_samples_path = (
            prediction_artifact.get("path") if isinstance(prediction_artifact.get("path"), str) else None
        )
        preprocessing_plan_path = (
            preprocessing_artifact.get("path") if isinstance(preprocessing_artifact.get("path"), str) else None
        )
        dataset_path = str(run.get("dataset_path") or "")
        target_column = str(run.get("target_column") or "")
        best_model_name = str(run.get("best_model_name") or run.get("engine") or "")

        evaluation_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_evaluation",
                "experiment_id": evaluation_context.experiment_id,
                "dataset_path": dataset_path,
                "metrics_path": metrics_path,
                "evaluation_report_path": report_path,
            },
        )
        self._record(started_event)

        common_props = {
            "experiment_id": evaluation_context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "engine": run.get("engine"),
            "best_model_name": best_model_name,
            "metrics_path": metrics_path,
            "model_path": model_path,
            "evaluation_report_path": report_path,
            "prediction_samples_path": prediction_samples_path,
            "preprocessing_plan_path": preprocessing_plan_path,
            "source": "intent_router",
        }
        yield self._record(self._stage_event("stage_started", "evaluate", "Configuring model evaluation"))
        yield self._record(self._evaluation_command_event(evaluation_context, common_props))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "evaluate",
                "component": "model_comparison",
                "title": "Review model comparison",
                "artifact_path": metrics_path,
                "props": common_props,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "evaluate",
                "component": "evaluation_report",
                "title": "Review evaluation report",
                "artifact_path": report_path,
                "props": common_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=report_path or metrics_path or evaluation_context.experiment_id,
            )
        )

        report_text = (
            f"The evaluation report `{report_path}` is ready."
            if report_path
            else "This run does not have an evaluation report artifact yet; use Regenerate Report from the evaluation card."
        )
        text = (
            f"I found experiment `{evaluation_context.experiment_id}` for `{dataset_path}` "
            f"with target `{target_column}` and best model `{best_model_name}`. "
            f"{report_text} Review the model comparison and report cards before exporting or diagnosing errors."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.55,
                "label": "Evaluation context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_diagnosis(
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
            "args": {"intent": "configure_diagnosis", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        diagnosis_context, ambiguous_context, error_event = self._resolve_evaluation_context(context, content=content)
        if diagnosis_context is None:
            if ambiguous_context is not None:
                self._record(started_event)
                yield self._record(self._stage_event("stage_started", "diagnose", "Selecting experiment run"))
                yield self._record(self._missing_run_command_event(intent="diagnose", context=ambiguous_context))
                yield self._record(
                    self._tool_finished(
                        call_id=call_id,
                        started_at=started_at,
                        result_ref="missing_context/experiment_id",
                    )
                )
                text = (
                    "I found multiple completed experiment runs. "
                    "Select an experiment run before I open diagnosis and prediction sample cards."
                )
                async for event in self._emit_assistant_message(text):
                    yield event
                yield self._record(
                    {
                        "type": "task_progress",
                        "trace_id": self.trace_id,
                        "task_id": self.session_id,
                        "progress": 0.2,
                        "label": "Waiting for experiment run selection",
                        "timestamp": _utc_now(),
                    }
                )
                return
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Diagnosis context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_diagnosis_context",
                "message": "Diagnosis context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        run = diagnosis_context.run
        metrics_artifact = run.get("metrics_artifact") if isinstance(run.get("metrics_artifact"), dict) else {}
        model_artifact = run.get("model_artifact") if isinstance(run.get("model_artifact"), dict) else {}
        report_artifact = (
            run.get("evaluation_report_artifact")
            if isinstance(run.get("evaluation_report_artifact"), dict)
            else {}
        )
        prediction_artifact = (
            run.get("prediction_samples_artifact")
            if isinstance(run.get("prediction_samples_artifact"), dict)
            else {}
        )
        preprocessing_artifact = (
            run.get("preprocessing_plan_artifact")
            if isinstance(run.get("preprocessing_plan_artifact"), dict)
            else {}
        )
        metrics_path = metrics_artifact.get("path") if isinstance(metrics_artifact.get("path"), str) else None
        report_path = report_artifact.get("path") if isinstance(report_artifact.get("path"), str) else None
        prediction_samples_path = (
            prediction_artifact.get("path") if isinstance(prediction_artifact.get("path"), str) else None
        )
        preprocessing_plan_path = (
            preprocessing_artifact.get("path") if isinstance(preprocessing_artifact.get("path"), str) else None
        )
        model_path = model_artifact.get("path") if isinstance(model_artifact.get("path"), str) else None
        dataset_path = str(run.get("dataset_path") or "")
        target_column = str(run.get("target_column") or "")
        best_model_name = str(run.get("best_model_name") or run.get("engine") or "")
        diagnosis = self._diagnosis_summary(run)

        diagnosis_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_diagnosis",
                "experiment_id": diagnosis_context.experiment_id,
                "dataset_path": dataset_path,
                "metrics_path": metrics_path,
                "prediction_samples_path": prediction_samples_path,
                "worst_class": diagnosis["worst_class"],
            },
        )
        self._record(started_event)

        common_props = {
            "experiment_id": diagnosis_context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "engine": run.get("engine"),
            "best_model_name": best_model_name,
            "metrics_path": metrics_path,
            "model_path": model_path,
            "evaluation_report_path": report_path,
            "prediction_samples_path": prediction_samples_path,
            "preprocessing_plan_path": preprocessing_plan_path,
            "worst_class": diagnosis["worst_class"],
            "main_confusion": diagnosis["main_confusion"],
            "error_count": diagnosis["error_count"],
            "recommendation": diagnosis["recommendation"],
            "error_slices": diagnosis["error_slices"],
            "source": "intent_router",
        }
        yield self._record(self._stage_event("stage_started", "diagnose", "Configuring model diagnosis"))
        yield self._record(self._diagnosis_command_event(diagnosis_context, common_props, diagnosis))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "diagnose",
                "component": "error_analysis",
                "title": "Review error slices",
                "artifact_path": metrics_path,
                "props": common_props,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "diagnose",
                "component": "prediction_samples",
                "title": "Inspect prediction samples",
                "artifact_path": prediction_samples_path,
                "props": common_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=prediction_samples_path or metrics_path or diagnosis_context.experiment_id,
            )
        )

        focus = (
            f"The highest-error class is `{diagnosis['worst_class']}` with main confusion `{diagnosis['main_confusion']}`."
            if diagnosis["worst_class"]
            else "No class-level error concentration was found in the confusion matrix."
        )
        sample_text = (
            f" Prediction samples are available at `{prediction_samples_path}`."
            if prediction_samples_path
            else " This run does not have prediction samples yet."
        )
        text = (
            f"I prepared diagnostics for experiment `{diagnosis_context.experiment_id}` on `{dataset_path}`. "
            f"{focus} {diagnosis['recommendation']}{sample_text}"
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.65,
                "label": "Diagnosis context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_export(
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
            "args": {"intent": "configure_export", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        export_context, ambiguous_context, error_event = self._resolve_evaluation_context(context, content=content)
        if export_context is None:
            if ambiguous_context is not None:
                self._record(started_event)
                yield self._record(self._stage_event("stage_started", "export", "Selecting experiment run"))
                yield self._record(self._missing_run_command_event(intent="export", context=ambiguous_context))
                yield self._record(
                    self._tool_finished(
                        call_id=call_id,
                        started_at=started_at,
                        result_ref="missing_context/experiment_id",
                    )
                )
                text = (
                    "I found multiple completed experiment runs. "
                    "Select an experiment run before I prepare the final report or handoff bundle."
                )
                async for event in self._emit_assistant_message(text):
                    yield event
                yield self._record(
                    {
                        "type": "task_progress",
                        "trace_id": self.trace_id,
                        "task_id": self.session_id,
                        "progress": 0.2,
                        "label": "Waiting for experiment run selection",
                        "timestamp": _utc_now(),
                    }
                )
                return
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Export context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_export_context",
                "message": "Export context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        run = export_context.run
        metrics_artifact = run.get("metrics_artifact") if isinstance(run.get("metrics_artifact"), dict) else {}
        model_artifact = run.get("model_artifact") if isinstance(run.get("model_artifact"), dict) else {}
        report_artifact = (
            run.get("evaluation_report_artifact")
            if isinstance(run.get("evaluation_report_artifact"), dict)
            else {}
        )
        prediction_artifact = (
            run.get("prediction_samples_artifact")
            if isinstance(run.get("prediction_samples_artifact"), dict)
            else {}
        )
        preprocessing_artifact = (
            run.get("preprocessing_plan_artifact")
            if isinstance(run.get("preprocessing_plan_artifact"), dict)
            else {}
        )
        export_artifact = (
            run.get("export_bundle_artifact")
            if isinstance(run.get("export_bundle_artifact"), dict)
            else {}
        )
        metrics_path = metrics_artifact.get("path") if isinstance(metrics_artifact.get("path"), str) else None
        model_path = model_artifact.get("path") if isinstance(model_artifact.get("path"), str) else None
        report_path = report_artifact.get("path") if isinstance(report_artifact.get("path"), str) else None
        prediction_samples_path = (
            prediction_artifact.get("path") if isinstance(prediction_artifact.get("path"), str) else None
        )
        preprocessing_plan_path = (
            preprocessing_artifact.get("path") if isinstance(preprocessing_artifact.get("path"), str) else None
        )
        export_bundle_path = export_artifact.get("path") if isinstance(export_artifact.get("path"), str) else None
        dataset_path = str(run.get("dataset_path") or "")
        target_column = str(run.get("target_column") or "")
        best_model_name = str(run.get("best_model_name") or run.get("engine") or "")
        missing_required = [
            label
            for label, path in (
                ("model", model_path),
                ("metrics", metrics_path),
                ("evaluation report", report_path),
            )
            if not path
        ]
        bundle_ready = not missing_required

        export_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_export",
                "experiment_id": export_context.experiment_id,
                "dataset_path": dataset_path,
                "evaluation_report_path": report_path,
                "export_bundle_path": export_bundle_path,
            },
        )
        self._record(started_event)

        export_props = {
            "experiment_id": export_context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "engine": run.get("engine"),
            "best_model_name": best_model_name,
            "metrics_path": metrics_path,
            "model_path": model_path,
            "evaluation_report_path": report_path,
            "prediction_samples_path": prediction_samples_path,
            "preprocessing_plan_path": preprocessing_plan_path,
            "export_bundle_path": export_bundle_path,
            "bundle_ready": bundle_ready,
            "missing_required_artifacts": missing_required,
            "source": "intent_router",
        }
        yield self._record(self._stage_event("stage_started", "export", "Configuring reproducible export"))
        yield self._record(self._export_command_event(export_context, export_props))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "export",
                "component": "evaluation_report",
                "title": "Review final report",
                "artifact_path": report_path,
                "props": export_props,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "export",
                "component": "export_bundle",
                "title": "Prepare handoff bundle",
                "artifact_path": export_bundle_path or report_path,
                "props": export_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=export_bundle_path or report_path or export_context.experiment_id,
            )
        )

        readiness = (
            "All required artifacts are present; use Export Bundle to create the handoff archive."
            if bundle_ready
            else f"The bundle is missing: {', '.join(missing_required)}. Regenerate missing artifacts before exporting."
        )
        existing_bundle = f" Existing bundle: `{export_bundle_path}`." if export_bundle_path else ""
        text = (
            f"I prepared export context for experiment `{export_context.experiment_id}` on `{dataset_path}`. "
            f"{readiness}{existing_bundle}"
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.72,
                "label": "Export context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_configure_learning(
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
            "args": {"intent": "configure_learning", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            yield self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                status="error",
                error=str((error_event or {}).get("message") or "Learning context could not be resolved"),
            )
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_learning_context",
                "message": "Learning context could not be resolved",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        persisted_events = session_context.session_service.list_events(self.session_id)
        candidate_lessons = LessonExtractor(session_context.project_root).extract_from_session(
            self.session_id,
            persisted_events,
        )
        high_confidence = sum(1 for item in candidate_lessons if float(item.get("confidence") or 0) >= 0.8)
        latest_event_type = str(persisted_events[-1].get("type")) if persisted_events else None
        source_artifacts = [
            event.get("artifact", {}).get("path")
            for event in persisted_events
            if isinstance(event.get("artifact"), dict) and isinstance(event.get("artifact", {}).get("path"), str)
        ]
        source_artifacts = [str(path) for path in source_artifacts[-5:]]

        session_context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={
                "active_file": active_file,
                "intent": "configure_learning",
                "candidate_count": len(candidate_lessons),
                "source_event_count": len(persisted_events),
            },
        )
        self._record(started_event)

        lesson_props = {
            "source_session_id": self.session_id,
            "source_event_count": len(persisted_events),
            "candidate_count": len(candidate_lessons),
            "high_confidence_count": high_confidence,
            "latest_event_type": latest_event_type,
            "source_artifacts": source_artifacts,
            "has_extractable_candidates": len(candidate_lessons) > 0,
            "source": "intent_router",
        }
        yield self._record(self._stage_event("stage_started", "learn", "Configuring learned-rule review"))
        yield self._record(self._learning_command_event(session_context, lesson_props))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "learn",
                "component": "lesson_review",
                "title": "Review learned-rule candidates",
                "artifact_path": source_artifacts[-1] if source_artifacts else None,
                "props": lesson_props,
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=self.session_id,
            )
        )

        if candidate_lessons:
            learning_text = (
                f"I found {len(candidate_lessons)} candidate learned rule(s), "
                f"including {high_confidence} high-confidence candidate(s)."
            )
        elif persisted_events:
            learning_text = (
                "I found session evidence, but no rule candidate matched the current extraction heuristics yet."
            )
        else:
            learning_text = "This session does not have persisted evidence events yet."
        text = (
            f"I prepared a learning review for session `{self.session_id}`. "
            f"{learning_text} Use Extract Lessons when you are ready to write reviewable lesson candidates."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.68,
                "label": "Learning context ready",
                "timestamp": _utc_now(),
            }
        )

    async def _run_prepare_for_modeling(
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
            "tool": "agent_orchestrator",
            "args": {"intent": "prepare_for_modeling", **context},
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
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "profile",
                "component": "data_quality",
                "title": "Review data quality profile",
                "artifact_path": profile_bundle["artifact_event"]["artifact"]["path"],
            }
        )

        yield self._record(self._stage_event("stage_started", "transform", "Planning transform"))
        plan_bundle = self._build_preprocessing_plan_artifacts(agent_context)
        yield self._record(plan_bundle["started"])
        yield self._record(plan_bundle["plan_event"])
        yield self._record(plan_bundle["script_event"])
        yield self._record(plan_bundle["finished"])
        yield self._record(
            {
                "type": "approval_required",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "approval_id": f"{self.session_id}-preprocessing-plan",
                "stage": "transform",
                "title": "Approve preprocessing transform",
                "description": "Review the generated plan before transforming the dataset.",
                "artifact_path": plan_bundle["plan_event"]["artifact"]["path"],
                "options": ["execute", "revise"],
            }
        )
        _write_pending_approval(
            project_root=agent_context.project_root,
            session_id=self.session_id,
            approval_id=f"{self.session_id}-preprocessing-plan",
            payload={
                "approval_id": f"{self.session_id}-preprocessing-plan",
                "project_id": agent_context.project_id,
                "active_file": agent_context.active_file,
                "mode": agent_context.mode,
                "stage": "transform",
                "plan_path": plan_bundle["plan_event"]["artifact"]["path"],
                "created_at": _utc_now(),
            },
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "transform",
                "component": "preprocessing_plan",
                "title": "Review preprocessing plan",
                "artifact_path": plan_bundle["plan_event"]["artifact"]["path"],
            }
        )

        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=plan_bundle["plan_event"]["artifact"]["path"],
            )
        )

        text = (
            "I generated a data quality profile, created an auditable preprocessing "
            "plan, and paused before changing the dataset. Approve the preprocessing "
            "checkpoint to create the training-ready dataset."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.55,
                "label": "Waiting for preprocessing approval",
                "timestamp": _utc_now(),
            }
        )

    async def _run_approved_preprocessing_execution(
        self,
        context: AgentContext,
        *,
        plan_project_path: str,
        approval_id: str | None = None,
        retry_count: int = 0,
    ) -> AsyncIterator[dict[str, Any]]:
        execute_bundle = self._build_preprocessing_execution_artifacts(
            context,
            plan_project_path=plan_project_path,
            retry_count=retry_count,
        )
        yield self._record(execute_bundle["started"])
        if execute_bundle.get("failed"):
            if approval_id:
                _delete_pending_approval(
                    project_root=context.project_root,
                    session_id=self.session_id,
                    approval_id=approval_id,
                )
            write_task_state(
                project_root=context.project_root,
                session_id=self.session_id,
                stage="transform",
                payload={
                    "status": "failed",
                    "stage": "transform",
                    "project_id": context.project_id,
                    "active_file": context.active_file,
                    "mode": context.mode,
                    "plan_path": plan_project_path,
                    "retry_count": retry_count,
                    "last_error": execute_bundle["step_failed"]["error"],
                    **recovery_policy(
                        repair_hint="Fix the preprocessing plan or refresh it if the dataset schema changed.",
                        stale_check="Confirm the saved dataset and preprocessing plan still exist before retrying transform.",
                        resume_action="Retry transform from the saved dataset and preprocessing plan.",
                        regenerate_action="Refresh the preprocessing plan from the active dataset before executing again.",
                        abandon_action="Clear the saved transform retry state and keep current files unchanged.",
                        stale_artifact_paths=[context.active_file, plan_project_path],
                    ),
                },
            )
            yield self._record(execute_bundle["finished"])
            yield self._record(execute_bundle["step_failed"])
            yield self._record(execute_bundle["progress"])
            return

        yield self._record(execute_bundle["dataset_event"])
        yield self._record(execute_bundle["summary_event"])
        yield self._record(execute_bundle["report_event"])
        yield self._record(execute_bundle["finished"])
        yield self._record(self._stage_event("stage_completed", "transform", "Transform executed"))
        yield self._record(self._stage_event("stage_started", "train", "Dataset ready for training"))
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "train",
                "component": "planned_dataset",
                "title": "Train from planned dataset",
                "artifact_path": execute_bundle["dataset_event"]["artifact"]["path"],
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "train",
                "component": "training_config",
                "title": "Configure sklearn training",
                "artifact_path": execute_bundle["dataset_event"]["artifact"]["path"],
                "props": {
                    "dataset_path": execute_bundle["dataset_event"]["artifact"]["path"],
                    "target_column": execute_bundle["summary"]["target_column"],
                    "preprocessing_plan_path": plan_project_path,
                },
            }
        )

        if approval_id:
            _delete_pending_approval(
                project_root=context.project_root,
                session_id=self.session_id,
                approval_id=approval_id,
            )
        delete_task_state(project_root=context.project_root, session_id=self.session_id, stage="transform")

        text = (
            "Approval received. I executed the preprocessing plan and produced a "
            "training-ready dataset. "
            f"Next, use {execute_bundle['summary']['target_column']} as the target "
            "column for sklearn training."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 1,
                "label": "Prepared dataset for modeling",
                "timestamp": _utc_now(),
            }
        )
