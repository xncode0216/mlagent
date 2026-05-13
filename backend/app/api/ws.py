import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.projects import PROJECTS
from app.services.artifact_service import ArtifactService
from app.tools.data_analysis import correlation_matrix, detect_missing, profile_dataset

router = APIRouter(tags=["websocket"])


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
            await websocket.send_json(
                {
                    "type": "tool_call_started",
                    "call_id": call_id,
                    "tool": "profile_dataset",
                    "args": payload.get("context", {}),
                }
            )
            await asyncio.sleep(0.2)
            await websocket.send_json(
                {"type": "tool_call_finished", "call_id": call_id, "status": "success"}
            )

            context = payload.get("context", {})
            project_id = context.get("project_id")
            active_file = context.get("active_file")
            if isinstance(project_id, str) and isinstance(active_file, str):
                project = PROJECTS.get(project_id)
                if project is not None:
                    project_root = Path(project.workspace_path)
                    csv_path = (project_root / active_file).resolve()
                    if csv_path.exists() and project_root.resolve() in csv_path.parents:
                        artifacts = [
                            ("dataframe", "profile.json", profile_dataset(csv_path)),
                            ("dataframe", "missing.json", detect_missing(csv_path)),
                            ("chart", "correlation.json", correlation_matrix(csv_path)),
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
                                        "created_at": "",
                                    },
                                }
                            )

            text = "我会先读取数据集结构，然后分析缺失值、字段类型和相关性，并把结果放到右侧面板。"
            for chunk in text:
                await websocket.send_json(
                    {"type": "message_delta", "message_id": message_id, "delta": chunk}
                )
                await asyncio.sleep(0.01)

            await websocket.send_json(
                {"type": "task_progress", "task_id": session_id, "progress": 1, "label": "完成"}
            )
    except WebSocketDisconnect:
        return
