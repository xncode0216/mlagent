import json

from collections.abc import AsyncIterator
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4
from app.api.projects import get_registered_project
from app.services.agent_orchestrator.artifacts import (
    _delete_pending_approval,
    _load_pending_approval,
)
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
from app.services.agent_orchestrator.contexts import (
    ActiveFileResolution,
    AgentContext,
    AmbiguousRunContext,
    EvaluationContext,
    MissingDatasetContext,
    ProjectSessionContext,
    TrainingConfigurationContext,
)
from app.services.agent_orchestrator.intent import classify_intent
from app.services.agent_orchestrator.messaging import MessagingMixin
from app.services.agent_orchestrator.runs import (
    artifact_path_from_run,
    candidate_dataset_summaries,
    dataset_column_names,
    diagnosis_summary,
    infer_target_column,
    match_run_by_active_file,
    requests_latest_run,
    run_candidate_summary,
    target_candidates_for_columns,
)
from app.services.agent_orchestrator.stages import StageRunnersMixin
from app.services.agent_orchestrator.support import (
    _dataset_version_id_from_path,
    _resolve_active_file,
    _utc_now,
)
from app.services.agent_orchestrator.tools import _build_analysis_tools as _build_analysis_tools
from app.services.agent_orchestrator.tools import _default_llm_client
from app.services.experiment_service import ExperimentService
from app.services.llm import LLMClient
from app.services.llm_intent import classify_intent_with_llm
from app.services.session_service import SessionService
from app.services.task_state_service import (
    delete_task_state,
    load_task_state,
)


class AgentOrchestrator(StageRunnersMixin, MessagingMixin):
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

        target_column = self._resolve_target_column(context, plan_payload, resolution.csv_path)

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

    def _resolve_target_column(
        self,
        context: dict[str, Any],
        plan_payload: dict[str, Any] | None,
        csv_path: Path,
    ) -> str:
        """决定这次训练用哪一列作目标列。

        **预处理计划是权威来源**：它的 drop_columns / feature_columns / steps 全都是围绕
        自己那个目标列算出来的，换一个目标列这份计划就自相矛盾——训练脚本本来就会以
        "Preprocessing plan target column does not match the requested target" 拒绝。

        `context["target_column"]` 只是兜底，因为前端把设置面板里的「默认目标列」当作
        每条消息的固定载荷发出来（默认值写死为 `churn`），它表达的是偏好而不是本回合的
        选择。此前它排在计划之上，于是数据集只要不叫 churn，训练配置就会拿到一个数据集里
        根本不存在的列。用它之前还要确认那一列真的存在——训练必然失败的输入不该被接受。
        """
        plan_target = plan_payload.get("target_column") if plan_payload is not None else None
        if isinstance(plan_target, str) and plan_target:
            return plan_target

        requested = context.get("target_column")
        if isinstance(requested, str) and requested and requested in dataset_column_names(csv_path):
            return requested

        return self._infer_target_column(csv_path)

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

    def _dataset_registry_props(self, registry_artifact: dict[str, Any]) -> dict[str, Any]:
        return dataset_registry_props(registry_artifact)

