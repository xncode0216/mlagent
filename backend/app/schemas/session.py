from typing import Any

from pydantic import BaseModel, Field


class AgentSessionCreate(BaseModel):
    mode: str = Field(default="analysis", min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=255)


class AgentSessionRead(BaseModel):
    id: str
    project_id: str
    mode: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0


class MessageRead(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str
