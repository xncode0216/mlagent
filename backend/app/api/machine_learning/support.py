"""项目路径解析与产物登记的共用辅助。本包的最底层，不依赖其他子模块。"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.api.projects import get_registered_project


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

