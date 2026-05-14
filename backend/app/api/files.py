from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.api.projects import get_registered_project
from app.schemas.file import FileItem, FileList

router = APIRouter(prefix="/api/projects/{project_id}/files", tags=["files"])


def _get_project_root(project_id: str) -> Path:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


def _resolve_project_path(root: Path, path: str) -> Path:
    current = (root / path).resolve()
    if root != current and root not in current.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    return current


@router.get("")
def list_files(project_id: str, path: str = "") -> FileList:
    root = _get_project_root(project_id)
    current = _resolve_project_path(root, path)
    if not current.exists() or not current.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

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


@router.post("/upload")
async def upload_file(
    project_id: str,
    path: str = Form(...),
    file: UploadFile = File(...),
) -> FileItem:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, path)
    if target.exists() and target.is_dir():
        raise HTTPException(status_code=400, detail="Upload target is a directory")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(await file.read())
    return FileItem(
        name=target.name,
        path=str(target.relative_to(root)).replace("\\", "/"),
        type="file",
        size=target.stat().st_size,
    )


@router.get("/content")
def read_file_content(project_id: str, path: str) -> dict[str, str]:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return {
        "path": str(target.relative_to(root)).replace("\\", "/"),
        "content": target.read_text(encoding="utf-8"),
    }
