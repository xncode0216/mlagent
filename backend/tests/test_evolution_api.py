import json

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_extract_and_list_lesson(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "training",
            "source_id": "experiment-1",
            "domain": ["machine_learning", "baseline"],
            "observation": "Numeric threshold on score separated churn labels perfectly.",
            "recommendation": "Try score threshold baseline before expensive models.",
            "confidence": 0.72,
            "evidence": {"accuracy": 1.0, "rows": 4},
        },
    )

    assert response.status_code == 200
    lesson = response.json()
    assert lesson["status"] == "pending_review"
    assert lesson["confidence"] == 0.72

    list_response = client.get(f"/api/projects/{project['id']}/evolution/lessons")
    assert list_response.status_code == 200
    lessons = list_response.json()["items"]
    assert [item["id"] for item in lessons] == [lesson["id"]]
    assert lessons[0]["recommendation"] == "Try score threshold baseline before expensive models."


def test_adopt_and_reject_lessons(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis",
            "source_id": "session-1",
            "domain": ["data_analysis"],
            "observation": "Columns with low missing ratio were safe to median-impute.",
            "recommendation": "Prefer median imputation for skewed numeric columns.",
            "confidence": 0.64,
        },
    ).json()

    adopted = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/adopt"
    )

    assert adopted.status_code == 200
    assert adopted.json()["status"] == "high_confidence"
    project_root = tmp_path / "dev-user" / project["id"]
    lesson_path = project_root / "evolution" / "lessons" / "high-confidence"
    assert (lesson_path / f"{lesson['id']}.json").exists()
    assert (project_root / "evolution" / "rules" / "index.json").exists()

    rejected = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/reject"
    )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"


def test_list_evolution_protocols_includes_imported_skill_mechanisms(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.get(f"/api/projects/{project['id']}/evolution/protocols")

    assert response.status_code == 200
    protocols = response.json()["items"]
    protocol_ids = {item["id"] for item in protocols}
    assert "grill-with-docs" in protocol_ids
    assert "diagnose-loop" in protocol_ids
    assert "tdd-vertical-slice" in protocol_ids
    assert "two-axis-review" in protocol_ids
    assert all(item["agent_policy"] for item in protocols)


def test_extract_lessons_from_session_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    root = tmp_path / "dev-user" / project["id"]
    artifact_path = root / "results" / "session-1" / "missing.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        '{"columns":{"age":{"missing_count":2,"missing_ratio":0.02}}}',
        encoding="utf-8",
    )
    session_dir = root / "sessions" / "session-1"
    session_dir.mkdir(parents=True)
    (root / "sessions" / "index.json").write_text(
        '{"sessions":[{"id":"session-1","project_id":"%s","mode":"analysis","title":"分析","created_at":"now","updated_at":"now","message_count":0}]}'
        % project["id"],
        encoding="utf-8",
    )
    (session_dir / "events.jsonl").write_text(
        '{"payload":{"type":"artifact_created","trace_id":"trace-1","artifact":{"name":"missing.json","path":"results/session-1/missing.json"}}}\n',
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract-from-session",
        json={"session_id": "session-1"},
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["status"] == "pending_review"


def test_lesson_extraction_persists_and_resumes_failed_learning_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "retry_learning"}).json()
    root = tmp_path / "dev-user" / project["id"]

    failed_response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract-from-session",
        json={"session_id": "learn-session"},
    )

    assert failed_response.status_code == 500
    assert failed_response.json()["detail"] == "Session not found for lesson extraction"
    state_path = root / "sessions" / "learn-session" / "task_state" / "learn.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["stage"] == "learn"
    assert state["source_id"] == "learn-session"
    assert state["repair_hint"].startswith("Restore the source session")
    assert state["recovery_policy"]["resume_action"] == "Retry learned-rule extraction from the saved source session."

    artifact_path = root / "results" / "learn-session" / "missing.json"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(
        '{"columns":{"age":{"missing_count":2,"missing_ratio":0.02}}}',
        encoding="utf-8",
    )
    session_dir = root / "sessions" / "learn-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (root / "sessions" / "index.json").write_text(
        '{"sessions":[{"id":"learn-session","project_id":"%s","mode":"analysis","title":"Learn",'
        '"created_at":"now","updated_at":"now","message_count":0}]}'
        % project["id"],
        encoding="utf-8",
    )
    (session_dir / "events.jsonl").write_text(
        '{"payload":{"type":"artifact_created","trace_id":"trace-1",'
        '"artifact":{"name":"missing.json","path":"results/learn-session/missing.json"}}}\n',
        encoding="utf-8",
    )

    resumed_response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/resume-extraction",
        json={"session_id": "learn-session"},
    )

    assert resumed_response.status_code == 200
    items = resumed_response.json()["items"]
    assert len(items) == 1
    assert items[0]["source_id"] == "learn-session"
    assert not state_path.exists()


def test_match_rules_api_writes_injection_log(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis",
            "source_id": "session-1",
            "domain": ["data-analysis", "missing-value"],
            "observation": "age has low missing ratio",
            "recommendation": "Use median imputation",
            "confidence": 0.82,
            "conditions": {
                "task_modes": ["analysis"],
                "feature_type": "numeric",
                "missing_ratio_range": [0, 0.05],
            },
            "evidence": {},
        },
    ).json()
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/adopt")

    response = client.post(
        f"/api/projects/{project['id']}/evolution/rules/match",
        json={
            "session_id": "session-2",
            "context": {
                "mode": "analysis",
                "feature_type": "numeric",
                "missing_ratio": 0.02,
                "tags": ["missing-value"],
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["matched_rules"]
    assert lesson["id"] in response.json()["prompt_snippet"]
    log_response = client.get(f"/api/projects/{project['id']}/evolution/injection-log")
    assert log_response.json()["items"]


def test_mark_lesson_conflict_api(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis",
            "source_id": "session-1",
            "domain": ["data-analysis"],
            "observation": "Leakage fields were removed.",
            "recommendation": "Remove leakage fields before training.",
            "confidence": 0.9,
        },
    ).json()

    response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/conflict",
        json={"reason": "Conflicts with current dataset contract"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "conflicted"
    assert response.json()["evidence"]["conflict_reason"] == "Conflicts with current dataset contract"
