"""交付线的 stage runner：导出包与经验沉淀。

`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变，
仍通过 `self` 访问 dispatcher/messaging 辅助方法。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import _utc_now
from app.services.lesson_extractor import LessonExtractor


class HandoffStagesMixin:
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

        self._persist_message(
            export_context.session_service,
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

        self._persist_message(
            session_context.session_service,
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

