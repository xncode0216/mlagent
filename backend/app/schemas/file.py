from pydantic import BaseModel


class FileItem(BaseModel):
    name: str
    path: str
    type: str
    size: int | None = None


class FileList(BaseModel):
    items: list[FileItem]
