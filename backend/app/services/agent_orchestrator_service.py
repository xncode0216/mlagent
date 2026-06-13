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


class AgentOrchestrator:
    def __init__(self, *, session_id: str, llm_client: LLMClient | None = None):
        self.session_id = session_id
        self.trace_id = uuid4().hex
        self.message_id = uuid4().hex
        self.session_service: SessionService | None = None
        self._llm_client = llm_client if llm_client is not None else _default_llm_client()

    async def run(self, *, content: str, context: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        intent = await self._resolve_intent(content)
        if intent == "abandon_last_failure":
            async for event in self._run_abandon_last_failure(content=content, context=context):
                yield event
            return
        if intent == "continue_from_failure":
            async for event in self._run_continue_from_failure(content=content, context=context):
                yield event
            return
        if intent == "configure_ingest":
            async for event in self._run_configure_ingest(content=content, context=context):
                yield event
            return
        if intent == "configure_profile":
            async for event in self._run_configure_profile(content=content, context=context):
                yield event
            return
        if intent == "configure_cleaning":
            async for event in self._run_configure_cleaning(content=content, context=context):
                yield event
            return
        if intent == "configure_transform":
            async for event in self._run_configure_transform(content=content, context=context):
                yield event
            return
        if intent == "configure_iteration":
            async for event in self._run_configure_iteration(content=content, context=context):
                yield event
            return
        if intent == "configure_training":
            async for event in self._run_configure_training(content=content, context=context):
                yield event
            return
        if intent == "configure_evaluation":
            async for event in self._run_configure_evaluation(content=content, context=context):
                yield event
            return
        if intent == "configure_diagnosis":
            async for event in self._run_configure_diagnosis(content=content, context=context):
                yield event
            return
        if intent == "configure_export":
            async for event in self._run_configure_export(content=content, context=context):
                yield event
            return
        if intent == "configure_learning":
            async for event in self._run_configure_learning(content=content, context=context):
                yield event
            return
        if intent == "prepare_for_modeling":
            async for event in self._run_prepare_for_modeling(content=content, context=context):
                yield event
            return

        async for event in self._run_analysis_overview(content=content, context=context):
            yield event

    async def respond_to_approval(
        self,
        *,
        approval_id: str,
        decision: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        project_id = context.get("project_id")
        if not isinstance(project_id, str):
            yield {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project id is required",
            }
            return

        project = get_registered_project(project_id)
        if project is None:
            yield {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "project_not_found",
                "message": "Project not found",
            }
            return

        project_root = Path(project.workspace_path).resolve()
        pending = _load_pending_approval(
            project_root=project_root,
            session_id=self.session_id,
            approval_id=approval_id,
        )
        if pending is None:
            self.session_service = SessionService(project_root)
            yield self._record(
                {
                    "type": "error",
                    "trace_id": self.trace_id,
                    "code": "approval_not_found",
                    "message": "Approval request was not found or has already been handled",
                }
            )
            return

        if pending is not None and isinstance(pending.get("active_file"), str):
            context = {**context, "active_file": pending["active_file"]}

        agent_context, resolution = self._resolve_context(context)
        if agent_context is None:
            call_id = uuid4().hex
            started_at = perf_counter()
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        normalized_decision = decision.lower().strip()
        if normalized_decision not in {"execute", "approve"}:
            _delete_pending_approval(
                project_root=agent_context.project_root,
                session_id=self.session_id,
                approval_id=approval_id,
            )
            yield self._record(
                {
                    "type": "approval_resolved",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "approval_id": approval_id,
                    "stage": "transform",
                    "decision": normalized_decision or "revise",
                    "resolved_at": _utc_now(),
                }
            )
            yield self._record(
                {
                    "type": "step_failed",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "stage": "transform",
                    "label": "Preprocessing plan needs revision",
                    "error": "Approval was not granted",
                    "retryable": False,
                    "resume_stage": "transform",
                }
            )
            return

        yield self._record(
            {
                "type": "approval_resolved",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "approval_id": approval_id,
                "stage": "transform",
                "decision": "execute",
                "resolved_at": _utc_now(),
            }
        )
        yield self._record(
            {
                "type": "task_resumed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "transform",
                "label": "Approval granted; executing preprocessing plan",
            }
        )

        plan_path = pending.get("plan_path")
        if not isinstance(plan_path, str) or not plan_path:
            _delete_pending_approval(
                project_root=agent_context.project_root,
                session_id=self.session_id,
                approval_id=approval_id,
            )
            yield self._record(
                {
                    "type": "step_failed",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "stage": "transform",
                    "label": "Preprocessing plan execution failed",
                    "error": "Pending approval does not contain a preprocessing plan path",
                    "retryable": False,
                    "resume_stage": "transform",
                }
            )
            return

        async for event in self._run_approved_preprocessing_execution(
            agent_context,
            plan_project_path=plan_path,
            approval_id=approval_id,
        ):
            yield event

    async def resume_step(
        self,
        *,
        stage: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        if stage != "transform":
            yield {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "unsupported_resume_stage",
                "message": f"Resume is not supported for the {stage} stage yet",
            }
            return

        project_id = context.get("project_id")
        if not isinstance(project_id, str):
            yield {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project id is required",
            }
            return

        project = get_registered_project(project_id)
        if project is None:
            yield {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "project_not_found",
                "message": "Project not found",
            }
            return

        project_root = Path(project.workspace_path).resolve()
        self.session_service = SessionService(project_root)
        state = load_task_state(
            project_root=project_root,
            session_id=self.session_id,
            stage=stage,
        )
        if state is None:
            yield self._record(
                {
                    "type": "error",
                    "trace_id": self.trace_id,
                    "code": "resume_state_not_found",
                    "message": "No failed transform task state was found for this session",
                }
            )
            return

        active_file = state.get("active_file")
        plan_path = state.get("plan_path")
        if not isinstance(active_file, str) or not isinstance(plan_path, str) or not plan_path:
            delete_task_state(project_root=project_root, session_id=self.session_id, stage=stage)
            yield self._record(
                {
                    "type": "error",
                    "trace_id": self.trace_id,
                    "code": "invalid_resume_state",
                    "message": "The saved transform retry state is incomplete",
                }
            )
            return

        retry_count = int(state.get("retry_count") or 0) + 1
        resume_context = {
            **context,
            "project_id": project_id,
            "active_file": active_file,
            "mode": state.get("mode") if isinstance(state.get("mode"), str) else context.get("mode"),
        }
        agent_context, resolution = self._resolve_context(resume_context)
        if agent_context is None:
            call_id = uuid4().hex
            started_at = perf_counter()
            async for event in self._emit_resolution_error(
                call_id=call_id,
                started_at=started_at,
                resolution=resolution,
            ):
                yield event
            return

        yield self._record(
            {
                "type": "task_resumed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": "transform",
                "label": "Retrying transform step",
                "retry_count": retry_count,
            }
        )

        async for event in self._run_approved_preprocessing_execution(
            agent_context,
            plan_project_path=plan_path,
            retry_count=retry_count,
        ):
            yield event

    def _classify_intent(self, content: str) -> str:
        return classify_intent(content)

    async def _resolve_intent(self, content: str) -> str:
        """Use the LLM router when configured, else the keyword classifier.

        The keyword result is always computed and used as the fallback, so
        behavior is unchanged when no LLM is configured or the LLM call fails.
        """
        keyword_intent = self._classify_intent(content)
        if self._llm_client is None:
            return keyword_intent
        return await classify_intent_with_llm(self._llm_client, content, fallback=keyword_intent)

    def _resolve_project_session_context(
        self,
        context: dict[str, Any],
    ) -> tuple[ProjectSessionContext | None, dict[str, Any] | None]:
        project_id = context.get("project_id")
        if not isinstance(project_id, str):
            return None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project id is required",
            }

        project = get_registered_project(project_id)
        if project is None:
            return None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "project_not_found",
                "message": "Project not found",
            }

        project_root = Path(project.workspace_path).resolve()
        mode = str(context.get("mode") or "analysis")
        session_service = SessionService(project_root)
        session_service.ensure_session(
            project_id=project_id,
            session_id=self.session_id,
            mode=mode,
        )
        self.session_service = session_service
        return (
            ProjectSessionContext(
                project_id=project_id,
                project_root=project_root,
                mode=mode,
                session_service=session_service,
            ),
            None,
        )

    def _record(self, event: dict[str, Any]) -> dict[str, Any]:
        if self.session_service is None:
            return event
        if self.session_service.get_session(self.session_id) is None:
            return event
        self.session_service.append_event(
            session_id=self.session_id,
            event_type=str(event["type"]),
            payload=event,
        )
        return event

    def _resolve_context(self, context: dict[str, Any]) -> tuple[AgentContext | None, ActiveFileResolution]:
        project_id = context.get("project_id")
        active_file = context.get("active_file")
        resolution = _resolve_active_file(project_id, active_file)
        if resolution.code is not None or resolution.csv_path is None:
            return None, resolution
        if not isinstance(project_id, str) or not isinstance(active_file, str):
            return None, resolution

        project = get_registered_project(project_id)
        if project is None:
            return None, ActiveFileResolution(None, "project_not_found", "Project not found")

        project_root = Path(project.workspace_path).resolve()
        session_service = SessionService(project_root)
        self.session_service = session_service
        mode = str(context.get("mode") or "analysis")
        session_service.ensure_session(
            project_id=project_id,
            session_id=self.session_id,
            mode=mode,
        )
        return (
            AgentContext(
                project_id=project_id,
                project_root=project_root,
                active_file=active_file,
                csv_path=resolution.csv_path,
                mode=mode,
                session_service=session_service,
            ),
            resolution,
        )

    def _resolve_training_configuration_context(
        self,
        context: dict[str, Any],
    ) -> tuple[TrainingConfigurationContext | None, MissingDatasetContext | None, dict[str, Any] | None]:
        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            return None, None, error_event

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        dataset_path = (
            context.get("training_dataset_path")
            if isinstance(context.get("training_dataset_path"), str) and context.get("training_dataset_path")
            else active_file
        )
        preprocessing_plan_path = (
            context.get("preprocessing_plan_path")
            if isinstance(context.get("preprocessing_plan_path"), str) and context.get("preprocessing_plan_path")
            else None
        )
        plan_payload: dict[str, Any] | None = None

        if active_file.endswith("preprocessing_plan.json") and preprocessing_plan_path is None:
            preprocessing_plan_path = active_file

        if preprocessing_plan_path:
            plan_file = (session_context.project_root / preprocessing_plan_path).resolve()
            if session_context.project_root != plan_file and session_context.project_root not in plan_file.parents:
                return None, None, {
                    "type": "error",
                    "trace_id": self.trace_id,
                    "code": "invalid_preprocessing_plan",
                    "message": "Preprocessing plan is outside the project workspace",
                }
            if not plan_file.exists() or not plan_file.is_file():
                return None, None, {
                    "type": "error",
                    "trace_id": self.trace_id,
                    "code": "preprocessing_plan_not_found",
                    "message": "Preprocessing plan was not found",
                }
            try:
                loaded = json.loads(plan_file.read_text(encoding="utf-8"))
                plan_payload = loaded if isinstance(loaded, dict) else None
            except json.JSONDecodeError:
                plan_payload = None

        if (not dataset_path or not str(dataset_path).lower().endswith(".csv")) and plan_payload is not None:
            plan_dataset_path = plan_payload.get("dataset_path") or plan_payload.get("output_dataset_path")
            if isinstance(plan_dataset_path, str) and plan_dataset_path:
                dataset_path = plan_dataset_path

        if not isinstance(dataset_path, str) or not dataset_path:
            return None, None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "missing_training_dataset",
                "message": "Training dataset path is required",
            }

        resolution = _resolve_active_file(session_context.project_id, dataset_path)
        if resolution.code is not None or resolution.csv_path is None:
            if resolution.code in {"unsupported_active_file", "active_file_not_found"}:
                candidate_datasets = self._candidate_dataset_summaries(session_context.project_root)
                if candidate_datasets:
                    return (
                        None,
                        MissingDatasetContext(
                            project_id=session_context.project_id,
                            mode=session_context.mode,
                            active_file=active_file,
                            candidate_datasets=candidate_datasets,
                        ),
                        None,
                    )
            return None, None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": resolution.code or "invalid_training_dataset",
                "message": resolution.message or "Training dataset could not be resolved",
            }

        target_column = (
            context.get("target_column")
            if isinstance(context.get("target_column"), str) and context.get("target_column")
            else None
        )
        if target_column is None and plan_payload is not None and isinstance(plan_payload.get("target_column"), str):
            target_column = plan_payload["target_column"]
        if target_column is None:
            target_column = self._infer_target_column(resolution.csv_path)

        return (
            TrainingConfigurationContext(
                project_id=session_context.project_id,
                project_root=session_context.project_root,
                mode=session_context.mode,
                session_service=session_context.session_service,
                dataset_path=dataset_path,
                dataset_version_id=_dataset_version_id_from_path(dataset_path),
                dataset_file=resolution.csv_path,
                target_column=target_column,
                preprocessing_plan_path=preprocessing_plan_path,
            ),
            None,
            None,
        )

    def _resolve_evaluation_context(
        self,
        context: dict[str, Any],
        *,
        content: str = "",
        allow_implicit_latest: bool = False,
    ) -> tuple[EvaluationContext | None, AmbiguousRunContext | None, dict[str, Any] | None]:
        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            return None, None, error_event

        experiment_service = ExperimentService(session_context.project_root)
        experiment_id = (
            context.get("experiment_id")
            if isinstance(context.get("experiment_id"), str) and context.get("experiment_id")
            else None
        )
        run = experiment_service.get_run(experiment_id) if experiment_id else None
        if experiment_id and run is None:
            return None, None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "experiment_not_found",
                "message": "Selected experiment run was not found",
            }

        if run is None:
            completed_runs = [item for item in experiment_service.list_runs() if item.get("status") == "completed"]
            active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
            active_match = self._match_run_by_active_file(completed_runs, active_file)
            if active_match is not None:
                run = active_match
            elif len(completed_runs) == 1 or allow_implicit_latest or self._requests_latest_run(content):
                run = next(iter(completed_runs), None)
            elif completed_runs:
                return (
                    None,
                    AmbiguousRunContext(
                        project_id=session_context.project_id,
                        mode=session_context.mode,
                        active_file=active_file,
                        candidate_runs=[
                            self._run_candidate_summary(item)
                            for item in completed_runs[:5]
                        ],
                    ),
                    None,
                )

        if run is None:
            return None, None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "missing_experiment_run",
                "message": "No completed experiment run is available for evaluation",
            }

        resolved_experiment_id = run.get("experiment_id")
        if not isinstance(resolved_experiment_id, str) or not resolved_experiment_id:
            return None, None, {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_experiment_run",
                "message": "Experiment run is missing an experiment id",
            }

        return (
            EvaluationContext(
                project_id=session_context.project_id,
                project_root=session_context.project_root,
                mode=session_context.mode,
                session_service=session_context.session_service,
                experiment_id=resolved_experiment_id,
                run=run,
            ),
            None,
            None,
        )

    def _requests_latest_run(self, content: str) -> bool:
        return requests_latest_run(content)

    def _artifact_path_from_run(self, run: dict[str, Any], key: str) -> str | None:
        return artifact_path_from_run(run, key)

    def _match_run_by_active_file(self, runs: list[dict[str, Any]], active_file: str) -> dict[str, Any] | None:
        return match_run_by_active_file(runs, active_file)

    def _run_candidate_summary(self, run: dict[str, Any]) -> dict[str, str]:
        return run_candidate_summary(run)

    def _target_candidates_for_columns(self, columns: list[str]) -> list[str]:
        return target_candidates_for_columns(columns)

    def _candidate_dataset_summaries(self, project_root: Path) -> list[dict[str, str]]:
        return candidate_dataset_summaries(project_root)

    def _diagnosis_summary(self, run: dict[str, Any]) -> dict[str, Any]:
        return diagnosis_summary(run)

    def _infer_target_column(self, csv_path: Path) -> str:
        return infer_target_column(csv_path)

    def _append_user_message(self, context: AgentContext, content: str) -> None:
        context.session_service.append_message(
            session_id=self.session_id,
            role="user",
            content=content,
            metadata={"active_file": context.active_file},
        )

    async def _emit_assistant_message(self, text: str) -> AsyncIterator[dict[str, Any]]:
        for chunk in text:
            yield {
                "type": "message_delta",
                "trace_id": self.trace_id,
                "message_id": self.message_id,
                "delta": chunk,
            }
            await asyncio.sleep(0.001)
        if self.session_service is not None and self.session_service.get_session(self.session_id):
            self.session_service.append_message(
                session_id=self.session_id,
                role="assistant",
                content=text,
                metadata={"message_id": self.message_id},
            )

    async def _emit_llm_message(
        self,
        *,
        messages: list[ChatMessage],
        fallback_text: str,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream a real LLM reply as message_delta events.

        Falls back to ``fallback_text`` when no LLM is configured or the call
        fails before producing any text, so this path always yields a reply.
        """
        if self._llm_client is None:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        collected: list[str] = []
        try:
            async for chunk in self._llm_client.stream(messages, max_tokens=600):
                collected.append(chunk)
                yield {
                    "type": "message_delta",
                    "trace_id": self.trace_id,
                    "message_id": self.message_id,
                    "delta": chunk,
                }
        except LLMError:
            if not collected:
                async for event in self._emit_assistant_message(fallback_text):
                    yield event
                return

        text = "".join(collected) or fallback_text
        if self.session_service is not None and self.session_service.get_session(self.session_id):
            self.session_service.append_message(
                session_id=self.session_id,
                role="assistant",
                content=text,
                metadata={"message_id": self.message_id},
            )

    async def _run_agentic_answer(
        self,
        *,
        agent_context: AgentContext,
        content: str,
        fallback_text: str,
    ) -> AsyncIterator[dict[str, Any]]:
        """Let the LLM autonomously call read-only tools, then stream its answer.

        Drives :func:`run_tool_phase` so the model decides which dataset tools to
        run, surfaces each call as the orchestrator's standard
        ``tool_call_started`` / ``tool_call_finished`` events, then streams the
        final grounded reply over the tool-augmented conversation. Any LLM failure
        falls back to ``fallback_text`` so the turn always yields a reply. The
        deterministic profile artifacts created by the caller remain the inspector's
        source of truth; this loop adds the reasoning layer on top.
        """
        if self._llm_client is None:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        tools, execute = _build_analysis_tools(agent_context.csv_path)
        conversation: list[ChatMessage] = [
            ChatMessage.system(_ANALYSIS_AGENT_PROMPT),
            ChatMessage.user(content),
        ]
        started_at: dict[str, float] = {}
        try:
            async for event in run_tool_phase(
                self._llm_client,
                conversation=conversation,
                tools=tools,
                execute=execute,
            ):
                if isinstance(event, ToolCallStarted):
                    started_at[event.call_id] = perf_counter()
                    yield self._record(
                        {
                            "type": "tool_call_started",
                            "trace_id": self.trace_id,
                            "call_id": event.call_id,
                            "tool": event.call.name,
                            "args": event.call.arguments,
                            "started_at": _utc_now(),
                        }
                    )
                elif isinstance(event, ToolCallFinished):
                    yield self._record(
                        self._tool_finished(
                            call_id=event.call_id,
                            started_at=started_at.get(event.call_id, perf_counter()),
                            status="error" if event.error else "success",
                            error=event.output if event.error else None,
                        )
                    )
        except LLMError:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        async for event in self._emit_llm_message(
            messages=conversation, fallback_text=fallback_text
        ):
            yield event

    async def _emit_resolution_error(
        self,
        *,
        call_id: str,
        started_at: float,
        resolution: ActiveFileResolution,
    ) -> AsyncIterator[dict[str, Any]]:
        yield {
            "type": "tool_call_finished",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "status": "error",
            "error": resolution.message,
            "finished_at": _utc_now(),
            "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        }
        yield {
            "type": "error",
            "trace_id": self.trace_id,
            "code": resolution.code,
            "message": resolution.message,
        }

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

    def _profile_props(self, context: AgentContext, profile_artifact: dict[str, Any]) -> dict[str, Any]:
        return profile_props(context, profile_artifact)

    def _training_command_event(self, context: TrainingConfigurationContext) -> dict[str, Any]:
        return training_command_event(self, context)

    def _missing_dataset_command_event(self, context: MissingDatasetContext) -> dict[str, Any]:
        return missing_dataset_command_event(self, context)

    def _evaluation_command_event(self, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
        return evaluation_command_event(self, context, props)

    def _diagnosis_command_event(
        self,
        context: EvaluationContext,
        props: dict[str, Any],
        diagnosis: dict[str, Any],
    ) -> dict[str, Any]:
        return diagnosis_command_event(self, context, props, diagnosis)

    def _export_command_event(self, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
        return export_command_event(self, context, props)

    def _learning_command_event(self, context: ProjectSessionContext, props: dict[str, Any]) -> dict[str, Any]:
        return learning_command_event(self, context, props)

    def _missing_run_command_event(self, *, intent: str, context: AmbiguousRunContext) -> dict[str, Any]:
        return missing_run_command_event(self, intent=intent, context=context)

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

    def _stage_event(self, event_type: str, stage: str, label: str) -> dict[str, Any]:
        key = "completed_at" if event_type == "stage_completed" else "started_at"
        return {
            "type": event_type,
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "stage": stage,
            "label": label,
            key: _utc_now(),
        }

    def _rules_event(self, context: AgentContext) -> dict[str, Any]:
        rule_service = RuleInjectionService(context.project_root)
        match_result = rule_service.match_rules(
            session_id=self.session_id,
            context={
                "mode": context.mode,
                "tags": ["missing-value"],
            },
        )
        return {
            "type": "rules_matched",
            "trace_id": self.trace_id,
            "matched_rules": match_result["matched_rules"],
            "prompt_snippet": rule_service.inject_prompt(
                self.session_id,
                match_result["matched_rules"],
            ),
        }

    def _lesson_events(self, context: AgentContext) -> list[dict[str, Any]]:
        lesson_candidates = LessonExtractor(context.project_root).extract_from_session(
            self.session_id,
            context.session_service.list_events(self.session_id),
        )
        evolution = EvolutionService(context.project_root)
        events = []
        for item in lesson_candidates:
            lesson = evolution.create_lesson(
                source_type=item["source_type"],
                source_id=item["source_id"],
                domain=item["domain"],
                observation=item["observation"],
                recommendation=item["recommendation"],
                confidence=item["confidence"],
                evidence=item.get("evidence", {}),
                title=item.get("title", ""),
                conditions=item.get("conditions", {}),
                expected_benefit=item.get("expected_benefit", {}),
            )
            events.append(
                {
                    "type": "lesson_extracted",
                    "trace_id": self.trace_id,
                    "lesson_id": lesson.id,
                    "confidence": lesson.confidence,
                }
            )
        return events

    def _tool_started(
        self,
        *,
        call_id: str,
        tool: str,
        stage: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "type": "tool_started",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "call_id": call_id,
            "tool": tool,
            "stage": stage,
            "args": args,
            "started_at": _utc_now(),
        }

    def _tool_finished(
        self,
        *,
        call_id: str,
        started_at: float,
        status: str = "success",
        result_ref: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "tool_call_finished",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "status": status,
            **({"result_ref": result_ref} if result_ref else {}),
            **({"error": error} if error else {}),
            "finished_at": _utc_now(),
            "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        }

    def _build_profile_artifact(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        profile = data_quality_profile(context.csv_path)
        artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=context.project_root / "results" / self.session_id / "data_quality_profile.json",
            artifact_type="dataframe",
            payload=profile,
            metadata={
                "dataset_path": context.active_file,
                "profile_type": "data_quality",
                "row_count": profile.get("row_count", 0),
                "column_count": profile.get("column_count", 0),
                "target_candidates": profile.get("target_candidates", []),
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="data_quality_profile",
                stage="profile",
                args={"dataset_path": context.active_file},
            ),
            "artifact_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=artifact["path"],
            ),
        }

    def _build_dataset_registry_artifact(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        with context.csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.reader(handle)
            columns = [column.strip() for column in next(reader, [])]
            row_count = sum(1 for _ in reader)

        file_hash = hashlib.sha256(context.csv_path.read_bytes()).hexdigest()
        dataset_version_id = f"csv-{context.csv_path.stem}-{self.session_id}"
        registry_entry = {
            "dataset_version_id": dataset_version_id,
            "dataset_path": context.active_file,
            "source": {
                "kind": "project_file",
                "path": context.active_file,
                "format": "csv",
                "sha256": file_hash,
                "size_bytes": context.csv_path.stat().st_size,
            },
            "schema": {
                "columns": columns,
                "column_count": len(columns),
            },
            "row_count": row_count,
            "sample_strategy": "full_csv_scan",
            "registered_at": _utc_now(),
        }
        artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=context.project_root / "results" / self.session_id / "dataset_registry_entry.json",
            artifact_type="dataframe",
            payload=registry_entry,
            metadata={
                "dataset_path": context.active_file,
                "dataset_version_id": dataset_version_id,
                "artifact_role": "dataset_registry_entry",
                "source_format": "csv",
                "row_count": row_count,
                "column_count": len(columns),
                "columns": columns,
                "sample_strategy": "full_csv_scan",
                "sha256": file_hash,
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="register_dataset",
                stage="ingest",
                args={"dataset_path": context.active_file},
            ),
            "artifact_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=artifact["path"],
            ),
        }

    def _dataset_registry_props(self, registry_artifact: dict[str, Any]) -> dict[str, Any]:
        return dataset_registry_props(registry_artifact)

    def _build_preprocessing_plan_artifacts(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        plan = preprocessing_plan(context.csv_path, dataset_path=context.active_file)
        result_dir = context.project_root / "results" / self.session_id
        plan_path = result_dir / "preprocessing_plan.json"
        output_path = result_dir / f"{context.csv_path.stem}_preprocessed.csv"
        output_project_path = _relative_path(context.project_root, output_path)

        manual_output = str(
            Path("results") / "manual-analysis" / f"{context.csv_path.stem}_preprocessed.csv"
        )
        script = str(plan.pop("pipeline_script", ""))
        script = script.replace(
            f"output_path = {manual_output!r}",
            f"output_path = {output_project_path!r}",
        )
        plan["output_dataset_path"] = output_project_path
        plan["sklearn_pipeline_script_path"] = f"notebooks/{self.session_id}_preprocessing_pipeline.py"

        plan_artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=plan_path,
            artifact_type="dataframe",
            payload=plan,
            metadata={
                "dataset_path": context.active_file,
                "target_column": plan["target_column"],
                "artifact_role": "preprocessing_plan",
                "output_dataset_path": plan["output_dataset_path"],
                "feature_columns": plan["feature_columns"],
                "drop_columns": plan["drop_columns"],
            },
        )
        script_path = context.project_root / "notebooks" / f"{self.session_id}_preprocessing_pipeline.py"
        script_artifact = _write_text_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=script_path,
            artifact_type="code",
            content=script,
            metadata={
                "dataset_path": context.active_file,
                "target_column": plan["target_column"],
                "plan_path": plan_artifact["path"],
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="preprocessing_plan",
                stage="transform",
                args={"dataset_path": context.active_file},
            ),
            "plan_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": plan_artifact,
            },
            "script_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": script_artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=plan_artifact["path"],
            ),
        }

    def _build_preprocessing_execution_artifacts(
        self,
        context: AgentContext,
        *,
        plan_project_path: str,
        retry_count: int = 0,
    ) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        result_dir = context.project_root / "results" / self.session_id
        output_path = result_dir / f"{context.csv_path.stem}_planned.csv"
        output_project_path = _relative_path(context.project_root, output_path)
        plan_file = (context.project_root / plan_project_path).resolve()
        started = self._tool_started(
            call_id=call_id,
            tool="execute_preprocessing_plan",
            stage="transform",
            args={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
            },
        )
        try:
            summary = execute_preprocessing_plan(
                csv_path=context.csv_path,
                plan_path=plan_file,
                output_path=output_path,
                dataset_path=context.active_file,
                plan_project_path=plan_project_path,
                output_project_path=output_project_path,
            )
        except Exception as exc:
            error = str(exc) or exc.__class__.__name__
            failed_at = _utc_now()
            return {
                "failed": True,
                "failed_at": failed_at,
                "started": started,
                "finished": self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    status="error",
                    error=error,
                ),
                "step_failed": {
                    "type": "step_failed",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "stage": "transform",
                    "label": "Preprocessing plan execution failed",
                    "error": error,
                    "retryable": True,
                    "resume_stage": "transform",
                    "retry_count": retry_count,
                },
                "progress": {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 0.55,
                    "label": "Preprocessing execution failed",
                    "timestamp": failed_at,
                },
            }

        summary_path = result_dir / "preprocessing_transform_report.json"
        report_path = result_dir / "preprocessing_transform_report.md"
        summary_artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=summary_path,
            artifact_type="dataframe",
            payload=summary,
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_summary",
            },
        )
        report_artifact = _write_text_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=report_path,
            artifact_type="report",
            content=_render_transformation_report(summary),
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_report",
            },
        )
        dataset_artifact = _artifact_payload(
            project_id=context.project_id,
            session_id=self.session_id,
            artifact_type="dataframe",
            name=output_path.name,
            path=output_project_path,
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "target_column": summary["target_column"],
                "artifact_role": "preprocessed_dataset",
            },
        )
        return {
            "started": started,
            "dataset_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": dataset_artifact,
            },
            "summary_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": summary_artifact,
            },
            "report_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": report_artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=output_project_path,
            ),
            "summary": summary,
        }
