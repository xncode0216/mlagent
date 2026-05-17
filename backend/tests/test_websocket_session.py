from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_session_socket_rejects_active_file_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    with client.websocket_connect("/ws/sessions/test-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {"project_id": project["id"], "active_file": "../escape.csv"},
            }
        )

        started = websocket.receive_json()
        finished = websocket.receive_json()
        error = websocket.receive_json()

    assert started["type"] == "tool_call_started"
    assert finished["type"] == "tool_call_finished"
    assert finished["status"] == "error"
    assert finished["trace_id"] == started["trace_id"]
    assert finished["duration_ms"] >= 0
    assert error["type"] == "error"
    assert error["trace_id"] == started["trace_id"]
    assert error["code"] == "invalid_active_file"
    assert error["message"] == "Active file is outside the project workspace"


def test_session_socket_emits_artifact_with_created_at(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/test-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                },
            }
        )

        event_types = []
        first_artifact = None
        for _ in range(5):
            event = websocket.receive_json()
            event_types.append(event["type"])
            if event["type"] == "artifact_created":
                first_artifact = event["artifact"]
                break

    assert "tool_call_started" in event_types
    assert first_artifact is not None
    assert first_artifact["created_at"]
    assert first_artifact["path"].startswith("results/test-session/")


def test_session_socket_emits_distribution_chart_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,56.95,0\n55,90.0,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/test-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                },
            }
        )

        artifacts = []
        for _ in range(8):
            event = websocket.receive_json()
            if event["type"] == "artifact_created":
                artifacts.append(event["artifact"])
            if any(artifact["name"] == "distribution.json" for artifact in artifacts):
                break

    distribution_artifact = next(
        artifact for artifact in artifacts if artifact["name"] == "distribution.json"
    )
    assert distribution_artifact["type"] == "chart"
    assert distribution_artifact["path"] == "results/test-session/distribution.json"
