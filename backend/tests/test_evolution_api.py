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
