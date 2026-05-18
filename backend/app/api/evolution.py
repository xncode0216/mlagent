from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.services.evolution_service import EvolutionProtocol, EvolutionService, LessonRecord
from app.services.lesson_extractor import LessonExtractor
from app.services.rule_injection_service import RuleInjectionService
from app.services.session_service import SessionService

router = APIRouter(prefix="/api/projects/{project_id}/evolution", tags=["evolution"])


class LessonExtractRequest(BaseModel):
    source_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    domain: list[str] = Field(default_factory=list)
    observation: str = Field(min_length=1)
    recommendation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    evidence: dict[str, Any] = Field(default_factory=dict)
    title: str = ""
    conditions: dict[str, Any] = Field(default_factory=dict)
    expected_benefit: dict[str, Any] = Field(default_factory=dict)


class ExtractFromSessionRequest(BaseModel):
    session_id: str = Field(min_length=1)


class ConflictRequest(BaseModel):
    reason: str = Field(min_length=1)


class RuleMatchRequest(BaseModel):
    session_id: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)


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
def list_lessons(project_id: str, status: str | None = None) -> LessonList:
    service = EvolutionService(_project_root(project_id))
    return LessonList(items=service.list_lessons(status=status))


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
        title=payload.title,
        conditions=payload.conditions,
        expected_benefit=payload.expected_benefit,
    )


@router.post("/lessons/extract-from-session")
def extract_lessons_from_session(project_id: str, payload: ExtractFromSessionRequest) -> LessonList:
    root = _project_root(project_id)
    evolution = EvolutionService(root)
    session_service = SessionService(root)
    events = session_service.list_events(payload.session_id)
    candidates = LessonExtractor(root).extract_from_session(payload.session_id, events)
    lessons = [
        evolution.create_lesson(
            source_type=item["source_type"],
            source_id=item["source_id"],
            domain=item["domain"],
            observation=item["observation"],
            recommendation=item["recommendation"],
            confidence=item["confidence"],
            evidence=item.get("evidence", {}),
            title=item.get("title", ""),
            conditions=item.get("conditions", {}),
            expected_benefit=item.get("expected_benefit", {}),
        )
        for item in candidates
    ]
    return LessonList(items=lessons)


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


@router.post("/lessons/{lesson_id}/conflict")
def mark_lesson_conflict(
    project_id: str,
    lesson_id: str,
    payload: ConflictRequest,
) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.mark_conflict(lesson_id, payload.reason)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/rules/match")
def match_rules(project_id: str, payload: RuleMatchRequest) -> dict[str, Any]:
    service = RuleInjectionService(_project_root(project_id))
    result = service.match_rules(payload.session_id, payload.context)
    result["prompt_snippet"] = service.inject_prompt(
        payload.session_id,
        result["matched_rules"],
    )
    return result


@router.get("/injection-log")
def list_injection_log(project_id: str) -> dict[str, list[dict[str, Any]]]:
    return {"items": RuleInjectionService(_project_root(project_id)).list_injection_log()}
