from app.services.evolution_service import EvolutionService
from app.services.rule_injection_service import RuleInjectionService


def test_matches_high_confidence_rules_and_writes_injection_log(tmp_path):
    evolution = EvolutionService(tmp_path)
    lesson = evolution.create_lesson(
        source_type="analysis_session",
        source_id="session-1",
        domain=["data-analysis", "missing-value"],
        observation="age has low missing ratio",
        recommendation="Use median imputation with an indicator",
        confidence=0.82,
        conditions={"task_modes": ["analysis"], "feature_type": "numeric", "missing_ratio_range": [0, 0.05]},
    )
    evolution.adopt_lesson(lesson.id)

    service = RuleInjectionService(tmp_path)
    result = service.match_rules(
        session_id="session-2",
        context={"mode": "analysis", "feature_type": "numeric", "missing_ratio": 0.03, "tags": ["missing-value"]},
    )

    assert result["matched_rules"][0]["lesson_id"] == lesson.id
    assert result["matched_rules"][0]["score"] >= 0.65

    snippet = service.inject_prompt("session-2", result["matched_rules"])
    assert lesson.id in snippet
    assert (tmp_path / "evolution" / "injection-log.jsonl").exists()
