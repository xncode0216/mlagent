"""实验运行的只读查询，以及评估报告 / 导出包的生成与恢复路由。"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.machine_learning.bundle import _write_export_bundle_artifact
from app.api.machine_learning.failure_state import (
    _write_evaluation_failure_state,
    _write_export_failure_state,
)
from app.api.machine_learning.report import _write_evaluation_report_artifact
from app.api.machine_learning.schemas import (
    EvaluationReportRequest,
    ExportBundleRequest,
    ResumeEvaluationReportRequest,
    ResumeExportBundleRequest,
)
from app.api.machine_learning.support import _project_root, _resolve_project_file
from app.services.experiment_service import ExperimentService
from app.services.task_state_service import delete_task_state, load_task_state

router = APIRouter()


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
