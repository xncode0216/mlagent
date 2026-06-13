from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.agent_orchestrator_service import AgentOrchestrator

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict) or payload.get("type") not in {"user_message", "approval_response", "resume_step"}:
                await websocket.send_json(
                    {"type": "error", "code": "bad_event", "message": "Unsupported event"}
                )
                continue

            raw_context = payload.get("context")
            context = raw_context if isinstance(raw_context, dict) else {}
            raw_content = payload.get("content")
            content = raw_content if isinstance(raw_content, str) else ""

            orchestrator = AgentOrchestrator(session_id=session_id)
            if payload.get("type") == "approval_response":
                approval_id = payload.get("approval_id")
                decision = payload.get("decision")
                if not isinstance(approval_id, str) or not isinstance(decision, str):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "bad_approval_response",
                            "message": "approval_id and decision are required",
                        }
                    )
                    continue
                stream = orchestrator.respond_to_approval(
                    approval_id=approval_id,
                    decision=decision,
                    context=context,
                )
            elif payload.get("type") == "resume_step":
                stage = payload.get("stage")
                if not isinstance(stage, str):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "bad_resume_step",
                            "message": "stage is required",
                        }
                    )
                    continue
                stream = orchestrator.resume_step(stage=stage, context=context)
            else:
                stream = orchestrator.run(content=content, context=context)

            async for event in stream:
                await websocket.send_json(event)
    except WebSocketDisconnect:
        return
