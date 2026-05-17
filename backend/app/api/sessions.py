from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.api.projects import get_registered_project, list_registered_projects
from app.schemas.session import AgentSessionCreate, AgentSessionRead, MessageRead
from app.services.session_service import SessionService

router = APIRouter(tags=["sessions"])


def _session_service_for_project(project_id: str) -> SessionService:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return SessionService(Path(project.workspace_path).resolve())


def _find_session_service(session_id: str) -> SessionService:
    for project in list_registered_projects():
        service = SessionService(Path(project.workspace_path).resolve())
        if service.get_session(session_id) is not None:
            return service
    raise HTTPException(status_code=404, detail="Session not found")


@router.post("/api/projects/{project_id}/sessions")
def create_session(project_id: str, payload: AgentSessionCreate) -> AgentSessionRead:
    service = _session_service_for_project(project_id)
    return AgentSessionRead(**service.create_session(project_id=project_id, mode=payload.mode, title=payload.title))


@router.get("/api/projects/{project_id}/sessions")
def list_project_sessions(project_id: str) -> dict[str, list[AgentSessionRead]]:
    service = _session_service_for_project(project_id)
    return {"items": [AgentSessionRead(**session) for session in service.list_sessions()]}


@router.get("/api/sessions/{session_id}/messages")
def list_session_messages(session_id: str) -> dict[str, list[MessageRead]]:
    service = _find_session_service(session_id)
    return {"items": [MessageRead(**message) for message in service.list_messages(session_id)]}


@router.get("/api/sessions/{session_id}/events")
def list_session_events(session_id: str) -> dict[str, list[dict]]:
    service = _find_session_service(session_id)
    return {"items": service.list_events(session_id)}


@router.get("/api/sessions/{session_id}/log")
def download_session_log(session_id: str) -> FileResponse:
    service = _find_session_service(session_id)
    log_path = service.log_path(session_id)
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Session log not found")
    return FileResponse(
        log_path,
        media_type="application/x-ndjson",
        filename=f"{session_id}.jsonl",
    )
