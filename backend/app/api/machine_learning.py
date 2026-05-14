import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.services.artifact_service import ArtifactService
from app.services.experiment_service import ExperimentService
from app.services.kernel_service import create_kernel_service
from app.tools.machine_learning import train_baseline_classifier, train_sklearn_classifier

router = APIRouter(prefix="/api/projects/{project_id}/ml", tags=["machine-learning"])


class TrainBaselineRequest(BaseModel):
    dataset_path: str = Field(min_length=1)
    target_column: str = Field(min_length=1)
    session_id: str = "manual-training"


class TrainSklearnRequest(TrainBaselineRequest):
    use_gpu: bool = False


def _project_root(project_id: str) -> Path:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


def _resolve_project_file(root: Path, path: str) -> Path:
    resolved = (root / path).resolve()
    if root != resolved and root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")
    return resolved


def _safe_name(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in value)
    return safe or "target"


@router.get("/runs")
def list_training_runs(project_id: str) -> dict[str, Any]:
    root = _project_root(project_id)
    return {"items": ExperimentService(root).list_runs()}


@router.post("/train-baseline")
def train_baseline(project_id: str, payload: TrainBaselineRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    csv_path = _resolve_project_file(root, payload.dataset_path)
    try:
        result = train_baseline_classifier(csv_path, payload.target_column)
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
    model_artifact = {
        "type": "model",
        "name": model_name,
        "path": str(model_path.relative_to(root)).replace("\\", "/"),
    }
    metrics_artifact_payload = {
        "id": metrics_artifact.id,
        "type": "training",
        "name": "training_metrics.json",
        "path": str(metrics_artifact.path.relative_to(root)).replace("\\", "/"),
        "created_at": metrics_artifact.created_at,
    }
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=False,
        metrics=result["metrics"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
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
    }


@router.post("/train-sklearn")
def train_sklearn(project_id: str, payload: TrainSklearnRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    _resolve_project_file(root, payload.dataset_path)
    settings = get_settings()
    experiment_id = uuid4().hex
    model_name = f"sklearn_{_safe_name(payload.target_column)}_model.joblib"
    model_path = f"models/{model_name}"
    kernel_service = create_kernel_service(
        backend=settings.kernel_backend,
        image=settings.kernel_image,
        workspace_root=root,
        docker_executable=settings.docker_executable,
        use_gpu=payload.use_gpu,
    )

    try:
        result = train_sklearn_classifier(
            workspace_root=root,
            dataset_path=payload.dataset_path,
            target_column=payload.target_column,
            model_output_path=model_path,
            kernel_service=kernel_service,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

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
            **result,
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
        "path": str(metrics_artifact.path.relative_to(root)).replace("\\", "/"),
        "created_at": metrics_artifact.created_at,
    }
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="sklearn",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=payload.use_gpu,
        metrics=result["metrics"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        best_model_name=result.get("model_name", model_name),
    )

    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "engine": "sklearn",
        "use_gpu": payload.use_gpu,
        "metrics": result["metrics"],
        "runs": result["runs"],
        "model": result["model"],
        "model_artifact": model_artifact,
        "metrics_artifact": metrics_artifact_payload,
    }
