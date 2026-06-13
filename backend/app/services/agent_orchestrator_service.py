import asyncio
import csv
import hashlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
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
from app.tools.data_analysis import (
    correlation_matrix,
    data_quality_profile,
    detect_missing,
    execute_preprocessing_plan,
    plot_distribution,
    preprocessing_plan,
    profile_dataset,
)


@dataclass(frozen=True)
class ActiveFileResolution:
    csv_path: Path | None
    code: str | None = None
    message: str | None = None


@dataclass(frozen=True)
class AgentContext:
    project_id: str
    project_root: Path
    active_file: str
    csv_path: Path
    mode: str
    session_service: SessionService


@dataclass(frozen=True)
class ProjectSessionContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService


@dataclass(frozen=True)
class TrainingConfigurationContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService
    dataset_path: str
    dataset_version_id: str
    dataset_file: Path
    target_column: str
    preprocessing_plan_path: str | None


@dataclass(frozen=True)
class MissingDatasetContext:
    project_id: str
    mode: str
    active_file: str
    candidate_datasets: list[dict[str, str]]


@dataclass(frozen=True)
class EvaluationContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService
    experiment_id: str
    run: dict[str, Any]


@dataclass(frozen=True)
class AmbiguousRunContext:
    project_id: str
    mode: str
    active_file: str
    candidate_runs: list[dict[str, str]]


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _relative_path(root: Path, target: Path) -> str:
    return str(target.relative_to(root)).replace("\\", "/")


def _dataset_version_id_from_path(path: str) -> str:
    stem = Path(path).stem
    safe_stem = "".join(character if character.isalnum() or character in "-_" else "_" for character in stem)
    return f"csv-{safe_stem or 'dataset'}"


RECOVERABLE_STAGES = {"transform", "train", "evaluate", "export", "learn"}
TARGET_COLUMN_FALLBACKS = ("churn", "target", "label", "class", "outcome", "y")
DATASET_CANDIDATE_SUFFIXES = {".csv"}


def _resolve_active_file(project_id: object, active_file: object) -> ActiveFileResolution:
    if not isinstance(project_id, str) or not isinstance(active_file, str):
        return ActiveFileResolution(
            None,
            "invalid_context",
            "Project id and active file are required",
        )

    project = get_registered_project(project_id)
    if project is None:
        return ActiveFileResolution(None, "project_not_found", "Project not found")

    project_root = Path(project.workspace_path).resolve()
    csv_path = (project_root / active_file).resolve()
    if project_root != csv_path and project_root not in csv_path.parents:
        return ActiveFileResolution(
            None,
            "invalid_active_file",
            "Active file is outside the project workspace",
        )
    if not csv_path.exists() or not csv_path.is_file():
        return ActiveFileResolution(None, "active_file_not_found", "Active file was not found")
    if csv_path.suffix.lower() != ".csv":
        return ActiveFileResolution(None, "unsupported_active_file", "Only CSV files are supported")
    return ActiveFileResolution(csv_path=csv_path)


def _approval_filename(approval_id: str) -> str:
    safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in approval_id)
    return f"{safe or uuid4().hex}.json"


def _pending_approval_path(project_root: Path, session_id: str, approval_id: str) -> Path:
    return project_root / "sessions" / session_id / "pending_approvals" / _approval_filename(approval_id)


def _write_pending_approval(
    *,
    project_root: Path,
    session_id: str,
    approval_id: str,
    payload: dict[str, Any],
) -> None:
    path = _pending_approval_path(project_root, session_id, approval_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_pending_approval(
    *,
    project_root: Path,
    session_id: str,
    approval_id: str,
) -> dict[str, Any] | None:
    path = _pending_approval_path(project_root, session_id, approval_id)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else None


def _delete_pending_approval(*, project_root: Path, session_id: str, approval_id: str) -> None:
    path = _pending_approval_path(project_root, session_id, approval_id)
    if path.exists():
        path.unlink()


def _artifact_payload(
    *,
    project_id: str,
    session_id: str,
    artifact_type: str,
    name: str,
    path: str,
    metadata: dict[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    created = created_at or _utc_now()
    return {
        "id": uuid4().hex,
        "project_id": project_id,
        "session_id": session_id,
        "type": artifact_type,
        "name": name,
        "path": path,
        "metadata": metadata,
        "created_at": created,
    }


def _write_json_artifact(
    *,
    project_id: str,
    session_id: str,
    project_root: Path,
    path: Path,
    artifact_type: str,
    payload: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return _artifact_payload(
        project_id=project_id,
        session_id=session_id,
        artifact_type=artifact_type,
        name=path.name,
        path=_relative_path(project_root, path),
        metadata=metadata,
    )


def _write_text_artifact(
    *,
    project_id: str,
    session_id: str,
    project_root: Path,
    path: Path,
    artifact_type: str,
    content: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="")
    return _artifact_payload(
        project_id=project_id,
        session_id=session_id,
        artifact_type=artifact_type,
        name=path.name,
        path=_relative_path(project_root, path),
        metadata=metadata,
    )


def _render_transformation_report(summary: dict[str, Any]) -> str:
    numeric_transforms = summary.get("transformations", {}).get("numeric", {})
    numeric_rows = "\n".join(
        f"| {column} | {details.get('fill_value')} | {details.get('scaler')} |"
        for column, details in numeric_transforms.items()
    )
    if not numeric_rows:
        numeric_rows = "| - | - | - |"

    categorical_transforms = summary.get("transformations", {}).get("categorical", {})
    categorical_rows = "\n".join(
        f"| {column} | {details.get('fill_value')} | {details.get('encoder')} |"
        for column, details in categorical_transforms.items()
    )
    if not categorical_rows:
        categorical_rows = "| - | - | - |"

    dropped_transforms = summary.get("transformations", {}).get("dropped", {})
    drop_rows = "\n".join(f"| {column} | {reason} |" for column, reason in dropped_transforms.items())
    if not drop_rows:
        drop_rows = "| - | - |"

    return "\n".join(
        [
            "# Preprocessing Transformation Report",
            "",
            "## Summary",
            "",
            f"- Source dataset: `{summary['source_dataset_path']}`",
            f"- Preprocessing plan: `{summary['preprocessing_plan_path']}`",
            f"- Output dataset: `{summary['output_dataset_path']}`",
            f"- Target column: `{summary['target_column']}`",
            f"- Input shape: {summary['input_shape']['rows']} rows x "
            f"{summary['input_shape']['columns']} columns",
            f"- Output shape: {summary['output_shape']['rows']} rows x "
            f"{summary['output_shape']['columns']} columns",
            "",
            "## Dropped Columns",
            "",
            "| Column | Reason |",
            "| --- | --- |",
            drop_rows,
            "",
            "## Numeric Transforms",
            "",
            "| Column | Fill Value | Scaler |",
            "| --- | ---: | --- |",
            numeric_rows,
            "",
            "## Categorical Transforms",
            "",
            "| Column | Fill Value | Encoder |",
            "| --- | --- | --- |",
            categorical_rows,
            "",
        ]
    )


class AgentOrchestrator:
    def __init__(self, *, session_id: str):
        self.session_id = session_id
        self.trace_id = uuid4().hex
        self.message_id = uuid4().hex
        self.session_service: SessionService | None = None

    async def run(self, *, content: str, context: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        intent = self._classify_intent(content)
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
        text = content.lower()
        abandon_terms = (
            "abandon last failure",
            "abandon failed",
            "abandon saved",
            "abandon retry",
            "clear last failure",
            "clear failed",
            "clear saved failure",
            "clear retry state",
            "drop last failure",
            "forget last failure",
            "\u653e\u5f03\u4e0a\u6b21\u5931\u8d25",
            "\u653e\u5f03\u5931\u8d25",
            "\u6e05\u9664\u4e0a\u6b21\u5931\u8d25",
            "\u6e05\u9664\u5931\u8d25\u72b6\u6001",
            "\u6e05\u9664\u91cd\u8bd5\u72b6\u6001",
        )
        if any(term in text for term in abandon_terms):
            return "abandon_last_failure"

        continue_terms = (
            "continue from last failure",
            "continue the failed",
            "continue failed",
            "resume last",
            "resume failed",
            "retry last",
            "retry failed",
            "recover last",
            "last failure",
            "last failed",
            "\u7ee7\u7eed\u4e0a\u6b21",
            "\u7ee7\u7eed\u5931\u8d25",
            "\u6062\u590d\u4e0a\u6b21",
            "\u6062\u590d\u5931\u8d25",
            "\u91cd\u8bd5\u4e0a\u6b21",
            "\u91cd\u8bd5\u5931\u8d25",
            "\u4e0a\u6b21\u5931\u8d25",
            "\u4e0a\u4e00\u6b65\u5931\u8d25",
        )
        if any(term in text for term in continue_terms):
            return "continue_from_failure"

        ingest_terms = (
            "ingest",
            "register dataset",
            "register this dataset",
            "register data",
            "load dataset",
            "load this dataset",
            "import dataset",
            "import this dataset",
            "source summary",
            "dataset summary",
            "\u63a5\u5165\u6570\u636e",
            "\u5bfc\u5165\u6570\u636e",
            "\u767b\u8bb0\u6570\u636e\u96c6",
            "\u6ce8\u518c\u6570\u636e\u96c6",
            "\u6570\u636e\u96c6\u6458\u8981",
        )
        if any(term in text for term in ingest_terms):
            return "configure_ingest"

        iteration_terms = (
            "iterate",
            "iteration",
            "follow-up experiment",
            "follow up experiment",
            "next experiment",
            "improve recall",
            "improve precision",
            "retrain plan",
            "rerun with changes",
            "\u8fed\u4ee3",
            "\u4e0b\u4e00\u8f6e\u5b9e\u9a8c",
            "\u6539\u8fdb\u6a21\u578b",
            "\u91cd\u8bad\u8ba1\u5212",
        )
        if any(term in text for term in iteration_terms):
            return "configure_iteration"

        diagnosis_terms = (
            "diagnose",
            "diagnosis",
            "diagnostic",
            "error slice",
            "error analysis",
            "prediction sample",
            "prediction samples",
            "misclassified",
            "misclassification",
            "confusion matrix",
            "poor recall",
            "low recall",
            "why recall",
            "poor precision",
            "low precision",
            "bad f1",
            "\u8bca\u65ad",
            "\u9519\u8bef\u5207\u7247",
            "\u9519\u8bef\u6837\u672c",
            "\u9884\u6d4b\u6837\u672c",
            "\u8bef\u5206\u7c7b",
            "\u6df7\u6dc6\u77e9\u9635",
            "\u53ec\u56de\u7387",
            "\u7cbe\u786e\u7387",
        )
        if any(term in text for term in diagnosis_terms):
            return "configure_diagnosis"

        export_terms = (
            "export experiment",
            "export bundle",
            "export report",
            "export handoff",
            "handoff bundle",
            "handoff package",
            "download bundle",
            "package report",
            "package this model",
            "package the model",
            "final report",
            "deliverable",
            "reproducible bundle",
            "\u5bfc\u51fa",
            "\u5bfc\u51fa\u62a5\u544a",
            "\u5bfc\u51fa\u6a21\u578b",
            "\u4ea4\u4ed8\u5305",
            "\u4ea4\u4ed8\u7269",
            "\u6253\u5305",
            "\u53ef\u590d\u73b0\u5305",
        )
        if any(term in text for term in export_terms):
            return "configure_export"

        learning_terms = (
            "learn from this",
            "extract lesson",
            "extract lessons",
            "extract learned",
            "learned rule",
            "learned rules",
            "propose rule",
            "propose learned",
            "save lesson",
            "remember this workflow",
            "project memory",
            "knowledge rule",
            "\u63d0\u53d6\u7ecf\u9a8c",
            "\u63d0\u53d6\u89c4\u5219",
            "\u6c89\u6dc0\u7ecf\u9a8c",
            "\u5b66\u4e60\u7ecf\u9a8c",
            "\u7ecf\u9a8c\u89c4\u5219",
            "\u8bb0\u4f4f\u8fd9\u6b21",
            "\u9879\u76ee\u8bb0\u5fc6",
            "\u77e5\u8bc6\u89c4\u5219",
        )
        if any(term in text for term in learning_terms):
            return "configure_learning"

        clean_terms = (
            "clean",
            "cleaning",
            "quality issue",
            "quality issues",
            "safe fixes",
            "fix missing",
            "dedupe",
            "deduplicate",
            "\u6e05\u6d17",
            "\u8d28\u91cf\u95ee\u9898",
            "\u5b89\u5168\u4fee\u590d",
            "\u53bb\u91cd",
        )
        if any(term in text for term in clean_terms):
            return "configure_cleaning"

        transform_terms = (
            "transform",
            "transformation",
            "preprocessing plan",
            "preprocess plan",
            "feature transform",
            "feature engineering plan",
            "\u8f6c\u6362",
            "\u9884\u5904\u7406\u8ba1\u5212",
            "\u7279\u5f81\u8f6c\u6362",
        )
        if any(term in text for term in transform_terms):
            return "configure_transform"

        profile_terms = (
            "profile",
            "data profile",
            "quality profile",
            "profile this dataset",
            "show quality warnings",
            "\u753b\u50cf",
            "\u6570\u636e\u753b\u50cf",
            "\u8d28\u91cf\u753b\u50cf",
        )
        if any(term in text for term in profile_terms):
            return "configure_profile"

        prepare_terms = (
            "prepare",
            "preprocess",
            "preprocessing",
            "feature engineering",
            "prepare for modeling",
            "ready for modeling",
            "\u9884\u5904\u7406",
            "\u7279\u5f81\u5de5\u7a0b",
            "\u5efa\u6a21\u524d",
            "\u51c6\u5907\u5efa\u6a21",
        )
        if any(term in text for term in prepare_terms):
            return "prepare_for_modeling"

        evaluation_terms = (
            "evaluate",
            "evaluation",
            "model comparison",
            "compare models",
            "compare experiments",
            "regenerate report",
            "generate model report",
            "evaluation report",
            "metrics report",
            "model report",
            "report this model",
            "\u8bc4\u4f30",
            "\u6a21\u578b\u8bc4\u4f30",
            "\u5bf9\u6bd4\u6a21\u578b",
            "\u5bf9\u6bd4\u5b9e\u9a8c",
            "\u91cd\u65b0\u751f\u6210\u62a5\u544a",
            "\u751f\u6210\u8bc4\u4f30\u62a5\u544a",
            "\u751f\u6210\u6a21\u578b\u62a5\u544a",
            "\u8bc4\u4f30\u62a5\u544a",
        )
        if any(term in text for term in evaluation_terms):
            return "configure_evaluation"

        training_terms = (
            "train",
            "training",
            "fit model",
            "start sklearn",
            "run sklearn",
            "sklearn",
            "baseline",
            "classifier",
            "regressor",
            "\u8bad\u7ec3",
            "\u5f00\u59cb\u8bad\u7ec3",
            "\u5206\u7c7b\u5668",
            "\u56de\u5f52",
        )
        if any(term in text for term in training_terms):
            return "configure_training"

        modeling_terms = (
            "modeling",
            "model",
            "machine learning",
            "\u5efa\u6a21",
            "\u6a21\u578b",
            "\u673a\u5668\u5b66\u4e60",
            "\u7279\u5f81",
        )
        if any(term in text for term in modeling_terms):
            return "prepare_for_modeling"
        return "analysis_overview"

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
        normalized = content.lower()
        return any(token in normalized for token in ("latest", "most recent", "newest", "最近", "最新"))

    def _artifact_path_from_run(self, run: dict[str, Any], key: str) -> str | None:
        artifact = run.get(key) if isinstance(run.get(key), dict) else {}
        path = artifact.get("path") if isinstance(artifact.get("path"), str) else None
        return path

    def _match_run_by_active_file(self, runs: list[dict[str, Any]], active_file: str) -> dict[str, Any] | None:
        if not active_file:
            return None
        matches: list[dict[str, Any]] = []
        for run in runs:
            candidate_paths = [
                run.get("dataset_path") if isinstance(run.get("dataset_path"), str) else None,
                self._artifact_path_from_run(run, "metrics_artifact"),
                self._artifact_path_from_run(run, "model_artifact"),
                self._artifact_path_from_run(run, "evaluation_report_artifact"),
                self._artifact_path_from_run(run, "prediction_samples_artifact"),
                self._artifact_path_from_run(run, "preprocessing_plan_artifact"),
                self._artifact_path_from_run(run, "export_bundle_artifact"),
            ]
            if active_file in [path for path in candidate_paths if path]:
                matches.append(run)
        return matches[0] if len(matches) == 1 else None

    def _run_candidate_summary(self, run: dict[str, Any]) -> dict[str, str]:
        return {
            "experiment_id": str(run.get("experiment_id") or ""),
            "dataset_path": str(run.get("dataset_path") or ""),
            "target_column": str(run.get("target_column") or ""),
            "best_model_name": str(run.get("best_model_name") or run.get("engine") or ""),
        }

    def _target_candidates_for_columns(self, columns: list[str]) -> list[str]:
        normalized = {column.strip().lower(): column.strip() for column in columns if column.strip()}
        prioritized = [normalized[key] for key in TARGET_COLUMN_FALLBACKS if key in normalized]
        for column in columns:
            column = column.strip()
            if column and column not in prioritized:
                prioritized.append(column)
            if len(prioritized) >= 3:
                break
        return prioritized[:3]

    def _candidate_dataset_summaries(self, project_root: Path) -> list[dict[str, str]]:
        candidates: list[dict[str, str]] = []
        ignored_roots = {"sessions", "experiments", ".git", "__pycache__"}
        for dataset_file in sorted(
            (
                path
                for path in project_root.rglob("*")
                if path.is_file()
                and path.suffix.lower() in DATASET_CANDIDATE_SUFFIXES
                and not any(part in ignored_roots for part in path.relative_to(project_root).parts)
            ),
            key=lambda path: _relative_path(project_root, path).lower(),
        ):
            try:
                with dataset_file.open(newline="", encoding="utf-8") as handle:
                    reader = csv.reader(handle)
                    columns = [column.strip() for column in next(reader, []) if column.strip()]
                    row_count = sum(1 for _ in reader)
            except (OSError, UnicodeDecodeError, csv.Error):
                continue
            if not columns:
                continue
            candidates.append(
                {
                    "dataset_path": _relative_path(project_root, dataset_file),
                    "dataset_version_id": _dataset_version_id_from_path(_relative_path(project_root, dataset_file)),
                    "row_count": str(row_count),
                    "column_count": str(len(columns)),
                    "target_candidates": ", ".join(self._target_candidates_for_columns(columns)),
                }
            )
            if len(candidates) >= 5:
                break
        return candidates

    def _diagnosis_summary(self, run: dict[str, Any]) -> dict[str, Any]:
        metrics = run.get("metrics") if isinstance(run.get("metrics"), dict) else {}
        confusion = metrics.get("confusion_matrix") if isinstance(metrics.get("confusion_matrix"), dict) else {}
        error_slices: list[dict[str, Any]] = []
        for label, predictions in confusion.items():
            if not isinstance(predictions, dict):
                continue
            counts = {str(predicted): int(count) for predicted, count in predictions.items() if isinstance(count, int | float)}
            support = sum(counts.values())
            correct = counts.get(str(label), 0)
            errors = max(0, support - correct)
            primary_confusion = sorted(
                [
                    {
                        "label": predicted,
                        "count": count,
                        "rate": count / support if support else 0,
                    }
                    for predicted, count in counts.items()
                    if predicted != str(label) and count > 0
                ],
                key=lambda item: item["count"],
                reverse=True,
            )
            if support > 0:
                error_slices.append(
                    {
                        "label": str(label),
                        "support": support,
                        "correct": correct,
                        "errors": errors,
                        "error_rate": errors / support,
                        "primary_confusion": primary_confusion[0] if primary_confusion else None,
                    }
                )
        error_slices.sort(key=lambda item: (-item["error_rate"], -item["errors"], item["label"]))
        worst_slice = next((item for item in error_slices if item["errors"] > 0), None)
        main_confusion = (
            f"{worst_slice['label']} -> {worst_slice['primary_confusion']['label']}"
            if worst_slice and worst_slice.get("primary_confusion")
            else None
        )
        total_errors = sum(int(item["errors"]) for item in error_slices)
        return {
            "worst_class": worst_slice["label"] if worst_slice else None,
            "main_confusion": main_confusion,
            "error_count": total_errors,
            "error_slices": error_slices,
            "recommendation": (
                f"Inspect {worst_slice['label']} prediction samples, then review features or preprocessing for this class."
                if worst_slice
                else "No class-level errors were found in the recorded confusion matrix."
            ),
        }

    def _infer_target_column(self, csv_path: Path) -> str:
        with csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.reader(handle)
            columns = next(reader, [])
        normalized = {column.strip().lower(): column for column in columns if column.strip()}
        for candidate in TARGET_COLUMN_FALLBACKS:
            if candidate in normalized:
                return normalized[candidate]
        return columns[-1].strip() if columns else "target"

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
        artifacts = [
            ("dataframe", "profile.json", profile_dataset(agent_context.csv_path)),
            ("dataframe", "missing.json", detect_missing(agent_context.csv_path)),
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

        text = (
            "I inspected the dataset structure, missing values, column types, "
            "distributions, and correlations. The generated artifacts are ready "
            "in the inspector."
        )
        async for event in self._emit_assistant_message(text):
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
        metadata = profile_artifact.get("metadata") if isinstance(profile_artifact.get("metadata"), dict) else {}
        candidates = metadata.get("target_candidates") if isinstance(metadata.get("target_candidates"), list) else []
        target_columns = [
            str(candidate.get("column"))
            for candidate in candidates
            if isinstance(candidate, dict) and isinstance(candidate.get("column"), str)
        ]
        return {
            "dataset_path": context.active_file,
            "profile_path": profile_artifact.get("path"),
            "row_count": int(metadata.get("row_count") or 0),
            "column_count": int(metadata.get("column_count") or 0),
            "target_candidates": target_columns,
            "source": "intent_router",
        }

    def _training_command_event(self, context: TrainingConfigurationContext) -> dict[str, Any]:
        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "train",
                "dataset_path": context.dataset_path,
                "dataset_version_id": context.dataset_version_id,
                "target_column": context.target_column,
                "selected_run_id": None,
                "selected_artifacts": [context.preprocessing_plan_path] if context.preprocessing_plan_path else [],
                "missing_context": [],
                "risk_level": "medium",
                "planned_steps": ["train"],
                "proposed_tools": ["train_sklearn"],
                "approval_required": False,
                "component_requests": ["training_config"],
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "dataset_path": context.dataset_path,
                "dataset_version_id": context.dataset_version_id,
                "target_column": context.target_column,
                "preprocessing_plan_path": context.preprocessing_plan_path,
            },
        }

    def _missing_dataset_command_event(self, context: MissingDatasetContext) -> dict[str, Any]:
        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "train",
                "dataset_path": None,
                "dataset_version_id": None,
                "target_column": None,
                "selected_run_id": None,
                "selected_artifacts": [],
                "missing_context": ["dataset_path"],
                "risk_level": "medium",
                "planned_steps": ["train"],
                "proposed_tools": ["train_sklearn"],
                "approval_required": True,
                "component_requests": ["training_config"],
                "candidate_datasets": context.candidate_datasets,
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "active_file": context.active_file,
                "candidate_datasets": context.candidate_datasets,
            },
        }

    def _evaluation_command_event(self, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
        selected_artifacts: list[str] = []
        for key in (
            "metrics_path",
            "model_path",
            "evaluation_report_path",
            "prediction_samples_path",
            "preprocessing_plan_path",
        ):
            value = props.get(key)
            if isinstance(value, str) and value and value not in selected_artifacts:
                selected_artifacts.append(value)

        dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
        target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
        dataset_version_id = (
            context.run.get("dataset_version_id")
            if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
            else None
        )
        missing_context = [
            key
            for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
            if not value
        ]

        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "evaluate",
                "dataset_path": dataset_path,
                "dataset_version_id": dataset_version_id,
                "target_column": target_column or None,
                "selected_run_id": context.experiment_id,
                "selected_artifacts": selected_artifacts,
                "missing_context": missing_context,
                "risk_level": "low",
                "planned_steps": ["evaluate"],
                "proposed_tools": ["model_comparison", "evaluation_report"],
                "approval_required": False,
                "component_requests": ["model_comparison", "evaluation_report"],
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "experiment_id": context.experiment_id,
                "dataset_path": dataset_path,
                "target_column": target_column,
                "metrics_path": props.get("metrics_path"),
                "model_path": props.get("model_path"),
                "evaluation_report_path": props.get("evaluation_report_path"),
                "prediction_samples_path": props.get("prediction_samples_path"),
                "preprocessing_plan_path": props.get("preprocessing_plan_path"),
            },
        }

    def _diagnosis_command_event(
        self,
        context: EvaluationContext,
        props: dict[str, Any],
        diagnosis: dict[str, Any],
    ) -> dict[str, Any]:
        selected_artifacts: list[str] = []
        for key in (
            "metrics_path",
            "model_path",
            "evaluation_report_path",
            "prediction_samples_path",
            "preprocessing_plan_path",
        ):
            value = props.get(key)
            if isinstance(value, str) and value and value not in selected_artifacts:
                selected_artifacts.append(value)

        dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
        target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
        dataset_version_id = (
            context.run.get("dataset_version_id")
            if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
            else None
        )
        missing_context = [
            key
            for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
            if not value
        ]
        diagnosis_summary = {
            "worst_class": diagnosis.get("worst_class"),
            "main_confusion": diagnosis.get("main_confusion"),
            "error_count": diagnosis.get("error_count"),
            "recommendation": diagnosis.get("recommendation"),
        }

        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "diagnose",
                "dataset_path": dataset_path,
                "dataset_version_id": dataset_version_id,
                "target_column": target_column or None,
                "selected_run_id": context.experiment_id,
                "selected_artifacts": selected_artifacts,
                "missing_context": missing_context,
                "risk_level": "low",
                "planned_steps": ["diagnose"],
                "proposed_tools": ["error_analysis", "prediction_samples"],
                "approval_required": False,
                "component_requests": ["error_analysis", "prediction_samples"],
                "diagnosis_summary": diagnosis_summary,
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "experiment_id": context.experiment_id,
                "dataset_path": dataset_path,
                "target_column": target_column,
                "metrics_path": props.get("metrics_path"),
                "model_path": props.get("model_path"),
                "evaluation_report_path": props.get("evaluation_report_path"),
                "prediction_samples_path": props.get("prediction_samples_path"),
                "preprocessing_plan_path": props.get("preprocessing_plan_path"),
                "worst_class": diagnosis.get("worst_class"),
                "main_confusion": diagnosis.get("main_confusion"),
                "error_count": diagnosis.get("error_count"),
                "recommendation": diagnosis.get("recommendation"),
            },
        }

    def _export_command_event(self, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
        selected_artifacts: list[str] = []
        for key in (
            "metrics_path",
            "model_path",
            "evaluation_report_path",
            "prediction_samples_path",
            "preprocessing_plan_path",
            "export_bundle_path",
        ):
            value = props.get(key)
            if isinstance(value, str) and value and value not in selected_artifacts:
                selected_artifacts.append(value)

        dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
        target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
        dataset_version_id = (
            context.run.get("dataset_version_id")
            if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
            else None
        )
        missing_required = (
            props.get("missing_required_artifacts")
            if isinstance(props.get("missing_required_artifacts"), list)
            else []
        )
        missing_context = [
            key
            for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
            if not value
        ]
        missing_context.extend(
            f"artifact:{str(item)}"
            for item in missing_required
            if isinstance(item, str) and item
        )

        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "export",
                "dataset_path": dataset_path,
                "dataset_version_id": dataset_version_id,
                "target_column": target_column or None,
                "selected_run_id": context.experiment_id,
                "selected_artifacts": selected_artifacts,
                "missing_context": missing_context,
                "risk_level": "medium",
                "planned_steps": ["export"],
                "proposed_tools": ["evaluation_report", "export_bundle"],
                "approval_required": False,
                "component_requests": ["evaluation_report", "export_bundle"],
                "bundle_ready": props.get("bundle_ready") is True,
                "missing_required_artifacts": missing_required,
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "experiment_id": context.experiment_id,
                "dataset_path": dataset_path,
                "target_column": target_column,
                "metrics_path": props.get("metrics_path"),
                "model_path": props.get("model_path"),
                "evaluation_report_path": props.get("evaluation_report_path"),
                "prediction_samples_path": props.get("prediction_samples_path"),
                "preprocessing_plan_path": props.get("preprocessing_plan_path"),
                "export_bundle_path": props.get("export_bundle_path"),
                "bundle_ready": props.get("bundle_ready") is True,
                "missing_required_artifacts": missing_required,
            },
        }

    def _learning_command_event(self, context: ProjectSessionContext, props: dict[str, Any]) -> dict[str, Any]:
        source_artifact_items = (
            props.get("source_artifacts")
            if isinstance(props.get("source_artifacts"), list)
            else []
        )
        source_artifacts = [
            str(item)
            for item in source_artifact_items
            if isinstance(item, str) and item
        ]
        has_candidates = props.get("has_extractable_candidates") is True
        candidate_count = int(props.get("candidate_count") or 0)
        high_confidence_count = int(props.get("high_confidence_count") or 0)
        missing_context = [] if has_candidates else ["candidate_lessons"]

        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": "learn",
                "dataset_path": None,
                "dataset_version_id": None,
                "target_column": None,
                "selected_run_id": None,
                "selected_artifacts": source_artifacts,
                "missing_context": missing_context,
                "risk_level": "high",
                "planned_steps": ["learn"],
                "proposed_tools": ["lesson_review"],
                "approval_required": True,
                "component_requests": ["lesson_review"],
                "source_session_id": props.get("source_session_id"),
                "source_event_count": props.get("source_event_count"),
                "candidate_count": candidate_count,
                "high_confidence_count": high_confidence_count,
                "has_extractable_candidates": has_candidates,
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "source_session_id": props.get("source_session_id"),
                "source_event_count": props.get("source_event_count"),
                "candidate_count": candidate_count,
                "high_confidence_count": high_confidence_count,
                "latest_event_type": props.get("latest_event_type"),
                "source_artifacts": source_artifacts,
                "has_extractable_candidates": has_candidates,
            },
        }

    def _missing_run_command_event(self, *, intent: str, context: AmbiguousRunContext) -> dict[str, Any]:
        component_requests = {
            "evaluate": ["model_comparison", "evaluation_report"],
            "diagnose": ["error_analysis", "prediction_samples"],
            "export": ["evaluation_report", "export_bundle"],
            "iterate": ["iteration_proposal"],
        }.get(intent, [])
        return {
            "type": "agent_command",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "command": {
                "intent": intent,
                "dataset_path": None,
                "dataset_version_id": None,
                "target_column": None,
                "selected_run_id": None,
                "selected_artifacts": [],
                "missing_context": ["experiment_id"],
                "risk_level": "medium",
                "planned_steps": [intent],
                "proposed_tools": component_requests,
                "approval_required": True,
                "component_requests": component_requests,
                "candidate_runs": context.candidate_runs,
            },
            "resolved_context": {
                "project_id": context.project_id,
                "mode": context.mode,
                "active_file": context.active_file,
                "candidate_runs": context.candidate_runs,
            },
        }

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
        metadata = registry_artifact.get("metadata") if isinstance(registry_artifact.get("metadata"), dict) else {}
        columns = metadata.get("columns") if isinstance(metadata.get("columns"), list) else []
        return {
            "dataset_path": str(metadata.get("dataset_path") or ""),
            "registry_path": registry_artifact.get("path"),
            "dataset_version_id": str(metadata.get("dataset_version_id") or ""),
            "row_count": int(metadata.get("row_count") or 0),
            "column_count": int(metadata.get("column_count") or 0),
            "columns": [str(column) for column in columns],
            "sample_strategy": str(metadata.get("sample_strategy") or "unknown"),
            "source": "intent_router",
        }

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
