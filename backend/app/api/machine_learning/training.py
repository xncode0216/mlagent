"""baseline / sklearn 训练路由与执行。

测试通过 `app.api.machine_learning.training.create_kernel_service` 替换内核，
`gpu_scheduler` 则是单例、patch 其方法即可对所有引用者生效。
"""

import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.api.machine_learning.failure_state import (
    _state_to_sklearn_request,
    _write_training_failure_state,
)
from app.api.machine_learning.report import _write_evaluation_report_artifact
from app.api.machine_learning.schemas import (
    ResumeSklearnTrainingRequest,
    TrainBaselineRequest,
    TrainSklearnRequest,
)
from app.api.machine_learning.support import (
    _existing_file_artifact,
    _json_safe,
    _project_root,
    _relative_project_path,
    _resolve_project_file,
    _safe_name,
)
from app.core.config import get_settings
from app.services.artifact_service import ArtifactService
from app.services.experiment_service import ExperimentService
from app.services.gpu_scheduler_service import (
    GPUAcquireCancelled,
    GPUAcquireTimeout,
    gpu_scheduler,
)
from app.services.kernel_service import create_kernel_service
from app.services.task_state_service import delete_task_state, load_task_state
from app.tools.machine_learning import train_baseline_classifier, train_sklearn_classifier

router = APIRouter()


@router.post("/train-baseline")
def train_baseline(project_id: str, payload: TrainBaselineRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    csv_path = _resolve_project_file(root, payload.dataset_path)
    try:
        result = _json_safe(train_baseline_classifier(csv_path, payload.target_column))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    experiment_id = uuid4().hex
    model_name = f"baseline_{payload.target_column}_model.json"
    model_path = root / "models" / model_name
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_payload = {
        "experiment_id": experiment_id,
        "dataset_path": payload.dataset_path,
        "target_column": payload.target_column,
        "model": result["model"],
        "feature_columns": result["feature_columns"],
    }
    model_path.write_text(json.dumps(model_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    artifact_service = ArtifactService(root)
    metrics_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="training",
        name="training_metrics.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            **result,
        },
    )
    prediction_samples_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="dataframe",
        name="prediction_samples.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "baseline",
            "sample_source": "training_dataset",
            "samples": result.get("prediction_samples", []),
        },
    )
    model_artifact = {
        "type": "model",
        "name": model_name,
        "path": str(model_path.relative_to(root)).replace("\\", "/"),
    }
    metrics_artifact_payload = {
        "id": metrics_artifact.id,
        "type": "training",
        "name": "training_metrics.json",
        "path": _relative_project_path(root, metrics_artifact.path),
        "created_at": metrics_artifact.created_at,
    }
    prediction_samples_artifact_payload = {
        "id": prediction_samples_artifact.id,
        "type": "dataframe",
        "name": "prediction_samples.json",
        "path": _relative_project_path(root, prediction_samples_artifact.path),
        "created_at": prediction_samples_artifact.created_at,
    }
    evaluation_report_artifact = _write_evaluation_report_artifact(
        root=root,
        project_id=project_id,
        session_id=payload.session_id,
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=False,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        prediction_samples_artifact=prediction_samples_artifact_payload,
    )
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=False,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        evaluation_report_artifact=evaluation_report_artifact,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        best_model_name=result.get("model_name", model_name),
    )

    return {
        "experiment_id": experiment_id,
        "status": "completed",
        "engine": "baseline",
        "use_gpu": False,
        "metrics": result["metrics"],
        "runs": result["runs"],
        "model": result["model"],
        "model_artifact": model_artifact,
        "metrics_artifact": metrics_artifact_payload,
        "evaluation_report_artifact": evaluation_report_artifact,
        "prediction_samples_artifact": prediction_samples_artifact_payload,
    }


@router.post("/train-sklearn")
async def train_sklearn(project_id: str, payload: TrainSklearnRequest) -> dict[str, Any]:
    return await _run_train_sklearn(project_id=project_id, payload=payload)


@router.post("/resume-sklearn")
async def resume_sklearn(project_id: str, payload: ResumeSklearnTrainingRequest) -> dict[str, Any]:
    root = _project_root(project_id)
    state = load_task_state(project_root=root, session_id=payload.session_id, stage="train")
    if state is None:
        raise HTTPException(status_code=404, detail="Training retry state not found")
    if state.get("engine") != "sklearn":
        raise HTTPException(status_code=409, detail="Saved training retry state is not a sklearn run")
    retry_count = int(state.get("retry_count") or 0) + 1
    training_request = _state_to_sklearn_request(state, session_id=payload.session_id)
    return await _run_train_sklearn(
        project_id=project_id,
        payload=training_request,
        retry_count=retry_count,
    )


async def _run_train_sklearn(
    *,
    project_id: str,
    payload: TrainSklearnRequest,
    retry_count: int = 0,
) -> dict[str, Any]:
    root = _project_root(project_id)
    _resolve_project_file(root, payload.dataset_path)
    preprocessing_plan_artifact = None
    if payload.preprocessing_plan_path:
        preprocessing_plan_file = _resolve_project_file(
            root,
            payload.preprocessing_plan_path,
            missing_detail="Preprocessing plan not found",
        )
        preprocessing_plan_artifact = _existing_file_artifact(
            root=root,
            project_id=project_id,
            session_id=payload.session_id,
            artifact_type="dataframe",
            target=preprocessing_plan_file,
            metadata={
                "dataset_path": payload.dataset_path,
                "target_column": payload.target_column,
                "role": "preprocessing_plan",
            },
        )
    settings = get_settings()
    experiment_id = uuid4().hex
    model_name = f"sklearn_{_safe_name(payload.target_column)}_model.pkl"
    model_path = f"models/{model_name}"
    gpu_acquired = False

    if payload.use_gpu:
        try:
            await gpu_scheduler.acquire_gpu(
                experiment_id,
                project_id,
                timeout_seconds=settings.gpu_acquire_timeout_seconds,
            )
            gpu_acquired = True
        except GPUAcquireTimeout as exc:
            _write_training_failure_state(
                root=root,
                project_id=project_id,
                payload=payload,
                error=str(exc),
                retry_count=retry_count,
            )
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except GPUAcquireCancelled as exc:
            _write_training_failure_state(
                root=root,
                project_id=project_id,
                payload=payload,
                error=str(exc),
                retry_count=retry_count,
            )
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        kernel_service = create_kernel_service(
            backend=settings.kernel_backend,
            image=settings.kernel_image,
            workspace_root=root,
            docker_executable=settings.docker_executable,
            use_gpu=payload.use_gpu,
            memory_limit=settings.kernel_memory_limit,
            cpu_limit=settings.kernel_cpu_limit,
            pids_limit=settings.kernel_pids_limit,
            workspace_mount_mode=settings.kernel_workspace_mount_mode,
        )

        result = _json_safe(train_sklearn_classifier(
            workspace_root=root,
            dataset_path=payload.dataset_path,
            target_column=payload.target_column,
            model_output_path=model_path,
            preprocessing_plan_path=(
                preprocessing_plan_artifact["path"] if preprocessing_plan_artifact is not None else None
            ),
            kernel_service=kernel_service,
        ))
    except ValueError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        _write_training_failure_state(
            root=root,
            project_id=project_id,
            payload=payload,
            error=str(exc),
            retry_count=retry_count,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if gpu_acquired:
            await gpu_scheduler.release_gpu(experiment_id)

    artifact_service = ArtifactService(root)
    metrics_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="training",
        name="sklearn_training_metrics.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "use_gpu": payload.use_gpu,
            "preprocessing_plan_path": (
                preprocessing_plan_artifact["path"] if preprocessing_plan_artifact is not None else None
            ),
            **result,
        },
    )
    prediction_samples_artifact = artifact_service.write_json(
        project_id=project_id,
        session_id=payload.session_id,
        artifact_type="dataframe",
        name="prediction_samples.json",
        payload={
            "experiment_id": experiment_id,
            "dataset_path": payload.dataset_path,
            "target_column": payload.target_column,
            "engine": "sklearn",
            "sample_source": result["metrics"].get("holdout_strategy", "evaluation"),
            "samples": result.get("prediction_samples", []),
        },
    )
    model_artifact = {
        "type": "model",
        "name": model_name,
        "path": result.get("model_path", model_path),
    }
    metrics_artifact_payload = {
        "id": metrics_artifact.id,
        "type": "training",
        "name": "sklearn_training_metrics.json",
        "path": _relative_project_path(root, metrics_artifact.path),
        "created_at": metrics_artifact.created_at,
    }
    prediction_samples_artifact_payload = {
        "id": prediction_samples_artifact.id,
        "type": "dataframe",
        "name": "prediction_samples.json",
        "path": _relative_project_path(root, prediction_samples_artifact.path),
        "created_at": prediction_samples_artifact.created_at,
    }
    evaluation_report_artifact = _write_evaluation_report_artifact(
        root=root,
        project_id=project_id,
        session_id=payload.session_id,
        experiment_id=experiment_id,
        engine="sklearn",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=payload.use_gpu,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        preprocessing_plan_artifact=preprocessing_plan_artifact,
    )
    ExperimentService(root).record_run(
        project_id=project_id,
        experiment_id=experiment_id,
        engine="sklearn",
        dataset_path=payload.dataset_path,
        target_column=payload.target_column,
        use_gpu=payload.use_gpu,
        metrics=result["metrics"],
        model=result["model"],
        candidate_runs=result["runs"],
        model_artifact=model_artifact,
        metrics_artifact=metrics_artifact_payload,
        evaluation_report_artifact=evaluation_report_artifact,
        prediction_samples_artifact=prediction_samples_artifact_payload,
        preprocessing_plan_artifact=preprocessing_plan_artifact,
        preprocessing_plan=result.get("preprocessing_plan"),
        best_model_name=result.get("model_name", model_name),
    )

    response_payload = {
        "experiment_id": experiment_id,
        "status": "completed",
        "engine": "sklearn",
        "use_gpu": payload.use_gpu,
        "metrics": result["metrics"],
        "runs": result["runs"],
        "model": result["model"],
        "model_artifact": model_artifact,
        "metrics_artifact": metrics_artifact_payload,
        "evaluation_report_artifact": evaluation_report_artifact,
        "prediction_samples_artifact": prediction_samples_artifact_payload,
    }
    if preprocessing_plan_artifact is not None:
        response_payload["preprocessing_plan_artifact"] = preprocessing_plan_artifact
    if result.get("preprocessing_plan") is not None:
        response_payload["preprocessing_plan"] = result["preprocessing_plan"]
    delete_task_state(project_root=root, session_id=payload.session_id, stage="train")
    return response_payload
