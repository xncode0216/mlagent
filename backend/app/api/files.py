from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.api.projects import PROJECTS
from app.schemas.file import FileItem, FileList

router = APIRouter(prefix="/api/projects/{project_id}/files", tags=["files"])


@router.get("")
def list_files(project_id: str, path: str = "") -> FileList:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    root = Path(project.workspace_path).resolve()
    current = (root / path).resolve()
    if root != current and root not in current.parents:
        raise HTTPException(status_code=400, detail="Invalid path")

    items: list[FileItem] = []
    for child in sorted(current.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
        item_type = "directory" if child.is_dir() else "file"
        items.append(
            FileItem(
                name=child.name,
                path=str(child.relative_to(root)).replace("\\", "/"),
                type=item_type,
                size=child.stat().st_size if child.is_file() else None,
            )
        )
    return FileList(items=items)
