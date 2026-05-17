from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.services.evolution_service import EvolutionProtocol, EvolutionService, LessonRecord

router = APIRouter(prefix="/api/projects/{project_id}/evolution", tags=["evolution"])


class LessonExtractRequest(BaseModel):
    source_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    domain: list[str] = Field(default_factory=list)
    observation: str = Field(min_length=1)
    recommendation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    evidence: dict[str, Any] = Field(default_factory=dict)


class LessonList(BaseModel):
    items: list[LessonRecord]


class ProtocolList(BaseModel):
    items: list[EvolutionProtocol]


def _project_root(project_id: str) -> Path:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


@router.get("/lessons")
def list_lessons(project_id: str) -> LessonList:
    service = EvolutionService(_project_root(project_id))
    return LessonList(items=service.list_lessons())


@router.get("/protocols")
def list_protocols(project_id: str) -> ProtocolList:
    service = EvolutionService(_project_root(project_id))
    return ProtocolList(items=service.list_protocols())


@router.post("/lessons/extract")
def extract_lesson(project_id: str, payload: LessonExtractRequest) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    return service.create_lesson(
        source_type=payload.source_type,
        source_id=payload.source_id,
        domain=payload.domain,
        observation=payload.observation,
        recommendation=payload.recommendation,
        confidence=payload.confidence,
        evidence=payload.evidence,
    )


@router.post("/lessons/{lesson_id}/adopt")
def adopt_lesson(project_id: str, lesson_id: str) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.adopt_lesson(lesson_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/reject")
def reject_lesson(project_id: str, lesson_id: str) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.reject_lesson(lesson_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc
