from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas.project import ProjectCreate, ProjectOpenLocal, ProjectRead
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


@router.post("/open-local")
def open_local_project(payload: ProjectOpenLocal) -> ProjectRead:
    settings = get_settings()
    root = Path(payload.path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=400, detail="Local project path must be an existing directory")

    registry = ProjectRegistryService(settings.workspace_root, settings.dev_user_id)
    projects = registry.load_projects()
    workspace_path = str(root)
    existing = next(
        (project for project in projects.values() if Path(project.workspace_path).resolve() == root),
        None,
    )
    if existing is not None:
        PROJECTS[existing.id] = existing
        return existing

    WorkspaceService(settings.workspace_root).ensure_project_structure(root)
    now = datetime.now(UTC).isoformat()
    project = ProjectRead(
        id=uuid4().hex,
        owner_id=settings.dev_user_id,
        name=payload.name or root.name,
        workspace_path=workspace_path,
        created_at=now,
        updated_at=now,
    )
    PROJECTS[project.id] = project
    registry.save_project(project)
    return project


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectRead:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
