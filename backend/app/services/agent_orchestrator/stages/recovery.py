"""失败恢复的 stage runner：从上次失败继续、放弃上次失败。

`StageRunnersMixin` 的一部分（见 `stages/__init__.py`）；方法体保持不变，
仍通过 `self` 访问 dispatcher/messaging 辅助方法。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.services.agent_orchestrator.support import RECOVERABLE_STAGES, _utc_now
from app.services.task_state_service import delete_task_state, list_task_states


class RecoveryStagesMixin:
    async def _run_continue_from_failure(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = perf_counter()
        call_id = uuid4().hex
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "agent_orchestrator",
            "args": {"intent": "continue_from_failure", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project context is required",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        self._persist_message(
            session_context.session_service,
            role="user",
            content=content,
            metadata={"active_file": active_file, "intent": "continue_from_failure"},
        )
        self._record(started_event)

        failed_states = [
            state
            for state in list_task_states(project_root=session_context.project_root, session_id=self.session_id)
            if state.get("status") == "failed" and state.get("stage") in RECOVERABLE_STAGES
        ]
        state = failed_states[0] if failed_states else None
        if state is None:
            yield self._record(
                self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    result_ref="no_failed_task_state",
                )
            )
            text = (
                "I checked this session and did not find a saved failed task state. "
                "You can ask me to analyze a dataset, prepare it for modeling, train, "
                "evaluate, export, or extract lessons."
            )
            async for event in self._emit_assistant_message(text):
                yield event
            yield self._record(
                {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 1,
                    "label": "No saved failed task state",
                    "timestamp": _utc_now(),
                }
            )
            return

        stage = str(state["stage"])
        label = f"Continue from saved {stage} failure"
        error = str(state.get("last_error") or "Saved task state is failed")
        retry_count = int(state.get("retry_count") or 0)
        resume_action = str(
            state.get("resume_action")
            or (state.get("recovery_policy") if isinstance(state.get("recovery_policy"), dict) else {}).get("resume_action")
            or f"Retry the saved {stage} step."
        )

        yield self._record(
            {
                "type": "step_failed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "label": label,
                "error": error,
                "retryable": True,
                "resume_stage": stage,
                "retry_count": retry_count,
            }
        )
        yield self._record(
            {
                "type": "component_requested",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "component": "task_state_inspector",
                "title": f"Continue from saved {stage} failure",
                "props": {
                    "stage": stage,
                    "retry_count": retry_count,
                    "last_error": error,
                    "resume_action": resume_action,
                },
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=f"task_state/{stage}",
            )
        )

        text = (
            f"I found a saved {stage} failure for this session. "
            f"The safest next action is: {resume_action} "
            "Review the recovery inspector before retrying, regenerating upstream work, or abandoning the saved state."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 0.6,
                "label": f"Ready to continue from saved {stage} failure",
                "timestamp": _utc_now(),
            }
        )

    async def _run_abandon_last_failure(
        self,
        *,
        content: str,
        context: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        started_at = perf_counter()
        call_id = uuid4().hex
        started_event = {
            "type": "tool_call_started",
            "trace_id": self.trace_id,
            "call_id": call_id,
            "tool": "agent_orchestrator",
            "args": {"intent": "abandon_last_failure", **context},
            "started_at": _utc_now(),
        }
        yield started_event

        session_context, error_event = self._resolve_project_session_context(context)
        if session_context is None:
            yield error_event or {
                "type": "error",
                "trace_id": self.trace_id,
                "code": "invalid_context",
                "message": "Project context is required",
            }
            return

        active_file = context.get("active_file") if isinstance(context.get("active_file"), str) else ""
        self._persist_message(
            session_context.session_service,
            role="user",
            content=content,
            metadata={"active_file": active_file, "intent": "abandon_last_failure"},
        )
        self._record(started_event)

        failed_states = [
            state
            for state in list_task_states(project_root=session_context.project_root, session_id=self.session_id)
            if state.get("status") == "failed" and state.get("stage") in RECOVERABLE_STAGES
        ]
        state = failed_states[0] if failed_states else None
        if state is None:
            yield self._record(
                self._tool_finished(
                    call_id=call_id,
                    started_at=started_at,
                    result_ref="no_failed_task_state",
                )
            )
            text = (
                "I checked this session and did not find a saved failed task state to abandon. "
                "Nothing was changed."
            )
            async for event in self._emit_assistant_message(text):
                yield event
            yield self._record(
                {
                    "type": "task_progress",
                    "trace_id": self.trace_id,
                    "task_id": self.session_id,
                    "progress": 1,
                    "label": "No saved failed task state",
                    "timestamp": _utc_now(),
                }
            )
            return

        stage = str(state["stage"])
        delete_task_state(project_root=session_context.project_root, session_id=self.session_id, stage=stage)
        yield self._record(
            {
                "type": "step_completed",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "stage": stage,
                "label": f"Abandoned saved {stage} failure state",
            }
        )
        yield self._record(
            self._tool_finished(
                call_id=call_id,
                started_at=started_at,
                result_ref=f"task_state/{stage}",
            )
        )

        text = (
            f"I cleared the saved {stage} failure for this session. "
            "Historical messages, logs, and artifacts are still available, but the retry state will no longer be offered."
        )
        async for event in self._emit_assistant_message(text):
            yield event

        yield self._record(
            {
                "type": "task_progress",
                "trace_id": self.trace_id,
                "task_id": self.session_id,
                "progress": 1,
                "label": f"Abandoned saved {stage} failure state",
                "timestamp": _utc_now(),
            }
        )

