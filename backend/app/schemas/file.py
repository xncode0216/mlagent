from pydantic import BaseModel


class FileItem(BaseModel):
    name: str
    path: str
    type: str
    size: int | None = None


class FileList(BaseModel):
    items: list[FileItem]


class FileContent(BaseModel):
    path: str
    content: str
    size: int
    mime_type: str


class FileDeleteResult(BaseModel):
    path: str
    deleted: bool
