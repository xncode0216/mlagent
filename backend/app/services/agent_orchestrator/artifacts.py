"""Pending-approval persistence + artifact writers/renderers (P1-6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import _relative_path, _utc_now


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
