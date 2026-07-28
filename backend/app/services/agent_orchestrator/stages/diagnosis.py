"""诊断线的 stage runner：迭代提案与模型诊断。

诊断得出的错误切片正是迭代提案的输入，二者是同一条因果链，因此聚在一处。
`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import _utc_now


class DiagnosisStagesMixin:
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

        self._persist_message(
            iteration_context.session_service,
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

        self._persist_message(
            diagnosis_context.session_service,
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

