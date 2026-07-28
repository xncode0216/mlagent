"""失败任务状态的持久化，以及把 kernel stderr 记成会话事件。

`_record_kernel_stderr` 只服务于这里的失败路径（P3-2 补上的 `kernel_output`
生产方），因此与失败状态写入放在一处。
"""

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.api.machine_learning.schemas import TrainSklearnRequest
from app.services.session_service import SessionService
from app.services.task_state_service import recovery_policy, write_task_state


def _record_kernel_stderr(root: Path, session_id: str, text: str) -> None:
    """把 Kernel 的错误输出记进会话事件流。

    ``kernel_output`` 的消费方一直都在——日志面板按 stderr 分级渲染，经验抽取器
    据它沉淀依赖缺失类经验——但此前没有任何生产方，两者因此都是死代码。训练在
    REST 路径执行，那里不写会话事件，所以这里显式补上。

    会话可能不存在（例如默认的 manual-training），此时静默跳过：训练失败本身
    已由任务状态与 HTTP 响应如实报告，不该因为记事件失败而把它变成另一种错误。
    """
    if not text.strip():
        return
    try:
        SessionService(root).append_event(
            session_id=session_id,
            event_type="kernel_output",
            payload={"type": "kernel_output", "stream": "stderr", "text": text},
        )
    except KeyError:
        return


def _write_training_failure_state(
    *,
    root: Path,
    project_id: str,
    payload: TrainSklearnRequest,
    error: str,
    retry_count: int = 0,
) -> None:
    _record_kernel_stderr(root, payload.session_id, error)
    write_task_state(
        project_root=root,
        session_id=payload.session_id,
        stage="train",
        payload={
            "status": "failed",
            "project_id": project_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "sklearn",
            "use_gpu": payload.use_gpu,
            "preprocessing_plan_path": payload.preprocessing_plan_path,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint=(
                    "Check that the dataset, target column, preprocessing plan, kernel backend, "
                    "and GPU settings are still valid before retrying sklearn training."
                ),
                stale_check="Confirm the saved dataset and preprocessing plan still exist and include the target column.",
                resume_action="Retry the saved sklearn training request from durable task state.",
                regenerate_action="Regenerate the preprocessing plan or choose a different target before retraining.",
                abandon_action="Clear the saved training retry state and keep existing artifacts unchanged.",
                stale_artifact_paths=[payload.dataset_path, payload.preprocessing_plan_path],
            ),
        },
    )


def _write_evaluation_failure_state(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    run: dict[str, Any] | None,
    error: str,
    retry_count: int = 0,
) -> None:
    metrics_artifact = run.get("metrics_artifact") if isinstance(run, dict) else None
    model_artifact = run.get("model_artifact") if isinstance(run, dict) else None
    write_task_state(
        project_root=root,
        session_id=session_id,
        stage="evaluate",
        payload={
            "status": "failed",
            "project_id": project_id,
            "experiment_id": experiment_id,
            "dataset_path": run.get("dataset_path") if isinstance(run, dict) else None,
            "target_column": run.get("target_column") if isinstance(run, dict) else None,
            "engine": run.get("engine") if isinstance(run, dict) else None,
            "metrics_path": metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
            "model_path": model_artifact.get("path") if isinstance(model_artifact, dict) else None,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint="Restore the training metrics/model artifacts or rerun training before regenerating the report.",
                stale_check="Confirm the metrics and model artifacts still exist and belong to the saved experiment.",
                resume_action="Retry evaluation report generation from the saved experiment run.",
                regenerate_action="Regenerate or rerun the upstream training artifacts before evaluation.",
                abandon_action="Clear the saved evaluation retry state and keep the current run detail unchanged.",
                stale_artifact_paths=[
                    metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
                    model_artifact.get("path") if isinstance(model_artifact, dict) else None,
                ],
            ),
        },
    )


def _write_export_failure_state(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    experiment_id: str,
    run: dict[str, Any] | None,
    error: str,
    retry_count: int = 0,
) -> None:
    report_artifact = run.get("evaluation_report_artifact") if isinstance(run, dict) else None
    metrics_artifact = run.get("metrics_artifact") if isinstance(run, dict) else None
    model_artifact = run.get("model_artifact") if isinstance(run, dict) else None
    write_task_state(
        project_root=root,
        session_id=session_id,
        stage="export",
        payload={
            "status": "failed",
            "project_id": project_id,
            "experiment_id": experiment_id,
            "dataset_path": run.get("dataset_path") if isinstance(run, dict) else None,
            "target_column": run.get("target_column") if isinstance(run, dict) else None,
            "engine": run.get("engine") if isinstance(run, dict) else None,
            "metrics_path": metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
            "model_path": model_artifact.get("path") if isinstance(model_artifact, dict) else None,
            "report_path": report_artifact.get("path") if isinstance(report_artifact, dict) else None,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint="Restore model, metrics, and report artifacts or regenerate evaluation before exporting.",
                stale_check="Confirm the model, metrics, and report files still exist before creating the handoff bundle.",
                resume_action="Retry the saved model handoff bundle export.",
                regenerate_action="Regenerate the evaluation report or rerun training before exporting.",
                abandon_action="Clear the saved export retry state and keep existing run artifacts unchanged.",
                stale_artifact_paths=[
                    metrics_artifact.get("path") if isinstance(metrics_artifact, dict) else None,
                    model_artifact.get("path") if isinstance(model_artifact, dict) else None,
                    report_artifact.get("path") if isinstance(report_artifact, dict) else None,
                ],
            ),
        },
    )


def _state_to_sklearn_request(state: dict[str, Any], *, session_id: str) -> TrainSklearnRequest:
    dataset_path = state.get("dataset_path")
    target_column = state.get("target_column")
    if not isinstance(dataset_path, str) or not isinstance(target_column, str):
        raise HTTPException(status_code=409, detail="Saved training retry state is incomplete")
    preprocessing_plan_path = state.get("preprocessing_plan_path")
    return TrainSklearnRequest(
        dataset_path=dataset_path,
        target_column=target_column,
        session_id=session_id,
        use_gpu=state.get("use_gpu") is True,
        preprocessing_plan_path=preprocessing_plan_path if isinstance(preprocessing_plan_path, str) else None,
    )
