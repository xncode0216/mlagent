from fastapi.testclient import TestClient

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app


def test_create_and_list_project_sessions(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "session_project"}).json()

    created = client.post(
        f"/api/projects/{project['id']}/sessions",
        json={"mode": "analysis", "title": "首次分析"},
    ).json()
    listed = client.get(f"/api/projects/{project['id']}/sessions").json()

    assert created["project_id"] == project["id"]
    assert created["mode"] == "analysis"
    assert created["title"] == "首次分析"
    assert listed["items"][0]["id"] == created["id"]


def test_list_session_messages_after_websocket_run(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "message_project"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,56.95,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/session-history") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析 customer_churn.csv",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        while True:
            event = websocket.receive_json()
            if event["type"] == "task_progress":
                break

    messages = client.get("/api/sessions/session-history/messages").json()["items"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "分析 customer_churn.csv"
    assert "缺失值" in messages[1]["content"]
