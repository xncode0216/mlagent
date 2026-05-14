import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.projects import get_registered_project
from app.services.artifact_service import ArtifactService
from app.tools.data_analysis import correlation_matrix, detect_missing, profile_dataset

router = APIRouter(tags=["websocket"])


@dataclass
class ActiveFileResolution:
    csv_path: Path | None
    code: str | None = None
    message: str | None = None


def _resolve_active_file(project_id: object, active_file: object) -> ActiveFileResolution:
    if not isinstance(project_id, str) or not isinstance(active_file, str):
        return ActiveFileResolution(csv_path=None)

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


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") != "user_message":
                await websocket.send_json(
                    {"type": "error", "code": "bad_event", "message": "Unsupported event"}
                )
                continue

            message_id = uuid4().hex
            call_id = uuid4().hex
            context = payload.get("context", {})
            project_id = context.get("project_id")
            active_file = context.get("active_file")

            await websocket.send_json(
                {
                    "type": "tool_call_started",
                    "call_id": call_id,
                    "tool": "profile_dataset",
                    "args": context,
                }
            )

            resolution = _resolve_active_file(project_id, active_file)
            if resolution.code is not None:
                await websocket.send_json(
                    {
                        "type": "tool_call_finished",
                        "call_id": call_id,
                        "status": "error",
                        "error": resolution.message,
                    }
                )
                await websocket.send_json(
                    {"type": "error", "code": resolution.code, "message": resolution.message}
                )
                continue

            if isinstance(project_id, str) and resolution.csv_path is not None:
                project = get_registered_project(project_id)
                if project is None:
                    continue
                project_root = Path(project.workspace_path).resolve()
                artifacts = [
                    ("dataframe", "profile.json", profile_dataset(resolution.csv_path)),
                    ("dataframe", "missing.json", detect_missing(resolution.csv_path)),
                    ("chart", "correlation.json", correlation_matrix(resolution.csv_path)),
                ]
                artifact_service = ArtifactService(project_root)
                for artifact_type, name, data in artifacts:
                    artifact = artifact_service.write_json(
                        project_id=project_id,
                        session_id=session_id,
                        artifact_type=artifact_type,
                        name=name,
                        payload=data,
                    )
                    await websocket.send_json(
                        {
                            "type": "artifact_created",
                            "artifact": {
                                "id": artifact.id,
                                "project_id": project_id,
                                "session_id": session_id,
                                "type": artifact_type,
                                "name": name,
                                "path": str(artifact.path.relative_to(project_root)).replace("\\", "/"),
                                "metadata": artifact.metadata,
                                "created_at": artifact.created_at,
                            },
                        }
                    )

            await asyncio.sleep(0.2)
            await websocket.send_json(
                {"type": "tool_call_finished", "call_id": call_id, "status": "success"}
            )

            text = "我会先读取数据集结构，然后分析缺失值、字段类型和相关性，并把结果放到右侧面板。"
            for chunk in text:
                await websocket.send_json(
                    {"type": "message_delta", "message_id": message_id, "delta": chunk}
                )
                await asyncio.sleep(0.01)

            await websocket.send_json(
                {
                    "type": "task_progress",
                    "task_id": session_id,
                    "progress": 1,
                    "label": "完成",
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            )
    except WebSocketDisconnect:
        return
