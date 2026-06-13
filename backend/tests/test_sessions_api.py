import json

from fastapi.testclient import TestClient

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app
from app.services.task_state_service import write_task_state


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
    assert "missing values" in messages[1]["content"]


def test_list_session_events_after_websocket_run(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "event_project"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,56.95,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/session-events") as websocket:
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

    events = client.get("/api/sessions/session-events/events").json()["items"]
    event_types = [event["type"] for event in events]
    assert "tool_call_started" in event_types
    assert "tool_call_finished" in event_types
    assert "artifact_created" in event_types
    assert event_types[-1] == "task_progress"

    trace_ids = {event["trace_id"] for event in events}
    assert len(trace_ids) == 1
    finished = next(event for event in events if event["type"] == "tool_call_finished")
    assert finished["duration_ms"] >= 0
    assert finished["finished_at"]

    log_path = tmp_path / "dev-user" / project["id"] / "logs" / "session-events.jsonl"
    persisted_log_events = [
        json.loads(line)
        for line in log_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [event["payload"]["type"] for event in persisted_log_events] == event_types

    log_response = client.get("/api/sessions/session-events/log")
    assert log_response.status_code == 200
    assert log_response.headers["content-type"].startswith("application/x-ndjson")
    assert log_response.headers["content-disposition"].endswith('filename="session-events.jsonl"')
    downloaded_events = [
        json.loads(line)
        for line in log_response.text.splitlines()
        if line.strip()
    ]
    assert [event["payload"]["trace_id"] for event in downloaded_events] == [events[0]["trace_id"]] * len(events)


def test_list_session_task_states_returns_durable_retry_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "task_state_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    session = client.post(
        f"/api/projects/{project['id']}/sessions",
        json={"mode": "machine-learning", "title": "Retry Session"},
    ).json()

    empty_response = client.get(f"/api/sessions/{session['id']}/task-states")
    assert empty_response.status_code == 200
    assert empty_response.json()["items"] == []

    write_task_state(
        project_root=project_root,
        session_id=session["id"],
        stage="train",
        payload={
            "status": "failed",
            "project_id": project["id"],
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "engine": "sklearn",
            "retry_count": 2,
            "last_error": "Target column was not found",
        },
    )

    response = client.get(f"/api/sessions/{session['id']}/task-states")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "session_id": session["id"],
            "status": "failed",
            "project_id": project["id"],
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "engine": "sklearn",
            "retry_count": 2,
            "last_error": "Target column was not found",
            "stage": "train",
            "created_at": response.json()["items"][0]["created_at"],
            "updated_at": response.json()["items"][0]["updated_at"],
        }
    ]


def test_abandon_session_task_state_deletes_saved_retry_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "task_state_abandon_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    session = client.post(
        f"/api/projects/{project['id']}/sessions",
        json={"mode": "machine-learning", "title": "Retry Session"},
    ).json()

    write_task_state(
        project_root=project_root,
        session_id=session["id"],
        stage="train",
        payload={
            "status": "failed",
            "project_id": project["id"],
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "engine": "sklearn",
            "retry_count": 1,
            "last_error": "Target column was not found",
        },
    )

    response = client.delete(f"/api/sessions/{session['id']}/task-states/train")

    assert response.status_code == 200
    assert response.json() == {"session_id": session["id"], "stage": "train", "deleted": True}
    assert client.get(f"/api/sessions/{session['id']}/task-states").json()["items"] == []
