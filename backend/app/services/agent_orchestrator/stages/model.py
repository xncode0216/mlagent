"""模型线的 stage runner：训练配置、评估与报告。

`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变，
仍通过 `self` 访问 dispatcher/messaging 辅助方法。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import _utc_now


class ModelStagesMixin:
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
        self._persist_message(
            training_context.session_service,
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

        self._persist_message(
            evaluation_context.session_service,
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

