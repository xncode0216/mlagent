import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.core.config import get_settings
from app.services.artifact_service import ArtifactService
from app.services.experiment_service import ExperimentService
from app.services.gpu_scheduler_service import (
    GPUAcquireCancelled,
    GPUAcquireTimeout,
    gpu_scheduler,
)
from app.services.kernel_service import create_kernel_service
from app.services.task_state_service import delete_task_state, load_task_state, recovery_policy, write_task_state
from app.tools.machine_learning import train_baseline_classifier, train_sklearn_classifier

router = APIRouter(prefix="/api/projects/{project_id}/ml", tags=["machine-learning"])


class TrainBaselineRequest(BaseModel):
    dataset_path: str = Field(min_length=1)
    target_column: str = Field(min_length=1)
    session_id: str = "manual-training"


class TrainSklearnRequest(TrainBaselineRequest):
    use_gpu: bool = False
    preprocessing_plan_path: str | None = None


class ResumeSklearnTrainingRequest(BaseModel):
    session_id: str = "manual-training"


class EvaluationReportRequest(BaseModel):
    session_id: str = "manual-training"


class ResumeEvaluationReportRequest(BaseModel):
    session_id: str = "manual-training"


class ExportBundleRequest(BaseModel):
    session_id: str = "manual-training"


class ResumeExportBundleRequest(BaseModel):
    session_id: str = "manual-training"


def _project_root(project_id: str) -> Path:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


def _resolve_project_file(root: Path, path: str, *, missing_detail: str = "Dataset not found") -> Path:
    resolved = (root / path).resolve()
    if root != resolved and root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail=missing_detail)
    return resolved


def _safe_name(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in value)
    return safe or "target"


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        return value.item()
    return value


def _relative_project_path(root: Path, target: Path) -> str:
    return str(target.relative_to(root)).replace("\\", "/")


def _existing_file_artifact(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    artifact_type: str,
    target: Path,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid4().hex,
        "type": artifact_type,
        "name": target.name,
        "path": _relative_project_path(root, target),
        "created_at": datetime.now(UTC).isoformat(),
        "metadata": {
            "project_id": project_id,
            "session_id": session_id,
            **(metadata or {}),
        },
    }


def _write_training_failure_state(
    *,
    root: Path,
    project_id: str,
    payload: TrainSklearnRequest,
    error: str,
    retry_count: int = 0,
) -> None:
    write_task_state(
        project_root=root,
        session_id=payload.session_id,
        stage="train",
        payload={
            "status": "failed",
            "project_id": project_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "sklearn",
            "use_gpu": payload.use_gpu,
            "preprocessing_plan_path": payload.preprocessing_plan_path,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint=(
                    "Check that the dataset, target column, preprocessing plan, kernel backend, "
                    "and GPU settings are still valid before retrying sklearn training."
                ),
                stale_check="Confirm the saved dataset and preprocessing plan still exist and include the target column.",
                resume_action="Retry the saved sklearn training request from durable task state.",
                regenerate_action="Regenerate the preprocessing plan or choose a different target before retraining.",
                abandon_action="Clear the saved training retry state and keep existing artifacts unchanged.",
                stale_artifact_paths=[payload.dataset_path, payload.preprocessing_plan_path],
            ),
        },
    )


def _write_evaluation_failure_state(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    run: dict[str, Any] | None,
    error: str,
    retry_count: int = 0,
) -> None:
    metrics_artifact = run.get("metrics_artifact") if isinstance(run, dict) else None
    model_artifact = run.get("model_artifact") if isinstance(run, dict) else None
    write_task_state(
        project_root=root,
        session_id=session_id,
        stage="evaluate",
        payload={
            "status": "failed",
            "project_id": project_id,
            "experiment_id": experiment_id,
            "dataset_path": run.get("dataset_path") if isinstance(run, dict) else None,
            "target_column": run.get("target_column") if isinstance(run, dict) else None,
            "engine": run.get("engine") if isinstance(run, dict) else None,
            "metrics_path": metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
            "model_path": model_artifact.get("path") if isinstance(model_artifact, dict) else None,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint="Restore the training metrics/model artifacts or rerun training before regenerating the report.",
                stale_check="Confirm the metrics and model artifacts still exist and belong to the saved experiment.",
                resume_action="Retry evaluation report generation from the saved experiment run.",
                regenerate_action="Regenerate or rerun the upstream training artifacts before evaluation.",
                abandon_action="Clear the saved evaluation retry state and keep the current run detail unchanged.",
                stale_artifact_paths=[
                    metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
                    model_artifact.get("path") if isinstance(model_artifact, dict) else None,
                ],
            ),
        },
    )


def _write_export_failure_state(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    run: dict[str, Any] | None,
    error: str,
    retry_count: int = 0,
) -> None:
    report_artifact = run.get("evaluation_report_artifact") if isinstance(run, dict) else None
    metrics_artifact = run.get("metrics_artifact") if isinstance(run, dict) else None
    model_artifact = run.get("model_artifact") if isinstance(run, dict) else None
    write_task_state(
        project_root=root,
        session_id=session_id,
        stage="export",
        payload={
            "status": "failed",
            "project_id": project_id,
            "experiment_id": experiment_id,
            "dataset_path": run.get("dataset_path") if isinstance(run, dict) else None,
            "target_column": run.get("target_column") if isinstance(run, dict) else None,
            "engine": run.get("engine") if isinstance(run, dict) else None,
            "metrics_path": metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
            "model_path": model_artifact.get("path") if isinstance(model_artifact, dict) else None,
            "report_path": report_artifact.get("path") if isinstance(report_artifact, dict) else None,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint="Restore model, metrics, and report artifacts or regenerate evaluation before exporting.",
                stale_check="Confirm the model, metrics, and report files still exist before creating the handoff bundle.",
                resume_action="Retry the saved model handoff bundle export.",
                regenerate_action="Regenerate the evaluation report or rerun training before exporting.",
                abandon_action="Clear the saved export retry state and keep existing run artifacts unchanged.",
                stale_artifact_paths=[
                    metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
                    model_artifact.get("path") if isinstance(model_artifact, dict) else None,
                    report_artifact.get("path") if isinstance(report_artifact, dict) else None,
                ],
            ),
        },
    )


def _state_to_sklearn_request(state: dict[str, Any], *, session_id: str) -> TrainSklearnRequest:
    dataset_path = state.get("dataset_path")
    target_column = state.get("target_column")
    if not isinstance(dataset_path, str) or not isinstance(target_column, str):
        raise HTTPException(status_code=409, detail="Saved training retry state is incomplete")
    preprocessing_plan_path = state.get("preprocessing_plan_path")
    return TrainSklearnRequest(
        dataset_path=dataset_path,
        target_column=target_column,
        session_id=session_id,
        use_gpu=state.get("use_gpu") is True,
        preprocessing_plan_path=preprocessing_plan_path if isinstance(preprocessing_plan_path, str) else None,
    )


def _markdown_cell(value: Any) -> str:
    if value is None:
        return "-"
    return str(value).replace("\n", " ").replace("|", "\\|")


def _markdown_table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    if not rows:
        return []
    return [
        "| " + " | ".join(_markdown_cell(header) for header in headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(_markdown_cell(value) for value in row) + " |" for row in rows],
    ]


def _format_percent(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "-"
    return f"{value * 100:.2f}%"


def _format_count(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "-"
    return str(int(value))


def _render_metric_summary(metrics: dict[str, Any]) -> list[list[str]]:
    return [
        ["Accuracy", _format_percent(metrics.get("accuracy"))],
        ["F1 weighted", _format_percent(metrics.get("f1_weighted"))],
        ["Rows", _format_count(metrics.get("row_count"))],
        ["Train rows", _format_count(metrics.get("train_row_count"))],
        ["Eval rows", _format_count(metrics.get("eval_row_count", metrics.get("row_count")))],
        ["Class count", _format_count(metrics.get("class_count"))],
        ["Holdout strategy", str(metrics.get("holdout_strategy") or "not recorded")],
    ]


def _render_confusion_rows(metrics: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    confusion = metrics.get("confusion_matrix")
    if not isinstance(confusion, dict) or not confusion:
        return [], []
    labels = sorted(
        {
            str(label)
            for expected, predictions in confusion.items()
            for label in ([expected] + list(predictions.keys() if isinstance(predictions, dict) else []))
        }
    )
    return ["True \\ Pred", *labels], [
        [expected, *[confusion.get(expected, {}).get(predicted, 0) for predicted in labels]]
        for expected in labels
    ]


def _render_evaluation_report(
    *,
    experiment_id: str,
    engine: str,
    dataset_path: str,
    target_column: str,
    use_gpu: bool,
    metrics: dict[str, Any],
    model: dict[str, Any],
    candidate_runs: list[dict[str, Any]],
    model_artifact: dict[str, Any],
    metrics_artifact: dict[str, Any],
    prediction_samples_artifact: dict[str, Any] | None,
    preprocessing_plan_artifact: dict[str, Any] | None,
    report_path: str,
) -> str:
    lines = [
        "# Model Evaluation Report",
        "",
        "## Experiment",
        "",
        *_markdown_table(
            ["Field", "Value"],
            [
                ["Experiment ID", experiment_id],
                ["Engine", engine],
                ["Dataset", dataset_path],
                ["Target column", target_column],
                ["GPU requested", "yes" if use_gpu else "no"],
                ["Best model", model.get("strategy") or model.get("algorithm") or "not recorded"],
            ],
        ),
        "",
        "## Metric Summary",
        "",
        *_markdown_table(["Metric", "Value"], _render_metric_summary(metrics)),
        "",
    ]

    if candidate_runs:
        lines.extend(
            [
                "## Candidate Model Comparison",
                "",
                *_markdown_table(
                    ["Model", "Accuracy", "F1 weighted", "Eval rows", "Strategy"],
                    [
                        [
                            run.get("model_name"),
                            _format_percent(run.get("metrics", {}).get("accuracy")),
                            _format_percent(run.get("metrics", {}).get("f1_weighted")),
                            _format_count(
                                run.get("metrics", {}).get("eval_row_count", run.get("metrics", {}).get("row_count"))
                            ),
                            run.get("metrics", {}).get("holdout_strategy") or "-",
                        ]
                        for run in candidate_runs
                    ],
                ),
                "",
            ]
        )

    per_class = metrics.get("per_class")
    if isinstance(per_class, dict) and per_class:
        lines.extend(
            [
                "## Per-Class Quality",
                "",
                *_markdown_table(
                    ["Class", "Precision", "Recall", "F1", "Support"],
                    [
                        [
                            label,
                            _format_percent(class_metrics.get("precision")),
                            _format_percent(class_metrics.get("recall")),
                            _format_percent(class_metrics.get("f1")),
                            _format_count(class_metrics.get("support")),
                        ]
                        for label, class_metrics in sorted(per_class.items())
                        if isinstance(class_metrics, dict)
                    ],
                ),
                "",
            ]
        )

    confusion_headers, confusion_rows = _render_confusion_rows(metrics)
    if confusion_rows:
        lines.extend(
            [
                "## Confusion Matrix",
                "",
                *_markdown_table(confusion_headers, confusion_rows),
                "",
            ]
        )

    feature_importance = model.get("feature_importance")
    if isinstance(feature_importance, list) and feature_importance:
        lines.extend(
            [
                "## Feature Importance",
                "",
                *_markdown_table(
                    ["Feature", "Importance"],
                    [
                        [item.get("feature"), item.get("importance")]
                        for item in feature_importance
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    permutation_importance = model.get("permutation_importance")
    if isinstance(permutation_importance, list) and permutation_importance:
        lines.extend(
            [
                "## Permutation Importance",
                "",
                *_markdown_table(
                    ["Feature", "Mean", "Std"],
                    [
                        [item.get("feature"), item.get("mean_importance"), item.get("std_importance")]
                        for item in permutation_importance
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    linear_coefficients = model.get("linear_coefficients")
    if isinstance(linear_coefficients, list) and linear_coefficients:
        lines.extend(
            [
                "## Linear Coefficients",
                "",
                *_markdown_table(
                    ["Feature", "Coefficient", "Abs"],
                    [
                        [item.get("feature"), item.get("coefficient"), item.get("abs_coefficient")]
                        for item in linear_coefficients
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    if model.get("explanation_warning"):
        lines.extend(["## Explanation Warning", "", str(model["explanation_warning"]), ""])

    artifact_rows = [
        ["Model file", model_artifact.get("path")],
        ["Metrics JSON", metrics_artifact.get("path")],
    ]
    if prediction_samples_artifact is not None:
        artifact_rows.append(["Prediction samples", prediction_samples_artifact.get("path")])
    if preprocessing_plan_artifact is not None:
        artifact_rows.append(["Preprocessing plan", preprocessing_plan_artifact.get("path")])
    artifact_rows.append(["Evaluation report", report_path])

    lines.extend(
        [
            "## Artifacts",
            "",
            *_markdown_table(
                ["Artifact", "Path"],
                artifact_rows,
            ),
            "",
        ]
    )
    return "\n".join(lines)


def _write_evaluation_report_artifact(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    engine: str,
    dataset_path: str,
    target_column: str,
    use_gpu: bool,
    metrics: dict[str, Any],
    model: dict[str, Any],
    candidate_runs: list[dict[str, Any]],
    model_artifact: dict[str, Any],
    metrics_artifact: dict[str, Any],
    prediction_samples_artifact: dict[str, Any] | None = None,
    preprocessing_plan_artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    artifact_id = uuid4().hex
    created_at = datetime.now(UTC).isoformat()
    report_name = "model_evaluation_report.md"
    report_file = root / "results" / session_id / report_name
    report_file.parent.mkdir(parents=True, exist_ok=True)
    report_project_path = _relative_project_path(root, report_file)
    report_file.write_text(
        _render_evaluation_report(
            experiment_id=experiment_id,
            engine=engine,
            dataset_path=dataset_path,
            target_column=target_column,
            use_gpu=use_gpu,
            metrics=metrics,
            model=model,
            candidate_runs=candidate_runs,
            model_artifact=model_artifact,
            metrics_artifact=metrics_artifact,
            prediction_samples_artifact=prediction_samples_artifact,
            preprocessing_plan_artifact=preprocessing_plan_artifact,
            report_path=report_project_path,
        ),
        encoding="utf-8",
    )
    return {
        "id": artifact_id,
        "type": "report",
        "name": report_name,
        "path": report_project_path,
        "created_at": created_at,
        "metadata": {
            "project_id": project_id,
            "session_id": session_id,
            "experiment_id": experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": metrics_artifact.get("path"),
            "prediction_samples_path": (
                prediction_samples_artifact.get("path") if prediction_samples_artifact is not None else None
            ),
            "model_path": model_artifact.get("path"),
            "preprocessing_plan_path": (
                preprocessing_plan_artifact.get("path") if preprocessing_plan_artifact is not None else None
            ),
        },
    }


def _bundle_manifest(run: dict[str, Any], *, experiment_id: str, bundle_path: str) -> dict[str, Any]:
    artifact_keys = [
        "model_artifact",
        "metrics_artifact",
        "evaluation_report_artifact",
        "prediction_samples_artifact",
        "preprocessing_plan_artifact",
    ]
    artifacts = [
        {
            "role": key.removesuffix("_artifact"),
            "name": artifact.get("name"),
            "path": artifact.get("path"),
            "type": artifact.get("type"),
        }
        for key in artifact_keys
        if isinstance(run.get(key), dict)
        for artifact in [run[key]]
    ]
    return {
        "experiment_id": experiment_id,
        "engine": run.get("engine"),
        "dataset_path": run.get("dataset_path"),
        "target_column": run.get("target_column"),
        "best_model_name": run.get("best_model_name"),
        "metrics": run.get("metrics") if isinstance(run.get("metrics"), dict) else {},
        "artifacts": artifacts,
        "bundle_path": bundle_path,
        "created_at": datetime.now(UTC).isoformat(),
    }


def _write_export_bundle_artifact(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    run: dict[str, Any],
) -> dict[str, Any]:
    required_artifact_keys = ["model_artifact", "metrics_artifact", "evaluation_report_artifact"]
    artifact_entries: list[tuple[str, dict[str, Any], Path]] = []
    for artifact_key in required_artifact_keys:
        artifact = run.get(artifact_key)
        if not isinstance(artifact, dict):
            raise RuntimeError(f"Missing {artifact_key.replace('_', ' ')}")
        artifact_path = artifact.get("path")
        if not isinstance(artifact_path, str) or not artifact_path:
            raise RuntimeError(f"Missing {artifact_key.replace('_', ' ')} path")
        artifact_file = _resolve_project_file(
            root,
            artifact_path,
            missing_detail=f"{artifact_key.replace('_', ' ').title()} not found",
        )
        artifact_entries.append((artifact_key, artifact, artifact_file))

    optional_artifact_keys = ["prediction_samples_artifact", "preprocessing_plan_artifact"]
    for artifact_key in optional_artifact_keys:
        artifact = run.get(artifact_key)
        if not isinstance(artifact, dict):
            continue
        artifact_path = artifact.get("path")
        if not isinstance(artifact_path, str) or not artifact_path:
            continue
        artifact_file = _resolve_project_file(
            root,
            artifact_path,
            missing_detail=f"{artifact_key.replace('_', ' ').title()} not found",
        )
        artifact_entries.append((artifact_key, artifact, artifact_file))

    bundle_name = f"{experiment_id}_handoff_bundle.zip"
    bundle_file = root / "exports" / session_id / bundle_name
    bundle_file.parent.mkdir(parents=True, exist_ok=True)
    bundle_path = _relative_project_path(root, bundle_file)
    manifest = _bundle_manifest(run, experiment_id=experiment_id, bundle_path=bundle_path)
    with zipfile.ZipFile(bundle_file, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for artifact_key, artifact, artifact_file in artifact_entries:
            artifact_name = str(artifact.get("name") or artifact_file.name)
            archive.write(artifact_file, f"artifacts/{artifact_key.removesuffix('_artifact')}/{artifact_name}")

    return {
        "id": uuid4().hex,
        "type": "archive",
        "name": bundle_name,
        "path": bundle_path,
        "created_at": datetime.now(UTC).isoformat(),
        "metadata": {
            "project_id": project_id,
            "session_id": session_id,
            "experiment_id": experiment_id,
            "artifact_role": "export_bundle",
            "manifest": manifest,
        },
    }


@router.get("/runs")
def list_training_runs(project_id: str) -> dict[str, Any]:
    root = _project_root(project_id)
    return {"items": ExperimentService(root).list_runs()}


@router.get("/runs/{experiment_id}")
def get_training_run(project_id: str, experiment_id: str) -> dict[str, Any]:
    root = _project_root(project_id)
    run = ExperimentService(root).get_run(experiment_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Training run not found")
    return run


@router.post("/runs/{experiment_id}/evaluation-report")
def generate_evaluation_report(
    project_id: str,
    experiment_id: str,
    payload: EvaluationReportRequest,
) -> dict[str, Any]:
    return _run_evaluation_report(
        project_id=project_id,
        experiment_id=experiment_id,
        session_id=payload.session_id,
    )


@router.post("/runs/{experiment_id}/export-bundle")
def export_run_bundle(project_id: str, experiment_id: str, payload: ExportBundleRequest) -> dict[str, Any]:
    return _run_export_bundle(
        project_id=project_id,
        experiment_id=experiment_id,
        session_id=payload.session_id,
    )


@router.post("/resume-evaluation")
def resume_evaluation_report(project_id: str, payload: ResumeEvaluationReportRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    state = load_task_state(project_root=root, session_id=payload.session_id, stage="evaluate")
    if state is None:
        raise HTTPException(status_code=404, detail="Evaluation retry state not found")
    experiment_id = state.get("experiment_id")
    if not isinstance(experiment_id, str) or not experiment_id:
        delete_task_state(project_root=root, session_id=payload.session_id, stage="evaluate")
        raise HTTPException(status_code=409, detail="Saved evaluation retry state is incomplete")
    retry_count = int(state.get("retry_count") or 0) + 1
    return _run_evaluation_report(
        project_id=project_id,
        experiment_id=experiment_id,
        session_id=payload.session_id,
        retry_count=retry_count,
    )


@router.post("/resume-export")
def resume_export_bundle(project_id: str, payload: ResumeExportBundleRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    state = load_task_state(project_root=root, session_id=payload.session_id, stage="export")
    if state is None:
        raise HTTPException(status_code=404, detail="Export retry state not found")
    experiment_id = state.get("experiment_id")
    if not isinstance(experiment_id, str) or not experiment_id:
        delete_task_state(project_root=root, session_id=payload.session_id, stage="export")
        raise HTTPException(status_code=409, detail="Saved export retry state is incomplete")
    retry_count = int(state.get("retry_count") or 0) + 1
    return _run_export_bundle(
        project_id=project_id,
        experiment_id=experiment_id,
        session_id=payload.session_id,
        retry_count=retry_count,
    )


def _require_artifact_file(root: Path, artifact: Any, *, detail: str) -> None:
    if not isinstance(artifact, dict):
        raise RuntimeError(detail)
    path = artifact.get("path")
    if not isinstance(path, str) or not path:
        raise RuntimeError(detail)
    _resolve_project_file(root, path, missing_detail=detail)


def _run_evaluation_report(
    *,
    project_id: str,
    experiment_id: str,
    session_id: str,
    retry_count: int = 0,
) -> dict[str, Any]:
    root = _project_root(project_id)
    experiment_service = ExperimentService(root)
    run = experiment_service.get_run(experiment_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Training run not found")

    try:
        _require_artifact_file(root, run.get("metrics_artifact"), detail="Metrics artifact not found")
        report_artifact = _write_evaluation_report_artifact(
            root=root,
            project_id=project_id,
            session_id=session_id,
            experiment_id=experiment_id,
            engine=str(run.get("engine") or "unknown"),
            dataset_path=str(run.get("dataset_path") or ""),
            target_column=str(run.get("target_column") or ""),
            use_gpu=run.get("use_gpu") is True,
            metrics=run.get("metrics") if isinstance(run.get("metrics"), dict) else {},
            model=run.get("model") if isinstance(run.get("model"), dict) else {},
            candidate_runs=run.get("candidate_runs") if isinstance(run.get("candidate_runs"), list) else [],
            model_artifact=run.get("model_artifact") if isinstance(run.get("model_artifact"), dict) else {},
            metrics_artifact=run.get("metrics_artifact") if isinstance(run.get("metrics_artifact"), dict) else {},
            prediction_samples_artifact=(
                run.get("prediction_samples_artifact")
                if isinstance(run.get("prediction_samples_artifact"), dict)
                else None
            ),
            preprocessing_plan_artifact=(
                run.get("preprocessing_plan_artifact")
                if isinstance(run.get("preprocessing_plan_artifact"), dict)
                else None
            ),
        )
    except (RuntimeError, HTTPException) as exc:
        error = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        _write_evaluation_failure_state(
            root=root,
            project_id=project_id,
            session_id=session_id,
            experiment_id=experiment_id,
            run=run,
            error=error,
            retry_count=retry_count,
        )
        if isinstance(exc, HTTPException):
            raise HTTPException(status_code=500, detail=error) from exc
        raise HTTPException(status_code=500, detail=error) from exc

    updated = experiment_service.update_run(experiment_id, {"evaluation_report_artifact": report_artifact})
    delete_task_state(project_root=root, session_id=session_id, stage="evaluate")
    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "evaluation_report_artifact": report_artifact,
        "run": updated,
    }


def _run_export_bundle(
    *,
    project_id: str,
    experiment_id: str,
    session_id: str,
    retry_count: int = 0,
) -> dict[str, Any]:
    root = _project_root(project_id)
    experiment_service = ExperimentService(root)
    run = experiment_service.get_run(experiment_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Training run not found")

    try:
        export_bundle_artifact = _write_export_bundle_artifact(
            root=root,
            project_id=project_id,
            session_id=session_id,
            experiment_id=experiment_id,
            run=run,
        )
    except (RuntimeError, HTTPException) as exc:
        error = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        _write_export_failure_state(
            root=root,
            project_id=project_id,
            session_id=session_id,
            experiment_id=experiment_id,
            run=run,
            error=error,
            retry_count=retry_count,
        )
        if isinstance(exc, HTTPException):
            raise HTTPException(status_code=500, detail=error) from exc
        raise HTTPException(status_code=500, detail=error) from exc

    updated = experiment_service.update_run(experiment_id, {"export_bundle_artifact": export_bundle_artifact})
    delete_task_state(project_root=root, session_id=session_id, stage="export")
    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "export_bundle_artifact": export_bundle_artifact,
        "run": updated,
    }


@router.post("/train-baseline")
def train_baseline(project_id: str, payload: TrainBaselineRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    csv_path = _resolve_project_file(root, payload.dataset_path)
    try:
        result = _json_safe(train_baseline_classifier(csv_path, payload.target_column))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    experiment_id = uuid4().hex
    model_name = f"baseline_{payload.target_column}_model.json"
    model_path = root / "models" / model_name
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_payload = {
        "experiment_id": experiment_id,
        "dataset_path": payload.dataset_path,
        "target_column": payload.target_column,
        "model": result["model"],
        "feature_columns": result["feature_columns"],
    }
    model_path.write_text(json.dumps(model_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    artifact_service = ArtifactService(root)
    metrics_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="training",
        name="training_metrics.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            **result,
        },
    )
    prediction_samples_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="dataframe",
        name="prediction_samples.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "baseline",
            "sample_source": "training_dataset",
            "samples": result.get("prediction_samples", []),
        },
    )
    model_artifact = {
        "type": "model",
        "name": model_name,
        "path": str(model_path.relative_to(root)).replace("\\", "/"),
    }
    metrics_artifact_payload = {
        "id": metrics_artifact.id,
        "type": "training",
        "name": "training_metrics.json",
        "path": _relative_project_path(root, metrics_artifact.path),
        "created_at": metrics_artifact.created_at,
    }
    prediction_samples_artifact_payload = {
        "id": prediction_samples_artifact.id,
        "type": "dataframe",
        "name": "prediction_samples.json",
        "path": _relative_project_path(root, prediction_samples_artifact.path),
        "created_at": prediction_samples_artifact.created_at,
    }
    evaluation_report_artifact = _write_evaluation_report_artifact(
        root=root,
        project_id=project_id,
        session_id=payload.session_id,
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=False,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        prediction_samples_artifact=prediction_samples_artifact_payload,
    )
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=False,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        evaluation_report_artifact=evaluation_report_artifact,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        best_model_name=result.get("model_name", model_name),
    )

    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "engine": "baseline",
        "use_gpu": False,
        "metrics": result["metrics"],
        "runs": result["runs"],
        "model": result["model"],
        "model_artifact": model_artifact,
        "metrics_artifact": metrics_artifact_payload,
        "evaluation_report_artifact": evaluation_report_artifact,
        "prediction_samples_artifact": prediction_samples_artifact_payload,
    }


@router.post("/train-sklearn")
async def train_sklearn(project_id: str, payload: TrainSklearnRequest) -> dict[str, Any]:
    return await _run_train_sklearn(project_id=project_id, payload=payload)


@router.post("/resume-sklearn")
async def resume_sklearn(project_id: str, payload: ResumeSklearnTrainingRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    state = load_task_state(project_root=root, session_id=payload.session_id, stage="train")
    if state is None:
        raise HTTPException(status_code=404, detail="Training retry state not found")
    if state.get("engine") != "sklearn":
        raise HTTPException(status_code=409, detail="Saved training retry state is not a sklearn run")
    retry_count = int(state.get("retry_count") or 0) + 1
    training_request = _state_to_sklearn_request(state, session_id=payload.session_id)
    return await _run_train_sklearn(
        project_id=project_id,
        payload=training_request,
        retry_count=retry_count,
    )


async def _run_train_sklearn(
    *,
    project_id: str,
    payload: TrainSklearnRequest,
    retry_count: int = 0,
) -> dict[str, Any]:
    root = _project_root(project_id)
    _resolve_project_file(root, payload.dataset_path)
    preprocessing_plan_artifact = None
    if payload.preprocessing_plan_path:
        preprocessing_plan_file = _resolve_project_file(
            root,
            payload.preprocessing_plan_path,
            missing_detail="Preprocessing plan not found",
        )
        preprocessing_plan_artifact = _existing_file_artifact(
            root=root,
            project_id=project_id,
            session_id=payload.session_id,
            artifact_type="dataframe",
            target=preprocessing_plan_file,
            metadata={
                "dataset_path": payload.dataset_path,
                "target_column": payload.target_column,
                "role": "preprocessing_plan",
            },
        )
    settings = get_settings()
    experiment_id = uuid4().hex
    model_name = f"sklearn_{_safe_name(payload.target_column)}_model.pkl"
    model_path = f"models/{model_name}"
    gpu_acquired = False

    if payload.use_gpu:
        try:
            await gpu_scheduler.acquire_gpu(
                experiment_id,
                project_id,
                timeout_seconds=settings.gpu_acquire_timeout_seconds,
            )
            gpu_acquired = True
        except GPUAcquireTimeout as exc:
            _write_training_failure_state(
                root=root,
                project_id=project_id,
                payload=payload,
                error=str(exc),
                retry_count=retry_count,
            )
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except GPUAcquireCancelled as exc:
            _write_training_failure_state(
                root=root,
                project_id=project_id,
                payload=payload,
                error=str(exc),
                retry_count=retry_count,
            )
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        kernel_service = create_kernel_service(
            backend=settings.kernel_backend,
            image=settings.kernel_image,
            workspace_root=root,
            docker_executable=settings.docker_executable,
            use_gpu=payload.use_gpu,
            memory_limit=settings.kernel_memory_limit,
            cpu_limit=settings.kernel_cpu_limit,
            pids_limit=settings.kernel_pids_limit,
            workspace_mount_mode=settings.kernel_workspace_mount_mode,
        )

        result = _json_safe(train_sklearn_classifier(
            workspace_root=root,
            dataset_path=payload.dataset_path,
            target_column=payload.target_column,
            model_output_path=model_path,
            preprocessing_plan_path=(
                preprocessing_plan_artifact["path"] if preprocessing_plan_artifact is not None else None
            ),
            kernel_service=kernel_service,
        ))
    except ValueError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if gpu_acquired:
            await gpu_scheduler.release_gpu(experiment_id)

    artifact_service = ArtifactService(root)
    metrics_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="training",
        name="sklearn_training_metrics.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "use_gpu": payload.use_gpu,
            "preprocessing_plan_path": (
                preprocessing_plan_artifact["path"] if preprocessing_plan_artifact is not None else None
            ),
            **result,
        },
    )
    prediction_samples_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="dataframe",
        name="prediction_samples.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "sklearn",
            "sample_source": result["metrics"].get("holdout_strategy", "evaluation"),
            "samples": result.get("prediction_samples", []),
        },
    )
    model_artifact = {
        "type": "model",
        "name": model_name,
        "path": result.get("model_path", model_path),
    }
    metrics_artifact_payload = {
        "id": metrics_artifact.id,
        "type": "training",
        "name": "sklearn_training_metrics.json",
        "path": _relative_project_path(root, metrics_artifact.path),
        "created_at": metrics_artifact.created_at,
    }
    prediction_samples_artifact_payload = {
        "id": prediction_samples_artifact.id,
        "type": "dataframe",
        "name": "prediction_samples.json",
        "path": _relative_project_path(root, prediction_samples_artifact.path),
        "created_at": prediction_samples_artifact.created_at,
    }
    evaluation_report_artifact = _write_evaluation_report_artifact(
        root=root,
        project_id=project_id,
        session_id=payload.session_id,
        experiment_id=experiment_id,
        engine="sklearn",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=payload.use_gpu,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        preprocessing_plan_artifact=preprocessing_plan_artifact,
    )
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="sklearn",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=payload.use_gpu,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        evaluation_report_artifact=evaluation_report_artifact,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        preprocessing_plan_artifact=preprocessing_plan_artifact,
        preprocessing_plan=result.get("preprocessing_plan"),
        best_model_name=result.get("model_name", model_name),
    )

    response_payload = {
        "experiment_id": experiment_id,
        "status": "completed",
        "engine": "sklearn",
        "use_gpu": payload.use_gpu,
        "metrics": result["metrics"],
        "runs": result["runs"],
        "model": result["model"],
        "model_artifact": model_artifact,
        "metrics_artifact": metrics_artifact_payload,
        "evaluation_report_artifact": evaluation_report_artifact,
        "prediction_samples_artifact": prediction_samples_artifact_payload,
    }
    if preprocessing_plan_artifact is not None:
        response_payload["preprocessing_plan_artifact"] = preprocessing_plan_artifact
    if result.get("preprocessing_plan") is not None:
        response_payload["preprocessing_plan"] = result["preprocessing_plan"]
    delete_task_state(project_root=root, session_id=payload.session_id, stage="train")
    return response_payload
