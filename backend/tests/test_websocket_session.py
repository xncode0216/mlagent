import asyncio
import json
from pathlib import Path
from typing import cast

from fastapi import WebSocket
from fastapi.testclient import TestClient

from app.api.ws import session_socket
from app.core.config import get_settings
from app.main import app
from app.services.experiment_service import ExperimentService
from app.services.session_service import SessionService
from app.services.task_state_service import write_task_state


class DisconnectDuringAccept:
    async def accept(self) -> None:
        raise RuntimeError(
            "Expected ASGI message 'websocket.send' or 'websocket.close', "
            "but got 'websocket.accept'."
        )


def test_session_socket_ignores_disconnect_race_during_accept():
    websocket = cast(WebSocket, DisconnectDuringAccept())

    asyncio.run(session_socket(websocket, "disconnect-during-accept"))


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


def test_session_socket_links_persisted_messages_to_their_trace(tmp_path, monkeypatch):
    # 事件流每条都带 trace_id，但消息此前没有，界面上的一句回复无从回溯到
    # 产生它的那次执行——工具调用、产物与错误都查不到。
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/trace-session") as websocket:
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
        event_trace_ids = set()
        while True:
            event = websocket.receive_json()
            if event.get("trace_id"):
                event_trace_ids.add(event["trace_id"])
            if event["type"] == "task_progress" and event.get("progress") == 1:
                break

    assert len(event_trace_ids) == 1
    trace_id = event_trace_ids.pop()

    messages = client.get("/api/sessions/trace-session/messages").json()["items"]
    roles = {message["role"] for message in messages}
    assert roles == {"user", "assistant"}
    for message in messages:
        assert message["metadata"]["trace_id"] == trace_id


def _scoped_rule_match(tmp_path, client, project_id: str, scoped_dataset: str, session_id: str):
    lesson = client.post(
        f"/api/projects/{project_id}/evolution/lessons/extract",
        json={
            "source_type": "analysis",
            "source_id": "session-1",
            # 与 LessonExtractor 及运行情境标签使用同一套词汇
            "domain": ["data-analysis", "missing-value"],
            "observation": "低缺失率数值列适合中位数填充",
            "recommendation": "对偏态数值列优先使用中位数填充",
            "confidence": 0.95,
            "conditions": {"task_modes": ["analysis"]},
            "evidence": {},
        },
    ).json()
    client.post(f"/api/projects/{project_id}/evolution/lessons/{lesson['id']}/adopt")
    client.post(
        f"/api/projects/{project_id}/evolution/lessons/{lesson['id']}/scope",
        json={"datasets": [scoped_dataset]},
    )

    with client.websocket_connect(f"/ws/sessions/{session_id}") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {
                    "project_id": project_id,
                    "active_file": "data/customer_churn.csv",
                },
            }
        )
        for _ in range(12):
            event = websocket.receive_json()
            if event["type"] == "rules_matched":
                return event["matched_rules"]
    raise AssertionError("rules_matched event was not emitted")


def test_session_socket_injects_a_real_extracted_lesson(tmp_path, monkeypatch):
    """端到端验证自进化闭环真的闭合：抽取器格式的经验被采纳后应注入真实运行。

    此前匹配上下文把 tags 写死为 ["missing-value"]，无论这次运行在做什么都如此宣称；
    真实模式反而没有进入标签维度。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )
    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis_session",
            "source_id": "session-1",
            "domain": ["data-analysis", "missing-value"],
            "observation": "age 缺失率为 2.00%",
            "recommendation": "优先尝试中位数填充",
            "confidence": 0.72,
            "conditions": {
                "task_modes": ["analysis", "machine-learning"],
                "feature_type": "numeric",
                "missing_ratio_range": [0, 0.05],
            },
            "evidence": {},
        },
    ).json()
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/adopt")

    with client.websocket_connect("/ws/sessions/injection-session") as websocket:
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
        rules_event = None
        for _ in range(12):
            event = websocket.receive_json()
            if event["type"] == "rules_matched":
                rules_event = event
                break

    assert rules_event is not None
    assert [item["lesson_id"] for item in rules_event["matched_rules"]] == [lesson["id"]]
    assert lesson["id"] in rules_event["prompt_snippet"]


def test_lessons_can_be_extracted_after_the_modern_natural_language_flow(tmp_path, monkeypatch):
    """自进化闭环的抽取半环必须在产品主路径上成立。

    抽取器此前只认 legacy「分析数据」流程产出的 missing.json；现代自然语言流程
    产出的是 data_quality_profile.json，因此在主路径跑完后执行"沉淀经验"，
    一个候选也找不到。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    # 24 行里让 age 缺 1 个 = 4.2%，落在"低缺失率数值列"的 (0, 5%] 区间内
    rows = "".join(
        f"{30 + index},{80 + index * 5},{index % 2}\n" for index in range(23)
    )
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,monthly_spend,churn\n" + rows + ",200,1\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/modern-learn-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "Analyze this dataset and prepare it for modeling",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                },
            }
        )
        for _ in range(60):
            event = websocket.receive_json()
            if event["type"] == "task_progress" and event.get("progress") == 1:
                break

    response = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract-from-session",
        json={"session_id": "modern-learn-session"},
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["evidence"]["column"] for item in items] == ["age"]
    assert items[0]["status"] == "pending_review"


def test_session_socket_tags_the_run_with_its_real_mode(tmp_path, monkeypatch):
    # 匹配上下文的标签此前写死为 ["missing-value"]，于是按运行领域标注的经验
    # （如 data-analysis）反而对不上，而每次运行都被谎称在处理缺失值。
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )
    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis_session",
            "source_id": "session-1",
            "domain": ["data-analysis"],
            "observation": "分析流程中的通用经验",
            "recommendation": "先画像再决定清洗策略",
            "confidence": 0.8,
            "conditions": {"task_modes": ["analysis"]},
            "evidence": {},
        },
    ).json()
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/adopt")

    with client.websocket_connect("/ws/sessions/tagged-session") as websocket:
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
        rules_event = None
        for _ in range(12):
            event = websocket.receive_json()
            if event["type"] == "rules_matched":
                rules_event = event
                break

    assert rules_event is not None
    assert [item["lesson_id"] for item in rules_event["matched_rules"]] == [lesson["id"]]


def test_session_socket_applies_a_rule_scoped_to_the_active_dataset(tmp_path, monkeypatch):
    # 规则范围只有在编排器把真实数据集传进匹配上下文时才成立。若不传，
    # 限定到当前数据集的规则也会被误判为越界而完全不生效。
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )

    matched = _scoped_rule_match(
        tmp_path, client, project["id"], "data/customer_churn.csv", "in-scope-session"
    )

    assert len(matched) == 1


def test_session_socket_skips_a_rule_scoped_to_another_dataset(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n",
        encoding="utf-8",
    )

    matched = _scoped_rule_match(
        tmp_path, client, project["id"], "data/somewhere_else.csv", "out-of-scope-session"
    )

    assert matched == []


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


def test_session_socket_emits_rules_and_lessons(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    rows = ["age,churn"]
    rows.extend(",1" if index in {10, 40} else f"{30 + index % 20},{index % 2}" for index in range(100))
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "\n".join(rows) + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/evolution-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        seen = []
        while True:
            event = websocket.receive_json()
            seen.append(event["type"])
            if event["type"] == "task_progress":
                break

    assert "rules_matched" in seen
    assert "lesson_extracted" in seen


def test_session_socket_pauses_and_resumes_modeling_preparation_after_approval(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "agent_modeling_path"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "customer_id,age,monthly_charges,contract,churn",
                "c001,42,70.7,monthly,1",
                "c002,37,56.95,annual,0",
                "c003,55,90.0,monthly,1",
                "c004,29,,annual,0",
                "c005,61,105.2,monthly,1",
                "c006,33,48.5,annual,0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/modeling-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "Analyze this dataset and prepare it for modeling",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress" and event["label"] == "Waiting for preprocessing approval":
                break

    event_types = [event["type"] for event in events]
    assert event_types[0] == "tool_call_started"
    assert "rules_matched" in event_types
    assert "stage_started" in event_types
    assert "stage_completed" in event_types
    assert "approval_required" in event_types
    assert "component_requested" in event_types
    assert event_types[-1] == "task_progress"

    artifact_paths = {
        event["artifact"]["path"]
        for event in events
        if event["type"] == "artifact_created"
    }
    assert {
        "results/modeling-session/data_quality_profile.json",
        "results/modeling-session/preprocessing_plan.json",
        "notebooks/modeling-session_preprocessing_pipeline.py",
    }.issubset(artifact_paths)
    assert "results/modeling-session/customer_churn_planned.csv" not in artifact_paths

    approval = next(event for event in events if event["type"] == "approval_required")
    assert approval["stage"] == "transform"
    assert approval["artifact_path"] == "results/modeling-session/preprocessing_plan.json"

    requested_components = [
        event["component"] for event in events if event["type"] == "component_requested"
    ]
    assert requested_components == [
        "data_quality",
        "preprocessing_plan",
    ]

    persisted_events = client.get("/api/sessions/modeling-session/events").json()["items"]
    persisted_event_types = [event_type for event_type in event_types if event_type != "message_delta"]
    assert [event["type"] for event in persisted_events] == persisted_event_types
    trace_ids = {event["trace_id"] for event in persisted_events if event.get("trace_id")}
    assert len(trace_ids) == 1

    assert not (project_root / "results" / "modeling-session" / "customer_churn_planned.csv").exists()

    with client.websocket_connect("/ws/sessions/modeling-session") as websocket:
        websocket.send_json(
            {
                "type": "approval_response",
                "approval_id": approval["approval_id"],
                "decision": "execute",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/modeling-session/preprocessing_plan.json",
                    "mode": "analysis",
                },
            }
        )
        resumed_events = []
        while True:
            event = websocket.receive_json()
            resumed_events.append(event)
            if event["type"] == "task_progress" and event["label"] == "Prepared dataset for modeling":
                break

    resumed_event_types = [event["type"] for event in resumed_events]
    assert resumed_event_types[:2] == ["approval_resolved", "task_resumed"]
    assert "tool_started" in resumed_event_types
    assert "stage_completed" in resumed_event_types
    assert resumed_event_types[-1] == "task_progress"
    assert [
        event["component"] for event in resumed_events if event["type"] == "component_requested"
    ] == ["planned_dataset", "training_config"]
    resumed_artifact_paths = {
        event["artifact"]["path"]
        for event in resumed_events
        if event["type"] == "artifact_created"
    }
    assert {
        "results/modeling-session/customer_churn_planned.csv",
        "results/modeling-session/preprocessing_transform_report.json",
        "results/modeling-session/preprocessing_transform_report.md",
    }.issubset(resumed_artifact_paths)

    planned_dataset = (
        project_root / "results" / "modeling-session" / "customer_churn_planned.csv"
    ).read_text(encoding="utf-8")
    assert "customer_id" not in planned_dataset
    assert "monthly_charges" in planned_dataset
    assert "contract_" in planned_dataset
    assert "churn" in planned_dataset


def test_session_socket_revises_modeling_preparation_without_executing_plan(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "agent_revision_path"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "customer_id,age,monthly_charges,contract,churn",
                "c001,42,70.7,monthly,1",
                "c002,37,56.95,annual,0",
                "c003,55,90.0,monthly,1",
                "c004,29,,annual,0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/revision-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "Analyze this dataset and prepare it for modeling",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "approval_required":
                break

    approval = next(event for event in events if event["type"] == "approval_required")

    with client.websocket_connect("/ws/sessions/revision-session") as websocket:
        websocket.send_json(
            {
                "type": "approval_response",
                "approval_id": approval["approval_id"],
                "decision": "revise",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/revision-session/preprocessing_plan.json",
                    "mode": "analysis",
                },
            }
        )
        response_events = [websocket.receive_json(), websocket.receive_json()]

    assert [event["type"] for event in response_events] == ["approval_resolved", "step_failed"]
    assert response_events[0]["decision"] == "revise"
    assert response_events[1]["stage"] == "transform"
    assert response_events[1]["error"] == "Approval was not granted"
    assert not (project_root / "results" / "revision-session" / "customer_churn_planned.csv").exists()

    with client.websocket_connect("/ws/sessions/revision-session") as websocket:
        websocket.send_json(
            {
                "type": "approval_response",
                "approval_id": approval["approval_id"],
                "decision": "execute",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/revision-session/preprocessing_plan.json",
                    "mode": "analysis",
                },
            }
        )
        missing_event = websocket.receive_json()

    assert missing_event["type"] == "error"
    assert missing_event["code"] == "approval_not_found"


def test_session_socket_persists_and_resumes_failed_transform_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "agent_retry_path"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "customer_id,age,monthly_charges,contract,churn",
                "c001,42,70.7,monthly,1",
                "c002,37,56.95,annual,0",
                "c003,55,90.0,monthly,1",
                "c004,29,,annual,0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/retry-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "Analyze this dataset and prepare it for modeling",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "approval_required":
                break

    approval = next(event for event in events if event["type"] == "approval_required")
    plan_path = project_root / "results" / "retry-session" / "preprocessing_plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    plan["target_column"] = "missing_target"
    plan["steps"]["target"]["column"] = "missing_target"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    with client.websocket_connect("/ws/sessions/retry-session") as websocket:
        websocket.send_json(
            {
                "type": "approval_response",
                "approval_id": approval["approval_id"],
                "decision": "execute",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/retry-session/preprocessing_plan.json",
                    "mode": "analysis",
                },
            }
        )
        failed_events = []
        while True:
            event = websocket.receive_json()
            failed_events.append(event)
            if event["type"] == "task_progress" and event["label"] == "Preprocessing execution failed":
                break

    failed_step = next(event for event in failed_events if event["type"] == "step_failed")
    assert failed_step["stage"] == "transform"
    assert failed_step["retryable"] is True
    assert failed_step["resume_stage"] == "transform"
    assert failed_step["retry_count"] == 0
    assert "Target column" in failed_step["error"]
    assert not (project_root / "results" / "retry-session" / "customer_churn_planned.csv").exists()

    state_path = project_root / "sessions" / "retry-session" / "task_state" / "transform.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["status"] == "failed"
    assert state["active_file"] == "data/customer_churn.csv"
    assert state["plan_path"] == "results/retry-session/preprocessing_plan.json"
    assert state["retry_count"] == 0
    assert "Target column" in state["last_error"]
    assert state["repair_hint"].startswith("Fix the preprocessing plan")
    assert state["recovery_policy"]["resume_action"] == "Retry transform from the saved dataset and preprocessing plan."
    assert state["stale_artifact_paths"] == [
        "data/customer_churn.csv",
        "results/retry-session/preprocessing_plan.json",
    ]

    plan["target_column"] = "churn"
    plan["steps"]["target"]["column"] = "churn"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    with client.websocket_connect("/ws/sessions/retry-session") as websocket:
        websocket.send_json(
            {
                "type": "resume_step",
                "stage": "transform",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/retry-session/preprocessing_plan.json",
                    "mode": "analysis",
                },
            }
        )
        resumed_events = []
        while True:
            event = websocket.receive_json()
            resumed_events.append(event)
            if event["type"] == "task_progress" and event["label"] == "Prepared dataset for modeling":
                break

    assert resumed_events[0]["type"] == "task_resumed"
    assert resumed_events[0]["label"] == "Retrying transform step"
    assert resumed_events[0]["retry_count"] == 1
    assert "step_failed" not in [event["type"] for event in resumed_events]
    assert [
        event["component"] for event in resumed_events if event["type"] == "component_requested"
    ] == ["planned_dataset", "training_config"]
    assert (project_root / "results" / "retry-session" / "customer_churn_planned.csv").exists()
    assert not state_path.exists()


def test_session_socket_routes_continue_from_last_failure_to_task_state_inspector(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "continue_failure_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    write_task_state(
        project_root=project_root,
        session_id="continue-session",
        stage="train",
        payload={
            "status": "failed",
            "project_id": project["id"],
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "engine": "sklearn",
            "retry_count": 2,
            "last_error": "Target column was not found",
            "resume_action": "Retry the saved sklearn training request from durable task state.",
            "repair_hint": "Check the target column before retrying.",
            "stale_check": "Confirm the dataset is current.",
            "regenerate_action": "Regenerate preprocessing first.",
            "abandon_action": "Clear the saved training retry state.",
            "stale_artifact_paths": ["data/customer_churn.csv"],
        },
    )

    with client.websocket_connect("/ws/sessions/continue-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "continue from last failure",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/not-a-dataset.md",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] in {"task_progress", "error"}:
                break

    event_types = [event["type"] for event in events]
    assert event_types[:3] == ["tool_call_started", "step_failed", "component_requested"]
    failed_step = events[1]
    assert failed_step["stage"] == "train"
    assert failed_step["retryable"] is True
    assert failed_step["retry_count"] == 2
    assert failed_step["error"] == "Target column was not found"

    inspector_request = events[2]
    assert inspector_request["component"] == "task_state_inspector"
    assert inspector_request["stage"] == "train"
    assert inspector_request["props"]["resume_action"] == "Retry the saved sklearn training request from durable task state."
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "saved train failure" in streamed_text


def test_session_socket_abandons_latest_failed_task_state_from_intent(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "abandon_failure_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    service = SessionService(project_root)
    service.ensure_session(project_id=project["id"], session_id="abandon-session", mode="analysis")
    service.append_event(
        session_id="abandon-session",
        event_type="step_failed",
        payload={
            "type": "step_failed",
            "task_id": "abandon-session",
            "stage": "train",
            "label": "Training failed",
            "error": "Target column was not found",
        },
    )
    write_task_state(
        project_root=project_root,
        session_id="abandon-session",
        stage="train",
        payload={
            "status": "failed",
            "project_id": project["id"],
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "engine": "sklearn",
            "retry_count": 1,
            "last_error": "Target column was not found",
            "resume_action": "Retry the saved sklearn training request from durable task state.",
            "repair_hint": "Check the target column before retrying.",
            "stale_check": "Confirm the dataset is current.",
            "regenerate_action": "Regenerate preprocessing first.",
            "abandon_action": "Clear the saved training retry state.",
            "stale_artifact_paths": ["data/customer_churn.csv"],
        },
    )

    with client.websocket_connect("/ws/sessions/abandon-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "abandon last failure",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/not-a-dataset.md",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "step_completed",
        "tool_call_finished",
        "task_progress",
    ]
    completed = events[1]
    assert completed["stage"] == "train"
    assert completed["label"] == "Abandoned saved train failure state"
    assert events[2]["result_ref"] == "task_state/train"
    assert events[-1]["label"] == "Abandoned saved train failure state"
    assert client.get("/api/sessions/abandon-session/task-states").json()["items"] == []

    persisted_events = client.get("/api/sessions/abandon-session/events").json()["items"]
    persisted_types = [event["type"] for event in persisted_events]
    assert "step_failed" in persisted_types
    assert persisted_types[-3:] == ["step_completed", "tool_call_finished", "task_progress"]
    messages = client.get("/api/sessions/abandon-session/messages").json()["items"]
    user_message = next(message for message in messages if message["content"] == "abandon last failure")
    assert user_message["metadata"]["intent"] == "abandon_last_failure"
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "cleared the saved train failure" in streamed_text


def test_session_socket_routes_train_intent_to_training_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "train_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "age,monthly_charges,churn",
                "42,70.7,1",
                "37,56.95,0",
                "55,90.0,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/train-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "train sklearn on this dataset",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["task_id"] == "train-intent-session"
    assert command_event["command"] == {
        "intent": "train",
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": "csv-customer_churn",
        "target_column": "churn",
        "selected_run_id": None,
        "selected_artifacts": [],
        "missing_context": [],
        "risk_level": "medium",
        "planned_steps": ["train"],
        "proposed_tools": ["train_sklearn"],
        "approval_required": False,
        "component_requests": ["training_config"],
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": "csv-customer_churn",
        "target_column": "churn",
        "preprocessing_plan_path": None,
    }
    training_request = next(event for event in events if event["type"] == "component_requested")
    assert training_request["stage"] == "train"
    assert training_request["component"] == "training_config"
    assert training_request["artifact_path"] == "data/customer_churn.csv"
    assert training_request["props"] == {
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": "csv-customer_churn",
        "target_column": "churn",
        "preprocessing_plan_path": None,
        "engine": "sklearn",
        "source": "intent_router",
    }
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "sklearn training configuration" in streamed_text
    assert "`data/customer_churn.csv`" in streamed_text

    persisted_events = client.get("/api/sessions/train-intent-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]


def test_session_socket_train_intent_requests_dataset_selection_when_ambiguous(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "train_ambiguous_dataset_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "README.md").write_text("Choose a dataset before training.\n", encoding="utf-8")
    (project_root / "data").mkdir(exist_ok=True)
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "age,monthly_charges,churn",
                "42,70.7,1",
                "37,56.95,0",
                "55,90.0,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (project_root / "data" / "fraud.csv").write_text(
        "\n".join(
            [
                "amount,risk,label",
                "100,low,0",
                "999,high,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/train-ambiguous-dataset-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "train a sklearn model",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] in {"task_progress", "error"}:
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "tool_call_finished",
        "task_progress",
    ]
    assert not any(event["type"] == "component_requested" for event in events)
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "train",
        "dataset_path": None,
        "dataset_version_id": None,
        "target_column": None,
        "selected_run_id": None,
        "selected_artifacts": [],
        "missing_context": ["dataset_path"],
        "risk_level": "medium",
        "planned_steps": ["train"],
        "proposed_tools": ["train_sklearn"],
        "approval_required": True,
        "component_requests": ["training_config"],
        "candidate_datasets": [
            {
                "dataset_path": "data/customer_churn.csv",
                "dataset_version_id": "csv-customer_churn",
                "row_count": "3",
                "column_count": "3",
                "target_candidates": "churn, age, monthly_charges",
            },
            {
                "dataset_path": "data/fraud.csv",
                "dataset_version_id": "csv-fraud",
                "row_count": "2",
                "column_count": "3",
                "target_candidates": "label, amount, risk",
            },
        ],
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "active_file": "README.md",
        "candidate_datasets": command_event["command"]["candidate_datasets"],
    }
    assert events[-1]["label"] == "Waiting for dataset selection"
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "multiple candidate datasets" in streamed_text
    assert "data/customer_churn.csv" in streamed_text
    persisted_events = client.get("/api/sessions/train-ambiguous-dataset-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]

    with client.websocket_connect("/ws/sessions/train-ambiguous-dataset-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "train on data/customer_churn.csv",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "training_dataset_path": "data/customer_churn.csv",
                    "mode": "machine-learning",
                },
            }
        )
        selected_events = []
        while True:
            event = websocket.receive_json()
            selected_events.append(event)
            if event["type"] == "task_progress":
                break

    selected_non_delta_types = [event["type"] for event in selected_events if event["type"] != "message_delta"]
    assert selected_non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    selected_command = next(event for event in selected_events if event["type"] == "agent_command")
    assert selected_command["command"]["missing_context"] == []
    assert selected_command["command"]["dataset_path"] == "data/customer_churn.csv"
    assert selected_command["command"]["dataset_version_id"] == "csv-customer_churn"
    assert selected_command["command"]["target_column"] == "churn"
    assert selected_command["resolved_context"]["dataset_version_id"] == "csv-customer_churn"
    selected_component = next(event for event in selected_events if event["type"] == "component_requested")
    assert selected_component["component"] == "training_config"
    assert selected_component["props"]["dataset_path"] == "data/customer_churn.csv"
    assert selected_component["props"]["dataset_version_id"] == "csv-customer_churn"
    assert selected_component["props"]["target_column"] == "churn"
    assert selected_events[-1]["label"] == "Training configuration ready"


def test_session_socket_train_intent_uses_preprocessing_plan_context(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "train_plan_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "age,monthly_charges,churn",
                "42,70.7,1",
                "37,56.95,0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    plan_path = project_root / "results" / "train-plan-session" / "preprocessing_plan.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(
        json.dumps(
            {
                "dataset_path": "data/customer_churn.csv",
                "output_dataset_path": "results/train-plan-session/customer_churn_planned.csv",
                "target_column": "churn",
                "feature_columns": ["age", "monthly_charges"],
                "drop_columns": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/train-plan-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "start sklearn training from this plan",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/train-plan-session/preprocessing_plan.json",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"]["selected_artifacts"] == ["results/train-plan-session/preprocessing_plan.json"]
    assert command_event["command"]["missing_context"] == []
    assert command_event["resolved_context"]["preprocessing_plan_path"] == "results/train-plan-session/preprocessing_plan.json"
    training_request = next(event for event in events if event["type"] == "component_requested")
    assert training_request["component"] == "training_config"
    assert training_request["artifact_path"] == "data/customer_churn.csv"
    assert training_request["props"]["dataset_path"] == "data/customer_churn.csv"
    assert training_request["props"]["target_column"] == "churn"
    assert training_request["props"]["preprocessing_plan_path"] == "results/train-plan-session/preprocessing_plan.json"


def test_session_socket_routes_profile_intent_to_data_quality_component(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "profile_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "age,monthly_charges,churn",
                "42,70.7,1",
                "37,56.95,0",
                "55,90.0,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/profile-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "profile this dataset and show quality warnings",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "rules_matched",
        "stage_started",
        "tool_started",
        "artifact_created",
        "tool_call_finished",
        "stage_completed",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    profile_request = next(event for event in events if event["type"] == "component_requested")
    assert profile_request["stage"] == "profile"
    assert profile_request["component"] == "data_quality"
    assert profile_request["artifact_path"] == "results/profile-intent-session/data_quality_profile.json"
    assert profile_request["props"] == {
        "dataset_path": "data/customer_churn.csv",
        "profile_path": "results/profile-intent-session/data_quality_profile.json",
        "row_count": 3,
        "column_count": 3,
        "target_candidates": ["churn", "age", "monthly_charges"],
        "source": "intent_router",
    }
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "data quality profile" in streamed_text
    assert "`data/customer_churn.csv`" in streamed_text


def test_session_socket_routes_ingest_intent_to_dataset_summary_component(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "ingest_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "customer_id,age,monthly_charges,churn",
                "c001,42,70.7,1",
                "c002,37,56.95,0",
                "c003,55,90.0,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/ingest-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "ingest and register this dataset",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "tool_started",
        "artifact_created",
        "tool_call_finished",
        "stage_completed",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    artifact = next(event["artifact"] for event in events if event["type"] == "artifact_created")
    assert artifact["path"] == "results/ingest-intent-session/dataset_registry_entry.json"
    assert artifact["metadata"]["artifact_role"] == "dataset_registry_entry"
    assert artifact["metadata"]["dataset_path"] == "data/customer_churn.csv"
    assert artifact["metadata"]["row_count"] == 3
    assert artifact["metadata"]["column_count"] == 4

    dataset_request = next(event for event in events if event["type"] == "component_requested")
    assert dataset_request["stage"] == "ingest"
    assert dataset_request["component"] == "dataset_summary"
    assert dataset_request["artifact_path"] == "results/ingest-intent-session/dataset_registry_entry.json"
    assert dataset_request["props"] == {
        "dataset_path": "data/customer_churn.csv",
        "registry_path": "results/ingest-intent-session/dataset_registry_entry.json",
        "dataset_version_id": "csv-customer_churn-ingest-intent-session",
        "row_count": 3,
        "column_count": 4,
        "columns": ["customer_id", "age", "monthly_charges", "churn"],
        "sample_strategy": "full_csv_scan",
        "source": "intent_router",
    }
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "registered dataset" in streamed_text
    assert "`data/customer_churn.csv`" in streamed_text


def test_session_socket_routes_clean_intent_to_quality_review_and_plan_request(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "clean_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "age,monthly_charges,churn",
                "42,70.7,1",
                ",56.95,0",
                "55,,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/clean-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "clean this dataset and propose safe fixes",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    component_requests = [event for event in events if event["type"] == "component_requested"]
    assert [event["component"] for event in component_requests] == ["data_quality", "preprocessing_plan"]
    assert component_requests[0]["stage"] == "clean"
    assert component_requests[0]["artifact_path"] == "results/clean-intent-session/data_quality_profile.json"
    assert component_requests[1]["stage"] == "clean"
    assert component_requests[1]["artifact_path"] is None
    assert component_requests[1]["props"]["dataset_path"] == "data/customer_churn.csv"
    assert component_requests[1]["props"]["profile_path"] == "results/clean-intent-session/data_quality_profile.json"
    assert component_requests[1]["props"]["required_confirmation"] is True
    assert component_requests[1]["props"]["planned_actions"] == [
        "Review missing values, duplicate rows, and suspicious identifiers.",
        "Generate a preprocessing plan before modifying any dataset.",
        "Approve the transform only after inspecting the proposed drops, imputers, encoders, and output path.",
    ]
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "quality review" in streamed_text
    assert "Generate Plan" in streamed_text


def test_session_socket_routes_transform_intent_to_preprocessing_approval(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "transform_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "\n".join(
            [
                "customer_id,age,monthly_charges,churn",
                "a,42,70.7,1",
                "b,37,56.95,0",
                "c,55,90.0,1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/transform-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "transform these features with a preprocessing plan",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/customer_churn.csv",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "rules_matched",
        "stage_started",
        "tool_started",
        "artifact_created",
        "artifact_created",
        "tool_call_finished",
        "approval_required",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    approval = next(event for event in events if event["type"] == "approval_required")
    assert approval["stage"] == "transform"
    assert approval["artifact_path"] == "results/transform-intent-session/preprocessing_plan.json"
    assert approval["options"] == ["execute", "revise"]
    transform_request = next(event for event in events if event["type"] == "component_requested")
    assert transform_request["stage"] == "transform"
    assert transform_request["component"] == "preprocessing_plan"
    assert transform_request["artifact_path"] == "results/transform-intent-session/preprocessing_plan.json"
    assert transform_request["props"]["dataset_path"] == "data/customer_churn.csv"
    assert transform_request["props"]["target_column"] == "churn"
    assert transform_request["props"]["required_confirmation"] is True
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "preprocessing plan" in streamed_text
    assert "paused before executing" in streamed_text


def test_session_socket_routes_evaluate_intent_to_report_components(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "evaluate_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    ExperimentService(project_root).record_run(
        project_id=project["id"],
        experiment_id="exp-eval-intent",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.91, "f1_weighted": 0.9},
        model={"algorithm": "logistic_regression"},
        candidate_runs=[
            {
                "model_name": "logistic_regression",
                "metrics": {"accuracy": 0.91, "f1_weighted": 0.9},
            }
        ],
        model_artifact={"type": "model", "name": "model.json", "path": "models/exp-eval-intent.json"},
        metrics_artifact={
            "id": "metrics-exp-eval-intent",
            "type": "training",
            "name": "metrics.json",
            "path": "results/eval-intent/metrics.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-exp-eval-intent",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/eval-intent/model_evaluation_report.md",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "samples-exp-eval-intent",
            "type": "dataframe",
            "name": "prediction_samples.json",
            "path": "results/eval-intent/prediction_samples.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/evaluate-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "evaluate this model and show the report",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/eval-intent/model_evaluation_report.md",
                    "experiment_id": "exp-eval-intent",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "evaluate",
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": None,
        "target_column": "churn",
        "selected_run_id": "exp-eval-intent",
        "selected_artifacts": [
            "results/eval-intent/metrics.json",
            "models/exp-eval-intent.json",
            "results/eval-intent/model_evaluation_report.md",
            "results/eval-intent/prediction_samples.json",
        ],
        "missing_context": [],
        "risk_level": "low",
        "planned_steps": ["evaluate"],
        "proposed_tools": ["model_comparison", "evaluation_report"],
        "approval_required": False,
        "component_requests": ["model_comparison", "evaluation_report"],
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "experiment_id": "exp-eval-intent",
        "dataset_path": "data/customer_churn.csv",
        "target_column": "churn",
        "metrics_path": "results/eval-intent/metrics.json",
        "model_path": "models/exp-eval-intent.json",
        "evaluation_report_path": "results/eval-intent/model_evaluation_report.md",
        "prediction_samples_path": "results/eval-intent/prediction_samples.json",
        "preprocessing_plan_path": None,
    }
    component_requests = [event for event in events if event["type"] == "component_requested"]
    assert [event["component"] for event in component_requests] == ["model_comparison", "evaluation_report"]
    assert component_requests[0]["artifact_path"] == "results/eval-intent/metrics.json"
    assert component_requests[1]["artifact_path"] == "results/eval-intent/model_evaluation_report.md"
    assert component_requests[0]["props"] == {
        "experiment_id": "exp-eval-intent",
        "dataset_path": "data/customer_churn.csv",
        "target_column": "churn",
        "engine": "sklearn",
        "best_model_name": "sklearn",
        "metrics_path": "results/eval-intent/metrics.json",
        "model_path": "models/exp-eval-intent.json",
        "evaluation_report_path": "results/eval-intent/model_evaluation_report.md",
        "prediction_samples_path": "results/eval-intent/prediction_samples.json",
        "preprocessing_plan_path": None,
        "source": "intent_router",
    }
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "experiment `exp-eval-intent`" in streamed_text
    assert "evaluation report `results/eval-intent/model_evaluation_report.md` is ready" in streamed_text
    persisted_events = client.get("/api/sessions/evaluate-intent-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]
    assert persisted_command["resolved_context"] == command_event["resolved_context"]


def test_session_socket_evaluate_intent_uses_latest_completed_run(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "evaluate_latest_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    service = ExperimentService(project_root)
    service.record_run(
        project_id=project["id"],
        experiment_id="old-run",
        engine="baseline",
        dataset_path="data/old.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.7},
        model={"strategy": "majority"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "old.json", "path": "models/old.json"},
        metrics_artifact={
            "id": "old-metrics",
            "type": "training",
            "name": "old_metrics.json",
            "path": "results/old/metrics.json",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
    )
    service.record_run(
        project_id=project["id"],
        experiment_id="latest-run",
        engine="sklearn",
        dataset_path="data/latest.csv",
        target_column="target",
        use_gpu=False,
        metrics={"accuracy": 0.95},
        model={"algorithm": "random_forest"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "latest.json", "path": "models/latest.json"},
        metrics_artifact={
            "id": "latest-metrics",
            "type": "training",
            "name": "latest_metrics.json",
            "path": "results/latest/metrics.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/evaluate-latest-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "evaluate the latest model",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/latest.csv",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    comparison_request = next(
        event for event in events if event["type"] == "component_requested" and event["component"] == "model_comparison"
    )
    assert comparison_request["props"]["experiment_id"] == "latest-run"
    assert comparison_request["props"]["dataset_path"] == "data/latest.csv"
    assert comparison_request["props"]["evaluation_report_path"] is None


def test_session_socket_evaluate_intent_requests_run_selection_when_ambiguous(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "evaluate_ambiguous_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    service = ExperimentService(project_root)
    service.record_run(
        project_id=project["id"],
        experiment_id="candidate-a",
        engine="baseline",
        dataset_path="data/a.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.7},
        model={"strategy": "majority"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "a.json", "path": "models/a.json"},
        metrics_artifact={
            "id": "a-metrics",
            "type": "training",
            "name": "a_metrics.json",
            "path": "results/a/metrics.json",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
    )
    service.record_run(
        project_id=project["id"],
        experiment_id="candidate-b",
        engine="sklearn",
        dataset_path="data/b.csv",
        target_column="target",
        use_gpu=False,
        metrics={"accuracy": 0.95},
        model={"algorithm": "random_forest"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "b.json", "path": "models/b.json"},
        metrics_artifact={
            "id": "b-metrics",
            "type": "training",
            "name": "b_metrics.json",
            "path": "results/b/metrics.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/evaluate-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "evaluate this model and show the report",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "tool_call_finished",
        "task_progress",
    ]
    assert not any(event["type"] == "component_requested" for event in events)
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "evaluate",
        "dataset_path": None,
        "dataset_version_id": None,
        "target_column": None,
        "selected_run_id": None,
        "selected_artifacts": [],
        "missing_context": ["experiment_id"],
        "risk_level": "medium",
        "planned_steps": ["evaluate"],
        "proposed_tools": ["model_comparison", "evaluation_report"],
        "approval_required": True,
        "component_requests": ["model_comparison", "evaluation_report"],
        "candidate_runs": [
            {
                "experiment_id": "candidate-b",
                "dataset_path": "data/b.csv",
                "target_column": "target",
                "best_model_name": "sklearn",
            },
            {
                "experiment_id": "candidate-a",
                "dataset_path": "data/a.csv",
                "target_column": "churn",
                "best_model_name": "baseline",
            },
        ],
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "active_file": "README.md",
        "candidate_runs": command_event["command"]["candidate_runs"],
    }
    assert events[-1]["label"] == "Waiting for experiment run selection"
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "multiple completed experiment runs" in streamed_text
    persisted_events = client.get("/api/sessions/evaluate-ambiguous-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]
    assert persisted_command["resolved_context"] == command_event["resolved_context"]

    with client.websocket_connect("/ws/sessions/evaluate-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "evaluate experiment candidate-b",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "experiment_id": "candidate-b",
                    "mode": "machine-learning",
                },
            }
        )
        selected_events = []
        while True:
            event = websocket.receive_json()
            selected_events.append(event)
            if event["type"] == "task_progress":
                break

    selected_non_delta_types = [event["type"] for event in selected_events if event["type"] != "message_delta"]
    assert selected_non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    selected_command = next(event for event in selected_events if event["type"] == "agent_command")
    assert selected_command["command"]["intent"] == "evaluate"
    assert selected_command["command"]["selected_run_id"] == "candidate-b"
    assert selected_command["command"]["missing_context"] == []
    assert selected_command["resolved_context"]["experiment_id"] == "candidate-b"
    selected_components = [event for event in selected_events if event["type"] == "component_requested"]
    assert [event["component"] for event in selected_components] == ["model_comparison", "evaluation_report"]
    assert selected_components[0]["props"]["experiment_id"] == "candidate-b"
    assert selected_components[0]["props"]["dataset_path"] == "data/b.csv"
    assert selected_events[-1]["label"] == "Evaluation context ready"


def _seed_ambiguous_evaluation_runs(project_root: Path, project_id: str) -> None:
    service = ExperimentService(project_root)
    service.record_run(
        project_id=project_id,
        experiment_id="candidate-a",
        engine="baseline",
        dataset_path="data/a.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.7},
        model={"strategy": "majority"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "a.json", "path": "models/a.json"},
        metrics_artifact={
            "id": "a-metrics",
            "type": "training",
            "name": "a_metrics.json",
            "path": "results/a/metrics.json",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "a-report",
            "type": "report",
            "name": "a_report.md",
            "path": "results/a/model_evaluation_report.md",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "a-samples",
            "type": "dataframe",
            "name": "a_samples.json",
            "path": "results/a/prediction_samples.json",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
    )
    service.record_run(
        project_id=project_id,
        experiment_id="candidate-b",
        engine="sklearn",
        dataset_path="data/b.csv",
        target_column="target",
        use_gpu=False,
        metrics={
            "accuracy": 0.95,
            "f1_weighted": 0.94,
            "confusion_matrix": {
                "no": {"no": 8, "yes": 1},
                "yes": {"no": 4, "yes": 3},
            },
        },
        model={"algorithm": "random_forest"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "b.json", "path": "models/b.json"},
        metrics_artifact={
            "id": "b-metrics",
            "type": "training",
            "name": "b_metrics.json",
            "path": "results/b/metrics.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "b-report",
            "type": "report",
            "name": "b_report.md",
            "path": "results/b/model_evaluation_report.md",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "b-samples",
            "type": "dataframe",
            "name": "b_samples.json",
            "path": "results/b/prediction_samples.json",
            "created_at": "2026-06-03T00:00:00+00:00",
        },
    )


def test_session_socket_diagnose_intent_continues_after_ambiguous_run_selection(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "diagnose_ambiguous_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    _seed_ambiguous_evaluation_runs(project_root, project["id"])

    with client.websocket_connect("/ws/sessions/diagnose-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "diagnose why recall is poor and show prediction samples",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "tool_call_finished",
        "task_progress",
    ]
    assert not any(event["type"] == "component_requested" for event in events)
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"]["intent"] == "diagnose"
    assert command_event["command"]["missing_context"] == ["experiment_id"]
    assert command_event["command"]["component_requests"] == ["error_analysis", "prediction_samples"]
    assert command_event["command"]["candidate_runs"][0]["experiment_id"] == "candidate-b"
    assert command_event["command"]["candidate_runs"][1]["experiment_id"] == "candidate-a"
    assert events[-1]["label"] == "Waiting for experiment run selection"
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "multiple completed experiment runs" in streamed_text

    with client.websocket_connect("/ws/sessions/diagnose-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "diagnose experiment candidate-b",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "experiment_id": "candidate-b",
                    "mode": "machine-learning",
                },
            }
        )
        selected_events = []
        while True:
            event = websocket.receive_json()
            selected_events.append(event)
            if event["type"] == "task_progress":
                break

    selected_non_delta_types = [event["type"] for event in selected_events if event["type"] != "message_delta"]
    assert selected_non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    selected_command = next(event for event in selected_events if event["type"] == "agent_command")
    assert selected_command["command"]["intent"] == "diagnose"
    assert selected_command["command"]["selected_run_id"] == "candidate-b"
    assert selected_command["command"]["missing_context"] == []
    assert selected_command["resolved_context"]["experiment_id"] == "candidate-b"
    selected_components = [event for event in selected_events if event["type"] == "component_requested"]
    assert [event["component"] for event in selected_components] == ["error_analysis", "prediction_samples"]
    assert selected_components[0]["props"]["experiment_id"] == "candidate-b"
    assert selected_components[0]["props"]["dataset_path"] == "data/b.csv"
    assert selected_components[0]["props"]["worst_class"] == "yes"
    assert selected_components[1]["props"]["prediction_samples_path"] == "results/b/prediction_samples.json"
    assert selected_events[-1]["label"] == "Diagnosis context ready"


def test_session_socket_export_intent_continues_after_ambiguous_run_selection(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "export_ambiguous_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    _seed_ambiguous_evaluation_runs(project_root, project["id"])

    with client.websocket_connect("/ws/sessions/export-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "export the final report and handoff bundle",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "tool_call_finished",
        "task_progress",
    ]
    assert not any(event["type"] == "component_requested" for event in events)
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"]["intent"] == "export"
    assert command_event["command"]["missing_context"] == ["experiment_id"]
    assert command_event["command"]["component_requests"] == ["evaluation_report", "export_bundle"]
    assert command_event["command"]["candidate_runs"][0]["experiment_id"] == "candidate-b"
    assert command_event["command"]["candidate_runs"][1]["experiment_id"] == "candidate-a"
    assert events[-1]["label"] == "Waiting for experiment run selection"

    with client.websocket_connect("/ws/sessions/export-ambiguous-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "export experiment candidate-b",
                "context": {
                    "project_id": project["id"],
                    "active_file": "README.md",
                    "experiment_id": "candidate-b",
                    "mode": "machine-learning",
                },
            }
        )
        selected_events = []
        while True:
            event = websocket.receive_json()
            selected_events.append(event)
            if event["type"] == "task_progress":
                break

    selected_non_delta_types = [event["type"] for event in selected_events if event["type"] != "message_delta"]
    assert selected_non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    selected_command = next(event for event in selected_events if event["type"] == "agent_command")
    assert selected_command["command"]["intent"] == "export"
    assert selected_command["command"]["selected_run_id"] == "candidate-b"
    assert selected_command["command"]["missing_context"] == []
    assert selected_command["resolved_context"]["experiment_id"] == "candidate-b"
    selected_components = [event for event in selected_events if event["type"] == "component_requested"]
    assert [event["component"] for event in selected_components] == ["evaluation_report", "export_bundle"]
    assert selected_components[0]["props"]["experiment_id"] == "candidate-b"
    assert selected_components[0]["props"]["evaluation_report_path"] == "results/b/model_evaluation_report.md"
    assert selected_components[1]["props"]["dataset_path"] == "data/b.csv"
    assert selected_events[-1]["label"] == "Export context ready"


def test_session_socket_routes_diagnose_intent_to_error_and_sample_components(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "diagnose_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    ExperimentService(project_root).record_run(
        project_id=project["id"],
        experiment_id="exp-diagnose-intent",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={
            "accuracy": 0.75,
            "f1_weighted": 0.73,
            "confusion_matrix": {
                "no": {"no": 8, "yes": 1},
                "yes": {"no": 4, "yes": 3},
            },
        },
        model={"algorithm": "logistic_regression"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "model.json", "path": "models/exp-diagnose-intent.json"},
        metrics_artifact={
            "id": "metrics-exp-diagnose-intent",
            "type": "training",
            "name": "metrics.json",
            "path": "results/diagnose-intent/metrics.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-exp-diagnose-intent",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/diagnose-intent/model_evaluation_report.md",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "samples-exp-diagnose-intent",
            "type": "dataframe",
            "name": "prediction_samples.json",
            "path": "results/diagnose-intent/prediction_samples.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/diagnose-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "diagnose why recall is poor and show error samples",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/diagnose-intent/model_evaluation_report.md",
                    "experiment_id": "exp-diagnose-intent",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "diagnose",
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": None,
        "target_column": "churn",
        "selected_run_id": "exp-diagnose-intent",
        "selected_artifacts": [
            "results/diagnose-intent/metrics.json",
            "models/exp-diagnose-intent.json",
            "results/diagnose-intent/model_evaluation_report.md",
            "results/diagnose-intent/prediction_samples.json",
        ],
        "missing_context": [],
        "risk_level": "low",
        "planned_steps": ["diagnose"],
        "proposed_tools": ["error_analysis", "prediction_samples"],
        "approval_required": False,
        "component_requests": ["error_analysis", "prediction_samples"],
        "diagnosis_summary": {
            "worst_class": "yes",
            "main_confusion": "yes -> no",
            "error_count": 5,
            "recommendation": "Inspect yes prediction samples, then review features or preprocessing for this class.",
        },
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "experiment_id": "exp-diagnose-intent",
        "dataset_path": "data/customer_churn.csv",
        "target_column": "churn",
        "metrics_path": "results/diagnose-intent/metrics.json",
        "model_path": "models/exp-diagnose-intent.json",
        "evaluation_report_path": "results/diagnose-intent/model_evaluation_report.md",
        "prediction_samples_path": "results/diagnose-intent/prediction_samples.json",
        "preprocessing_plan_path": None,
        "worst_class": "yes",
        "main_confusion": "yes -> no",
        "error_count": 5,
        "recommendation": "Inspect yes prediction samples, then review features or preprocessing for this class.",
    }
    component_requests = [event for event in events if event["type"] == "component_requested"]
    assert [event["component"] for event in component_requests] == ["error_analysis", "prediction_samples"]
    assert component_requests[0]["artifact_path"] == "results/diagnose-intent/metrics.json"
    assert component_requests[1]["artifact_path"] == "results/diagnose-intent/prediction_samples.json"
    props = component_requests[0]["props"]
    assert props["experiment_id"] == "exp-diagnose-intent"
    assert props["dataset_path"] == "data/customer_churn.csv"
    assert props["target_column"] == "churn"
    assert props["metrics_path"] == "results/diagnose-intent/metrics.json"
    assert props["evaluation_report_path"] == "results/diagnose-intent/model_evaluation_report.md"
    assert props["prediction_samples_path"] == "results/diagnose-intent/prediction_samples.json"
    assert props["worst_class"] == "yes"
    assert props["main_confusion"] == "yes -> no"
    assert props["error_count"] == 5
    assert props["error_slices"][0]["label"] == "yes"
    assert props["error_slices"][0]["errors"] == 4
    assert props["recommendation"] == "Inspect yes prediction samples, then review features or preprocessing for this class."
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "experiment `exp-diagnose-intent`" in streamed_text
    assert "highest-error class is `yes`" in streamed_text
    persisted_events = client.get("/api/sessions/diagnose-intent-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]
    assert persisted_command["resolved_context"] == command_event["resolved_context"]


def test_session_socket_diagnose_intent_uses_latest_completed_run(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "diagnose_latest_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    service = ExperimentService(project_root)
    service.record_run(
        project_id=project["id"],
        experiment_id="old-diagnose-run",
        engine="baseline",
        dataset_path="data/old.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.7, "confusion_matrix": {"no": {"no": 1}}},
        model={"strategy": "majority"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "old.json", "path": "models/old.json"},
        metrics_artifact={
            "id": "old-diagnose-metrics",
            "type": "training",
            "name": "old_metrics.json",
            "path": "results/old/metrics.json",
            "created_at": "2026-06-02T00:00:00+00:00",
        },
    )
    service.record_run(
        project_id=project["id"],
        experiment_id="latest-diagnose-run",
        engine="sklearn",
        dataset_path="data/latest.csv",
        target_column="target",
        use_gpu=False,
        metrics={"accuracy": 0.9, "confusion_matrix": {"yes": {"yes": 2, "no": 1}}},
        model={"algorithm": "random_forest"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "latest.json", "path": "models/latest.json"},
        metrics_artifact={
            "id": "latest-diagnose-metrics",
            "type": "training",
            "name": "latest_metrics.json",
            "path": "results/latest/metrics.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/diagnose-latest-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "show prediction samples and confusion matrix",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/latest.csv",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    diagnosis_request = next(
        event for event in events if event["type"] == "component_requested" and event["component"] == "error_analysis"
    )
    assert diagnosis_request["props"]["experiment_id"] == "latest-diagnose-run"
    assert diagnosis_request["props"]["dataset_path"] == "data/latest.csv"
    assert diagnosis_request["props"]["worst_class"] == "yes"


def test_session_socket_routes_iterate_intent_to_iteration_proposal(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "iterate_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    ExperimentService(project_root).record_run(
        project_id=project["id"],
        experiment_id="exp-iterate-intent",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={
            "accuracy": 0.75,
            "f1_weighted": 0.73,
            "confusion_matrix": {
                "no": {"no": 8, "yes": 1},
                "yes": {"no": 4, "yes": 3},
            },
        },
        model={"algorithm": "logistic_regression"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "model.json", "path": "models/exp-iterate-intent.json"},
        metrics_artifact={
            "id": "metrics-exp-iterate-intent",
            "type": "training",
            "name": "metrics.json",
            "path": "results/iterate-intent/metrics.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-exp-iterate-intent",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/iterate-intent/model_evaluation_report.md",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "samples-exp-iterate-intent",
            "type": "dataframe",
            "name": "prediction_samples.json",
            "path": "results/iterate-intent/prediction_samples.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
    )

    with client.websocket_connect("/ws/sessions/iterate-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "iterate on this model and improve recall with a safer retrain plan",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/iterate-intent/model_evaluation_report.md",
                    "experiment_id": "exp-iterate-intent",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    iterate_request = next(event for event in events if event["type"] == "component_requested")
    assert iterate_request["stage"] == "iterate"
    assert iterate_request["component"] == "iteration_proposal"
    assert iterate_request["artifact_path"] == "results/iterate-intent/metrics.json"
    props = iterate_request["props"]
    assert props["experiment_id"] == "exp-iterate-intent"
    assert props["dataset_path"] == "data/customer_churn.csv"
    assert props["target_column"] == "churn"
    assert props["metrics_path"] == "results/iterate-intent/metrics.json"
    assert props["evaluation_report_path"] == "results/iterate-intent/model_evaluation_report.md"
    assert props["prediction_samples_path"] == "results/iterate-intent/prediction_samples.json"
    assert props["worst_class"] == "yes"
    assert props["main_confusion"] == "yes -> no"
    assert props["required_confirmation"] is True
    assert props["next_actions"] == [
        "Inspect prediction samples for the highest-error class.",
        "Revise preprocessing or feature selection before rerunning training.",
        "Start a follow-up sklearn run only after reviewing the proposed changes.",
    ]
    assert not any(
        event["type"] == "component_requested" and event["component"] == "training_config"
        for event in events
    )
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "iteration proposal" in streamed_text
    assert "exp-iterate-intent" in streamed_text


def test_session_socket_routes_export_intent_to_report_and_bundle_components(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "export_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    service = ExperimentService(project_root)
    service.record_run(
        project_id=project["id"],
        experiment_id="exp-export-intent",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.91, "f1_weighted": 0.9},
        model={"algorithm": "logistic_regression"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "model.json", "path": "models/exp-export-intent.json"},
        metrics_artifact={
            "id": "metrics-exp-export-intent",
            "type": "training",
            "name": "metrics.json",
            "path": "results/export-intent/metrics.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-exp-export-intent",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/export-intent/model_evaluation_report.md",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "samples-exp-export-intent",
            "type": "dataframe",
            "name": "prediction_samples.json",
            "path": "results/export-intent/prediction_samples.json",
            "created_at": "2026-06-04T00:00:00+00:00",
        },
    )
    service.update_run(
        "exp-export-intent",
        {
            "export_bundle_artifact": {
                "id": "bundle-exp-export-intent",
                "type": "archive",
                "name": "exp-export-intent_handoff_bundle.zip",
                "path": "exports/export-intent/exp-export-intent_handoff_bundle.zip",
                "created_at": "2026-06-04T00:00:00+00:00",
            }
        },
    )

    with client.websocket_connect("/ws/sessions/export-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "export the final report and handoff bundle",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/export-intent/model_evaluation_report.md",
                    "experiment_id": "exp-export-intent",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "export",
        "dataset_path": "data/customer_churn.csv",
        "dataset_version_id": None,
        "target_column": "churn",
        "selected_run_id": "exp-export-intent",
        "selected_artifacts": [
            "results/export-intent/metrics.json",
            "models/exp-export-intent.json",
            "results/export-intent/model_evaluation_report.md",
            "results/export-intent/prediction_samples.json",
            "exports/export-intent/exp-export-intent_handoff_bundle.zip",
        ],
        "missing_context": [],
        "risk_level": "medium",
        "planned_steps": ["export"],
        "proposed_tools": ["evaluation_report", "export_bundle"],
        "approval_required": False,
        "component_requests": ["evaluation_report", "export_bundle"],
        "bundle_ready": True,
        "missing_required_artifacts": [],
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "experiment_id": "exp-export-intent",
        "dataset_path": "data/customer_churn.csv",
        "target_column": "churn",
        "metrics_path": "results/export-intent/metrics.json",
        "model_path": "models/exp-export-intent.json",
        "evaluation_report_path": "results/export-intent/model_evaluation_report.md",
        "prediction_samples_path": "results/export-intent/prediction_samples.json",
        "preprocessing_plan_path": None,
        "export_bundle_path": "exports/export-intent/exp-export-intent_handoff_bundle.zip",
        "bundle_ready": True,
        "missing_required_artifacts": [],
    }
    component_requests = [event for event in events if event["type"] == "component_requested"]
    assert [event["component"] for event in component_requests] == ["evaluation_report", "export_bundle"]
    assert component_requests[0]["stage"] == "export"
    assert component_requests[0]["artifact_path"] == "results/export-intent/model_evaluation_report.md"
    assert component_requests[1]["artifact_path"] == "exports/export-intent/exp-export-intent_handoff_bundle.zip"
    props = component_requests[1]["props"]
    assert props["experiment_id"] == "exp-export-intent"
    assert props["dataset_path"] == "data/customer_churn.csv"
    assert props["target_column"] == "churn"
    assert props["metrics_path"] == "results/export-intent/metrics.json"
    assert props["model_path"] == "models/exp-export-intent.json"
    assert props["evaluation_report_path"] == "results/export-intent/model_evaluation_report.md"
    assert props["prediction_samples_path"] == "results/export-intent/prediction_samples.json"
    assert props["export_bundle_path"] == "exports/export-intent/exp-export-intent_handoff_bundle.zip"
    assert props["bundle_ready"] is True
    assert props["missing_required_artifacts"] == []
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "experiment `exp-export-intent`" in streamed_text
    assert "All required artifacts are present" in streamed_text
    persisted_events = client.get("/api/sessions/export-intent-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]
    assert persisted_command["resolved_context"] == command_event["resolved_context"]


def test_session_socket_routes_learn_intent_to_lesson_review_component(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "learn_intent_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    SessionService(project_root).ensure_session(
        project_id=project["id"],
        session_id="learn-intent-session",
        mode="machine-learning",
    )
    missing_path = project_root / "results" / "learn-intent" / "missing.json"
    missing_path.parent.mkdir(parents=True, exist_ok=True)
    missing_path.write_text(
        json.dumps({"columns": {"age": {"missing_ratio": 0.02}}}, ensure_ascii=False),
        encoding="utf-8",
    )
    SessionService(project_root).append_event(
        session_id="learn-intent-session",
        event_type="artifact_created",
        payload={
            "type": "artifact_created",
            "artifact": {
                "name": "missing.json",
                "path": "results/learn-intent/missing.json",
                "metadata": {
                    "dataset_path": "data/customer_churn.csv",
                    "missing_summary": {"age": 0.02},
                },
            },
        },
    )

    with client.websocket_connect("/ws/sessions/learn-intent-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "extract lessons and propose learned rules",
                "context": {
                    "project_id": project["id"],
                    "active_file": "results/learn-intent/missing.json",
                    "mode": "machine-learning",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    non_delta_types = [event["type"] for event in events if event["type"] != "message_delta"]
    assert non_delta_types == [
        "tool_call_started",
        "stage_started",
        "agent_command",
        "component_requested",
        "tool_call_finished",
        "task_progress",
    ]
    command_event = next(event for event in events if event["type"] == "agent_command")
    assert command_event["command"] == {
        "intent": "learn",
        "dataset_path": None,
        "dataset_version_id": None,
        "target_column": None,
        "selected_run_id": None,
        "selected_artifacts": ["results/learn-intent/missing.json"],
        "missing_context": [],
        "risk_level": "high",
        "planned_steps": ["learn"],
        "proposed_tools": ["lesson_review"],
        "approval_required": True,
        "component_requests": ["lesson_review"],
        "source_session_id": "learn-intent-session",
        "source_event_count": 1,
        "candidate_count": 1,
        "high_confidence_count": 0,
        "has_extractable_candidates": True,
    }
    assert command_event["resolved_context"] == {
        "project_id": project["id"],
        "mode": "machine-learning",
        "source_session_id": "learn-intent-session",
        "source_event_count": 1,
        "candidate_count": 1,
        "high_confidence_count": 0,
        "latest_event_type": "artifact_created",
        "source_artifacts": ["results/learn-intent/missing.json"],
        "has_extractable_candidates": True,
    }
    lesson_request = next(event for event in events if event["type"] == "component_requested")
    assert lesson_request["stage"] == "learn"
    assert lesson_request["component"] == "lesson_review"
    assert lesson_request["artifact_path"] == "results/learn-intent/missing.json"
    props = lesson_request["props"]
    assert props["source_session_id"] == "learn-intent-session"
    assert props["source_event_count"] == 1
    assert props["candidate_count"] == 1
    assert props["high_confidence_count"] == 0
    assert props["latest_event_type"] == "artifact_created"
    assert props["source_artifacts"] == ["results/learn-intent/missing.json"]
    assert props["has_extractable_candidates"] is True
    streamed_text = "".join(event["delta"] for event in events if event["type"] == "message_delta")
    assert "session `learn-intent-session`" in streamed_text
    assert "1 candidate learned rule" in streamed_text
    persisted_events = client.get("/api/sessions/learn-intent-session/events").json()["items"]
    persisted_command = next(event for event in persisted_events if event["type"] == "agent_command")
    assert persisted_command["command"] == command_event["command"]
    assert persisted_command["resolved_context"] == command_event["resolved_context"]


def test_session_socket_continue_from_last_failure_reports_no_saved_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "continue_no_failure_project"}).json()

    with client.websocket_connect("/ws/sessions/no-failure-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "retry last failed step",
                "context": {
                    "project_id": project["id"],
                    "active_file": "data/anything.md",
                    "mode": "analysis",
                },
            }
        )
        events = []
        while True:
            event = websocket.receive_json()
            events.append(event)
            if event["type"] == "task_progress":
                break

    assert [event["type"] for event in events if event["type"] != "message_delta"] == [
        "tool_call_started",
        "tool_call_finished",
        "task_progress",
    ]
    assert events[-1]["label"] == "No saved failed task state"
