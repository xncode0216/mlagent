import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.projects import get_registered_project
from app.services.artifact_service import ArtifactService
from app.services.evolution_service import EvolutionService
from app.services.lesson_extractor import LessonExtractor
from app.services.rule_injection_service import RuleInjectionService
from app.services.session_service import SessionService
from app.tools.data_analysis import correlation_matrix, detect_missing, plot_distribution, profile_dataset

router = APIRouter(tags=["websocket"])


@dataclass
class ActiveFileResolution:
    csv_path: Path | None
    code: str | None = None
    message: str | None = None


def _resolve_active_file(project_id: object, active_file: object) -> ActiveFileResolution:
    if not isinstance(project_id, str) or not isinstance(active_file, str):
        return ActiveFileResolution(csv_path=None)

    project = get_registered_project(project_id)
    if project is None:
        return ActiveFileResolution(None, "project_not_found", "Project not found")

    project_root = Path(project.workspace_path).resolve()
    csv_path = (project_root / active_file).resolve()
    if project_root != csv_path and project_root not in csv_path.parents:
        return ActiveFileResolution(
            None,
            "invalid_active_file",
            "Active file is outside the project workspace",
        )
    if not csv_path.exists() or not csv_path.is_file():
        return ActiveFileResolution(None, "active_file_not_found", "Active file was not found")
    if csv_path.suffix.lower() != ".csv":
        return ActiveFileResolution(None, "unsupported_active_file", "Only CSV files are supported")
    return ActiveFileResolution(csv_path=csv_path)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") != "user_message":
                await websocket.send_json(
                    {"type": "error", "code": "bad_event", "message": "Unsupported event"}
                )
                continue

            message_id = uuid4().hex
            call_id = uuid4().hex
            trace_id = uuid4().hex
            context = payload.get("context", {})
            project_id = context.get("project_id")
            active_file = context.get("active_file")
            started_at = _utc_now()
            tool_started_at = perf_counter()

            tool_started_event = {
                "type": "tool_call_started",
                "trace_id": trace_id,
                "call_id": call_id,
                "tool": "profile_dataset",
                "args": context,
                "started_at": started_at,
            }
            await websocket.send_json(tool_started_event)

            resolution = _resolve_active_file(project_id, active_file)
            if resolution.code is not None:
                await websocket.send_json(
                    {
                        "type": "tool_call_finished",
                        "trace_id": trace_id,
                        "call_id": call_id,
                        "status": "error",
                        "error": resolution.message,
                        "finished_at": _utc_now(),
                        "duration_ms": round((perf_counter() - tool_started_at) * 1000, 2),
                    }
                )
                await websocket.send_json(
                    {
                        "type": "error",
                        "trace_id": trace_id,
                        "code": resolution.code,
                        "message": resolution.message,
                    }
                )
                continue

            if isinstance(project_id, str) and resolution.csv_path is not None:
                project = get_registered_project(project_id)
                if project is None:
                    continue
                project_root = Path(project.workspace_path).resolve()
                session_service = SessionService(project_root)
                session_service.ensure_session(
                    project_id=project_id,
                    session_id=session_id,
                    mode=str(context.get("mode") or "analysis"),
                )
                session_service.append_event(
                    session_id=session_id,
                    event_type="tool_call_started",
                    payload=tool_started_event,
                )
                if isinstance(payload.get("content"), str):
                    session_service.append_message(
                        session_id=session_id,
                        role="user",
                        content=payload["content"],
                        metadata={"active_file": active_file},
                    )

                rule_service = RuleInjectionService(project_root)
                match_result = rule_service.match_rules(
                    session_id=session_id,
                    context={
                        "mode": str(context.get("mode") or "analysis"),
                        "tags": ["missing-value"],
                    },
                )
                rules_event = {
                    "type": "rules_matched",
                    "trace_id": trace_id,
                    "matched_rules": match_result["matched_rules"],
                    "prompt_snippet": rule_service.inject_prompt(
                        session_id,
                        match_result["matched_rules"],
                    ),
                }
                session_service.append_event(
                    session_id=session_id,
                    event_type="rules_matched",
                    payload=rules_event,
                )
                await websocket.send_json(rules_event)

                artifacts = [
                    ("dataframe", "profile.json", profile_dataset(resolution.csv_path)),
                    ("dataframe", "missing.json", detect_missing(resolution.csv_path)),
                    ("chart", "correlation.json", correlation_matrix(resolution.csv_path)),
                    ("chart", "distribution.json", plot_distribution(resolution.csv_path)),
                ]
                artifact_service = ArtifactService(project_root)
                for artifact_type, name, data in artifacts:
                    artifact = artifact_service.write_json(
                        project_id=project_id,
                        session_id=session_id,
                        artifact_type=artifact_type,
                        name=name,
                        payload=data,
                    )
                    event_payload = {
                        "type": "artifact_created",
                        "trace_id": trace_id,
                        "artifact": {
                            "id": artifact.id,
                            "project_id": project_id,
                            "session_id": session_id,
                            "type": artifact_type,
                            "name": name,
                            "path": str(artifact.path.relative_to(project_root)).replace("\\", "/"),
                            "metadata": artifact.metadata,
                            "created_at": artifact.created_at,
                        },
                    }
                    session_service.append_event(
                        session_id=session_id,
                        event_type="artifact_created",
                        payload=event_payload,
                    )
                    await websocket.send_json(event_payload)

                lesson_candidates = LessonExtractor(project_root).extract_from_session(
                    session_id,
                    session_service.list_events(session_id),
                )
                evolution = EvolutionService(project_root)
                for item in lesson_candidates:
                    lesson = evolution.create_lesson(
                        source_type=item["source_type"],
                        source_id=item["source_id"],
                        domain=item["domain"],
                        observation=item["observation"],
                        recommendation=item["recommendation"],
                        confidence=item["confidence"],
                        evidence=item.get("evidence", {}),
                        title=item.get("title", ""),
                        conditions=item.get("conditions", {}),
                        expected_benefit=item.get("expected_benefit", {}),
                    )
                    lesson_event = {
                        "type": "lesson_extracted",
                        "trace_id": trace_id,
                        "lesson_id": lesson.id,
                        "confidence": lesson.confidence,
                    }
                    session_service.append_event(
                        session_id=session_id,
                        event_type="lesson_extracted",
                        payload=lesson_event,
                    )
                    await websocket.send_json(lesson_event)

            await asyncio.sleep(0.2)
            tool_finished_event = {
                "type": "tool_call_finished",
                "trace_id": trace_id,
                "call_id": call_id,
                "status": "success",
                "finished_at": _utc_now(),
                "duration_ms": round((perf_counter() - tool_started_at) * 1000, 2),
            }
            if isinstance(project_id, str):
                project = get_registered_project(project_id)
                if project is not None:
                    session_service = SessionService(Path(project.workspace_path).resolve())
                    if session_service.get_session(session_id) is not None:
                        session_service.append_event(
                            session_id=session_id,
                            event_type="tool_call_finished",
                            payload=tool_finished_event,
                        )
            await websocket.send_json(tool_finished_event)

            text = "我会先读取数据集结构，然后分析缺失值、字段类型、分布和相关性，并把结果放到右侧面板。"
            for chunk in text:
                await websocket.send_json(
                    {"type": "message_delta", "message_id": message_id, "delta": chunk}
                )
                await asyncio.sleep(0.01)
            if isinstance(project_id, str):
                project = get_registered_project(project_id)
                if project is not None:
                    session_service = SessionService(Path(project.workspace_path).resolve())
                    if session_service.get_session(session_id) is not None:
                        session_service.append_message(
                            session_id=session_id,
                            role="assistant",
                            content=text,
                            metadata={"message_id": message_id},
                        )

            progress_event = {
                "type": "task_progress",
                "trace_id": trace_id,
                "task_id": session_id,
                "progress": 1,
                "label": "完成",
                "timestamp": _utc_now(),
            }
            if isinstance(project_id, str):
                project = get_registered_project(project_id)
                if project is not None:
                    session_service = SessionService(Path(project.workspace_path).resolve())
                    if session_service.get_session(session_id) is not None:
                        session_service.append_event(
                            session_id=session_id,
                            event_type="task_progress",
                            payload=progress_event,
                        )
            await websocket.send_json(progress_event)
    except WebSocketDisconnect:
        return
