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
from app.services.agent_orchestrator.stages import StageRunnersMixin


class AgentOrchestrator(StageRunnersMixin):
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
