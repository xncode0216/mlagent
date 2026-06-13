import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app


def _customer_churn_csv() -> str:
    rows = ["age,score,churn"]
    rows.extend(f"{20 + index},0.{index},no" for index in range(1, 11))
    rows.extend(f"{50 + index},0.{index},yes" for index in range(1, 11))
    rows.append(",0.95,yes")
    return "\n".join(rows) + "\n"


def test_backend_golden_path_from_upload_to_graph_insight(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)

    project = client.post("/api/projects", json={"name": "golden_churn"}).json()
    project_id = project["id"]
    workspace = Path(project["workspace_path"])

    upload_response = client.post(
        f"/api/projects/{project_id}/files/upload",
        data={"path": "data/customer_churn.csv"},
        files={"file": ("customer_churn.csv", _customer_churn_csv().encode(), "text/csv")},
    )
    assert upload_response.status_code == 200
    uploaded_file = upload_response.json()
    assert uploaded_file["path"] == "data/customer_churn.csv"

    uploaded_content = client.get(
        f"/api/projects/{project_id}/files/content",
        params={"path": uploaded_file["path"]},
    )
    assert uploaded_content.status_code == 200
    assert uploaded_content.json()["mime_type"] == "text/csv"

    session_id = "golden-analysis"
    seen_event_types: list[str] = []
    with client.websocket_connect(f"/ws/sessions/{session_id}") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析 customer_churn.csv 并沉淀可复用经验",
                "context": {
                    "project_id": project_id,
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        while True:
            event = websocket.receive_json()
            seen_event_types.append(event["type"])
            if event["type"] == "task_progress":
                break

    assert "artifact_created" in seen_event_types
    assert "lesson_extracted" in seen_event_types

    session_messages = client.get(f"/api/sessions/{session_id}/messages")
    assert session_messages.status_code == 200
    assert [message["role"] for message in session_messages.json()["items"]] == ["user", "assistant"]

    session_events = client.get(f"/api/sessions/{session_id}/events")
    assert session_events.status_code == 200
    persisted_events = session_events.json()["items"]
    persisted_event_types = [event["type"] for event in persisted_events]
    assert persisted_event_types[0] == "tool_call_started"
    assert "rules_matched" in persisted_event_types
    assert persisted_event_types[-1] == "task_progress"

    trace_ids = {event["trace_id"] for event in persisted_events if event.get("trace_id")}
    assert len(trace_ids) == 1
    trace_id = next(iter(trace_ids))

    artifact_events = [event for event in persisted_events if event["type"] == "artifact_created"]
    artifact_paths = {event["artifact"]["path"] for event in artifact_events}
    assert {
        f"results/{session_id}/profile.json",
        f"results/{session_id}/missing.json",
        f"results/{session_id}/correlation.json",
        f"results/{session_id}/distribution.json",
    }.issubset(artifact_paths)

    log_response = client.get(f"/api/sessions/{session_id}/log")
    assert log_response.status_code == 200
    assert log_response.headers["content-type"].startswith("application/x-ndjson")
    downloaded_events = [json.loads(line) for line in log_response.text.splitlines() if line.strip()]
    assert [event["payload"]["type"] for event in downloaded_events] == persisted_event_types
    assert {event["payload"]["trace_id"] for event in downloaded_events if event["payload"].get("trace_id")} == {trace_id}

    lesson_response = client.get(
        f"/api/projects/{project_id}/evolution/lessons",
        params={"status": "pending_review"},
    )
    assert lesson_response.status_code == 200
    pending_lessons = lesson_response.json()["items"]
    age_lesson = next(
        lesson
        for lesson in pending_lessons
        if lesson["evidence"].get("column") == "age"
    )
    assert age_lesson["conditions"]["missing_ratio_range"] == [0, 0.05]

    adopt_response = client.post(
        f"/api/projects/{project_id}/evolution/lessons/{age_lesson['id']}/adopt"
    )
    assert adopt_response.status_code == 200
    assert adopt_response.json()["status"] == "high_confidence"

    handoff_response = client.post(
        f"/api/projects/{project_id}/analysis/handoff-to-ml",
        json={"dataset_path": "data/customer_churn.csv", "session_id": session_id},
    )
    assert handoff_response.status_code == 200
    assert handoff_response.json()["recommended_target_column"] == "churn"

    preprocessing_response = client.post(
        f"/api/projects/{project_id}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": session_id},
    )
    assert preprocessing_response.status_code == 200
    preprocessing_plan_path = preprocessing_response.json()["plan_artifact"]["path"]
    execute_preprocessing_response = client.post(
        f"/api/projects/{project_id}/analysis/execute-preprocess-plan",
        json={"preprocessing_plan_path": preprocessing_plan_path, "session_id": session_id},
    )
    assert execute_preprocessing_response.status_code == 200
    executed_preprocessing = execute_preprocessing_response.json()
    planned_dataset_path = executed_preprocessing["transformed_data_artifact"]["path"]
    assert planned_dataset_path == "results/golden-analysis/customer_churn_planned.csv"
    assert executed_preprocessing["summary"]["preprocessing_plan_path"] == preprocessing_plan_path
    assert executed_preprocessing["summary"]["target_column"] == "churn"
    planned_dataset = (workspace / planned_dataset_path).read_text(encoding="utf-8")
    assert "customer_id" not in planned_dataset
    assert "churn" in planned_dataset
    assert (workspace / executed_preprocessing["report_artifact"]["path"]).exists()

    train_response = client.post(
        f"/api/projects/{project_id}/ml/train-baseline",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "golden-training",
        },
    )
    assert train_response.status_code == 200
    training_payload = train_response.json()
    assert training_payload["metrics"]["accuracy"] >= 0.9

    runs_response = client.get(f"/api/projects/{project_id}/ml/runs")
    assert runs_response.status_code == 200
    assert [run["experiment_id"] for run in runs_response.json()["items"]] == [training_payload["experiment_id"]]

    run_detail = client.get(f"/api/projects/{project_id}/ml/runs/{training_payload['experiment_id']}")
    assert run_detail.status_code == 200
    assert run_detail.json()["metrics_artifact"]["path"] == training_payload["metrics_artifact"]["path"]
    assert run_detail.json()["model_artifact"]["path"] == training_payload["model_artifact"]["path"]
    assert (
        run_detail.json()["evaluation_report_artifact"]["path"]
        == training_payload["evaluation_report_artifact"]["path"]
    )

    metrics_content = client.get(
        f"/api/projects/{project_id}/files/content",
        params={"path": training_payload["metrics_artifact"]["path"]},
    )
    assert metrics_content.status_code == 200
    assert metrics_content.json()["mime_type"] == "application/json"
    assert json.loads(metrics_content.json()["content"])["experiment_id"] == training_payload["experiment_id"]

    model_content = client.get(
        f"/api/projects/{project_id}/files/content",
        params={"path": training_payload["model_artifact"]["path"]},
    )
    assert model_content.status_code == 200
    assert json.loads(model_content.json()["content"])["experiment_id"] == training_payload["experiment_id"]

    report_content = client.get(
        f"/api/projects/{project_id}/files/content",
        params={"path": training_payload["evaluation_report_artifact"]["path"]},
    )
    assert report_content.status_code == 200
    assert report_content.json()["mime_type"] in {"text/markdown", "text/plain"}
    assert "# Model Evaluation Report" in report_content.json()["content"]
    assert training_payload["experiment_id"] in report_content.json()["content"]

    match_response = client.post(
        f"/api/projects/{project_id}/evolution/rules/match",
        json={
            "session_id": "golden-follow-up",
            "context": {
                "mode": "analysis",
                "feature_type": "numeric",
                "missing_ratio": 1 / 21,
                "tags": ["missing-value"],
            },
        },
    )
    assert match_response.status_code == 200
    matched_rules = match_response.json()["matched_rules"]
    assert matched_rules
    assert matched_rules[0]["lesson_id"] == age_lesson["id"]
    assert age_lesson["id"] in match_response.json()["prompt_snippet"]

    graph_response = client.get(f"/api/projects/{project_id}/evolution/graph")
    assert graph_response.status_code == 200
    graph = graph_response.json()
    node_ids = {node["id"] for node in graph["nodes"]}
    edge_pairs = {(edge["source"], edge["target"]) for edge in graph["edges"]}
    insight_types = {insight["type"] for insight in graph["insights"]}

    assert "col_age" in node_ids
    assert f"rule_{age_lesson['id']}" in node_ids
    assert f"exp_{training_payload['experiment_id']}" in node_ids
    assert (f"rule_{age_lesson['id']}", "col_age") in edge_pairs
    assert "surprise_connection" in insight_types

    nodes_by_id = {node["id"]: node for node in graph["nodes"]}
    assert nodes_by_id["col_age"]["properties"]["provenance"] == {
        "kind": "dataset_column",
        "dataset_paths": ["data/customer_churn.csv"],
        "column": "age",
    }
    assert nodes_by_id[f"exp_{training_payload['experiment_id']}"]["properties"]["provenance"] == {
        "kind": "experiment_run",
        "experiment_id": training_payload["experiment_id"],
        "dataset_path": "data/customer_churn.csv",
        "metrics_path": training_payload["metrics_artifact"]["path"],
        "model_path": training_payload["model_artifact"]["path"],
    }
    assert nodes_by_id[f"rule_{age_lesson['id']}"]["properties"]["provenance"] == {
        "kind": "lesson",
        "lesson_id": age_lesson["id"],
        "source_type": "analysis_session",
        "source_id": session_id,
        "evidence": age_lesson["evidence"],
    }

    injection_log = client.get(f"/api/projects/{project_id}/evolution/injection-log")
    assert injection_log.status_code == 200
    assert injection_log.json()["items"]
