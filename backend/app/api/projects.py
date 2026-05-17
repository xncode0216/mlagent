from uuid import uuid4
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas.project import ProjectCreate, ProjectRead
from app.services.project_registry_service import ProjectRegistryService
from app.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS: dict[str, ProjectRead] = {}


def _sync_projects_from_registry() -> None:
    settings = get_settings()
    registry = ProjectRegistryService(settings.workspace_root, settings.dev_user_id)
    PROJECTS.clear()
    PROJECTS.update(registry.load_projects())


def get_registered_project(project_id: str) -> ProjectRead | None:
    project = PROJECTS.get(project_id)
    if project is not None:
        return project
    _sync_projects_from_registry()
    return PROJECTS.get(project_id)


def list_registered_projects() -> list[ProjectRead]:
    _sync_projects_from_registry()
    return list(PROJECTS.values())


@router.get("")
def list_projects() -> list[ProjectRead]:
    return list_registered_projects()


@router.post("")
def create_project(payload: ProjectCreate) -> ProjectRead:
    settings = get_settings()
    project_id = uuid4().hex
    service = WorkspaceService(settings.workspace_root)
    root = service.ensure_project_root(settings.dev_user_id, project_id)
    now = datetime.now(UTC).isoformat()
    project = ProjectRead(
        id=project_id,
        owner_id=settings.dev_user_id,
        name=payload.name,
        workspace_path=str(root),
        created_at=now,
        updated_at=now,
    )
    PROJECTS[project_id] = project
    ProjectRegistryService(settings.workspace_root, settings.dev_user_id).save_project(project)
    return project


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectRead:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
