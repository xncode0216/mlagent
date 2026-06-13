from pathlib import Path

from app.services.evolution_service import EvolutionService


def test_lesson_status_directories_and_rule_index(tmp_path: Path):
    service = EvolutionService(tmp_path)
    lesson = service.create_lesson(
        source_type="analysis_session",
        source_id="session-1",
        domain=["data-analysis", "missing-value"],
        observation="age has 2% missing values",
        recommendation="Use median imputation with a missing indicator",
        confidence=0.74,
        evidence={"column": "age"},
        title="Median imputation for low missing numeric columns",
        conditions={"feature_type": "numeric", "missing_ratio_range": [0, 0.05]},
        expected_benefit={"metric": "data_quality", "description": "Keep rows while preserving signal"},
    )

    pending_path = tmp_path / "evolution" / "lessons" / "pending" / f"{lesson.id}.json"
    assert pending_path.exists()

    adopted = service.adopt_lesson(lesson.id)
    assert adopted.status == "high_confidence"
    assert not pending_path.exists()
    assert (tmp_path / "evolution" / "lessons" / "high-confidence" / f"{lesson.id}.json").exists()
    assert (tmp_path / "evolution" / "rules" / "index.json").exists()


def test_reject_and_mark_conflict(tmp_path: Path):
    service = EvolutionService(tmp_path)
    lesson = service.create_lesson(
        source_type="training",
        source_id="exp-1",
        domain=["machine-learning"],
        observation="LightGBM beat the baseline",
        recommendation="Try LightGBM before neural models",
        confidence=0.81,
    )

    rejected = service.reject_lesson(lesson.id)
    assert rejected.status == "rejected"
    assert (tmp_path / "evolution" / "lessons" / "rejected" / f"{lesson.id}.json").exists()

    conflict_source = service.create_lesson(
        source_type="analysis",
        source_id="session-2",
        domain=["data-analysis"],
        observation="Target leakage was detected",
        recommendation="Remove leakage columns before training",
        confidence=0.91,
    )
    conflicted = service.mark_conflict(
        conflict_source.id,
        "Contradicts current approved preprocessing rule",
    )
    assert conflicted.status == "conflicted"
    assert conflicted.evidence["conflict_reason"] == "Contradicts current approved preprocessing rule"
