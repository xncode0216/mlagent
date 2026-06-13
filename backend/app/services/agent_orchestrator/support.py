"""Small pure helpers + constants shared across orchestrator stages (P1-6)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.api.projects import get_registered_project
from app.services.agent_orchestrator.contexts import ActiveFileResolution


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
