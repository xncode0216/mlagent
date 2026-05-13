import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


@dataclass
class LessonRecord:
    id: str
    source_type: str
    source_id: str
    domain: list[str]
    observation: str
    recommendation: str
    confidence: float
    status: str
    evidence: dict[str, Any]
    created_at: str
    updated_at: str


class EvolutionService:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.lessons_dir = project_root / "evolution" / "lessons"
        self.high_confidence_dir = project_root / "evolution" / "rules" / "high-confidence"

    def create_lesson(
        self,
        source_type: str,
        source_id: str,
        domain: list[str],
        observation: str,
        recommendation: str,
        confidence: float,
        evidence: dict[str, Any] | None = None,
    ) -> LessonRecord:
        now = datetime.now(UTC).isoformat()
        record = LessonRecord(
            id=uuid4().hex,
            source_type=source_type,
            source_id=source_id,
            domain=domain,
            observation=observation,
            recommendation=recommendation,
            confidence=round(confidence, 4),
            status="pending_review",
            evidence=evidence or {},
            created_at=now,
            updated_at=now,
        )
        self._write_lesson(record)
        return record

    def list_lessons(self) -> list[LessonRecord]:
        self.lessons_dir.mkdir(parents=True, exist_ok=True)
        lessons = [self._read_lesson(path) for path in self.lessons_dir.glob("*.json")]
        return sorted(lessons, key=lambda lesson: lesson.created_at, reverse=True)

    def adopt_lesson(self, lesson_id: str) -> LessonRecord:
        lesson = self.get_lesson(lesson_id)
        lesson.status = "high_confidence"
        lesson.updated_at = datetime.now(UTC).isoformat()
        self._write_lesson(lesson)
        self.high_confidence_dir.mkdir(parents=True, exist_ok=True)
        (self.high_confidence_dir / f"{lesson.id}.json").write_text(
            json.dumps(asdict(lesson), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return lesson

    def reject_lesson(self, lesson_id: str) -> LessonRecord:
        lesson = self.get_lesson(lesson_id)
        lesson.status = "rejected"
        lesson.updated_at = datetime.now(UTC).isoformat()
        self._write_lesson(lesson)
        return lesson

    def get_lesson(self, lesson_id: str) -> LessonRecord:
        path = self.lessons_dir / f"{lesson_id}.json"
        if not path.exists():
            raise FileNotFoundError(lesson_id)
        return self._read_lesson(path)

    def _write_lesson(self, lesson: LessonRecord) -> None:
        self.lessons_dir.mkdir(parents=True, exist_ok=True)
        (self.lessons_dir / f"{lesson.id}.json").write_text(
            json.dumps(asdict(lesson), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _read_lesson(path: Path) -> LessonRecord:
        return LessonRecord(**json.loads(path.read_text(encoding="utf-8")))
