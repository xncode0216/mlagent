from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectRead(BaseModel):
    id: str
    owner_id: str
    name: str
    workspace_path: str
    created_at: str | None = None
    updated_at: str | None = None
