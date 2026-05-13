import asyncio
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
