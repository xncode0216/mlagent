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


def _write_quality_profile(tmp_path: Path, session_id: str, profile: dict) -> list[dict]:
    """写入现代自然语言流程真实产出的画像产物，返回对应的会话事件。"""
    artifact_path = tmp_path / "results" / session_id / "data_quality_profile.json"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")
    return [
        {
            "type": "artifact_created",
            "trace_id": "trace-modern",
            "artifact": {
                "type": "dataframe",
                "name": "data_quality_profile.json",
                "path": f"results/{session_id}/data_quality_profile.json",
            },
        }
    ]


def test_extracts_missing_value_lesson_from_the_modern_quality_profile(tmp_path: Path):
    """抽取器此前只认 legacy 流程的 missing.json。

    现代自然语言流程产出的是 data_quality_profile.json，因此在产品主路径上跑完
    整个流程后执行"沉淀经验"，抽取器一个候选也找不到。
    """
    session_id = "session-modern"
    events = _write_quality_profile(
        tmp_path,
        session_id,
        {
            "row_count": 100,
            "columns": [
                {
                    "name": "age",
                    "kind": "numeric",
                    "missing_count": 3,
                    "missing_ratio": 0.03,
                    "unique_count": 40,
                    "quality_flags": ["has_missing"],
                },
                {
                    "name": "churn",
                    "kind": "categorical",
                    "missing_count": 0,
                    "missing_ratio": 0.0,
                    "unique_count": 2,
                    "quality_flags": [],
                },
            ],
        },
    )

    lessons = LessonExtractor(tmp_path).extract_from_session(session_id, events)

    assert len(lessons) == 1
    assert lessons[0]["domain"] == ["data-analysis", "missing-value"]
    assert lessons[0]["conditions"]["missing_ratio_range"] == [0, 0.05]
    assert "age" in lessons[0]["observation"]


def test_modern_profile_only_yields_lessons_for_low_missing_numeric_columns(tmp_path: Path):
    # 与 legacy 路径一致的边界：只有低缺失率的数值列适合中位数填充建议
    session_id = "session-bounds"
    events = _write_quality_profile(
        tmp_path,
        session_id,
        {
            "row_count": 100,
            "columns": [
                # 缺失率过高，中位数填充会掩盖信号
                {"name": "income", "kind": "numeric", "missing_ratio": 0.62, "quality_flags": ["high_missing"]},
                # 类别列不适用中位数
                {"name": "plan", "kind": "categorical", "missing_ratio": 0.02, "quality_flags": ["has_missing"]},
                # 无缺失，无需建议
                {"name": "age", "kind": "numeric", "missing_ratio": 0.0, "quality_flags": []},
            ],
        },
    )

    assert LessonExtractor(tmp_path).extract_from_session(session_id, events) == []


def test_does_not_duplicate_a_lesson_when_both_artifacts_exist(tmp_path: Path):
    # 同一列不该因为两条流程各产出一份画像就沉淀两次
    session_id = "session-both"
    legacy_path = tmp_path / "results" / session_id / "missing.json"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path.write_text(
        json.dumps({"columns": {"age": {"missing_count": 3, "missing_ratio": 0.03}}}),
        encoding="utf-8",
    )
    events = _write_quality_profile(
        tmp_path,
        session_id,
        {
            "row_count": 100,
            "columns": [
                {"name": "age", "kind": "numeric", "missing_ratio": 0.03, "quality_flags": ["has_missing"]}
            ],
        },
    )
    events.append(
        {
            "type": "artifact_created",
            "trace_id": "trace-legacy",
            "artifact": {
                "type": "dataframe",
                "name": "missing.json",
                "path": f"results/{session_id}/missing.json",
            },
        }
    )

    lessons = LessonExtractor(tmp_path).extract_from_session(session_id, events)

    assert [lesson["evidence"]["column"] for lesson in lessons] == ["age"]


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
