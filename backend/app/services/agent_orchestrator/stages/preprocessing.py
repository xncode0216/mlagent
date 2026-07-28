"""预处理与审批的 stage runner：变换计划、建模准备、已批准的执行。

三者共享同一个审批检查点语义（写入/删除 pending approval），因此聚在一处。
`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.artifacts import (
    _delete_pending_approval,
    _write_pending_approval,
)
from app.services.agent_orchestrator.contexts import AgentContext
from app.services.agent_orchestrator.support import _utc_now
from app.services.task_state_service import (
    delete_task_state,
    recovery_policy,
    write_task_state,
)


class PreprocessingStagesMixin:
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
