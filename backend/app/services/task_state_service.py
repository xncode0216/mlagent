import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def safe_state_filename(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in value)
    return f"{safe or uuid4().hex}.json"


def recovery_policy(
    *,
    repair_hint: str,
    stale_check: str,
    resume_action: str,
    regenerate_action: str,
    abandon_action: str,
    stale_artifact_paths: Sequence[str | None] | None = None,
) -> dict[str, Any]:
    paths = [path for path in (stale_artifact_paths or []) if isinstance(path, str) and path]
    policy = {
        "repair_hint": repair_hint,
        "stale_check": stale_check,
        "resume_action": resume_action,
        "regenerate_action": regenerate_action,
        "abandon_action": abandon_action,
        "stale_artifact_paths": paths,
    }
    return {
        "recovery_policy": policy,
        **policy,
    }


def task_state_path(project_root: Path, session_id: str, stage: str) -> Path:
    return project_root / "sessions" / session_id / "task_state" / safe_state_filename(stage)


def write_task_state(
    *,
    project_root: Path,
    session_id: str,
    stage: str,
    payload: dict[str, Any],
) -> None:
    path = task_state_path(project_root, session_id, stage)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = load_task_state(project_root=project_root, session_id=session_id, stage=stage) or {}
    created_at = existing.get("created_at") if isinstance(existing.get("created_at"), str) else utc_now()
    path.write_text(
        json.dumps(
            {
                **payload,
                "stage": stage,
                "created_at": created_at,
                "updated_at": utc_now(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_task_state(
    *,
    project_root: Path,
    session_id: str,
    stage: str,
) -> dict[str, Any] | None:
    path = task_state_path(project_root, session_id, stage)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else None


def list_task_states(*, project_root: Path, session_id: str) -> list[dict[str, Any]]:
    task_state_dir = project_root / "sessions" / session_id / "task_state"
    if not task_state_dir.exists():
        return []

    states: list[dict[str, Any]] = []
    for path in sorted(task_state_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            states.append({"session_id": session_id, **payload})
    return sorted(
        states,
        key=lambda state: state.get("updated_at") if isinstance(state.get("updated_at"), str) else "",
        reverse=True,
    )


def delete_task_state(*, project_root: Path, session_id: str, stage: str) -> None:
    path = task_state_path(project_root, session_id, stage)
    if path.exists():
        path.unlink()
