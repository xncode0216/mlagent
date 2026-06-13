import json
from pathlib import Path

from app.services.lesson_extractor import LessonExtractor


def test_extracts_missing_value_lesson_from_artifact(tmp_path: Path):
    session_id = "session-1"
    artifact_path = tmp_path / "results" / session_id / "missing.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        json.dumps(
            {
                "columns": {
                    "age": {"missing_count": 3, "missing_ratio": 0.03},
                    "churn": {"missing_count": 0, "missing_ratio": 0.0},
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    events = [
        {
            "type": "artifact_created",
            "trace_id": "trace-1",
            "artifact": {
                "type": "dataframe",
                "name": "missing.json",
                "path": f"results/{session_id}/missing.json",
            },
        }
    ]
    lessons = LessonExtractor(tmp_path).extract_from_session(session_id, events)

    assert len(lessons) == 1
    assert lessons[0]["domain"] == ["data-analysis", "missing-value"]
    assert lessons[0]["conditions"]["missing_ratio_range"] == [0, 0.05]


def test_extracts_kernel_error_lesson(tmp_path: Path):
    events = [
        {
            "type": "kernel_output",
            "trace_id": "trace-2",
            "stream": "stderr",
            "text": "ModuleNotFoundError: No module named 'lightgbm'",
        }
    ]
    lessons = LessonExtractor(tmp_path).extract_from_session("session-2", events)

    assert len(lessons) == 1
    assert lessons[0]["domain"] == ["runtime", "kernel-error"]
    assert "lightgbm" in lessons[0]["recommendation"].lower()
