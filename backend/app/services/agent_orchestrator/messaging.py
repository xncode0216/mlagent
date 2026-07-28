"""Streaming / message + event & artifact helpers from the orchestrator (P1-6 slice 5).

A mixin composed into ``AgentOrchestrator``; methods keep full ``self`` access, so the
bodies are unchanged.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib

from collections.abc import AsyncIterator
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4
from app.services.agent_orchestrator.artifacts import (
    _artifact_payload,
    _render_transformation_report,
    _write_json_artifact,
    _write_text_artifact,
)
from app.services.agent_orchestrator.contexts import (
    ActiveFileResolution,
    AgentContext,
)
from app.services.agent_orchestrator.support import (
    _relative_path,
    _utc_now,
)
from app.services.agent_orchestrator.tools import (
    _ANALYSIS_AGENT_PROMPT,
    _build_analysis_tools,
)
from app.services.evolution_service import EvolutionService
from app.services.lesson_extractor import LessonExtractor
from app.services.llm import (
    ChatMessage,
    LLMError,
)
from app.services.llm_agent import (
    ToolCallFinished,
    ToolCallStarted,
    run_tool_phase,
)
from app.services.rule_injection_service import RuleInjectionService
from app.services.task_state_service import list_task_states
from app.tools.data_analysis import (
    data_quality_profile,
    execute_preprocessing_plan,
    preprocessing_plan,
)


# 运行模式到经验领域标签的映射，取值与 LessonExtractor 写入 `domain` 的词汇一致，
# 否则两侧对不上，标签维度形同虚设。
_MODE_TAGS = {
    "analysis": ["data-analysis"],
    "machine-learning": ["machine-learning", "training"],
    "evolution": ["evolution"],
}


# 未解决失败的错误文本 → 情境标签，取值同样与 LessonExtractor 的 `domain` 对齐。
_ERROR_TAGS = (
    ("ModuleNotFoundError", ["runtime", "kernel-error"]),
    ("ImportError", ["runtime", "kernel-error"]),
    ("Kernel", ["runtime", "kernel-error"]),
)


def _failure_tags(project_root: Path, session_id: str) -> list[str]:
    """从会话中尚未解决的失败派生错误情境标签。

    用任务状态而不是翻事件历史：失败被重试或放弃后状态即被删除，因此它表达的是
    "现在还有没有这个问题"，而不是"历史上曾经出现过"。后者会让一次早已修好的
    报错永远把会话标记为错误情境。
    """
    tags: list[str] = []
    for state in list_task_states(project_root=project_root, session_id=session_id):
        if state.get("status") != "failed":
            continue
        error = str(state.get("last_error") or "")
        for marker, marker_tags in _ERROR_TAGS:
            if marker in error:
                tags.extend(tag for tag in marker_tags if tag not in tags)
    return tags


def _situation_tags(mode: str, project_root: Path | None = None, session_id: str = "") -> list[str]:
    """描述这次运行处于什么情境，用于按领域匹配经验。

    此前这里写死为 ``["missing-value"]``——无论运行在做什么都如此宣称，
    既让按运行领域标注的经验对不上，也把缺失值经验注入到与之无关的运行里。
    改为按模式派生后仍不够：错误类经验（``["runtime", "kernel-error"]``）恰恰
    在最需要它的时候——真的报了同类错误时——匹配不到，因为标签里没有错误情境。
    """
    tags = list(_MODE_TAGS.get(mode, []))
    if project_root is not None and session_id:
        tags.extend(tag for tag in _failure_tags(project_root, session_id) if tag not in tags)
    return tags


class MessagingMixin:
    def _record(self, event: dict[str, Any]) -> dict[str, Any]:
        if self.session_service is None:
            return event
        if self.session_service.get_session(self.session_id) is None:
            return event
        self.session_service.append_event(
            session_id=self.session_id,
            event_type=str(event["type"]),
            payload=event,
        )
        return event

    def _persist_message(
        self,
        session_service: Any,
        *,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Persist a message with its trace id attached.

        Every stream event carries a trace id; messages must too, otherwise a
        reply in the transcript cannot be traced back to the run that produced
        it. Routing all writes through here keeps that guarantee in one place
        instead of relying on each call site to remember.
        """
        session_service.append_message(
            session_id=self.session_id,
            role=role,
            content=content,
            metadata={**(metadata or {}), "trace_id": self.trace_id},
        )

    def _append_user_message(self, context: AgentContext, content: str) -> None:
        self._persist_message(
            context.session_service,
            role="user",
            content=content,
            metadata={"active_file": context.active_file},
        )

    async def _emit_assistant_message(self, text: str) -> AsyncIterator[dict[str, Any]]:
        for chunk in text:
            yield {
                "type": "message_delta",
                "trace_id": self.trace_id,
                "message_id": self.message_id,
                "delta": chunk,
            }
            await asyncio.sleep(0.001)
        if self.session_service is not None and self.session_service.get_session(self.session_id):
            self._persist_message(
                self.session_service,
                role="assistant",
                content=text,
                metadata={"message_id": self.message_id},
            )

    async def _emit_llm_message(
        self,
        *,
        messages: list[ChatMessage],
        fallback_text: str,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream a real LLM reply as message_delta events.

        Falls back to ``fallback_text`` when no LLM is configured or the call
        fails before producing any text, so this path always yields a reply.
        """
        if self._llm_client is None:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        collected: list[str] = []
        try:
            async for chunk in self._llm_client.stream(messages, max_tokens=600):
                collected.append(chunk)
                yield {
                    "type": "message_delta",
                    "trace_id": self.trace_id,
                    "message_id": self.message_id,
                    "delta": chunk,
                }
        except LLMError:
            if not collected:
                async for event in self._emit_assistant_message(fallback_text):
                    yield event
                return

        text = "".join(collected) or fallback_text
        if self.session_service is not None and self.session_service.get_session(self.session_id):
            self._persist_message(
                self.session_service,
                role="assistant",
                content=text,
                metadata={"message_id": self.message_id},
            )

    async def _run_agentic_answer(
        self,
        *,
        agent_context: AgentContext,
        content: str,
        fallback_text: str,
    ) -> AsyncIterator[dict[str, Any]]:
        """Let the LLM autonomously call read-only tools, then stream its answer.

        Drives :func:`run_tool_phase` so the model decides which dataset tools to
        run, surfaces each call as the orchestrator's standard
        ``tool_call_started`` / ``tool_call_finished`` events, then streams the
        final grounded reply over the tool-augmented conversation. Any LLM failure
        falls back to ``fallback_text`` so the turn always yields a reply. The
        deterministic profile artifacts created by the caller remain the inspector's
        source of truth; this loop adds the reasoning layer on top.
        """
        if self._llm_client is None:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        tools, execute = _build_analysis_tools(agent_context.csv_path)
        conversation: list[ChatMessage] = [
            ChatMessage.system(_ANALYSIS_AGENT_PROMPT),
            ChatMessage.user(content),
        ]
        started_at: dict[str, float] = {}
        try:
            async for event in run_tool_phase(
                self._llm_client,
                conversation=conversation,
                tools=tools,
                execute=execute,
            ):
                if isinstance(event, ToolCallStarted):
                    started_at[event.call_id] = perf_counter()
                    yield self._record(
                        {
                            "type": "tool_call_started",
                            "trace_id": self.trace_id,
                            "call_id": event.call_id,
                            "tool": event.call.name,
                            "args": event.call.arguments,
                            "started_at": _utc_now(),
                        }
                    )
                elif isinstance(event, ToolCallFinished):
                    yield self._record(
                        self._tool_finished(
                            call_id=event.call_id,
                            started_at=started_at.get(event.call_id, perf_counter()),
                            status="error" if event.error else "success",
                            error=event.output if event.error else None,
                        )
                    )
        except LLMError:
            async for event in self._emit_assistant_message(fallback_text):
                yield event
            return

        async for event in self._emit_llm_message(
            messages=conversation, fallback_text=fallback_text
        ):
            yield event

    async def _emit_resolution_error(
        self,
        *,
        call_id: str,
        started_at: float,
        resolution: ActiveFileResolution,
    ) -> AsyncIterator[dict[str, Any]]:
        yield {
            "type": "tool_call_finished",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "status": "error",
            "error": resolution.message,
            "finished_at": _utc_now(),
            "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        }
        yield {
            "type": "error",
            "trace_id": self.trace_id,
            "code": resolution.code,
            "message": resolution.message,
        }

    def _stage_event(self, event_type: str, stage: str, label: str) -> dict[str, Any]:
        key = "completed_at" if event_type == "stage_completed" else "started_at"
        return {
            "type": event_type,
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "stage": stage,
            "label": label,
            key: _utc_now(),
        }

    def _rules_event(self, context: AgentContext) -> dict[str, Any]:
        rule_service = RuleInjectionService(context.project_root)
        match_result = rule_service.match_rules(
            session_id=self.session_id,
            context={
                "mode": context.mode,
                # 规则范围按数据集限定，因此匹配上下文必须带上真实的活动数据集，
                # 否则限定到当前数据集的规则会被判为越界而完全不生效。
                "dataset_path": context.active_file,
                "tags": _situation_tags(context.mode, context.project_root, self.session_id),
            },
        )
        return {
            "type": "rules_matched",
            "trace_id": self.trace_id,
            "matched_rules": match_result["matched_rules"],
            "prompt_snippet": rule_service.inject_prompt(
                self.session_id,
                match_result["matched_rules"],
            ),
        }

    def _lesson_events(self, context: AgentContext) -> list[dict[str, Any]]:
        lesson_candidates = LessonExtractor(context.project_root).extract_from_session(
            self.session_id,
            context.session_service.list_events(self.session_id),
        )
        evolution = EvolutionService(context.project_root)
        events = []
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
            events.append(
                {
                    "type": "lesson_extracted",
                    "trace_id": self.trace_id,
                    "lesson_id": lesson.id,
                    "confidence": lesson.confidence,
                }
            )
        return events

    def _tool_started(
        self,
        *,
        call_id: str,
        tool: str,
        stage: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "type": "tool_started",
            "trace_id": self.trace_id,
            "task_id": self.session_id,
            "call_id": call_id,
            "tool": tool,
            "stage": stage,
            "args": args,
            "started_at": _utc_now(),
        }

    def _tool_finished(
        self,
        *,
        call_id: str,
        started_at: float,
        status: str = "success",
        result_ref: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "tool_call_finished",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "status": status,
            **({"result_ref": result_ref} if result_ref else {}),
            **({"error": error} if error else {}),
            "finished_at": _utc_now(),
            "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        }

    def _build_profile_artifact(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        profile = data_quality_profile(context.csv_path)
        artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=context.project_root / "results" / self.session_id / "data_quality_profile.json",
            artifact_type="dataframe",
            payload=profile,
            metadata={
                "dataset_path": context.active_file,
                "profile_type": "data_quality",
                "row_count": profile.get("row_count", 0),
                "column_count": profile.get("column_count", 0),
                "target_candidates": profile.get("target_candidates", []),
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="data_quality_profile",
                stage="profile",
                args={"dataset_path": context.active_file},
            ),
            "artifact_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=artifact["path"],
            ),
        }

    def _build_dataset_registry_artifact(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        with context.csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.reader(handle)
            columns = [column.strip() for column in next(reader, [])]
            row_count = sum(1 for _ in reader)

        file_hash = hashlib.sha256(context.csv_path.read_bytes()).hexdigest()
        dataset_version_id = f"csv-{context.csv_path.stem}-{self.session_id}"
        registry_entry = {
            "dataset_version_id": dataset_version_id,
            "dataset_path": context.active_file,
            "source": {
                "kind": "project_file",
                "path": context.active_file,
                "format": "csv",
                "sha256": file_hash,
                "size_bytes": context.csv_path.stat().st_size,
            },
            "schema": {
                "columns": columns,
                "column_count": len(columns),
            },
            "row_count": row_count,
            "sample_strategy": "full_csv_scan",
            "registered_at": _utc_now(),
        }
        artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=context.project_root / "results" / self.session_id / "dataset_registry_entry.json",
            artifact_type="dataframe",
            payload=registry_entry,
            metadata={
                "dataset_path": context.active_file,
                "dataset_version_id": dataset_version_id,
                "artifact_role": "dataset_registry_entry",
                "source_format": "csv",
                "row_count": row_count,
                "column_count": len(columns),
                "columns": columns,
                "sample_strategy": "full_csv_scan",
                "sha256": file_hash,
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="register_dataset",
                stage="ingest",
                args={"dataset_path": context.active_file},
            ),
            "artifact_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=artifact["path"],
            ),
        }

    def _build_preprocessing_plan_artifacts(self, context: AgentContext) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        plan = preprocessing_plan(context.csv_path, dataset_path=context.active_file)
        result_dir = context.project_root / "results" / self.session_id
        plan_path = result_dir / "preprocessing_plan.json"
        output_path = result_dir / f"{context.csv_path.stem}_preprocessed.csv"
        output_project_path = _relative_path(context.project_root, output_path)

        manual_output = str(
            Path("results") / "manual-analysis" / f"{context.csv_path.stem}_preprocessed.csv"
        )
        script = str(plan.pop("pipeline_script", ""))
        script = script.replace(
            f"output_path = {manual_output!r}",
            f"output_path = {output_project_path!r}",
        )
        plan["output_dataset_path"] = output_project_path
        plan["sklearn_pipeline_script_path"] = f"notebooks/{self.session_id}_preprocessing_pipeline.py"

        plan_artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=plan_path,
            artifact_type="dataframe",
            payload=plan,
            metadata={
                "dataset_path": context.active_file,
                "target_column": plan["target_column"],
                "artifact_role": "preprocessing_plan",
                "output_dataset_path": plan["output_dataset_path"],
                "feature_columns": plan["feature_columns"],
                "drop_columns": plan["drop_columns"],
            },
        )
        script_path = context.project_root / "notebooks" / f"{self.session_id}_preprocessing_pipeline.py"
        script_artifact = _write_text_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=script_path,
            artifact_type="code",
            content=script,
            metadata={
                "dataset_path": context.active_file,
                "target_column": plan["target_column"],
                "plan_path": plan_artifact["path"],
            },
        )
        return {
            "started": self._tool_started(
                call_id=call_id,
                tool="preprocessing_plan",
                stage="transform",
                args={"dataset_path": context.active_file},
            ),
            "plan_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": plan_artifact,
            },
            "script_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": script_artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=plan_artifact["path"],
            ),
        }

    def _build_preprocessing_execution_artifacts(
        self,
        context: AgentContext,
        *,
        plan_project_path: str,
        retry_count: int = 0,
    ) -> dict[str, Any]:
        call_id = uuid4().hex
        started_at = perf_counter()
        result_dir = context.project_root / "results" / self.session_id
        output_path = result_dir / f"{context.csv_path.stem}_planned.csv"
        output_project_path = _relative_path(context.project_root, output_path)
        plan_file = (context.project_root / plan_project_path).resolve()
        started = self._tool_started(
            call_id=call_id,
            tool="execute_preprocessing_plan",
            stage="transform",
            args={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
            },
        )
        try:
            summary = execute_preprocessing_plan(
                csv_path=context.csv_path,
                plan_path=plan_file,
                output_path=output_path,
                dataset_path=context.active_file,
                plan_project_path=plan_project_path,
                output_project_path=output_project_path,
            )
        except Exception as exc:
            error = str(exc) or exc.__class__.__name__
            failed_at = _utc_now()
            return {
                "failed": True,
                "failed_at": failed_at,
                "started": started,
                "finished": self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    status="error",
                    error=error,
                ),
                "step_failed": {
                    "type": "step_failed",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "stage": "transform",
                    "label": "Preprocessing plan execution failed",
                    "error": error,
                    "retryable": True,
                    "resume_stage": "transform",
                    "retry_count": retry_count,
                },
                "progress": {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 0.55,
                    "label": "Preprocessing execution failed",
                    "timestamp": failed_at,
                },
            }

        summary_path = result_dir / "preprocessing_transform_report.json"
        report_path = result_dir / "preprocessing_transform_report.md"
        summary_artifact = _write_json_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=summary_path,
            artifact_type="dataframe",
            payload=summary,
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_summary",
            },
        )
        report_artifact = _write_text_artifact(
            project_id=context.project_id,
            session_id=self.session_id,
            project_root=context.project_root,
            path=report_path,
            artifact_type="report",
            content=_render_transformation_report(summary),
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_report",
            },
        )
        dataset_artifact = _artifact_payload(
            project_id=context.project_id,
            session_id=self.session_id,
            artifact_type="dataframe",
            name=output_path.name,
            path=output_project_path,
            metadata={
                "dataset_path": context.active_file,
                "preprocessing_plan_path": plan_project_path,
                "target_column": summary["target_column"],
                "artifact_role": "preprocessed_dataset",
            },
        )
        return {
            "started": started,
            "dataset_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": dataset_artifact,
            },
            "summary_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": summary_artifact,
            },
            "report_event": {
                "type": "artifact_created",
                "trace_id": self.trace_id,
                "artifact": report_artifact,
            },
            "finished": self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=output_project_path,
            ),
            "summary": summary,
        }
