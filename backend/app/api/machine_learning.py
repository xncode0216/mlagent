import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import PROJECTS
from app.services.artifact_service import ArtifactService
from app.tools.machine_learning import train_baseline_classifier

router = APIRouter(prefix="/api/projects/{project_id}/ml", tags=["machine-learning"])


class TrainBaselineRequest(BaseModel):
    dataset_path: str = Field(min_length=1)
    target_column: str = Field(min_length=1)
    session_id: str = "manual-training"


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

    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "metrics": result["metrics"],
        "model": result["model"],
        "model_artifact": {
            "type": "model",
            "name": model_name,
            "path": str(model_path.relative_to(root)).replace("\\", "/"),
        },
        "metrics_artifact": {
            "id": metrics_artifact.id,
            "type": "training",
            "name": "training_metrics.json",
            "path": str(metrics_artifact.path.relative_to(root)).replace("\\", "/"),
            "created_at": metrics_artifact.created_at,
        },
    }
