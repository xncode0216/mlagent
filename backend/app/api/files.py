import mimetypes
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.schemas.file import FileContent, FileDeleteResult, FileItem, FileList

router = APIRouter(prefix="/api/projects/{project_id}/files", tags=["files"])


class FileCreateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    type: Literal["file", "directory"]
    content: str = ""


class FileRenameRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    new_path: str = Field(min_length=1, max_length=4096)


class FileUpdateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    content: str


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


def _to_file_item(root: Path, target: Path) -> FileItem:
    return FileItem(
        name=target.name,
        path=str(target.relative_to(root)).replace("\\", "/"),
        type="directory" if target.is_dir() else "file",
        size=target.stat().st_size if target.is_file() else None,
    )


@router.get("")
def list_files(project_id: str, path: str = "") -> FileList:
    root = _get_project_root(project_id)
    current = _resolve_project_path(root, path)
    if not current.exists() or not current.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items: list[FileItem] = []
    for child in sorted(current.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
        items.append(_to_file_item(root, child))
    return FileList(items=items)


@router.post("/create")
def create_file(project_id: str, payload: FileCreateRequest) -> FileItem:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, payload.path)
    if target.exists():
        raise HTTPException(status_code=409, detail="Target already exists")

    target.parent.mkdir(parents=True, exist_ok=True)
    if payload.type == "directory":
        target.mkdir()
    else:
        target.write_text(payload.content, encoding="utf-8", newline="")

    return _to_file_item(root, target)


@router.patch("/rename")
def rename_file(project_id: str, payload: FileRenameRequest) -> FileItem:
    root = _get_project_root(project_id)
    source = _resolve_project_path(root, payload.path)
    target = _resolve_project_path(root, payload.new_path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if target.exists():
        raise HTTPException(status_code=409, detail="Target already exists")

    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return _to_file_item(root, target)


@router.delete("")
def delete_file(project_id: str, path: str) -> FileDeleteResult:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, path)
    if target == root:
        raise HTTPException(status_code=400, detail="Cannot delete project root")
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    deleted_path = str(target.relative_to(root)).replace("\\", "/")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return FileDeleteResult(path=deleted_path, deleted=True)


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
    return _to_file_item(root, target)


@router.get("/content")
def read_file_content(project_id: str, path: str) -> FileContent:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    data = target.read_bytes()
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="Binary file preview is not supported") from exc

    mime_type = mimetypes.guess_type(target.name)[0] or "text/plain"
    return FileContent(
        path=str(target.relative_to(root)).replace("\\", "/"),
        content=content,
        size=len(data),
        mime_type=mime_type,
    )


@router.put("/content")
def update_file_content(project_id: str, payload: FileUpdateRequest) -> FileContent:
    root = _get_project_root(project_id)
    target = _resolve_project_path(root, payload.path)
    if target.exists() and target.is_dir():
        raise HTTPException(status_code=400, detail="Target is a directory")
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    target.write_text(payload.content, encoding="utf-8", newline="")
    data = payload.content.encode("utf-8")
    return FileContent(
        path=str(target.relative_to(root)).replace("\\", "/"),
        content=payload.content,
        size=len(data),
        mime_type=mimetypes.guess_type(target.name)[0] or "text/plain",
    )
