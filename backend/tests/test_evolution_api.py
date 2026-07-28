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


def _adopted_lesson(client, project_id: str) -> dict:
    lesson = client.post(
        f"/api/projects/{project_id}/evolution/lessons/extract",
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
    return client.post(
        f"/api/projects/{project_id}/evolution/lessons/{lesson['id']}/adopt"
    ).json()


def _match_context(client, project_id: str, session_id: str) -> dict:
    return client.post(
        f"/api/projects/{project_id}/evolution/rules/match",
        json={
            "session_id": session_id,
            "context": {
                "mode": "analysis",
                "feature_type": "numeric",
                "missing_ratio": 0.02,
                "tags": ["missing-value"],
            },
        },
    ).json()


def test_disabling_an_adopted_rule_stops_it_being_injected(tmp_path, monkeypatch):
    # 采纳此前是一扇单向门：一条经验被采纳后会永久影响之后每一次运行，
    # 即使事后发现它是错的，也没有关闭开关。
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])
    assert _match_context(client, project["id"], "session-before")["matched_rules"]

    disabled = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/disable",
        json={"reason": "在时间序列数据上给出了错误的填充建议"},
    )

    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    # 停用只关闭注入，不推翻"曾经过审核"这一事实
    assert disabled.json()["status"] == "high_confidence"
    assert not _match_context(client, project["id"], "session-after")["matched_rules"]

    index = json.loads(
        (tmp_path / "dev-user" / project["id"] / "evolution" / "rules" / "index.json").read_text(
            encoding="utf-8"
        )
    )
    assert index["items"] == []


def test_re_enabling_a_rule_restores_injection(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/disable", json={})

    enabled = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/enable"
    )

    assert enabled.status_code == 200
    assert enabled.json()["enabled"] is True
    assert _match_context(client, project["id"], "session-after")["matched_rules"]


def test_disable_records_an_auditable_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])

    disabled = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/disable",
        json={"reason": "与新的业务口径冲突"},
    ).json()

    assert disabled["evidence"]["disabled_reason"] == "与新的业务口径冲突"


def test_existing_adopted_lessons_stay_enabled_by_default(tmp_path, monkeypatch):
    # 已有记录没有 enabled 字段，读取时必须视为启用——否则一次升级会静默停掉所有规则
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])

    lesson_path = (
        tmp_path
        / "dev-user"
        / project["id"]
        / "evolution"
        / "lessons"
        / "high-confidence"
        / f"{lesson['id']}.json"
    )
    stored = json.loads(lesson_path.read_text(encoding="utf-8"))
    stored.pop("enabled", None)
    lesson_path.write_text(json.dumps(stored, ensure_ascii=False), encoding="utf-8")

    listed = client.get(f"/api/projects/{project['id']}/evolution/lessons").json()["items"]
    assert [item["enabled"] for item in listed] == [True]
    assert _match_context(client, project["id"], "session-legacy")["matched_rules"]


def _match_with(client, project_id: str, context: dict) -> list:
    return client.post(
        f"/api/projects/{project_id}/evolution/rules/match",
        json={"session_id": "scoped-session", "context": context},
    ).json()["matched_rules"]


_BROAD_CONTEXT = {
    "mode": "analysis",
    "feature_type": "numeric",
    "missing_ratio": 0.02,
    "tags": ["missing-value"],
}


def test_scoping_a_rule_to_datasets_gates_it_outside_them(tmp_path, monkeypatch):
    # scope 是用户设定的硬边界，必须先于打分生效：否则高置信规则仍会越界跨过阈值
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])

    scoped = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/scope",
        json={"datasets": ["data/telecom_churn.csv"]},
    )

    assert scoped.status_code == 200
    assert scoped.json()["scope"]["datasets"] == ["data/telecom_churn.csv"]

    inside = _match_with(
        client, project["id"], {**_BROAD_CONTEXT, "dataset_path": "data/telecom_churn.csv"}
    )
    outside = _match_with(
        client, project["id"], {**_BROAD_CONTEXT, "dataset_path": "data/other.csv"}
    )

    assert len(inside) == 1
    assert outside == []


def test_scope_gate_beats_a_strong_condition_match(tmp_path, monkeypatch):
    # 即使 conditions 打分很高，越出 scope 也必须完全不注入
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])
    client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/scope",
        json={"modes": ["machine-learning"]},
    )

    # 这个上下文让 conditions 满分命中，但模式不在 scope 内
    assert _match_with(client, project["id"], _BROAD_CONTEXT) == []


def test_an_unscoped_rule_still_applies_everywhere(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    _adopted_lesson(client, project["id"])

    assert len(_match_with(client, project["id"], {**_BROAD_CONTEXT, "dataset_path": "data/any.csv"})) == 1


def test_clearing_a_scope_restores_unrestricted_matching(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = _adopted_lesson(client, project["id"])
    client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/scope",
        json={"datasets": ["data/telecom_churn.csv"]},
    )
    assert _match_with(client, project["id"], {**_BROAD_CONTEXT, "dataset_path": "data/x.csv"}) == []

    cleared = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/scope",
        json={"datasets": [], "modes": []},
    )

    assert cleared.json()["scope"] == {"datasets": [], "modes": []}
    assert len(_match_with(client, project["id"], {**_BROAD_CONTEXT, "dataset_path": "data/x.csv"})) == 1


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
