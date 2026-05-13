from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas.project import ProjectCreate, ProjectRead
from app.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS: dict[str, ProjectRead] = {}


@router.get("")
def list_projects() -> list[ProjectRead]:
    return list(PROJECTS.values())


@router.post("")
def create_project(payload: ProjectCreate) -> ProjectRead:
    settings = get_settings()
    project_id = uuid4().hex
    service = WorkspaceService(settings.workspace_root)
    root = service.ensure_project_root(settings.dev_user_id, project_id)
    project = ProjectRead(
        id=project_id,
        owner_id=settings.dev_user_id,
        name=payload.name,
        workspace_path=str(root),
    )
    PROJECTS[project_id] = project
    return project


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectRead:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
