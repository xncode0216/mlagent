"""交接导出包：清单构建与 zip 产物写入。"""

import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.api.machine_learning.support import _relative_project_path, _resolve_project_file


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
